import requests
import json
from typing import Dict, Any, List, Union

# URLs for the Azur Lane data files
URL_WORLD_COLLECTION_FILE_GROUP = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/ShareCfg/world_collection_file_group.json"
URL_WORLD_COLLECTION_FILE_TEMPLATE = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/ShareCfg/world_collection_file_template.json"

def fetch_json_data(url: str) -> Dict[str, Any]:
    """
    Fetches JSON data from a given URL.
    
    Args:
        url (str): The URL to fetch JSON data from
        
    Returns:
        dict: The parsed JSON data
        
    Raises:
        requests.exceptions.RequestException: If there's an error fetching the data
        ValueError: If the response is not valid JSON
    """
    response = requests.get(url)
    response.raise_for_status()
    return response.json()

def process_world_collection_group_data(data: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """
    Processes the world collection group data and extracts required fields.
    
    Args:
        data (dict): Raw world collection group data
        
    Returns:
        dict: Processed data with name as key and id_2, child as values
    """
    processed_data = {}
    
    for key, value in data.items():
        # Check if the value contains required keys
        if (isinstance(value, dict) and 
            all(field in value for field in ['name', 'id_2', 'child'])):
            
            name = value['name']
            id_2 = value['id_2']
            child = value['child']
            processed_data[name] = {"id_2": id_2, "child": child}
    
    return processed_data

def enrich_child_data(processed_data: Dict[str, Dict[str, Any]], 
                     template_data: Dict[str, Any]) -> None:
    """
    Enriches the child data in processed_data with details from template_data.
    
    Args:
        processed_data (dict): The processed world collection data to enrich
        template_data (dict): Template data containing detailed information
    """
    for name, data in processed_data.items():
        if 'child' in data and isinstance(data['child'], list):
            updated_child_list = []
            
            for child_id in data['child']:
                child_id_str = str(child_id)
                
                if child_id_str in template_data:
                    template_info = template_data[child_id_str]
                    extracted_info = {
                        "id": child_id,
                        "name": template_info.get("name"),
                        "subTitle": template_info.get("subTitle"),
                        "content": template_info.get("content")
                    }
                    updated_child_list.append(extracted_info)
                else:
                    # Keep original ID if template not found
                    updated_child_list.append({
                        "id": child_id,
                        "name": None,
                        "subTitle": None,
                        "content": f"Template not found for ID: {child_id}"
                    })
            
            # Replace the original child list with the enriched one
            data['child'] = updated_child_list

def save_json_data(data: Dict[str, Any], filename: str) -> None:
    """
    Saves data to a JSON file with proper encoding.
    
    Args:
        data (dict): Data to save
        filename (str): Name of the output file
    """
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

def main():
    """Main function to orchestrate the data processing workflow."""
    try:
        print("Fetching world collection group data...")
        world_collection_group_data = fetch_json_data(URL_WORLD_COLLECTION_FILE_GROUP)
        
        print("Processing world collection group data...")
        processed_world_collection_data = process_world_collection_group_data(world_collection_group_data)
        print(f"Processed {len(processed_world_collection_data)} collection groups.")
        
        print("Fetching world collection template data...")
        world_collection_template_data = fetch_json_data(URL_WORLD_COLLECTION_FILE_TEMPLATE)
        
        print("Enriching child data with template information...")
        enrich_child_data(processed_world_collection_data, world_collection_template_data)
        
        print("Saving processed data...")
        output_filename = './output/processed_world_collection_data.json'
        save_json_data(processed_world_collection_data, output_filename)
        
        print(f"\n✓ Successfully processed and saved data to '{output_filename}'")
        
        # Display sample of processed data
        print("\nSample of processed data:")
        sample_items = list(processed_world_collection_data.items())[:3]
        for name, data in sample_items:
            print(f"\nCollection: {name}")
            print(f"  ID_2: {data['id_2']}")
            print(f"  Child items: {len(data['child'])}")
            if data['child']:
                first_child = data['child'][0]
                if isinstance(first_child, dict):
                    print(f"    First child: {first_child.get('name', 'N/A')}")
        
    except requests.exceptions.RequestException as e:
        print(f"❌ Error fetching data: {e}")
    except ValueError as e:
        print(f"❌ Error parsing JSON: {e}")
    except FileNotFoundError as e:
        print(f"❌ Error saving file: {e}")
    except Exception as e:
        print(f"❌ An unexpected error occurred: {e}")

if __name__ == "__main__":
    main()