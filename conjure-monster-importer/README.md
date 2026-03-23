# Conjure Monster Importer for Foundry VTT

Import monsters created with [Conjure](https://rpgconjure.com) directly into Foundry VTT.

## Installation

### Method 1: Manifest URL (Recommended)
1. In Foundry VTT, go to **Add-on Modules**
2. Click **Install Module**
3. Paste this manifest URL:
   ```
   https://raw.githubusercontent.com/gardolm/conjure/main/foundry-module/module.json
   ```
4. Click **Install**

### Method 2: Manual Installation
1. Download the latest release from the [releases page](https://github.com/gardolm/conjure/releases)
2. Extract the zip file to your Foundry VTT `Data/modules/` directory
3. Restart Foundry VTT

## Usage

1. Enable the module in your world's module settings
2. Go to the **Actors** tab in the sidebar
3. Click the **Conjure** button in the header
4. Select a monster JSON file exported from Conjure
5. Choose a destination folder (optional)
6. Click **Import**

The imported monster will include:
- All ability scores and stats
- Armor class, hit points, and speed
- Saving throw proficiencies
- Damage resistances, immunities, and vulnerabilities
- Condition immunities
- Senses (darkvision, blindsight, etc.)
- All attacks as weapon items
- Special abilities as feat items
- Reactions
- Legendary actions
- Multiattack

## Supported Export Formats

The importer supports both:
- **Foundry VTT format** (`*-foundry.json`) - The recommended export format
- **Raw JSON format** (`*.json`) - Also works if you exported the basic JSON

## Compatibility

- Foundry VTT v11 and v12
- D&D 5th Edition system

## Support

For issues or feature requests, please visit the [GitHub repository](https://github.com/gardolm/conjure).
