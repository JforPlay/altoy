import requests
import json
import re
from typing import Dict, Any, Optional


# 기술점수 트래커 / 쥬톡 / 3d 숙소 쥬톡에 들어가는 데이터 처리

class AzurLaneChatProcessor:
    """Processes Azure Lane chat data for both dorm3d and ins_chat systems."""
    
    # Base URLs for data sources
    BASE_URLS = {
        'skin_list': "https://raw.githubusercontent.com/Fernando2603/AzurLane/refs/heads/main/skin_list.json",
        'kr_skin_template': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/ship_skin_template.json",
        'name_code': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/name_code.json",
        'fleet_tech_ship': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/fleet_tech_ship_template.json",
        'ship_data_group': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/ship_data_group.json",
        'ship_data': "https://raw.githubusercontent.com/Fernando2603/AzurLane/refs/heads/main/ship.json",
        'dorm3d_chat_group': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/dorm3d_ins_chat_group.json",
        'dorm3d_chat_language': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/dorm3d_ins_chat_language.json",
        'dorm3d_ship_group': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/dorm3d_ins_ship_group_template.json",
        'ins_chat_group': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/activity_ins_chat_group.json",
        'ins_chat_language': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/activity_ins_chat_language.json",
        'ins_ship_group': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/activity_ins_ship_group_template.json"
    }
    
    # Rarity mapping
    RARITY_MAPPING = {
        6: 'UR',
        5: 'SSR',
        4: 'SR',
        3: 'R',
        2: 'N'
    }
    
    def __init__(self):
        self.default_skins_data: Dict[str, Dict[str, Any]] = {}
        self.name_code_dict: Dict[str, str] = {}
    
    def fetch_json_data(self, url: str) -> Dict[str, Any]:
        """Fetches JSON data from a given URL."""
        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Error fetching data from {url}: {e}")
            raise
        except json.JSONDecodeError as e:
            print(f"Error parsing JSON from {url}: {e}")
            raise
    
    def replace_name_codes(self, text: str) -> str:
        """Replaces name codes in a given string."""
        if not isinstance(text, str):
            return text
        
        matches = re.findall(r"\{namecode:(\d+)\}", text)
        for code in matches:
            name = self.name_code_dict.get(code, f"UnknownNameCode:{code}")
            text = text.replace(f"{{namecode:{code}}}", name)
        return text
    
    def load_default_skins_data(self):
        """Loads and processes default skin data."""
        print("Loading default skins data...")
        
        skin_list_data = self.fetch_json_data(self.BASE_URLS['skin_list'])
        kr_skin_data = self.fetch_json_data(self.BASE_URLS['kr_skin_template'])
        name_code_data = self.fetch_json_data(self.BASE_URLS['name_code'])
        
        # Create name code mapping
        self.name_code_dict = {
            key: value.get("name", "") 
            for key, value in name_code_data.items() 
            if isinstance(value, dict)
        }
        
        # Process default skins
        for skin in skin_list_data:
            if skin.get("type") == "Default":
                gid = str(skin.get("gid"))
                icon = skin.get("icon")
                
                skin_key = gid + "0"
                if skin_key in kr_skin_data:
                    name = kr_skin_data[skin_key].get("name", "")
                    name = self.replace_name_codes(name)
                    self.default_skins_data[gid] = {"icon": icon, "name": name}
        
        print(f"Loaded {len(self.default_skins_data)} default skins")
    
    def _enhance_skins_with_ship_data(self) -> Dict[str, Dict[str, Any]]:
        """Creates an enhanced copy of default skins data with fleet tech, ship group, and rarity information.
        
        Returns:
            A new dictionary with enhanced ship data, leaving the original default_skins_data unchanged.
        """
        print("Creating enhanced skins data with additional ship information...")
        
        # Create a deep copy of the original data to avoid modifying it
        import copy
        enhanced_skins_data = copy.deepcopy(self.default_skins_data)
        
        # Load additional data sources
        fleet_tech_data = self.fetch_json_data(self.BASE_URLS['fleet_tech_ship'])
        ship_data_group = self.fetch_json_data(self.BASE_URLS['ship_data_group'])
        ship_data_list = self.fetch_json_data(self.BASE_URLS['ship_data'])
        
        # Create lookup dictionaries for efficiency
        ship_group_lookup = {
            group_info.get("group_type"): group_info 
            for group_info in ship_data_group.values()
            if isinstance(group_info, dict) and group_info.get("group_type") is not None
        }
        
        ship_rarity_lookup = {
            ship_entry.get("gid"): ship_entry.get("rarity")
            for ship_entry in ship_data_list
            if isinstance(ship_entry, dict) and ship_entry.get("gid") is not None
        }
        
        enhanced_count = 0
        for gid, skin_info in enhanced_skins_data.items():
            gid_int = int(gid)
            
            # Add fleet tech data
            if gid in fleet_tech_data:
                fleet_tech_info = fleet_tech_data[gid]
                if isinstance(fleet_tech_info, dict):
                    skin_info.update(fleet_tech_info)
            
            # Add ship group data (nationality, description, type)
            if gid_int in ship_group_lookup:
                group_info = ship_group_lookup[gid_int]
                
                skin_info["nationality"] = group_info.get("nationality")
                skin_info["type"] = group_info.get("type")
                
                # Process description
                description_list = group_info.get("description", [])
                processed_description = [
                    item[0] for item in description_list 
                    if isinstance(item, list) and item
                ]
                skin_info["description"] = processed_description
            
            # Add rarity data
            if gid_int in ship_rarity_lookup:
                rarity_value = ship_rarity_lookup[gid_int]
                skin_info["rarity"] = self.RARITY_MAPPING.get(rarity_value, "Unknown Rarity")
            
            enhanced_count += 1
        
        print(f"Enhanced {enhanced_count} skins with additional ship data")
        return enhanced_skins_data
    
    def create_ship_group_mapping(self, ship_group_data: Dict[str, Any]) -> Dict[int, str]:
        """Creates a mapping from ship group ID to ship name."""
        return {
            int(ship_group_id): ship_info['name']
            for ship_group_id, ship_info in ship_group_data.items()
            if isinstance(ship_info, dict) and 'name' in ship_info
        }
    
    def process_chat_data(self, chat_type: str) -> Dict[str, Dict[str, Any]]:
        """Processes chat data for either 'dorm3d' or 'ins_chat'."""
        print(f"Processing {chat_type} chat data...")
        
        # Load data based on chat type
        chat_group_data = self.fetch_json_data(self.BASE_URLS[f'{chat_type}_chat_group'])
        chat_language_data = self.fetch_json_data(self.BASE_URLS[f'{chat_type}_chat_language'])
        ship_group_data = self.fetch_json_data(self.BASE_URLS[f'{chat_type}_ship_group'])
        
        # Create mappings
        ship_group_mapping = self.create_ship_group_mapping(ship_group_data)
        
        if chat_type == 'ins':
            chat_language_mapping = self._process_ins_chat_language(chat_language_data)
        else:
            chat_language_mapping = {
                script_id: script_text 
                for script_id, script_text in chat_language_data.items()
            }
        
        # Process chat groups
        processed_data = {}
        for chat_id, chat_info in chat_group_data.items():
            if not isinstance(chat_info, dict):
                continue
            
            new_chat_info = self._create_chat_info_base(chat_info, chat_type)
            
            # Set ship-specific information
            ship_group_id = chat_info.get('ship_group')
            if chat_type == 'dorm3d':
                self._set_dorm3d_ship_info(new_chat_info, ship_group_id, ship_group_mapping)
            else:  # ins_chat
                self._set_ins_chat_ship_info(new_chat_info, ship_group_id, ship_group_mapping)
            
            # Process scripts
            content_ids = chat_info.get('content', [])
            scripts = [chat_language_mapping.get(str(cid), "") for cid in content_ids]
            new_chat_info['scripts'] = scripts
            
            # Group by kr_name
            kr_name = new_chat_info['kr_name']
            if kr_name != "Unknown Ship":  # Filter out unknown ships for ins_chat
                if kr_name not in processed_data:
                    processed_data[kr_name] = {}
                processed_data[kr_name][chat_info.get('id')] = new_chat_info
        
        print(f"Processed {len(processed_data)} {chat_type} chat groups")
        return processed_data
    
    def _process_ins_chat_language(self, chat_language_data: Dict[str, Any]) -> Dict[str, Any]:
        """Processes ins_chat language data with special handling for system messages."""
        chat_language_mapping = {}
        
        for script_id, script_text in chat_language_data.items():
            if not isinstance(script_text, dict):
                continue
                
            ship_group = script_text.get('ship_group')
            if ship_group == 0:
                script_text['kr_name'] = '지휘관'
                script_text['icon'] = None
            elif ship_group == 1:
                script_text['kr_name'] = '시스템'
                script_text['icon'] = None
            elif str(ship_group) in self.default_skins_data:
                skin_data = self.default_skins_data[str(ship_group)]
                script_text['kr_name'] = skin_data['name']
                script_text['icon'] = skin_data['icon']
            
            chat_language_mapping[script_id] = script_text
        
        return chat_language_mapping
    
    def _create_chat_info_base(self, chat_info: Dict[str, Any], chat_type: str) -> Dict[str, Any]:
        """Creates base chat info structure."""
        base_info = {
            'id': chat_info.get('id'),
            'type': chat_info.get('type'),
            'unlock_desc': chat_info.get('unlock_desc'),
            'ship_group': chat_info.get('ship_group'),
            'name': chat_info.get('name')
        }
        
        # Add ins_chat specific fields
        if chat_type == 'ins':
            base_info['trigger_type'] = chat_info.get('trigger_type')
            base_info['trigger_param'] = chat_info.get('trigger_param')
        
        return base_info
    
    def _set_dorm3d_ship_info(self, chat_info: Dict[str, Any], ship_group_id: Optional[int], 
                             ship_group_mapping: Dict[int, str]):
        """Sets ship information for dorm3d chat."""
        if ship_group_id is not None and str(ship_group_id) in self.default_skins_data:
            # Use the ship_group_id directly (not with "0" suffix)
            skin_data = self.default_skins_data[str(ship_group_id)]
            chat_info['kr_name'] = skin_data.get('name', 'Unknown Ship')
            chat_info['icon'] = skin_data.get('icon')
            chat_info['ship_name'] = ship_group_mapping.get(ship_group_id, "Unknown Ship")
        else:
            chat_info['kr_name'] = "Unknown Ship"
            chat_info['ship_name'] = "Unknown Ship"
            chat_info['icon'] = None
    
    def _set_ins_chat_ship_info(self, chat_info: Dict[str, Any], ship_group_id: Optional[int], 
                               ship_group_mapping: Dict[int, str]):
        """Sets ship information for ins_chat."""
        if ship_group_id is not None and str(ship_group_id) in self.default_skins_data:
            skin_data = self.default_skins_data[str(ship_group_id)]
            chat_info['kr_name'] = skin_data['name']
            chat_info['icon'] = skin_data['icon']
            chat_info['ship_name'] = ship_group_mapping.get(ship_group_id, "Unknown Ship")
        else:
            chat_info['kr_name'] = ship_group_mapping.get(ship_group_id, "Unknown Ship")
            chat_info['ship_name'] = "그룹 채팅방"
            chat_info['icon'] = None
    
    def save_to_json(self, data: Dict[str, Any], filename: str):
        """Saves data to JSON file with Korean encoding."""
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        print(f"Data saved to '{filename}'")
    
    def process_all(self, save_enhanced_skins: bool = False):
        """Main method to process all chat data.
        
        Args:
            save_enhanced_skins: If True, saves the enhanced shipgirl_group_data.json file
        """
        try:
            # Load prerequisite data (basic skins data only)
            self.load_default_skins_data()
            
            # Process both chat types using the original, unenhanced data
            dorm3d_data = self.process_chat_data('dorm3d')
            ins_chat_data = self.process_chat_data('ins')
            
            # Save chat processing results
            self.save_to_json(dorm3d_data, './output/chat-viewer/dorm3d_data.json')
            self.save_to_json(ins_chat_data, './output/chat-viewer/juus_chat_data.json')

            # Optionally create and save enhanced skins data (separate from chat processing)
            if save_enhanced_skins:
                enhanced_skins_data = self._enhance_skins_with_ship_data()
                self.save_to_json(enhanced_skins_data, './output/ship_group_data.json')
                print("Enhanced shipgirl group data saved")
            
            print("All processing completed successfully!")
            
        except Exception as e:
            print(f"An error occurred during processing: {e}")
            raise


if __name__ == "__main__":
    processor = AzurLaneChatProcessor()
    # Set to True if you want to save the enhanced shipgirl group data
    processor.process_all(save_enhanced_skins=True)