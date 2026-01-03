# 대사집에 아이콘 넣는건 위에 통으로 매번 부를필요없이 작은거 쓰는게 나은거같아서 하나 따로 제작
import requests
import json
import re
from typing import Dict, List, Any, Optional

# Constants
URL_KR_SKIN_TEMPLATE = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/ship_skin_template.json"
URL_SKIN_LIST = "https://raw.githubusercontent.com/Fernando2603/AzurLane/refs/heads/main/skin_list.json"
URL_STORYLINE = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/memory_storyline.json"
URL_MEMORY_GROUP = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/memory_group.json"
URL_MEMORY_TEMPLATE = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/memory_template.json"
URL_NAME_CODE = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/name_code.json"

LOCAL_STORY_PATH = "story.json"
LOCAL_SHIPGIRL_DATA_PATH = "./output/story-viewer/shipgirl_data.json"
LOCAL_DUNGEON_PATH = "dungeon.json"

FIELDS_TO_REMOVE_TYPE1 = ["hidePaintObj", "typewriter", "portrait", "expression"]
FIELDS_TO_REMOVE_TYPE2 = ["hidePaintObj", "typewriter", "portrait", "expression", "painting"]
# FIELDS_TO_REMOVE_TYPE2 = ["nameColor", "hidePaintObj", "typewriter", "portrait", "expression", "painting"]

class DataProcessor:
    def __init__(self):
        self.story_data = {}
        self.shipgirl_data = {}
        self.dungeon_data = {}
        self.name_code_dict = {}
        self.memory_template_data = {}
        self.memory_group_data = {}
    
    def fetch_json_data(self, url: str) -> Dict[str, Any]:
        """Fetches JSON data from a given URL."""
        response = requests.get(url)
        response.raise_for_status()
        return response.json()

    def load_local_json_data(self, filepath: str) -> Dict[str, Any]:
        """Loads JSON data from a local file path."""
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)

    def create_shipgirl_data(self) -> None:
        """Creates and saves shipgirl data with icons."""
        try:
            kr_skin_data = self.fetch_json_data(URL_KR_SKIN_TEMPLATE)
            skin_list_data = self.fetch_json_data(URL_SKIN_LIST)

            # Create shipgirl_data with names
            shipgirl_data = {
                key: {"name": value.get("name")} 
                for key, value in kr_skin_data.items()
            }

            # Create lookup dict for skin list
            skin_list_dict = {str(item["id"]): item for item in skin_list_data}

            # Add icons
            for key in shipgirl_data.keys():
                shipgirl_data[key]["icon"] = skin_list_dict.get(key, {}).get("icon")

            # Save to file
            with open(LOCAL_SHIPGIRL_DATA_PATH, 'w', encoding='utf-8') as f:
                json.dump(shipgirl_data, f, ensure_ascii=False, indent=4)

            print("shipgirl_data has been created.")
            
        except Exception as e:
            print(f"Error creating shipgirl data: {e}")

    def load_all_data(self) -> None:
        """Loads all required data from URLs and local files."""
        # Load remote data
        self.memory_template_data = self.fetch_json_data(URL_MEMORY_TEMPLATE)
        self.memory_group_data = self.fetch_json_data(URL_MEMORY_GROUP)
        name_code_data = self.fetch_json_data(URL_NAME_CODE)
        
        # Load local data
        self.story_data = self.load_local_json_data(LOCAL_STORY_PATH)
        self.shipgirl_data = self.load_local_json_data(LOCAL_SHIPGIRL_DATA_PATH)
        self.dungeon_data = self.load_local_json_data(LOCAL_DUNGEON_PATH)
        
        # Create name code mapping
        self.name_code_dict = {key: value.get("name") for key, value in name_code_data.items()}

    def clean_script_fields(self, scripts: List[Dict], fields_to_remove: List[str]) -> None:
        """Removes specified fields from script items."""
        for script_item in scripts:
            if isinstance(script_item, dict):
                for field in fields_to_remove:
                    script_item.pop(field, None)

    def get_story_data_by_key(self, story_key: str, fields_to_remove: List[str]) -> Optional[Dict]:
        """Gets story data by key, cleaning specified fields."""
        story_data = self.story_data.get(story_key.lower())
        if story_data and isinstance(story_data, dict):
            if 'scripts' in story_data and isinstance(story_data['scripts'], list):
                self.clean_script_fields(story_data['scripts'], fields_to_remove)
            return story_data
        return None

    def collect_dungeon_story_ids(self, story_key: str) -> List[str]:
        """Collects story IDs from dungeon data."""
        dungeon_story_ids = []
        
        if story_key not in self.dungeon_data or not isinstance(self.dungeon_data[story_key], dict):
            return dungeon_story_ids
            
        dungeon_info = self.dungeon_data[story_key]
        
        # Add beginStory if exists
        begin_story_key = dungeon_info.get("beginStoy")
        if begin_story_key and isinstance(begin_story_key, str):
            dungeon_story_ids.append(begin_story_key)
        
        # Collect from stages
        stages = dungeon_info.get("stages", [])
        for stage_info in stages:
            if not isinstance(stage_info, dict) or "waves" not in stage_info:
                continue
                
            for wave_info in stage_info["waves"]:
                if (isinstance(wave_info, dict) and 
                    "triggerParams" in wave_info and 
                    isinstance(wave_info["triggerParams"], dict) and
                    "id" in wave_info["triggerParams"]):
                    dungeon_story_ids.append(wave_info["triggerParams"]["id"])
        
        return dungeon_story_ids

    def process_dungeon_stories(self, story_key: str, fields_to_remove: List[str]) -> Optional[Dict]:
        """Processes dungeon stories and returns combined story data."""
        dungeon_story_ids = self.collect_dungeon_story_ids(story_key)
        if not dungeon_story_ids:
            return None
            
        combined_scripts = []
        for d_story_id in dungeon_story_ids:
            print(d_story_id)
            story_data = self.get_story_data_by_key(str(d_story_id), fields_to_remove)
            if story_data and 'scripts' in story_data:
                combined_scripts.extend(story_data['scripts'])
        
        return {"scripts": combined_scripts} if combined_scripts else None

    def process_memory_template(self, mem_id: int, fields_to_remove: List[str]) -> Dict:
        """Processes a single memory template item."""
        template_data = self.memory_template_data.get(str(mem_id))
        if not template_data:
            return f"ID not found in memory_template: {mem_id}"

        story_key = template_data.get("story")
        if not story_key or not isinstance(story_key, str):
            return f"Invalid or missing 'story' field for ID {mem_id} in memory_template: {story_key}"

        # Try to get story data directly
        story_data = self.get_story_data_by_key(story_key, fields_to_remove)
        # Check if it's valid story data (has 'scripts' field) and not dungeon config
        if story_data and 'scripts' in story_data:
            template_data["story"] = story_data
            return template_data

        # Try dungeon stories (or if story_data was dungeon config without scripts)
        dungeon_story_data = self.process_dungeon_stories(story_key, fields_to_remove)
        if dungeon_story_data:
            template_data["story"] = dungeon_story_data
            return template_data

        # No story data found
        template_data["story"] = f"던전 스토리 ID를 story.json에서 찾을 수 없습니다: {story_key}"
        return template_data

    def process_memory_group(self, group_id: int) -> List:
        """Processes memory group and returns processed memories."""
        group_data = self.memory_group_data.get(str(group_id))
        if not group_data or not isinstance(group_data, dict):
            return [f"ID not found in memory_group or not a dictionary: {group_id}"]
            
        memories_list = group_data.get('memories', [])
        if not isinstance(memories_list, list):
            return []
            
        processed_memories = []
        for mem_id in memories_list:
            if isinstance(mem_id, int):
                processed_memory = self.process_memory_template(mem_id, FIELDS_TO_REMOVE_TYPE1)
                processed_memories.append(processed_memory)
            else:
                processed_memories.append(f"Unexpected element type in memories list: {mem_id}")
                
        return processed_memories

    def process_memory_ids_type1(self, memory_ids: List) -> List:
        """Processes memory IDs of type 1 (starts with 1)."""
        if len(memory_ids) <= 1:
            return memory_ids
            
        second_element = memory_ids[1]
        if not isinstance(second_element, int):
            return [f"Unexpected second element type for memory_id starting with 1: {second_element}"]
            
        return self.process_memory_group(second_element)

    def process_memory_ids_type2(self, memory_ids: List) -> List:
        """Processes memory IDs of type 2 (starts with 2)."""
        if len(memory_ids) <= 1 or not isinstance(memory_ids[1], list):
            return memory_ids
            
        second_element_list = memory_ids[1]
        processed_memories = []
        
        for mem_id in second_element_list:
            if isinstance(mem_id, int):
                processed_memory = self.process_memory_template(mem_id, FIELDS_TO_REMOVE_TYPE2)
                processed_memories.append(processed_memory)
            else:
                processed_memories.append(f"Unexpected element type in second list for memory_id starting with 2: {mem_id}")
                
        return processed_memories

    def process_memory_ids(self, memory_ids: List) -> List:
        """Main function to process memory IDs based on their type."""
        if not memory_ids or len(memory_ids) == 0:
            return memory_ids
            
        first_element = memory_ids[0]
        
        if first_element == 1:
            return self.process_memory_ids_type1(memory_ids)
        elif first_element == 2:
            return self.process_memory_ids_type2(memory_ids)
        else:
            return memory_ids

    def replace_name_codes_recursive(self, data: Any) -> Any:
        """Recursively finds and replaces name codes and performs shipgirl ID lookup."""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str):
                    # Find name codes in the text
                    matches = re.findall(r"\{namecode:(\d+)\}", value)
                    if matches:
                        code = matches[0]  # Assume only one namecode per string
                        name = self.name_code_dict.get(code, f"UnknownNameCode:{code}")
                        updated_value = value.replace(f"{{namecode:{code}}}", name)
                        
                        # Check if this is an actor field and convert to shipgirl ID
                        if key in ["actor", "actorName"]:
                            shipgirl_id = self.find_shipgirl_id_by_name(name)
                            data[key] = str(shipgirl_id) if shipgirl_id else updated_value
                        else:
                            data[key] = updated_value
                    else:
                        data[key] = self.replace_name_codes_recursive(value)
                else:
                    data[key] = self.replace_name_codes_recursive(value)
                    
        elif isinstance(data, list):
            data[:] = [self.replace_name_codes_recursive(item) for item in data]
            
        return data

    def find_shipgirl_id_by_name(self, name: str) -> Optional[str]:
        """Finds shipgirl ID by name."""
        for shipgirl_id, shipgirl_info in self.shipgirl_data.items():
            if (isinstance(shipgirl_info, dict) and 
                shipgirl_info.get("name") == name):
                return shipgirl_id
        return None

    def create_meta_data(self, processed_data: Dict[str, Any]) -> None:
        """Creates metadata file without scripts."""
        meta_data = {}
        keep_fields = [
            'id', 'name', 'description', 'summary', 'shipnation', 'bgm', 
            'link_event', 'chapter', 'column', 'row', 'icon'
        ]
        
        for key, item in processed_data.items():
            meta_item = {}
            for field in keep_fields:
                if field in item:
                    meta_item[field] = item[field]
            meta_data[key] = meta_item
            
        with open('./output/story-viewer/main_story_meta.json', 'w', encoding='utf-8') as f:
            json.dump(meta_data, f, ensure_ascii=False, indent=4)
            
        print("Meta data saved to './output/story-viewer/main_story_meta.json'")

    def process_storyline_data(self) -> Dict[str, Any]:
        """Main function to process storyline data."""
        storyline_data = self.fetch_json_data(URL_STORYLINE)
        processed_data = {}
        
        for storyline_id, storyline_info in storyline_data.items():
            if not isinstance(storyline_info, dict):
                continue
                
            # Add summary field
            storyline_info['summary'] = ""
            
            # Process memory_id field
            memory_ids = storyline_info.get('memory_id')
            if isinstance(memory_ids, list):
                storyline_info['memory_id'] = self.process_memory_ids(memory_ids)
                
            processed_data[storyline_id] = storyline_info
        
        # Apply name code replacement
        return self.replace_name_codes_recursive(processed_data)

    def run(self) -> None:
        """Main execution function."""
        try:
            # Create shipgirl data first
            self.create_shipgirl_data()
            
            # Load all required data
            self.load_all_data()
            
            # Process storyline data
            processed_storyline_data = self.process_storyline_data()
            
            # Save results
            with open('./output/story-viewer/main_story_data.json', 'w', encoding='utf-8') as f:
                json.dump(processed_storyline_data, f, ensure_ascii=False, indent=4)
                
            print("Processed storyline data saved to './output/story-viewer/main_story_data.json'")
            
            self.create_meta_data(processed_storyline_data)
            
        except requests.exceptions.RequestException as e:
            print(f"Error fetching data: {e}")
        except ValueError as e:
            print(f"Error parsing JSON: {e}")
        except Exception as e:
            print(f"An error occurred: {e}")


# Usage
if __name__ == "__main__":
    processor = DataProcessor()
    processor.run()