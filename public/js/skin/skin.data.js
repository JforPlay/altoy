/**
 * skin.data.js
 * Shared data layer for the skin module group (list viewer, detail viewer, poll, etc.).
 * Loads a lightweight index and release dates on init, then lazy-fetches full
 * per-character data and expression metadata on demand. Exposes both ES module
 * exports and window.SkinData for legacy access.
 */
import { fetchJSONWithCache, normalizeRomanNumerals, createSearchIndex, ensureFuse } from '../utils.js';
import { mergeReleaseDates, formatReleaseDate } from './skin.dates.js';
import { buildGidMap, resolveCharByGid } from './skin.gid.js';

// @type {{skinIndex: Object, skinDataCache: Object<string, Array>, expressionManifest: Object|null, characterFuse: Fuse|null, allCharacterNames: string[], gidMap: Map<number,string>|null, releaseDates: Object|null}}
const state = {
    skinIndex: null,         // Lightweight index: character names, skin names, file hashes
    skinDataCache: {},       // Cached per-character full data: charName -> skin[]
    expressionManifest: null,
    characterFuse: null,
    allCharacterNames: [],
    gidMap: null,            // ship-group id -> character name (stable cross-page link key)
    releaseDates: null       // skinId (string) -> date string
};

let expressionManifestPromise = null;
let expressionManifestForceRefresh = false;


/**
 * Load skin release dates: fetch the live lua-derived map and the static legacy
 * backfill, return them merged. Either fetch failing degrades gracefully.
 * @returns {Promise<Object<string,string>>} merged skinId → raw-value map
 */
async function loadReleaseDates() {
    const [luaMap, legacyMap] = await Promise.all([
        fetchJSONWithCache('data/skin/skin_release_dates.json').catch(e => {
            console.warn('Release dates missing', e);
            return {};
        }),
        fetchJSONWithCache('data/skin/skin_release_dates_legacy.json').catch(e => {
            console.warn('Legacy release dates missing', e);
            return {};
        })
    ]);
    try {
        return mergeReleaseDates(luaMap, legacyMap);
    } catch (e) {
        console.warn('Release date merge failed', e);
        return {};
    }
}

/**
 * Load the skin index and release dates.
 * Builds the character name list and Fuse.js search index. Must be called before any lookup.
 */
async function init() {
    try {
        const [skinIndex, releaseDates] = await Promise.all([
            fetchJSONWithCache('data/skin/skin_voiceline_index.json'),
            loadReleaseDates()
        ]);

        state.skinIndex = skinIndex;
        state.releaseDates = releaseDates || {};

        // Build search index from character names in the index file
        state.allCharacterNames = Object.keys(skinIndex.characters)
            .map(name => normalizeRomanNumerals(name))
            .filter(Boolean);
        state.allCharacterNames = [...new Set(state.allCharacterNames)]
            .sort(customSort);

        // Stable ship-group id → character name, so cross-page links resolve by id
        // (immune to name spelling drift across data sources) before any name match.
        state.gidMap = buildGidMap(skinIndex.characters);

        const fuseList = state.allCharacterNames.map(name => ({ name }));
        await ensureFuse();
        state.characterFuse = createSearchIndex(fuseList, { keys: ['name'], threshold: 0.4 });

        return true;
    } catch (e) {
        console.error('SkinData init failed', e);
        return false;
    }
}

/**
 * Load expression metadata on the first selected skin rather than page boot.
 * Concurrent detail renders share one request, a successful result is reused,
 * and failures stay non-fatal while leaving the next activation able to retry.
 *
 * @returns {Promise<Object|null>} expression manifest, or null when unavailable
 */
function ensureExpressionManifest() {
    if (state.expressionManifest) {
        return Promise.resolve(state.expressionManifest);
    }

    if (!expressionManifestPromise) {
        expressionManifestPromise = fetchJSONWithCache(
            'data/skin/expression_manifest.json',
            { forceRefresh: expressionManifestForceRefresh }
        )
            .then(manifest => {
                if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
                    || Object.keys(manifest).length === 0) {
                    throw new TypeError('Expression manifest must be a non-empty object');
                }

                state.expressionManifest = manifest;
                expressionManifestForceRefresh = false;
                return manifest;
            })
            .catch(error => {
                console.warn('Expression manifest missing', error);
                expressionManifestPromise = null;
                expressionManifestForceRefresh = true;
                return null;
            });
    }

    return expressionManifestPromise;
}

/**
 * Lazy-load full skin data for a specific character
 * @param {string} charName - Character name
 * @returns {Promise<Array>} - Array of skin objects for this character
 */
async function loadCharacterData(charName) {
    // Check cache first
    const normalized = normalizeRomanNumerals(charName);
    if (state.skinDataCache[normalized]) {
        return state.skinDataCache[normalized];
    }

    // Find the character in the index (try both normalized and original)
    let indexEntry = null;
    for (const [name, entry] of Object.entries(state.skinIndex.characters)) {
        if (normalizeRomanNumerals(name) === normalized) {
            indexEntry = entry;
            break;
        }
    }

    if (!indexEntry) return [];

    // Fetch the character's full data
    const charData = await fetchJSONWithCache(`data/skin/skin_characters/${indexEntry.hash}.json`);
    state.skinDataCache[normalized] = charData;
    return charData;
}

// Sort helpers: Korean first, then Latin, then numeric, then other
function getCategory(str) {
    if (!str) return 4;
    if (/^[가-힣]/.test(str)) return 1;
    if (/^[a-zA-Z]/.test(str)) return 2;
    if (/^[0-9]/.test(str)) return 3;
    return 4;
}

function customSort(a, b) {
    const catA = getCategory(a);
    const catB = getCategory(b);
    if (catA !== catB) return catA - catB;
    return a.localeCompare(b, 'ko');
}

/**
 * Fuzzy-search character names using the Fuse.js index.
 * Returns all characters (as Fuse result objects) when query is empty.
 */
function searchCharacters(query) {
    const normalizedQuery = normalizeRomanNumerals(query || '').trim();
    const lowerQuery = normalizedQuery.toLowerCase();

    if (!state.characterFuse) {
        const names = lowerQuery
            ? state.allCharacterNames.filter(name => name.toLowerCase().includes(lowerQuery))
            : state.allCharacterNames;
        return names.map(name => ({ item: { name }, matches: [], score: lowerQuery ? 0.2 : 0 }));
    }

    if (!normalizedQuery) {
        return state.characterFuse.getIndex().docs.map(doc => ({ item: doc, matches: [] }));
    }
    // Pass the normalized query so Fuse matches against the pre-normalized index
    // (allCharacterNames is normalized at init).
    return state.characterFuse.search(normalizedQuery);
}


/**
 * Get skin names for a character. Returns from index (no fetch needed).
 * @param {string} charName - Character name
 * @returns {string[]} - Array of skin display names
 */
function getSkinsForCharacter(charName) {
    const normalized = normalizeRomanNumerals(charName);
    if (!state.skinIndex) return [];

    // Look up in index (fast, no network)
    for (const [name, entry] of Object.entries(state.skinIndex.characters)) {
        if (normalizeRomanNumerals(name) === normalized) {
            return entry.skins.map(s => s.name);
        }
    }
    return [];
}

/**
 * Get full skin data by skin name. Lazy-loads character data if needed.
 * @param {string} skinName - Full skin display name
 * @returns {Promise<Object|null>} - Full skin object or null
 */
async function getSkinByName(skinName) {
    // First check cache
    for (const charData of Object.values(state.skinDataCache)) {
        const found = charData.find(row => row['한글 함순이 + 스킨 이름'] === skinName);
        if (found) return found;
    }

    // Find character for this skin from index
    if (state.skinIndex) {
        for (const [charName, entry] of Object.entries(state.skinIndex.characters)) {
            const skinEntry = entry.skins.find(s => s.name === skinName);
            if (skinEntry) {
                const charData = await loadCharacterData(charName);
                return charData.find(row => row['한글 함순이 + 스킨 이름'] === skinName) || null;
            }
        }
    }

    return null;
}

/**
 * Get formatted release date for a skin by ID
 * @param {number|string} skinId - Skin ID
 * @returns {string|null} - Formatted date string or null
 */
function getReleaseDate(skinId) {
    if (!state.releaseDates) return null;
    return formatReleaseDate(state.releaseDates[String(skinId)]);
}

/**
 * Get all skins from the index with filter fields, plus unique filter option values.
 * Used by the random skin feature.
 * @returns {{ pool: Array, filters: { rarities: string[], types: string[], tags: string[], nations: string[] } }}
 */
function getSkinFilterData() {
    if (!state.skinIndex) return { pool: [], filters: { rarities: [], types: [], tags: [], nations: [] } };

    const pool = [];
    const rarities = new Set();
    const types = new Set();
    const tagKeywords = new Set();
    const nations = new Set();

    for (const [charName, entry] of Object.entries(state.skinIndex.characters)) {
        entry.skins.forEach(skin => {
            const tagList = skin.tag
                ? skin.tag.split(',').map(t => t.trim()).filter(t => t && t !== 'X' && !/^\d+$/.test(t))
                : [];

            pool.push({
                charName,
                skinName: skin.name,
                rarity: skin.rarity || '',
                type: skin.type || '',
                tag: skin.tag || '',
                tagList,
                nation: skin.nation || ''
            });

            if (skin.rarity) rarities.add(skin.rarity);
            if (skin.type) types.add(skin.type);
            tagList.forEach(t => tagKeywords.add(t));
            if (skin.nation) nations.add(skin.nation);
        });
    }

    // Ascending (common→rare); not utils.RARITY_TIERS_DESC.
    const rarityOrder = ['N', 'R', 'SR', 'SSR', 'UR'];
    return {
        pool,
        filters: {
            rarities: [...rarities].sort((a, b) => rarityOrder.indexOf(a) - rarityOrder.indexOf(b)),
            types: [...types].sort((a, b) => a.localeCompare(b, 'ko')),
            tags: [...tagKeywords].sort((a, b) => a.localeCompare(b, 'ko')),
            nations: [...nations].sort()
        }
    };
}

/** Return the expression manifest (skinId → face layout data). */
function getManifest() {
    return state.expressionManifest || {};
}

/** Return the sorted list of all character names from the index. */
function getAllCharacterNames() {
    return state.allCharacterNames;
}

/**
 * Resolve a ship-group id (ship_info `gid`) to its skin character name.
 * Exact, id-based — returns '' when unknown so callers can fall back to name matching.
 * @param {number|string} gid
 * @returns {string}
 */
function getCharacterNameByGid(gid) {
    return resolveCharByGid(state.gidMap, gid);
}

// Backwards-compatible global access
window.SkinData = {
    init,
    searchCharacters,
    getSkinsForCharacter,
    getSkinByName,
    loadCharacterData,
    getManifest,
    getAllCharacterNames,
    getCharacterNameByGid,
    getReleaseDate,
    getSkinFilterData
};

export {
    init,
    searchCharacters,
    getSkinsForCharacter,
    getSkinByName,
    loadCharacterData,
    ensureExpressionManifest,
    getManifest,
    getAllCharacterNames,
    getCharacterNameByGid,
    getReleaseDate,
    loadReleaseDates,
    getSkinFilterData
};
