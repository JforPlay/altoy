import os
import json
import requests

# --- Configuration ---
ORBIT_DIR = 'assets/orbit'
JSON_URL = 'https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/ShareCfg/equip_skin_template.json'
OUTPUT_FILE = './output/skin/orbit_data.json'
# ---------------------

def get_orbit_structure(directory):
    """Gets all subdirectory names ending with 'ui' and their spine files."""
    print(f"Scanning for subdirectories in '{directory}'...")
    if not os.path.exists(directory):
        print(f"Error: Directory not found: '{directory}'")
        return None

    orbit_structure = {}
    try:
        for name in os.listdir(directory):
            if not name.endswith('ui'):
                continue
            dir_path = os.path.join(directory, name)
            if os.path.isdir(dir_path):
                files = os.listdir(dir_path)
                spine_bases = set()
                for f in files:
                    if f.endswith('.skel'):
                        spine_bases.add(f[:-5])
                
                if spine_bases:
                    orbit_structure[name] = sorted(list(spine_bases))

        print(f"Found {len(orbit_structure)} subdirectories with spine files.")
        return orbit_structure
    except Exception as e:
        print(f"Error reading directory '{directory}': {e}")
        return None

def fetch_json_data(url):
    """Fetches and parses JSON data from a URL."""
    print(f"Fetching remote JSON from {url}...")
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status() 
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error fetching data: {e}")
        return None

def find_matches(all_data, orbit_structure):
    """Finds all JSON entries that match a directory name and adds file info."""
    print("Finding matches and adding file info...")
    matched_items = {}
    
    remote_data_map = {}
    if isinstance(all_data, dict):
        for key, item in all_data.items():
            if isinstance(item, dict):
                orbit_name = item.get('orbit_combat')
                if orbit_name:
                    remote_data_map[orbit_name] = item

    for dir_name, spine_files in orbit_structure.items():
        lookup_name = dir_name[:-2] if dir_name.endswith('ui') else dir_name

        if lookup_name in remote_data_map:
            merged_item = remote_data_map[lookup_name].copy()
            merged_item['spine_files'] = spine_files
            matched_items[dir_name] = merged_item
            print(f"  > Match found and merged: {dir_name} (lookup: {lookup_name}), Files: {spine_files}")
        else:
            matched_items[dir_name] = {'orbit_combat': dir_name, 'spine_files': spine_files}
            print(f"  > Directory-only entry added: {dir_name}, Files: {spine_files}")

    return matched_items

def save_output_json(data, filename):
    """Saves the given data to a JSON file."""
    print(f"Saving {len(data)} items to '{filename}'...")
    try:
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print("Done!")
    except IOError as e:
        print(f"Error writing to file: {e}")

def main():
    orbit_structure = get_orbit_structure(ORBIT_DIR)
    if orbit_structure is None:
        return

    all_skin_data = fetch_json_data(JSON_URL)
    if all_skin_data is None:
        all_skin_data = {}

    matched_data = find_matches(all_skin_data, orbit_structure)

    if matched_data:
        save_output_json(matched_data, OUTPUT_FILE)
    else:
        print("No matches found. Output file was not created.")

if __name__ == "__main__":
    main()