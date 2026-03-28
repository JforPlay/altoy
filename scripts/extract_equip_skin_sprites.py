"""
Extract equipment skin sprites from Unity asset bundles.

Usage:
    python scripts/extract_equip_skin_sprites.py            # incremental (skip existing)
    python scripts/extract_equip_skin_sprites.py --force     # re-extract all

Requires: pip install UnityPy Pillow

Sources (in priority order):
  1. item/{name}           - Prefab bundles (may embed Texture2D)
  2. artresource/item/bulletall/{name} - Shared texture bundles
  3. chargo/{name}         - Aircraft skin models (feiji_*)
  4. bulletall/{name}      - Additional texture bundles

Output: C:/Users/jayle/Documents/GitHub/data_for_toy/equip_skin_sprites/
"""

import json
import os
import sys
import argparse
from pathlib import Path
from collections import Counter

try:
    import UnityPy
    from PIL import Image
except ImportError:
    print("ERROR: UnityPy and Pillow not installed. Run: pip install UnityPy Pillow")
    sys.exit(1)

# === Configuration ===
BUNDLE_BASE = "//wsl.localhost/Ubuntu/home/jay/play/azurlane/AzurLane-AssetDownloader/ClientAssets/KR/AssetBundles"
SKIN_JSON = "public/data/equip/equip_skin_template.json"
OUTPUT_DIR = "C:/Users/jayle/Documents/GitHub/data_for_toy/equip_skin_sprites"

SEARCH_DIRS = [
    "item",                         # Prefab bundles (embedded textures)
    "artresource/item/bulletall",   # Shared texture bundles
    "chargo",                       # Aircraft models
    "bulletall",                    # Additional textures
]


def find_bundle(name: str) -> str | None:
    """Find the bundle file for a given asset name (case-insensitive)."""
    for subdir in SEARCH_DIRS:
        path = os.path.join(BUNDLE_BASE, subdir, name)
        if os.path.exists(path):
            return path
        # Try lowercase
        path_lower = os.path.join(BUNDLE_BASE, subdir, name.lower())
        if os.path.exists(path_lower):
            return path_lower
    return None


def parse_spine_atlas(atlas_text: str) -> list:
    """
    Parse a Spine atlas file and return list of frame dicts.
    Each frame: { name, x, y, width, height, rotate }
    """
    frames = []
    lines = atlas_text.strip().split("\n")
    i = 0
    # Skip header lines (texture filename, size, format, filter, repeat)
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("size:") or line.startswith("format:") or \
           line.startswith("filter:") or line.startswith("repeat:") or \
           line.endswith(".png") or line == "":
            i += 1
            continue
        break

    # Parse frames
    while i < len(lines):
        line = lines[i]
        # Frame name: non-indented line that isn't a header
        if line and not line.startswith(" ") and not line.startswith("\t"):
            frame = {"name": line.strip()}
            i += 1
            # Read frame properties (indented lines)
            while i < len(lines) and (lines[i].startswith("  ") or lines[i].startswith("\t")):
                prop = lines[i].strip()
                if prop.startswith("rotate:"):
                    frame["rotate"] = prop.split(":")[1].strip().lower() == "true"
                elif prop.startswith("xy:"):
                    parts = prop.split(":")[1].strip().split(",")
                    frame["x"] = int(parts[0].strip())
                    frame["y"] = int(parts[1].strip())
                elif prop.startswith("size:"):
                    parts = prop.split(":")[1].strip().split(",")
                    frame["width"] = int(parts[0].strip())
                    frame["height"] = int(parts[1].strip())
                i += 1
            if "x" in frame and "width" in frame:
                frames.append(frame)
        else:
            i += 1

    return frames


def crop_first_frame(img, atlas_text: str):
    """
    Crop the first frame from a sprite sheet using atlas data.
    Returns cropped image, or original if atlas parsing fails.
    """
    try:
        frames = parse_spine_atlas(atlas_text)
        if not frames:
            return img

        frame = frames[0]
        x, y = frame["x"], frame["y"]
        w, h = frame["width"], frame["height"]
        rotated = frame.get("rotate", False)

        if rotated:
            # Spine atlas: sprite stored rotated 90° CCW in sheet.
            # Crop the rotated region (w/h swapped), then rotate 90° CW to restore.
            cropped = img.crop((x, y, x + h, y + w))
            cropped = cropped.transpose(Image.Transpose.ROTATE_270)
        else:
            cropped = img.crop((x, y, x + w, y + h))

        return cropped
    except Exception:
        return img


def get_atlas_from_bundle(name: str) -> str | None:
    """Try to find an atlas TextAsset in item/ or chargo/ bundle for this name."""
    for src_dir in ["item", "chargo"]:
        for variant in [name, name.lower()]:
            path = os.path.join(BUNDLE_BASE, src_dir, variant)
            if not os.path.exists(path):
                continue
            try:
                env = UnityPy.load(path)
                for obj in env.objects:
                    if obj.type.name == "TextAsset":
                        data = obj.read()
                        if data.m_Name.endswith(".atlas"):
                            script = data.m_Script
                            if isinstance(script, bytes):
                                script = script.decode("utf-8", errors="replace")
                            return script
            except Exception:
                continue
    return None


def extract_texture(bundle_path: str, target_name: str) -> tuple:
    """
    Extract the best Texture2D from a bundle.
    Returns (image, tex_name) or (None, None).
    """
    try:
        env = UnityPy.load(bundle_path)
    except Exception as e:
        return None, f"load error: {e}"

    best_tex = None
    best_size = 0
    tex_name = None

    for obj in env.objects:
        if obj.type.name == "Texture2D":
            try:
                data = obj.read()
                size = data.m_Width * data.m_Height
                # Prefer the texture matching target name, or largest
                if data.m_Name.lower() == target_name.lower():
                    img = data.image
                    return img, data.m_Name
                if size > best_size:
                    best_size = size
                    best_tex = data
                    tex_name = data.m_Name
            except Exception:
                continue

    if best_tex is not None:
        try:
            return best_tex.image, tex_name
        except Exception as e:
            return None, f"decode error: {e}"

    return None, None


def extract_from_multiple_sources(name: str) -> tuple:
    """
    Try to extract a texture for the given skin name from multiple sources.
    Returns (image, source_info) or (None, error_info).
    """
    # Strategy 1: Try ALL directories, not just the first match.
    # Some bundles (item/) are prefab-only; the texture is elsewhere.
    for subdir in SEARCH_DIRS:
        path = os.path.join(BUNDLE_BASE, subdir, name)
        if not os.path.exists(path):
            path = os.path.join(BUNDLE_BASE, subdir, name.lower())
        if os.path.exists(path):
            img, info = extract_texture(path, name)
            if img is not None:
                return img, f"{subdir}: {path}"

    # Strategy 2: Try artresource texture bundles (may have different names)
    for subdir in ["artresource/item/bulletall", "artresource/item/bulletother"]:
        path = os.path.join(BUNDLE_BASE, subdir, name.lower())
        if os.path.exists(path):
            img, info = extract_texture(path, name)
            if img is not None:
                return img, f"artresource: {path}"

    # Strategy 3: Check atlas in item/chargo bundle for texture name,
    # then find that texture in artresource
    for src_dir in ["item", "chargo"]:
        src_path = os.path.join(BUNDLE_BASE, src_dir, name.lower())
        if not os.path.exists(src_path):
            src_path = os.path.join(BUNDLE_BASE, src_dir, name)
        if not os.path.exists(src_path):
            continue
        try:
            env = UnityPy.load(src_path)
            for obj in env.objects:
                if obj.type.name == "TextAsset":
                    data = obj.read()
                    if data.m_Name.endswith(".atlas"):
                        atlas_tex = data.m_Name.replace(".atlas", "")
                        for art_sub in ["artresource/item/bulletall",
                                        "artresource/item/bulletother"]:
                            art_path = os.path.join(
                                BUNDLE_BASE, art_sub, atlas_tex.lower()
                            )
                            if os.path.exists(art_path):
                                img, info = extract_texture(art_path, atlas_tex)
                                if img is not None:
                                    return img, f"atlas->artresource: {art_path}"
        except Exception:
            pass

    # Strategy 4: Load item/chargo bundle WITH its artresource dependency
    # to resolve external sprite references
    for src_dir in ["item", "chargo"]:
        src_path = os.path.join(BUNDLE_BASE, src_dir, name.lower())
        if not os.path.exists(src_path):
            src_path = os.path.join(BUNDLE_BASE, src_dir, name)
        if not os.path.exists(src_path):
            continue
        try:
            env = UnityPy.load(src_path)
            deps = []
            for obj in env.objects:
                if obj.type.name == "AssetBundle":
                    data = obj.read()
                    deps = data.m_Dependencies if hasattr(data, "m_Dependencies") else []
                    break
            # Try loading with each dependency resolved from artresource
            if deps:
                load_paths = [src_path]
                for dep_cab in deps:
                    # Look up in our known directories
                    for art_sub in ["artresource/item/bulletall",
                                    "artresource/item/bulletother",
                                    "bulletall"]:
                        art_dir = os.path.join(BUNDLE_BASE, art_sub)
                        if not os.path.exists(art_dir):
                            continue
                        for f in os.listdir(art_dir):
                            fpath = os.path.join(art_dir, f)
                            if not os.path.isfile(fpath):
                                continue
                            try:
                                dep_env = UnityPy.load(fpath)
                                if dep_cab in dep_env.cabs:
                                    load_paths.append(fpath)
                                    break
                            except Exception:
                                continue

                if len(load_paths) > 1:
                    combined = UnityPy.load(*load_paths)
                    img, info = None, None
                    best_tex = None
                    best_size = 0
                    for obj in combined.objects:
                        if obj.type.name == "Texture2D":
                            data = obj.read()
                            size = data.m_Width * data.m_Height
                            if size > best_size:
                                best_size = size
                                best_tex = data
                    if best_tex:
                        try:
                            return best_tex.image, f"combined: {load_paths}"
                        except Exception:
                            pass
        except Exception:
            pass

    return None, "not found in any source"


def main():
    parser = argparse.ArgumentParser(description="Extract equip skin sprites from Unity bundles")
    parser.add_argument("--force", action="store_true", help="Re-extract all (ignore existing files)")
    parser.add_argument("--only", nargs="*", help="Extract only these names (for testing)")
    args = parser.parse_args()

    # Load skin data
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    skin_path = os.path.join(project_root, SKIN_JSON)

    with open(skin_path, encoding="utf-8") as f:
        skins = json.load(f)

    # Collect unique bullet_names
    bullet_names = set()
    for s in skins.values():
        if isinstance(s, dict) and s.get("bullet_name"):
            bullet_names.add(s["bullet_name"])

    if args.only:
        bullet_names = set(args.only) & bullet_names
        if not bullet_names:
            print(f"ERROR: None of {args.only} found in skin data")
            sys.exit(1)

    print(f"Total unique bullet_names to extract: {len(bullet_names)}")

    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Track results
    stats = Counter()
    errors = []

    for i, name in enumerate(sorted(bullet_names), 1):
        out_path = os.path.join(OUTPUT_DIR, f"{name}.webp")

        # Skip if already extracted (unless --force)
        if not args.force and os.path.exists(out_path):
            stats["skipped"] += 1
            continue

        img, info = extract_from_multiple_sources(name)

        if img is not None:
            try:
                # Check if this is a sprite sheet — try to crop first frame
                atlas_text = get_atlas_from_bundle(name)
                if atlas_text:
                    original_size = img.size
                    img = crop_first_frame(img, atlas_text)
                    cropped = img.size != original_size

                # Save as WebP for consistency with other assets
                img.save(out_path, "WEBP", quality=90)
                stats["success"] += 1
                crop_info = " (cropped)" if atlas_text else ""
                if i % 50 == 0 or i <= 5:
                    print(f"  [{i}/{len(bullet_names)}] {name}: OK ({img.size[0]}x{img.size[1]}){crop_info}")
            except Exception as e:
                stats["save_error"] += 1
                errors.append(f"{name}: save error: {e}")
        else:
            stats["failed"] += 1
            errors.append(f"{name}: {info}")

        if i % 100 == 0:
            print(f"  Progress: {i}/{len(bullet_names)} | success={stats['success']} failed={stats['failed']} skipped={stats['skipped']}")

    # Summary
    print(f"\n{'='*50}")
    print(f"Extraction complete!")
    print(f"  Success:    {stats['success']}")
    print(f"  Skipped:    {stats['skipped']}")
    print(f"  Failed:     {stats['failed']}")
    print(f"  Save error: {stats['save_error']}")
    print(f"  Output dir: {OUTPUT_DIR}")

    if errors:
        print(f"\nErrors ({len(errors)}):")
        for e in errors[:30]:
            print(f"  {e}")
        if len(errors) > 30:
            print(f"  ... and {len(errors) - 30} more")

        # Save full error log
        log_path = os.path.join(OUTPUT_DIR, "_extraction_log.txt")
        with open(log_path, "w", encoding="utf-8") as f:
            for e in errors:
                f.write(e + "\n")
        print(f"  Full log: {log_path}")


if __name__ == "__main__":
    main()
