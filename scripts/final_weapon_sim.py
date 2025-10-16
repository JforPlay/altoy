import json
import os
import requests
import copy

def process_final_skills(input_filename, skill_url, output_filename):
    """
    Reads the weapon_sim_data, cleans up skill objects, and enriches them
    by aggregating all related skill effects, injecting buff-related firing data
    (`quota`, `time`) directly into the effects.
    """
    try:
        # Step 1: Read and fetch data
        print(f"Reading data from '{input_filename}'...")
        with open(input_filename, 'r', encoding='utf-8') as f:
            weapon_sim_data = json.load(f)

        print(f"Fetching skill details from {skill_url}...")
        response = requests.get(skill_url)
        response.raise_for_status()
        skill_details_map = response.json()
        
        print("Data loaded. Processing and creating final skill dictionary...")
        
        final_skill_dictionary = {}
        
        def enrich_and_add_skill(skill_obj, original_skill_id):
            if not original_skill_id:
                return

            # Step A: Gather all skill IDs and their associated data
            all_skill_info_to_process = [{"id": original_skill_id}] # Start with the base skill
            if 'attached_weapon_skill_id' in skill_obj and isinstance(skill_obj['attached_weapon_skill_id'], list):
                all_skill_info_to_process.extend(skill_obj['attached_weapon_skill_id'])
            
            aggregated_lv1_effects = []
            aggregated_lv10_effects = []
            
            # Step B: Iterate through all skill info objects and aggregate their effects
            for skill_info in all_skill_info_to_process:
                if not isinstance(skill_info, dict): continue

                lookup_id = skill_info.get("id")
                if not lookup_id: continue

                quota = skill_info.get("quota")
                time = skill_info.get("time")
                
                skill_lookup_key = f"skill_{lookup_id}"
                if skill_lookup_key in skill_details_map:
                    skill_details = skill_details_map[skill_lookup_key]
                    
                    lv1_effects_orig, lv10_effects_orig = None, None

                    # Extract lv1 and lv10 effects
                    if "1" in skill_details and isinstance(skill_details.get("1"), dict):
                        lv1_effects_orig = skill_details["1"].get("effect_list")
                    if "10" in skill_details and isinstance(skill_details.get("10"), dict):
                        lv10_effects_orig = skill_details["10"].get("effect_list")
                    
                    # Fallback for skills with only a top-level effect_list
                    if not lv1_effects_orig and not lv10_effects_orig and isinstance(skill_details.get("effect_list"), list):
                        lv1_effects_orig = skill_details.get("effect_list")

                    # If only lv1 exists, use it for lv10 as well
                    if lv1_effects_orig and not lv10_effects_orig:
                        lv10_effects_orig = lv1_effects_orig
                    
                    # Make deep copies to prevent modifying shared lists or original data
                    lv1_effects_copy = copy.deepcopy(lv1_effects_orig) if lv1_effects_orig else []
                    lv10_effects_copy = copy.deepcopy(lv10_effects_orig) if lv10_effects_orig else []

                    # Inject quota and time if they exist for this attached skill
                    if quota is not None or time is not None:
                        for effect in lv1_effects_copy:
                            if isinstance(effect, dict):
                                if quota is not None: effect['quota'] = quota
                                if time is not None: effect['time'] = time
                        for effect in lv10_effects_copy:
                            if isinstance(effect, dict):
                                if quota is not None: effect['quota'] = quota
                                if time is not None: effect['time'] = time
                    
                    # Add the processed effects to the aggregate lists
                    aggregated_lv1_effects.extend(lv1_effects_copy)
                    aggregated_lv10_effects.extend(lv10_effects_copy)
                    
                    # Grab aniEffect from any of the processed skills that has it
                    if "aniEffect" in skill_details:
                        skill_obj["aniEffect"] = skill_details["aniEffect"]

            # Step C: Clean up the original object and add the new aggregated lists
            skill_obj.pop("1", None)
            skill_obj.pop("10", None)
            skill_obj.pop("effect_list", None)

            if aggregated_lv1_effects:
                skill_obj["1"] = {"effect_list": aggregated_lv1_effects}
            if aggregated_lv10_effects:
                skill_obj["10"] = {"effect_list": aggregated_lv10_effects}

            final_skill_dictionary[original_skill_id] = skill_obj

        # Step 3: Iterate through ships and process each skill type
        for ship in weapon_sim_data:
            if 'skill' in ship and isinstance(ship.get('skill'), dict):
                for skill_key, skill_obj in ship['skill'].items():
                    skill_obj.pop('parent', None); skill_obj.pop('upgrade', None); skill_obj.pop('downgrade', None)
                    if 'id' in skill_obj: skill_obj['skill_id'] = skill_obj.pop('id')
                    enrich_and_add_skill(skill_obj, skill_obj.get('skill_id'))

            if 'retrofit' in ship and isinstance(ship.get('retrofit'), dict):
                retrofit_obj = ship['retrofit']
                retrofit_obj.pop('id', None); retrofit_obj.pop('skill', None); retrofit_obj.pop('skin', None)
                enrich_and_add_skill(retrofit_obj, retrofit_obj.get('skill_id'))
            
            if 'sp_weapon' in ship and isinstance(ship.get('sp_weapon'), dict):
                sp_weapon_obj = ship['sp_weapon']
                skill_id = None
                if 'skill_upgrade' in sp_weapon_obj:
                    try:
                        skill_id = sp_weapon_obj.pop('skill_upgrade')[0][1]
                        sp_weapon_obj['skill_id'] = skill_id
                    except (IndexError, TypeError, KeyError): pass
                enrich_and_add_skill(sp_weapon_obj, skill_id)

        # Step 4: Save the final dictionary
        os.makedirs(os.path.dirname(output_filename), exist_ok=True)
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