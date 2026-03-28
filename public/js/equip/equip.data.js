/**
 * Equipment Viewer Module - Data Loading & Utilities
 * Handles data loading and helper functions for equipment data
 */

import { fetchJSON, fetchJSONWithCache, DATA_VERSION } from '../utils.js';

// State reference (set via setup)
let state;

export function setup(stateRef) {
    state = stateRef;
}

// ===== Data Loading =====

export async function loadLiteData() {
    state.equipData = await fetchJSON('data/equip/equip_data_lite.json');
    state.filteredData = [...state.equipData];
}

export async function loadFullData() {
    try {
        state.fullEquipData = await fetchJSONWithCache(`data/equip/equip_data_full.json?v=${DATA_VERSION}`, { maxAge: 86400000 });
        return state.fullEquipData;
    } catch (error) {
        console.warn('Failed to load full equipment data:', error);
    }
    return null;
}

export async function loadStatisticsData() {
    try {
        state.statisticsData = await fetchJSONWithCache('data/equip/equip_data_statistics.json', { maxAge: 86400000 });
        return state.statisticsData;
    } catch (error) {
        console.warn('Failed to load statistics data:', error);
    }
    return null;
}

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

// ===== Helper Functions =====

const EQUIP_BASE_URL = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/equips';

/** Get equipment icon URL from icon ID */
export function getEquipIconUrl(iconId) {
    if (!iconId || iconId === '1') return '';
    return `${EQUIP_BASE_URL}/${iconId}.webp`;
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

/** Replace <[CODE]> patterns in text using equip_data_code.json mapping */
export function replaceEquipCodes(text) {
    if (!text || !state.equipCodeData) return text || '';
    return String(text).replace(/<\[([A-Z]+)\]>/g, (match, code) => {
        const entry = state.equipCodeData[code];
        return entry ? entry.text : match;
    });
}
