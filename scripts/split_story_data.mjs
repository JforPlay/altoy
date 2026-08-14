/**
 * Split main_story_data.json into:
 * - main_story_index.json (metadata only for event grid)
 * - main_story_chapters/chapter_{id}.json (full chapter data with stories)
 *
 * Also emits story_actor_index.json (character → memories, for /story-search/)
 * from the main / event / world memories walked along the way.
 *
 * Usage: node scripts/split_story_data.mjs
 */
import fs from 'fs';
import path from 'path';
import { buildActorIndex } from './story-actor-index.mjs';

const INPUT = 'public/data/story-viewer/main_story_data.json';
const OUTPUT_DIR = 'public/data/story-viewer/main_story_chapters';
const INDEX_FILE = 'public/data/story-viewer/main_story_index.json';

// Filled while splitting; consumed by the actor-index pass at the bottom.
const actorSources = [];

/** Normalize one chapter/event/world entry into the actor-index input shape. */
const asActorSource = (src, id, name, memories, subtype) => ({
    src,
    id,
    name,
    subtype,
    memories: (memories || []).map((m) => ({
        id: m.id,
        // Event memories title on `title`, main/world on `name` — the same
        // fallback the engine's memory cards use.
        title: m.title || m.name || '',
        scripts: m.story?.scripts,
    })),
});

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

    actorSources.push(asActorSource('m', index[chapterId].id, chapterData.name, chapterData.memory_id));

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

// ===== Event story archive: same split, event-specific index fields =====
const EVENT_INPUT = 'public/data/story-viewer/event_story_data.json';
const EVENT_OUTPUT_DIR = 'public/data/story-viewer/event_story_chunks';
const EVENT_INDEX_FILE = 'public/data/story-viewer/event_story_index.json';

if (fs.existsSync(EVENT_INPUT)) {
    const eventData = JSON.parse(fs.readFileSync(EVENT_INPUT, 'utf-8'));
    if (!fs.existsSync(EVENT_OUTPUT_DIR)) fs.mkdirSync(EVENT_OUTPUT_DIR, { recursive: true });

    const eventIndex = {};
    for (const [id, entry] of Object.entries(eventData)) {
        const rec = {
            id: entry.id || Number(id),
            name: entry.name || '',
            description: entry.description || '',
            icon: entry.icon || '',
            subtype: entry.subtype ?? null,
            year: entry.year ?? null,
            dateRange: entry.dateRange || '',
            faction: entry.faction || '',
            ships: entry.ships || [],
            memoryCount: entry.memory_id ? entry.memory_id.length : 0,
            route: entry.route || 'inline',
        };
        if (rec.route === 'deeplink') {
            rec.deeplinkPath = entry.deeplinkPath || 'story-viewer/main-story/';
            rec.deeplinkEventId = entry.deeplinkEventId ?? null;
        }
        eventIndex[id] = rec;
        actorSources.push(asActorSource('e', rec.id, rec.name, entry.memory_id, rec.subtype));
        fs.writeFileSync(path.join(EVENT_OUTPUT_DIR, `chunk_${id}.json`), JSON.stringify(entry));
    }
    fs.writeFileSync(EVENT_INDEX_FILE, JSON.stringify(eventIndex));
    console.log(`\n[event-story] ${Object.keys(eventData).length} events → index + chunks`);
}

// ===== Character search: one index over main + event + world memories =====
const WORLD_INPUT = 'public/data/story-viewer/world_story_data.json';
const ACTOR_TABLE = 'public/data/story-viewer/shipgirl_data.json';
const ACTOR_INDEX_FILE = 'public/data/story-viewer/story_actor_index.json';

// World chapters are not split (the viewer loads the whole file), so they are
// read here rather than accumulated above.
if (fs.existsSync(WORLD_INPUT)) {
    const worldData = JSON.parse(fs.readFileSync(WORLD_INPUT, 'utf-8'));
    for (const [chapterId, chapter] of Object.entries(worldData)) {
        actorSources.push(asActorSource('w', Number(chapterId), chapter.name, chapter.child));
    }
}

// Rarity/진영 are baked in so the page needs no second fetch; absent roster data
// just drops those two labels. The 진영 NAME is resolved here rather than shipped
// as an id: nationality_mapping.json is the complete list (collab factions
// included), while the story viewers' FACTION_NAMES constant covers only 12 of
// them and would leave collab characters blank.
const SHIP_INFO = 'public/data/ship_info_lite.json';
const NATION_MAP = 'public/data/mapping/nationality_mapping.json';
const shipInfo = {};
if (fs.existsSync(SHIP_INFO)) {
    const nations = fs.existsSync(NATION_MAP) ? JSON.parse(fs.readFileSync(NATION_MAP, 'utf-8')) : {};
    for (const ship of JSON.parse(fs.readFileSync(SHIP_INFO, 'utf-8'))) {
        if (ship?.gid) {
            shipInfo[ship.gid] = { rarity: ship.rarity, faction: nations[ship.nationality]?.name || '' };
        }
    }
}

const actorTable = JSON.parse(fs.readFileSync(ACTOR_TABLE, 'utf-8'));
const actorIndex = buildActorIndex(actorSources, actorTable, shipInfo);
const actorJson = JSON.stringify(actorIndex);
fs.writeFileSync(ACTOR_INDEX_FILE, actorJson);
console.log(
    `[story-search] ${actorIndex.memories.length} memories, `
    + `${Object.keys(actorIndex.ships).length} characters → ${(actorJson.length / 1024).toFixed(0)} KB`
);
