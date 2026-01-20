#!/usr/bin/env python3
"""
Download skin_list.json from GitHub and merge with local kr_skin_add.json
"""
import json
import urllib.request

def download_and_merge_skin_list():
    # URL to download from
    url = "https://raw.githubusercontent.com/Fernando2603/AzurLane/refs/heads/main/skin_list.json"
    
    # Download the skin_list.json
    print(f"Downloading skin_list.json from {url}...")
    with urllib.request.urlopen(url) as response:
        skin_list = json.loads(response.read().decode('utf-8'))
    
    # Load the kr_skin_add.json
    print("Loading helper/kr_skin_add.json...")
    with open('helper/kr_skin_add.json', 'r', encoding='utf-8') as f:
        kr_skin_add_raw = json.load(f)
    
    # Flatten kr_skin_add structure (extract skins from nested structure)
    kr_skin_add = []
    for ship in kr_skin_add_raw:
        if 'skins' in ship and isinstance(ship['skins'], list):
            kr_skin_add.extend(ship['skins'])
    
    # Merge the two lists (append kr_skin_add to skin_list)
    print(f"Merging {len(skin_list)} entries from remote with {len(kr_skin_add)} skin entries from kr_skin_add.json...")
    merged_list = skin_list + kr_skin_add
    
    # Save the merged result as skin_list.json
    output_path = 'skin_list.json'
    print(f"Saving merged data to {output_path}...")
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(merged_list, f, ensure_ascii=False, indent=2)
    
    print(f"✓ Successfully created {output_path} with {len(merged_list)} total entries")

if __name__ == "__main__":
    download_and_merge_skin_list()
