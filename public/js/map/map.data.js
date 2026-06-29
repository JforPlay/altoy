/**
 * map.data.js
 * Data loading and lookup helpers for the map viewer.
 * Part of the map module group (viewer + data + detail + grid + compare).
 * State is shared via a ref passed to setup() from map.viewer.js.
 * World exploration data requires cross-referencing world_chapter_random.json for Korean names.
 */

import { fetchJSON, fetchJSONWithCache, RARITY_ORDER } from '../utils.js';

let state;

/** Reverse mapping: world_chapter_template ID → { randomId, name, hazard_level } */
let explorationMap = null;

/** world_target_data keyed by target ID */
let worldTargetData = null;

/** Receive shared state from map.viewer.js. */
export function setup(stateRef) {
    state = stateRef;
}

/**
 * Load the lite map list and cross-reference world entries with world_chapter_random.json.
 * World entries are filtered to those with a Korean name in the random data,
 * and enriched with name, hazard_level, and randomId for exploration map handling.
 */
export async function loadLiteData() {
    const raw = await fetchJSON('data/maps/map_data_lite.json');
    if (!raw) return;

    // Build exploration map lookup from world_chapter_random
    const randomData = await fetchJSON('data/maps/world_chapter_random.json');
    if (randomData) {
        explorationMap = {};
        for (const [id, entry] of Object.entries(randomData)) {
            if (!entry || !entry.name) continue;
            for (const tmpl of entry.template_id || []) {
                explorationMap[tmpl[0]] = {
                    randomId: parseInt(id),
                    name: entry.name,
                    hazard_level: entry.hazard_level,
                };
            }
        }
    }

    // Filter world entries: only exploration maps with Korean names
    if (raw.world && explorationMap) {
        raw.world = raw.world
            .filter(w => explorationMap[w.id])
            .map(w => ({
                ...w,
                name: explorationMap[w.id].name,
                hazard_level: explorationMap[w.id].hazard_level,
                randomId: explorationMap[w.id].randomId,
            }));
    }

    state.liteData = raw;
}

/**
 * Load full chapter data (cached 24h) and apply Korean names to world entries.
 * World keys use "w_" prefix (e.g., "w_1001"); other categories use string IDs.
 */
export async function loadFullData() {
    try {
        state.fullData = await fetchJSONWithCache(
            'data/maps/map_data_full.json',
            { maxAge: 86400000 }
        );

        // Apply Korean names to full world data
        if (state.fullData && explorationMap) {
            for (const [key, chapter] of Object.entries(state.fullData)) {
                if (!key.startsWith('w_')) continue;
                const id = parseInt(key.slice(2));
                if (explorationMap[id]) {
                    chapter.name = explorationMap[id].name;
                    chapter.randomId = explorationMap[id].randomId;
                    chapter.hazard_level = explorationMap[id].hazard_level;
                }
            }
        }

        return state.fullData;
    } catch (error) {
        console.warn('Failed to load full map data:', error);
    }
    return null;
}

/** Load enemy stat data (cached 24h). Returns the cache if already loaded. */
export async function loadEnemyStats() {
    if (state.enemyStats) return state.enemyStats;
    try {
        state.enemyStats = await fetchJSONWithCache(
            'data/maps/enemy_data_statistics.json',
            { maxAge: 86400000 }
        );
        return state.enemyStats;
    } catch (error) {
        console.warn('Failed to load enemy stats:', error);
    }
    return null;
}

/** Reverse lookup: gid -> ship.id */
let gidToId = null;

/**
 * Load ship info lite data for drop name and portrait resolution.
 * Also builds gidToId for war archive drops where ship IDs are gids (group IDs).
 */
export async function loadShipInfo() {
    if (state.shipInfo) return state.shipInfo;
    try {
        const data = await fetchJSON('data/ship_info_lite.json');
        state.shipInfo = {};
        gidToId = {};
        for (const ship of data) {
            state.shipInfo[ship.id] = {
                gid: ship.gid,
                name: ship.name,
                rarity: ship.rarity,
                shipyard: ship.shipyard || '',
                maps: ship.maps || [],
            };
            if (ship.gid) gidToId[ship.gid] = ship.id;
        }
        // KR server fix: ship 236/155 map drop swap is handled in ship_info_process.py
        // (data in ship_info_lite.json is already corrected for KR)
        return state.shipInfo;
    } catch (error) {
        console.warn('Failed to load ship info:', error);
    }
    return null;
}

/** Get ship info by ID. */
export function getShipInfo(shipId) {
    return state.shipInfo?.[shipId] || null;
}

/** Get ship info by gid (game group_id). Used for war archive drops where IDs are gids. */
export function getShipInfoByGid(gid) {
    if (!gidToId || !state.shipInfo) return null;
    const id = gidToId[gid];
    return id != null ? state.shipInfo[id] : null;
}

/** Get ships that drop in a given main story chapter stage.
 *  chapterId: e.g. 1304 (13-4). Returns [{id, name, rarity, shipyard, bossOnly}]
 */
export function getShipDropsForChapter(chapterId) {
    if (!state.shipInfo) return [];
    const cid = parseInt(chapterId);
    if (cid < 100 || cid > 1999) return []; // Main story only
    const chapterNum = Math.floor(cid / 100); // 13
    const stageNum = cid % 100;               // 4
    const areaIdx = chapterNum - 1;           // 0-indexed

    const result = [];
    for (const [id, ship] of Object.entries(state.shipInfo)) {
        if (!ship.maps || areaIdx >= ship.maps.length) continue;
        const area = ship.maps[areaIdx];
        if (!area) continue;
        for (const drop of area) {
            if (drop.map === stageNum) {
                result.push({
                    id: parseInt(id),
                    gid: ship.gid,
                    name: ship.name,
                    rarity: ship.rarity,
                    shipyard: ship.shipyard,
                    bossOnly: drop.type === 1,
                });
                break;
            }
        }
    }
    // Sort by rarity (UR > SSR > SR > R > N), then boss-only first
    result.sort((a, b) => {
        const ra = RARITY_ORDER[a.rarity] ?? 5;
        const rb = RARITY_ORDER[b.rarity] ?? 5;
        if (ra !== rb) return ra - rb;
        return (b.bossOnly ? 1 : 0) - (a.bossOnly ? 1 : 0);
    });
    return result;
}

/** Get full chapter data by ID (string key). World chapters use "w_" prefix. */
export function getChapter(mapId) {
    if (!state.fullData) return null;
    return state.fullData[String(mapId)] || null;
}

/** Load world target data for exploration map conditions. */
export async function loadWorldTargetData() {
    if (worldTargetData) return worldTargetData;
    try {
        worldTargetData = await fetchJSON('data/maps/world_target_data.json');
        return worldTargetData;
    } catch (error) {
        console.warn('Failed to load world target data:', error);
    }
    return null;
}

/** Get 5 target conditions for an exploration map by its randomId. */
export function getWorldTargets(randomId) {
    if (!worldTargetData) return [];
    const targets = [];
    for (let i = 1; i <= 5; i++) {
        const targetId = String(randomId) + String(i).padStart(2, '0');
        const target = worldTargetData[targetId];
        if (target) {
            targets.push({
                ...target,
                hidden: i > 3,
            });
        }
    }
    return targets;
}

/**
 * Extract chapter number for sidebar grouping.
 * Main/hard: derived from `map` field (map 1 = 1장, map 201 = 1장 hard, etc.)
 * Event: grouped by act_id/event_name
 * World: grouped by tier ranges
 */
export function getChapterGroup(entry, category) {
    if (category === 'main') {
        return entry.map || Math.floor(entry.id / 100);
    }
    if (category === 'hard') {
        // Hard map field: 201=ch1, 202=ch2, ..., 214=ch14
        return entry.map ? entry.map - 200 : Math.floor((entry.id - 10000) / 100);
    }
    if (category === 'event') {
        return entry.event_name || `이벤트 #${entry.act_id}`;
    }
    if (category === 'archive') {
        return entry.event_name || `작전 문서 #${entry.archive_id}`;
    }
    if (category === 'world') {
        const name = entry.name || '';
        // Safe zone maps
        if (name.includes('-안전 해역')) return '안전 해역';
        // Special categories
        if (name.includes('세이렌 실험장')) return '세이렌 실험장';
        if (name.includes('세이렌 요새')) return '세이렌 요새';
        if (name.includes('비밀 해역')) return '비밀 해역';
        if (name.includes('심연 해역')) return '심연 해역';
        if (name.includes('파일 해역')) return '파일 해역';
        if (name.includes('파괴된 해역')) return '파괴된 해역';
        if (name.includes('조각난 공간')) return '조각난 공간';
        if (name.includes('아비터') || name.includes('익스큐터') || name.includes('핵심 구역')) return '핵심 구역';
        // Region with A-H suffix: "카리브해A" → "카리브해"
        const suffixMatch = name.match(/^(.+?)([A-H])$/);
        if (suffixMatch) return suffixMatch[1];
        // Ports (hazard_level 1): NY, 리버풀, etc.
        if (entry.hazard_level <= 1) return '항구';
        return name;
    }
    return '';
}
