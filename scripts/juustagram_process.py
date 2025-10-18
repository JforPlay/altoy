#!/usr/bin/env python3
"""
Azur Lane Data Processor

This script processes Azur Lane game data including:
- Ship skin information
- Activity Instagram-style posts
- Translations from Chinese to Korean
- Name code replacements

Author: Refactored for better maintainability
"""

import json
import re
import requests
import translators as ts
from typing import Dict, List, Optional, Any, Tuple


class AzurLaneDataProcessor:
    """Main class for processing Azur Lane data."""
    
    # API URLs
    URLS = {
        'skin_list': "https://raw.githubusercontent.com/Fernando2603/AzurLane/refs/heads/main/skin_list.json",
        'kr_skin_template': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/ship_skin_template.json",
        'name_code': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/name_code.json",
        'activity_ins_template': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/CN/ShareCfg/activity_ins_template.json",
        'activity_ins_language_kr': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/ShareCfg/activity_ins_language.json",
        'activity_ins_language_cn': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/CN/ShareCfg/activity_ins_language.json",
        'activity_ins_npc_template': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/CN/ShareCfg/activity_ins_npc_template.json"
    }
    
    def __init__(self):
        """Initialize the processor with empty data containers."""
        self.name_code_dict = {}
        self.processed_activity_data = {}
        
        # Language data caches
        self.activity_ins_language_kr_data = {}
        self.activity_ins_language_cn_data = {}
        self.activity_ins_npc_template_data = {}
    
    @staticmethod
    def fetch_json_data(url: str) -> Dict[str, Any]:
        """
        Fetches JSON data from a given URL.
        
        Args:
            url: The URL to fetch data from
            
        Returns:
            Dictionary containing the JSON data
            
        Raises:
            requests.exceptions.RequestException: If the request fails
        """
        try:
            response = requests.get(url)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Error fetching data from {url}: {e}")
            raise
    
    def replace_name_codes(self, text: Any, name_code_dict: Dict[str, str]) -> Any:
        """
        Recursively replaces name codes in text or nested structures.
        
        Args:
            text: Text or data structure to process
            name_code_dict: Dictionary mapping name codes to names
            
        Returns:
            Processed text/data with name codes replaced
        """
        if isinstance(text, dict):
            return {key: self.replace_name_codes(value, name_code_dict) for key, value in text.items()}
        elif isinstance(text, list):
            return [self.replace_name_codes(item, name_code_dict) for item in text]
        elif isinstance(text, str):
            matches = re.findall(r"\{namecode:(\d+)\}", text)
            for match in matches:
                name = name_code_dict.get(match, f"UnknownNameCode:{match}")
                text = text.replace(f"{{namecode:{match}}}", name)
            return text
        return text
    
    def translate_text_safe(self, text: str, source_key: str) -> str:
        """
        Safely translates text from Chinese to Korean with error handling.
        
        Args:
            text: Text to translate
            source_key: Source key for error logging
            
        Returns:
            Translated text with appropriate prefixes
        """
        try:
            translated = ts.translate_text(text, translator='google', from_language='zh-CN', to_language='ko')
            return f"(파파고){translated}"
        except Exception as e:
            print(f"Translation error for key {source_key}: {e}")
            return f"(Translation Failed) {text}"
    
    def get_localized_text(self, key: str) -> str:
        """
        Gets localized text, preferring Korean but falling back to translated Chinese.
        
        Args:
            key: Language key to look up
            
        Returns:
            Localized text string
        """
        if not isinstance(key, str):
            return ""
        
        # Try Korean first
        kr_data = self.activity_ins_language_kr_data.get(key)
        if kr_data and isinstance(kr_data, dict) and kr_data.get('value'):
            return kr_data.get('value')
        
        # Fall back to Chinese with translation
        cn_data = self.activity_ins_language_cn_data.get(key)
        if cn_data and isinstance(cn_data, dict) and cn_data.get('value'):
            return self.translate_text_safe(cn_data.get('value'), key)
        
        return "Translation Source Missing"
    
    def process_activity_data(self) -> None:
        """Process activity Instagram-style post data."""
        print("Processing activity data...")
        
        try:
            # Fetch required data
            activity_ins_data = self.fetch_json_data(self.URLS['activity_ins_template'])
            self.activity_ins_language_kr_data = self.fetch_json_data(self.URLS['activity_ins_language_kr'])
            self.activity_ins_language_cn_data = self.fetch_json_data(self.URLS['activity_ins_language_cn'])
            self.activity_ins_npc_template_data = self.fetch_json_data(self.URLS['activity_ins_npc_template'])
            
            # Process each activity
            for activity_id, activity_info in activity_ins_data.items():
                if not isinstance(activity_info, dict):
                    continue
                
                processed_activity = self._process_single_activity(activity_info)
                if processed_activity:
                    self.processed_activity_data[processed_activity['id']] = processed_activity
            
            print(f"Processed {len(self.processed_activity_data)} activities")
            
        except Exception as e:
            print(f"Error processing activity data: {e}")
            raise
    
    def _process_single_activity(self, activity_info: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Process a single activity entry.
        
        Args:
            activity_info: Raw activity information
            
        Returns:
            Processed activity data or None if invalid
        """
        ship_group = activity_info.get("ship_group")
        activity_id = activity_info.get("id")
        message_persist = activity_info.get("message_persist")
        npc_discuss_persist = activity_info.get("npc_discuss_persist", [])
        
        if ship_group is None or activity_id is None:
            return None
        
        # Get main message
        message_text = self.get_localized_text(message_persist)
        
        # Process reply groups
        reply_groups = self._process_reply_groups(npc_discuss_persist)
        
        # Collect all shipgirl names
        shipgirl_names = {ship_group}
        for reply_group in reply_groups.values():
            for reply_data in reply_group.values():
                if isinstance(reply_data, dict):
                    shipgirl_names.update(reply_data.keys())
        
        # Create processed activity
        processed = {
            "id": activity_id,
            "ship_group": ship_group,
            "message": message_text,
            "name": activity_info.get("name"),
            "picture_persist": activity_info.get("picture_persist"),
            "shipgirl_names": list(shipgirl_names),
            **reply_groups
        }
        
        # Add operation options and replies
        self._add_operation_data(processed, activity_id)
        
        return processed
    
    def _process_reply_groups(self, npc_discuss_persist: List[str]) -> Dict[str, Dict[int, Dict[str, str]]]:
        """
        Process NPC discussion/reply groups.
        
        Args:
            npc_discuss_persist: List of NPC IDs
            
        Returns:
            Dictionary of processed reply groups
        """
        reply_groups = {}
        
        if not isinstance(npc_discuss_persist, list) or not npc_discuss_persist:
            return reply_groups
        
        for i, npc_id in enumerate(npc_discuss_persist):
            npc_data = self.activity_ins_npc_template_data.get(str(npc_id))
            if not npc_data:
                continue
            
            reply_group_key = f"reply_group{i+1}"
            reply_process = {}
            check_id = 1
            
            # Process main message
            message_persist = npc_data.get("message_persist")
            reply_ship_group = npc_data.get("ship_group")
            
            if message_persist and reply_ship_group:
                message_text = self.get_localized_text(message_persist)
                if message_text:
                    reply_process[check_id] = {reply_ship_group: message_text}
                    check_id += 1
            
            # Process NPC replies
            npc_reply_persist = npc_data.get("npc_reply_persist", [])
            for reply_id in npc_reply_persist:
                reply_npc_data = self.activity_ins_npc_template_data.get(str(reply_id))
                if reply_npc_data:
                    reply_message_persist = reply_npc_data.get("message_persist")
                    reply_npc_ship_group = reply_npc_data.get("ship_group")
                    
                    if reply_message_persist and reply_npc_ship_group:
                        reply_message_text = self.get_localized_text(reply_message_persist)
                        if reply_message_text:
                            reply_process[check_id] = {reply_npc_ship_group: reply_message_text}
                            check_id += 1
            
            if reply_process:
                reply_groups[reply_group_key] = reply_process
        
        return reply_groups
    
    def _add_operation_data(self, processed_activity: Dict[str, Any], activity_id: int) -> None:
        """
        Add operation options and replies to processed activity.
        
        Args:
            processed_activity: Activity data being processed
            activity_id: Activity ID for constructing keys
        """
        operations = [
            (f"ins_op_{activity_id}_1_1", "op_option1", None),
            (f"op_reply_{activity_id}_1_1", "op_reply1", "reply1_shipgirl"),
            (f"ins_op_{activity_id}_1_2", "op_option2", None),
            (f"op_reply_{activity_id}_1_2", "op_reply2", "reply2_shipgirl")
        ]
        
        for lang_key, new_key, shipgirl_key in operations:
            # Get localized text
            language_text = self.get_localized_text(lang_key)
            processed_activity[new_key] = language_text
            
            # Find shipgirl for reply options
            if shipgirl_key:
                shipgirl_id = None
                for npc_id, npc_info in self.activity_ins_npc_template_data.items():
                    if isinstance(npc_info, dict) and npc_info.get("message_persist") == lang_key:
                        shipgirl_id = npc_info.get("ship_group")
                        break
                processed_activity[shipgirl_key] = shipgirl_id
    
    def finalize_processing(self) -> None:
        """Apply final processing steps like name code replacement and save data."""
        print("Finalizing data processing...")
        
        # Apply name code replacement to all processed data
        self.processed_activity_data = self.replace_name_codes(
            self.processed_activity_data, 
            self.name_code_dict
        )
        
        # Save processed data
        with open('./output/juustagram_data.json', 'w', encoding='utf-8') as f:
            json.dump(self.processed_activity_data, f, indent=4, ensure_ascii=False)

        print(f"Saved {len(self.processed_activity_data)} processed activities to './output/juustagram_data.json'")
        print("Sample processed data:")
        for i, (key, value) in enumerate(self.processed_activity_data.items()):
            if i >= 2:  # Show only first 2 entries
                break
            print(f"  Activity {key}: {value.get('message', 'No message')[:50]}...")
    
    def run(self) -> None:
        """Run the complete data processing pipeline."""
        print("Starting Azur Lane data processing...")
        
        try:
            self.process_activity_data()
            self.finalize_processing()
            print("\nData processing completed successfully!")
            
        except Exception as e:
            print(f"Error during processing: {e}")
            raise


def main():
    """Main entry point for the script."""
    processor = AzurLaneDataProcessor()
    processor.run()


if __name__ == "__main__":
    main()