/**
 * skin.data.js
 * Shared data layer for the skin module group (list viewer, detail viewer, poll, etc.).
 * Loads a lightweight index on init (~127KB), then lazy-fetches full per-character
 * data on demand. Exposes both ES module exports and window.SkinData for legacy access.
 */
import { fetchJSONWithCache, normalizeRomanNumerals, createSearchIndex } from '../utils.js';

// @type {{skinIndex: Object, skinDataCache: Object<string, Array>, expressionManifest: Object, characterFuse: Fuse|null, allCharacterNames: string[], releaseDates: Object|null}}
const state = {
    skinIndex: null,         // Lightweight index: character names, skin names, file hashes
    skinDataCache: {},       // Cached per-character full data: charName -> skin[]
    expressionManifest: {},
    characterFuse: null,
    allCharacterNames: [],
    releaseDates: null       // skinId (string) -> date string
};


/**
 * Load the skin index, expression manifest, and release dates.
 * Builds the character name list and Fuse.js search index. Must be called before any lookup.
 */
async function init() {
    try {
        // Load lightweight index + expression manifest (127KB vs 19MB)
        const [skinIndex, manifest, releaseDates] = await Promise.all([
            fetchJSONWithCache('data/skin/skin_voiceline_index.json'),
            fetchJSONWithCache('data/skin/expression_manifest.json').catch(e => {
                console.warn('Expression manifest missing', e);
                return {};
            }),
            fetchJSONWithCache('data/skin/skin_release_dates.json').catch(e => {
                console.warn('Release dates missing', e);
                return {};
            })
        ]);

        state.skinIndex = skinIndex;
        state.expressionManifest = manifest || {};
        state.releaseDates = releaseDates || {};

        // Build search index from character names in the index file
        state.allCharacterNames = Object.keys(skinIndex.characters)
            .map(name => normalizeRomanNumerals(name))
            .filter(Boolean);
        state.allCharacterNames = [...new Set(state.allCharacterNames)]
            .sort(customSort);

        const fuseList = state.allCharacterNames.map(name => ({ name }));
        state.characterFuse = createSearchIndex(fuseList, { keys: ['name'], threshold: 0.4 });

        return true;
    } catch (e) {
        console.error('SkinData init failed', e);
        return false;
    }
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
    if (!state.characterFuse) return [];
    if (!query.trim()) {
        return state.characterFuse.getIndex().docs.map(doc => ({ item: doc, matches: [] }));
    }
    return state.characterFuse.search(query);
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
    const date = state.releaseDates[String(skinId)];
    if (!date) return null;
    if (date === '2021-08-14') return '2021-08-14 이전';
    return date;
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
            pool.push({
                charName,
                skinName: skin.name,
                rarity: skin.rarity || '',
                type: skin.type || '',
                tag: skin.tag || '',
                nation: skin.nation || ''
            });

            if (skin.rarity) rarities.add(skin.rarity);
            if (skin.type) types.add(skin.type);
            if (skin.tag) {
                skin.tag.split(',').map(t => t.trim()).filter(t => t && !/^\d+$/.test(t)).forEach(t => tagKeywords.add(t));
            }
            if (skin.nation) nations.add(skin.nation);
        });
    }

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
    return state.expressionManifest;
}

/** Return the sorted list of all character names from the index. */
function getAllCharacterNames() {
    return state.allCharacterNames;
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
    getReleaseDate,
    getSkinFilterData
};

export {
    init,
    searchCharacters,
    getSkinsForCharacter,
    getSkinByName,
    loadCharacterData,
    getManifest,
    getAllCharacterNames,
    getReleaseDate,
    getSkinFilterData
};
