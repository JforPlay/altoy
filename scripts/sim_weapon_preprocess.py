import json
import os

def create_final_subset(input_filename, type_map_filename, skill_icon_map_filename, output_filename):
    """
    Reads full ship data, creates a final filtered and cleaned subset containing
    all necessary data for the weapon simulation.
    """
    try:
        # Step 1: Read all necessary data files
        print(f"Reading main data from '{input_filename}'...")
        with open(input_filename, 'r', encoding='utf-8') as f:
            full_data = json.load(f)

        print(f"Reading type mapping from '{type_map_filename}'...")
        with open(type_map_filename, 'r', encoding='utf-8') as f:
            type_map = json.load(f)

        print(f"Reading skill icon mapping from '{skill_icon_map_filename}'...")
        with open(skill_icon_map_filename, 'r', encoding='utf-8') as f:
            skill_icon_map = json.load(f)
        
        print("All data loaded. Creating final cleaned and filtered subset...")
        
        final_data = []
        
        # Define fields to remove during cleanup
        retrofit_keys_to_remove = ["level", "bonus", "armor", "hexagon"]
        sp_weapon_keys_to_remove = ["attribute_1", "attribute_2"]

        # Step 2: Process each ship in the original dataset
        for ship in full_data:
            ship_type = ship.get('type')
            type_key = str(ship_type)

            new_ship = {
                'gid': ship.get('gid'),
                'name': ship.get('name'),
                'type': ship_type,
                'shipyard': ship.get('shipyard'),
            }
            
            if type_key in type_map:
                new_ship['position'] = type_map[type_key].get('position')
                new_ship['icon'] = type_map[type_key].get('icon')

            # Filter skills, retrofit, and sp_weapon based on 'weapon_true'
            # The .copy() method ensures all fields, including 'attached_weapon_skill_id', are carried over.
            if 'skill' in ship and isinstance(ship.get('skill'), dict):
                filtered_skills = {
                    key: obj.copy() for key, obj in ship['skill'].items() 
                    if isinstance(obj, dict) and obj.get('weapon_true') is True
                }
                if filtered_skills:
                    new_ship['skill'] = filtered_skills

            if isinstance(ship.get('retrofit'), dict) and ship['retrofit'].get('weapon_true') is True:
                new_ship['retrofit'] = ship['retrofit'].copy()

            if isinstance(ship.get('sp_weapon'), dict) and ship['sp_weapon'].get('weapon_true') is True:
                new_ship['sp_weapon'] = ship['sp_weapon'].copy()
            
            # Continue only if the ship has at least one relevant weapon skill
            if 'skill' not in new_ship and 'retrofit' not in new_ship and 'sp_weapon' not in new_ship:
                continue

            # --- Perform cleanup and enrichment ---
            ship_name = new_ship.get('name')
            ship_position = new_ship.get('position')
            ship_yard = new_ship.get('shipyard')

            if 'skill' in new_ship:
                for skill_obj in new_ship['skill'].values():
                    skill_obj['name'] = ship_name
                    skill_obj['position'] = ship_position
                    skill_obj['shipyard'] = ship_yard
                    skill_id = str(skill_obj.get('id'))
                    if skill_id in skill_icon_map:
                        skill_obj['icon'] = skill_icon_map[skill_id]

            if 'retrofit' in new_ship:
                for key in retrofit_keys_to_remove:
                    new_ship['retrofit'].pop(key, None)
                new_ship['retrofit']['name'] = ship_name
                new_ship['retrofit']['position'] = ship_position
                new_ship['retrofit']['shipyard'] = ship_yard
                skill_id = str(new_ship['retrofit'].get('skill_id'))
                if skill_id in skill_icon_map:
                    new_ship['retrofit']['icon'] = skill_icon_map[skill_id]
            
            if 'sp_weapon' in new_ship:
                for key in sp_weapon_keys_to_remove:
                    new_ship['sp_weapon'].pop(key, None)
                new_ship['sp_weapon']['name'] = ship_name
                new_ship['sp_weapon']['position'] = ship_position
                new_ship['sp_weapon']['shipyard'] = ship_yard
                try:
                    skill_id = str(new_ship['sp_weapon']['skill_upgrade'][0][1])
                    if skill_id in skill_icon_map:
                        new_ship['sp_weapon']['icon'] = skill_icon_map[skill_id]
                except (IndexError, TypeError, KeyError):
                    pass
            
            final_data.append(new_ship)

        # Step 3: Save the final, cleaned, and enriched subset to a file
        os.makedirs(os.path.dirname(output_filename), exist_ok=True)

        with open(output_filename, 'w', encoding='utf-8') as f:
            json.dump(final_data, f, ensure_ascii=False, indent=4)
            
        print(f"\n✅ Success! Final data has been saved to '{output_filename}'")
        print(f"File saved at: {os.path.abspath(output_filename)}")

    except FileNotFoundError as e:
        print(f"❌ Error: A required input file was not found: {e.filename}")
        print("Please ensure all JSON files are in the correct directories.")
    except Exception as e:
        print(f"❌ An unexpected error occurred: {e}")

# --- Main execution ---
if __name__ == "__main__":
    INPUT_FILE = "./output/ship_info_data.json"
    TYPE_MAPPING_FILE = "./helper/ship_type_mapping.json"
    SKILL_ICON_MAPPING_FILE = "./output/skill_icon_mapping.json"
    OUTPUT_FILE = "./output/weapon_sim_data.json"
    
    create_final_subset(INPUT_FILE, TYPE_MAPPING_FILE, SKILL_ICON_MAPPING_FILE, OUTPUT_FILE)