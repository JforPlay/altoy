/**
 * island.season-map.js
 * Per-item season membership for the KR island viewer. Pure helpers (testable)
 * + stateful wrapper that initializes from island_season.json. Consumers call
 * renderSeasonBadge(itemId) to get a status pill or '' for non-seasonal items.
 *
 * Maintenance: when a new season launches, update SEASON_ID_RANGES — see
 * CLAUDE.md > Island Seasonal Items > "When a new season launches".
 */

'use strict';

// ===== Constants =====

/**
 * Hand-maintained per-season ID ranges. Loose upper bound on the current
 * season catches newly added items between season updates.
 *
 * As of 2026-05-22 (S3 live). When S4 launches:
 *   1. Tighten S3's max to (S4_min - 1).
 *   2. Append { season: 4, min: <S4_min>, max: <S4_min + 70> }.
 */
export const SEASON_ID_RANGES = [
    { season: null, min: 4001, max: 4018 }, // unclassified / pre-season-system
    { season: 2,    min: 4019, max: 4028 }, // Ⅱ — anchored by 4019 아스파라거스
    { season: 3,    min: 4029, max: 4099 }, // Ⅲ — anchored by 4029 자스민 / 4031 수박
];

/**
 * Thematic season titles — not in island_season.json (data only carries the
 * generic "개발 시즌Ⅲ"). When a new season launches, add one line below.
 *
 *   <season id>: '<KR thematic title>',   // e.g. 4: '겨울 ○○ 경영',
 */
export const SEASON_THEMATIC_NAMES = {
    3: '여름 특산물 경영',
};

// ===== Pure Helpers (testable) =====

/**
 * Convert a KST `[[Y, M, D], [h, m, s]]` window endpoint to UTC milliseconds.
 * The game schedule is published in KST (UTC+9); compare against Date.now()
 * directly after this conversion.
 */
export function krWindowToMs([[Y, M, D], [h, m, s]]) {
    return Date.UTC(Y, M - 1, D, h - 9, m, s);
}

/**
 * `timeArr` is `[[startDate, startTime], [endDate, endTime], ...]` — a flat
 * pair-list. The Lua schema allows paused/resumed seasons, so check every
 * (start, end) pair.
 */
export function isWithinAnyWindow(timeArr, nowMs) {
    for (let i = 0; i + 1 < timeArr.length; i += 2) {
        const start = krWindowToMs(timeArr[i]);
        const end = krWindowToMs(timeArr[i + 1]);
        if (nowMs >= start && nowMs <= end) return true;
    }
    return false;
}

/**
 * Walk `seasonsData` (the parsed island_season.json) and return the id of the
 * season whose time window contains `nowMs`, or null if none does.
 */
export function findCurrentSeasonId(seasonsData, nowMs) {
    for (const key of Object.keys(seasonsData)) {
        if (key === 'all') continue;
        const season = seasonsData[key];
        if (!season || !Array.isArray(season.time)) continue;
        if (isWithinAnyWindow(season.time, nowMs)) return season.id;
    }
    return null;
}

/**
 * Match itemId against SEASON_ID_RANGES. Returns the range descriptor or null
 * for items outside any known range (including all non-4xxx IDs).
 */
export function lookupItemSeasonRange(itemId) {
    for (const range of SEASON_ID_RANGES) {
        if (itemId >= range.min && itemId <= range.max) return range;
    }
    return null;
}

// ===== Stateful Wrapper =====

let _state = null;

/**
 * Initialize the season map. Call from island.engine.js after both
 * island_season.json and island_item_data_template.json are loaded —
 * normally exactly once per page load (loadSharedData memoizes). Each
 * call re-runs the orphan scan and replaces _state, so callers that
 * legitimately want to refresh on a data reload can simply re-invoke.
 *
 * The orphan scan: any 4xxx item id not covered by SEASON_ID_RANGES
 * produces a single console.warn so a maintainer opening DevTools after
 * a future season launch sees the drift immediately.
 */
export function initSeasonMap(seasonsData, opts = {}) {
    const nowMs = opts.nowMs ?? Date.now();
    const items = opts.items || {};

    const currentSeasonId = findCurrentSeasonId(seasonsData, nowMs);

    const orphans = [];
    for (const key of Object.keys(items)) {
        const id = Number(key);
        if (!Number.isFinite(id)) continue;
        if (id < 4001 || id > 4999) continue;
        if (lookupItemSeasonRange(id) === null) orphans.push(id);
    }
    if (orphans.length > 0) {
        console.warn(
            `[island.season-map] ${orphans.length} item id(s) in 4xxx range are missing from SEASON_ID_RANGES — ` +
            `update the table per CLAUDE.md > Island Seasonal Items. Orphans: ${orphans.join(', ')}`
        );
    }

    _state = { seasonsData, currentSeasonId };
}

/**
 * Returns { seasonId, label, isCurrent } for a known seasonal item,
 * or null if the item is outside any known range (callers render no badge).
 *
 * Returns null before initSeasonMap has been called — safe default for
 * accidental early calls during module wiring.
 */
export function getItemSeason(itemId) {
    if (!_state) return null;
    const range = lookupItemSeasonRange(itemId);
    if (range === null) return null;

    const seasonId = range.season;
    let label;
    if (seasonId === null) {
        label = '이전 시즌';
    } else {
        label = _state.seasonsData[String(seasonId)]?.name_short || `시즌 ${seasonId}`;
    }
    const isCurrent = seasonId !== null && seasonId === _state.currentSeasonId;
    return { seasonId, label, isCurrent };
}

/**
 * Render the badge HTML for the given item id, or '' for non-seasonal items
 * (so consumers can drop the call unconditionally into a meta-badge row).
 */
export function renderSeasonBadge(itemId) {
    const season = getItemSeason(itemId);
    if (!season) return '';
    const cls = season.isCurrent ? 'season-badge--current' : 'season-badge--past';
    const status = season.isCurrent ? '진행중' : '종료';
    return `<span class="season-badge ${cls}"><span class="season-badge__dot"></span>${season.label} · ${status}</span>`;
}

/**
 * Returns the current season id (or null if between seasons). Exposed so
 * other modules can replace bespoke "latest season" heuristics with the
 * canonical time-window answer.
 */
export function getCurrentSeasonId() {
    return _state?.currentSeasonId ?? null;
}

/**
 * Returns the thematic name for a given season id (e.g. "여름 특산물 경영"
 * for S3) or null if no override is registered. Callers should fall back
 * to the data's generic `name` field when this returns null.
 */
export function getSeasonThematicName(seasonId) {
    return SEASON_THEMATIC_NAMES[seasonId] ?? null;
}

// Test-only reset hook. Production callers should never invoke this — calling
// it from app code would re-trigger the orphan scan and reset memoization.
export function _resetForTests() {
    _state = null;
}

// Browser-side global exposure for non-module callers (matches the pattern
// used by other island.*.js modules via window.IslandEngine etc.). Safe in
// node tests because `typeof window === 'undefined'` short-circuits.
if (typeof window !== 'undefined') {
    window.IslandSeasonMap = {
        initSeasonMap,
        getItemSeason,
        renderSeasonBadge,
        getCurrentSeasonId,
        getSeasonThematicName,
    };
}
