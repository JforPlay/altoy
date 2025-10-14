import json
import os
import requests

def process_final_skills(input_filename, skill_url, output_filename):
    """
    Reads the weapon_sim_data, cleans up the skill-related objects,
    enriches them with details from the main skill data file, and
    saves them into a new, flattened dictionary.
    """
    try:
        # Step 1: Read the local weapon simulation data
        print(f"Reading data from '{input_filename}'...")
        with open(input_filename, 'r', encoding='utf-8') as f:
            weapon_sim_data = json.load(f)

        # Step 2: Fetch the main skill data from the URL
        print(f"Fetching skill details from {skill_url}...")
        response = requests.get(skill_url)
        response.raise_for_status()
        skill_details_map = response.json()
        
        print("Data loaded. Processing and creating final skill dictionary...")
        
        final_skill_dictionary = {}
        
        # --- Helper function to enrich a skill object ---
        def enrich_and_add_skill(skill_obj, skill_id):
            if not skill_id:
                return
            
            skill_lookup_key = f"skill_{skill_id}"
            if skill_lookup_key in skill_details_map:
                skill_details = skill_details_map[skill_lookup_key]
                
                # MODIFICATION: Check for fields '1' and '10', otherwise get 'effect_list'
                if "1" in skill_details and "10" in skill_details:
                    if "1" in skill_details: skill_obj["1"] = skill_details["1"]
                    if "10" in skill_details: skill_obj["10"] = skill_details["10"]
                elif "effect_list" in skill_details:
                    skill_obj["effect_list"] = skill_details["effect_list"]
                if "aniEffect" in skill_details: skill_obj["aniEffect"] = skill_details["aniEffect"]

            final_skill_dictionary[skill_id] = skill_obj

        # Step 3: Iterate through each ship to process its skills
        for ship in weapon_sim_data:
            # Process 'skill' objects
            if 'skill' in ship and isinstance(ship.get('skill'), dict):
                for skill_key, skill_obj in ship['skill'].items():
                    skill_obj.pop('parent', None); skill_obj.pop('upgrade', None); skill_obj.pop('downgrade', None)
                    if 'id' in skill_obj: skill_obj['skill_id'] = skill_obj.pop('id')
                    enrich_and_add_skill(skill_obj, skill_obj.get('skill_id'))

            # Process 'retrofit' object
            if 'retrofit' in ship and isinstance(ship.get('retrofit'), dict):
                retrofit_obj = ship['retrofit']
                retrofit_obj.pop('id', None); retrofit_obj.pop('skill', None); retrofit_obj.pop('skin', None)
                enrich_and_add_skill(retrofit_obj, retrofit_obj.get('skill_id'))
            
            # Process 'sp_weapon' object
            if 'sp_weapon' in ship and isinstance(ship.get('sp_weapon'), dict):
                sp_weapon_obj = ship['sp_weapon']
                skill_id = None
                if 'skill_upgrade' in sp_weapon_obj:
                    try:
                        skill_id = sp_weapon_obj.pop('skill_upgrade')[0][1]
                        sp_weapon_obj['skill_id'] = skill_id
                    except (IndexError, TypeError, KeyError): pass
                enrich_and_add_skill(sp_weapon_obj, skill_id)

        # Step 4: Save the new dictionary to the output file
        with open(output_filename, 'w', encoding='utf-8') as f:
            json.dump(final_skill_dictionary, f, ensure_ascii=False, indent=4)
            
        print(f"\n✅ Success! Final skill dictionary saved to '{output_filename}'")
        print(f"File saved at: {os.path.abspath(output_filename)}")

    except FileNotFoundError as e:
        print(f"❌ Error: A required input file was not found: {e.filename}")
    except requests.exceptions.RequestException as e:
        print(f"❌ Error fetching skill data from URL: {e}")
    except Exception as e:
        print(f"❌ An unexpected error occurred: {e}")

# --- Main execution ---
if __name__ == "__main__":
    INPUT_FILE = "./output/weapon_sim_data.json"
    SKILL_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/GameCfg/skill.json"
    OUTPUT_FILE = "./output/skill_weapon_data.json"

    process_final_skills(INPUT_FILE, SKILL_URL, OUTPUT_FILE)