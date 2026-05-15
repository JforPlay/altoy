/**
 * skin.dates.js
 * Pure, browser-API-free helpers for skin release dates. Importable by both the
 * browser and Node (node --test) — must never reference window/document/fetch.
 *
 * Raw release-date value encoding (string):
 *   exact  "YYYY-MM-DD"             e.g. "2020-05-14"
 *   floor  "<YYYY-MM-DD"            e.g. "<2019-01-30"  (released on or before)
 *   range  "YYYY-MM-DD/YYYY-MM-DD"  e.g. "2019-11-01/2020-02-10"
 * The live lua-derived file additionally uses the bare date "2021-08-14" as a
 * floor sentinel (skins predating the AzurLaneLuaScripts commit history).
 */

// Floor sentinel emitted by the lua-derived skin_release_dates.json.
const LUA_FLOOR_SENTINEL = '2021-08-14';

/**
 * Format a raw release-date value into a Korean display string.
 * @param {string|null|undefined} value - raw encoded value
 * @returns {string|null} display string, or null when missing/undatable
 */
export function formatReleaseDate(value) {
    if (!value) return null;
    if (value === LUA_FLOOR_SENTINEL) return `${LUA_FLOOR_SENTINEL} 이전`;
    if (value.startsWith('<')) return `${value.slice(1)} 이전`;
    if (value.includes('/')) {
        const [from, to] = value.split('/');
        return `${from.slice(0, 7)} ~ ${to.slice(0, 7)}`; // truncate to YYYY-MM
    }
    return value;
}

/**
 * Reduce a raw release-date value to a plain YYYY-MM-DD sort key.
 * Floor → its bound date; range → its lower bound; missing → "".
 * @param {string|null|undefined} value - raw encoded value
 * @returns {string} sortable date string
 */
export function releaseSortKey(value) {
    if (!value) return '';
    if (value === LUA_FLOOR_SENTINEL) return LUA_FLOOR_SENTINEL;
    if (value.startsWith('<')) return value.slice(1);
    if (value.includes('/')) return value.split('/')[0];
    return value;
}

/**
 * Merge the live lua-derived map with the static legacy backfill.
 * The legacy value is used ONLY where the lua map shows the floor sentinel and
 * the legacy map has an entry; otherwise the lua value wins (the maintained
 * source is authoritative for every skin it actually dates). The `_meta` key
 * is dropped from the result.
 * @param {Object<string,*>} luaMap - parsed skin_release_dates.json
 * @param {Object<string,string>|null} legacyMap - parsed skin_release_dates_legacy.json
 * @returns {Object<string,string>} merged raw-value map (skinId → value)
 */
export function mergeReleaseDates(luaMap, legacyMap) {
    const merged = {};
    const legacy = legacyMap || {};
    for (const [id, value] of Object.entries(luaMap || {})) {
        if (id === '_meta') continue;
        merged[id] = (value === LUA_FLOOR_SENTINEL && legacy[id]) ? legacy[id] : value;
    }
    return merged;
}
