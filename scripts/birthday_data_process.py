import json
import os

# --- Configuration ---
BIRTHDAY_FILE = './helper/birthday_all.json'
GROUP_FILE = './output/ship_group_data.json'
OUTPUT_FILE = './output/shipgirl_birthday_data.json'
FIELDS_TO_REMOVE = ["입수\n점수", "풀돌\n점수", "120\n점수"]
# ---------------------

def load_json_file(filename):
    """Safely loads a JSON file with UTF-8 encoding."""
    if not os.path.exists(filename):
        print(f"Error: File not found: {filename}")
        return None
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON from {filename}: {e}")
        return None
    except Exception as e:
        print(f"An error occurred while reading {filename}: {e}")
        return None

def process_data():
    """Main function to process and unify the ship data."""
    
    # 1. Load data
    birthday_data = load_json_file(BIRTHDAY_FILE)
    group_data = load_json_file(GROUP_FILE)

    if birthday_data is None or group_data is None:
        print("Aborting due to file loading errors.")
        return

    print("Successfully loaded both JSON files.")

    # 2. Filter birthday_all.json (Scheme 1)
    # Keep only entries that do NOT have all three date fields as null.
    cleaned_data = []
    for ship in birthday_data:
        if not (ship.get("연") is None and ship.get("월") is None and ship.get("일") is None):
            cleaned_data.append(ship)
            
    print(f"Filtered {len(birthday_data)} entries down to {len(cleaned_data)}.")

    # 3. Remove score fields from the cleaned list (Scheme 2)
    for ship in cleaned_data:
        for field in FIELDS_TO_REMOVE:
            ship.pop(field, None)
            
    print("Removed score fields.")

    # 4. Create a lookup map from ship_group_data for efficient matching (Scheme 3)
    # This map allows us to find ships by name in O(1) time instead of a slow nested loop.
    name_to_group_map = {}
    for group_id, data in group_data.items():
        name = data.get("name")
        if name:
            # Store the (id, icon) tuple, keyed by the trimmed name
            name_to_group_map[name.strip()] = (group_id, data.get("icon"))

    # 5. Iterate and unify data (Scheme 3, 4, 5, 6)
    mismatched_names = []
    print("Matching data from ship_group_data...")

    for ship in cleaned_data:
        found_match = False
        birthday_name = ship.get("룽섭 이름")

        # Scheme 3 & 4: Try to match by "룽섭 이름" (trimmed)
        if birthday_name:
            match = name_to_group_map.get(birthday_name.strip())
            if match:
                ship["group_id"] = match[0]  # The key from ship_group_data
                ship["icon"] = match[1]      # The icon URL
                found_match = True

        # Scheme 5: If name match failed, try to match by "check" field
        if not found_match:
            check_id = ship.get("check")
            if check_id and check_id in group_data:
                ship["group_id"] = check_id
                ship["icon"] = group_data[check_id].get("icon")
                found_match = True

        # Scheme 6: If all matches failed, log the mismatch
        if not found_match and birthday_name:
            mismatched_names.append(birthday_name)

    # 6. Save the final unified JSON (Scheme 7)
    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(cleaned_data, f, ensure_ascii=False, indent=4)
        print(f"\nSuccessfully created unified file: {OUTPUT_FILE}")
    except Exception as e:
        print(f"Error writing to output file: {e}")

    # 7. Print any mismatches (Scheme 6)
    if mismatched_names:
        print("\n--- Mismatched Names (Could Not Find in ship_group_data) ---")
        for name in mismatched_names:
            print(name)
    else:
        print("\n--- All names matched successfully! ---")

if __name__ == "__main__":
    process_data()