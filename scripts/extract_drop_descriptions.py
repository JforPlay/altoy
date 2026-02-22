"""
Extract all unique drop/acquisition description strings from ship_group_data.json.
Outputs a sorted JSON file for reference.
"""

import json
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "public" / "data"
INPUT_FILE = DATA_DIR / "ship_group_data.json"
OUTPUT_FILE = DATA_DIR / "shipgirl" / "drop_description_list.json"


def main():
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    descriptions = set()
    for gid, ship in data.items():
        desc_list = ship.get("description", [])
        if isinstance(desc_list, list):
            for d in desc_list:
                descriptions.add(d)

    sorted_descriptions = sorted(descriptions)

    output = {
        "total": len(sorted_descriptions),
        "descriptions": sorted_descriptions,
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"Extracted {len(sorted_descriptions)} unique descriptions → {OUTPUT_FILE}")
    for i, d in enumerate(sorted_descriptions, 1):
        print(f"  {i:3d}. {d}")


if __name__ == "__main__":
    main()
