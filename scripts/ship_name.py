import requests
import json

def create_ship_skill_map(ship_url, stats_url, output_filename):
    """
    Creates a JSON file mapping ship names to their skills,
    keeping only skills that are fully upgraded.
    """
    try:
        print("Fetching ship data...")
        ship_list_response = requests.get(ship_url)
        ship_list_response.raise_for_status()
        ship_list_data = ship_list_response.json()

        print("Fetching ship statistics for name lookup...")
        stats_response = requests.get(stats_url)
        stats_response.raise_for_status()
        stats_data = stats_response.json()

        ship_skill_map = []
        print("Processing and mapping data...")

        for ship in ship_list_data:
            if not all(k in ship for k in ["sid", "gid", "skill"]):
                continue

            sid_list = ship["sid"]
            if not sid_list:
                continue

            lookup_id = str(sid_list[0])
            ship_name = stats_data.get(lookup_id, {}).get("name", "Unknown Name")

            # --- ADDED: Filter the skills based on the 'upgrade' field ---
            original_skills = ship["skill"]
            filtered_skills = {}
            for skill_id, skill_details in original_skills.items():
                # Check if the 'upgrade' value is null (None in Python)
                if isinstance(skill_details, dict) and skill_details.get("upgrade") is None:
                    filtered_skills[skill_id] = skill_details
            # --- End of filtering logic ---

            # Skip this ship if it has no skills left after filtering
            if not filtered_skills:
                continue

            processed_ship = {
                "name": ship_name,
                "gid": ship["gid"],
                "skill": filtered_skills, # Use the new filtered dictionary
                "sid": ship["sid"]
            }
            ship_skill_map.append(processed_ship)

        with open(output_filename, 'w', encoding='utf-8') as f:
            json.dump(ship_skill_map, f, indent=4, ensure_ascii=False)

        print(f"\nProcessing complete. Filtered ship skill map saved to '{output_filename}'")

    except requests.exceptions.RequestException as e:
        print(f"Error fetching data: {e}")
    except json.JSONDecodeError:
        print("Error: Failed to parse JSON content from a source.")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")


# URLs for the data sources
SHIP_LIST_URL = "https://raw.githubusercontent.com/Fernando2603/AzurLane/main/ship.json"
SHIP_STATS_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/sharecfgdata/ship_data_statistics.json"
OUTPUT_FILE = "filtered_ship_skill_map.json"

# Run the script
create_ship_skill_map(SHIP_LIST_URL, SHIP_STATS_URL, OUTPUT_FILE)