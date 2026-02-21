"""
Equipment Data Processor for ALtoy Equipment Viewer.

Processes raw equip_data_statistics.json and equip_data_template.json into
lite (list view) and full (detail view) JSON outputs.

Processing steps:
1. Load raw statistics, template, and mapping files
2. Resolve base/child inheritance in statistics
3. Filter unusable entries (name="0", rarity <= 1)
4. Group by equipment family (base -> children as levels)
5. Merge template data (upgrade costs, scrap) per level
6. Pre-map attribute/nationality/type names to Korean
7. Output lite and full JSON
"""

import json
import os
import re
import sys
import urllib.request
from typing import Dict, List, Any, Optional

# Paths relative to script location
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(PROJECT_DIR, "public", "data")
EQUIP_DIR = os.path.join(DATA_DIR, "equip")       # Processed output
MAPPING_DIR = os.path.join(DATA_DIR, "mapping")

# Remote source URLs (AzurLaneData KR)
STATISTICS_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/sharecfgdata/equip_data_statistics.json"
TEMPLATE_URL = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/sharecfgdata/equip_data_template.json"

# equip_data_statistics.json is also served to the browser (for anti_siren display)
STATISTICS_LOCAL_PATH = os.path.join(EQUIP_DIR, "equip_data_statistics.json")
EQUIP_TYPE_PATH = os.path.join(MAPPING_DIR, "equip_data_by_type.json")
NATIONALITY_PATH = os.path.join(MAPPING_DIR, "nationality_mapping.json")
SHIP_TYPE_PATH = os.path.join(MAPPING_DIR, "ship_type_mapping.json")
ATTR_TYPE_PATH = os.path.join(MAPPING_DIR, "attr_type_mapping.json")

# Output files
LITE_OUTPUT = os.path.join(EQUIP_DIR, "equip_data_lite.json")
FULL_OUTPUT = os.path.join(EQUIP_DIR, "equip_data_full.json")

# Rarity mapping
RARITY_NAMES = {
    1: "N",
    2: "N",
    3: "R",
    4: "SR",
    5: "SSR",
    6: "UR"
}


def load_json(path: str) -> Dict:
    """Load a JSON file."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def fetch_json(url: str) -> Dict:
    """Fetch and parse JSON from a URL."""
    print(f"  Fetching {url.split('/')[-1]} ...")
    with urllib.request.urlopen(url) as resp:
        return json.loads(resp.read().decode("utf-8"))


def save_json(data: Any, path: str) -> None:
    """Save data as JSON."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    size_kb = os.path.getsize(path) / 1024
    print(f"  Saved {path} ({size_kb:.1f} KB)")


def resolve_inheritance(stats: Dict) -> Dict[int, Dict]:
    """
    Resolve base/child inheritance in statistics data.
    Returns dict keyed by base ID with merged level data.
    Children inherit all fields from base, then override with their own.
    """
    # Separate bases and children
    bases = {}
    children_by_base = {}

    for str_id, entry in stats.items():
        entry_id = int(str_id)
        if "base" in entry:
            base_id = entry["base"]
            if base_id not in children_by_base:
                children_by_base[base_id] = []
            children_by_base[base_id].append(entry)
        else:
            bases[entry_id] = entry

    # Build families: base + merged children
    families = {}
    for base_id, base in bases.items():
        children = children_by_base.get(base_id, [])
        # Sort children by ID (ascending = upgrade order)
        children.sort(key=lambda c: c["id"])

        # Build levels array: base is level 0, children are subsequent levels
        levels = [base]
        for child in children:
            # Merge: start with base, override with child fields
            merged = {**base, **child}
            # Remove the 'base' key from merged result
            merged.pop("base", None)
            levels.append(merged)

        families[base_id] = {
            "base": base,
            "levels": levels,
            "level_count": len(levels)
        }

    return families


def filter_usable(families: Dict[int, Dict]) -> Dict[int, Dict]:
    """Filter out unusable equipment (name='0', rarity <= 1, no valid icon, untranslated names)."""
    HANGUL_RE = re.compile(r'[\uac00-\ud7af]')
    CJK_RE = re.compile(r'[\u4e00-\u9fff]')
    filtered = {}
    for base_id, family in families.items():
        base = family["base"]
        name = base.get("name", "0")
        rarity = base.get("rarity", 0)
        icon = str(base.get("icon", ""))

        # Skip placeholders, very low rarity, and entries without valid icons
        if name == "0" or rarity <= 1:
            continue
        if not icon or icon == "1" or icon == "0":
            continue
        # Skip untranslated entries (Chinese characters present, no Korean)
        if CJK_RE.search(name) and not HANGUL_RE.search(name):
            continue

        filtered[base_id] = family

    return filtered


def merge_template(families: Dict[int, Dict], template: Dict) -> None:
    """Merge template data into families (upgrade costs, scrap, etc.)."""
    for base_id, family in families.items():
        str_base = str(base_id)

        # Walk the template chain for this equipment
        template_chain = []
        if str_base in template:
            tmpl = template[str_base]
            template_chain.append(tmpl)
            # Follow the 'next' chain
            while tmpl.get("next") and str(tmpl["next"]) in template:
                tmpl = template[str(tmpl["next"])]
                template_chain.append(tmpl)

        # Assign template data to each level
        for i, level in enumerate(family["levels"]):
            if i < len(template_chain):
                tmpl = template_chain[i]
                level["_template"] = {
                    "level": tmpl.get("level", i + 1),
                    "trans_use_gold": tmpl.get("trans_use_gold", 0),
                    "trans_use_item": tmpl.get("trans_use_item", []),
                    "destory_gold": tmpl.get("destory_gold", 0),
                    "destory_item": tmpl.get("destory_item", []),
                    "restore_gold": tmpl.get("restore_gold", 0),
                    "restore_item": tmpl.get("restore_item", []),
                    "ship_type_forbidden": tmpl.get("ship_type_forbidden", []),
                    "upgrade_formula_id": tmpl.get("upgrade_formula_id", []),
                }


def build_lite_entry(base_id: int, family: Dict, equip_types: Dict,
                     nationality_map: Dict, attr_map: Dict) -> Dict:
    """Build a lite (list view) entry from a family."""
    base = family["base"]
    equip_type = equip_types.get(str(base.get("type", 0)), {})

    # Get nationality info
    nat_id = str(base.get("nationality", 0))
    nat_info = nationality_map.get(nat_id, {})

    # Get attribute names for display
    attrs = []
    for i in range(1, 5):
        attr_key = base.get(f"attribute_{i}")
        attr_val = base.get(f"value_{i}")
        if attr_key and attr_val:
            # Find Korean name from attr_map
            kr_name = attr_key
            for aid, ainfo in attr_map.items():
                if ainfo.get("name") == attr_key or ainfo.get("name2") == attr_key:
                    kr_name = ainfo.get("condition", attr_key)
                    break
            attrs.append({"key": attr_key, "name": kr_name, "value": attr_val})

    # Get max level attribute values from last level
    max_attrs = []
    last_level = family["levels"][-1]
    for i in range(1, 5):
        attr_key = base.get(f"attribute_{i}")
        attr_val = last_level.get(f"value_{i}")
        if attr_key and attr_val:
            kr_name = attr_key
            for aid, ainfo in attr_map.items():
                if ainfo.get("name") == attr_key or ainfo.get("name2") == attr_key:
                    kr_name = ainfo.get("condition", attr_key)
                    break
            max_attrs.append({"key": attr_key, "name": kr_name, "value": attr_val})

    return {
        "id": base_id,
        "name": base.get("name", ""),
        "icon": base.get("icon", ""),
        "rarity": base.get("rarity", 0),
        "rarity_name": RARITY_NAMES.get(base.get("rarity", 0), ""),
        "type": base.get("type", 0),
        "type_name": equip_type.get("type_name", ""),
        "type_name2": equip_type.get("type_name2", ""),
        "nationality": base.get("nationality", 0),
        "nation_name": nat_info.get("name", ""),
        "nation_code": nat_info.get("code", ""),
        "speciality": base.get("speciality", ""),
        "label": base.get("label", []),
        "tech": base.get("tech", 0),
        "level_count": family["level_count"],
        "attrs": attrs,
        "max_attrs": max_attrs,
        "compare_group": equip_type.get("compare_group", 0),
    }


def build_full_entry(base_id: int, family: Dict, equip_types: Dict,
                     nationality_map: Dict, ship_type_map: Dict,
                     attr_map: Dict) -> Dict:
    """Build a full (detail view) entry from a family."""
    base = family["base"]
    equip_type = equip_types.get(str(base.get("type", 0)), {})
    nat_id = str(base.get("nationality", 0))
    nat_info = nationality_map.get(nat_id, {})

    # Build levels array with stats and template data
    levels = []
    for i, level in enumerate(family["levels"]):
        level_data = {
            "level": i + 1,
            "id": level.get("id", base_id),
        }

        # Attributes at this level
        for j in range(1, 5):
            attr_key = base.get(f"attribute_{j}")
            attr_val = level.get(f"value_{j}")
            if attr_key:
                level_data[f"attr_{j}_value"] = attr_val if attr_val else base.get(f"value_{j}", 0)

        # Weapon/damage info
        if "damage" in level:
            level_data["damage"] = level["damage"]
        elif "damage" in base:
            level_data["damage"] = base["damage"]

        if "weapon_id" in level:
            level_data["weapon_id"] = level["weapon_id"]

        # Template data (upgrade costs)
        tmpl = level.get("_template", {})
        if tmpl:
            level_data["upgrade_gold"] = tmpl.get("trans_use_gold", 0)
            level_data["upgrade_items"] = tmpl.get("trans_use_item", [])
            level_data["scrap_gold"] = tmpl.get("destory_gold", 0)
            level_data["scrap_items"] = tmpl.get("destory_item", [])
            level_data["ship_type_forbidden"] = tmpl.get("ship_type_forbidden", [])

        # Skills (can change per level)
        skill_id = level.get("skill_id", base.get("skill_id", []))
        if skill_id:
            level_data["skill_id"] = skill_id

        hidden = level.get("hidden_skill_id", base.get("hidden_skill_id", []))
        if hidden:
            level_data["hidden_skill_id"] = hidden

        levels.append(level_data)

    # Build attribute info with Korean names + icons
    attr_info = []
    for j in range(1, 5):
        attr_key = base.get(f"attribute_{j}")
        if attr_key:
            kr_name = attr_key
            icon_url = ""
            for aid, ainfo in attr_map.items():
                if ainfo.get("name") == attr_key or ainfo.get("name2") == attr_key:
                    kr_name = ainfo.get("condition", attr_key)
                    icon_url = ainfo.get("icon", "")
                    break
            attr_info.append({
                "key": attr_key,
                "name": kr_name,
                "icon": icon_url,
                "index": j,
            })

    # Compatible ship types
    part_main = base.get("part_main", [])
    part_sub = base.get("part_sub", [])
    ship_types_main = []
    ship_types_sub = []
    for st_id in part_main:
        st = ship_type_map.get(str(st_id), {})
        if st:
            ship_types_main.append({
                "id": st_id,
                "name": st.get("type_name", ""),
                "icon": st.get("icon", ""),
            })
    for st_id in part_sub:
        st = ship_type_map.get(str(st_id), {})
        if st:
            ship_types_sub.append({
                "id": st_id,
                "name": st.get("type_name", ""),
                "icon": st.get("icon", ""),
            })

    # Equip parameters
    equip_params = base.get("equip_parameters", {})
    if isinstance(equip_params, list):
        equip_params = {}

    return {
        "id": base_id,
        "name": base.get("name", ""),
        "icon": base.get("icon", ""),
        "rarity": base.get("rarity", 0),
        "rarity_name": RARITY_NAMES.get(base.get("rarity", 0), ""),
        "type": base.get("type", 0),
        "type_name": equip_type.get("type_name", ""),
        "type_name2": equip_type.get("type_name2", ""),
        "compare_group": equip_type.get("compare_group", 0),
        "nationality": base.get("nationality", 0),
        "nation_name": nat_info.get("name", ""),
        "nation_code": nat_info.get("code", ""),
        "nation_image": nat_info.get("image", ""),
        "speciality": base.get("speciality", ""),
        "label": base.get("label", []),
        "tech": base.get("tech", 0),
        "descrip": base.get("descrip", ""),
        "ammo": base.get("ammo", 0),
        "ammo_icon": base.get("ammo_icon", []),
        "ammo_info": base.get("ammo_info", []),
        "torpedo_ammo": base.get("torpedo_ammo", 0),
        "equip_info": base.get("equip_info", []),
        "equip_parameters": equip_params,
        "attr_info": attr_info,
        "part_main": ship_types_main,
        "part_sub": ship_types_sub,
        "levels": levels,
    }


def main():
    print("Equipment Data Processor")
    print("=" * 50)

    # Fetch raw data from remote
    print("Fetching raw data from AzurLaneData...")
    stats = fetch_json(STATISTICS_URL)
    template = fetch_json(TEMPLATE_URL)

    # Save statistics locally (browser needs it for anti_siren display)
    save_json(stats, STATISTICS_LOCAL_PATH)

    # Load local mapping files
    print("Loading mapping files...")
    equip_types = load_json(EQUIP_TYPE_PATH)
    nationality_map = load_json(NATIONALITY_PATH)
    ship_type_map = load_json(SHIP_TYPE_PATH)
    attr_map = load_json(ATTR_TYPE_PATH)
    print(f"  Statistics: {len(stats)} entries")
    print(f"  Template: {len(template)} entries")

    # Resolve inheritance
    print("Resolving base/child inheritance...")
    families = resolve_inheritance(stats)
    print(f"  {len(families)} equipment families")

    # Filter unusable
    print("Filtering unusable entries...")
    families = filter_usable(families)
    print(f"  {len(families)} usable families")

    # Merge template data
    print("Merging template data...")
    merge_template(families, template)

    # Build lite output
    print("Building lite output...")
    lite_data = []
    for base_id in sorted(families.keys()):
        entry = build_lite_entry(base_id, families[base_id], equip_types,
                                 nationality_map, attr_map)
        lite_data.append(entry)
    save_json(lite_data, LITE_OUTPUT)
    print(f"  {len(lite_data)} entries")

    # Build full output (keyed by base ID)
    print("Building full output...")
    full_data = {}
    for base_id in sorted(families.keys()):
        entry = build_full_entry(base_id, families[base_id], equip_types,
                                 nationality_map, ship_type_map, attr_map)
        full_data[str(base_id)] = entry
    save_json(full_data, FULL_OUTPUT)
    print(f"  {len(full_data)} entries")

    print()
    print("Done!")


if __name__ == "__main__":
    main()
