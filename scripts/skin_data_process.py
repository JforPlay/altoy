import requests
import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional
import logging
import json

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AzurLaneDataProcessor:
    """Process and combine Azur Lane skin and ship data from multiple sources."""
    
    # API URLs
    URLS = {
        'skin_list': "https://raw.githubusercontent.com/Fernando2603/AzurLane/refs/heads/main/skin_list.json",
        'kr_skin_template': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/ship_skin_template.json",
        'words': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/sharecfgdata/ship_skin_words.json",
        'words_extra': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/ship_skin_words_extra.json",
        'name_code': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/name_code.json",
        'shop_template': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/sharecfgdata/shop_template.json",
        'ship_data': "https://raw.githubusercontent.com/Fernando2603/AzurLane/refs/heads/main/ship.json",
        'voicelink': "https://raw.githubusercontent.com/Fernando2603/AzurLane/refs/heads/main/voicelink.json"
    }
    
    # Data mappings
    RARITY_MAPPING = {6: 'UR', 5: 'SSR', 4: 'SR', 3: 'R', 2: 'N'}
    
    NATIONALITY_MAPPING = {
        0: 'UNIV', 1: 'USS', 2: 'HMS', 3: 'IJN', 4: 'KMS', 5: 'ROC',
        6: 'RN', 7: 'SN', 8: 'FFNF', 9: 'MNF',
        10: 'FFNF (FR, iris orthodoxy)', 96: 'MOT', 97: 'META',
        98: 'UNIV (bulin)', 100: 'LINK (collab)', 101: 'HDN (neptune)',
        102: 'BILI', 103: 'UM (utawarerumono)', 104: 'AI (kizuna)',
        105: 'HOLO', 106: 'DOA', 107: 'IMAS', 108: 'SSSS', 109: 'RYZA',
        110: 'SENRAN'
    }
    
    TAG_MAPPING = {
        1: "L2D", 2: "배경", 4: "특수배경 (움짤)", 5: "브금",
        6: "쁘띠모션", 7: "중파 일러", 8: "듀얼", 9: "L2D+", 10: "입막음"
    }
    
    SKIN_TYPE_KOREAN_MAPPING = {
        1: '크리스마스', 2: '정월', 3: '이스트 글림 스타일', 4: '학교',
        6: '수영복', 7: '파티', 8: '할로윈', 9: '사복', 10: '여름 축제',
        11: 'Live', 12: '특수 훈련', 13: '스포츠', 14: '극속광열',
        15: '병원', 16: '카니발', 17: '메이드 타임', 18: '블러드 문',
        19: '동화 속 세계', 20: '홈웨어', 21: '댄스', 22: '온천 타임',
        23: '오피스 타임', 24: '이세계 모험', 25: '웨스턴', 26: '동화 속 세계',
        27: '이집트 스타일', 28: '닌자의 성', 9997: '개조', 9998: '서약',
        9999: '기타'
    }
    
    # Voice line fields to extract (excluding 'main' as it will be split)
    WORDS_FIELDS = [
        "battle", "couple_encourage", "detail", "drop_descrip", "expedition",
        "feeling1", "feeling2", "feeling3", "feeling4", "feeling5", "headtouch",
        "home", "hp_warning", "login", "lose", "mail", "mission",
        "mission_complete", "profile", "propose", "skill", "touch", "touch2",
        "unlock", "upgrade", "vote", "win_mvp"
    ]
    
    # Column mapping for Korean headers (excluding main, will add main1, main2, etc. dynamically)
    COLUMN_MAPPING = {
        "id": "클뜯 id", "gid": "클뜯 함순이 id", "shipgirl_name": "함순이 이름",
        "kr_name": "한글 함순이 + 스킨 이름", "name": "영문 함순이 + 스킨 이름",
        "type": "스킨 타입", "painting": "전체 일러", "painting_n": "확대 일러",
        "chibi": "sd 일러", "icon": "아이콘 일러", "qicon": "쥬스타 아이콘 일러",
        "shipyard": "깔끔한 일러", "desc": "설명", "battle": "전투개시",
        "couple_encourage": "함대 특수대사", "detail": "상세확인", "drop_descrip": "드랍 설명",
        "expedition": "의뢰 완료", "feeling1": "실망", "feeling2": "낯섦", "feeling3": "호감",
        "feeling4": "기쁨", "feeling5": "사랑", "headtouch": "터치3", "home": "모항귀환",
        "hp_warning": "hp 경고", "login": "로그인", "lose": "실패", "mail": "우편",
        "mission": "임무", "mission_complete": "임무완료",
        "profile": "자기소개", "propose": "서약", "skill": "스킬", "touch": "터치1",
        "touch2": "터치2", "unlock": "입수시", "upgrade": "강화성공", "vote": "vote",
        "win_mvp": "승리", "shop_id": "상점 id", "shop_type_id": "상점 카테고리 id",
        "tag": "스킨 태그", "get_showing": "입수 영상", "resource_num": "재화",
        "time": "기간", "nationality": "진영", "rarity": "레어도"
    }
    
    # Define fields needed for the lightweight skin list
    SKIN_LIST_FIELDS = [
        "클뜯 id",
        "함순이 이름",
        "한글 함순이 + 스킨 이름",
        "스킨 타입 - 한글",
        "깔끔한 일러",
        "스킨 태그",
        "진영",
        "레어도",
        "재화",
        "기간",
        "ex_chat_status"
    ]

    # NEW: Strict name overrides for specific GIDs
    STRICT_NAME_OVERRIDES = {
        30507: "카가(전함)",
        20232: "엔터프라이즈(경순)",
        1010001: "넵튠(콜라보)",
        1060003: "카스미(콜라보)",
        1100005: "후부키(콜라보)"
    }
    
    def __init__(self):
        self.data = {}
        self.processed_data = []
        
    def fetch_json_data(self, url: str) -> Dict[str, Any]:
        """Fetch JSON data from URL with error handling."""
        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Error fetching data from {url}: {e}")
            raise
    
    def load_all_data(self) -> None:
        """Load all required data from APIs."""
        logger.info("Fetching data from all sources...")
        for key, url in self.URLS.items():
            logger.info(f"Fetching {key}...")
            self.data[key] = self.fetch_json_data(url)
    
    def create_lookup_dictionaries(self) -> Dict[str, Dict]:
        """Create lookup dictionaries for efficient data merging."""
        # Build name_code lookup properly
        name_code_lookup = {}
        for key, value in self.data['name_code'].items():
            if isinstance(value, dict) and 'name' in value:
                name = value.get('name')
                if name:  # Only add if name exists
                    name_code_lookup[f"{{namecode:{key}}}"] = name
        
        lookups = {
            'kr_skin': {str(item["id"]): item for item in self.data['kr_skin_template'].values()},
            'words': {skin_id: item for skin_id, item in self.data['words'].items()},
            'words_extra': {str(gid): item for gid, item in self.data['words_extra'].items()},
            'shop_template': {str(item["id"]): item for item in self.data['shop_template'].values()},
            'ship': {str(item["gid"]): item for item in self.data['ship_data']},
            'name_code': name_code_lookup,
            'voicelink': {str(skin_id): voice_data for skin_id, voice_data in self.data['voicelink'].items()}
        }
        return lookups
    
    def initialize_skin_data(self) -> List[Dict]:
        """Initialize basic skin data structure."""
        basic_fields = ["id", "gid", "name", "type", "painting", "painting_n", 
                       "chibi", "icon", "qicon", "shipyard"]
        
        return [{field: skin.get(field) for field in basic_fields} 
                for skin in self.data['skin_list']]
    
    def merge_kr_skin_data(self, skin_data: List[Dict], lookups: Dict) -> Dict[int, str]:
        """Merge Korean skin template data and build GID to name mapping."""
        gid_to_kr_name = {}
        
        for skin in skin_data:
            skin_id = str(skin.get("id"))
            gid = skin.get("gid")
            
            if skin_id in lookups['kr_skin']:
                kr_data = lookups['kr_skin'][skin_id]

                # process strict name overrides
                if int(skin_id[:-1]) in self.STRICT_NAME_OVERRIDES and skin_id.endswith('0'):
                    skin_kr_name = self.STRICT_NAME_OVERRIDES[int(skin_id[:-1])]
                    print(int(skin_id[:-1]))
                else:
                    skin_kr_name = kr_data.get("name").strip()

                skin.update({
                    'kr_name': skin_kr_name,
                    'desc': kr_data.get("desc"),
                    'shop_id': kr_data.get("shop_id"),
                    'shop_type_id': kr_data.get("shop_type_id"),
                    'tag': kr_data.get("tag"),
                    'get_showing': kr_data.get("get_showing")
                })
                
                # Build GID to Korean name mapping
                if gid is not None and skin['kr_name'] is not None and gid not in gid_to_kr_name:
                    # process strict name overrides
                    if gid in self.STRICT_NAME_OVERRIDES:
                        gid_to_kr_name[gid] = self.STRICT_NAME_OVERRIDES[gid]
                        print(gid)
                    else:
                        gid_to_kr_name[gid] = skin['kr_name']

            else:
                skin.update({key: None for key in ['kr_name', 'desc', 'shop_id', 
                           'shop_type_id', 'tag', 'get_showing']})
                print("아마도 한섭에 없는 스킨")
        
        return gid_to_kr_name
    
    def create_voice_dict(self, voiceline: str, voicelink: Optional[str]) -> Dict[str, Any]:
        """Create a dictionary containing voiceline and voicelink."""
        return {
            "voiceline": voiceline,
            "voicelink": voicelink
        }
    
    def merge_voice_data(self, skin_data: List[Dict], lookups: Dict) -> None:
        """Merge voice line data from words and words_extra with voice links."""
        for skin in skin_data:
            skin_id = str(skin.get("id"))
            voicelink_data = lookups['voicelink'].get(skin_id, {})
            
            # Regular voice lines
            if skin_id in lookups['words']:
                words_data = lookups['words'][skin_id]
                
                # Handle 'main' field specially - split by "|"
                main_text = words_data.get("main")
                if isinstance(main_text, str):
                    main_lines = main_text.split("|")
                    for i, line in enumerate(main_lines, start=1):
                        field_name = f"main{i}"
                        voice_link = voicelink_data.get(field_name)
                        skin[field_name] = self.create_voice_dict(line.strip(), voice_link)
                else:
                    skin["main1"] = self.create_voice_dict(None, None)
                
                # Handle couple_encourage specially - it has multiple voice lines
                couple_encourage_data = words_data.get("couple_encourage")
                if isinstance(couple_encourage_data, list) and couple_encourage_data:
                    # Store the raw data with voice links for each line
                    skin["couple_encourage_raw"] = couple_encourage_data
                    skin["couple_encourage_voices"] = []
                    for idx in range(1, len(couple_encourage_data) + 1):
                        voice_link = voicelink_data.get(f"couple_encourage{idx}")
                        skin["couple_encourage_voices"].append(voice_link)
                else:
                    skin["couple_encourage_raw"] = None
                    skin["couple_encourage_voices"] = []
                
                # Handle other voice fields (excluding couple_encourage as it's handled above)
                for field in self.WORDS_FIELDS:
                    if field != "couple_encourage":
                        voiceline = words_data.get(field)
                        voice_link = voicelink_data.get(field)
                        skin[field] = self.create_voice_dict(voiceline, voice_link)
            else:
                # No data found
                skin["main1"] = self.create_voice_dict(None, None)
                skin["couple_encourage_raw"] = None
                skin["couple_encourage_voices"] = []
                for field in self.WORDS_FIELDS:
                    if field != "couple_encourage":
                        skin[field] = self.create_voice_dict(None, None)
            
            # Extra voice lines - check voicelink_data to determine what exists
            if skin_id in lookups['words_extra']:
                words_extra_data = lookups['words_extra'][skin_id]
                
                # Determine which main_ex fields exist in voicelink
                main_ex_count = 0
                existing_main_count = len([k for k in skin.keys() if k.startswith("main") and not k.endswith("_ex")])
                
                # Check voicelink_data to see which main_ex fields are present
                for key in voicelink_data.keys():
                    if key.startswith("main") and key.endswith("_ex"):
                        try:
                            num = int(key.replace("main", "").replace("_ex", ""))
                            main_ex_count = max(main_ex_count, num)
                        except ValueError:
                            continue
                
                # If main_ex exists in voicelink, determine if it's from 'main' or 'main_extra'
                if main_ex_count > 0:
                    # Check if 'main' field exists in words_extra (these would be main1_ex, main2_ex, etc.)
                    main_extra = words_extra_data.get("main")
                    if main_extra is not None:
                        # Handle list format from words_extra
                        if isinstance(main_extra, list) and main_extra and isinstance(main_extra[0], list):
                            if len(main_extra[0]) > 1:
                                main_extra_text = main_extra[0][1]
                            else:
                                main_extra_text = None
                        else:
                            main_extra_text = str(main_extra) if main_extra is not None else None
                        
                        if isinstance(main_extra_text, str):
                            main_lines_ex = main_extra_text.split("|")
                            for i, line in enumerate(main_lines_ex, start=1):
                                field_name = f"main{i}_ex"
                                voice_link = voicelink_data.get(field_name)
                                skin[field_name] = self.create_voice_dict(line.strip(), voice_link)
                    
                    # Check if 'main_extra' field exists (these would continue numbering)
                    main_extra_field = words_extra_data.get("main_extra")
                    if main_extra_field is not None:
                        # Handle list format
                        if isinstance(main_extra_field, list) and main_extra_field and isinstance(main_extra_field[0], list):
                            if len(main_extra_field[0]) > 1:
                                main_extra_text = main_extra_field[0][1]
                            else:
                                main_extra_text = None
                        else:
                            main_extra_text = str(main_extra_field) if main_extra_field is not None else None
                        
                        if isinstance(main_extra_text, str):
                            main_lines_extra = main_extra_text.split("|")
                            # Start numbering after the regular main count
                            start_num = existing_main_count + 1
                            
                            for i, line in enumerate(main_lines_extra, start=start_num):
                                field_name = f"main{i}_ex"
                                voice_link = voicelink_data.get(field_name)
                                skin[field_name] = self.create_voice_dict(line.strip(), voice_link)
                
                # Handle other extra voice fields
                for field in self.WORDS_FIELDS:
                    if field != "couple_encourage":
                        field_ex = f"{field}_ex"
                        extra_data = words_extra_data.get(field)
                        voice_link = voicelink_data.get(field_ex)
                        
                        # Process the extra data
                        if extra_data is not None:
                            if isinstance(extra_data, list) and extra_data and isinstance(extra_data[0], list):
                                if len(extra_data[0]) > 1:
                                    processed_data = extra_data[0][1]
                                else:
                                    processed_data = None
                            else:
                                processed_data = str(extra_data)
                        else:
                            processed_data = None
                        
                        skin[field_ex] = self.create_voice_dict(processed_data, voice_link)
            else:
                # No extra data found
                for field in self.WORDS_FIELDS:
                    if field != "couple_encourage":
                        skin[f"{field}_ex"] = self.create_voice_dict(None, None)
    
    def merge_ship_metadata(self, skin_data: List[Dict], lookups: Dict, gid_to_kr_name: Dict) -> None:
        """Merge ship metadata (nationality, rarity, shipgirl name)."""
        for skin in skin_data:
            gid = skin.get("gid")
            
            if str(gid) in lookups['ship']:
                ship_info = lookups['ship'][str(gid)]
                nationality_value = ship_info.get("nationality")
                rarity_value = ship_info.get("rarity")
                
                skin['nationality'] = self.NATIONALITY_MAPPING.get(nationality_value, nationality_value)
                skin['rarity'] = self.RARITY_MAPPING.get(rarity_value, rarity_value)
            else:
                skin['nationality'] = None
                skin['rarity'] = None
            
            skin['shipgirl_name'] = gid_to_kr_name.get(gid) if gid is not None else None
    
    def merge_shop_data(self, skin_data: List[Dict], lookups: Dict) -> None:
        """Merge shop template data."""
        for skin in skin_data:
            shop_id = str(skin.get("shop_id")) if skin.get("shop_id") is not None else None
            
            if shop_id and shop_id in lookups['shop_template']:
                shop_data = lookups['shop_template'][shop_id]
                skin['resource_num'] = shop_data.get("resource_num")
                skin['time'] = shop_data.get("time")
            else:
                skin['resource_num'] = None
                skin['time'] = None
    
    def process_couple_encourage(self, skin_data: List[Dict], gid_to_kr_name: Dict) -> None:
        """Process couple encourage field with GID to name mapping and voice links."""
        for skin in skin_data:
            # Get the raw data and voice links
            couple_encourage_list = skin.get("couple_encourage_raw")
            voice_links = skin.get("couple_encourage_voices", [])
            
            if isinstance(couple_encourage_list, list) and couple_encourage_list:
                processed_entries = []
                
                for idx, sublist in enumerate(couple_encourage_list):
                    if (isinstance(sublist, list) and sublist and 
                        isinstance(sublist[0], list) and sublist[0]):
                        
                        processed_items = []
                        for item in sublist[0]:
                            if isinstance(item, int):
                                # Check if it's a GID (ship name) or nationality code
                                if item in gid_to_kr_name:
                                    processed_items.append(gid_to_kr_name.get(item))
                                elif item in self.NATIONALITY_MAPPING:
                                    processed_items.append(self.NATIONALITY_MAPPING.get(item))
                                else:
                                    processed_items.append(item)
                            elif isinstance(item, str):
                                # Try to convert string to int and check if it's a nationality
                                try:
                                    int_value = int(item)
                                    if int_value in self.NATIONALITY_MAPPING:
                                        processed_items.append(self.NATIONALITY_MAPPING.get(int_value))
                                    elif int_value in gid_to_kr_name:
                                        processed_items.append(gid_to_kr_name.get(int_value))
                                    else:
                                        processed_items.append(item)
                                except (ValueError, TypeError):
                                    # Not a number, keep as is
                                    processed_items.append(item)
                            else:
                                processed_items.append(item)
                        
                        line_text = f"{processed_items} : {sublist[2]}" if len(sublist) > 2 and sublist[2] else f"{processed_items}"
                        
                        # Get the corresponding voice link
                        voice_link = voice_links[idx] if idx < len(voice_links) else None
                        
                        processed_entries.append({
                            "voiceline": line_text,
                            "voicelink": voice_link
                        })
                
                # Store as a list of dictionaries
                skin['couple_encourage'] = processed_entries if processed_entries else None
            else:
                skin['couple_encourage'] = None
            
            # Clean up temporary fields
            if 'couple_encourage_raw' in skin:
                del skin['couple_encourage_raw']
            if 'couple_encourage_voices' in skin:
                del skin['couple_encourage_voices']
    
    def process_ex_fields(self, skin_data: List[Dict]) -> None:
        """Check if any _ex fields have data."""
        for skin in skin_data:
            has_ex_chat = 0
            for key, value in skin.items():
                if key.endswith("_ex") and isinstance(value, dict):
                    voiceline = value.get("voiceline")
                    if voiceline is not None:
                        has_ex_chat = 1
                        break
            
            skin['ex_chat_status'] = has_ex_chat
    
    def process_special_fields(self, skin_data: List[Dict]) -> None:
        """Process special field formatting."""
        for skin in skin_data:
            # Process tag field: convert numbers to Korean strings
            tags = skin.get("tag")
            if isinstance(tags, list):
                if not tags:
                    skin['tag'] = "X"
                else:
                    tag_strings = [self.TAG_MAPPING.get(tag, str(tag)) for tag in tags]
                    skin['tag'] = ", ".join(tag_strings)
            else:
                skin['tag'] = "X"
            
            # Process time field with formatting
            time_value = skin.get('time')
            if time_value == 'always':
                skin['time'] = '상시'
            elif (isinstance(time_value, list) and time_value and 
                  isinstance(time_value[0], list) and len(time_value[0]) > 1 and 
                  isinstance(time_value[0][1], list) and time_value[0][1]):
                # Format the date
                date_list = time_value[1][0]
                if isinstance(date_list, list) and len(date_list) >= 3:
                    year, month, day = date_list[0], date_list[1], date_list[2]
                    mm = str(month).zfill(2)
                    dd = str(day).zfill(2)
                    skin['time'] = f'한정 ({year}/{mm}/{dd})'
                else:
                    skin['time'] = f'한정, {time_value[1][0]}'
            else:
                skin['time'] = None
            
            # Process get_showing field
            get_showing_value = skin.get('get_showing')
            skin['get_showing'] = 'O' if get_showing_value not in [None, ''] else 'X'

    
    def create_dataframe(self, skin_data: List[Dict], lookups: Dict) -> pd.DataFrame:
        """Create and process the final DataFrame."""
        df = pd.DataFrame(skin_data)
        
        # Generate Korean column names for main fields dynamically
        main_cols = [col for col in df.columns if col.startswith("main") and not col.endswith("_ex")]
        main_ex_cols = [col for col in df.columns if col.startswith("main") and col.endswith("_ex")]
        
        # Update COLUMN_MAPPING with main fields
        for col in main_cols:
            self.COLUMN_MAPPING[col] = f"메인{col.replace('main', '')}"
        
        # Rename columns to Korean
        df = df.rename(columns=self.COLUMN_MAPPING)
        
        # Add _ex suffix to Korean column names for extra voice lines
        for field in self.WORDS_FIELDS:
            if f"{field}_ex" in df.columns:
                korean_name = self.COLUMN_MAPPING.get(field, field)
                df = df.rename(columns={f"{field}_ex": f"{korean_name}_ex"})
        
        # Rename main_ex columns
        for col in main_ex_cols:
            main_num = col.replace("main", "").replace("_ex", "")
            df = df.rename(columns={col: f"메인{main_num}_ex"})
        
        # Drop unwanted columns
        columns_to_drop = ["실망_ex", "낯섦_ex", "호감_ex", "기쁨_ex", 
                          "드랍 설명_ex", "자기소개_ex", "서약_ex", "vote_ex", "함대 특수대사_ex"]
        df = df.drop(columns=columns_to_drop, errors='ignore')
        
        # Convert numeric columns
        cols_to_int = ["재화", "상점 id", "상점 카테고리 id"]
        for col in cols_to_int:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce').astype('Int64')
        
        # Replace name codes in voiceline fields (handles both dicts and lists)
        for col in df.columns:
            df[col] = df[col].apply(lambda x: self.replace_name_codes_in_dict(x, lookups['name_code']) 
                                   if isinstance(x, (dict, list)) else 
                                   (self.replace_name_codes_in_text(x, lookups['name_code']) 
                                    if isinstance(x, str) else x))
        
        # Process dual and mute tags
        self.process_special_tags(df)
        
        # Add skin type Korean mapping
        df['스킨 타입 - 한글'] = df['상점 카테고리 id'].map(self.SKIN_TYPE_KOREAN_MAPPING)
        
        return df
    
    def replace_name_codes_in_dict(self, voice_data: Any, name_code_dict: Dict) -> Any:
        """Replace name codes in voiceline field of dictionary or list of dictionaries."""
        if isinstance(voice_data, dict):
            voiceline = voice_data.get("voiceline")
            if isinstance(voiceline, str):
                for code, name in name_code_dict.items():
                    if name and code in voiceline:  # Only replace if name exists and code is in text
                        voiceline = voiceline.replace(code, name)
                voice_data["voiceline"] = voiceline
            return voice_data
        elif isinstance(voice_data, list):
            # Handle list of dictionaries (for couple_encourage)
            return [self.replace_name_codes_in_dict(item, name_code_dict) for item in voice_data]
        else:
            return voice_data
    
    def replace_name_codes_in_text(self, text: str, name_code_dict: Dict) -> str:
        """Replace name codes in plain text fields."""
        if isinstance(text, str):
            for code, name in name_code_dict.items():
                if name and code in text:  # Only replace if name exists and code is in text
                    text = text.replace(code, name)
        return text
    
    def process_special_tags(self, df: pd.DataFrame) -> None:
        """Process special tags like dual and mute."""
        check_mute = 0
        for index, row in df.iterrows():
            tag_value = row['스킨 태그']
            kr_name_value = row['한글 함순이 + 스킨 이름']
            
            if isinstance(tag_value, str) and isinstance(kr_name_value, str):
                if '듀얼' in tag_value:
                    df.loc[index, '한글 함순이 + 스킨 이름'] = f"{kr_name_value} ({tag_value})"
                
                if '입막음' in tag_value:
                    if check_mute == 1:
                        df.loc[index, '한글 함순이 + 스킨 이름'] = f"{kr_name_value} (입막음)"
                        check_mute = 0
                    else:
                        check_mute = 1
    
    def reorder_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """Reorder DataFrame columns."""
        initial_cols = ['클뜯 id', '클뜯 함순이 id', '함순이 이름', '한글 함순이 + 스킨 이름', 
                       '영문 함순이 + 스킨 이름', '스킨 타입', '전체 일러', '확대 일러', 'sd 일러', 
                       '아이콘 일러', '쥬스타 아이콘 일러', '깔끔한 일러', '설명', '자기소개']
        end_cols = ['스킨 타입 - 한글', '상점 id', '상점 카테고리 id', '스킨 태그', '입수 영상', 
                   '재화', '기간', '진영', '레어도', 'ex_chat_status']
        
        all_cols = df.columns.tolist()
        ordered_cols = [col for col in initial_cols if col in all_cols]
        remaining_cols = [col for col in all_cols if col not in ordered_cols and col not in end_cols]
        ordered_cols.extend(remaining_cols)
        ordered_cols.extend([col for col in end_cols if col in all_cols])
        
        return df[ordered_cols]
    
    def create_lightweight_subset(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create a lightweight subset with only fields needed for skin list page."""
        # Select only required columns
        subset_df = df[self.SKIN_LIST_FIELDS].copy()
        
        # Pre-compute isNew flag for each skin
        from datetime import datetime
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        
        def compute_is_new(row):
            """Compute if skin is new based on date."""
            period = row['기간']
            if period and '한정' in str(period):
                try:
                    # Extract date from string like "한정, [2024, 10, 5]"
                    date_str = period[period.index('['):period.index(']')+1]
                    date_list = json.loads(date_str)
                    skin_date = datetime(date_list[0], date_list[1], date_list[2])
                    return skin_date >= today
                except:
                    pass
            return False
        
        subset_df['isNew'] = subset_df.apply(compute_is_new, axis=1)
        
        return subset_df
    
    def process_data(self) -> pd.DataFrame:
        """Main processing pipeline."""
        try:
            # Load all data
            self.load_all_data()
            
            # Create lookup dictionaries
            lookups = self.create_lookup_dictionaries()
            
            # Initialize skin data
            skin_data = self.initialize_skin_data()
            
            # Merge all data sources
            logger.info("Merging data sources...")
            gid_to_kr_name = self.merge_kr_skin_data(skin_data, lookups)
            self.merge_voice_data(skin_data, lookups)
            self.merge_ship_metadata(skin_data, lookups, gid_to_kr_name)
            self.merge_shop_data(skin_data, lookups)
            
            # Process special fields
            logger.info("Processing special fields...")
            self.process_couple_encourage(skin_data, gid_to_kr_name)
            self.process_ex_fields(skin_data)
            self.process_special_fields(skin_data)
            
            # Create DataFrame
            logger.info("Creating DataFrame...")
            df = self.create_dataframe(skin_data, lookups)
            df = self.reorder_columns(df)
            
            logger.info("Data processing completed successfully!")
            return df
            
        except Exception as e:
            logger.error(f"Error during processing: {e}")
            raise
    
    def clean_empty_voice_data(self, df: pd.DataFrame) -> pd.DataFrame:
        """Remove voice fields where both voiceline and voicelink are null/empty."""
        def is_empty_voice_dict(value):
            """Check if a voice dictionary is empty."""
            if not isinstance(value, dict):
                return False
            voiceline = value.get("voiceline")
            voicelink = value.get("voicelink")
            return (voiceline is None or voiceline == "") and (voicelink is None or voicelink == "")
        
        def is_empty_voice_list(value):
            """Check if a voice list (for couple_encourage) is empty."""
            if not isinstance(value, list):
                return False
            if not value:  # Empty list
                return True
            # Check if all items in list are empty
            return all(is_empty_voice_dict(item) for item in value)
        
        def clean_value(value):
            """Clean a single value - return None if empty."""
            if is_empty_voice_dict(value) or is_empty_voice_list(value):
                return None
            return value
        
        # Apply cleaning to all columns
        for col in df.columns:
            df[col] = df[col].apply(clean_value)
        
        return df
    
    def save_data(self, df: pd.DataFrame, 
                  full_json_path: str = './output/skin/skin_voiceline_data.json',
                  subset_json_path: str = './output/skin/skin_voiceline_data_subset.json') -> None:
        """Save processed data to JSON files (full and lightweight subset)."""
        try:
            # Clean empty voice data before saving
            df_cleaned = self.clean_empty_voice_data(df.copy())
            
            # Save full JSON
            logger.info(f"Saving full dataset to {full_json_path}...")
            df_cleaned.to_json(full_json_path, orient='records', indent=4, force_ascii=False)
            
            # Create and save lightweight subset
            logger.info(f"Creating lightweight subset...")
            subset_df = self.create_lightweight_subset(df_cleaned)
            
            logger.info(f"Saving lightweight subset to {subset_json_path}...")
            subset_df.to_json(subset_json_path, orient='records', indent=4, force_ascii=False)

            # Calculate size reduction
            import os
            if os.path.exists(full_json_path) and os.path.exists(subset_json_path):
                full_size = os.path.getsize(full_json_path) / (1024 * 1024)  # MB
                subset_size = os.path.getsize(subset_json_path) / (1024 * 1024)  # MB
                reduction = ((full_size - subset_size) / full_size) * 100
                
                logger.info(f"✓ Full dataset: {full_size:.2f} MB")
                logger.info(f"✓ Subset: {subset_size:.2f} MB")
                logger.info(f"✓ Size reduction: {reduction:.1f}%")
            
        except Exception as e:
            logger.error(f"Error saving data: {e}")
            raise


def main():
    """Main execution function."""
    processor = AzurLaneDataProcessor()
    
    try:
        # Process the data
        df = processor.process_data()
        
        # Save both full and lightweight versions
        processor.save_data(df)
        
        print(f"\n✓ Processing completed!")
        print(f"✓ Full dataset shape: {df.shape}")
        print(f"✓ Files created:")
        print(f"  - skin_voiceline_data.json (full)")
        print(f"  - skin_voiceline_data_subset.json (lightweight)")
        
    except Exception as e:
        logger.error(f"Processing failed: {e}")
        raise


if __name__ == "__main__":
    main()