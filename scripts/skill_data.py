import requests
import json

# ==============================================================================
# Part 1: Process Ship Data (Now takes a set of valid IDs as an argument)
# ==============================================================================
def process_ship_data(ship_url, stats_url, definitive_valid_skill_ids):
    print("\n--- Starting Part 3: Processing and Pruning Ship Data ---")
    ship_list_data = requests.get(ship_url).json()
    stats_data = requests.get(stats_url).json()

    processed_ships, retrofit_skill_ids = [], set()
    print("Mapping ship names, icons, and pruning skills...")

    for ship in ship_list_data:
        if not all(k in ship for k in ["sid", "gid", "skill"]): continue
        sid_list = ship["sid"]
        if not sid_list: continue

        lookup_id = str(sid_list[0])
        ship_name = stats_data.get(lookup_id, {}).get("name", "Unknown Name")
        ship_icon_url = f"https://raw.githubusercontent.com/Fernando2603/AzurLane/main/images/skin/{lookup_id}/icon.png"

        original_skills = ship["skill"]
        pruned_skills = {}
        for skill_id, details in original_skills.items():
            skill_id_int = int(details['id'])
            # A skill is kept only if it's a final upgrade AND its ID is in the definitive valid list
            if isinstance(details, dict) and details.get("upgrade") is None and skill_id_int in definitive_valid_skill_ids:
                pruned_skills[skill_id] = details
        
        # If no skills remain after this rigorous pruning, remove the ship.
        if not pruned_skills:
            continue

        # Separately identify all retrofit skills on this ship for later analysis
        for details in original_skills.values():
             if isinstance(details, dict) and details.get("requirement") == "Retrofit":
                retrofit_skill_ids.add(details['id'])

        processed_ships.append({
            "name": ship_name, "gid": ship["gid"], "skill": pruned_skills,
            "sid": ship["sid"], "icon": ship_icon_url
        })
    
    return processed_ships, retrofit_skill_ids

# ==============================================================================
# Part 2: Process detailed skill data
# ==============================================================================
def collect_weapon_effects(item_key, item_type, skill_data, buff_data, cache, visited_path):
    # This recursive helper function remains the same as before
    if item_key in cache: return cache[item_key]
    if item_key in visited_path: return []
    visited_path.add(item_key)
    data_source = skill_data if item_type == 'skill' else buff_data
    if item_key not in data_source or not isinstance(data_source.get(item_key), dict):
        visited_path.remove(item_key); cache[item_key] = []; return []
    item = data_source.get(item_key)
    all_weapon_effects = []
    if "effect_list" in item:
        for effect in item["effect_list"]:
            if isinstance(effect, dict):
                arg_list = effect.get("arg_list", {})
                if "weapon_id" in arg_list: all_weapon_effects.append(effect)
                if "buff_id" in arg_list: all_weapon_effects.extend(collect_weapon_effects(f"buff_{arg_list['buff_id']}", 'buff', skill_data, buff_data, cache, visited_path))
                if "skill_id" in arg_list: all_weapon_effects.extend(collect_weapon_effects(f"skill_{arg_list['skill_id']}", 'skill', skill_data, buff_data, cache, visited_path))
    visited_path.remove(item_key)
    cache[item_key] = all_weapon_effects
    return all_weapon_effects

def process_all_skills(template_data, skill_data, buff_data, skill_icon_data, ship_retrofit_ids):
    print("\n--- Starting Part 1: Processing All Detailed Skills ---")
    all_valid_skills = []
    collection_cache = {}
    fields_to_ignore = {"1", "2", "3", "4", "5", "6", "7", "8", "9", "name", "desc", "painting", "picture"}

    # First, get all skill IDs from template + retrofit skills to avoid redundant checks
    template_skill_ids = {info['id'] for info in template_data.values()}
    all_ids_to_check = template_skill_ids.union(ship_retrofit_ids)
    print(f"Found {len(all_ids_to_check)} unique skills to process (from template + retrofits).")

    for skill_id in all_ids_to_check:
        skill_lookup_key = f"skill_{skill_id}"
        found_weapon_effects = collect_weapon_effects(skill_lookup_key, 'skill', skill_data, buff_data, collection_cache, set())
        
        if found_weapon_effects:
            unique_effects = []
            seen_ids = set()
            for effect in found_weapon_effects:
                weapon_id = effect.get("arg_list", {}).get("weapon_id")
                if weapon_id is not None and weapon_id not in seen_ids:
                    unique_effects.append(effect); seen_ids.add(weapon_id)
            if not unique_effects: continue

            # Build the skill dictionary from the best available source
            base_info = template_data.get(str(skill_id)) or skill_data.get(skill_lookup_key, {})
            processed_skill = {k: base_info.get(k) for k in ["id", "name", "desc", "desc_get_add", "type"]}

            # Ensure ID is correct, as base_info might be from skill_data
            processed_skill['id'] = skill_id

            details_to_merge = skill_data.get(skill_lookup_key, {})
            for key, value in details_to_merge.items():
                if key not in fields_to_ignore: processed_skill[key] = value

            processed_skill["effect_list"] = unique_effects
            processed_skill["icon"] = skill_icon_data.get(str(skill_id), "N/A")
            all_valid_skills.append(processed_skill)

    return all_valid_skills

# ==============================================================================
# Main execution block
# ==============================================================================
if __name__ == "__main__":
    # URLs
    SHIP_LIST_URL = "https://raw.githubusercontent.com/Fernando2603/AzurLane/main/ship.json"
    SHIP_STATS_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/sharecfgdata/ship_data_statistics.json"
    TEMPLATE_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/skill_data_template.json"
    SKILL_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/GameCfg/skill.json"
    BUFF_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/GameCfg/buff.json"
    SKILL_ICON_URL = "https://raw.githubusercontent.com/Fernando2603/AzurLane/main/skill_icon.json"
    
    # Output filenames
    SHIP_OUTPUT_FILE = "./output/ship_data_weaponsim.json"
    SKILL_OUTPUT_FILE = "./output/skill_data_weaponsim.json"

    print("--- Initializing Data Fetch ---")
    template_data = requests.get(TEMPLATE_URL).json()
    skill_data = requests.get(SKILL_URL).json()
    buff_data = requests.get(BUFF_URL).json()
    skill_icon_data = requests.get(SKILL_ICON_URL).json()
    ship_list_data = requests.get(SHIP_LIST_URL).json()
    stats_data = requests.get(SHIP_STATS_URL).json()

    # --- Step 1: Preliminary scan of ship data to find all retrofit skills ---
    prelim_retrofit_ids = set()
    for ship in ship_list_data:
        for skill_details in ship.get("skill", {}).values():
            if isinstance(skill_details, dict) and skill_details.get("requirement") == "Retrofit":
                prelim_retrofit_ids.add(skill_details['id'])

    # --- Step 2: Process ALL skills to create the definitive list of valid skills ---
    final_skill_list = process_all_skills(template_data, skill_data, buff_data, skill_icon_data, prelim_retrofit_ids)
    definitive_valid_skill_ids = {skill['id'] for skill in final_skill_list}
    print(f"\nGenerated a definitive list of {len(definitive_valid_skill_ids)} valid skills.")
    with open(SKILL_OUTPUT_FILE, 'w', encoding='utf-8') as f: json.dump(final_skill_list, f, indent=4, ensure_ascii=False)
    print(f"Final skill data saved to '{SKILL_OUTPUT_FILE}'")

    # --- Step 3: Process ship data, using the definitive skill list for pruning ---
    final_ship_data, _ = process_ship_data(SHIP_LIST_URL, SHIP_STATS_URL, definitive_valid_skill_ids)
    with open(SHIP_OUTPUT_FILE, 'w', encoding='utf-8') as f: json.dump(final_ship_data, f, indent=4, ensure_ascii=False)
    print(f"Final ship data saved to '{SHIP_OUTPUT_FILE}'")

    print("\nAll processing complete!")