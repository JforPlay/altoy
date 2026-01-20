import requests
import json
import re
from collections import defaultdict

# --- 1. Define URLs ---
main_file_url = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/island_chara_template.json"
skill_file_url = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/island_chara_skill.json"
skin_file_url = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/island_skin_template.json"

# New: name_code.json URL
name_code_url = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/name_code.json"

try:
    # --- 2. Fetch all data ---
    print("Fetching data from URLs...")
    main_response = requests.get(main_file_url)
    skill_response = requests.get(skill_file_url)
    skin_response = requests.get(skin_file_url)
    name_code_response = requests.get(name_code_url)

    # Raise an error if any request failed
    main_response.raise_for_status()
    skill_response.raise_for_status()
    skin_response.raise_for_status()
    name_code_response.raise_for_status()

    # Parse the JSON content into Python dictionaries
    main_data = main_response.json()
    skill_data = skill_response.json()
    skin_data = skin_response.json()
    name_code_data = name_code_response.json()
    print("All data fetched and parsed successfully.")

    # --- 3. Build a skin lookup map for efficiency ---
    print("Building skin lookup map...")
    skin_map = defaultdict(list)
    
    # Iterate over all values in the skin_data dictionary
    for skin_info in skin_data.values():
        
        # Skip non-dict entries like "all"
        if not isinstance(skin_info, dict):
            continue
        
        # Get the ship_group ID, which we'll use to match
        ship_group_id = skin_info.get("ship_group")
        if ship_group_id:
            skin_map[ship_group_id].append(skin_info)
            
    print(f"Skin map built. Found skins for {len(skin_map)} ship groups.")

    # --- 3.5 Prepare regex for namecode pattern ---
    # Matches strings like "{namecode:199}"
    namecode_pattern = re.compile(r"{namecode:(\d+)}")

    # --- 4. Process the main character data ---
    print("Processing main character data...")
    processed_skills = 0
    characters_with_skins = 0
    replaced_namecodes = 0
    
    # Iterate through the main data (the sub-dictionaries)
    for chara_id_key, chara_template in main_data.items():
        
        # Skip the "all" key in the main file too, just to be safe
        if not isinstance(chara_template, dict):
            continue

        # === Part 0: Resolve namecode-based names to Korean ===
        raw_name = chara_template.get("name")
        if isinstance(raw_name, str):
            m = namecode_pattern.fullmatch(raw_name.strip())
            if m:
                code_id = m.group(1)  # "XXX" in {namecode:XXX}
                name_entry = name_code_data.get(code_id)
                if isinstance(name_entry, dict):
                    # Prefer "code" (looks like the Korean display name),
                    # fall back to "name" if needed.
                    new_name = name_entry.get("code") or name_entry.get("name")
                    if new_name:
                        chara_template["name"] = new_name
                        replaced_namecodes += 1

        # === Part 1: Process Skill ID (from previous request) ===
        if "skill_id" in chara_template and chara_template["skill_id"]:
            skill_id = chara_template["skill_id"]
            skill_key = str(skill_id)
            
            if skill_key in skill_data:
                # Get a copy, pop the effect, and replace the ID
                skill_info = skill_data[skill_key].copy()
                skill_info.pop("skill_effect", None)
                chara_template["skill_id"] = skill_info
                processed_skills += 1

        # === Part 2: Process Skins (new request) ===
        # Use the character's "id" to find the "ship_group" in the skin map
        chara_id = chara_template.get("id")
        
        if chara_id:
            # Use .get() to find skins, defaulting to an empty list []
            found_skins = skin_map.get(chara_id, [])
            chara_template["skin"] = found_skins
            
            if found_skins: 
                characters_with_skins += 1
        else:
            chara_template["skin"] = []

    print(f"Processing complete.")
    print(f"  - Replaced {processed_skills} skill_id fields.")
    print(f"  - Added skin lists for {characters_with_skins} characters.")
    print(f"  - Replaced {replaced_namecodes} name fields from {{namecode:XXX}} to Korean names.")

    # --- 5. Display or save the result ---
    
    # Option A: Print a sample of the modified data to verify
    sample_id = "10117"
    print(f"\n--- Sample of processed data (ID: {sample_id}) ---")
    if sample_id in main_data:
        print(json.dumps(main_data[sample_id], indent=2, ensure_ascii=False))
    else:
        print(f"Sample ID {sample_id} not found.")

    # Option B: Save the fully processed data to a new JSON file
    output_filename = "./output/island/characters.json"
    with open(output_filename, 'w', encoding='utf-8') as f:
        json.dump(main_data, f, indent=4, ensure_ascii=False)
        
    print(f"\nSuccessfully saved processed data to {output_filename}")

except requests.exceptions.RequestException as e:
    print(f"Error fetching data: {e}")
except json.JSONDecodeError:
    print("Error: Failed to decode JSON from one of the files.")
except Exception as e:
    print(f"An unexpected error occurred: {e}")
