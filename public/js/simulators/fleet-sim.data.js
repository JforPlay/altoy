/**
 * Fleet Build Simulator — Data Loading Module
 * Loads all data sources and provides lookup helpers.
 * Follows the equip viewer pattern: setup(stateRef) receives shared state,
 * then loadAllData() populates it with data and lookup indexes.
 */

import { fetchJSON, fetchJSONWithCache, DATA_FOR_TOY_BASE } from '../utils.js';
import { buildTierMaps } from '../equip/equip-code.js';

// State reference (set via setup)
let state;

// ===== Lookup Maps =====
// Built during loadAllData() for fast access
let shipByGid = {};
let equipById = {};

// ===== Setup =====

export function setup(stateRef) {
    state = stateRef;
}

// ===== Data Loading =====

/**
 * Load all data in two phases:
 * Phase 1 (blocking): Ship data, equip lite, mapping files → build lookup indexes
 * Phase 2 (blocking): Equip full, weapon property, passive skills, fleet tech, ship group
 * Both phases must complete before returning.
 */
export async function loadAllData() {
    // Phase 1: Core data + mappings (parallel)
    const [shipData, equipLiteData, shipTypeData, nationalityData, attrTypeData, equipTypeData] = await Promise.all([
        fetchJSONWithCache('data/ship_info_data.json', { maxAge: 86400000 }),
        fetchJSON('data/equip/equip_data_lite.json'),
        fetchJSON('data/mapping/ship_type_mapping.json'),
        fetchJSON('data/mapping/nationality_mapping.json'),
        fetchJSON('data/mapping/attr_type_mapping.json'),
        fetchJSON('data/mapping/equip_data_by_type.json'),
    ]);

    state.shipData = shipData;
    state.equipLiteData = equipLiteData;
    state.shipTypeData = shipTypeData;
    state.nationalityData = nationalityData;
    state.attrTypeData = attrTypeData;
    state.equipTypeData = equipTypeData;

    // Build lookup indexes
    _buildShipIndex(shipData);
    _buildEquipIndex(equipLiteData);

    // Phase 2: Extended data (parallel, all cached — non-fatal failures)
    const [equipFullData, weaponPropertyData, passiveSkillData, fleetTechData, shipGroupData, spWeaponData,
           barrageData, bulletData, aircraftData, metaBossData] = await Promise.all([
        _loadCached('data/equip/equip_data_full.json'),
        _loadCached('data/sim/weapon_property.json'),
        _loadCached('data/sim/fleet_sim_passive_skills.json'),
        _loadCached('data/shipgirl/fleet_tech_template.json'),
        _loadCached('data/ship_group_data.json'),
        _loadCached('data/sim/spweapon_data.json'),
        _loadCached('data/sim/barrage_template.json'),
        _loadCached('data/sim/bullet_template.json'),
        _loadCached('data/sim/aircraft_template.json'),
        _loadCached('data/meta_bosses.json'),
    ]);

    state.equipFullData = equipFullData;
    state.weaponPropertyData = weaponPropertyData;
    state.passiveSkillData = passiveSkillData;
    state.fleetTechData = fleetTechData;
    state.shipGroupData = shipGroupData;
    state.spWeaponData = spWeaponData;
    state.barrageData = barrageData;
    state.bulletData = bulletData;
    state.aircraftData = aircraftData;
    state.metaBossData = metaBossData;

    // Build SP weapon lookup indexes
    _buildSPWeaponIndex(spWeaponData);

    // Build equip ship_type_forbidden lookup from equip_data_template
    // Each equip level entry may have ship_type_forbidden; use the base (first) level's data
    _buildEquipForbiddenIndex(equipFullData);
}

// ===== Internal Helpers =====

/**
 * Fetch JSON with IndexedDB caching (24h). Returns null on failure.
 */
async function _loadCached(url) {
    try {
        return await fetchJSONWithCache(url, { maxAge: 86400000 });
    } catch (error) {
        console.warn(`Failed to load ${url}:`, error);
        return null;
    }
}

/**
 * Build ship lookup by group ID (gid).
 * ship_info_data.json is an array — index by gid for O(1) access.
 */
function _buildShipIndex(shipData) {
    shipByGid = {};
    if (!Array.isArray(shipData)) return;
    for (const ship of shipData) {
        if (ship.gid != null) {
            shipByGid[ship.gid] = ship;
        }
    }
}

/**
 * Build equip lookup by ID.
 * equip_data_lite.json is an array — index by id for O(1) access.
 */
function _buildEquipIndex(equipLiteData) {
    equipById = {};
    if (!Array.isArray(equipLiteData)) return;
    for (const equip of equipLiteData) {
        if (equip.id != null) {
            equipById[equip.id] = equip;
        }
    }
}

/**
 * Build equip ship_type_forbidden lookup.
 * Extracts from levels[0].ship_type_forbidden in equip_data_full.json.
 */
let equipForbiddenMap = {};

function _buildEquipForbiddenIndex(equipFullData) {
    equipForbiddenMap = {};
    if (!equipFullData) return;
    for (const [id, equip] of Object.entries(equipFullData)) {
        if (!equip.levels || !equip.levels.length) continue;
        const forbidden = equip.levels[0].ship_type_forbidden;
        if (forbidden && forbidden.length > 0) {
            equipForbiddenMap[id] = new Set(forbidden);
        }
    }
}

// ===== Lookup Functions =====

/** Get ship by group ID */
export function getShipByGid(gid) {
    return shipByGid[gid] || null;
}

/** Get equip lite data by ID */
export function getEquipById(id) {
    return equipById[id] || null;
}

/** Get equip full data by ID (keyed by string ID in equip_data_full.json) */
export function getEquipFullById(id) {
    if (!state.equipFullData) return null;
    return state.equipFullData[String(id)] || null;
}

/** Get weapon property by weapon ID */
export function getWeaponProperty(weaponId) {
    if (!state.weaponPropertyData) return null;
    return state.weaponPropertyData[String(weaponId)] || null;
}

/** Get barrage template by ID (keyed by string ID). */
export function getBarrage(barrageId) {
    if (!state.barrageData) return null;
    return state.barrageData[String(barrageId)] || null;
}

/** Get bullet template by ID. */
export function getBullet(bulletId) {
    if (!state.bulletData) return null;
    return state.bulletData[String(bulletId)] || null;
}

/** Get aircraft template by weapon ID. */
export function getAircraftTemplate(weaponId) {
    if (!state.aircraftData) return null;
    return state.aircraftData[String(weaponId)] || null;
}

/** Get a META boss record by boss id (meta_id). */
export function getMetaBoss(bossId) {
    if (!state.metaBossData) return null;
    return state.metaBossData[String(bossId)] || null;
}

/** Get all META boss records as an array (empty if the data is absent). */
export function getAllMetaBosses() {
    if (!state.metaBossData) return [];
    return Object.values(state.metaBossData);
}

/** Get passive skill by skill ID */
export function getPassiveSkill(skillId) {
    if (!state.passiveSkillData) return null;
    return state.passiveSkillData[String(skillId)] || null;
}

// ===== URL Helpers =====

const EQUIP_ICON_BASE = `${DATA_FOR_TOY_BASE}/equips`;
const EQUIP_FRAME_BASE = `${DATA_FOR_TOY_BASE}/weaponframes`;
const SHIP_SKIN_BASE = `${DATA_FOR_TOY_BASE}/skin_icon`;
const SP_WEAPON_ICON_BASE = `${DATA_FOR_TOY_BASE}/spweapon`;

/** Get equip icon URL from icon ID */
export function getEquipIconUrl(iconId) {
    if (!iconId || iconId === '1') return '';
    return `${EQUIP_ICON_BASE}/${iconId}.webp`;
}

/** Get rarity background URL for equip icon (rarity 1-6 → bg0-bg5) */
export function getRarityBgUrl(rarity) {
    return `${EQUIP_FRAME_BASE}/bg${(rarity || 1) - 1}.webp`;
}

/** Get ship portrait URL from skin ID */
export function getShipPortraitUrl(skinId) {
    if (!skinId) return '';
    return `${SHIP_SKIN_BASE}/${skinId}.webp`;
}

/** Get SP weapon icon URL */
export function getSPWeaponIconUrl(iconId) {
    if (!iconId) return '';
    return `${SP_WEAPON_ICON_BASE}/${iconId}.webp`;
}

// ===== Filter Functions =====

/**
 * Filter ships by position (전열/후열/잠수).
 * Uses shipTypeData to map ship type → position.
 */
export function getShipsByPosition(position) {
    if (!state.shipData || !state.shipTypeData) return [];

    // Build set of ship types matching the requested position
    const matchingTypes = new Set();
    for (const [typeId, typeInfo] of Object.entries(state.shipTypeData)) {
        if (typeInfo.position === position) {
            matchingTypes.add(Number(typeId));
        }
    }

    return state.shipData.filter(ship => matchingTypes.has(ship.type));
}

/**
 * Get the equip-type array allowed in a slot, honoring retrofit form when toggled on.
 * Retrofits sometimes alter slot types (e.g., 후소 BBV gains aircraft, 안샨 DDG gains
 * missile); the retrofit override lives at ship.retrofit.equip_X. Falls back to the
 * base ship's equip_X when the retrofit form has no override or the toggle is off.
 */
export function getSlotAllowedTypes(ship, equipIndex, isRetrofit) {
    if (!ship) return [];
    const slotKey = `equip_${equipIndex + 1}`;
    if (isRetrofit && ship.retrofit && Array.isArray(ship.retrofit[slotKey])) {
        return ship.retrofit[slotKey];
    }
    return ship[slotKey] || [];
}

/**
 * Get the ship's effective type. Returns ship.retrofit.type when retrofit toggle is on
 * AND the retrofit form has a different type (e.g., type 5 BB → type 10 BBV after retrofit).
 */
export function getEffectiveShipType(ship, isRetrofit) {
    if (!ship) return null;
    if (isRetrofit && ship.retrofit && ship.retrofit.type != null) {
        return ship.retrofit.type;
    }
    return ship.type;
}

/**
 * Get the slot name for a ship's equip slot.
 * For single-type slots, uses type_name2 for precise names like "함포(구축)".
 * For multi-type slots, joins type_name values with "/" (deduped).
 * Falls back to "슬롯 N".
 */
export function getSlotName(ship, equipIndex, isRetrofit) {
    if (!state.equipTypeData || !ship) return `슬롯 ${equipIndex + 1}`;
    const allowedTypes = getSlotAllowedTypes(ship, equipIndex, isRetrofit);
    if (!allowedTypes.length) return `슬롯 ${equipIndex + 1}`;

    if (allowedTypes.length === 1) {
        const typeInfo = state.equipTypeData[String(allowedTypes[0])];
        return typeInfo?.type_name2 || typeInfo?.type_name || `슬롯 ${equipIndex + 1}`;
    }

    // Multi-type slot: collect unique type_name values
    const names = [];
    const seen = new Set();
    for (const typeId of allowedTypes) {
        const info = state.equipTypeData[String(typeId)];
        const name = info?.type_name || `${typeId}`;
        if (!seen.has(name)) {
            seen.add(name);
            names.push(name);
        }
    }
    return names.join('/');
}

// ===== Enhance Level Caps =====

/** Max enhance level per equipment rarity (game-enforced caps) */
const ENHANCE_CAP = { 2: 3, 3: 6, 4: 11, 5: 13, 6: 13 };

/**
 * Get the max enhance level for an equipment, capped by rarity.
 * @param {object} equip - Equipment object with rarity and level_count
 * @returns {number} Max enhance level (e.g., 13 for SSR)
 */
export function getMaxEnhanceLevel(equip) {
    if (!equip) return 0;
    const dataMax = (equip.level_count || 1) - 1;
    const rarityCap = ENHANCE_CAP[equip.rarity] ?? 13;
    return Math.min(dataMax, rarityCap);
}

// ===== SP Weapon Lookups =====

let spWeaponById = {};
let spWeaponTypeMap = {};   // spweapon_type → [ship_type_ids]
let shipTypeToSPTypes = {}; // ship_type → [spweapon_type_ids]

/**
 * Build SP weapon lookup maps from spweapon_data.json.
 * Populates spWeaponById, spWeaponTypeMap (spType → shipTypes), and the reverse shipTypeToSPTypes.
 */
function _buildSPWeaponIndex(spWeaponData) {
    spWeaponById = {};
    spWeaponTypeMap = {};
    shipTypeToSPTypes = {};
    if (!spWeaponData) return;

    // Build weapon lookup
    if (spWeaponData.weapons) {
        for (const [id, weapon] of Object.entries(spWeaponData.weapons)) {
            spWeaponById[id] = weapon;
        }
    }

    // Build type map and reverse map
    if (spWeaponData.type_map) {
        spWeaponTypeMap = spWeaponData.type_map;
        for (const [spType, shipTypes] of Object.entries(spWeaponTypeMap)) {
            for (const st of shipTypes) {
                if (!shipTypeToSPTypes[st]) shipTypeToSPTypes[st] = [];
                shipTypeToSPTypes[st].push(Number(spType));
            }
        }
    }
}

/** Get SP weapon data by ID */
export function getSPWeaponById(id) {
    return spWeaponById[String(id)] || null;
}

/** Get the dedicated (unique) SP weapon for a ship gid */
export function getDedicatedSPWeapon(gid) {
    for (const [id, weapon] of Object.entries(spWeaponById)) {
        if (weapon.unique === gid) return { id, ...weapon };
    }
    return null;
}

/**
 * Get generic SP weapons available for a ship type.
 * Returns weapons where unique === 0 and type matches the ship type.
 */
export function getGenericSPWeapons(shipType) {
    const spTypes = shipTypeToSPTypes[shipType];
    if (!spTypes || spTypes.length === 0) return [];

    const spTypeSet = new Set(spTypes);
    return Object.entries(spWeaponById)
        .filter(([, w]) => w.unique === 0 && spTypeSet.has(w.type))
        .map(([id, w]) => ({ id, ...w }));
}

// ===== Equip Code Tier Maps =====

let equipCodeMaps = null;

/**
 * Lazy tier-id maps for the 장비 코드 codec. Built once from loaded data;
 * null until loadAllData has populated equipFullData/spWeaponData (both are
 * non-fatal loads — callers must handle null).
 */
export function getEquipCodeMaps() {
    if (!equipCodeMaps && state.equipFullData && state.spWeaponData) {
        equipCodeMaps = buildTierMaps(state.equipFullData, state.spWeaponData.weapons);
    }
    return equipCodeMaps;
}

/**
 * Filter equips by allowed type array and ship type restriction.
 * allowedTypes: array of equip type numbers (e.g., [1, 2, 10]).
 * shipType: the ship's type ID — used to exclude equips with ship_type_forbidden.
 * Returns equip lite entries whose type is allowed AND not forbidden for this ship type.
 */
export function getEquipsByAllowedTypes(allowedTypes, shipType) {
    if (!state.equipLiteData || !Array.isArray(allowedTypes) || allowedTypes.length === 0) return [];

    const typeSet = new Set(allowedTypes);
    return state.equipLiteData.filter(equip => {
        if (!typeSet.has(equip.type)) return false;
        // Check ship_type_forbidden
        if (shipType != null) {
            const forbidden = equipForbiddenMap[String(equip.id)];
            if (forbidden && forbidden.has(shipType)) return false;
        }
        return true;
    });
}
