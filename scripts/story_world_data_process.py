import requests
import json
import re # Import the regular expression module

# URLs for the data sources
URL_RECORD_GROUP = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/ShareCfg/world_collection_record_group.json"
URL_RECORD_TEMPLATE = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/ShareCfg/world_collection_record_template.json"
LOCAL_STORY_PATH = "story.json"
URL_NAME_CODE = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/name_code.json"
LOCAL_SHIPGIRL_DATA_PATH = "./output/story-viewer/shipgirl_data.json"
LOCAL_DUNGEON_PATH = "dungeon.json"
FIELDS_TO_REMOVE = ["hidePaintObj", "typewriter", "portrait", "expression", "painting"]

def fetch_json_data(url):
    """Fetches JSON data from a given URL."""
    response = requests.get(url)
    response.raise_for_status()  # Raise an exception for bad status codes
    return response.json()

def load_local_json_data(filepath):
    """Loads JSON data from a local file path."""
    with open(filepath, 'r', encoding='utf-8') as f:
        return json.load(f)

def clean_script_fields(scripts, fields_to_remove):
    """Removes noisy fields from script items."""
    for script_item in scripts:
        if isinstance(script_item, dict):
            for field in fields_to_remove:
                script_item.pop(field, None)

def get_story_from_story_json(story_key, story_data):
    """Return cleaned story payload from story.json if present."""
    payload = story_data.get(str(story_key).lower())
    if payload and isinstance(payload, dict) and 'scripts' in payload:
        clean_script_fields(payload['scripts'], FIELDS_TO_REMOVE)
    return payload

def collect_dungeon_story_ids(dungeon_data, story_key):
    """Collect story IDs from a dungeon entry (beginStoy + wave trigger ids)."""
    ids = []
    dungeon_entry = dungeon_data.get(str(story_key))
    if not dungeon_entry or not isinstance(dungeon_entry, dict):
        return ids

    begin_story = dungeon_entry.get("beginStoy")
    if begin_story and isinstance(begin_story, str):
        ids.append(begin_story)

    stages = dungeon_entry.get("stages", [])
    for stage in stages:
        if not isinstance(stage, dict):
            continue
        for wave in stage.get("waves", []):
            if (
                isinstance(wave, dict)
                and isinstance(wave.get("triggerParams"), dict)
                and "id" in wave["triggerParams"]
            ):
                ids.append(str(wave["triggerParams"]["id"]))
    return ids

def build_story_from_dungeon(dungeon_data, story_data, story_key):
    """Assemble combined scripts from a dungeon definition."""
    ids = collect_dungeon_story_ids(dungeon_data, story_key)
    combined_scripts = []
    for sid in ids:
        payload = get_story_from_story_json(sid, story_data)
        if payload and isinstance(payload, dict):
            combined_scripts.extend(payload.get("scripts", []))
    if combined_scripts:
        return {"scripts": combined_scripts}
    return None

# Helper function for recursive name code replacement and shipgirl ID lookup
def replace_name_codes_recursive(data, name_code_dict, shipgirl_data):
    """Recursively finds and replaces name codes and performs shipgirl ID lookup."""
    if isinstance(data, dict):
        for key, value in data.items():
            if isinstance(value, str):
                # Use regex to find all name codes in the text
                matches = re.findall(r"\{namecode:(\d+)\}", value)
                if matches:
                    # Assume only one namecode per string for simplicity, or modify as needed
                    code = matches[0]
                    # Look up the name in the name_code_dict
                    name = name_code_dict.get(code, f"UnknownNameCode:{code}") # Provide a fallback
                    # Replace the namecode with the fetched name
                    updated_value = value.replace(f"{{namecode:{code}}}", name)

                    # Check if the key is 'actor' or 'actorName' and perform shipgirl ID lookup
                    if key in ["actor", "actorName"]:
                        # Find the key in shipgirl_data that has this name and replace with the key (ID)
                        found_id = None
                        for shipgirl_id, shipgirl_info in shipgirl_data.items():
                            if isinstance(shipgirl_info, dict) and shipgirl_info.get("name") == name:
                                found_id = shipgirl_id
                                break # Found the match

                        if found_id:
                            data[key] = str(found_id) # Replace with string ID
                        else:
                            data[key] = updated_value # Keep the name if ID not found
                    else:
                        data[key] = updated_value # Update the value with replaced name
                else:
                    data[key] = replace_name_codes_recursive(value, name_code_dict, shipgirl_data) # Continue recursion if no namecode found
            else:
                data[key] = replace_name_codes_recursive(value, name_code_dict, shipgirl_data) # Continue recursion for non-string values

    elif isinstance(data, list):
        data[:] = [replace_name_codes_recursive(item, name_code_dict, shipgirl_data) for item in data]
    # elif isinstance(data, str): # This case is now handled within the dict processing for efficiency
    #     pass # Already processed in the dictionary case
    return data


try:
    # Fetch data from URLs
    record_group_data = fetch_json_data(URL_RECORD_GROUP)
    record_template_data = fetch_json_data(URL_RECORD_TEMPLATE)
    story_data = load_local_json_data(LOCAL_STORY_PATH)
    dungeon_data = load_local_json_data(LOCAL_DUNGEON_PATH)
    name_code_data = fetch_json_data(URL_NAME_CODE) # Fetch name_code data
    shipgirl_data = load_local_json_data(LOCAL_SHIPGIRL_DATA_PATH) # Load local shipgirl_data


    # Create a name code mapping dictionary
    name_code_dict = {key: value.get("name") for key, value in name_code_data.items()}


    processed_record_data = {}

    def process_template_entry(template_key, template_info):
        """Return a processed template dict with story data attached."""
        if not isinstance(template_info, dict):
            return None

        entry = json.loads(json.dumps(template_info))  # deep copy to avoid mutating source

        story_key = entry.get("story")
        if story_key:
            fetched_story_data = get_story_from_story_json(story_key, story_data)
            if not fetched_story_data:
                fetched_story_data = build_story_from_dungeon(dungeon_data, story_data, story_key)

            entry["story"] = fetched_story_data if fetched_story_data else f"Story data not found for key: {story_key}"
        else:
            entry["story"] = "Invalid or missing 'story' field"

        return entry

    # Iterate through world_collection_record_group.json
    for group_key, group_info in record_group_data.items():
        # Ignore the key "all"
        if group_key == "all":
            continue

        # Check if group_info is a dictionary and has a "child" field which is a list
        if isinstance(group_info, dict) and 'child' in group_info and isinstance(group_info['child'], list):
            processed_child_list = []
            # Iterate through the elements in the "child" field
            for child_id in group_info['child']:
                # Use child_id as the key to fetch info from world_collection_record_template.json
                child_id_str = str(child_id) # Ensure key is string for lookup
                if child_id_str in record_template_data:
                    processed_entry = process_template_entry(child_id_str, record_template_data[child_id_str])
                    processed_child_list.append(processed_entry if processed_entry else f"Invalid template for ID: {child_id}")
                else:
                    # If ID not found in template, add a placeholder or the original ID
                    processed_child_list.append(f"ID not found in template: {child_id}") # Or just child_id

            # Add the processed child list to the processed_record_data with the original group_key
            processed_record_data[group_key] = {
                "name": group_info.get("name_abbreviate"), # Include the name from group_info
                "child": processed_child_list
                }
        # Optionally handle cases where 'child' is missing or not a list
        # else:
            # print(f"Skipping group_key {group_key}: 'child' field missing or not a list.")

    # Apply name code replacement and shipgirl ID lookup to the entire processed_record_data
    processed_record_data = replace_name_codes_recursive(processed_record_data, name_code_dict, shipgirl_data)


    print("Processed record data created by merging group, template, and story information and applying name code replacements.")
    # Optionally display the first few entries of the processed data
    # import pprint
    # pprint.pprint(list(processed_record_data.items())[:5])

    # Optionally, save the processed data to a JSON file
    with open('./output/story-viewer/world_story_data.json', 'w', encoding='utf-8') as f:
        json.dump(processed_record_data, f, ensure_ascii=False, indent=4)

    print("\nProcessed data successfully saved to './output/story-viewer/world_story_data.json'")


except requests.exceptions.RequestException as e:
    print(f"Error fetching data: {e}")
except ValueError as e:
    print(f"Error parsing JSON: {e}")
except Exception as e:
    print(f"An error occurred: {e}")
