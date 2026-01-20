import requests
import json
from collections import defaultdict

# URLs for the JSON files
TECH_TEMPLATE_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/island_technology_template.json"
FORMULA_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/island_formula.json"
OUTPUT_FILENAME = "./output/island/recipes.json"


# check later for this
# Currently ignore formula having workload 999999

def process_azur_lane_data():
    """
    Fetches Azur Lane data, filters formulas, and saves the result to a JSON file.
    """
    try:
        # 1. Fetch island_technology_template.json and get all formula_ids
        print(f"Fetching data from {TECH_TEMPLATE_URL}...")
        tech_response = requests.get(TECH_TEMPLATE_URL)
        tech_response.raise_for_status()  # Raise an error for bad responses
        tech_data = tech_response.json()

        formula_id_map = set()
        
        # Iterate through the subdicts (assuming a dict of dicts structure)
        # We also check 'all' which seems to be a key for all items
        if isinstance(tech_data, dict):
            # Handle the common case where 'all' contains a list of IDs
            if 'all' in tech_data and isinstance(tech_data['all'], list):
                all_ids = tech_data['all']
                for item_id in all_ids:
                    item_key = str(item_id) # Ensure key is string for lookup
                    if item_key in tech_data and isinstance(tech_data[item_key], dict):
                         if "formula_id" in tech_data[item_key]:
                            formula_id_map.add(tech_data[item_key]["formula_id"])
            else:
                 # Fallback for the original structure assumption
                for item in tech_data.values():
                    if isinstance(item, dict) and "formula_id" in item:
                        formula_id_map.add(item["formula_id"])
        
        print(f"Found {len(formula_id_map)} unique formula_ids from tech template.")

        # 2. Fetch island_formula.json and process it
        print(f"Fetching data from {FORMULA_URL}...")
        formula_response = requests.get(FORMULA_URL)
        formula_response.raise_for_status()
        formula_data = formula_response.json()

        grouped_by_attribute = defaultdict(list)

        # Iterate through all subdicts
        if isinstance(formula_data, dict):
            for item_id, item_data in formula_data.items():
                if isinstance(item_data, dict):

                    if "workload" in item_data and item_data["workload"] == 999999:
                            continue  # Skip this formula
                    
                    # Get the required fields
                    formula_id = item_data.get("id")
                    attribute = item_data.get("attribute")

                    # Check if the id is in the mapping. If not, process it.
                    if formula_id is not None and formula_id not in formula_id_map:
                        # Use 'unknown' if attribute is missing
                        attribute_key = attribute if attribute else "unknown"
                        # Save the entire sub-dictionary
                        grouped_by_attribute[attribute_key].append(item_data)
        
        # 3. Save the results to a JSON file
        print(f"\nSaving results to {OUTPUT_FILENAME}...")
        with open(OUTPUT_FILENAME, 'w', encoding='utf-8') as f:
            json.dump(grouped_by_attribute, f, indent=2, ensure_ascii=False)
        
        print(f"Successfully saved {len(grouped_by_attribute)} attribute groups to {OUTPUT_FILENAME}.")

    except requests.exceptions.RequestException as e:
        print(f"Error fetching data: {e}")
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON data: {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

if __name__ == "__main__":
    process_azur_lane_data()
