/**
 * skin.gid.js
 * Pure, browser-API-free helper: resolve a ship-group id to its skin character
 * name. Importable by both the browser and Node (node --test) — must never
 * reference window/document/fetch.
 *
 * WHY id, not name: ship names drift across data sources — upstream game-config
 * typos (base 아드미럴 히퍼 vs canonical 아드미랄 히퍼), transliteration variants
 * (아드미랄 / 아드미럴 / 어드미럴), and ASCII↔Unicode roman numerals (MKIII / MKⅢ).
 * Name-based cross-page linking therefore fuzzy-matches to the wrong same-prefix
 * entry (e.g. base Hipper → 아드미랄 히퍼·META, a DIFFERENT ship). A skin clientId
 * encodes shipGroup*10 + skinIndex, so floor(clientId/10) is the stable ship-group
 * id shared with ship_info — resolve by that and the spelling becomes irrelevant.
 */
import { normalizeRomanNumerals } from '../utils.js';

/**
 * Build a ship-group-id → character-name map from the skin index `characters`.
 * Every skin contributes floor(clientId/10) → its character key; the base skin
 * (smallest clientId) wins so the canonical name represents the ship.
 * @param {Object<string, {skins?: Array<{clientId:number}>}>} characters - skinIndex.characters
 * @returns {Map<number, string>} gid → normalized character name
 */
export function buildGidMap(characters) {
    const map = new Map();
    const bestClientId = new Map(); // gid → smallest clientId seen, to prefer the base skin
    for (const [rawName, entry] of Object.entries(characters || {})) {
        const name = normalizeRomanNumerals(rawName);
        if (!name || !entry || !Array.isArray(entry.skins)) continue;
        for (const skin of entry.skins) {
            const cid = Number(skin && skin.clientId);
            if (!Number.isFinite(cid)) continue;
            const gid = Math.floor(cid / 10);
            const prev = bestClientId.get(gid);
            if (prev === undefined || cid < prev) {
                bestClientId.set(gid, cid);
                map.set(gid, name);
            }
        }
    }
    return map;
}

/**
 * Resolve a ship-group id to its skin character name. Exact, no fuzzy.
 * @param {Map<number, string>} gidMap - from buildGidMap
 * @param {number|string|null|undefined} gid - ship-group id (URL params arrive as strings)
 * @returns {string} character name, or '' when unknown/malformed (caller falls back to name matching)
 */
export function resolveCharByGid(gidMap, gid) {
    if (!gidMap || gid === null || gid === undefined || gid === '') return '';
    const n = Number(gid);
    if (!Number.isFinite(n)) return '';
    return gidMap.get(n) || '';
}
