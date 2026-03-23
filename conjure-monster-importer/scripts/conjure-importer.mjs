/**
 * Conjure Monster Importer for Foundry VTT
 * Imports monsters created with Conjure (rpgconjure.com)
 *
 * Supports both dnd5e 2.x (legacy) and 3.x+ (activities system)
 */

const MODULE_ID = 'conjure-importer';

/**
 * Check if we're running dnd5e 3.0+ (activities system)
 */
function usesActivities() {
  const version = game.system.version;
  const [major] = version.split('.').map(Number);
  return major >= 3;
}

/**
 * Generate a random ID for activities (dnd5e 3.x+ format)
 */
function generateActivityId() {
  return foundry.utils.randomID(16);
}

// Size mapping from Conjure to Foundry
const SIZE_MAP = {
  tiny: 'tiny',
  small: 'sm',
  medium: 'med',
  large: 'lg',
  huge: 'huge',
  gargantuan: 'grg'
};

// Ability score mapping
const ABILITY_MAP = {
  str: 'str',
  dex: 'dex',
  con: 'con',
  int: 'int',
  wis: 'wis',
  cha: 'cha'
};

// Damage type mapping
const DAMAGE_TYPE_MAP = {
  acid: 'acid',
  bludgeoning: 'bludgeoning',
  cold: 'cold',
  fire: 'fire',
  force: 'force',
  lightning: 'lightning',
  necrotic: 'necrotic',
  piercing: 'piercing',
  poison: 'poison',
  psychic: 'psychic',
  radiant: 'radiant',
  slashing: 'slashing',
  thunder: 'thunder'
};

/**
 * Hook into Foundry's initialization
 */
Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Initializing Conjure Monster Importer`);
});

/**
 * Add import button to Actors directory
 */
Hooks.on('renderActorDirectory', (app, html, data) => {
  // Check if user has permission to create actors
  if (!game.user.can('ACTOR_CREATE')) return;

  // Handle both jQuery (v10-12) and native element (v13+)
  const element = html instanceof HTMLElement ? html : html[0];
  if (!element) return;

  // Find the header actions
  const headerActions = element.querySelector('.header-actions');
  if (!headerActions) return;

  // Check if button already exists
  if (headerActions.querySelector('.conjure-import-btn')) return;

  // Create import button
  const importButton = document.createElement('button');
  importButton.className = 'conjure-import-btn';
  importButton.title = 'Import from Conjure';
  importButton.innerHTML = '<i class="fas fa-file-import"></i> Conjure';

  // Add click handler
  importButton.addEventListener('click', (event) => {
    event.preventDefault();
    showImportDialog();
  });

  // Add button to header
  headerActions.appendChild(importButton);
});

/**
 * Show the import dialog
 */
function showImportDialog() {
  new Dialog({
    title: 'Import from Conjure',
    content: `
      <form class="conjure-import-form">
        <p>Select a monster JSON file exported from <a href="https://rpgconjure.com" target="_blank">Conjure</a>.</p>
        <div class="form-group">
          <label for="conjure-file">Monster File</label>
          <input type="file" id="conjure-file" name="file" accept=".json" />
        </div>
        <div class="form-group">
          <label for="conjure-folder">Destination Folder</label>
          <select id="conjure-folder" name="folder">
            <option value="">— Root —</option>
            ${game.folders
              .filter(f => f.type === 'Actor')
              .map(f => `<option value="${f.id}">${f.name}</option>`)
              .join('')}
          </select>
        </div>
      </form>
    `,
    buttons: {
      import: {
        icon: '<i class="fas fa-file-import"></i>',
        label: 'Import',
        callback: async (html) => {
          const fileInput = html.find('#conjure-file')[0];
          const folderId = html.find('#conjure-folder').val();

          if (!fileInput.files.length) {
            ui.notifications.warn('Please select a file to import.');
            return;
          }

          await importMonsterFile(fileInput.files[0], folderId || null);
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: 'Cancel'
      }
    },
    default: 'import'
  }).render(true);
}

/**
 * Import a monster from a file
 */
async function importMonsterFile(file, folderId) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    // Check if this is a Foundry export (has flags.conjure.monster) or raw Conjure JSON
    let monster;
    if (data.flags?.conjure?.monster) {
      monster = data.flags.conjure.monster;
      // Also check for artwork in flags (Foundry export format)
      if (data.flags.conjure.artworkUrl && !monster.artworkUrl) {
        monster.artworkUrl = data.flags.conjure.artworkUrl;
      }
      // Or from the top-level img property
      if (data.img && !monster.artworkUrl && !data.img.includes('mystery-man')) {
        monster.artworkUrl = data.img;
      }
    } else if (data.name && data.abilityScores) {
      // Raw Conjure export
      monster = data;
    } else {
      throw new Error('Unrecognized file format. Please use a JSON file exported from Conjure.');
    }

    const actor = await createActorFromMonster(monster, folderId);
    ui.notifications.info(`Successfully imported "${actor.name}"!`);

    // Open the actor sheet
    actor.sheet.render(true);
  } catch (error) {
    console.error(`${MODULE_ID} | Import error:`, error);
    ui.notifications.error(`Failed to import monster: ${error.message}`);
  }
}

/**
 * Create a Foundry actor from Conjure monster data
 */
async function createActorFromMonster(monster, folderId) {
  // Handle artwork - save base64 to file if needed
  let imgPath = null;
  if (monster.artworkUrl) {
    imgPath = await processArtwork(monster.artworkUrl, monster.name);
  }

  // Build the actor data
  const actorData = {
    name: monster.name,
    type: 'npc',
    folder: folderId,
    img: imgPath || 'icons/svg/mystery-man.svg',
    system: buildSystemData(monster),
    prototypeToken: buildTokenData(monster, imgPath),
    flags: {
      [MODULE_ID]: {
        imported: true,
        source: monster
      }
    }
  };

  // Create the actor
  const actor = await Actor.create(actorData);

  // Create items (attacks, abilities, etc.)
  const items = buildItems(monster);
  if (items.length > 0) {
    await actor.createEmbeddedDocuments('Item', items);
  }

  return actor;
}

/**
 * Process artwork - convert base64 to file or return URL
 */
async function processArtwork(artworkUrl, monsterName) {
  // If it's not a base64 data URL, return it directly
  if (!artworkUrl.startsWith('data:')) {
    return artworkUrl;
  }

  try {
    // Extract mime type and base64 data
    const matches = artworkUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      console.warn(`${MODULE_ID} | Invalid base64 data URL format`);
      return null;
    }

    const mimeType = matches[1];
    const base64Data = matches[2];

    // Determine file extension
    const extMap = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp'
    };
    const ext = extMap[mimeType] || 'png';

    // Convert base64 to blob
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });

    // Create a sanitized filename
    const sanitizedName = monsterName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    const timestamp = Date.now();
    const filename = `conjure-${sanitizedName}-${timestamp}.${ext}`;

    // Create a File object
    const file = new File([blob], filename, { type: mimeType });

    // Upload to Foundry's data folder
    const targetPath = 'conjure-imports';

    // Ensure the directory exists
    try {
      await FilePicker.browse('data', targetPath);
    } catch (e) {
      // Directory doesn't exist, create it
      await FilePicker.createDirectory('data', targetPath);
    }

    // Upload the file
    const response = await FilePicker.upload('data', targetPath, file, {});

    if (response.path) {
      console.log(`${MODULE_ID} | Saved artwork to ${response.path}`);
      return response.path;
    }

    return null;
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to process artwork:`, error);
    return null;
  }
}

/**
 * Build the system data for the actor
 */
function buildSystemData(monster) {
  const system = {
    abilities: {},
    attributes: {
      ac: {
        flat: monster.armorClass,
        calc: 'flat'
      },
      hp: {
        value: monster.hitPoints,
        max: monster.hitPoints,
        formula: monster.hitDice
      },
      movement: {
        walk: monster.speed.walk || 0,
        fly: monster.speed.fly || 0,
        swim: monster.speed.swim || 0,
        burrow: monster.speed.burrow || 0,
        climb: monster.speed.climb || 0,
        hover: monster.speed.hover || false,
        units: 'ft'
      },
      senses: buildSenses(monster),
      prof: monster.proficiencyBonus || 2
    },
    details: {
      cr: monster.cr,
      xp: {
        value: monster.xp
      },
      type: {
        value: monster.type,
        subtype: monster.subtypes?.join(', ') || '',
        custom: ''
      },
      alignment: monster.alignment,
      source: monster.source || 'Conjure',
      biography: {
        value: monster.description || ''
      }
    },
    traits: {
      size: SIZE_MAP[monster.size] || 'med',
      languages: {
        value: monster.languages || [],
        custom: ''
      },
      di: {
        value: (monster.damageImmunities || []).map(d => DAMAGE_TYPE_MAP[d] || d),
        custom: ''
      },
      dr: {
        value: (monster.damageResistances || []).map(d => DAMAGE_TYPE_MAP[d] || d),
        custom: ''
      },
      dv: {
        value: (monster.damageVulnerabilities || []).map(d => DAMAGE_TYPE_MAP[d] || d),
        custom: ''
      },
      ci: {
        value: monster.conditionImmunities || [],
        custom: ''
      }
    }
  };

  // Set ability scores
  for (const [key, value] of Object.entries(monster.abilityScores)) {
    system.abilities[ABILITY_MAP[key]] = {
      value: value,
      proficient: 0,
      bonuses: {
        check: '',
        save: ''
      }
    };
  }

  // Set saving throw proficiencies
  if (monster.savingThrows) {
    for (const [key, value] of Object.entries(monster.savingThrows)) {
      const ability = ABILITY_MAP[key];
      if (ability && system.abilities[ability]) {
        system.abilities[ability].proficient = 1;
      }
    }
  }

  // Set legendary action and resistance resources
  if (monster.legendaryActions?.length > 0 || monster.legendaryResistances > 0) {
    system.resources = {
      legact: {
        value: 3,
        max: 3
      },
      legres: {
        value: monster.legendaryResistances || 0,
        max: monster.legendaryResistances || 0
      }
    };
  }

  return system;
}

/**
 * Build senses data
 */
function buildSenses(monster) {
  const senses = {
    darkvision: monster.senses?.darkvision || 0,
    blindsight: monster.senses?.blindsight || 0,
    tremorsense: monster.senses?.tremorsense || 0,
    truesight: monster.senses?.truesight || 0,
    special: '',
    units: 'ft'
  };
  return senses;
}

/**
 * Build token data
 */
function buildTokenData(monster, imgPath = null) {
  const sizeScale = {
    tiny: 0.5,
    sm: 0.8,
    med: 1,
    lg: 2,
    huge: 3,
    grg: 4
  };

  const size = SIZE_MAP[monster.size] || 'med';

  const tokenData = {
    displayName: 20, // OWNER
    displayBars: 20, // OWNER
    bar1: { attribute: 'attributes.hp' },
    disposition: -1, // HOSTILE
    width: sizeScale[size] || 1,
    height: sizeScale[size] || 1
  };

  // Use artwork for token if available
  if (imgPath) {
    tokenData.texture = {
      src: imgPath
    };
  }

  return tokenData;
}

/**
 * Build items (attacks, abilities, etc.)
 */
function buildItems(monster) {
  const items = [];

  // Add attacks as weapon items
  if (monster.attacks) {
    for (const attack of monster.attacks) {
      items.push(buildAttackItem(attack, monster));
    }
  }

  // Add special abilities as feat items
  if (monster.specialAbilities) {
    for (const ability of monster.specialAbilities) {
      items.push(buildAbilityItem(ability));
    }
  }

  // Add recharge actions
  if (monster.rechargeActions) {
    for (const action of monster.rechargeActions) {
      items.push(buildRechargeItem(action, monster));
    }
  }

  // Add reactions
  if (monster.reactions) {
    for (const reaction of monster.reactions) {
      items.push(buildReactionItem(reaction));
    }
  }

  // Add legendary actions
  if (monster.legendaryActions) {
    for (const action of monster.legendaryActions) {
      items.push(buildLegendaryItem(action));
    }
  }

  // Add multiattack if present
  if (monster.multiattack) {
    items.push(buildMultiattackItem(monster));
  }

  return items;
}

/**
 * Parse a dice string and extract just the dice portion without the modifier
 * e.g., "8d12+6" → "8d12", "2d6+3" → "2d6", "1d8-1" → "1d8"
 */
function stripModifierFromDice(diceStr) {
  const match = diceStr.match(/^(\d+d\d+)/);
  return match ? match[1] : diceStr;
}

/**
 * Determine which ability is used for an attack based on monster stats and attack type
 */
function getAttackAbility(attack, monster) {
  const isRanged = attack.type === 'ranged';

  if (isRanged) {
    return 'dex';
  }

  // For melee, check if DEX is higher (finesse-style)
  const strMod = Math.floor((monster.abilityScores.str - 10) / 2);
  const dexMod = Math.floor((monster.abilityScores.dex - 10) / 2);

  return dexMod > strMod ? 'dex' : 'str';
}

/**
 * Build an attack item (supports both dnd5e 2.x and 3.x+)
 */
function buildAttackItem(attack, monster) {
  const isRanged = attack.type === 'ranged' || attack.type === 'melee or ranged';
  const ability = getAttackAbility(attack, monster);
  const abilityMod = Math.floor((monster.abilityScores[ability] - 10) / 2);
  const flatBonus = attack.toHit - monster.proficiencyBonus - abilityMod;

  // Build damage parts - strip the modifier since Foundry will add ability mod
  const damageParts = (attack.damage || []).map(d => {
    const diceOnly = stripModifierFromDice(d.dice);
    return [diceOnly, DAMAGE_TYPE_MAP[d.type] || d.type];
  });

  if (usesActivities()) {
    // dnd5e 3.x+ format with activities
    const activityId = generateActivityId();
    return {
      name: attack.name,
      type: 'weapon',
      system: {
        description: { value: attack.description || '' },
        equipped: true,
        proficient: true,
        ability: ability,
        range: {
          value: attack.reach || (attack.range?.normal) || 5,
          long: attack.range?.long || null,
          units: 'ft'
        },
        activities: {
          [activityId]: {
            _id: activityId,
            type: 'attack',
            name: '',
            activation: { type: 'action', value: 1 },
            attack: {
              ability: ability,
              bonus: flatBonus !== 0 ? `${flatBonus}` : '',
              type: { value: isRanged ? 'ranged' : 'melee', classification: 'weapon' }
            },
            damage: {
              parts: damageParts.map(([formula, type]) => ({
                number: null,
                denomination: null,
                bonus: '',
                custom: { enabled: true, formula: formula },
                types: [type]
              }))
            }
          }
        }
      }
    };
  } else {
    // dnd5e 2.x legacy format
    return {
      name: attack.name,
      type: 'weapon',
      system: {
        description: { value: attack.description || '' },
        activation: { type: 'action', cost: 1 },
        actionType: isRanged ? 'rwak' : 'mwak',
        attackBonus: flatBonus !== 0 ? `${flatBonus}` : '',
        damage: { parts: damageParts },
        range: {
          value: attack.reach || (attack.range?.normal) || 5,
          long: attack.range?.long || null,
          units: 'ft'
        },
        ability: ability,
        proficient: true,
        equipped: true
      }
    };
  }
}

/**
 * Build a special ability item
 */
function buildAbilityItem(ability) {
  return {
    name: ability.name,
    type: 'feat',
    system: {
      description: {
        value: `<p>${ability.description}</p>`
      },
      activation: {
        type: '',
        cost: null
      },
      type: {
        value: 'monster',
        subtype: ''
      }
    }
  };
}

/**
 * Build a recharge action item (supports both dnd5e 2.x and 3.x+)
 */
function buildRechargeItem(action, monster) {
  const rechargeText = action.rechargeMin === 6 ? '6' : `${action.rechargeMin}-6`;
  const name = `${action.name} (Recharge ${rechargeText})`;

  let description = `<p>${action.description}</p>`;
  if (action.saveAbility && action.saveDC) {
    description = `<p><strong>DC ${action.saveDC} ${action.saveAbility.toUpperCase()} save.</strong></p>${description}`;
  }

  const damageType = action.damage ? (DAMAGE_TYPE_MAP[action.damage.type] || action.damage.type) : null;

  if (usesActivities()) {
    // dnd5e 3.x+ format with activities
    const activityId = generateActivityId();
    const activity = {
      _id: activityId,
      type: 'save',
      name: '',
      activation: { type: 'action', value: 1 },
      consumption: {
        targets: [{ type: 'itemUses', value: 1 }]
      },
      save: {
        ability: action.saveAbility || 'con',
        dc: { calculation: 'flat', formula: String(action.saveDC || 15) }
      }
    };

    if (action.damage) {
      activity.damage = {
        parts: [{
          number: null,
          denomination: null,
          bonus: '',
          custom: { enabled: true, formula: action.damage.dice },
          types: [damageType]
        }]
      };
      activity.damage.onSave = action.damage.halfOnSave !== false ? 'half' : 'none';
    }

    return {
      name: name,
      type: 'feat',
      system: {
        description: { value: description },
        type: { value: 'monster', subtype: '' },
        uses: {
          max: 1,
          value: 1,
          recovery: [{ period: 'recharge', formula: String(action.rechargeMin) }]
        },
        activities: { [activityId]: activity }
      }
    };
  } else {
    // dnd5e 2.x legacy format
    const damageParts = action.damage ? [[action.damage.dice, damageType]] : [];
    return {
      name: name,
      type: 'feat',
      system: {
        description: { value: description },
        activation: { type: 'action', cost: 1 },
        damage: { parts: damageParts },
        save: action.saveAbility ? {
          ability: action.saveAbility,
          dc: action.saveDC,
          scaling: 'flat'
        } : null,
        recharge: { value: action.rechargeMin, charged: true },
        type: { value: 'monster', subtype: '' }
      }
    };
  }
}

/**
 * Build a reaction item (supports both dnd5e 2.x and 3.x+)
 */
function buildReactionItem(reaction) {
  if (usesActivities()) {
    const activityId = generateActivityId();
    return {
      name: reaction.name,
      type: 'feat',
      system: {
        description: { value: `<p>${reaction.description}</p>` },
        type: { value: 'monster', subtype: '' },
        activities: {
          [activityId]: {
            _id: activityId,
            type: 'utility',
            name: '',
            activation: { type: 'reaction', value: 1 }
          }
        }
      }
    };
  } else {
    return {
      name: reaction.name,
      type: 'feat',
      system: {
        description: { value: `<p>${reaction.description}</p>` },
        activation: { type: 'reaction', cost: 1 },
        type: { value: 'monster', subtype: '' }
      }
    };
  }
}

/**
 * Build a legendary action item (supports both dnd5e 2.x and 3.x+)
 */
function buildLegendaryItem(action) {
  const name = `${action.name} (Legendary)`;
  const description = `<p><strong>Costs ${action.cost} action${action.cost > 1 ? 's' : ''}.</strong></p><p>${action.description}</p>`;

  if (usesActivities()) {
    const activityId = generateActivityId();
    return {
      name: name,
      type: 'feat',
      system: {
        description: { value: description },
        type: { value: 'monster', subtype: '' },
        activities: {
          [activityId]: {
            _id: activityId,
            type: 'utility',
            name: '',
            activation: { type: 'legendary', value: action.cost }
          }
        }
      }
    };
  } else {
    return {
      name: name,
      type: 'feat',
      system: {
        description: { value: description },
        activation: { type: 'legendary', cost: action.cost },
        type: { value: 'monster', subtype: '' }
      }
    };
  }
}

/**
 * Build multiattack item
 */
function buildMultiattackItem(monster) {
  // Build description from multiattack options
  let description = '';

  if (monster.multiattack.restriction) {
    description += `<p><em>${monster.multiattack.restriction}</em></p>`;
  }

  const optionDescriptions = monster.multiattack.options.map(option => {
    const parts = option.entries.map(entry => {
      if (entry.attackRef === 'any-melee') {
        return `${entry.count} melee attack${entry.count > 1 ? 's' : ''}`;
      } else if (entry.attackRef === 'any-ranged') {
        return `${entry.count} ranged attack${entry.count > 1 ? 's' : ''}`;
      } else {
        const attack = monster.attacks?.find(a => a.id === entry.attackRef);
        const name = attack?.name || entry.attackRef;
        return `${entry.count} ${name} attack${entry.count > 1 ? 's' : ''}`;
      }
    });

    let text = parts.join(' and ');
    if (option.substitution) {
      text += ` ${option.substitution}`;
    }
    return text;
  });

  description += `<p>The ${monster.name.toLowerCase()} makes ${optionDescriptions.join(', or ')}.</p>`;

  if (usesActivities()) {
    const activityId = generateActivityId();
    return {
      name: 'Multiattack',
      type: 'feat',
      system: {
        description: { value: description },
        type: { value: 'monster', subtype: '' },
        activities: {
          [activityId]: {
            _id: activityId,
            type: 'utility',
            name: '',
            activation: { type: 'action', value: 1 }
          }
        }
      }
    };
  } else {
    return {
      name: 'Multiattack',
      type: 'feat',
      system: {
        description: { value: description },
        activation: { type: 'action', cost: 1 },
        type: { value: 'monster', subtype: '' }
      }
    };
  }
}
