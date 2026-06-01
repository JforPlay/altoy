/**
 * equip.data.js
 * Data loading and lookup helpers for the equipment viewer.
 * Part of the equip viewer module group (viewer + data + detail + compare + upgrade).
 * State is shared via a ref passed to setup() from equip.viewer.js.
 * Exports all data-layer functions used by detail, compare, and upgrade modules.
 */

import { fetchJSON, fetchJSONWithCache, DATA_FOR_TOY_BASE } from '../utils.js';

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
        resolvedWeaponPropertyCache.clear();
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

export async function loadBarrageTemplateData() {
    try {
        state.barrageTemplateData = await fetchJSONWithCache('data/sim/barrage_template.json', { maxAge: 86400000 });
        return state.barrageTemplateData;
    } catch (error) {
        console.warn('Failed to load barrage template data:', error);
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

const EQUIP_BASE_URL = `${DATA_FOR_TOY_BASE}/equips`;
const SP_WEAPON_BASE_URL = `${DATA_FOR_TOY_BASE}/spweapon`;

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
    return `${DATA_FOR_TOY_BASE}/weaponframes/bg${rarity - 1}.webp`;
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
    return resolveWeaponProperty(weaponId);
}

const resolvedWeaponPropertyCache = new Map();

/**
 * Resolve a weapon_property row through its own base chain.
 * Some max-enhance synthetic weapon IDs only override a few fields and inherit
 * reload/damage data from another max-level weapon_property row.
 */
function resolveWeaponProperty(weaponId, seen = new Set()) {
    const key = String(weaponId);
    if (resolvedWeaponPropertyCache.has(key)) {
        return resolvedWeaponPropertyCache.get(key);
    }

    const entry = state.weaponPropertyData[key];
    if (!entry) return null;

    if (entry.base == null || seen.has(key)) {
        resolvedWeaponPropertyCache.set(key, entry);
        return entry;
    }

    seen.add(key);
    const base = resolveWeaponProperty(entry.base, seen);
    if (!base) {
        resolvedWeaponPropertyCache.set(key, entry);
        return entry;
    }

    const resolved = { ...base };
    for (const [prop, value] of Object.entries(entry)) {
        if (value != null) resolved[prop] = value;
    }
    resolvedWeaponPropertyCache.set(key, resolved);
    return resolved;
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

/** Get barrage template by barrage ID */
export function getBarrageTemplate(barrageId) {
    if (!state.barrageTemplateData) return null;
    return state.barrageTemplateData[String(barrageId)] || null;
}

/**
 * Build a Korean firing-pattern description for a weapon from its barrage(s).
 * A barrage fires (senior_repeat+1) waves of (primal_repeat+1) bullets each;
 * `delay` spaces bullets within a wave, `senior_delay` spaces the waves.
 * Returns null when there is nothing meaningful to describe (single shot only).
 * For multi-barrage weapons, distinct per-barrage phrases are joined with " + ".
 */
export function getFiringPattern(weaponProperty) {
    if (!weaponProperty || !Array.isArray(weaponProperty.barrage_ID)) return null;

    const phrases = [];
    for (const barrageId of weaponProperty.barrage_ID) {
        const barrage = getBarrageTemplate(barrageId);
        if (!barrage) continue;

        const waves = (barrage.senior_repeat || 0) + 1;
        const bulletsPerWave = (barrage.primal_repeat || 0) + 1;
        const total = waves * bulletsPerWave;
        if (total <= 1) continue;

        const delay = barrage.delay || 0;
        const seniorDelay = barrage.senior_delay || 0;
        // A spacing only matters when there is more than one item to space.
        const intraMatters = bulletsPerWave > 1 && delay > 0;
        const interMatters = waves > 1 && seniorDelay > 0;

        let phrase;
        if (!intraMatters && !interMatters) {
            phrase = `${total}발 동시 발사`;
        } else if (intraMatters && !interMatters) {
            phrase = `${total}발 · ${delay}s 간격 연사`;
        } else if (!intraMatters && bulletsPerWave === 1) {
            phrase = `${total}발 · ${seniorDelay}s 간격 연사`;
        } else if (!intraMatters) {
            phrase = `${bulletsPerWave}발씩 ${seniorDelay}s 간격, ${waves}회 연사`;
        } else {
            phrase = `${bulletsPerWave}발씩 ${waves}회 · 묶음간 ${seniorDelay}s / 탄간 ${delay}s`;
        }
        phrases.push(phrase);
    }

    if (!phrases.length) return null;
    return [...new Set(phrases)].join(' + ');
}

// ===== Enhance Levels =====

/** Rarity → max enhance level index. Some equips carry synthetic max-enhance
 *  level entries beyond the real cap; those must not be selectable. */
const ENHANCE_CAP = { 2: 3, 3: 6, 4: 11, 5: 13, 6: 13 };

/** Number of selectable enhance levels for an equip, capped by rarity. */
export function getVisibleLevelCount(equip) {
    const rarityCap = (ENHANCE_CAP[equip.rarity] ?? 13) + 1;
    return Math.min(equip.levels.length, rarityCap);
}

/** Format an enhance level index for display: 0 → "0", 1+ → "+1", "+2", etc. */
export function formatLevel(index) {
    return index === 0 ? '0' : `+${index}`;
}

// ===== Weapon / Aircraft Resolution =====

// Two-path model — see CLAUDE.md "Aircraft Equipment Data Resolution".
// Standard equipment resolves weapon_id → weapon_property directly; aircraft
// types resolve weapon_id → aircraft_template → weapon_ID[] → weapon_property.

/** Equipment types that use aircraft_template for bullet resolution */
export const AIRCRAFT_TYPES = new Set([7, 8, 9, 12, 15]);

/** Merge base and current weapon properties, skipping null overrides */
export function getMergedWeaponProperty(baseWpId, currentWpId) {
    const baseWp = baseWpId ? getWeaponProperty(baseWpId) : null;
    const currentWp = currentWpId ? getWeaponProperty(currentWpId) : null;

    if (!baseWp && !currentWp) return null;
    if (!baseWp) return currentWp;
    if (!currentWp) return baseWp;

    const merged = { ...baseWp };
    for (const [key, val] of Object.entries(currentWp)) {
        if (val != null) merged[key] = val;
    }
    return merged;
}

/** Merge base and current aircraft template properties, skipping null overrides */
export function getMergedAircraftTemplate(baseAcId, currentAcId) {
    const baseAc = baseAcId ? getAircraftTemplate(baseAcId) : null;
    const currentAc = currentAcId ? getAircraftTemplate(currentAcId) : null;

    if (!baseAc && !currentAc) return null;
    if (!baseAc) return currentAc;
    if (!currentAc) return baseAc;

    const merged = { ...baseAc };
    for (const [key, val] of Object.entries(currentAc)) {
        if (val != null) merged[key] = val;
    }
    return merged;
}

/** Get merged weapon properties for all weapon_ids in a level.
 *  For aircraft types (7,8,9,12,15): weapon_id → aircraft_template → weapon_ID → weapon_property
 *  For others: weapon_id → weapon_property directly */
export function getMergedWeaponProperties(equip, level) {
    const weaponIds = level.weapon_id;
    if (!weaponIds || !weaponIds.length) return [];

    const baseIds = equip.levels[0].weapon_id || [];

    if (AIRCRAFT_TYPES.has(equip.type)) {
        // Aircraft path: each weapon_id maps to aircraft_template → weapon_ID list
        // Deduplicate by base weapon ID since multiple aircraft slots can share weapons
        const results = [];
        const seen = new Set();
        for (let i = 0; i < weaponIds.length; i++) {
            const aircraft = getAircraftTemplate(weaponIds[i]);
            if (!aircraft || !aircraft.weapon_ID) continue;
            const baseAircraft = getAircraftTemplate(baseIds[i] || baseIds[0]);
            const baseAcWeaponIds = baseAircraft ? (baseAircraft.weapon_ID || []) : [];
            for (let j = 0; j < aircraft.weapon_ID.length; j++) {
                const acWid = aircraft.weapon_ID[j];
                const acBaseWid = baseAcWeaponIds[j] || baseAcWeaponIds[0];
                if (seen.has(acBaseWid)) continue;
                seen.add(acBaseWid);
                const merged = getMergedWeaponProperty(acBaseWid, acWid);
                if (merged) {
                    merged._weaponId = acWid;
                    results.push(merged);
                }
            }
        }
        return results;
    }

    // Standard path
    return weaponIds.map((wid, i) => {
        const baseWpId = baseIds[i] || baseIds[0];
        const merged = getMergedWeaponProperty(baseWpId, wid);
        if (merged) merged._weaponId = wid;
        return merged;
    }).filter(Boolean);
}

/** Get the weapon_property for the primary (first) weapon_id of a level.
 *  Always uses weapon_id → weapon_property directly (not through aircraft chain). */
export function getPrimaryWeaponProperty(equip, level) {
    const weaponIds = level.weapon_id;
    if (!weaponIds || !weaponIds.length) return null;

    const baseWid = (equip.levels[0].weapon_id || [])[0];
    return getMergedWeaponProperty(baseWid, weaponIds[0]);
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
export const SP_RARITY_NAMES = { 2: 'R', 3: 'SR', 4: 'SSR' };

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

/**
 * Compute reload time (seconds) for an equip entry from its max-level primary weapon.
 * Falls back to the base-level weapon's reload_max when the max-level value is null.
 * Weapon rows are looked up via getWeaponProperty, which already resolves base-chain inheritance.
 * Returns null if no reload_max is available.
 */
function getEquipReloadTime(equipId) {
    if (!state.fullEquipData || !state.weaponPropertyData) return null;
    const full = state.fullEquipData[String(equipId)];
    if (!full || !full.levels || full.levels.length === 0) return null;

    const maxLevel = full.levels[full.levels.length - 1];
    const maxWids = maxLevel.weapon_id;
    if (!maxWids || !maxWids.length) return null;

    const baseWids = full.levels[0].weapon_id || [];
    const baseWp = getWeaponProperty(baseWids[0]);
    const currentWp = getWeaponProperty(maxWids[0]);

    if (!baseWp && !currentWp) return null;

    const reloadMax = (currentWp && currentWp.reload_max != null)
        ? currentWp.reload_max
        : (baseWp ? baseWp.reload_max : null);

    if (reloadMax == null) return null;
    return Math.floor((reloadMax / 150) * 100) / 100;
}

/**
 * Enrich all lite entries with _reloadTime after full data and weapon_property are loaded.
 * Skips SP weapons (they don't have weapon_id-based reload).
 */
export function enrichEquipDataWithReload() {
    for (const equip of state.equipData) {
        if (equip._isSPWeapon) continue;
        equip._reloadTime = getEquipReloadTime(equip.id);
    }
}

/** Replace <[CODE]> patterns in text using equip_data_code.json mapping */
export function replaceEquipCodes(text) {
    if (!text || !state.equipCodeData) return text || '';
    return String(text).replace(/<\[([A-Z]+)\]>/g, (match, code) => {
        const entry = state.equipCodeData[code];
        return entry ? entry.text : match;
    });
}
