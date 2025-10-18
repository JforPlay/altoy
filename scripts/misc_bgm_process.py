import json
import requests

# URLs for the JSON files
album_url = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/ShareCfg/music_album.json"
soundtrack_url = "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/ShareCfg/music_collect_config.json"
bgm_link_url = "https://raw.githubusercontent.com/Fernando2603/AzurLane/main/bgm_link.json"

def create_bgm_data():
    """
    Fetches, merges, and processes BGM data, ignoring metadata fields
    and cleaning up music keys before linking.
    """
    try:
        # 1. Fetching the data from the URLs
        print("🚚 Fetching data from URLs...")
        album_response = requests.get(album_url)
        soundtrack_response = requests.get(soundtrack_url)
        bgm_link_response = requests.get(bgm_link_url)

        # Check if requests were successful
        album_response.raise_for_status()
        soundtrack_response.raise_for_status()
        bgm_link_response.raise_for_status()

        album_data = album_response.json()
        soundtrack_data = soundtrack_response.json()
        bgm_link_data = bgm_link_response.json()
        print("✅ Data fetched successfully.")

        # 2. Processing and merging the data
        print("⚙️ Processing and merging data...")
        merged_data = {}
        
        # Initialize the final structure from the album data
        for album_id, album_info in album_data.items():
            # Ignore the metadata fields in the album file
            if album_id not in ["all", "get_id_list_by_album_name"]:
                album_info['tracks'] = []
                merged_data[album_id] = album_info

        # Iterate through soundtracks and add them to the correct album
        for soundtrack_id, soundtrack_info in soundtrack_data.items():
            # *** THIS IS THE NEWLY ADDED PART ***
            # Ignore the metadata fields in the soundtrack file as well
            if soundtrack_id in ["all", "get_id_list_by_album_name"]:
                continue # Skip to the next item in the loop

            album_id_for_track = str(soundtrack_info.get("album_id"))
            
            if album_id_for_track in merged_data:
                music_key = soundtrack_info.get("music")
                
                # If the music key starts with "bgm-", remove it
                if music_key and music_key.startswith("bgm-"):
                    lookup_key = music_key[4:]
                else:
                    lookup_key = music_key
                
                # Use the modified key to find and add the link
                if lookup_key.lower() in bgm_link_data:
                    soundtrack_info["music_link"] = bgm_link_data[lookup_key.lower()]
                else:
                    soundtrack_info["music_link"] = None # Handle cases where a link is not found
                
                merged_data[album_id_for_track]['tracks'].append(soundtrack_info)

        # 3. Saving the final data to a JSON file
        output_filename = './output/misc/bgm_data.json'
        with open(output_filename, 'w', encoding='utf-8') as f:
            json.dump(merged_data, f, ensure_ascii=False, indent=4)

        print(f"🎉 Success! Processed data saved to {output_filename}")

    except requests.exceptions.RequestException as e:
        print(f"❌ An error occurred while fetching data: {e}")
    except KeyError as e:
        print(f"❌ A key error occurred during processing: {e}")
    except Exception as e:
        print(f"❌ An unexpected error occurred: {e}")

if __name__ == "__main__":
    create_bgm_data()