import json
import os

# --- Configuration ---
INPUT_FILE = 'story.json'
TB_OUTPUT_FILE = './output/story-viewer/tb_story_data.json'
NAVI_OUTPUT_FILE = './output/story-viewer/navi_story_data.json'

# Keywords to search for (will be checked case-insensitively)
TB_KEYWORD = 'LINGHANGYUAN'
NAVI_KEYWORD = 'LINGYANGZHE'
# ---------------------

def create_story_subsets(input_path, tb_output_path, navi_output_path):
    """
    Reads a large story.json file and creates two subset JSON files
    based on case-insensitive keywords in the main dictionary's keys.
    """
    
    tb_stories = {}
    navi_stories = {}

    # Check if the input file exists
    if not os.path.exists(input_path):
        print(f"Error: Input file '{input_path}' not found.")
        print("Please make sure your 'story.json' file is in the same directory.")
        # Create a dummy file to prevent crashing if it's missing
        print("Creating a dummy 'story.json' for demonstration.")
        dummy_data = {
            "story_001_linghangyuan": {"title": "TB Story One", "content": "..."},
            "STORY_002_LINGYANGZHE": {"title": "Navi Story One", "content": "..."},
            "story_003_other": {"title": "Another Story", "content": "..."},
            "linghangyuan_story_004": {"title": "TB Story Two", "content": "..."}
        }
        try:
            with open(input_path, 'w', encoding='utf-8') as f:
                json.dump(dummy_data, f, indent=4)
            print(f"Dummy '{input_path}' created. Please run the script again.")
        except IOError as e:
            print(f"Failed to create dummy file: {e}")
        return

    # Try to open and load the main JSON file
    try:
        with open(input_path, 'r', encoding='utf-8') as f:
            all_stories = json.load(f)
            
            if not isinstance(all_stories, dict):
                print(f"Error: Expected '{input_path}' to contain a dictionary (dict).")
                return

    except json.JSONDecodeError:
        print(f"Error: Could not decode JSON from '{input_path}'.")
        return
    except IOError as e:
        print(f"Error reading file '{input_path}': {e}")
        return
    except Exception as e:
        print(f"An unexpected error occurred while reading: {e}")
        return

    # Process the loaded data
    print(f"Processing {len(all_stories)} entries from '{input_path}'...")
    
    # Convert keywords to lowercase once for efficient comparison
    tb_keyword_lower = TB_KEYWORD.lower()
    navi_keyword_lower = NAVI_KEYWORD.lower()

    for key, story_data in all_stories.items():
        key_lower = key.lower() # Convert current key to lowercase
        
        # Check for TB keyword
        if tb_keyword_lower in key_lower:
            tb_stories[key] = story_data
            
        # Check for Navi keyword
        if navi_keyword_lower in key_lower:
            navi_stories[key] = story_data

    # Write the TB stories file
    try:
        with open(tb_output_path, 'w', encoding='utf-8') as f:
            json.dump(tb_stories, f, indent=4, ensure_ascii=False)
        print(f"Successfully created '{tb_output_path}' with {len(tb_stories)} entries.")
    except IOError as e:
        print(f"Error writing file '{tb_output_path}': {e}")
    except Exception as e:
        print(f"An unexpected error occurred while writing TB stories: {e}")

    # Write the Navi stories file
    try:
        with open(navi_output_path, 'w', encoding='utf-8') as f:
            json.dump(navi_stories, f, indent=4, ensure_ascii=False)
        print(f"Successfully created '{navi_output_path}' with {len(navi_stories)} entries.")
    except IOError as e:
        print(f"Error writing file '{navi_output_path}': {e}")
    except Exception as e:
        print(f"An unexpected error occurred while writing Navi stories: {e}")


if __name__ == "__main__":
    create_story_subsets(INPUT_FILE, TB_OUTPUT_FILE, NAVI_OUTPUT_FILE)
