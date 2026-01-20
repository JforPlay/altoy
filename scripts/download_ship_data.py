#!/usr/bin/env python3
"""
Download ship.json from GitHub and merge with local kr_info_add.json
"""
import json
import urllib.request

def download_and_merge_ship_data():
    # URL to download from
    url = "https://raw.githubusercontent.com/Fernando2603/AzurLane/refs/heads/main/ship.json"
    
    # Download the ship.json
    print(f"Downloading ship.json from {url}...")
    with urllib.request.urlopen(url) as response:
        ship_data = json.loads(response.read().decode('utf-8'))
    
    # Load the kr_info_add.json
    print("Loading helper/kr_info_add.json...")
    with open('helper/kr_info_add.json', 'r', encoding='utf-8') as f:
        kr_info_add = json.load(f)
    
    # Merge the two lists (append kr_info_add to ship_data)
    print(f"Merging {len(ship_data)} entries from remote with {len(kr_info_add)} entries from kr_info_add.json...")
    merged_list = ship_data + kr_info_add
    
    # Save the merged result as ship.json
    output_path = 'ship.json'
    print(f"Saving merged data to {output_path}...")
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(merged_list, f, ensure_ascii=False, indent=2)
    
    print(f"✓ Successfully created {output_path} with {len(merged_list)} total entries")

if __name__ == "__main__":
    download_and_merge_ship_data()
