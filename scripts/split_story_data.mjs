/**
 * Split main_story_data.json into:
 * - main_story_index.json (metadata only for event grid)
 * - main_story_chapters/chapter_{id}.json (full chapter data with stories)
 *
 * Usage: node scripts/split_story_data.mjs
 */
import fs from 'fs';
import path from 'path';

const INPUT = 'public/data/story-viewer/main_story_data.json';
const OUTPUT_DIR = 'public/data/story-viewer/main_story_chapters';
const INDEX_FILE = 'public/data/story-viewer/main_story_index.json';

// Read the full data
const rawData = fs.readFileSync(INPUT, 'utf-8');
const data = JSON.parse(rawData);

// Create output directory
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Build index (lightweight metadata for event grid)
const index = {};
let totalChapterSize = 0;

for (const [chapterId, chapterData] of Object.entries(data)) {
    // Index only needs: name, description, icon, id, link_event, shipnation, sort
    index[chapterId] = {
        id: chapterData.id || chapterId,
        name: chapterData.name,
        description: chapterData.description || '',
        icon: chapterData.icon || '',
        link_event: chapterData.link_event || null,
        shipnation: chapterData.shipnation || '',
        sort: chapterData.sort || 0,
        // Include memory count for UI display
        memoryCount: chapterData.memory_id ? chapterData.memory_id.length : 0
    };

    // Write full chapter data to individual file
    const chapterPath = path.join(OUTPUT_DIR, `chapter_${chapterId}.json`);
    const chapterJson = JSON.stringify(chapterData);
    fs.writeFileSync(chapterPath, chapterJson);
    totalChapterSize += chapterJson.length;

    console.log(`Chapter ${chapterId}: ${chapterData.name} (${(chapterJson.length / 1024).toFixed(1)} KB, ${index[chapterId].memoryCount} memories)`);
}

// Write index file
const indexJson = JSON.stringify(index);
fs.writeFileSync(INDEX_FILE, indexJson);

console.log('\n--- Summary ---');
console.log(`Total chapters: ${Object.keys(data).length}`);
console.log(`Index file: ${(indexJson.length / 1024).toFixed(1)} KB`);
console.log(`Total chapter files: ${(totalChapterSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`Original file: ${(rawData.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`\nFiles written to: ${OUTPUT_DIR}/`);
console.log(`Index written to: ${INDEX_FILE}`);
