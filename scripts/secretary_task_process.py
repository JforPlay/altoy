import requests
import json
import re  # Import the regular expression module

# URLs for the data
TRIGGER_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/ShareCfg/task_data_trigger.json"
TEMPLATE_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/sharecfgdata/task_data_template.json"
NAME_CODE_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/name_code.json"  # New URL for name codes

# The specific fields you want to keep for the polished data
DESIRED_FIELDS = [
    "desc",
    "name",
    "next_task",
    "story_icon",
    "story_id",
    "sub_type",
    "target_id",
    "target_id_2"
]

# Regex to find {namecode:XXX}
NAME_CODE_REGEX = re.compile(r'{namecode:(\d+)}')

def fetch_json_data(url):
    """Fetches and parses JSON data from a given URL."""
    try:
        response = requests.get(url)
        response.raise_for_status()  # Raise an error for bad responses (4xx or 5xx)
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error fetching data from {url}: {e}")
        return None
    except json.JSONDecodeError:
        print(f"Error decoding JSON from {url}. Content might not be valid JSON.")
        return None

def replace_name_codes(text, name_codes):
    """
    Replaces {namecode:XXX} placeholders in a string with Korean names.
    """
    if not isinstance(text, str):
        return text  # Return non-string values as-is

    def replacer(match):
        code = match.group(1)  # This is the 'XXX' part
        # Check if the code exists in the name_codes dictionary
        if code in name_codes and "name" in name_codes[code]:
            return name_codes[code]["name"]
        else:
            print(f"Warning: Name code '{code}' not found in name_code.json. Keeping placeholder.")
            return match.group(0)  # Return the original placeholder if not found

    return NAME_CODE_REGEX.sub(replacer, text)

def process_tasks(trigger_data, template_data, name_code_data):
    """
    Processes tasks to create both polished subset data and shipgirl task groupings,
    replacing name codes in 'name' and 'desc' fields.
    """
    polished_data = {}
    shipgirl_task_groups = {}
    
    processed_task_ids_for_polishing = set()
    processed_trigger_starts = set()

    if not isinstance(trigger_data, dict):
        print("Error: Trigger data is not a dictionary.")
        return {}, {}
    
    print(f"Processing {len(trigger_data)} entries in trigger file...")

    for trigger_key, trigger_info in trigger_data.items():
        if not isinstance(trigger_info, dict):
            continue
            
        task_id = trigger_info.get("task_id")
        group_id = trigger_info.get("group_id")

        if not task_id or not str(group_id):
            continue

        if task_id in processed_trigger_starts:
            continue
            
        processed_trigger_starts.add(task_id)
        current_chain_tasks = []
        task_queue_for_this_chain = [task_id]
        processed_in_this_chain = set()

        while task_queue_for_this_chain:
            current_task_id = task_queue_for_this_chain.pop(0)
            
            if current_task_id in processed_in_this_chain:
                print(f"Warning: Detected loop in chain for group {group_id} at task {current_task_id}. Stopping this branch.")
                continue
                
            processed_in_this_chain.add(current_task_id)
            current_chain_tasks.append(current_task_id)
            
            task_key = str(current_task_id)
            next_task_id = None

            if task_key not in processed_task_ids_for_polishing:
                if task_key not in template_data:
                    print(f"Warning: Task ID '{task_key}' (from group {group_id}) not found in template file. Skipping.")
                    continue

                task_data = template_data[task_key]
                filtered_task = {}

                for field in DESIRED_FIELDS:
                    if field in task_data:
                        filtered_task[field] = task_data[field]
                
                # --- NEW: Replace name codes ---
                if "name" in filtered_task:
                    filtered_task["name"] = replace_name_codes(filtered_task["name"], name_code_data)
                
                if "desc" in filtered_task:
                    filtered_task["desc"] = replace_name_codes(filtered_task["desc"], name_code_data)
                # --- End of new code ---
                
                polished_data[task_key] = filtered_task
                next_task_id = filtered_task.get("next_task")
                processed_task_ids_for_polishing.add(task_key)
            else:
                next_task_id = polished_data.get(task_key, {}).get("next_task")

            if next_task_id not in ["0", None, ""]:
                task_queue_for_this_chain.append(next_task_id)

        if group_id not in shipgirl_task_groups:
            shipgirl_task_groups[group_id] = []
        
        shipgirl_task_groups[group_id].extend(current_chain_tasks)

    print("Cleaning up task groups...")
    cleaned_groups = {}
    for gid, task_list in shipgirl_task_groups.items():
        unique_tasks = []
        seen = set()
        for tid in task_list:
            if tid not in seen:
                unique_tasks.append(str(tid))
                seen.add(tid)
        cleaned_groups[gid] = unique_tasks

    return polished_data, cleaned_groups

def main():
    print(f"Fetching trigger data from {TRIGGER_URL}...")
    trigger_data = fetch_json_data(TRIGGER_URL)
    
    print(f"Fetching template data from {TEMPLATE_URL}...")
    template_data = fetch_json_data(TEMPLATE_URL)
    
    print(f"Fetching name code data from {NAME_CODE_URL}...")
    name_code_data = fetch_json_data(NAME_CODE_URL)  # Fetch the new file

    # Check if all three files were fetched successfully
    if trigger_data and template_data and name_code_data:
        print("Processing data...")
        # Pass the new name_code_data to the processing function
        polished_data, shipgirl_groups = process_tasks(trigger_data, template_data, name_code_data)

        output_filename_polished = "./output/story-viewer/secretary_task_data.json"
        output_filename_groups = "./output/story-viewer/secretary_task_groups.json"

        try:
            with open(output_filename_polished, "w", encoding="utf-8") as f:
                json.dump(polished_data, f, indent=4, ensure_ascii=False)
            print(f"\nSuccess! Polished data saved to {output_filename_polished}")
            print(f"Total polished tasks: {len(polished_data)}")
        except IOError as e:
            print(f"Error writing to file {output_filename_polished}: {e}")

        try:
            with open(output_filename_groups, "w", encoding="utf-8") as f:
                json.dump(shipgirl_groups, f, indent=4, ensure_ascii=False)
            print(f"\nSuccess! Shipgirl task groups saved to {output_filename_groups}")
            print(f"Total shipgirl groups found: {len(shipgirl_groups)}")
        except IOError as e:
            print(f"Error writing to file {output_filename_groups}: {e}")
            
    else:
        print("Failed to fetch one or more JSON files. Aborting.")

if __name__ == "__main__":
    main()