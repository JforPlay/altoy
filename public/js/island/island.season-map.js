/**
 * island.season-map.js
 * Per-item season membership for the KR island viewer. Pure helpers (testable)
 * + stateful wrapper that initializes from island_season.json. Consumers call
 * renderSeasonBadge(itemId) to get a status pill or '' for non-seasonal items.
 *
 * Maintenance: when a new season launches, update SEASON_THEMES — see
 * CLAUDE.md > Island Seasonal Items > "When a new season launches".
 */

'use strict';

// ===== Constants =====

/**
 * Seasons cycle THEMES, and a repeated theme re-runs the SAME item ids —
 * S4 (가을) reuses S1's exact 4001–4014 block rather than adding new ones.
 * So item id → season is not a function; item id → theme is. Both tables
 * below are read straight off the game's own 특산품 경영 request tasks
 * (`island_task[500010xx/500020xx]`: `series` = the theme title,
 * `unlock_time` = the season window, `target_id.target_param` = the items).
 * They are hand-copied rather than derived because the only file carrying
 * them, `tasks.json`, is 755 KB and the island boots on ~160 KB.
 *
 * Verified against KR 8.5.63 (2026-08-20).
 */

/**
 * Item id block → theme. Bounds are TIGHT on purpose: a future 겨울 season
 * would add ids past the last block, and bucketing those into the previous
 * theme would print a confidently wrong "종료" badge on a live item. Leaving
 * them unmapped renders no badge and trips the orphan warn in initSeasonMap.
 */
export const THEME_ID_RANGES = [
    { theme: 'fall',   min: 4001, max: 4014 }, // 가을 — 가을 국화 … 국화차
    { theme: 'spring', min: 4015, max: 4028 }, // 봄 — 봄 죽순 … 봄의 꽃다발
    { theme: 'summer', min: 4029, max: 4042 }, // 여름 — 자스민 … 여름 꽃다발
];

/**
 * Season id → theme. KR has never run a 겨울 season: S4 went back to 가을.
 * When a new season launches, add one line here (and a THEME_ID_RANGES block
 * only if it ships item ids nobody has seen before).
 */
export const SEASON_THEMES = {
    1: 'fall',   // 2025-11-20 ~ 2026-02-26
    2: 'spring', // 2026-02-26 ~ 2026-05-21
    3: 'summer', // 2026-05-21 ~ 2026-08-20
    4: 'fall',   // 2026-08-20 ~ 2026-11-19 — reuses S1's items
};

/** Theme → the in-game title (island_task `series`, minus its brackets). */
export const THEME_NAMES = {
    fall: '가을 특산품 경영',
    spring: '봄 특산품 경영',
    summer: '여름 특산품 경영',
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
 * Match itemId against THEME_ID_RANGES. Returns the theme key or null for
 * items outside any known block (including all non-4xxx IDs).
 */
export function lookupItemTheme(itemId) {
    for (const range of THEME_ID_RANGES) {
        if (itemId >= range.min && itemId <= range.max) return range.theme;
    }
    return null;
}

/**
 * Every season id that has run (or is running) the given theme, ascending.
 * A theme repeats across seasons — 가을 is both S1 and S4 — so this is the
 * list, not a single id.
 */
export function seasonsForTheme(theme) {
    return Object.keys(SEASON_THEMES)
        .filter((id) => SEASON_THEMES[id] === theme)
        .map(Number)
        .sort((a, b) => a - b);
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
 * The orphan scan: any 4xxx item id not covered by THEME_ID_RANGES
 * produces a single console.warn so a maintainer opening DevTools after
 * a future season launch sees the drift immediately. Because the blocks
 * are tightly bounded, a season that ships genuinely new items (e.g. a
 * first 겨울) trips this on its first load rather than mislabelling them.
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
        if (lookupItemTheme(id) === null) orphans.push(id);
    }
    if (orphans.length > 0) {
        console.warn(
            `[island.season-map] ${orphans.length} item id(s) in 4xxx range are missing from THEME_ID_RANGES — ` +
            `update the table per CLAUDE.md > Island Seasonal Items. Orphans: ${orphans.join(', ')}`
        );
    }

    _state = { seasonsData, currentSeasonId, nowMs };
}

/**
 * Returns { theme, seasonId, seasons, label, isCurrent } for a known seasonal
 * item, or null if the item is outside any known block (callers render no
 * badge).
 *
 * `seasonId` is the run the badge speaks for: the live season when the item is
 * in it, otherwise the most recent run that has ALREADY STARTED. Taking the
 * highest id instead would label a 가을 item mid-S3 as "시즌Ⅳ · 종료" — a
 * season that has not happened yet; taking the lowest would label the same
 * item mid-S4 as "시즌Ⅰ · 종료" while it is sitting in the shop.
 *
 * Returns null before initSeasonMap has been called — safe default for
 * accidental early calls during module wiring.
 */
export function getItemSeason(itemId) {
    if (!_state) return null;
    const theme = lookupItemTheme(itemId);
    if (theme === null) return null;

    const seasons = seasonsForTheme(theme);
    const isCurrent = seasons.includes(_state.currentSeasonId);
    const started = seasons.filter((id) => {
        const time = _state.seasonsData[String(id)]?.time;
        return Array.isArray(time) && time.length > 0 && krWindowToMs(time[0]) <= _state.nowMs;
    });
    const seasonId = isCurrent
        ? _state.currentSeasonId
        : (started[started.length - 1] ?? seasons[0]);
    const label = _state.seasonsData[String(seasonId)]?.name_short || `시즌 ${seasonId}`;
    return { theme, seasonId, seasons, label, isCurrent };
}

/**
 * Render the badge HTML for the given item id, or '' for non-seasonal items
 * (so consumers can drop the call unconditionally into a meta-badge row).
 */
export function renderSeasonBadge(itemId) {
    const season = getItemSeason(itemId);
    if (!season) return '';
    const cls = season.isCurrent
        ? 'badge--success season-badge--current'
        : 'badge--neutral season-badge--past';
    const status = season.isCurrent ? '진행중' : '종료';
    return `<span class="badge season-badge ${cls}"><span class="season-badge__dot"></span>${season.label} · ${status}</span>`;
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
 * Returns the thematic name for a given season id (e.g. "여름 특산품 경영"
 * for S3) or null if the season's theme is not registered. Callers should
 * fall back to the data's generic `name` field when this returns null.
 */
export function getSeasonThematicName(seasonId) {
    return THEME_NAMES[SEASON_THEMES[seasonId]] ?? null;
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
