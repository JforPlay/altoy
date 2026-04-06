/**
 * equip.data.js
 * Data loading and lookup helpers for the equipment viewer.
 * Part of the equip viewer module group (viewer + data + detail + compare + upgrade).
 * State is shared via a ref passed to setup() from equip.viewer.js.
 * Exports all data-layer functions used by detail, compare, and upgrade modules.
 */

import { fetchJSON, fetchJSONWithCache } from '../utils.js';

// State reference (set via setup)
let state;

/** Receive shared state from equip.viewer.js. */
export function setup(stateRef) {
    state = stateRef;
}

// ===== Data Loading =====

// Lite/full/statistics data — lite is blocking at init; full and statistics are background-cached

/** Load the lite equipment list (blocking at init). Populates state.equipData and state.filteredData. */
export async function loadLiteData() {
    state.equipData = await fetchJSON('data/equip/equip_data_lite.json');
    state.filteredData = [...state.equipData];
}

/** Load the full equipment detail JSON (cached 24h). Returns null on failure. */
export async function loadFullData() {
    try {
        state.fullEquipData = await fetchJSONWithCache('data/equip/equip_data_full.json', { maxAge: 86400000 });
        return state.fullEquipData;
    } catch (error) {
        console.warn('Failed to load full equipment data:', error);
    }
    return null;
}

/** Load anti-siren statistics keyed by level ID (cached 24h). Returns null on failure. */
export async function loadStatisticsData() {
    try {
        state.statisticsData = await fetchJSONWithCache('data/equip/equip_data_statistics.json', { maxAge: 86400000 });
        return state.statisticsData;
    } catch (error) {
        console.warn('Failed to load statistics data:', error);
    }
    return null;
}

// Mapping data — blocking at init (small files, needed for initial render)

export async function loadEquipTypeData() {
    state.equipTypeData = await fetchJSON('data/mapping/equip_data_by_type.json');
}

export async function loadNationalityData() {
    state.nationalityData = await fetchJSON('data/mapping/nationality_mapping.json');
}

export async function loadShipTypeData() {
    state.shipTypeData = await fetchJSON('data/mapping/ship_type_mapping.json');
}

export async function loadEquipCodeData() {
    state.equipCodeData = await fetchJSON('data/mapping/equip_data_code.json');
}

export async function loadWeaponPropertyData() {
    try {
        state.weaponPropertyData = await fetchJSONWithCache('data/sim/weapon_property.json', { maxAge: 86400000 });
        return state.weaponPropertyData;
    } catch (error) {
        console.warn('Failed to load weapon property data:', error);
    }
    return null;
}

export async function loadBulletTemplateData() {
    try {
        state.bulletTemplateData = await fetchJSONWithCache('data/sim/bullet_template.json', { maxAge: 86400000 });
        return state.bulletTemplateData;
    } catch (error) {
        console.warn('Failed to load bullet template data:', error);
    }
    return null;
}

export async function loadAircraftTemplateData() {
    try {
        state.aircraftTemplateData = await fetchJSONWithCache('data/sim/aircraft_template.json', { maxAge: 86400000 });
        return state.aircraftTemplateData;
    } catch (error) {
        console.warn('Failed to load aircraft template data:', error);
    }
    return null;
}

export async function loadSkillData() {
    try {
        state.skillData = await fetchJSONWithCache('data/sim/skill_data_template.json', { maxAge: 86400000 });
        return state.skillData;
    } catch (error) {
        console.warn('Failed to load skill data:', error);
    }
    return null;
}

let upgradeEquipIds = null;

/**
 * Load the upgrade tree template and build a Set of all equipment IDs that appear in any tree.
 * Used by the card grid to show a "in research tree" badge without loading full upgrade data.
 */
export async function loadUpgradeTemplateData() {
    try {
        const templates = await fetchJSONWithCache('data/equip/equip_upgrade_template.json', { maxAge: 86400000 });
        upgradeEquipIds = new Set();
        for (const tmpl of Object.values(templates)) {
            if (tmpl.equipments) {
                for (const [, , equipId] of tmpl.equipments) {
                    upgradeEquipIds.add(equipId);
                }
            }
        }
    } catch (error) {
        console.warn('Failed to load upgrade template data:', error);
    }
}

/** Check if equipment appears in any research tree */
export function isInUpgradeTree(equipId) {
    return upgradeEquipIds ? upgradeEquipIds.has(equipId) : false;
}

// ===== URL Helpers =====

const EQUIP_BASE_URL = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/equips';
const SP_WEAPON_BASE_URL = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/spweapon';

/** Get equipment icon URL from icon ID */
export function getEquipIconUrl(iconId) {
    if (!iconId || iconId === '1') return '';
    return `${EQUIP_BASE_URL}/${iconId}.webp`;
}

/** Get SP weapon icon URL */
export function getSPWeaponIconUrl(iconId) {
    if (!iconId) return '';
    return `${SP_WEAPON_BASE_URL}/${iconId}.webp`;
}

/** Get rarity background image URL (N=1, R=2, SR=3, SSR=4, UR=5) */
export function getRarityBgUrl(rarity) {
    return `https://raw.githubusercontent.com/JforPlay/data_for_toy/main/weaponframes/bg${rarity - 1}.webp`;
}

/** Get all unique equipment types from loaded data */
export function getUniqueTypes() {
    if (!state.equipData) return [];
    const types = new Map();
    for (const equip of state.equipData) {
        if (!types.has(equip.type)) {
            types.set(equip.type, {
                id: equip.type,
                name: equip.type_name || `타입 ${equip.type}`,
                name2: equip.type_name2 || '',
            });
        }
    }
    return [...types.values()].sort((a, b) => a.id - b.id);
}

/** Get all unique nationalities from loaded data */
export function getUniqueNationalities() {
    if (!state.equipData) return [];
    const nations = new Map();
    for (const equip of state.equipData) {
        if (equip.nationality && !nations.has(equip.nationality)) {
            nations.set(equip.nationality, {
                id: equip.nationality,
                name: equip.nation_name || `진영 ${equip.nationality}`,
                code: equip.nation_code || '',
            });
        }
    }
    return [...nations.values()].sort((a, b) => a.id - b.id);
}

/** Get all unique labels from loaded data */
export function getUniqueLabels() {
    if (!state.equipData) return [];
    const labelSet = new Set();
    for (const equip of state.equipData) {
        if (equip.label) {
            for (const l of equip.label) {
                labelSet.add(l);
            }
        }
    }
    return [...labelSet].sort();
}

/** Get full equipment data by ID, with async loading fallback */
export async function getFullEquipData(equipId) {
    if (!state.fullEquipData) {
        await state.fullEquipDataPromise;
    }
    if (!state.fullEquipData) return null;
    return state.fullEquipData[String(equipId)] || null;
}

/** Get statistics entry by level ID (returns null if not loaded or not found) */
export function getLevelStatistics(levelId) {
    if (!state.statisticsData) return null;
    return state.statisticsData[String(levelId)] || null;
}

/** Get weapon property by weapon ID */
export function getWeaponProperty(weaponId) {
    if (!state.weaponPropertyData) return null;
    return state.weaponPropertyData[String(weaponId)] || null;
}

/** Get bullet template by bullet ID */
export function getBulletTemplate(bulletId) {
    if (!state.bulletTemplateData) return null;
    return state.bulletTemplateData[String(bulletId)] || null;
}

/** Get aircraft template by aircraft ID */
export function getAircraftTemplate(aircraftId) {
    if (!state.aircraftTemplateData) return null;
    return state.aircraftTemplateData[String(aircraftId)] || null;
}

/** Load weapon name data (maps weapon_property IDs to Korean names) */
export async function loadWeaponNameData() {
    try {
        state.weaponNameData = await fetchJSONWithCache('data/equip/weapon_name.json', { maxAge: 86400000 });
        return state.weaponNameData;
    } catch (error) {
        console.warn('Failed to load weapon name data:', error);
    }
    return null;
}

/** Get weapon name by weapon ID (resolves base references) */
export function getWeaponName(weaponId) {
    if (!state.weaponNameData) return null;
    const entry = state.weaponNameData[String(weaponId)];
    if (!entry) return null;
    if (entry.name) return entry.name;
    if (entry.base) {
        const base = state.weaponNameData[String(entry.base)];
        return base ? base.name : null;
    }
    return null;
}

/** Get skill data by skill ID */
export function getSkillData(skillId) {
    if (!state.skillData) return null;
    return state.skillData[String(skillId)] || null;
}

// ===== SP Weapon Data =====

// SP weapons are a separate data source (spweapon_data.json) normalized to equip-lite format
// for unified grid rendering. Type IDs use 900+ offset to avoid collision with regular types.

/** SP weapon rarity is shifted: 2=R, 3=SR, 4=SSR */
const SP_RARITY_TO_EQUIP = { 2: 3, 3: 4, 4: 5 };
const SP_RARITY_NAMES = { 2: 'R', 3: 'SR', 4: 'SSR' };

/** SP weapon type → display name mapping */
const SP_TYPE_NAMES = {
    1: '듀얼 소드/해머', 2: '철검', 3: '크로스보우', 4: '대검', 5: '랜스/쿠나이',
    6: '지휘도/보건', 7: '헌팅 보우/셉터', 8: '단검/쿠나이', 9: '특수(순양)', 10: '특수(풍범)',
};

/** Attr key → Korean display name */
const SP_ATTR_NAMES = {
    cannon: '포격', torpedo: '뇌장', antiaircraft: '대공', air: '항공',
    reload: '장전', hit: '명중', dodge: '기동', durability: '내구',
    speed: '속력', luck: '행운', antisub: '대잠',
};

/** Load the SP weapon dataset (cached 24h). Returns null on failure. */
export async function loadSPWeaponData() {
    try {
        state.spWeaponData = await fetchJSONWithCache('data/sim/spweapon_data.json', { maxAge: 86400000 });
        return state.spWeaponData;
    } catch (error) {
        console.warn('Failed to load SP weapon data:', error);
    }
    return null;
}

/**
 * Normalize SP weapons to equip-lite format for unified grid rendering.
 * Uses type offset 900+ to avoid collision with regular equip types.
 * Only includes base entries (unique=0 for generic, unique>0 for dedicated).
 */
export function normalizeSPWeapons() {
    if (!state.spWeaponData || !state.spWeaponData.weapons) return [];

    const weapons = state.spWeaponData.weapons;
    const result = [];

    for (const [id, w] of Object.entries(weapons)) {
        const mappedRarity = SP_RARITY_TO_EQUIP[w.rarity] || w.rarity;
        const maxLevel = w.levels ? w.levels[w.levels.length - 1] : null;
        const maxAttrs = [];
        if (maxLevel) {
            if (w.attr_1 && maxLevel.v1) maxAttrs.push({ name: SP_ATTR_NAMES[w.attr_1] || w.attr_1, value: maxLevel.v1 });
            if (w.attr_2 && maxLevel.v2) maxAttrs.push({ name: SP_ATTR_NAMES[w.attr_2] || w.attr_2, value: maxLevel.v2 });
        }

        const typeName = SP_TYPE_NAMES[w.type] || `SP타입${w.type}`;
        const uniqueLabel = w.unique ? ' (전용)' : '';

        result.push({
            id: `sp_${id}`,
            _spId: id,
            _isSPWeapon: true,
            name: w.name + uniqueLabel,
            icon: w.icon,
            type: 900 + w.type,
            type_name: '특수 장비',
            type_name2: `특수 장비 — ${typeName}`,
            rarity: mappedRarity,
            rarity_name: SP_RARITY_NAMES[w.rarity] || '',
            nationality: 0,
            nation_name: '',
            nation_code: '',
            level_count: w.levels ? w.levels.length : 1,
            max_attrs: maxAttrs,
            label: [],
            unique: w.unique || 0,
        });
    }

    return result;
}

/** Get raw SP weapon data by original ID */
export function getSPWeaponRawData(spId) {
    if (!state.spWeaponData || !state.spWeaponData.weapons) return null;
    return state.spWeaponData.weapons[String(spId)] || null;
}

/** Replace <[CODE]> patterns in text using equip_data_code.json mapping */
export function replaceEquipCodes(text) {
    if (!text || !state.equipCodeData) return text || '';
    return String(text).replace(/<\[([A-Z]+)\]>/g, (match, code) => {
        const entry = state.equipCodeData[code];
        return entry ? entry.text : match;
    });
}
