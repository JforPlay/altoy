'use strict';

/**
 * shipgirl-stats.data.js
 * Data loading and stat computation for the shipgirl stats page.
 * Loads ship_info_data, skin subset, skin release dates, and mapping tables.
 * Computes per-ship Lv.120 combat stats (max LB, 사랑 affinity) and aggregates
 * skin metadata (counts, gem costs, tag counts, release dates) for each shipgirl.
 */

import { fetchJSON, fetchJSONWithCache, normalizeRomanNumerals } from '../utils.js';

// ===== Constants =====

/** Affinity bonus at 사랑 (100 Favorability) */
export const FAVORABILITY_BONUS = 1.06;

/** Level used for all stat calculations */
export const LEVEL = 120;

/** Stats NOT affected by the affinity bonus */
export const UNAFFECTED_STATS = new Set(['speed', 'luck']);

export const PRIMARY_STATS   = ['health', 'firepower', 'torpedo', 'antiair', 'aviation', 'reload', 'accuracy', 'evasion'];
export const SECONDARY_STATS = ['speed', 'luck', 'asw'];
export const ALL_STATS       = [...PRIMARY_STATS, ...SECONDARY_STATS];

/** Special skin tag keys used for aggregation */
export const SKIN_TAG_KEYS = ['L2D+', 'L2D', '듀얼', '쁘띠모션'];

// ===== State Reference (set via setup) =====

let state;

export function setup(stateRef) {
    state = stateRef;
}

// ===== Data Loading =====

/**
 * Load all required data sources in parallel, then compute aggregations.
 */
export async function loadAllData() {
    const [
        shipInfoData,
        skinSubsetData,
        skinReleaseDates,
        nationalityData,
        shipTypeData,
        attrTypeData,
    ] = await Promise.all([
        fetchJSONWithCache('data/ship_info_data.json'),
        fetchJSON('data/skin/skin_voiceline_data_subset.json'),
        fetchJSON('data/skin/skin_release_dates.json'),
        fetchJSON('data/mapping/nationality_mapping.json'),
        fetchJSON('data/mapping/ship_type_mapping.json'),
        fetchJSON('data/mapping/attr_type_mapping.json'),
    ]);

    state.shipInfoData      = shipInfoData;
    state.skinSubsetData    = skinSubsetData;
    state.skinReleaseDates  = skinReleaseDates;
    state.nationalityData   = nationalityData;
    state.shipTypeData      = shipTypeData;
    state.attrTypeData      = attrTypeData;

    computeAll();
}

// ===== Stat Calculation =====

/**
 * Compute Lv.120 stats for a single ship at max limit break with affinity bonus.
 * Formula: floor((base + growth * (120 - 1) / 1000 + enhance) * bonus)
 *
 * @param {Object} ship - Entry from ship_info_data
 * @returns {Object} Computed stat values keyed by stat name
 */
function computeShipStats(ship) {
    const baseKeys = Object.keys(ship.base);
    const maxLBKey = baseKeys[baseKeys.length - 1];

    const base   = ship.base[maxLBKey]   || {};
    const growth = ship.growth[maxLBKey] || {};
    const enhance = ship.enhance          || {};

    const result = {};
    for (const stat of ALL_STATS) {
        const baseVal    = base[stat]    || 0;
        const growthVal  = growth[stat]  || 0;
        const enhanceVal = enhance[stat] || 0;
        const bonus      = UNAFFECTED_STATS.has(stat) ? 1.0 : FAVORABILITY_BONUS;

        result[stat] = Math.floor((baseVal + growthVal * (LEVEL - 1) / 1000 + enhanceVal) * bonus);
    }
    return result;
}

// ===== Skin Aggregation =====

/**
 * Parse a skin's tag string into an array of trimmed token strings.
 * e.g. "L2D, 배경" → ["L2D", "배경"]
 *
 * @param {string|null} tagStr
 * @returns {string[]}
 */
function parseSkinTags(tagStr) {
    if (!tagStr || tagStr === 'X') return [];
    return tagStr.split(',').map(t => t.trim()).filter(Boolean);
}

/**
 * Classify a skin into its gimmick label(s). A skin can carry several
 * (e.g. 듀얼 + L2D). Returns '일반' when it has no special gimmick.
 *
 * @param {Object} skin - a skin entry from skin_voiceline_data_subset
 * @returns {Set<string>}
 */
export function classifyGimmick(skin) {
    const tags = parseSkinTags(skin['스킨 태그']);
    const result = new Set();
    if (tags.includes('L2D+'))      result.add('L2D+');
    else if (tags.includes('L2D'))  result.add('L2D');
    if (tags.includes('듀얼'))      result.add('듀얼');
    if (tags.includes('쁘띠모션')) result.add('쁘띠모션');
    if (result.size === 0)          result.add('일반');
    return result;
}

/**
 * Compute skin aggregation data for a single shipgirl by name.
 *
 * @param {string} shipName - Normalized ship name
 * @returns {Object} Skin aggregation object
 */
function computeSkinStats(shipName, predicate) {
    const normalizedName = normalizeRomanNumerals(shipName);
    const skins = state.skinByShip.get(normalizedName) || [];

    let total        = 0;
    let l2dPlus      = 0;
    let l2d          = 0;
    let dual         = 0;
    let petitMotion  = 0;
    let totalGems    = 0;
    let latestDate   = null;
    let firstNonDefaultDate = null;
    const skinTypes  = {};

    for (const skin of skins) {
        if (predicate && !predicate(skin)) continue;
        total++;

        // Tag counting — check L2D+ BEFORE L2D since L2D+ contains "L2D" as a substring
        const tags = parseSkinTags(skin['스킨 태그']);
        if (tags.includes('L2D+'))      l2dPlus++;
        else if (tags.includes('L2D'))  l2d++;
        if (tags.includes('듀얼'))      dual++;
        if (tags.includes('쁘띠모션')) petitMotion++;

        // Gem cost aggregation
        const gems = skin['재화'];
        if (gems != null) totalGems += gems;

        // Release date tracking
        const skinId   = String(skin['클뜯 id']);
        const dateStr  = state.skinReleaseDates[skinId];
        if (dateStr) {
            if (!latestDate || dateStr > latestDate) latestDate = dateStr;

            const skinType = skin['스킨 타입 - 한글'];
            const isDefaultOrRemodel = skinType === '기본' || skinType === '개조' || skinType === null;
            if (!isDefaultOrRemodel) {
                if (!firstNonDefaultDate || dateStr < firstNonDefaultDate) {
                    firstNonDefaultDate = dateStr;
                }
            }
        }

        // Skin type count
        const typeLabel = skin['스킨 타입 - 한글'] || '기본';
        skinTypes[typeLabel] = (skinTypes[typeLabel] || 0) + 1;
    }

    // Days since last skin release
    let daysSinceLast = null;
    if (latestDate) {
        const today     = new Date();
        const latest    = new Date(latestDate);
        const diffMs    = today - latest;
        daysSinceLast   = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    }

    return {
        total,
        'L2D+':      l2dPlus,
        'L2D':       l2d,
        '듀얼':      dual,
        '쁘띠모션':  petitMotion,
        totalGems,
        latestDate,
        firstNonDefaultDate,
        daysSinceLast,
        skinTypes,
    };
}

// ===== Name Alias Map =====

/** Known name mismatches between skin_voiceline_data_subset and ship_info_data */
const SKIN_NAME_ALIASES = new Map([
    ['라이온급 전함 - 라이온', '라이온'],
    ['아드미럴 히퍼', '아드미랄 히퍼'],
    ['아드미랄 나히모프', '어드미럴 나히모프'],
    ['키즈나 아이·Elegant', '키즈나 아이 - 엘레강트'],
    ['키즈나 아이·Anniversary', '키즈나 아이 - 애니버서리'],
    ['키즈나 아이·SuperGamer', '키즈나 아이 - 슈퍼 게이머'],
]);

/**
 * Normalize a skin's ship name: apply alias first, then Roman numeral normalization.
 * @param {string} rawName - The 함순이 이름 field from skin data
 * @returns {string}
 */
function normalizeSkinName(rawName) {
    const aliased = SKIN_NAME_ALIASES.get(rawName);
    return normalizeRomanNumerals(aliased || rawName);
}

// ===== Main Compute Pass =====

/**
 * Build all derived state:
 *   state.skinByShip      Map<normalizedName, skin[]>
 *   state.shipStats       Array<{ ship, combat, skin }>
 *   state.shipStatsByName Map<name, entry>
 */
function computeAll() {
    // 1. Build skin lookup map keyed by normalized ship name
    state.skinByShip = new Map();
    for (const skin of state.skinSubsetData) {
        const rawName = skin['함순이 이름'];
        if (!rawName) continue;
        const key = normalizeSkinName(rawName);
        if (!state.skinByShip.has(key)) state.skinByShip.set(key, []);
        state.skinByShip.get(key).push(skin);
    }

    // 2. Build shipStats array. skinFull is the unfiltered aggregate (never
    //    mutated); skin is the current view, swapped by recomputeSkinStats.
    state.shipStats = [];
    for (const ship of state.shipInfoData) {
        if (!ship.name || !ship.rarity) continue;

        const skinFull = computeSkinStats(ship.name);
        const entry = {
            ship,
            combat:   computeShipStats(ship),
            skin:     skinFull,
            skinFull,
        };
        state.shipStats.push(entry);
    }

    // 3. Build name → entry map
    state.shipStatsByName = new Map();
    for (const entry of state.shipStats) {
        state.shipStatsByName.set(entry.ship.name, entry);
    }

    // 4. Build id → entry map
    state.shipStatsById = new Map();
    for (const entry of state.shipStats) {
        if (entry.ship.id != null) {
            state.shipStatsById.set(String(entry.ship.id), entry);
        }
    }
}

// ===== Helper Lookup Functions =====

/**
 * Get the display name for a nationality ID.
 * @param {number|string} id
 * @returns {string}
 */
export function getNationalityName(id) {
    const entry = state.nationalityData[String(id)];
    return entry ? entry.name : String(id);
}

/**
 * Get the faction code (e.g. "USS", "HMS") for a nationality ID.
 * @param {number|string} id
 * @returns {string}
 */
export function getNationalityCode(id) {
    const entry = state.nationalityData[String(id)];
    return entry ? entry.code : String(id);
}

/**
 * Get the flag image URL for a nationality ID.
 * @param {number|string} id
 * @returns {string|null}
 */
export function getNationalityImage(id) {
    const entry = state.nationalityData[String(id)];
    return entry ? entry.image : null;
}

/**
 * Get the Korean display name for a ship type.
 * @param {number|string} type
 * @returns {string}
 */
export function getShipTypeName(type) {
    const entry = state.shipTypeData[String(type)];
    return entry ? entry.type_name : String(type);
}

/**
 * Get the icon URL for a ship type.
 * @param {number|string} type
 * @returns {string|null}
 */
export function getShipTypeIcon(type) {
    const entry = state.shipTypeData[String(type)];
    return entry ? entry.icon : null;
}

/**
 * Get the Korean display name for a stat attribute.
 * Matches by `name` or `name2` field in attr_type_mapping.
 * @param {string} statName - e.g. "health", "firepower"
 * @returns {string}
 */
export function getAttrKoreanName(statName) {
    if (!statName) return '';
    const lower = statName.toLowerCase();
    const attr = Object.values(state.attrTypeData).find(
        a => a.name === lower || a.name2 === lower
    );
    return attr ? attr.condition : statName;
}

/**
 * Get the icon URL for a stat attribute.
 * Matches by `name` or `name2` field in attr_type_mapping.
 * @param {string} statName - e.g. "health", "firepower"
 * @returns {string|null}
 */
export function getAttrIcon(statName) {
    if (!statName) return null;
    const lower = statName.toLowerCase();
    const attr = Object.values(state.attrTypeData).find(
        a => a.name === lower || a.name2 === lower
    );
    return attr ? attr.icon : null;
}

/**
 * Get the icon URL for a ship (derived from shipyard URL).
 * @param {Object} ship - Ship object with shipyard field
 * @returns {string}
 */
export function getShipIconUrl(ship) {
    return ship?.shipyard ? ship.shipyard.replace('shipyard.png', 'icon.png') : '';
}

/**
 * Distinct non-null skin types (스킨 타입 - 한글) across all skins, ko-sorted.
 * @returns {string[]}
 */
export function getSkinTypeList() {
    const set = new Set();
    for (const skin of state.skinSubsetData) {
        const t = skin['스킨 타입 - 한글'];
        if (t) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
}

/**
 * Re-point every entry.skin at either a freshly filtered aggregate (when a
 * predicate is given) or the cached unfiltered aggregate (when predicate is null).
 *
 * @param {?Function} predicate - predicate(skin) → boolean, or null for "all skins"
 */
export function recomputeSkinStats(predicate) {
    for (const entry of state.shipStats) {
        entry.skin = predicate
            ? computeSkinStats(entry.ship.name, predicate)
            : entry.skinFull;
    }
}

