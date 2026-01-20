import json
import os

def generate_lite_data():
    print("Generating Lite Data...")

    # --- Process Ship Info ---
    try:
        with open('output/ship_info_data.json', 'r', encoding='utf-8') as f:
            ship_data = json.load(f)
        
        lite_ship_data = []
        for ship in ship_data:
            lite_ship = {
                "id": ship.get("id"),
                "gid": ship.get("gid"),
                "name": ship.get("name"),
                "rarity": ship.get("rarity"),
                "nationality": ship.get("nationality"),
                "type": ship.get("type"),
                "shipyard": ship.get("shipyard"),
                "limited": ship.get("limited"),
                "light": ship.get("light"),
                "medium": ship.get("medium"),
                "heavy": ship.get("heavy"),
                "timer": ship.get("timer")
            }
            lite_ship_data.append(lite_ship)

        with open('output/ship_info_lite.json', 'w', encoding='utf-8') as f:
            json.dump(lite_ship_data, f, ensure_ascii=False, separators=(',', ':')) # Minified
        
        print(f"  - Generated output/ship_info_lite.json ({len(lite_ship_data)} records)")

    except Exception as e:
        print(f"  ! Error processing ship_info_data.json: {e}")

    # --- Process Juustagram ---
    try:
        with open('output/juustagram_data.json', 'r', encoding='utf-8') as f:
            juus_data = json.load(f)
        
        lite_juus_data = {}
        for key, post in juus_data.items():
            lite_post = {
                "id": post.get("id"),
                "ship_group": post.get("ship_group"),
                "name": post.get("name"),
                "picture_persist": post.get("picture_persist"),
                "shipgirl_names": post.get("shipgirl_names", []),
                # Exclude comments, replies, and options
            }
            lite_juus_data[key] = lite_post

        with open('output/juustagram_lite.json', 'w', encoding='utf-8') as f:
            json.dump(lite_juus_data, f, ensure_ascii=False, separators=(',', ':')) # Minified
            
        print(f"  - Generated output/juustagram_lite.json ({len(lite_juus_data)} records)")

    except Exception as e:
        print(f"  ! Error processing juustagram_data.json: {e}")

if __name__ == "__main__":
    generate_lite_data()
