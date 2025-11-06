import json
import requests
import sys

# URLs for the raw JSON data on GitHub
TEMPLATE_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/EN/ShareCfg/island_technology_template.json"
FORMULA_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/EN/ShareCfg/island_formula.json"
OUTPUT_FILENAME = "./output/island/technology.json"

def fetch_json_data(url):
    """Fetches and parses JSON data from a given URL."""
    try:
        response = requests.get(url)
        # Raise an exception if the request was unsuccessful
        response.raise_for_status() 
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error fetching data from {url}: {e}", file=sys.stderr)
        return None
    except json.JSONDecodeError:
        print(f"Error: Failed to decode JSON from {url}.", file=sys.stderr)
        return None

def main():
    # Fetch both JSON files
    print(f"Fetching main template from {TEMPLATE_URL}...")
    island_tech_template = fetch_json_data(TEMPLATE_URL)
    
    print(f"Fetching formula data from {FORMULA_URL}...")
    island_formula = fetch_json_data(FORMULA_URL)

    # Exit if fetching failed for either file
    if island_tech_template is None or island_formula is None:
        print("Failed to fetch necessary data. Exiting.")
        return

    print("Processing data...")
    
    # Iterate through the main dictionary
    # (e.g., {"1": {...}, "2": {...}, ...})
    for item_key, item_data in island_tech_template.items():
        # Check if 'formula_id' exists in the inner dictionary
        if "formula_id" in item_data:
            formula_id_num = item_data["formula_id"]
            
            # Convert the numeric ID to a string to use as a key
            formula_id_str = str(formula_id_num)
            
            # Find the corresponding dictionary in island_formula.json
            if formula_id_str in island_formula:
                # Replace the 'formula_id' value with the fetched sub-dictionary
                item_data["formula_id"] = island_formula[formula_id_str]
            else:
                # Handle cases where the ID might be missing in the formula file
                print(f"Warning: formula_id '{formula_id_str}' (from key '{item_key}') not found in island_formula.json. Leaving original value.")

    # Save the modified dictionary to a new JSON file
    try:
        with open(OUTPUT_FILENAME, "w", encoding="utf-8") as f:
            # indent=4 makes the file human-readable
            json.dump(island_tech_template, f, indent=4, ensure_ascii=False)
        
        print(f"\nSuccessfully processed data and saved to {OUTPUT_FILENAME}")
        
    except IOError as e:
        print(f"Error writing to file {OUTPUT_FILENAME}: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()