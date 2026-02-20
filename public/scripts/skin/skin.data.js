/**
 * Skin Data Module
 * Handles loading of skin data and expression manifests, and provides search functionality.
 * Uses lazy loading: loads lightweight index on init, fetches full character data on demand.
 * @namespace SkinData
 */
import { fetchJSONWithCache, normalizeRomanNumerals, createSearchIndex } from '../utils.js';

/** @type {{skinIndex: Object, skinDataCache: Object<string, Array>, expressionManifest: Object, characterFuse: Fuse|null, allCharacterNames: string[]}} */
const state = {
    skinIndex: null,         // Lightweight index: character names, skin names, file hashes
    skinDataCache: {},       // Cached per-character full data: charName -> skin[]
    expressionManifest: {},
    characterFuse: null,
    allCharacterNames: []
};


async function init() {
    try {
        // Load lightweight index + expression manifest (127KB vs 19MB)
        const [skinIndex, manifest] = await Promise.all([
            fetchJSONWithCache('data/skin/skin_voiceline_index.json'),
            fetchJSONWithCache('data/skin/expression_manifest.json').catch(e => {
                console.warn('Expression manifest missing', e);
                return {};
            })
        ]);

        state.skinIndex = skinIndex;
        state.expressionManifest = manifest || {};

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

function getManifest() {
    return state.expressionManifest;
}

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
    getAllCharacterNames
};

export {
    init,
    searchCharacters,
    getSkinsForCharacter,
    getSkinByName,
    loadCharacterData,
    getManifest,
    getAllCharacterNames
};
