"""
Item Data Processor for ALtoy Equipment Upgrade page.

Extracts lightweight item/material data from item_data_statistics.json,
filtered to only materials actually used in equipment upgrades.

Output: public/data/equip/item_data_lite.json
"""

import json
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
EQUIP_DIR = os.path.join(PROJECT_DIR, "public", "data", "equip")

ITEM_STATS_PATH = os.path.join(EQUIP_DIR, "item_data_statistics.json")
UPGRADE_DATA_PATH = os.path.join(EQUIP_DIR, "equip_upgrade_data.json")
OUTPUT_PATH = os.path.join(EQUIP_DIR, "item_data_lite.json")


def main():
    print("Item Data Processor")
    print("=" * 40)

    with open(ITEM_STATS_PATH, "r", encoding="utf-8") as f:
        items = json.load(f)

    with open(UPGRADE_DATA_PATH, "r", encoding="utf-8") as f:
        upgrades = json.load(f)

    # Collect all material IDs used in upgrades
    mat_ids = set()
    for info in upgrades.values():
        if isinstance(info, dict):
            for mat in info.get("material_consume", []):
                mat_ids.add(str(mat[0]))

    print(f"  {len(mat_ids)} unique materials used in upgrades")

    # Extract lite data for used materials only
    lite = {}
    for mid in sorted(mat_ids, key=int):
        item = items.get(mid, {})
        lite[mid] = {
            "name": item.get("name", f"아이템 #{mid}"),
            "icon": item.get("icon", ""),
            "rarity": item.get("rarity", 0),
        }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(lite, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(OUTPUT_PATH) / 1024
    print(f"  Saved {OUTPUT_PATH} ({size_kb:.1f} KB)")
    print("Done!")


if __name__ == "__main__":
    main()
