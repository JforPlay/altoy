#!/bin/bash
# Script for processing downloaded assets from Azur Lane
echo starting processing...

# remove previous version files, if there are any
echo cleanup old files
rm -rf output

# create output directories
echo creating output directories
mkdir output
mkdir output/sim
mkdir output/misc
mkdir output/chat-viewer
mkdir output/skin
mkdir output/story-viewer

echo processing skindata
python skin_data_process.py

echo processing story data
wget https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/GameCfg/dungeon.json
wget https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/GameCfg/story.json
python story_main_data_process.py # creates shipgirl_data.json

echo processing chat-viewer data
python juustagram_process.py
python chat_viewer_process.py # also creates ship_group_data with fleet tech

echo processing worlddata
# python story_world_data_process.py # uses shipgirl_data.json created by story_data_process.py
# python story_world_file_collection.py

echo processing barrage data
wget -O ./output/sim/weapon_property.json https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/sharecfgdata/weapon_property.json
wget -O ./output/sim/barrage_template.json https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/sharecfgdata/barrage_template.json
wget -O ./output/sim/bullet_template.json https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/sharecfgdata/bullet_template.json
wget -O ./output/sim/skill_data_template.json https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/skill_data_template.json
wget -O ./output/sim/transform_data_template.json https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/transform_data_template.json
wget -O ./output/sim/aircraft_template.json https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/sharecfgdata/aircraft_template.json
wget -O ./output/skill_icon_mapping.json https://raw.githubusercontent.com/Fernando2603/AzurLane/refs/heads/main/skill_icon.json
python ship_info_process.py
python sim_weapon_preprocess.py
python sim_weapon_process.py

echo others
python misc_bgm_process.py
# python orbit_process.py
python ship_build_sim_process.py # requires ship_info_data.json created by skin_info_process.py

# echo processing child story data
# python child_story_process.py # requires story.json

echo cleanup files not needed for the final output
rm story.json dungeon.json
rm ./output/sim/transform_data_template.json
rm ./output/weapon_sim_data.json