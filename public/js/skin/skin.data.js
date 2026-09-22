/**
 * skin.data.js
 * Shared data layer for the skin module group (list viewer, detail viewer, poll, etc.).
 * Loads a lightweight index and release dates on init, then lazy-fetches full
 * per-character data on demand (expression metadata comes from the shared
 * ../expression-manifest.js loader).
 */
import { fetchJSONWithCache, normalizeRomanNumerals, createSearchIndex, ensureFuse } from '../utils.js';
import { mergeReleaseDates, formatReleaseDate } from './skin.dates.js';
import { buildGidMap, resolveCharByGid } from './skin.gid.js';

const state = {
    skinIndex: null,         // Lightweight index: character names, skin names, file hashes
    // Roman-normalized character name -> { name (as the index spells it), entry }.
    // The index keys are RAW while every lookup here arrives normalized, so without
    // this the three resolvers below each walked all ~900 entries calling
    // normalizeRomanNumerals per entry — and getSkinsForCharacter runs on every pick.
    charByName: null,
    charBySkin: null,        // skin display name -> owning character name (names are index-unique)
    skinDataCache: {},       // Cached per-character full data: charName -> skin[]
    characterFuse: null,
    allCharacterNames: [],
    gidMap: null,            // ship-group id -> character name (stable cross-page link key)
    releaseDates: null,      // skinId (string) -> date string; null until ensureReleaseDates resolves
    releaseDatesPromise: null,
    filterData: null         // memoized getSkinFilterData() result
};

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
 * Start (or reuse) the release-date load and park it on `state`.
 *
 * Deliberately NOT part of `init()`: the two files are 15.5 KB gz — about 12% of
 * the detail viewer's boot payload — and the only reader is the skin caption, which
 * cannot run until a skin is on the stage. The caller folds this into the fetch it
 * already awaits per skin, so the deferral costs no visible latency.
 * @returns {Promise<Object<string,string>>}
 */
function ensureReleaseDates() {
    if (!state.releaseDatesPromise) {
        state.releaseDatesPromise = loadReleaseDates().then((dates) => {
            state.releaseDates = dates || {};
            return state.releaseDates;
        });
    }
    return state.releaseDatesPromise;
}

/**
 * Load the skin index.
 * Builds the character name list and Fuse.js search index. Must be called before any lookup.
 * Release dates load separately — see `ensureReleaseDates`.
 */
async function init() {
    try {
        const skinIndex = await fetchJSONWithCache('data/skin/skin_voiceline_index.json');

        state.skinIndex = skinIndex;

        // One normalized lookup for every resolver in this module. First writer wins,
        // matching the linear scans this replaced (they broke on their first hit), so
        // a duplicate name resolves exactly where it used to.
        state.charByName = new Map();
        state.charBySkin = new Map();
        for (const [name, entry] of Object.entries(skinIndex.characters)) {
            const key = normalizeRomanNumerals(name);
            if (!state.charByName.has(key)) state.charByName.set(key, { name, entry });
            for (const skin of entry.skins || []) {
                if (!state.charBySkin.has(skin.name)) state.charBySkin.set(skin.name, name);
            }
        }

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

    const indexEntry = state.charByName?.get(normalized)?.entry;
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
    const hit = state.charByName?.get(normalizeRomanNumerals(charName));
    return hit ? hit.entry.skins.map(s => s.name) : [];
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
    const charName = state.charBySkin?.get(skinName);
    if (!charName) return null;
    const charData = await loadCharacterData(charName);
    return charData.find(row => row['한글 함순이 + 스킨 이름'] === skinName) || null;
}

/**
 * Get formatted release date for a skin by ID.
 * Returns null until `ensureReleaseDates()` has resolved — await that first if the
 * caller renders the date once and never repaints.
 * @param {number|string} skinId - Skin ID
 * @returns {string|null} - Formatted date string or null
 */
function getReleaseDate(skinId) {
    if (!state.releaseDates) return null;
    return formatReleaseDate(state.releaseDates[String(skinId)]);
}

/**
 * Get all skins from the index with filter fields, plus unique filter option values.
 *
 * Memoized: building the ~2,400-row pool costs a split + regex filter per row, and
 * two callers want it (the 찾아보기 modal, and the detail viewer's 기믹 badges). The
 * empty pre-init result is NOT cached, so a caller that runs before `init()` still
 * gets the real thing afterwards.
 *
 * Callers SHARE the returned rows. skin.detail.search.js stamps `search`/`shipType`
 * onto them, which is fine — the other consumer reads only the index-derived fields —
 * but a future caller must not overwrite one of those.
 * @returns {{ pool: Array, filters: { rarities: string[], types: string[], tags: string[], nations: string[] } }}
 */
function getSkinFilterData() {
    if (!state.skinIndex) return { pool: [], filters: { rarities: [], types: [], tags: [], nations: [] } };
    if (state.filterData) return state.filterData;

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
                // Carried, not re-derived: the portrait URL and the 함종 join both
                // need it, and the search modal used to re-fetch and re-parse the
                // whole 317 KB index just to rebuild a name → clientId map.
                clientId: skin.clientId ?? null,
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
    state.filterData = {
        pool,
        filters: {
            rarities: [...rarities].sort((a, b) => rarityOrder.indexOf(a) - rarityOrder.indexOf(b)),
            types: [...types].sort((a, b) => a.localeCompare(b, 'ko')),
            tags: [...tagKeywords].sort((a, b) => a.localeCompare(b, 'ko')),
            nations: [...nations].sort()
        }
    };
    return state.filterData;
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

export {
    init,
    searchCharacters,
    getSkinsForCharacter,
    getSkinByName,
    loadCharacterData,
    getAllCharacterNames,
    getCharacterNameByGid,
    getReleaseDate,
    ensureReleaseDates,
    loadReleaseDates,
    getSkinFilterData
};
