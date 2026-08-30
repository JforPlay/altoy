/**
 * Fleet Build Simulator — Stat & Reload Calculation Module
 * Handles all stat calculations: base ship stats, equipment bonuses,
 * fleet tech, passive skills, reload times, and stat highlighting.
 */

import { getStorageItem } from '../utils.js';
import { getShipByGid, getEquipFullById, getWeaponProperty, getSPWeaponById, getEffectiveShipType, getSlotName } from './fleet-sim.data.js';
import {
    TECH_STAT_BY_ATTR_ID, shipTypeTechCaps, shipTypeTechFromProgress, effectiveShipTypeTech,
} from './fleet-sim.tech.js';
// Pure helper; fleet-sim.damage.js reaches back here only through a dynamic import(),
// so this static edge does not close a cycle.
import {
    mergeWeaponWithBase, liveSkillIds, spSkillUpgradePairs, applySPSkillUpgrade,
} from './fleet-sim.damage.js';

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

/**
 * Offensive headline stats for the always-on card strip, in strip order.
 * Deliberately excludes 내구 (always non-zero, so it would take a slot on every
 * card) and 기동/명중 (secondary) — the 스탯 전체 grid still shows all eight.
 */
const VITAL_STATS = ['firepower', 'aviation', 'torpedo', 'antiair', 'reload'];

/**
 * An offensive vital below this share of the ship's own biggest one is noise the
 * ship never attacks with (경순 항공 32 / 뇌장 13 beside 대공 391) — five entries
 * plus the reload chips then wrap the strip onto a second row. 장전 is exempt:
 * it is a cadence stat in a different unit, so comparing it to 포격 is meaningless
 * and would drop 장전 off any high-firepower battleship.
 */
const VITAL_MIN_SHARE = 0.15;

/**
 * Pick the non-zero, non-negligible vitals for one ship, resolving labels through
 * DISPLAY_STATS so the strip and the full grid can never disagree on wording.
 *
 * @param {object|null} stats calcResult.stats, or null before a calc lands
 * @param {number} [max=5] hard cap on returned entries
 * @returns {Array<{key: string, label: string, value: number}>}
 */
export function pickVitalStats(stats, max = 5) {
    if (!stats) return [];
    const peak = Math.max(...VITAL_STATS.map((k) => (k === 'reload' ? 0 : stats[k] || 0)));
    const out = [];
    for (const key of VITAL_STATS) {
        if (out.length >= max) break;
        const value = stats[key];
        if (!value) continue;
        if (key !== 'reload' && value < peak * VITAL_MIN_SHARE) continue;
        const meta = DISPLAY_STATS.find((s) => s.key === key);
        if (!meta) continue;
        out.push({ key, label: meta.label, value: Math.floor(value) });
    }
    return out;
}

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
 * Map attrTypeData ID → ship stat key, for BOTH fleet-tech systems (the 진영
 * `add` table and 함종 `add_*_attr` share one id space). Single source in
 * fleet-sim.tech.js — a second copy here drifted the two apart once already.
 */
const ATTR_TYPE_ID_TO_STAT = TECH_STAT_BY_ATTR_ID;

/**
 * Game's calcFloor: math.floor(x + 1e-9) (mathssupport.lua:190).
 * Epsilon guards against IEEE 754 rounding (e.g., 584.0 represented as 583.9999999998).
 */
const calcFloor = (x) => Math.floor(x + 1e-9);

/** Reload formula constants (from battleformulas.lua) */
const RELOAD_K1 = 6;
const RELOAD_K2 = 100;
const RELOAD_K3 = 3.14;

/** 항공 지원 combined reload multiplier — battleconfig.lua AIR_ASSIST_RELOAD_RATIO = 220 × PERCENT */
const AIR_ASSIST_RELOAD_RATIO = 2.2;

/**
 * weapon_property.type of an aircraft launcher that feeds the ship's 항공 지원
 * (battleconst.lua EquipmentType.STRIKE_AIRCRAFT). The air assist is a property of
 * the EQUIPPED WEAPON, not of the hull — battleplayerunit.lua AddWeapon files a
 * weapon into `_hiveList` on this type alone. A ship-type test misses every 항전
 * aviation slot, which then got a bare per-slot reload with no ×2.2 (키어사지 read
 * 8.80s where the game shows ~19.4s). Mirrors STRIKE_AIRCRAFT_TYPE in fleet-sim.damage.js.
 */
const STRIKE_AIRCRAFT_TYPE = 10;

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
    // 운명 시뮬레이션's ONLY stat is 행운 (+15 SSR / +25 UR, over its five steps), and
    // it is the sole source of an `enhance.luck` — 853 of 886 ships have none and the
    // 33 that do are exactly the ships carrying a Fate Simulation skill — so the
    // toggle turns off precisely that term.
    const enhance = ship.enhance || {};
    const useFate = slotConfig.fate !== false;
    for (const key of ALL_STAT_KEYS) {
        if (key === 'luck' && !useFate) continue;
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
    const spWeaponStats = _getSPWeaponStatBonuses(slotConfig);
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
    // The card's 장전 readout and the damage panel's 사속 column must agree, and
    // they are two separate walks — so the weapon-scoped reload modifiers have to
    // reach BOTH. Without this 괴츠 폰 베를리힝겐's header reads 20.11s beside a
    // 9.69s 주포 row.
    const reloads = _calculateReloads(ship, slotConfig, stats.reload, sumWeaponModifiers(fleetPassiveBuffs));

    return { stats, reloads, breakdown };
}

// ===== Fleet Tech Bonuses =====

/**
 * Key for the 함종 기술 entry inside the calculateFleetTechBonuses() result.
 * A string that can never collide with the numeric faction group ids 1–4, so
 * _getFleetTechBonusForShip picks it up through the same bonusByShipType walk
 * with no special case.
 */
export const SHIPTYPE_TECH_KEY = 'shiptype';

/** The tracker's progress map, or null when the visitor has never used it. */
function _trackerProgress() {
    const raw = getStorageItem('shipgirlTrackerProgress', null);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

/** Roster ceiling for every (함종, 스탯) cell — memoised, ship_group_data never changes at runtime. */
let _techCaps = null;
export function getShipTypeTechCaps() {
    if (!_techCaps) _techCaps = shipTypeTechCaps(state.shipGroupData);
    return _techCaps;
}

/**
 * 함종 기술: per-hull-type flat bonuses, tracker-derived and then overridden
 * per cell by `state.techOverride` (owned by fleet-sim.main.js, see
 * fleet-sim.tech.js for why the merge is per cell rather than per table).
 * @returns {Object<number, Object<string, number>>} { shipType: { statKey: value } }
 */
export function calculateShipTypeTechBonuses() {
    if (!state.shipGroupData) return {};
    const derived = shipTypeTechFromProgress(state.shipGroupData, _trackerProgress());
    return effectiveShipTypeTech(derived, state.techOverride || {}, getShipTypeTechCaps());
}

/**
 * All fleet-tech bonuses that apply to this fleet: the four 진영 groups plus one
 * synthetic SHIPTYPE_TECH_KEY entry for 함종 기술.
 *
 * Returns null only when NEITHER system has anything — a manual 함종 override
 * with no tracker data is a perfectly valid state and must not read as "no data".
 * @returns {object|null} { groupId|'shiptype': { name, level?, score?, bonusByShipType } }
 */
export function calculateFleetTechBonuses() {
    const nation = _nationTechBonuses();
    const byShipType = calculateShipTypeTechBonuses();
    if (!nation && !Object.keys(byShipType).length) return null;
    return {
        ...(nation || {}),
        [SHIPTYPE_TECH_KEY]: { name: '함종 기술', bonusByShipType: byShipType },
    };
}

/**
 * 진영 기술 based on shipgirlTrackerProgress in localStorage.
 * Reads progress bits, sums tech points per nationality, finds tech levels,
 * and builds bonus maps.
 * @returns {object|null} { groupId: { name, level, score, bonusByShipType } } or null
 */
function _nationTechBonuses() {
    const progress = _trackerProgress();
    if (!progress) return null;

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
 * Fleet slot layout: 0–2 = 주력 (main), 3–5 = 전열 (vanguard). Mirrors the two
 * card grids in fleet-sim.astro and `state.fleets`' own slot comment.
 */
const MAIN_SLOTS = 3;

/**
 * The flagship (기함) is the FIRST OCCUPIED main-fleet slot, not slot 0.
 * battlefleetvo.lua appendMainUnit sets `_flagShip` on the first unit appended to
 * `_mainList`, and the list is built from occupied slots — so a fleet with slot 0
 * empty flags the next ship along.
 * @returns {number} slot index, or -1 when the main fleet is empty
 */
function _flagshipSlot(allFleetShips) {
    for (let i = 0; i < MAIN_SLOTS; i++) if (allFleetShips[i]) return i;
    return -1;
}

/**
 * Does a ship in `slot` receive a buff cast with `mode`?
 *
 * `vanguard`/`main`/`flagship` are the game's own TargetPlayerVanguardFleet /
 * TargetPlayerMainFleet / TargetPlayerFlagShip tokens (battletargetchoise.lua),
 * which is what the 지휘 skills (포술 지휘·선봉 등) use. They were extracted into
 * the data but hit the old "unknown target mode" branch and were dropped — 88
 * skills' worth of buffs that never reached a card.
 */
function _modeCoversSlot(mode, slot, allFleetShips) {
    if (slot < 0) return false;
    if (mode === 'vanguard') return slot >= MAIN_SLOTS;
    if (mode === 'main') return slot < MAIN_SLOTS;
    if (mode === 'flagship') return slot === _flagshipSlot(allFleetShips);
    return false;
}

/** Target modes decided by fleet position — the ones _modeCoversSlot answers for. */
const POSITIONAL_MODES = new Set(['vanguard', 'main', 'flagship']);

/**
 * Resolve all passive skill buffs that apply to a target ship from all fleet members.
 *
 * `allFleetShips` MUST be positional — 6 entries, null for an empty slot — because
 * vanguard/main/flagship targeting is decided by WHERE a ship sits. Passing a
 * compacted list silently shifts ships between the two rows.
 *
 * @param {object} targetShip - Ship data object (the ship receiving buffs)
 * @param {Array<object|null>} allFleetShips - 6 ship data objects, null for empty slots
 * A ship lists every rung of an upgrade chain, so the caster's skills go through
 * `liveSkillIds` — without it 하루나·改's base and retrofit rungs both buff the fleet,
 * and the 운명 toggle would not reach the four research ships whose fate skill is a
 * passive. `slotConfigs` carries each member's own 개장/운명 toggles; omit it and both
 * default on, which is what a caller with no slot state (a preview) wants.
 *
 * @param {number} targetSlot - index of targetShip within allFleetShips
 * @param {Array<object|null>} [slotConfigs] - positional slot configs, same indexing
 * @returns {Array<{attr: string, value: number, type: string}>} Buff entries
 */
export function resolvePassiveBuffs(targetShip, allFleetShips, targetSlot = -1, slotConfigs = null) {
    if (!targetShip || !allFleetShips || !state.passiveSkillData) return [];

    const buffs = [];

    for (let slot = 0; slot < allFleetShips.length; slot++) {
        const memberShip = allFleetShips[slot];
        if (!memberShip || !memberShip.skill) continue;

        // Slot identity, not gid: positions are what the fleet modes read, and a
        // caller that lost them would otherwise silently match the wrong ship.
        const isSelf = targetSlot >= 0 ? slot === targetSlot : memberShip.gid === targetShip.gid;

        const cfg = slotConfigs?.[slot];
        // A maxed 전용 장비 replaces one of the ship's skills with an upgraded rung.
        // The swap is scoped to THIS table — a pair whose successor has no passive
        // record keeps the base rung rather than losing the buff (see
        // applySPSkillUpgrade), so 13 of the 57 passive upgrades stay on their base.
        const liveIds = applySPSkillUpgrade(
            liveSkillIds(memberShip, cfg?.retrofit !== false, cfg?.fate !== false),
            spSkillUpgradePairs(cfg?.spWeapon, getSPWeaponById),
            (id) => !!state.passiveSkillData[String(id)],
        );
        for (const skillId of liveIds) {
            const passiveSkill = state.passiveSkillData[String(skillId)];
            if (!passiveSkill) continue;

            const levelBuffs = _getMaxLevelBuffs(passiveSkill);
            if (!levelBuffs) continue;

            for (const buff of levelBuffs) {
                if (!_clauseApplies(buff, passiveSkill, targetShip, targetSlot, allFleetShips, isSelf)) continue;
                // `skill` rides along because the weapon-scoped modifiers are gated per
                // skill (PERMANENT_WEAPON_MOD_SKILLS) — no other consumer reads it.
                buffs.push({
                    attr: buff.attr, value: buff.value, type: buff.type, src: buff.src,
                    skill: String(skillId), wtype: buff.wtype, slots: buff.slots,
                });
            }
        }
    }

    return buffs;
}

/**
 * Does one clause of a passive skill land on this ship?
 *
 * EVALUATED PER CLAUSE, NOT PER SKILL. One skill routinely mixes recipients —
 * 펑셔널 기믹 BOOST raises 키어사지's OWN 화력/항공 and separately grants every
 * carrier in the fleet 공습 선도 — and the skill-level `target_mode` / `target_types`
 * are the BROADEST of its clauses. Gating on those first meant a 항전 failed her own
 * skill's `types: [6,7]` carrier filter and lost the two stat buffs that were hers.
 * The clause's own `target` / `types` win where present; otherwise it inherits the
 * skill's, which the extractor only omits when they are identical.
 */
function _clauseApplies(buff, skill, targetShip, targetSlot, allFleetShips, isSelf) {
    const mode = buff.target || skill.target_mode;

    if (mode === 'self') return isSelf;
    if (mode === 'fleet_except_self') { if (isSelf) return false; }
    else if (POSITIONAL_MODES.has(mode)) {
        if (!_modeCoversSlot(mode, targetSlot, allFleetShips)) return false;
    } else if (mode !== 'fleet') {
        return false;               // unknown mode — never guess a recipient
    }

    const types = buff.types || skill.target_types;
    if (types && types.length > 0 && !types.includes(targetShip.type)) return false;

    const nats = skill.target_nationality;
    if (nats && nats.length > 0 && !nats.includes(targetShip.nationality)) return false;

    return true;
}

/**
 * Skills whose weapon-scoped modifiers last the WHOLE battle.
 *
 * `fleet_sim_passive_skills.json` emits a `weaponReloadRatio` / `slotDamageRatio`
 * for every skill that reaches one on a permanent buff — 34 displayed skills —
 * but PERMANENT IN THE CONFIG IS NOT PERMANENT IN THE FIGHT. Most of those cut
 * only the FIRST salvo (프린스 오브 웨일즈 -85%, 상 마르티뉴 -80%, 스트라스부르
 * -50%, 체셔 -70%) or the first N, and a separate removal edge — which the config
 * walk cannot see — tears the buff down after it. Honouring the file wholesale
 * would hand a dozen battleships a permanent 80% reload cut.
 *
 * So this is an ALLOWLIST, read off each skill's own KR text:
 *   152340 괴츠 폰 베를리힝겐  주포 장전 시간 50% 단축 AND that slot's 피해 -45%
 *   18350 / 19350 샹파뉴       「S.P.」 전투 중 주포 장전 속도 40% 감소
 *   15460 뤼초                 전투 개시 후, 주포 대미지 10% 증가
 *
 * 괴츠's two halves are a MATCHED PAIR and must never be split — the reload cut
 * alone reports her ~1.8x too high. The same pairing keeps several
 * verified-permanent entries OUT: 퍼시어스's +90% 항공 reload is real but comes
 * with a free opening airstrike the sim does not model, and 비스마르크's 부포
 * -35% rides a 부포 a main-fleet ship never lands on the boss anyway.
 *
 * NOT REACHABLE FROM HERE: 울리히 폰 후텐's identical pair (buff_15062/15063,
 * "기함이 아니라면 주포 장전에 필요한 시간 50% 감소, 주포 대미지 45% 감소"). The
 * game gates it on onUpperConsort/onLowerConsort — fleet ADJACENCY, a mechanic 15
 * other ships also use (토사, 리벤지, 조프르, 키어사지 …) — so the extractor never
 * emits it and modelling it is its own feature, not an allowlist entry.
 */
const PERMANENT_WEAPON_MOD_SKILLS = new Set(['152340', '18350', '19350', '15460']);

/**
 * Weapon-scoped modifier totals from resolved passive buffs.
 *
 * Neither kind is a ship stat. `weaponReloadRatio` scales ONE weapon class's own
 * reload_max (battleweaponunit, keyed on `weapon_property.type` — 23 전함 주포,
 * 16 어뢰) and is NOT the 장전 stat; `slotDamageRatio` is a damageRatioBullet
 * riding a single EQUIP SLOT (1-based, the game's own `index`). Both carry their
 * own attr names, so neither can reach `BATTLE_ATTR_TO_STAT` or `sumDamageBuffs`.
 *
 * `airAssist` reload mods are emitted by the pipeline but deliberately not read
 * here: no allowlisted skill has one, and the carrier cycle is owned by the
 * air-assist x2.2 average, which would need its own multiply.
 *
 * @returns {{reloadByWeaponType: Object<number, number>, damageBySlot: Object<number, number>}}
 */
export function sumWeaponModifiers(buffs) {
    const reloadByWeaponType = {};
    const damageBySlot = {};
    for (const b of buffs || []) {
        if (!PERMANENT_WEAPON_MOD_SKILLS.has(b.skill)) continue;
        if (b.attr === 'weaponReloadRatio') {
            if (typeof b.wtype !== 'number') continue;      // 'airAssist' — see above
            reloadByWeaponType[b.wtype] = (reloadByWeaponType[b.wtype] || 0) + b.value;
        } else if (b.attr === 'slotDamageRatio') {
            for (const slot of b.slots || []) {
                damageBySlot[slot] = (damageBySlot[slot] || 0) + b.value;
            }
        }
    }
    return { reloadByWeaponType, damageBySlot };
}

/** Damage multipliers that apply to every shot alike, → their output key. */
const FLAT_DAMAGE_KEY = {
    damageRatioBullet: 'bullet',
    damageRatioByCannon: 'cannon',
    damageRatioByAir: 'air',
    damageRatioByBulletTorpedo: 'torpedo',
};

/**
 * Damage multipliers whose attr name carries its own INDEX, → the bucket they
 * collect into. Each is keyed on something the engine only knows at damage time —
 * the target's armor class, the target's label tags, the bullet's ammo type — so
 * they cannot collapse to a single number the way the flat ones do. WSL
 * `fleet_sim_skill_process.py` emits the attr name verbatim; the suffix IS the key.
 */
const INDEXED_DAMAGE_BUCKET = [
    ['damageToArmorRateEnhance_', 'byArmor'],   // 대갑 타상 계수 — 1 경장 / 2 중형 / 3 중장
    ['damageRatioByAmmoType_', 'byAmmo'],       // 탄약 종류 피해 — bullet.ammo_type
    ['DMG_TAG_EHC_', 'byTag'],                  // 특수 종류 피해 — `T_<함종>` / `N_<진영>`
];

/**
 * Damage-multiplier totals from resolved passive buffs, as fractions.
 *
 * These are NOT ship stats: battleformulas.lua applies `damageRatioBullet` as a flat
 * `× (1 + n)` on the finished damage (:156) and the by-attribute ones inside the
 * weapon-type term (:124-128), so they must never be summed into 화력/항공.
 *
 * `src` marks a clause projected by a shared aura buff (BattleBuffField). Those do
 * NOT stack — 공습 선도's own text says 「동일 스킬 효과는 중첩되지 않음」 — so two
 * carriers granting it contribute the larger, not the sum.
 *
 * @returns {{bullet:number, cannon:number, air:number, torpedo:number,
 *            byArmor:object, byAmmo:object, byTag:object}}
 */
export function sumDamageBuffs(buffs) {
    const out = { bullet: 0, cannon: 0, air: 0, torpedo: 0, byArmor: {}, byAmmo: {}, byTag: {} };
    const bySrc = new Map();        // `${src}:${attr}` → largest value seen
    const land = (attr, value) => {
        const flat = FLAT_DAMAGE_KEY[attr];
        if (flat) { out[flat] += value; return; }
        for (const [prefix, bucket] of INDEXED_DAMAGE_BUCKET) {
            if (!attr.startsWith(prefix)) continue;
            const key = attr.slice(prefix.length);
            out[bucket][key] = (out[bucket][key] || 0) + value;
            return;
        }
    };
    const known = (attr) => !!FLAT_DAMAGE_KEY[attr]
        || INDEXED_DAMAGE_BUCKET.some(([prefix]) => attr.startsWith(prefix));
    for (const b of buffs || []) {
        if (!b.attr || !known(b.attr)) continue;
        const value = b.value || 0;
        if (b.src == null) { land(b.attr, value); continue; }
        const k = `${b.src}:${b.attr}`;
        if (!(bySrc.get(k) >= value)) bySrc.set(k, value);
    }
    for (const [k, v] of bySrc) land(k.slice(k.indexOf(':') + 1), v);
    return out;
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
 * Resolve a ship's per-slot firing mount / plane count for its LB tier, using
 * the same selection as base/growth. Returns [slot1, slot2, slot3] or null.
 *
 * `mounts` is the field to read: it multiplies bullets-per-wave. `base_list` is
 * the per-slot weapon-UNIT count, which is the same number for an auto weapon
 * but NOT for a 전함 주포 — there `setWeapon`'s units go into `_chargeList` and
 * `ManualWeaponQueue` reloads only `parallel_max[0]` of them at a time, so
 * base_list is the charge-stack cap (주포 장전 상한) and never multiplies
 * bullets. WSL `ship_info_process.py build_mounts` resolves the real 포좌 from
 * the `ship_data_breakout` ladder; the fallback keeps older cached ship data
 * working (and callers still default to ×1 when both are absent).
 */
export function getShipBaseList(ship, useRetrofit) {
    return _getStatsForLB(ship, 'mounts', useRetrofit)
        ?? _getStatsForLB(ship, 'base_list', useRetrofit);
}

/**
 * Get SP weapon stat bonuses for a ship slot. Every SP weapon — generic or
 * 전용 — is slot state now, so there is one path and no ship-data fallback.
 */
function _getSPWeaponStatBonuses(slotConfig) {
    const bonuses = {};

    // Stored level is the visible enhance value (+0..+10); data levels are
    // indexed from base, and an oversized stored level clamps into the list.
    const spConfig = slotConfig.spWeapon;
    if (!spConfig || !spConfig.id) return bonuses;

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
 * @param {object} [weaponMods] - sumWeaponModifiers() result; scales a weapon class's
 *   own reload_max BEFORE the stat formula (the 항공 row's `airAssist` mods are not
 *   consumed — see sumWeaponModifiers).
 * @returns {Array<{label: string, seconds: number}>}
 */
function _calculateReloads(ship, slotConfig, reloadStat, weaponMods = null) {
    const equips = slotConfig.equips || [];
    // Honor retrofit form — BBV/DDG/CA retrofits change the ship type, which flips
    // the slot label set (and, on 이세/휴가, adds the aviation slot outright).
    const useRetrofit = slotConfig.retrofit !== false && !!ship.retrofit;
    const shipType = getEffectiveShipType(ship, useRetrofit);
    // No entry for CV/CVL/SS-carrier hulls on purpose — their slot mix varies per
    // ship, so the label comes from the ship's own allowed equip types instead of
    // a bare 슬롯N (which is what a carrier's rows used to read).
    const labels = SLOT_LABELS[shipType] || [];
    const baseList = getShipBaseList(ship, useRetrofit) || [];

    // One row per slot, EXCEPT that every strike-aircraft slot collapses into the
    // single 항공 지원 row they share. A 항전 has both kinds at once, so this can't
    // be a carrier-or-not fork on the hull (see STRIKE_AIRCRAFT_TYPE).
    const rows = [];              // { slot, label, seconds } — sorted back into slot order below
    const hiveReloads = [];       // one entry per hive unit — base_list weighting, see below
    let airSlot = -1;

    for (let i = 0; i < 3; i++) {
        const launchers = _slotLaunchers(ship, equips[i], i);
        if (!launchers.length) continue;

        const hives = launchers.filter((w) => w.type === STRIKE_AIRCRAFT_TYPE);
        if (hives.length) {
            // setWeapon instantiates base_list[slot] hives per launcher, and
            // CaclulateAirAssistReloadMax averages over that list — so the mean is
            // weighted by plane count (a 3/3/2 carrier weighs its slots 3:3:2).
            const planes = baseList[i] ?? 1;
            for (const hive of hives) {
                if (hive.reload_max == null) continue;
                for (let n = 0; n < planes; n++) hiveReloads.push(hive.reload_max);
            }
            if (airSlot < 0) airSlot = i;
            continue;
        }

        const weapon = launchers[0];
        const reloadMax = weapon?.reload_max;
        if (reloadMax == null) continue;
        const mod = weaponMods ? (weaponMods.reloadByWeaponType[weapon.type] || 0) : 0;
        rows.push({
            slot: i,
            label: labels[i] || getSlotName(ship, i, useRetrofit),
            seconds: _reloadFormula(reloadMax * (1 + mod), reloadStat),
        });
    }

    if (hiveReloads.length) {
        const avg = hiveReloads.reduce((sum, v) => sum + v, 0) / hiveReloads.length;
        rows.push({
            slot: airSlot,
            label: '항공',
            seconds: _reloadFormula(avg * AIR_ASSIST_RELOAD_RATIO, reloadStat),
        });
    }

    return rows.sort((a, b) => a.slot - b.slot).map(({ label, seconds }) => ({ label, seconds }));
}

/**
 * The launchers a slot actually fires, INCLUDING the default equipment an empty
 * slot falls back to.
 *
 * An empty slot is not an idle slot: battleplayerunit.lua setWeapon's else-branch
 * arms `default_equip_list[slot]` instead, and ship.lua getAircraftReloadCD folds
 * that same default into the dock's 항공 CD. Skipping it made a half-equipped
 * carrier read far too fast — the defaults are slow (fighter 1800 / 뇌격기 3114 /
 * 폭격기 3600 against a T3 plane's ~1639–2190), so 엔터프라이즈 with one plane
 * equipped showed 22.3s where the game shows 37.2s.
 *
 * `default_equip_list` entries are WEAPON ids on the battle path (setWeapon hands
 * them straight to CreateWeaponUnit), so they resolve through weapon_property
 * directly and never through an equip's level table. The field is absent from
 * older `ship_info_data.json` builds — then an empty slot stays empty, i.e. the
 * previous behaviour, rather than guessing.
 */
function _slotLaunchers(ship, equipConfig, slotIndex) {
    if (equipConfig && equipConfig.id) return _slotWeapons(equipConfig.id, equipConfig.level);

    const defaultId = (ship.default_equip_list || [])[slotIndex];
    if (!defaultId) return [];
    const weapon = mergeWeaponWithBase(getWeaponProperty(defaultId), getWeaponProperty);
    return weapon ? [weapon] : [];
}

/**
 * Launcher weapon_property entries for an equipment at a given enhance level, in
 * weapon_id order. An aircraft equip carries several (a STRIKE and an INTERCEPT
 * variant of the same plane), and the caller needs the whole list to tell an
 * air-assist slot from an ordinary one.
 *
 * MERGED WITH THE BASE, not raw: a levelled entry carries only {base,id,reload_max},
 * so `type` lives on the template. Reading it raw makes every aircraft slot look
 * like an ordinary weapon — the exact shape of the 항전 bug.
 * @param {number|string} equipId - Equipment base ID
 * @param {number} enhanceLevel - visible enhance level (+0..+13 typically)
 */
function _slotWeapons(equipId, enhanceLevel) {
    const equipFull = getEquipFullById(equipId);
    if (!equipFull || !equipFull.levels) return [];

    // Data levels include base as index 0, so visible +13 maps to index 13.
    const levelIdx = Math.max(0, enhanceLevel || 0);
    const levelData = equipFull.levels[Math.min(levelIdx, equipFull.levels.length - 1)];
    if (!levelData) return [];

    // weapon_id can be null, empty array, a number, or an array of numbers
    const wid = levelData.weapon_id;
    if (!wid) return [];
    const ids = Array.isArray(wid) ? wid : [wid];
    return ids
        .map((id) => mergeWeaponWithBase(getWeaponProperty(id), getWeaponProperty))
        .filter(Boolean);
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
