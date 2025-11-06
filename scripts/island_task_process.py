import requests
import json
import sys

# --- Configuration ---
TASK_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/EN/ShareCfg/island_task.json"
TARGET_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/EN/ShareCfg/island_task_target.json"
OUTPUT_FILE = "./output/island/tasks.json"

def fetch_json_data(url):
    """Fetches and decodes JSON data from a given URL."""
    try:
        response = requests.get(url)
        # Raise an exception for bad status codes (like 404, 500)
        response.raise_for_status() 
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error: Failed to fetch data from {url}\n{e}", file=sys.stderr)
        return None
    except json.JSONDecodeError:
        print(f"Error: Failed to decode JSON from {url}", file=sys.stderr)
        return None

def process_task_data(task_data, target_lookup):
    """
    Processes the task data in-place, replacing 'target_id' lists
    with data from the target_lookup dictionary.
    """
    if not isinstance(task_data, dict):
        print("Error: Expected task_data to be a dictionary.", file=sys.stderr)
        return None

    # Iterate through each quest in the main dictionary
    # .values() gives us a view of the sub-dictionaries (the quests)
    for quest_info in task_data.values():
        if not isinstance(quest_info, dict):
            continue

        target_id_list = quest_info.get("target_id")

        # Check if 'target_id' is a list and has at least one element
        if isinstance(target_id_list, list) and len(target_id_list) > 0:
            # Get the first element and convert it to a string for lookup
            lookup_key = str(target_id_list[0])
            
            # Fetch the details from the target_lookup dictionary
            target_details = target_lookup.get(lookup_key)

            if target_details:
                # Replace the original 'target_id' list with the fetched dictionary
                quest_info["target_id"] = target_details
            else:
                # Optional: Log a warning if a key isn't found
                print(f"Warning: No target details found for key '{lookup_key}'", file=sys.stderr)
                
    return task_data

def main():
    print(f"Fetching main task data from {TASK_URL}...")
    task_data = fetch_json_data(TASK_URL)
    
    print(f"Fetching target lookup data from {TARGET_URL}...")
    target_lookup = fetch_json_data(TARGET_URL)

    # If either download failed, exit
    if task_data is None or target_lookup is None:
        print("Exiting due to data fetching errors.", file=sys.stderr)
        return

    print("Processing data...")
    processed_data = process_task_data(task_data, target_lookup)

    if processed_data:
        # Save the modified data to the output file
        try:
            with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
                # indent=4 makes the JSON file human-readable
                # ensure_ascii=False correctly handles any special characters
                json.dump(processed_data, f, indent=4, ensure_ascii=False)
            print(f"Successfully processed data and saved to {OUTPUT_FILE}")
        except IOError as e:
            print(f"Error: Failed to write to output file {OUTPUT_FILE}\n{e}", file=sys.stderr)

if __name__ == "__main__":
    main()