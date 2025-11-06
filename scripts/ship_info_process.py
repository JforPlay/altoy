import requests
import json
import os

# NEW: Strict name overrides for specific GIDs
STRICT_NAME_OVERRIDES = {
    "30507": "카가(전함)",
    "20232": "엔터프라이즈(경순)",
    "1010001": "넵튠(콜라보)",
    "1060003": "카스미(콜라보)",
    "1100005": "후부키(콜라보)"
}

def process_ship_data(ship_url, group_url, stats_url, sp_weapon_url, transform_url, skill_url, buff_url, ship_drops_file, output_filename):
    """
    Fetches ship data from multiple sources, filters and merges it,
    and saves the final result to a file.

    Includes advanced logic to trace ALL weapon skills through buffs, capturing firing data.
    Also includes construction-specific data (timer, light, medium, heavy, limited).
    """
    RARITY_MAPPING = {6: 'UR', 5: 'SSR', 4: 'SR', 3: 'R', 2: 'N'}

    try:
        # --- PART 1 & 2: Fetching Data ---
        print("Fetching all data sources...")
        response_ships = requests.get(ship_url); response_ships.raise_for_status()
        all_ships_data = response_ships.json()

        response_groups = requests.get(group_url); response_groups.raise_for_status()
        group_data = response_groups.json()
        description_map = {v["group_type"]: [item[0] for item in v.get("description", []) if isinstance(item, list) and item]
                           for k, v in group_data.items() if "group_type" in v}
        
        response_stats = requests.get(stats_url); response_stats.raise_for_status()
        stats_data = response_stats.json()
        stats_keys_to_fetch = ["name", "gift_dislike", "rarity", "skin_id"]
        stats_map = {int(sid): {key: stats.get(key) for key in stats_keys_to_fetch} for sid, stats in stats_data.items()}
        
        response_sp_weapon = requests.get(sp_weapon_url); response_sp_weapon.raise_for_status()
        sp_weapon_data = response_sp_weapon.json()
        sp_weapon_keys_to_fetch = ["icon", "name", "skill_upgrade", "attribute_1", "attribute_2"]
        sp_weapon_map = {v["unique"]: {key: v.get(key) for key in sp_weapon_keys_to_fetch}
                         for k, v in sp_weapon_data.items() if "unique" in v}

        response_transform = requests.get(transform_url); response_transform.raise_for_status()
        transform_data = response_transform.json()
        transform_map = {int(k): v["skill_id"] for k, v in transform_data.items() if "skill_id" in v}

        response_skill_effects = requests.get(skill_url); response_skill_effects.raise_for_status()
        skill_effects_data = response_skill_effects.json()
        
        response_buffs = requests.get(buff_url); response_buffs.raise_for_status()
        buff_effects_data = response_buffs.json()

        # Load ship_drops.json for timer data
        print("Loading ship_drops.json for construction timer data...")
        with open(ship_drops_file, 'r', encoding='utf-8') as f:
            ship_drops_data = json.load(f)
        ship_drops_map = {
            details['id']: details.get('timer')
            for _, details in ship_drops_data.items() if 'id' in details
        }

        print("All external data fetched and mapped.")

        # --- PART 3: Filtering and Merging ---
        print("\nFiltering ships and merging data...")
        filtered_ships = []
        desired_keys = ["id", "gid", "sid", "nationality", "type", "rarity", "armor", "retrofit", "base", "growth", "enhance", "skill"]
        for ship in all_ships_data:
            new_ship_dict = {key: ship[key] for key in desired_keys if key in ship}
            if 'sid' in new_ship_dict and isinstance(new_ship_dict.get('sid'), list) and new_ship_dict['sid']:
                new_ship_dict['sid'] = new_ship_dict['sid'][0]
            filtered_ships.append(new_ship_dict)

        for ship in filtered_ships:
            gid, sid, ship_id = ship.get('gid'), ship.get('sid'), ship.get('id')
            if gid in description_map: ship['description'] = description_map[gid]
            if sid in stats_map: ship.update(stats_map[sid])
            if gid in sp_weapon_map: ship['sp_weapon'] = sp_weapon_map[gid]
            if ship.get('rarity') in RARITY_MAPPING: ship['rarity'] = RARITY_MAPPING[ship['rarity']]
            if ship.get('skin_id'): ship['shipyard'] = f"https://raw.githubusercontent.com/Fernando2603/AzurLane/main/images/skin/{ship['skin_id']}/shipyard.png"
            if 'retrofit' in ship and isinstance(ship.get('retrofit'), dict):
                if ship['retrofit'].get('skill') in transform_map:
                    ship['retrofit']['skill_id'] = transform_map[ship['retrofit']['skill']]

            # Name processing
            ship['name'] = ship['name'].strip()
            # print(gid)
            if str(gid) in STRICT_NAME_OVERRIDES:
                ship['name'] = STRICT_NAME_OVERRIDES[str(gid)]
                print(f"Applied strict name override for GID {gid}: {ship['name']}")

            # --- Add construction-specific fields ---
            # Add timer from ship_drops.json
            ship['timer'] = ship_drops_map.get(ship_id)

            # Parse construction types from description
            description_text = "".join(ship.get("description", []))
            ship['light'] = "소형함 건조" in description_text
            ship['medium'] = "중형함 건조" in description_text
            ship['heavy'] = "특형함 건조" in description_text

            # Check for "limited" status
            is_limited_event = "한정" in description_text
            ship['limited'] = is_limited_event and not (ship['light'] or ship['medium'] or ship['heavy'])

            # --- PART 4: Advanced 'weapon_true' Check ---
            skill_locations = []
            if 'skill' in ship and isinstance(ship['skill'], dict): skill_locations.extend(ship['skill'].values())
            if 'sp_weapon' in ship: skill_locations.append(ship['sp_weapon'])
            if 'retrofit' in ship: skill_locations.append(ship['retrofit'])
            
            for skill_container in filter(lambda s: isinstance(s, dict), skill_locations):
                skill_container["weapon_true"] = False
                skill_container["attached_weapon_skill_id"] = []

                skill_id = None
                if 'id' in skill_container: skill_id = skill_container.get('id')
                elif 'skill_id' in skill_container: skill_id = skill_container.get('skill_id')
                elif 'skill_upgrade' in skill_container and isinstance(skill_container.get('skill_upgrade'), list) and skill_container['skill_upgrade']:
                    if isinstance(skill_container['skill_upgrade'][0], list) and len(skill_container['skill_upgrade'][0]) > 1:
                        skill_id = skill_container['skill_upgrade'][0][1]
                
                if skill_id:
                    skill_key = f"skill_{skill_id}"
                    if skill_key in skill_effects_data:
                        skill_details = skill_effects_data[skill_key]
                        
                        all_effects_to_check = []
                        if isinstance(skill_details.get("effect_list"), list):
                            all_effects_to_check.extend(skill_details["effect_list"])
                        for key, value in skill_details.items():
                            if isinstance(value, dict) and isinstance(value.get("effect_list"), list):
                                all_effects_to_check.extend(value["effect_list"])

                        for effect in all_effects_to_check:
                            if not isinstance(effect, dict): continue
                            arg_list = effect.get("arg_list", {})
                            if not isinstance(arg_list, dict): continue

                            if "weapon_id" in arg_list:
                                skill_container["weapon_true"] = True
                                
                            if "buff_id" in arg_list:
                                buff_ids = arg_list["buff_id"]
                                if not isinstance(buff_ids, list): buff_ids = [buff_ids]

                                for buff_id in buff_ids:
                                    buff_key = f"buff_{buff_id}"
                                    if buff_key in buff_effects_data:
                                        for buff_effect in buff_effects_data[buff_key].get("effect_list", []):
                                            if not isinstance(buff_effect, dict): continue
                                            buff_arg_list = buff_effect.get("arg_list", {})
                                            if not isinstance(buff_arg_list, dict): continue
                                            
                                            if "weapon_id" in buff_arg_list:
                                                skill_container["weapon_true"] = True
                                                
                                            attached_skill_ids = []
                                            if "skill_id" in buff_arg_list:
                                                s_ids = buff_arg_list["skill_id"]
                                                attached_skill_ids.extend(s_ids if isinstance(s_ids, list) else [s_ids])
                                            if "skill_id_list" in buff_arg_list:
                                                s_ids_list = buff_arg_list["skill_id_list"]
                                                attached_skill_ids.extend(s_ids_list if isinstance(s_ids_list, list) else [s_ids_list])

                                            for attached_skill_id in attached_skill_ids:
                                                attached_skill_key = f"skill_{attached_skill_id}"
                                                if attached_skill_key in skill_effects_data:
                                                    # Check if the attached skill itself has a weapon_id
                                                    for attached_effect in skill_effects_data[attached_skill_key].get("effect_list", []):
                                                        if isinstance(attached_effect, dict) and "weapon_id" in attached_effect.get("arg_list", {}):
                                                            skill_container["weapon_true"] = True
                                                            
                                                            # Create the info object with firing data
                                                            attached_info = {"id": attached_skill_id}
                                                            if "quota" in buff_arg_list:
                                                                attached_info["quota"] = buff_arg_list["quota"]
                                                            if "time" in buff_arg_list:
                                                                attached_info["time"] = buff_arg_list["time"]

                                                            if attached_info not in skill_container["attached_weapon_skill_id"]:
                                                                skill_container["attached_weapon_skill_id"].append(attached_info)
                
                if not skill_container["attached_weapon_skill_id"]:
                    skill_container.pop("attached_weapon_skill_id", None)
        
        print("Skill processing complete.")

        # --- PART 5: Save the Final Data ---
        os.makedirs(os.path.dirname(output_filename), exist_ok=True)
        with open(output_filename, 'w', encoding='utf-8') as f:
            json.dump(filtered_ships, f, ensure_ascii=False, indent=4)
            
        print(f"\n✅ Success! Final enriched data has been saved to '{output_filename}'")
        print(f"File saved at: {os.path.abspath(output_filename)}")

    except requests.exceptions.RequestException as e: print(f"❌ Error fetching data: {e}")
    except json.JSONDecodeError as e: print(f"❌ Error: Failed to decode JSON. {e}")
    except Exception as e: print(f"❌ An unexpected error occurred: {e}")

# --- Main execution ---
if __name__ == "__main__":
    SHIP_URL = "https://raw.githubusercontent.com/Fernando2603/AzurLane/refs/heads/main/ship.json"
    GROUP_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/ShareCfg/ship_data_group.json"
    STATS_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/sharecfgdata/ship_data_statistics.json"
    SP_WEAPON_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/sharecfgdata/spweapon_data_statistics.json"
    TRANSFORM_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/ShareCfg/transform_data_template.json"
    SKILL_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/GameCfg/skill.json"
    BUFF_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/GameCfg/buff.json"
    SHIP_DROPS_FILE = "./helper/ship_drops.json"
    OUTPUT_FILE = "./output/ship_info_data.json"

    process_ship_data(SHIP_URL, GROUP_URL, STATS_URL, SP_WEAPON_URL, TRANSFORM_URL, SKILL_URL, BUFF_URL, SHIP_DROPS_FILE, OUTPUT_FILE)