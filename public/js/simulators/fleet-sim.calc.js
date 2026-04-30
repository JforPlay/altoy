/**
 * Fleet Build Simulator — Stat & Reload Calculation Module
 * Handles all stat calculations: base ship stats, equipment bonuses,
 * fleet tech, passive skills, reload times, and stat highlighting.
 */

import { getStorageItem } from '../utils.js';
import { getShipByGid, getEquipFullById, getWeaponProperty, getSPWeaponById, getEffectiveShipType } from './fleet-sim.data.js';

// ===== State =====
let state;

// ===== Setup =====

export function setup(stateRef) {
    state = stateRef;
}

// ===== Constants =====

/** Stats displayed in the UI, ordered */
export const DISPLAY_STATS = [
    { key: 'health',    label: '내구', battleAttr: 'durability' },
    { key: 'firepower', label: '포격', battleAttr: 'cannonPower' },
    { key: 'aviation',  label: '항공', battleAttr: 'airPower' },
    { key: 'torpedo',   label: '뇌장', battleAttr: 'torpedoPower' },
    { key: 'antiair',   label: '대공', battleAttr: 'antiAirPower' },
    { key: 'evasion',   label: '기동', battleAttr: 'dodgeRate' },
    { key: 'accuracy',  label: '명중', battleAttr: 'attackRating' },
    { key: 'reload',    label: '장전', battleAttr: 'loadSpeed' },
];

/** Affinity bonus multipliers */
const AFFINITY_BONUSES = {
    other:   1.0,
    friendly: 1.01,
    crush:   1.03,
    love:    1.06,
    oath:    1.09,
    oath200: 1.12,
};

/** Stats that do NOT receive affinity bonus */
const NO_AFFINITY_STATS = new Set(['speed', 'luck']);

/**
 * Map equip attr_info key → ship stat key.
 * Covers all keys found in equip_data_full.json attr_info.
 */
const EQUIP_ATTR_TO_STAT = {
    cannon:       'firepower',
    firepower:    'firepower',
    torpedo:      'torpedo',
    antiaircraft: 'antiair',
    antiair:      'antiair',
    air:          'aviation',
    aviation:     'aviation',
    reload:       'reload',
    hit:          'accuracy',
    accuracy:     'accuracy',
    dodge:        'evasion',
    evasion:      'evasion',
    durability:   'health',
    health:       'health',
    speed:        'speed',
    luck:         'luck',
    antisub:      'asw',
    asw:          'asw',
};

/**
 * Map battleAttr (used in passive skills) → ship stat key.
 * Matches DISPLAY_STATS battleAttr values + extras.
 */
const BATTLE_ATTR_TO_STAT = {
    durability:   'health',
    cannonPower:  'firepower',
    airPower:     'aviation',
    torpedoPower: 'torpedo',
    antiAirPower: 'antiair',
    dodgeRate:    'evasion',
    attackRating: 'accuracy',
    loadSpeed:    'reload',
    antiSubPower: 'asw',
};

/**
 * Map attrTypeData ID → ship stat key.
 * Used for fleet tech bonuses (add field references attrType IDs).
 */
const ATTR_TYPE_ID_TO_STAT = {
    1:  'health',
    2:  'firepower',
    3:  'torpedo',
    4:  'antiair',
    5:  'aviation',
    6:  'reload',
    // 7: armor — not a stat we track
    8:  'accuracy',
    9:  'evasion',
    10: 'speed',
    11: 'luck',
    12: 'asw',
};

/**
 * Game's calcFloor: math.floor(x + 1e-9) (mathssupport.lua:190).
 * Epsilon guards against IEEE 754 rounding (e.g., 584.0 represented as 583.9999999998).
 */
const calcFloor = (x) => Math.floor(x + 1e-9);

/** Reload formula constants (from battleformulas.lua) */
const RELOAD_K1 = 6;
const RELOAD_K2 = 100;
const RELOAD_K3 = 3.14;

/** Carrier airstrike combined reload multiplier */
const AIR_ASSIST_RELOAD_RATIO = 2.2;

/** Carrier ship types (CV, CVL) */
const CARRIER_TYPES = new Set([6, 7]);

/** Weapon slot labels by ship type */
const SLOT_LABELS = {
    1:  ['주포', '어뢰', '대공'],    // DD
    2:  ['주포', '어뢰', '대공'],    // CL
    3:  ['주포', '부포', '대공'],    // CA
    4:  ['주포', '부포', '대공'],    // BC
    5:  ['주포', '부포', '대공'],    // BB
    6:  null,                        // CV — combined airstrike
    7:  null,                        // CVL — combined airstrike
    8:  ['어뢰', '어뢰', '주포'],    // SS
    10: ['주포', '항공', '대공'],    // BBV (후소/야마시로/이세/휴가 retrofit)
    20: ['주포', '어뢰', '대공'],    // DD (variant)
    21: ['주포', '어뢰', '대공'],    // DD (variant)
};

// ===== Main Calculation =====

/**
 * Calculate all stats for a single ship slot.
 * @param {object} slotConfig - { gid, level, affinity, equips: [{id, level}, null, ...] }
 * @param {object|null} fleetTechBonuses - Result of calculateFleetTechBonuses()
 * @param {Array} fleetPassiveBuffs - Result of resolvePassiveBuffs() for this ship
 * @returns {{ stats: object, reloads: Array<{label: string, seconds: number}> }|null}
 */
export function calculateShipStats(slotConfig, fleetTechBonuses, fleetPassiveBuffs) {
    if (!slotConfig || !slotConfig.gid) return null;

    const ship = getShipByGid(slotConfig.gid);
    if (!ship) return null;

    const level = slotConfig.level || 125;
    const affinityKey = slotConfig.affinity || 'love';
    const affinityMultiplier = AFFINITY_BONUSES[affinityKey] ?? 1.0;

    // --- Step 1: Base stat + growth ---
    const useRetrofit = slotConfig.retrofit !== false; // default true if not set
    const baseStats = _getStatsForLB(ship, 'base', useRetrofit);
    const growthStats = _getStatsForLB(ship, 'growth', useRetrofit);
    if (!baseStats || !growthStats) return null;

    const stats = {};
    const ALL_STAT_KEYS = ['health', 'firepower', 'torpedo', 'antiair', 'aviation', 'reload', 'accuracy', 'evasion', 'speed', 'luck', 'asw'];

    for (const key of ALL_STAT_KEYS) {
        const base = baseStats[key] || 0;
        const growth = growthStats[key] || 0;
        stats[key] = base + growth * (level - 1) / 1000;
    }

    // --- Step 2: Enhance ---
    const enhance = ship.enhance || {};
    for (const key of ALL_STAT_KEYS) {
        stats[key] += (enhance[key] || 0);
    }

    // --- Step 3: Affinity + Retrofit → calcFloor ---
    // Game order (ship.lua:1046,1080-1094,1438):
    //   (base + growth + enhance) × affinity + retrofit_transforms → calcFloor
    // Affinity is float multiply, retrofit is added, THEN floor happens once.
    for (const key of ALL_STAT_KEYS) {
        const mult = NO_AFFINITY_STATS.has(key) ? 1.0 : affinityMultiplier;
        stats[key] = stats[key] * mult;
    }

    // Retrofit bonus added BEFORE floor (game adds in getShipProperties, floors in getProperties)
    if (useRetrofit && ship.retrofit && ship.retrofit.bonus) {
        for (const [key, value] of Object.entries(ship.retrofit.bonus)) {
            const statKey = EQUIP_ATTR_TO_STAT[key] || key;
            if (stats[statKey] !== undefined && typeof value === 'number') {
                stats[statKey] += value;
            }
        }
    }

    // calcFloor: game's math.floor(x + 1e-9) — matches ship.lua:1438
    for (const key of ALL_STAT_KEYS) {
        stats[key] = calcFloor(stats[key]);
    }

    // --- Breakdown: snapshot base stat (in-game ship stat) ---
    const breakdown = {};
    for (const key of ALL_STAT_KEYS) {
        breakdown[key] = { base: stats[key], equip: 0, tech: 0, buffFlat: 0, buffRatio: 0, buffRatioPercent: 0 };
    }

    // --- Step 4: Equipment flat bonuses ---
    const equips = slotConfig.equips || [];
    for (let i = 0; i < equips.length; i++) {
        const equipConfig = equips[i];
        if (!equipConfig || !equipConfig.id) continue;

        const equipBonuses = _getEquipStatBonuses(equipConfig.id, equipConfig.level);
        for (const [statKey, value] of Object.entries(equipBonuses)) {
            if (stats[statKey] !== undefined) {
                stats[statKey] += value;
                breakdown[statKey].equip += value;
            }
        }
    }

    // --- Step 4b: SP weapon stat bonuses (counted as equip) ---
    const spWeaponStats = _getSPWeaponStatBonuses(slotConfig, ship);
    for (const [statKey, value] of Object.entries(spWeaponStats)) {
        if (stats[statKey] !== undefined) {
            stats[statKey] += value;
            breakdown[statKey].equip += value;
        }
    }

    // --- Step 5: Fleet tech bonuses ---
    if (fleetTechBonuses) {
        const techBonus = _getFleetTechBonusForShip(getEffectiveShipType(ship, useRetrofit), fleetTechBonuses);
        for (const [statKey, value] of Object.entries(techBonus)) {
            if (stats[statKey] !== undefined) {
                stats[statKey] += value;
                breakdown[statKey].tech += value;
            }
        }
    }

    // --- Snapshot baseAttr (game calls SetBaseAttr here) ---
    // Used as base for ratio buff calculation (BattleBuffAddAttrRatio)
    // Must include all flat bonuses: equip, SP weapon, fleet tech
    const baseAttrStats = {};
    for (const key of ALL_STAT_KEYS) {
        baseAttrStats[key] = stats[key];
    }

    // --- Step 6: Passive skill buffs ---
    // Game accumulates buff values as floats and applies via FlashByBuff:
    //   _attr[stat] = baseAttr[stat] + accumulated_buff_total
    // Ratio buffs: number * baseAttr * 0.0001 (battlebuffaddattrratio.lua:19)
    if (fleetPassiveBuffs && fleetPassiveBuffs.length > 0) {
        for (const buff of fleetPassiveBuffs) {
            const statKey = BATTLE_ATTR_TO_STAT[buff.attr];
            if (!statKey || stats[statKey] === undefined) continue;

            if (buff.type === 'flat') {
                stats[statKey] += buff.value;
                breakdown[statKey].buffFlat += buff.value;
            } else if (buff.type === 'ratio') {
                const ratioAdd = buff.value * baseAttrStats[statKey] * 0.0001;
                stats[statKey] += ratioAdd;
                breakdown[statKey].buffRatio += ratioAdd;
                breakdown[statKey].buffRatioPercent += buff.value * 0.01; // accumulate percentage
            }
        }
    }

    // --- Final: floor all stats and ratio breakdown ---
    for (const key of ALL_STAT_KEYS) {
        stats[key] = calcFloor(stats[key]);
        breakdown[key].buffRatio = calcFloor(breakdown[key].buffRatio);
    }

    // --- Reload calculation ---
    const reloads = _calculateReloads(ship, slotConfig, stats.reload);

    return { stats, reloads, breakdown };
}

// ===== Fleet Tech Bonuses =====

/**
 * Calculate fleet tech bonuses based on shipgirlTrackerProgress in localStorage.
 * Reads progress bits, sums tech points per nationality, finds tech levels,
 * and builds bonus maps.
 * @returns {object|null} { groupId: { name, level, score, bonusByShipType } } or null
 */
export function calculateFleetTechBonuses() {
    const progressStr = getStorageItem('shipgirlTrackerProgress', null);
    if (!progressStr) return null;

    let progress;
    try {
        progress = JSON.parse(progressStr);
    } catch {
        return null;
    }

    if (!state.shipGroupData || !state.nationalityData || !state.fleetTechData) return null;

    // Sum tech points per nationality ID
    const scoreByNatId = {};
    for (const [gidStr, bits] of Object.entries(progress)) {
        const shipGroup = state.shipGroupData[gidStr];
        if (!shipGroup) continue;

        const natId = shipGroup.nationality;
        if (natId == null) continue;

        if (!scoreByNatId[natId]) scoreByNatId[natId] = 0;

        // Bits: 1 = obtained (pt_get), 2 = leveled (pt_level), 4 = upgraded (pt_upgrage)
        if (bits & 1) scoreByNatId[natId] += (shipGroup.pt_get || 0);
        if (bits & 2) scoreByNatId[natId] += (shipGroup.pt_level || 0);
        if (bits & 4) scoreByNatId[natId] += (shipGroup.pt_upgrage || 0);
    }

    // For each faction group (1-4), find achieved tech level and build bonuses
    const result = {};

    for (let groupId = 1; groupId <= 4; groupId++) {
        const natInfo = state.nationalityData[String(groupId)];
        if (!natInfo) continue;

        const score = scoreByNatId[groupId] || 0;
        if (score === 0) continue;

        // Find highest tech level where score >= pt threshold
        let currentLevel = 0;
        let activeTechEntry = null;

        for (let level = 1; level <= 9; level++) {
            const techId = `${groupId}00${level}`;
            const techEntry = state.fleetTechData[techId];
            if (!techEntry) continue;

            if (score >= techEntry.pt) {
                currentLevel = level;
                activeTechEntry = techEntry;
            } else {
                break;
            }
        }

        if (currentLevel === 0 || !activeTechEntry) continue;

        // Build bonusByShipType from the active tech level's "add" field
        // add format: [[shipTypeIds], attrTypeId, value]
        const bonusByShipType = {};

        for (const [shipTypes, attrType, value] of activeTechEntry.add) {
            const statKey = ATTR_TYPE_ID_TO_STAT[attrType];
            if (!statKey) continue;

            for (const typeId of shipTypes) {
                if (!bonusByShipType[typeId]) bonusByShipType[typeId] = {};
                bonusByShipType[typeId][statKey] = (bonusByShipType[typeId][statKey] || 0) + value;
            }
        }

        result[groupId] = {
            name: natInfo.name,
            level: currentLevel,
            score,
            bonusByShipType,
        };
    }

    return Object.keys(result).length > 0 ? result : null;
}

// ===== Passive Skill Resolution =====

/**
 * Resolve all passive skill buffs that apply to a target ship from all fleet members.
 * @param {object} targetShip - Ship data object (the ship receiving buffs)
 * @param {Array<object|null>} allFleetShips - Array of 6 ship data objects (null for empty slots)
 * @returns {Array<{attr: string, value: number, type: string}>} Buff entries
 */
export function resolvePassiveBuffs(targetShip, allFleetShips) {
    if (!targetShip || !allFleetShips || !state.passiveSkillData) return [];

    const buffs = [];
    const targetType = targetShip.type;

    for (const memberShip of allFleetShips) {
        if (!memberShip || !memberShip.skill) continue;

        const isSelf = memberShip.gid === targetShip.gid;

        for (const skillId of Object.keys(memberShip.skill)) {
            const passiveSkill = state.passiveSkillData[String(skillId)];
            if (!passiveSkill) continue;

            // Check targeting rules
            if (passiveSkill.target_mode === 'self') {
                // Self-targeting: only apply to the ship that owns the skill
                if (!isSelf) continue;
            } else if (passiveSkill.target_mode === 'fleet') {
                // Fleet-targeting: check ship type filter
                if (passiveSkill.target_types && passiveSkill.target_types.length > 0) {
                    if (!passiveSkill.target_types.includes(targetType)) continue;
                }
                // Check nationality filter
                if (passiveSkill.target_nationality && passiveSkill.target_nationality.length > 0) {
                    if (!passiveSkill.target_nationality.includes(targetShip.nationality)) continue;
                }
            } else {
                // Unknown target mode — skip
                continue;
            }

            // Get max level buffs
            const levelBuffs = _getMaxLevelBuffs(passiveSkill);
            if (levelBuffs) {
                for (const buff of levelBuffs) {
                    // Per-buff target override (e.g., mixed self+fleet skills)
                    if (buff.target === 'self' && !isSelf) continue;
                    if (buff.target === 'fleet_except_self' && isSelf) continue;
                    buffs.push({ attr: buff.attr, value: buff.value, type: buff.type });
                }
            }
        }
    }

    return buffs;
}

// ===== Stat Highlighting =====

/**
 * Compare a stat across all 6 slots. The slot(s) with the highest non-zero value
 * for each stat get highlighted.
 * @param {Array<object|null>} allStats - Array of 6 stat objects (from calculateShipStats results)
 * @returns {object} { statKey: Set<slotIndex> } - indices of slots with highest value
 */
export function computeHighlights(allStats) {
    if (!allStats || allStats.length === 0) return {};

    const highlights = {};
    const statKeys = DISPLAY_STATS.map(s => s.key);

    for (const statKey of statKeys) {
        let maxVal = 0;
        const maxIndices = new Set();

        for (let i = 0; i < allStats.length; i++) {
            const stats = allStats[i];
            if (!stats) continue;

            const val = stats[statKey] || 0;
            if (val <= 0) continue;

            if (val > maxVal) {
                maxVal = val;
                maxIndices.clear();
                maxIndices.add(i);
            } else if (val === maxVal) {
                maxIndices.add(i);
            }
        }

        // Only highlight if at least one non-zero value exists and there's
        // a meaningful comparison (more than one occupied slot)
        if (maxVal > 0 && maxIndices.size > 0) {
            highlights[statKey] = maxIndices;
        }
    }

    return highlights;
}

// ===== Internal Helpers =====

/**
 * Get stats for the selected limit break state.
 * @param {object} ship - Ship data
 * @param {string} field - 'base' or 'growth'
 * @param {boolean} useRetrofit - Whether to use retrofit stats (last key) or MLB (second-to-last for 5+ keys)
 */
function _getStatsForLB(ship, field, useRetrofit) {
    const statObj = ship[field];
    if (!statObj) return null;

    const keys = Object.keys(statObj);
    if (keys.length === 0) return null;

    // If retrofit OFF and ship has retrofit and 5+ keys, use second-to-last key (MLB without retrofit base changes)
    if (!useRetrofit && ship.retrofit && keys.length >= 5) {
        return statObj[keys[keys.length - 2]] || null;
    }

    // Default: last key = max (retrofit if available, MLB otherwise)
    return statObj[keys[keys.length - 1]] || null;
}

/**
 * Get SP weapon stat bonuses for a ship slot.
 * Handles both dedicated (unique) SP weapons and user-selected generic ones.
 */
function _getSPWeaponStatBonuses(slotConfig, ship) {
    const bonuses = {};

    // Check for user-selected SP weapon first. Stored level is the visible
    // enhance value (+0..+10), while data levels are indexed from base.
    const spConfig = slotConfig.spWeapon;
    if (spConfig && spConfig.id) {
        const spWeapon = getSPWeaponById(spConfig.id);
        if (spWeapon && spWeapon.levels) {
            const levelIdx = Math.min(spConfig.level || 0, spWeapon.levels.length - 1);
            const lvl = spWeapon.levels[Math.max(0, levelIdx)];
            const stat1 = EQUIP_ATTR_TO_STAT[spWeapon.attr_1];
            const stat2 = EQUIP_ATTR_TO_STAT[spWeapon.attr_2];
            if (stat1 && lvl.v1) bonuses[stat1] = (bonuses[stat1] || 0) + lvl.v1;
            if (stat2 && lvl.v2) bonuses[stat2] = (bonuses[stat2] || 0) + lvl.v2;
        }
        return bonuses;
    }

    // Fall back to dedicated SP weapon from ship data (display-only, always max level)
    if (ship.sp_weapon) {
        const dedicated = _findDedicatedSPWeaponData(ship.gid);
        if (dedicated && dedicated.levels) {
            const lvl = dedicated.levels[dedicated.levels.length - 1]; // max level
            const stat1 = EQUIP_ATTR_TO_STAT[dedicated.attr_1];
            const stat2 = EQUIP_ATTR_TO_STAT[dedicated.attr_2];
            if (stat1 && lvl.v1) bonuses[stat1] = (bonuses[stat1] || 0) + lvl.v1;
            if (stat2 && lvl.v2) bonuses[stat2] = (bonuses[stat2] || 0) + lvl.v2;
        }
    }

    return bonuses;
}

/** Find dedicated SP weapon data from spWeaponData by ship gid */
function _findDedicatedSPWeaponData(gid) {
    if (!state.spWeaponData || !state.spWeaponData.weapons) return null;
    for (const weapon of Object.values(state.spWeaponData.weapons)) {
        if (weapon.unique === gid) return weapon;
    }
    return null;
}

/**
 * Extract flat stat bonuses from an equipment at a given enhance level.
 * @param {number|string} equipId - Equipment base ID
 * @param {number} enhanceLevel - visible enhance level (+0..+13 typically)
 * @returns {object} { statKey: value, ... }
 */
function _getEquipStatBonuses(equipId, enhanceLevel) {
    const bonuses = {};

    const equipFull = getEquipFullById(equipId);
    if (!equipFull || !equipFull.attr_info || !equipFull.levels) return bonuses;

    // Data levels include base as index 0, so visible +13 maps to index 13.
    const levelIdx = Math.max(0, enhanceLevel || 0);
    const levelData = equipFull.levels[Math.min(levelIdx, equipFull.levels.length - 1)];
    if (!levelData) return bonuses;

    // Map attr_info[i].key → attr_{index}_value from levelData
    // Note: attr_info[i].index specifies which attr_N_value field to read
    // (index does NOT always equal positional order)
    for (let i = 0; i < equipFull.attr_info.length; i++) {
        const attrInfo = equipFull.attr_info[i];
        const attrKey = attrInfo.key;
        const statKey = EQUIP_ATTR_TO_STAT[attrKey];
        if (!statKey) continue;

        const idx = attrInfo.index || (i + 1);
        const valueField = `attr_${idx}_value`;
        const rawValue = levelData[valueField];
        if (rawValue == null) continue;

        const parsed = parseFloat(rawValue);
        if (!isNaN(parsed)) {
            bonuses[statKey] = (bonuses[statKey] || 0) + parsed;
        }
    }

    return bonuses;
}

/**
 * Get combined fleet tech bonus for a specific ship type.
 * Sums across all faction groups (1-4).
 * @param {number} shipType - Ship type ID
 * @param {object} fleetTechBonuses - Result of calculateFleetTechBonuses()
 * @returns {object} { statKey: totalValue, ... }
 */
function _getFleetTechBonusForShip(shipType, fleetTechBonuses) {
    const combined = {};

    for (const groupData of Object.values(fleetTechBonuses)) {
        const byType = groupData.bonusByShipType;
        if (!byType || !byType[shipType]) continue;

        for (const [statKey, value] of Object.entries(byType[shipType])) {
            combined[statKey] = (combined[statKey] || 0) + value;
        }
    }

    return combined;
}

/**
 * Get the buff entries at the highest level of a passive skill.
 * @param {object} passiveSkill - Passive skill data with levels object
 * @returns {Array|null} Array of { attr, value, type } or null
 */
function _getMaxLevelBuffs(passiveSkill) {
    const levels = passiveSkill.levels;
    if (!levels) return null;

    // Find highest numeric key
    let maxLevel = 0;
    for (const key of Object.keys(levels)) {
        const num = parseInt(key, 10);
        if (!isNaN(num) && num > maxLevel) {
            maxLevel = num;
        }
    }

    if (maxLevel === 0) return null;
    return levels[String(maxLevel)] || null;
}

/**
 * Calculate reload times for weapon slots.
 * @param {object} ship - Ship data
 * @param {object} slotConfig - Slot configuration with equips
 * @param {number} reloadStat - Final calculated reload stat value
 * @returns {Array<{label: string, seconds: number}>}
 */
function _calculateReloads(ship, slotConfig, reloadStat) {
    const equips = slotConfig.equips || [];
    // Honor retrofit form — BBV/DDG/CA retrofits change the ship type, which flips
    // both the carrier-vs-standard reload branch and the slot label set.
    const useRetrofit = slotConfig.retrofit !== false && !!ship.retrofit;
    const shipType = getEffectiveShipType(ship, useRetrofit);

    // Carrier types: combined airstrike calculation
    if (CARRIER_TYPES.has(shipType)) {
        return _calculateCarrierReload(equips, reloadStat);
    }

    // Standard weapons: calculate per slot (slots 0-2 only)
    const labels = SLOT_LABELS[shipType] || ['슬롯1', '슬롯2', '슬롯3'];
    const reloads = [];

    for (let i = 0; i < 3; i++) {
        const equipConfig = equips[i];
        if (!equipConfig || !equipConfig.id) continue;

        const reloadMax = _getWeaponReloadMax(equipConfig.id, equipConfig.level);
        if (reloadMax == null) continue;

        const seconds = _reloadFormula(reloadMax, reloadStat);
        reloads.push({ label: labels[i], seconds });
    }

    return reloads;
}

/**
 * Calculate combined carrier airstrike reload.
 * Average the reload_max of aircraft in slots 0-2, multiply by AIR_ASSIST_RELOAD_RATIO.
 */
function _calculateCarrierReload(equips, reloadStat) {
    const reloadMaxValues = [];

    for (let i = 0; i < 3; i++) {
        const equipConfig = equips[i];
        if (!equipConfig || !equipConfig.id) continue;

        const reloadMax = _getWeaponReloadMax(equipConfig.id, equipConfig.level);
        if (reloadMax != null) {
            reloadMaxValues.push(reloadMax);
        }
    }

    if (reloadMaxValues.length === 0) return [];

    const avgReloadMax = reloadMaxValues.reduce((sum, v) => sum + v, 0) / reloadMaxValues.length;
    const combined = avgReloadMax * AIR_ASSIST_RELOAD_RATIO;
    const seconds = _reloadFormula(combined, reloadStat);

    return [{ label: '항공기', seconds }];
}

/**
 * Get the weapon's reload_max for an equipment at a given enhance level.
 * @param {number|string} equipId - Equipment base ID
 * @param {number} enhanceLevel - visible enhance level (+0..+13 typically)
 * @returns {number|null} reload_max value or null
 */
function _getWeaponReloadMax(equipId, enhanceLevel) {
    const equipFull = getEquipFullById(equipId);
    if (!equipFull || !equipFull.levels) return null;

    // Data levels include base as index 0, so visible +13 maps to index 13.
    const levelIdx = Math.max(0, enhanceLevel || 0);
    const levelData = equipFull.levels[Math.min(levelIdx, equipFull.levels.length - 1)];
    if (!levelData) return null;

    // weapon_id can be null, empty array, a number, or an array of numbers
    let weaponId = levelData.weapon_id;
    if (!weaponId) return null;

    if (Array.isArray(weaponId)) {
        if (weaponId.length === 0) return null;
        weaponId = weaponId[0]; // Use first weapon
    }

    const weapon = getWeaponProperty(weaponId);
    if (!weapon) return null;

    return weapon.reload_max ?? null;
}

/**
 * Apply the reload time formula.
 * reload_seconds = reload_max / K1 / sqrt((ship_reload + K2) * K3)
 * @param {number} reloadMax - Weapon's reload_max value
 * @param {number} shipReload - Ship's final reload stat
 * @returns {number} Reload time in seconds (2 decimal places)
 */
function _reloadFormula(reloadMax, shipReload) {
    const denominator = RELOAD_K1 * Math.sqrt((shipReload + RELOAD_K2) * RELOAD_K3);
    if (denominator === 0) return 0;
    const seconds = reloadMax / denominator;
    return Math.round(seconds * 100) / 100;
}
