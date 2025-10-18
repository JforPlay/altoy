import json

def create_merged_ship_data(ship_drops_file, ship_info_file):
    """
    Merges and transforms ship data from two JSON files based on new rules.

    Args:
        ship_drops_file (str): Path to the ship_drops.json file.
        ship_info_file (str): Path to the ship_info_data.json file.

    Returns:
        list: A list of dictionaries with the processed ship data.
    """
    with open(ship_drops_file, 'r', encoding='utf-8') as f:
        ship_drops_data = json.load(f)

    with open(ship_info_file, 'r', encoding='utf-8') as f:
        ship_info_data = json.load(f)

    # Create a dictionary for quick timer lookups from ship_drops_data
    ship_drops_map = {
        details['id']: details.get('timer') 
        for _, details in ship_drops_data.items() if 'id' in details
    }

    merged_data = []
    for info in ship_info_data:
        ship_id = info.get("id")
        if not ship_id:
            continue

        # Initialize build types
        light_build = False
        medium_build = False
        heavy_build = False
        limited_build = False
        
        description_text = "".join(info.get("description", []))

        # 1. Check for build types
        if "소형함 건조" in description_text:
            light_build = True
        if "중형함 건조" in description_text:
            medium_build = True
        if "특형함 건조" in description_text:
            heavy_build = True
            
        # 3. Check for "limited" status
        is_limited_event = "한정" in description_text
        if is_limited_event and not (light_build or medium_build or heavy_build):
            limited_build = True

        merged_ship = {
            # Field from ship_drops.json
            "timer": ship_drops_map.get(ship_id),
            
            # Fields from ship_info_data.json
            "id": info.get("id"),
            "gid": info.get("gid"),
            "rarity": info.get("rarity"),
            "nationality": info.get("nationality"),
            "type": info.get("type"),
            "shipyard": info.get("shipyard"),
            "name": info.get("name"),

            # Newly generated fields
            "light": light_build,
            "medium": medium_build,
            "heavy": heavy_build,
            "limited": limited_build,
        }
        merged_data.append(merged_ship)
            
    return merged_data

if __name__ == "__main__":
    # Define file paths
    ship_drops_filename = 'ship_drops.json'
    ship_info_filename = './output/ship_info_data.json'
    output_filename = './output/ship_const_data.json'

    # Create the merged data
    merged_list = create_merged_ship_data(ship_drops_filename, ship_info_filename)

    # Write the merged data to a new JSON file
    with open(output_filename, 'w', encoding='utf-8') as f:
        json.dump(merged_list, f, indent=4, ensure_ascii=False)

    print(f"Successfully processed and merged data into '{output_filename}'")