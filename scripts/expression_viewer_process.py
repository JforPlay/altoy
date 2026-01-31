"""
Expression Viewer Data Processor

This script creates a filtered list of expression IDs that don't exist in
skin_voiceline_data.json, enriches them with Korean names from ship_skin_template.json,
and outputs a JSON file for the expression viewer page.
"""

import requests
import json
import re
import logging
from typing import Dict, List, Any, Optional
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ExpressionViewerProcessor:
    """Process expression manifest data for the standalone expression viewer."""

    # API URLs
    URLS = {
        'ship_skin_template': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/ship_skin_template.json",
        'name_code': "https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/name_code.json"
    }

    # Base URL for expression images
    EXPRESSION_BASE_URL = "https://raw.githubusercontent.com/JforPlay/data_for_toy/main/output_expressions"

    # Pattern for namecode replacement
    NAMECODE_PATTERN = re.compile(r'\{namecode:(\d+)\}')

    def __init__(self):
        self.expression_manifest = {}
        self.skin_voiceline_ids = set()
        self.ship_skin_template = {}
        self.name_code = {}
        self.output_data = []

    def fetch_json_data(self, url: str) -> Dict[str, Any]:
        """Fetch JSON data from URL with error handling."""
        try:
            logger.info(f"Fetching data from {url}...")
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Error fetching data from {url}: {e}")
            raise

    def load_local_json(self, filepath: str) -> Any:
        """Load JSON data from local file."""
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading {filepath}: {e}")
            raise

    def load_all_data(self, manifest_path: str, voiceline_path: str) -> None:
        """Load all required data from local files and API."""
        # Load expression manifest
        logger.info(f"Loading expression manifest from {manifest_path}...")
        self.expression_manifest = self.load_local_json(manifest_path)
        logger.info(f"Loaded {len(self.expression_manifest)} expression entries")

        # Load skin voiceline data and extract IDs
        logger.info(f"Loading skin voiceline data from {voiceline_path}...")
        voiceline_data = self.load_local_json(voiceline_path)

        # Extract skin IDs (클뜯 id field)
        for skin in voiceline_data:
            skin_id = skin.get('클뜯 id')
            if skin_id:
                self.skin_voiceline_ids.add(str(skin_id))
        logger.info(f"Found {len(self.skin_voiceline_ids)} skin IDs in voiceline data")

        # Fetch ship skin template for Korean names
        self.ship_skin_template = self.fetch_json_data(self.URLS['ship_skin_template'])
        logger.info(f"Loaded {len(self.ship_skin_template)} ship skin template entries")

        # Fetch name_code for namecode resolution
        self.name_code = self.fetch_json_data(self.URLS['name_code'])
        logger.info(f"Loaded {len(self.name_code)} name_code entries")

    def is_numeric_id(self, id_str: str) -> bool:
        """Check if the ID is purely numeric."""
        return id_str.isdigit()

    def extract_base_id(self, manifest_key: str) -> str:
        """Extract base ID from manifest key (removes _n suffix)."""
        if manifest_key.endswith('_n'):
            return manifest_key[:-2]
        return manifest_key

    def resolve_namecode(self, text: str) -> str:
        """Replace {namecode:XXX} patterns with actual names from name_code.json."""
        if not text:
            return text

        def replace_match(match):
            code_id = match.group(1)
            if code_id in self.name_code:
                name = self.name_code[code_id].get('name', '')
                if name:
                    return name
            return match.group(0)  # Return original if not found

        return self.NAMECODE_PATTERN.sub(replace_match, text)

    def get_korean_name(self, skin_id: str) -> Optional[str]:
        """Get Korean name for a skin ID from ship_skin_template."""
        # First try exact match
        if skin_id in self.ship_skin_template:
            raw_name = self.ship_skin_template[skin_id].get('name', '').strip()
            return self.resolve_namecode(raw_name)

        # Try numeric key
        try:
            int_id = int(skin_id)
            for key, value in self.ship_skin_template.items():
                if isinstance(value, dict) and value.get('id') == int_id:
                    raw_name = value.get('name', '').strip()
                    return self.resolve_namecode(raw_name)
        except ValueError:
            pass

        return None

    def process_expressions(self) -> None:
        """Process expression manifest and filter out existing skin IDs."""
        logger.info("Processing expressions...")

        # Group manifest entries by base ID
        grouped_entries = {}
        skipped_non_numeric = 0

        for manifest_key, manifest_data in self.expression_manifest.items():
            base_id = self.extract_base_id(manifest_key)

            # Skip non-numeric IDs
            if not self.is_numeric_id(base_id):
                skipped_non_numeric += 1
                continue

            is_zoomed = manifest_key.endswith('_n')

            if base_id not in grouped_entries:
                grouped_entries[base_id] = {
                    'id': base_id,
                    'name': None,
                    'painting': None,
                    'painting_n': None
                }

            if is_zoomed:
                grouped_entries[base_id]['painting_n'] = manifest_data
            else:
                grouped_entries[base_id]['painting'] = manifest_data

        logger.info(f"Skipped {skipped_non_numeric} non-numeric IDs")
        logger.info(f"Grouped into {len(grouped_entries)} unique numeric base IDs")

        # Filter out IDs that exist in skin_voiceline_data
        filtered_count = 0
        no_name_count = 0

        for base_id, entry in grouped_entries.items():
            if base_id in self.skin_voiceline_ids:
                filtered_count += 1
                continue

            # Get Korean name
            korean_name = self.get_korean_name(base_id)

            # Skip entries without a valid Korean name
            if not korean_name:
                no_name_count += 1
                continue

            entry['name'] = korean_name

            # Build image URLs
            if entry['painting']:
                entry['painting']['base_url'] = f"{self.EXPRESSION_BASE_URL}/{base_id}/painting.png"
                entry['painting']['face_url_template'] = f"{self.EXPRESSION_BASE_URL}/{base_id}/painting_face_{{faceId}}.png"

            if entry['painting_n']:
                entry['painting_n']['base_url'] = f"{self.EXPRESSION_BASE_URL}/{base_id}/painting_n.png"
                entry['painting_n']['face_url_template'] = f"{self.EXPRESSION_BASE_URL}/{base_id}/painting_n_face_{{faceId}}.png"

            self.output_data.append(entry)

        logger.info(f"Filtered out {filtered_count} IDs that exist in skin_voiceline_data")
        logger.info(f"Skipped {no_name_count} IDs without Korean names")
        logger.info(f"Final output contains {len(self.output_data)} entries")

        # Sort by name for better UX
        self.output_data.sort(key=lambda x: (x['name'] or '').lower())

    def save_output(self, output_path: str) -> None:
        """Save processed data to JSON file."""
        logger.info(f"Saving output to {output_path}...")

        # Ensure output directory exists
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(self.output_data, f, ensure_ascii=False, indent=2)

        logger.info(f"Successfully saved {len(self.output_data)} entries")


def main():
    """Main execution function."""
    # Define paths
    script_dir = Path(__file__).parent
    manifest_path = script_dir.parent / "data" / "skin" / "expression_manifest.json"
    voiceline_path = script_dir.parent / "data" / "skin" / "skin_voiceline_data.json"
    output_path = script_dir / "output" / "skin" / "expression_viewer_data.json"

    processor = ExpressionViewerProcessor()

    try:
        # Load all data
        processor.load_all_data(str(manifest_path), str(voiceline_path))

        # Process expressions
        processor.process_expressions()

        # Save output
        processor.save_output(str(output_path))

        print(f"\n[OK] Processing completed!")
        print(f"[OK] Total entries: {len(processor.output_data)}")
        print(f"[OK] Output file: {output_path}")

    except Exception as e:
        logger.error(f"Processing failed: {e}")
        raise


if __name__ == "__main__":
    main()
