import requests
import json
import os

def process_ship_data(ship_url, group_url, stats_url, sp_weapon_url, transform_url, skill_url, output_filename):
    """
    Fetches ship data from multiple sources, filters and merges it,
    and saves the final result to a file.

    Args:
        ship_url (str): The URL of the main ship JSON file.
        group_url (str): The URL of the ship group data JSON file.
        stats_url (str): The URL of the ship statistics JSON file.
        sp_weapon_url (str): The URL for the special weapon statistics.
        transform_url (str): The URL for the retrofit skill transform data.
        skill_url (str): The URL for the detailed skill effects data.
        output_filename (str): The name of the file to save the final data.
    """
    RARITY_MAPPING = {6: 'UR', 5: 'SSR', 4: 'SR', 3: 'R', 2: 'N'}

    try:
        # --- PART 1: Fetch and Filter Initial Ship Data ---
        print(f"Fetching initial ship data from {ship_url}...")
        response_ships = requests.get(ship_url)
        response_ships.raise_for_status()
        all_ships_data = response_ships.json()
        
        print("Initial data fetched. Filtering...")
        
        desired_keys = [
            "id", "gid", "sid", "nationality", "type", "rarity", "armor",
            "retrofit", "base", "growth", "enhance", "skill"
        ]
        
        filtered_ships = []
        for ship in all_ships_data:
            new_ship_dict = {key: ship[key] for key in desired_keys if key in ship}
            if 'sid' in new_ship_dict and isinstance(new_ship_dict.get('sid'), list) and new_ship_dict['sid']:
                new_ship_dict['sid'] = new_ship_dict['sid'][0]
            filtered_ships.append(new_ship_dict)
        print("Filtering complete.")

        # --- PART 2: Fetch All External Data Sources and Create Mappings ---
        print("\nFetching external data sources and creating mappings...")
        
        # Group descriptions
        response_groups = requests.get(group_url)
        response_groups.raise_for_status()
        group_data = response_groups.json()
        description_map = {v["group_type"]: [item[0] for item in v.get("description", []) if isinstance(item, list) and item]
                           for k, v in group_data.items() if "group_type" in v}
        
        # Ship statistics
        response_stats = requests.get(stats_url)
        response_stats.raise_for_status()
        stats_data = response_stats.json()
        stats_keys_to_fetch = ["name", "gift_dislike", "rarity", "skin_id"]
        stats_map = {int(sid): {key: stats.get(key) for key in stats_keys_to_fetch} for sid, stats in stats_data.items()}
        
        # SP weapons
        response_sp_weapon = requests.get(sp_weapon_url)
        response_sp_weapon.raise_for_status()
        sp_weapon_data = response_sp_weapon.json()
        sp_weapon_keys_to_fetch = ["icon", "name", "skill_upgrade", "attribute_1", "attribute_2"]
        sp_weapon_map = {v["unique"]: {key: v.get(key) for key in sp_weapon_keys_to_fetch}
                         for k, v in sp_weapon_data.items() if "unique" in v}

        # Retrofit skills
        response_transform = requests.get(transform_url)
        response_transform.raise_for_status()
        transform_data = response_transform.json()
        transform_map = {int(k): v["skill_id"] for k, v in transform_data.items() if "skill_id" in v}

        # Detailed skill effects
        response_skill_effects = requests.get(skill_url)
        response_skill_effects.raise_for_status()
        skill_effects_data = response_skill_effects.json()
        
        print("All external data fetched and mapped.")

        # --- PART 3: Process and Merge All Data ---
        print("\nMerging all data and processing skills...")
        
        for ship in filtered_ships:
            gid = ship.get('gid')
            sid = ship.get('sid')
            
            # Merge descriptions, stats, and SP weapons
            if gid in description_map: ship['description'] = description_map[gid]
            if sid in stats_map: ship.update(stats_map[sid])
            if gid in sp_weapon_map: ship['sp_weapon'] = sp_weapon_map[gid]
            
            # Map rarity
            if ship.get('rarity') in RARITY_MAPPING: ship['rarity'] = RARITY_MAPPING[ship['rarity']]
            
            # Add shipyard URL
            if ship.get('skin_id'): ship['shipyard'] = f"https://raw.githubusercontent.com/Fernando2603/AzurLane/main/images/skin/{ship['skin_id']}/shipyard.png"
            
            # Add retrofit skill_id
            if 'retrofit' in ship and isinstance(ship.get('retrofit'), dict):
                retrofit_skill = ship['retrofit'].get('skill')
                if retrofit_skill in transform_map:
                    ship['retrofit']['skill_id'] = transform_map[retrofit_skill]

            # --- PART 4: Check for 'weapon_true' in all skills ---
            skill_locations = []
            
            # Gather all potential skills
            if 'skill' in ship and isinstance(ship['skill'], dict):
                skill_locations.extend(ship['skill'].values())
            
            if 'sp_weapon' in ship: skill_locations.append(ship['sp_weapon'])
            if 'retrofit' in ship: skill_locations.append(ship['retrofit'])
            
            for skill_container in filter(lambda s: isinstance(s, dict), skill_locations):
                skill_id = None
                
                # MODIFICATION: Initialize the field to False by default
                skill_container["weapon_true"] = False
                
                # Determine the skill ID from the container type
                if 'id' in skill_container: skill_id = skill_container.get('id')
                elif 'skill_id' in skill_container: skill_id = skill_container.get('skill_id')
                elif 'skill_upgrade' in skill_container and isinstance(skill_container.get('skill_upgrade'), list) and skill_container['skill_upgrade']:
                    upgrade_info = skill_container['skill_upgrade'][0]
                    if isinstance(upgrade_info, list) and len(upgrade_info) > 1:
                        skill_id = upgrade_info[1]
                
                if skill_id:
                    skill_key = f"skill_{skill_id}"
                    if skill_key in skill_effects_data:
                        effect_list = skill_effects_data[skill_key].get("effect_list", [])
                        for effect in effect_list:
                            if "weapon_id" in effect.get("arg_list", {}):
                                # If found, update the flag to True and stop searching for this skill
                                skill_container["weapon_true"] = True
                                break 
        
        print("Merging and skill processing complete.")

        # --- PART 5: Save the Final, Enriched Data ---
        with open(output_filename, 'w', encoding='utf-8') as f:
            json.dump(filtered_ships, f, ensure_ascii=False, indent=4)
            
        print(f"\n✅ Success! Final enriched data has been saved to '{output_filename}'")
        print(f"File saved at: {os.path.abspath(output_filename)}")

    except requests.exceptions.RequestException as e:
        print(f"❌ Error fetching data: {e}")
    except json.JSONDecodeError as e:
        print(f"❌ Error: Failed to decode JSON. {e}")
    except Exception as e:
        print(f"❌ An unexpected error occurred: {e}")

# --- Main execution ---
if __name__ == "__main__":
    SHIP_URL = "https://raw.githubusercontent.com/Fernando2603/AzurLane/refs/heads/main/ship.json"
    GROUP_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/ShareCfg/ship_data_group.json"
    STATS_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/sharecfgdata/ship_data_statistics.json"
    SP_WEAPON_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/sharecfgdata/spweapon_data_statistics.json"
    TRANSFORM_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/ShareCfg/transform_data_template.json"
    SKILL_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/GameCfg/skill.json"
    OUTPUT_FILE = "./output/ship_info_data.json"

    process_ship_data(SHIP_URL, GROUP_URL, STATS_URL, SP_WEAPON_URL, TRANSFORM_URL, SKILL_URL, OUTPUT_FILE)