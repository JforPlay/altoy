import UnityPy
from PIL import Image
import os
from pathlib import Path
import re
import math
import json
from argparse import ArgumentParser

# Default settings
saveMesh = False
face_fix = {
    "longxiang_3": [-1, 0, -1, 0],
    "u110_6_n": [0, -1, 0, -1],
    "hamanii": [0, 0, 0, 0],
    "xia": [0, 0, 0, 0],
    "kelifulan_6_n": [0, -1, 0, -1],
    "baerdimo_6_n": [0, -1, 0, -1],
    "yalisangna_2_n": [0, -1, 0, -1],
    "yalisangna_2_n_hx": [0, -1, 0, -1],
    "xifujiniya": [0, 0, 0, 1],
    "qiye_8_n": [0, -1, 0, -1],
    "xiefeierde_3_n": [0, -1, 0, -1],
    "xiefeierde_4": [0, 0, 0, -1],
    "manchesite_3_n": [0, -1, 0, -1],
    "ouruola_3": [0, 0, -1, 0],
    "ouruola_h": [0, -1, 0, -1],
    "safuke": [0, 0, 0, -1],
    "safuke_hx": [0, 0, 0, -1],
    "yueke_h_n": [0, -1, 0, -1],
    "guanghui": [0, 0, -1, 0],
    "shengli": [0, -1, 0, -1],
    "chuixue_3": [0, 0, 0, 0],
    "shenxue_3_n": [0, -1, 0, -1],
    "xiao_4_n": [0, -1, 0, -1],
    "xiao_5_n": [0, -1, 0, -1],
    "jiahe_4_n": [0, -1, 0, -1],
    "dafeng_5": [-1, 0, -1, 0],
    "xipeierhaijunshangjiang_3_n": [0, -1, 0, -1],
    "ougen": [0, 0, 0, 0],
    "ougen_hx": [0, 0, 0, 0],
    "bisimai_h_n": [0, -5, 0, -5],
    "huonululu_5_n": [0, -1, 0, -1],
    "dachao_2": [0, 0, 1, 0],
    "lemaer_4_n": [0, -1, 0, -1],
    "mingniabolisi": [0, 0, 0, -1],
    "mingniabolisi_hx": [0, 0, 0, -1],
    "mingniabolisi_3": [-1, 0, -1, 0],
    "mingniabolisi_3_n": [-1, 0, -1, 0],
    "heizewude": [0, 0, 0, 0],
    "u73_4_n": [0, -1, 0, -1],
    "edu": [0, 0, 0, 0],
    "shuixingjinian_3_n": [0, -1, 0, -1],
    "qiabayefu_2": [0, 0, 0, -1],
    "qiabayefu_2_n": [0, 0, 0, -1],
    "linuo_5_n": [0, -1, 0, -1],
    "changbo_4_n": [0, -1, 0, -1],
    "wokelan_2_n": [0, -1, 0, -1],
    "hemin_4": [-1, 0, -1, 0],
    "xiongye_3_n": [0, -1, 0, -1],
    "wenqinzuojiaobeidi": [1, 0, 1, 0],
    "talin_2_n": [0, -1, 0, -1],
    "moermansike": [0, -1, 0, -1],
    "moermansike_n": [0, -1, 0, -1],
    "weineituo_hx": [0, 0, -1, 0],
    "weineituo_n_hx": [0, 0, -1, 0],
    "weineituo_wjz_hx": [0, 0, -1, 0],
    "tuolichaili_2_n": [0, -1, 0, -1],
    "tikangdeluojia_2": [0, -1, 0, -1],
    "tikangdeluojia_2_hx": [0, -1, 0, -1],
    "tikangdeluojia_2_n": [0, -1, 0, -1],
    "tikangdeluojia_2_n_hx": [0, -1, 0, -1],
    "jiujinshan_4_n": [0, -1, 0, -1],
    "boyixi_5_n": [0, -1, 0, -1],
    "kalvbudisi_3_n": [0, -1, 0, -1],
    "fuerjia_2_n": [0, -1, 0, -1],
    "yueke_ger_3_n": [0, -1, 0, -1],
    "texiusi_2_n": [0, 1, 0, -2],
    "xufulun_2_n": [0, -1, 0, -1],
    "xiusidunii_2_n": [0, -1, 0, -1],
    "jinluhao_2_n": [0, -1, 0, -1],
    "songdiao_2_n": [0, -1, 0, -1],
    "huanchang_2_n": [-1, 0, -1, 0],
    "jianwu_3_n": [0, -1, 0, -1],
    "bailong_2_n": [0, -1, 0, -1],
    "safuke_xinshou": [0, 0, 0, -1],
    "chicheng_alter": [0, 0, -1, 0],
    "chicheng_alter_n": [0, 0, -1, 0],
    "rightchicheng_alter": [0, 0, -1, 0],
    "rightchicheng_alter_n": [0, 0, -1, 0],
    "bulunnusi_3": [-1, 0, -1, 0],
    "bulunnusi_3_n": [-1, 0, -1, 0],
}

manifest_data = {}

def custom_round(n):
    floor_value = math.floor(n)
    decimal_part = n - floor_value
    if decimal_part == 0.5:
        return floor_value + 1
    else:
        return round(n)

def get_canvas(layer):
    texture = layer["texture"].image
    size = layer["size"]
    v_raw = []
    vt_raw = []
    for line in layer["mesh"].export().splitlines():
        if line.startswith("v "):
            vertex = line.split(" ")[1:]
            v_raw.append([int(n) for n in vertex])
        if line.startswith("vt "):
            vertex = line.split(" ")[1:]
            vt_raw.append([float(n) for n in vertex])
    assert len(v_raw) == len(vt_raw), "Unequal number of mesh vertices to texture vertices."
    v = [[-x, y] for x, y, z in v_raw]
    w = texture.width
    h = texture.height
    vt = [[w * x, h * (1 - y)] for x, y in vt_raw]
    patches = []
    canvas_width = 0
    canvas_height = 0
    for i in range(int(len(vt) / 4)):
        patch = texture.crop((custom_round(vt[i * 4 + 1][0]), custom_round(vt[i * 4 + 1][1]), custom_round(vt[i * 4 + 3][0]), custom_round(vt[i * 4 + 3][1])))
        canvas_width = max(canvas_width, v[i * 4][0] + patch.width)
        canvas_height = max(canvas_height, v[i * 4 + 2][1])
        patches.append(patch)
    canvas = Image.new("RGBA", (custom_round(max(size["x"], canvas_width)), custom_round(max(size["y"], canvas_height))))
    for i, patch in enumerate(patches):
        canvas.alpha_composite(
            patch.convert("RGBA").transpose(Image.Transpose.FLIP_TOP_BOTTOM),
            (
                custom_round(v[i * 4][0]),
                custom_round(v[i * 4 + 2][1] - patch.height),
            ),
        )
    if canvas.width > size["x"] or canvas.height > size["y"]:
        bbox = canvas.getbbox()
        if bbox:
            left, upper, right, lower = bbox
            new_bbox = (0, 0, max(right, size["x"]), max(lower, size["y"]))
        else:
            new_bbox = (0, 0, size["x"], size["y"])
        canvas = canvas.crop(new_bbox)
    canvas = canvas.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    return canvas

def get_primary(asset):
    bundle = asset.objects[1]
    if bundle.type.name != "AssetBundle":
        found = False
        for value in asset.values():
            if value.type.name == "AssetBundle":
                bundle = value
                found = True
                break
        assert found, "No AssetBundle found."
    bundletree = bundle.read_typetree()
    primaryid = bundletree["m_Container"][-1][1]["asset"]["m_PathID"]
    primary = asset.objects[primaryid]
    return primaryid, primary.read_typetree()

def get_dependencies(root):
    env = UnityPy.load(str(Path(root, "dependencies")))
    id, primary = get_primary(env.assets[0])
    dependencies = {}
    for m_Value in primary["m_Values"]:
        m_FileName = re.sub(r"^.*?(/painting/.*)?$", r"\g<1>", m_Value["m_FileName"])[1:]
        if m_FileName:
            dependencies.setdefault(m_FileName, m_Value["m_Dependencies"])
    return dependencies

def get_layers(asset, textures, layers={}, id=None, parent=None):
    if id is None:
        id, gameobject = get_primary(asset)
    else:
        gameobject = asset[id].read_typetree()

    if gameobject["m_Name"] in ["shop_hx", "shadow", "Touch", "hx"]:
        return
    if "m_Component" not in gameobject:
        return

    children = None
    mesh_id = None
    entry = {}
    entry["name"] = gameobject["m_Name"]
    for ptr in gameobject["m_Component"]:
        component_id = ptr["component"]["m_PathID"]
        component = asset[component_id]
        tree = component.read_typetree()
        if component.type.name == "RectTransform":
            entry["scale"] = tree["m_LocalScale"]
            if parent == None or entry["name"] == "layers":
                entry["scale"] = {"x": 1, "y": 1, "z": 1}
            entry["delta"] = tree["m_SizeDelta"]
            entry["pivot"] = tree["m_Pivot"]
            entry["rotation"] = tree["m_LocalRotation"]

            anchormin = tree["m_AnchorMin"]
            anchormax = tree["m_AnchorMax"]
            anchorpos = tree["m_AnchoredPosition"]
            if parent is None:
                entry["bound"] = entry["delta"]
                entry["position"] = {"x": entry["delta"]["x"] * entry["pivot"]["x"], "y": entry["delta"]["y"] * entry["pivot"]["y"]}
            else:
                pl = layers[parent]
                entry["bound"] = {
                    "x": (pl["bound"]["x"] * (anchormax["x"] - anchormin["x"]) + entry["delta"]["x"]) * entry["scale"]["x"],
                    "y": (pl["bound"]["y"] * (anchormax["y"] - anchormin["y"]) + entry["delta"]["y"]) * entry["scale"]["y"],
                }
                entry["position"] = {
                    "x": anchorpos["x"] + pl["bound"]["x"] * (anchormax["x"] - anchormin["x"]) * entry["pivot"]["x"] + pl["bound"]["x"] * anchormin["x"] - pl["bound"]["x"] * pl["pivot"]["x"],
                    "y": anchorpos["y"] + pl["bound"]["y"] * (anchormax["y"] - anchormin["y"]) * entry["pivot"]["y"] + pl["bound"]["y"] * anchormin["y"] - pl["bound"]["y"] * pl["pivot"]["y"],
                }
            if (gameobject["m_Name"] == "face" and "parent" not in layers[parent]) or (gameobject["m_Name"] == "face_sub" and layers[parent]["name"] == "face"):
                entry["size"] = entry["delta"]
            children = tree["m_Children"]
        if component.type.name == "Transform" and children == None and "m_Children" in tree:
            entry["scale"] = tree["m_LocalScale"]
            if parent == None or entry["name"] == "layers":
                entry["scale"] = {"x": 1, "y": 1, "z": 1}
            entry["delta"] = {"x": 0, "y": 0}
            entry["pivot"] = {"x": 0.5, "y": 0.5}
            entry["rotation"] = tree["m_LocalRotation"]
            entry["bound"] = {"x": 0, "y": 0}
            entry["position"] = {"x": 0, "y": 0}
            children = tree["m_Children"]
        if "mMesh" in tree:
            mesh_id = tree["mMesh"]["m_PathID"]
            sprite_id = tree["m_Sprite"]["m_PathID"]
            entry["size"] = tree["mRawSpriteSize"]
        elif "m_Sprite" in tree and entry["name"] != "face" and entry["name"] != "face_sub":
            entry["isImage"] = True
            mesh_id = 0
            sprite_id = tree["m_Sprite"]["m_PathID"]
            entry["size"] = entry["delta"]
    if mesh_id is not None:
        texas = {}
        for i in range(len(textures.assets)):
            texas = texas | textures.assets[i].objects
        try:
            entry["mesh"] = texas[mesh_id].read()
        except:
            pass
        try:
            sprite = texas[sprite_id].read_typetree()
            if "_shophx" not in sprite["m_Name"]:
                texture_id = sprite["m_RD"]["texture"]["m_PathID"]
                entry["texture"] = texas[texture_id].read()
        except:
            pass
    if parent is not None:
        entry["parent"] = parent

    layers[id] = entry

    if children is not None:
        for rt_ptr in children:
            rt_id = rt_ptr["m_PathID"]
            rt = asset[rt_id].read_typetree()
            child_id = rt["m_GameObject"]["m_PathID"]
            get_layers(asset, textures, layers, child_id, id)

def wrapped(painting_name, root, output_path, depmap, painting_to_id={}, debug=False):
    if "_tex" in painting_name or painting_name in ["mat", "mat_v1f1"]:
        return
    
    # Skip _hx suffixed images as per user request (censored images)
    if "_hx" in painting_name:
        print(f"Skipping {painting_name} (contains _hx suffix)")
        return

    # Determine Skin ID and Output Structure
    # Try exact match first
    skin_id = painting_to_id.get(painting_name.lower())
    
    # If not found, try stripping common suffixes to find the base skin ID
    if not skin_id:
        # Common suffixes to strip for lookup purposes
        clean_name = painting_name.lower()
        for suffix in ["_hx", "_n", "_ex", "_wjz"]:
             clean_name = clean_name.replace(suffix, "")
        skin_id = painting_to_id.get(clean_name)

    if skin_id:
        manifest_key = str(skin_id)
        # Create folder structure: output/{skin_id}/
        target_dir = Path(output_path) / str(skin_id)
        target_dir.mkdir(exist_ok=True, parents=True)
        
        # Determine filename based on suffix in the ORIGINAL painting name
        # If it has "_n" (and not just part of a name), treat as zoomed/variant
        if "_n" in painting_name: 
            base_filename = "painting_n"
            # Special case: if we are processing a variant that maps to the same ID 
            # as the base, we need to ensure the manifest key is unique 
            # OR we accept that we are adding a secondary image to the same manifest entry?
            # For the manifest, we usually key by SKIN ID. 
            # If we have both painting and painting_n for the same skin, we might need 
            # separate manifest entries or a structure that supports both.
            #
            # Current frontend logic looks up manifest by skin_id. 
            # It assumes one "base" image per ID in the current implementation.
            # 
            # To support "Zoomed" (painting_n) having expressions too:
            # We should probably key the manifest as "{skin_id}_n" for the zoomed version?
            # Let's use a suffix for the manifest key if it is the "n" version.
            manifest_key = f"{skin_id}_n"
        else:
            base_filename = "painting"
    else:
        # Fallback to flat structure if ID not found
        manifest_key = painting_name
        target_dir = Path(output_path)
        base_filename = painting_name

    # Skip if already processed (Check manifest)
    if manifest_key in manifest_data:
        print(f"Skipping {painting_name} (found in manifest as {manifest_key})")
        return
    
    # Also skip if file exists on disk to save time
    if (target_dir / f"{base_filename}.png").exists():
        print(f"Skipping {painting_name} (file exists)")
        return

    print(f"Processing: {painting_name} -> {manifest_key}")

    depfiles = depmap.get("painting/{}".format(painting_name))
    depfiles_ex = [
        "painting/{}".format(f.name)
        for f in Path(root, "painting").iterdir()
        if (f.is_file() and painting_name.replace("_hx", "").replace("_npc", "__nnpc").replace("_n", "").replace("_ex", "").replace("_idolns", "_idol").replace("_wjz", "") in f.name)
    ]
    textures = UnityPy.load(*["{}/{}".format(root, fn) for fn in list(set(depfiles or []) | set(depfiles_ex))])

    try:
        env = UnityPy.load(str(Path(root, "painting", painting_name)))
    except FileNotFoundError:
        print(f"File not found: {painting_name}")
        return
        
    layers = {}
    get_layers(env.assets[0], textures, layers)

    def get_position_box(layer, x=None, y=None, w=None, h=None):
        if x is None or y is None:
            x = layer["bound"]["x"] * layer["pivot"]["x"] - layer["position"]["x"]
            y = layer["bound"]["y"] * layer["pivot"]["y"] - layer["position"]["y"]
            w = layer["bound"]["x"]
            h = layer["bound"]["y"]
        if "parent" in layer:
            parent = layers[layer["parent"]]
            w *= parent["scale"]["x"]
            h *= parent["scale"]["y"]
            x = x * parent["scale"]["x"] - parent["position"]["x"]
            y = y * parent["scale"]["y"] - parent["position"]["y"]
            return get_position_box(parent, x, y, w, h)
        return [-x, -y, w - x, h - y]

    for i in layers:
        layer = layers[i]
        if "size" in layer:
            layer["box"] = get_position_box(layer)
    
    # Fix bounding box calculation (similar to main.py logic)
    fix = [0, 0]
    rw_flag = False
    for i in layers:
        layer = layers[i]
        if "box" in layer:
            if "_rw" in layer["name"]:
                fix[0] = custom_round(layer["box"][0]) - layer["box"][0]
                fix[1] = custom_round(layer["box"][1]) - layer["box"][1]
                rw_flag = True
    if rw_flag == False:
        for i in layers:
            layer = layers[i]
            if "box" in layer and "parent" not in layer:
                name = layer["name"]
                for i in layers:
                    layer = layers[i]
                    if "box" in layer and "parent" in layer and (layer["name"] == name or layer["name"] == "paint"):
                        fix[0] = custom_round(layer["box"][0]) - layer["box"][0]
                        fix[1] = custom_round(layer["box"][1]) - layer["box"][1]
                        break
                break
    for i in layers:
        layer = layers[i]
        if "box" in layer:
            if layer["name"] == "face":
                layer["box"][0] += fix[0] + face_fix.get(painting_name, [0, 0, 0, 0])[0]
                layer["box"][1] += fix[1] + face_fix.get(painting_name, [0, 0, 0, 0])[1]
                layer["box"][2] += fix[0] + face_fix.get(painting_name, [0, 0, 0, 0])[2]
                layer["box"][3] += fix[1] + face_fix.get(painting_name, [0, 0, 0, 0])[3]
            layer["box"][2] = custom_round(layer["box"][0]) + layer["box"][2] - layer["box"][0]
            layer["box"][3] = custom_round(layer["box"][1]) + layer["box"][3] - layer["box"][1]
            layer["box"][0] = custom_round(layer["box"][0])
            layer["box"][1] = custom_round(layer["box"][1])

    boxes = [layer["box"] for layer in layers.values() if "size" in layer]
    if not boxes:
        return
        
    x0, y0 = min(box[0] for box in boxes), min(box[1] for box in boxes)
    x1, y1 = max(box[2] for box in boxes), max(box[3] for box in boxes)
    
    # Normalize boxes relative to canvas
    for i in layers:
        layer = layers[i]
        if "box" in layer:
            layer["box"][0] -= x0
            layer["box"][1] -= y0
            layer["box"][2] -= x0
            layer["box"][3] -= y0

    try:
        master = Image.new("RGBA", (custom_round(x1 - x0), custom_round(y1 - y0)))
    except:
        print(painting_name, "failed to create master image")
        return

    # Prepare canvases
    canvases = []
    face_layer_info = None

    for i in layers:
        layer = layers[i]
        
        # Prepare content
        canvas = None
        if "mesh" in layer and "texture" in layer:
            canvas = get_canvas(layer)
        elif "texture" in layer:
            canvas = layer["texture"].image.convert("RGBA")
        elif layer["name"] in ["face", "face_sub"]:
             # Placeholder for face layers to preserve order if needed, 
             # but we handle them separately.
             # We need to capture the face layer info (box, rotation) here.
             pass

        if canvas:
             # Resize if needed
            canvas = canvas.resize(
                (
                    custom_round(canvas.width * ((layer["box"][2] - layer["box"][0]) or layer["size"]["x"]) / layer["size"]["x"]),
                    custom_round(canvas.height * ((layer["box"][3] - layer["box"][1]) or layer["size"]["y"]) / layer["size"]["y"]),
                ),
                Image.BILINEAR,
            ).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            canvases.append([canvas, layer])
        
        if layer["name"] == "face":
            face_layer_info = layer

    # Compositing Base Image
    # We composite everything EXCEPT the face.
    # Actually, for fallback, maybe we SHOULD composite the default face?
    # Let's composite the default face into the base image.
    # But we ALSO want to export the face patches.
    
    # Load Face Assets
    faces_bundle = None
    possible_paths = [
        painting_name.replace("_npc", "__nnpc").replace("_n", "").replace("_ex", ""),
        painting_name.replace("_hx", "").replace("_npc", "__nnpc").replace("_n", "").replace("_ex", ""),
        painting_name.replace("_hx", "").replace("_npc", "__nnpc").replace("_n", "").replace("_ex", "").replace("_wjz", ""),
        painting_name.replace("_hx", "").replace("_npc", "__nnpc").replace("_n", "").replace("_ex", "").replace("_idolns", "_idol")
    ]
    
    for p in possible_paths:
        try:
            faces_bundle = UnityPy.load(str(Path(root, "paintingface", p)))
            if len(faces_bundle.assets) > 0:
                break
        except:
            continue

    # Extract all faces
    face_images = {}
    if faces_bundle and len(faces_bundle.assets) > 0:
         for value in faces_bundle.assets[0].values():
            if value.type.name == "Texture2D":
                face = value.read()
                if "_sub" not in face.m_Name:
                    face_images[face.m_Name] = face.image.convert("RGBA")

    # Composite Base
    # If we have a face layer info, we can prepare the base with the default face (0)
    # and also export the patches.
    
    # Logic:
    # 1. Composite all non-face layers.
    # 2. If face layer exists:
    #    a. Composite face '0' (if exists) into master for the "base" image.
    #    b. For EVERY face in `face_images`:
    #       - Apply rotation/scaling logic to create a "Ready-to-Place" patch.
    #       - Save patch.
    
    # Re-using main.py rotation logic helper
    def process_canvas_transforms(canvas, layer):
        # Resize first (logic from main.py)
        canvas = canvas.resize(
             (
                custom_round((layer["box"][2] - layer["box"][0]) or canvas.width),
                custom_round((layer["box"][3] - layer["box"][1]) or canvas.height),
            ),
            Image.BILINEAR,
        ).transpose(Image.Transpose.FLIP_TOP_BOTTOM)

        # Rotate
        if layer["rotation"]["z"] != 0:
            angle_rad = 2 * math.atan2(layer["rotation"]["z"], layer["rotation"]["w"])
            w, h = canvas.size
            canvas = canvas.rotate(-math.degrees(angle_rad), expand=True, resample=Image.BICUBIC)
            new_w, new_h = canvas.size
            px, py = layer["pivot"]["x"] * w, layer["pivot"]["y"] * h
            dx, dy = px - w / 2, py - h / 2
            # Adjust box to fit rotated content
            layer["box"][0] += px - (new_w / 2 + dx * math.cos(angle_rad) - dy * math.sin(angle_rad))
            layer["box"][1] += py - (new_h / 2 + dx * math.sin(angle_rad) + dy * math.cos(angle_rad))
        
        return canvas, layer

    # 1. Composite Base (Backgrounds + Body)
    for canvas, layer in canvases:
        # We skip "face" layer here if it was added to canvases (it wasn't in my logic above)
        # Apply transforms to base layers
        if layer["rotation"]["z"] != 0:
            angle_rad = 2 * math.atan2(layer["rotation"]["z"], layer["rotation"]["w"])
            w, h = canvas.size
            canvas = canvas.rotate(-math.degrees(angle_rad), expand=True, resample=Image.BICUBIC)
            new_w, new_h = canvas.size
            px, py = layer["pivot"]["x"] * w, layer["pivot"]["y"] * h
            dx, dy = px - w / 2, py - h / 2
            layer["box"][0] += px - (new_w / 2 + dx * math.cos(angle_rad) - dy * math.sin(angle_rad))
            layer["box"][1] += py - (new_h / 2 + dx * math.sin(angle_rad) + dy * math.cos(angle_rad))
            
        if master.width < canvas.width + custom_round(layer["box"][0]) or master.height < canvas.height + custom_round(layer["box"][1]):
            new_master = Image.new("RGBA", (max(master.width, canvas.width + custom_round(layer["box"][0])), max(master.height, canvas.height + custom_round(layer["box"][1]))))
            new_master.alpha_composite(master, (0, 0))
            master = new_master
        
        master.alpha_composite(canvas, (custom_round(layer["box"][0]), custom_round(layer["box"][1])))

    # 2. Handle Faces
    
    face_manifest = {"faces": [], "box": [0,0,0,0], "size": [master.width, master.height]}
    
    if face_layer_info and face_images:
        # Create a copy of face layer info because transforms modify it in place
        import copy
        
        # Save Face Patches
        for face_name, face_img in face_images.items():
            layer_copy = copy.deepcopy(face_layer_info)
            
            # DEBUG
            if face_name == "1" or face_name == "0":
                print(f"DEBUG [{painting_name}] Face {face_name}: Original Box {layer_copy.get('box')}")

            processed_face, modified_layer = process_canvas_transforms(face_img, layer_copy)
            
            # Save patch
            # Naming: painting_face_{id}.png
            patch_filename = f"{base_filename}_face_{face_name}.png"
            processed_face.transpose(Image.Transpose.FLIP_TOP_BOTTOM).save(target_dir / patch_filename)
            
            # Update manifest
            if "box" in modified_layer:
                y_internal = custom_round(modified_layer["box"][1])
                x_internal = custom_round(modified_layer["box"][0])
            else:
                y_internal = 0
                x_internal = 0

            w = processed_face.width
            h = processed_face.height
            
            y_final = master.height - (y_internal + h)
            
            box = [
                x_internal,
                y_final,
                w,
                h
            ]
            
            # If this is the default face (0), composite it onto the master base image
            if face_name == "0":
                master.alpha_composite(processed_face, (custom_round(modified_layer["box"][0]), y_internal))
            
            # Update manifest box if it hasn't been set yet (or update always? Faces usually share box)
            # We set it if it's still the default [0,0,0,0]
            if face_manifest["box"] == [0, 0, 0, 0]:
                face_manifest["box"] = box

            face_manifest["faces"].append(face_name)
    
    elif face_layer_info:
        # No face images found, but face layer exists (rare/error?)
        pass

    # Save Base Image
    master = master.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    master.save(target_dir / f"{base_filename}.png")
    
    # Store manifest
    if face_manifest["faces"]:
        manifest_data[manifest_key] = face_manifest

if __name__ == "__main__":
    parser = ArgumentParser()
    parser.add_argument("--root", required=True, help="Path to AssetBundles root")
    parser.add_argument("--output", default="output_expressions", help="Output directory")
    args = parser.parse_args()

    output_path = Path(args.output)
    output_path.mkdir(exist_ok=True, parents=True)

    # Load ID dict
    # Assume files are in current dir or root? using root for now
    # Actually, main.py looks for json files in CWD.
    # We'll try to find them in CWD.
    id_dict = {} # Simplified for now, or copy get_id_dict if needed.
    
    depmap = get_dependencies(args.root)
    
    # Load ship_skin_template.json for ID mapping
    # Assumes it is located in the parent directory of the AssetBundles root
    template_path = Path(args.root).parent / "ship_skin_template.json"
    painting_to_skin_id = {}
    
    if template_path.exists():
        try:
            with open(template_path, "r", encoding="utf-8") as f:
                template_data = json.load(f)
                for skin_id, data in template_data.items():
                    if "painting" in data:
                        p_name = data["painting"].lower()
                        # specific logic: if multiple skins use same painting, we usually prefer the base or just last one.
                        # For simplicity, we map painting -> skin_id.
                        # Note: This might overwrite if multiple skins share painting. 
                        # Ideally we want the skin_id that corresponds to this painting file.
                        # In AL, different skins usually have different painting files.
                        painting_to_skin_id[p_name] = skin_id
            print(f"Loaded {len(painting_to_skin_id)} painting mappings from template.")
        except Exception as e:
            print(f"Error loading ship_skin_template.json: {e}")
    else:
        print(f"ship_skin_template.json not found at {template_path}. Output will use filenames.")

    # Load existing manifest if available
    manifest_file = Path(output_path, "expression_manifest.json")
    if manifest_file.exists():
        try:
            with open(manifest_file, "r") as f:
                manifest_data = json.load(f)
            print(f"Loaded existing manifest with {len(manifest_data)} entries.")
        except Exception as e:
            print(f"Error loading manifest: {e}. Starting fresh.")
            manifest_data = {}

    # Process all paintings
    painting_dir = Path(args.root, "painting")
    for file in painting_dir.iterdir():
        if file.is_file() and not file.name.endswith("_tex"):
            wrapped(file.name, args.root, args.output, depmap, painting_to_skin_id)

    # Save Manifest
    with open(manifest_file, "w") as f:
        json.dump(manifest_data, f, indent=2)

