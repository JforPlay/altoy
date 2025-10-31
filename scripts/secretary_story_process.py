import requests
import json
import os

# Define file names and URL
LOCAL_FILE_NAME = "./output/story-viewer/secretary_task_data.json"
STORY_URL = "story.json"
OUTPUT_FILE_NAME = "./output/story-viewer/secretary_story_data.json"

def load_local_json(filename):
    """Loads and parses JSON data from a local file."""
    print(f"Loading local data from {filename}...")
    if not os.path.exists(filename):
        print(f"Error: Local file '{filename}' not found.")
        print("Please ensure the file is in the same directory as the script.")
        return None
        
    try:
        with open(filename, "r", encoding="utf-8") as f:
            return json.load(f)
    except IOError as e:
        print(f"Error reading file {filename}: {e}")
        return None
    except json.JSONDecodeError:
        print(f"Error decoding JSON from {filename}.")
        return None

def main():
    # Load both data sources
    secretary_data = load_local_json(LOCAL_FILE_NAME)
    story_data = load_local_json(STORY_URL)

    # Stop if either file failed to load
    if not secretary_data or not story_data:
        print("Aborting due to errors in loading data.")
        return

    print("Processing data and cross-referencing stories...")
    
    found_stories = {}
    missing_entries = set() # Will store tuples of (task_key, story_id)

    # Iterate through the secretary task data
    for task_key, task_info in secretary_data.items():
        if isinstance(task_info, dict):
            # Get the story_id from the task
            story_id = task_info.get("story_id")

            # Skip if story_id is missing, None, or an empty string
            if not story_id:
                continue

            # Check if this story_id exists in the fetched story.json data
            if story_id.lower() in story_data:
                # If found, and we haven't already added it, add it to our results
                if story_id.lower() not in found_stories:
                    found_stories[story_id.lower()] = story_data[story_id.lower()]
            else:
                # If not found, log it as missing
                missing_entries.add((task_key, story_id.lower()))

    # Save the found stories to a new JSON file
    try:
        with open(OUTPUT_FILE_NAME, "w", encoding="utf-8") as f:
            json.dump(found_stories, f, indent=4, ensure_ascii=False)
        print(f"\n--------------------------------------------------")
        print(f"Success! Extracted {len(found_stories)} unique story entries.")
        print(f"Saved to: {OUTPUT_FILE_NAME}")
        print(f"--------------------------------------------------")

    except IOError as e:
        print(f"\nError writing output file {OUTPUT_FILE_NAME}: {e}")

    # Print the missing keys, as requested
    if missing_entries:
        print("\nMissing Story IDs:")
        print("The following entries in 'secretary_task_data.json' had a 'story_id' that was not found in 'story.json':")
        # Sort the list for a clean, consistent output
        for task_key, story_id in sorted(list(missing_entries)):
            print(f"  - Task Key: {task_key}, Missing story_id: '{story_id}'")
    else:
        print("\nAll story_ids from secretary_task_data.json were found successfully!")

if __name__ == "__main__":
    main()