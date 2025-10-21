import json
import requests
import sys
import os

POOL_DATA_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/ShareCfg/activity_ship_create.json"
SHIP_INFO_LOCAL_PATH = os.path.join("./output", "ship_info_data.json")

# The specific construction pools we want to process
POOLS_TO_PROCESS = ["1", "2", "3"]

def fetch_json_data(url):
    """
    Fetches and parses JSON data from a given URL.
    """
    try:
        response = requests.get(url)
        response.raise_for_status() 
        return response.json()
    except requests.exceptions.HTTPError as http_err:
        print(f"HTTP error occurred while fetching {url}: {http_err}", file=sys.stderr)
    except requests.exceptions.RequestException as req_err:
        print(f"An error occurred while fetching {url}: {req_err}", file=sys.stderr)
    return None

def load_local_json_data(local_path):
    """
    Loads and parses JSON data from a local file path.
    """
    try:
        with open(local_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Error: The file was not found at {local_path}", file=sys.stderr)
    except json.JSONDecodeError:
        print(f"Error: Failed to decode JSON from {local_path}. File might be corrupt.", file=sys.stderr)
    except Exception as e:
        print(f"An unexpected error occurred while reading {local_path}: {e}", file=sys.stderr)
    return None

def build_database():
    """
    Fetches, processes, and builds the new ship database
    by matching pickup_list IDs to the 'sid' field in the local file.
    """
    print(f"Fetching pool data from: {POOL_DATA_URL}")
    pool_data = fetch_json_data(POOL_DATA_URL)
    
    print(f"Loading ship info from local file: {SHIP_INFO_LOCAL_PATH}")
    ship_info = load_local_json_data(SHIP_INFO_LOCAL_PATH)

    if not pool_data or not ship_info:
        print("Failed to load necessary data. Exiting.", file=sys.stderr)
        return

    print("Building 'sid' lookup map for faster processing...")
    sid_to_ship_map = {}
    
    if not isinstance(ship_info, list):
        print(f"Error: {SHIP_INFO_LOCAL_PATH} is not a dictionary. Exiting.", file=sys.stderr)
        return

    # Iterate through the *values* of the main ship_info dictionary
    for ship_data in ship_info:
        if isinstance(ship_data, dict) and 'sid' in ship_data:
            sid = ship_data['sid'] # This is an integer
            sid_to_ship_map[sid] = ship_data
        else:
            print(f"Warning: Skipping an item in ship_info; it's not a valid ship dictionary or lacks a 'sid' field.", file=sys.stderr)
    print(f"Lookup map built with {len(sid_to_ship_map)} entries.")

    print("Building new database...")
    new_database = {}

    for pool_id in POOLS_TO_PROCESS:
        if pool_id not in pool_data:
            print(f"Warning: Pool ID '{pool_id}' not found in pool data. Skipping.", file=sys.stderr)
            continue
        
        new_database[pool_id] = {}
        
        # This is a list of integers, e.g., [100001, 102091, ...]
        pickup_list = pool_data[pool_id].get('pickup_list', [])
        
        if not pickup_list:
            print(f"Note: Pool ID '{pool_id}' has an empty pickup_list.", file=sys.stderr)
            continue

        for ship_id in pickup_list: # ship_id is an integer
            
            # Check if this integer ID exists as a key in our new map
            if ship_id in sid_to_ship_map:
                original_ship_data = sid_to_ship_map[ship_id]
                
                # Extract the required fields
                new_ship_entry = {
                    "name": original_ship_data.get("name"),
                    "rarity": original_ship_data.get("rarity")
                }
                
                # Process the shipyard URL to create the icon URL
                shipyard_url = original_ship_data.get("shipyard")
                if shipyard_url and isinstance(shipyard_url, str):
                    new_ship_entry["icon"] = shipyard_url.replace("shipyard.png", "icon.png")
                else:
                    new_ship_entry["icon"] = None 
                
                # Use the ship_id (as a string) as the key in our *new* database
                new_database[pool_id][str(ship_id)] = new_ship_entry
            
            else:
                print(f"Warning: Ship ID '{ship_id}' from pool '{pool_id}' not found in {SHIP_INFO_LOCAL_PATH} using 'sid' field. Skipping.", file=sys.stderr)

    output_filename = "./output/ship_database.json"
    try:
        with open(output_filename, 'w', encoding='utf-8') as f:
            json.dump(new_database, f, ensure_ascii=False, indent=4)
        print(f"\nSuccessfully built database and saved to '{output_filename}'")
        
    except IOError as io_err:
        print(f"Error writing file {output_filename}: {io_err}", file=sys.stderr)

if __name__ == "__main__":
    build_database()