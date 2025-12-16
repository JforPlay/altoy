# Optimized data processor that chunks story data
import requests
import json
import re
import os
from typing import Dict, List, Any, Optional

# Re-use constants and class structure from original script
URL_KR_SKIN_TEMPLATE = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/ship_skin_template.json"
URL_SKIN_LIST = "https://raw.githubusercontent.com/Fernando2603/AzurLane/refs/heads/main/skin_list.json"
URL_STORYLINE = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/memory_storyline.json"
URL_MEMORY_GROUP = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/memory_group.json"
URL_MEMORY_TEMPLATE = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/memory_template.json"
URL_NAME_CODE = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/name_code.json"

LOCAL_STORY_PATH = "story.json"
LOCAL_SHIPGIRL_DATA_PATH = "./output/story-viewer/shipgirl_data.json"
LOCAL_DUNGEON_PATH = "dungeon.json"
OUTPUT_DIR = "./data/story-viewer"
CHAPTERS_DIR = os.path.join(OUTPUT_DIR, "chapters")

FIELDS_TO_REMOVE_TYPE1 = ["hidePaintObj", "typewriter", "portrait", "expression"]
FIELDS_TO_REMOVE_TYPE2 = ["hidePaintObj", "typewriter", "portrait", "expression", "painting"]

class DataProcessorChunked:
    def __init__(self):
        self.story_data = {}
        self.shipgirl_data = {}
        self.dungeon_data = {}
        self.name_code_dict = {}
        self.memory_template_data = {}
        self.memory_group_data = {}
    
    # ... [Include fetch_json_data, load_local_json_data, create_shipgirl_data from original] ...
    def fetch_json_data(self, url: str) -> Dict[str, Any]:
        response = requests.get(url)
        response.raise_for_status()
        return response.json()

    def load_local_json_data(self, filepath: str) -> Dict[str, Any]:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)

    def create_shipgirl_data(self) -> None:
        try:
            kr_skin_data = self.fetch_json_data(URL_KR_SKIN_TEMPLATE)
            skin_list_data = self.fetch_json_data(URL_SKIN_LIST)
            shipgirl_data = {key: {"name": value.get("name")} for key, value in kr_skin_data.items()}
            skin_list_dict = {str(item["id"]): item for item in skin_list_data}
            for key in shipgirl_data.keys():
                shipgirl_data[key]["icon"] = skin_list_dict.get(key, {}).get("icon")
            
            os.makedirs(os.path.dirname(LOCAL_SHIPGIRL_DATA_PATH), exist_ok=True)
            with open(LOCAL_SHIPGIRL_DATA_PATH, 'w', encoding='utf-8') as f:
                json.dump(shipgirl_data, f, ensure_ascii=False, indent=4)
        except Exception as e:
            print(f"Error creating shipgirl data: {e}")

    def load_all_data(self) -> None:
        self.memory_template_data = self.fetch_json_data(URL_MEMORY_TEMPLATE)
        self.memory_group_data = self.fetch_json_data(URL_MEMORY_GROUP)
        name_code_data = self.fetch_json_data(URL_NAME_CODE)
        self.story_data = self.load_local_json_data(LOCAL_STORY_PATH)
        self.shipgirl_data = self.load_local_json_data(LOCAL_SHIPGIRL_DATA_PATH)
        self.dungeon_data = self.load_local_json_data(LOCAL_DUNGEON_PATH)
        self.name_code_dict = {key: value.get("name") for key, value in name_code_data.items()}

    # ... [Reuse cleaning and processing logic] ...
    def clean_script_fields(self, scripts: List[Dict], fields_to_remove: List[str]) -> None:
        for script_item in scripts:
            if isinstance(script_item, dict):
                for field in fields_to_remove:
                    script_item.pop(field, None)

    def get_story_data_by_key(self, story_key: str, fields_to_remove: List[str]) -> Optional[Dict]:
        story_data = self.story_data.get(story_key.lower())
        if story_data and isinstance(story_data, dict):
            if 'scripts' in story_data and isinstance(story_data['scripts'], list):
                self.clean_script_fields(story_data['scripts'], fields_to_remove)
            return story_data
        return None

    def collect_dungeon_story_ids(self, story_key: str) -> List[str]:
        dungeon_story_ids = []
        if story_key not in self.dungeon_data or not isinstance(self.dungeon_data[story_key], dict):
            return dungeon_story_ids
        dungeon_info = self.dungeon_data[story_key]
        begin_story_key = dungeon_info.get("beginStoy")
        if begin_story_key and isinstance(begin_story_key, str):
            dungeon_story_ids.append(begin_story_key)
        stages = dungeon_info.get("stages", [])
        for stage_info in stages:
            if not isinstance(stage_info, dict) or "waves" not in stage_info: continue
            for wave_info in stage_info["waves"]:
                if (isinstance(wave_info, dict) and "triggerParams" in wave_info and isinstance(wave_info["triggerParams"], dict) and "id" in wave_info["triggerParams"]):
                    dungeon_story_ids.append(wave_info["triggerParams"]["id"])
        return dungeon_story_ids

    def process_dungeon_stories(self, story_key: str, fields_to_remove: List[str]) -> Optional[Dict]:
        dungeon_story_ids = self.collect_dungeon_story_ids(story_key)
        if not dungeon_story_ids: return None
        combined_scripts = []
        for d_story_id in dungeon_story_ids:
            story_data = self.get_story_data_by_key(str(d_story_id), fields_to_remove)
            if story_data and 'scripts' in story_data:
                combined_scripts.extend(story_data['scripts'])
        return {"scripts": combined_scripts} if combined_scripts else None

    def process_memory_template(self, mem_id: int, fields_to_remove: List[str]) -> Dict:
        template_data = self.memory_template_data.get(str(mem_id))
        if not template_data: return {"id": mem_id, "error": "Template not found"}
        story_key = template_data.get("story")
        if not story_key: return {"id": mem_id, "error": "No story key"}
        
        story_data = self.get_story_data_by_key(story_key, fields_to_remove)
        if story_data:
            template_data["story"] = story_data
            return template_data
        
        dungeon_story_data = self.process_dungeon_stories(story_key, fields_to_remove)
        if dungeon_story_data:
            template_data["story"] = dungeon_story_data
            return template_data
        
        template_data["story_error"] = f"Story not found: {story_key}"
        return template_data

    def process_memory_group(self, group_id: int) -> List:
        group_data = self.memory_group_data.get(str(group_id))
        if not group_data: return []
        memories_list = group_data.get('memories', [])
        processed_memories = []
        for mem_id in memories_list:
            if isinstance(mem_id, int):
                processed_memories.append(self.process_memory_template(mem_id, FIELDS_TO_REMOVE_TYPE1))
        return processed_memories

    def process_memory_ids(self, memory_ids: List) -> List:
        if not memory_ids or len(memory_ids) == 0: return memory_ids
        first_element = memory_ids[0]
        if first_element == 1:
            if len(memory_ids) > 1 and isinstance(memory_ids[1], int):
                return self.process_memory_group(memory_ids[1])
        elif first_element == 2:
            if len(memory_ids) > 1 and isinstance(memory_ids[1], list):
                processed = []
                for mem_id in memory_ids[1]:
                    if isinstance(mem_id, int):
                        processed.append(self.process_memory_template(mem_id, FIELDS_TO_REMOVE_TYPE2))
                return processed
        return memory_ids

    def replace_name_codes_recursive(self, data: Any) -> Any:
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str):
                    matches = re.findall(r"\{namecode:(\d+)\}", value)
                    if matches:
                        code = matches[0]
                        name = self.name_code_dict.get(code, f"Unknown:{code}")
                        updated_value = value.replace(f"{{namecode:{code}}}", name)
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
        for shipgirl_id, shipgirl_info in self.shipgirl_data.items():
            if shipgirl_info.get("name") == name: return shipgirl_id
        return None

    # === NEW: Chunking Logic ===
    def run(self) -> None:
        try:
            self.create_shipgirl_data()
            self.load_all_data()
            
            storyline_data = self.fetch_json_data(URL_STORYLINE)
            
            # The "Index" file will contain metadata but NO scripts
            index_data = {}
            
            os.makedirs(CHAPTERS_DIR, exist_ok=True)
            
            for storyline_id, storyline_info in storyline_data.items():
                if not isinstance(storyline_info, dict): continue
                
                # 1. Process Memories (which loads the heavy scripts)
                memory_ids = storyline_info.get('memory_id')
                processed_memories = []
                
                if isinstance(memory_ids, list):
                    processed_memories = self.process_memory_ids(memory_ids)
                
                # 2. Extract Scripts and Save Chunk
                # We need to preserve the structure (memory_id list of objects), but remove 'story.scripts'
                
                # Deep copy for the chunk file (contains everything)
                chunk_data = json.loads(json.dumps(processed_memories)) # Simple deep copy
                chunk_data = self.replace_name_codes_recursive(chunk_data)
                
                # Save chunk
                chunk_filename = f"{storyline_id}.json"
                with open(os.path.join(CHAPTERS_DIR, chunk_filename), 'w', encoding='utf-8') as f:
                    json.dump(chunk_data, f, ensure_ascii=False)
                
                # 3. Create Index Entry (Metadata Only)
                # We keep the structure of processed_memories but remove the 'story' object entirely or just scripts
                # To keep main menu working, we need titles/icons. 
                # The 'getEventMemories' in config expects 'memory_id' to be the array of memories.
                
                lite_memories = []
                for mem in chunk_data:
                    # Keep metadata, remove heavy story content
                    lite_mem = {k: v for k, v in mem.items() if k != 'story'}
                    lite_mem['has_story_file'] = True # Flag for frontend
                    lite_memories.append(lite_mem)
                
                index_entry = storyline_info.copy()
                index_entry['memory_id'] = lite_memories
                index_entry['chunk_file'] = chunk_filename
                
                # Remove raw memory_id if it was there
                if 'memory_id' in index_entry and isinstance(index_entry['memory_id'], list) and len(index_entry['memory_id']) > 0 and isinstance(index_entry['memory_id'][0], int):
                     pass # We just replaced it with lite_memories

                index_data[storyline_id] = index_entry

            # Save Index
            index_data = self.replace_name_codes_recursive(index_data)
            with open(os.path.join(OUTPUT_DIR, 'main_story_lite.json'), 'w', encoding='utf-8') as f:
                json.dump(index_data, f, ensure_ascii=False, indent=4)
                
            print(f"Chunked processing complete. Index saved to main_story_lite.json. Chapters in {CHAPTERS_DIR}")
            
        except Exception as e:
            print(f"An error occurred: {e}")

if __name__ == "__main__":
    DataProcessorChunked().run()
