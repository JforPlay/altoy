/**
 * Fleet-sim damage adapter. Resolves equipped weapons into engine
 * WeaponDescriptors and bridges fleet-sim state → the page-agnostic
 * damage engine (public/js/engine/damage/). The exported pure helpers
 * (barrageBulletCount, attackAttributeKey, resolveWeaponDescriptor) take
 * data/lookups as params so they're unit-testable without the DOM.
 *
 * AIRCRAFT NOTE: aircraft_template.weapon_ID entries are *sparse* weapon
 * records {base, damage, id, reload_max}. The base field points to the full
 * weapon_property entry that holds attack_attribute, barrage_ID, bullet_ID,
 * corrected, and attack_attribute_ratio. The adapter merges the two: sparse
 * overrides damage + reload_max; base supplies everything else.
 * Each aircraft_template id = one plane instance; bulletsPerSalvo for each
 * sub-weapon is multiplied by the number of planes (templates) in the slot.
 *
 * NODE / TESTABILITY NOTE: fleet-sim.data.js and fleet-sim.calc.js transitively
 * import utils.js which registers DOM listeners at module load. The stateful
 * resolution functions in this file access those modules lazily (after being
 * called in a browser context). The pure helpers below are safe to import in
 * Node unit tests because they only depend on engine/damage/constants.js.
 */
import { ATTR_TO_KEY } from '../engine/damage/constants.js';
import { weaponSalvoDuration } from '../engine/damage/salvo-timing.js';

// ===== Pure helpers (unit-testable, take data/lookups as params) =====

/** attack_attribute number → engine key, or null for anti-air(3)/anti-sub(5). */
export function attackAttributeKey(attackAttribute) {
    return ATTR_TO_KEY[attackAttribute] ?? null;
}

/** Total bullets per activation: Σ over barrage_ID of (primal+1)×(senior+1). */
export function barrageBulletCount(barrageIds, getBarrage) {
    if (!Array.isArray(barrageIds)) return 0;
    let total = 0;
    for (const id of barrageIds) {
        const b = getBarrage(id);
        if (!b) continue;
        total += ((b.primal_repeat || 0) + 1) * ((b.senior_repeat || 0) + 1);
    }
    return total;
}

/** attack attribute key → stat key in ship stats object */
const ATTR_KEY_TO_STAT = { cannon: 'firepower', torpedo: 'torpedo', air: 'aviation' };

/**
 * Build a WeaponDescriptor from a weapon_property entry + computed stats.
 * Returns null if the weapon is anti-air/anti-sub or its bullet is missing.
 * @param {object} weapon weapon_property entry (may be sparse; call with merged data)
 * @param {object} stats computed ship stats { firepower, torpedo, aviation, ... }
 * @param {{getBarrage, getBullet, label?, reloadMaxOverride?}} deps
 */
export function resolveWeaponDescriptor(weapon, stats, deps) {
    if (!weapon) return null;
    const attackAttribute = attackAttributeKey(weapon.attack_attribute);
    if (!attackAttribute) return null;

    const bulletId = Array.isArray(weapon.bullet_ID) ? weapon.bullet_ID[0] : weapon.bullet_ID;
    const bullet = deps.getBullet(bulletId);
    if (!bullet) return null;

    // bullets/volley = base_list[slot] (mounts/planes per wave) × barrage expansion.
    const mountCount = deps.mountCount ?? 1;
    const bulletsPerSalvo = barrageBulletCount(weapon.barrage_ID, deps.getBarrage) * mountCount;

    // Surface fire cycle adds the salvo firing time + 발사 후 경직 to the reload (the wiki's gun
    // cycle). Airstrike-overridden descriptors keep 0 — the air-assist ×2.2 already owns that cycle.
    const cycleExtra = deps.reloadMaxOverride != null
        ? 0
        : weaponSalvoDuration(weapon.barrage_ID, deps.getBarrage) + (weapon.auto_aftercast || 0);

    return {
        attackAttribute,
        stat: stats[ATTR_KEY_TO_STAT[attackAttribute]] ?? 0,
        damage: weapon.damage,
        corrected: weapon.corrected,
        ratio: weapon.attack_attribute_ratio,
        potential: deps.potential ?? 1,   // equipment_proficiency (slot efficiency %)
        bulletsPerSalvo,
        damageType: bullet.damage_type,
        ammoType: bullet.ammo_type,
        reloadMax: deps.reloadMaxOverride ?? weapon.reload_max,
        cycleExtra,
        initialDelay: 0,
        label: deps.label || '무기',
    };
}

/**
 * Resolve a (possibly sparse) weapon entry to a full one by following its
 * `base` chain. Leveled entries carry only {base, damage, id, reload_max,
 * [corrected]}; the base template holds attack_attribute, attack_attribute_ratio,
 * barrage_ID, bullet_ID, etc. Leaf fields win, so per-level damage / reload_max /
 * corrected override the template. Recursive — some bases are themselves sparse
 * (1,428 such chains in the data) — and depth-guarded against cycles.
 *
 * EVERY equip-resolved weapon in the data is sparse (0 of 664 are full), so this
 * merge is mandatory for the surface path, not just aircraft.
 * @param {object} weapon weapon_property entry (sparse or full)
 * @param {(id:(number|string))=>(object|null)} getWeapon base-id lookup
 * @param {number} [depth] recursion guard
 * @returns {object|null} merged full weapon (or the input if unresolvable)
 */
export function mergeWeaponWithBase(weapon, getWeapon, depth = 0) {
    if (!weapon || weapon.base == null || depth > 10) return weapon;
    const base = getWeapon(weapon.base);
    if (!base) return weapon;
    const resolvedBase = mergeWeaponWithBase(base, getWeapon, depth + 1);
    return { ...resolvedBase, ...weapon };   // leaf fields override the base
}

/**
 * Per-slot equipment efficiency for a fully-built ship: max-LB base (the pipeline
 * sources ship.equipment_proficiency from the MLB sid) plus the retrofit grid's
 * per-slot deltas (retrofit.bonus.equipment_proficiency_N) when the retrofit
 * toggle is on. Retrofit deltas live ONLY in retrofit.bonus (not baked into a
 * form sid), so this adds them without double-counting. Returns [s1,s2,s3]
 * (×1 where data is absent).
 */
export function effectiveProficiency(ship, useRetrofit) {
    const base = ship.equipment_proficiency || [];
    const bonus = (useRetrofit && ship.retrofit && ship.retrofit.bonus) ? ship.retrofit.bonus : null;
    const out = [];
    for (let i = 0; i < 3; i++) {
        let v = base[i] ?? 1;
        if (bonus) v += bonus['equipment_proficiency_' + (i + 1)] || 0;
        out.push(v);
    }
    return out;
}

// ===== Stateful resolution (wired to fleet-sim modules — browser only) =====
//
// These functions import fleet-sim.data.js / fleet-sim.calc.js lazily via
// module-level variables populated on first call. This keeps the pure helpers
// above testable in Node (no DOM) while still allowing the stateful bridge to
// work normally in the browser.
//
// Lazy import handles (populated by _ensureImports() on first stateful call):

let _data = null;     // fleet-sim.data.js module
let _calc = null;     // fleet-sim.calc.js module
let _engine = null;   // engine/damage/index.js module

/** Populate module handles on first stateful call. Returns false if unavailable. */
async function _ensureImports() {
    if (_data && _calc && _engine) return true;
    try {
        [_data, _calc, _engine] = await Promise.all([
            import('./fleet-sim.data.js'),
            import('./fleet-sim.calc.js'),
            import('../engine/damage/index.js'),
        ]);
        return true;
    } catch {
        return false;
    }
}

const CARRIER_TYPES = new Set([6, 7]);

/**
 * Slot weapon labels per ship type — anti-air (대공) slots are skipped for boss DPS.
 * Mirrors SLOT_LABELS in fleet-sim.calc.js.
 */
const SLOT_LABELS = {
    1:  ['주포', '어뢰', '대공'],
    2:  ['주포', '어뢰', '대공'],
    3:  ['주포', '부포', '대공'],
    4:  ['주포', '부포', '대공'],
    5:  ['주포', '부포', '대공'],
    8:  ['어뢰', '어뢰', '주포'],
    10: ['주포', '항공', '대공'],
    20: ['주포', '어뢰', '대공'],
    21: ['주포', '어뢰', '대공'],
};

/**
 * Get the first weapon_id at a given enhance level from an equip's levels array.
 */
function _firstWeaponIdForEquip(equipId, enhanceLevel) {
    const full = _data.getEquipFullById(equipId);
    if (!full || !full.levels) return null;
    const idx = Math.min(Math.max(0, enhanceLevel || 0), full.levels.length - 1);
    let wid = full.levels[idx]?.weapon_id;
    if (Array.isArray(wid)) wid = wid[0];
    return wid || null;
}

/**
 * Get all weapon_ids (aircraft template ids) for a carrier equip at a given enhance level.
 * Number of ids = number of planes in the slot.
 */
function _aircraftTemplateIdsForEquip(equipId, enhanceLevel) {
    const full = _data.getEquipFullById(equipId);
    if (!full || !full.levels) return [];
    const idx = Math.min(Math.max(0, enhanceLevel || 0), full.levels.length - 1);
    const wid = full.levels[idx]?.weapon_id;
    return Array.isArray(wid) ? wid : (wid ? [wid] : []);
}

/** Resolve a non-carrier ship's offensive weapons (slots 0–2, skipping 대공). */
function _resolveSurfaceWeapons(slotConfig, shipType, stats, baseList, prof) {
    const labels = SLOT_LABELS[shipType] || ['슬롯1', '슬롯2', '슬롯3'];
    const out = [];
    const equips = slotConfig.equips || [];
    const deps = { getBarrage: _data.getBarrage, getBullet: _data.getBullet };

    for (let i = 0; i < 3; i++) {
        const label = labels[i];
        if (label === '대공') continue;             // anti-air excluded from boss DPS
        const ec = equips[i];
        if (!ec || !ec.id) continue;
        const wid = _firstWeaponIdForEquip(ec.id, ec.level);
        if (!wid) continue;
        const raw = _data.getWeaponProperty(wid);
        if (!raw) continue;
        const weapon = mergeWeaponWithBase(raw, _data.getWeaponProperty);  // equip weapons are sparse
        const d = resolveWeaponDescriptor(weapon, stats, {
            ...deps,
            label,
            mountCount: baseList[i] ?? 1,   // 포좌: gun mounts firing per wave (×1 until base_list lands in data)
            potential: prof[i] ?? 1,        // equipment_proficiency for this slot
        });
        if (d) out.push(d);
    }
    return out;
}

/**
 * Resolve a carrier's airstrike into air WeaponDescriptors.
 *
 * Model (per Lua battleplayerunit.lua): base_list[slot] = the ship's plane count
 * for that slot (scales with limit break). Each plane drops its sub-weapon's
 * barrage, so bulletsPerSalvo = barrage_expansion × base_list[slot]. Sub-weapon
 * entries are sparse and merged with their base (mergeWeaponWithBase) to recover
 * attack_attribute / barrage_ID / bullet_ID. equipment_proficiency feeds potential.
 * All airstrike descriptors share the combined air-assist reloadMax (avg × 2.2).
 *
 * We dedupe sub-weapons by base id WITHIN a slot: base_list is the authoritative
 * plane count, so multiple aircraft_templates carrying the same sub-weapon are one
 * plane group sized by base_list (NOT multiplied per template — avoids a double count).
 *
 * PROVISIONAL: with base_list defaulting to ×1 (until the pipeline emits it) carrier
 * counts are low; the equip-template ↔ base_list relationship still wants an in-browser
 * check vs wiki CV DPS. Surface counts are unaffected.
 */
function _resolveCarrierWeapons(slotConfig, stats, baseList, prof) {
    const equips = slotConfig.equips || [];
    const descriptors = [];
    const reloadMaxes = [];

    for (let i = 0; i < 3; i++) {
        const ec = equips[i];
        if (!ec || !ec.id) continue;
        const mountCount = baseList[i] ?? 1;   // ship plane count for this slot (×1 until base_list in data)
        const potential = prof[i] ?? 1;        // equipment_proficiency for this slot
        const seen = new Set();                // one descriptor per distinct sub-weapon in this slot

        // Airstrike reload = the AIRCRAFT reload (equip's weapon_id[0]), matching
        // fleet-sim _calculateCarrierReload and the card header. The sub-weapon
        // (bomb/strafing) reloads must NOT feed this — strafing-gun reload_max (~9500)
        // would massively inflate the average (the 42.82s-vs-22.18s bug).
        const acReloadWid = _firstWeaponIdForEquip(ec.id, ec.level);
        const acReload = acReloadWid ? _data.getWeaponProperty(acReloadWid)?.reload_max : null;
        if (acReload) reloadMaxes.push(acReload);

        for (const acId of _aircraftTemplateIdsForEquip(ec.id, ec.level)) {
            const ac = _data.getAircraftTemplate(acId);
            if (!ac || !Array.isArray(ac.weapon_ID)) continue;

            for (const sparseId of ac.weapon_ID) {
                const sparse = _data.getWeaponProperty(sparseId);
                if (!sparse) continue;
                const merged = mergeWeaponWithBase(sparse, _data.getWeaponProperty);
                if (!merged || !merged.attack_attribute) continue;

                const baseId = sparse.base || sparseId;
                if (seen.has(baseId)) continue;
                seen.add(baseId);

                const attackAttribute = attackAttributeKey(merged.attack_attribute);
                if (!attackAttribute) continue;
                const bulletId = Array.isArray(merged.bullet_ID) ? merged.bullet_ID[0] : merged.bullet_ID;
                const bullet = _data.getBullet(bulletId);
                if (!bullet) continue;
                const barrageExpansion = barrageBulletCount(merged.barrage_ID, _data.getBarrage);
                if (barrageExpansion === 0) continue;

                descriptors.push({
                    attackAttribute,
                    stat: stats[ATTR_KEY_TO_STAT[attackAttribute]] ?? 0,
                    damage: merged.damage,
                    corrected: merged.corrected,
                    ratio: merged.attack_attribute_ratio,
                    potential,
                    bulletsPerSalvo: barrageExpansion * mountCount,
                    damageType: bullet.damage_type,
                    ammoType: bullet.ammo_type,
                    reloadMax: 0,       // overwritten with combined air-assist reload below
                    initialDelay: 0,
                    label: '항공기',
                });
            }
        }
    }

    const combined = _engine.calculateAirAssistReloadMax(reloadMaxes);
    for (const d of descriptors) d.reloadMax = combined;
    return descriptors;
}

/**
 * Resolve all in-scope weapons for one ship slot config.
 * Must be called from an async context after _ensureImports().
 * @param {object} slotConfig  { gid, level, retrofit, equips: [{id, level}, ...] }
 * @param {object} ship        Ship data object (from getShipByGid)
 * @param {object} stats       Buffed ship stats { firepower, torpedo, aviation, ... }
 * @returns {object[]} WeaponDescriptor[]
 */
export function resolveShipWeapons(slotConfig, ship, stats) {
    if (!_data) return [];   // needs _ensureImports() first — route external callers through simulateFleetDamage
    const useRetrofit = slotConfig.retrofit !== false && !!ship.retrofit;
    const shipType = _data.getEffectiveShipType(ship, useRetrofit);
    const baseList = (_calc.getShipBaseList(ship, useRetrofit)) || [];   // [s1,s2,s3] mount/plane count; ×1 fallback
    const prof = effectiveProficiency(ship, useRetrofit);               // max-LB efficiency + retrofit-toggle deltas
    return CARRIER_TYPES.has(shipType)
        ? _resolveCarrierWeapons(slotConfig, stats, baseList, prof)
        : _resolveSurfaceWeapons(slotConfig, shipType, stats, baseList, prof);
}

/**
 * Build the engine TargetProfile from targetOpts. META kind resolves the boss
 * record from loaded data and defers to makeMetaTarget; anything else (or a
 * missing boss) falls back to the generic armor preset. Must run after _ensureImports().
 */
function _buildTarget(targetOpts) {
    if (targetOpts.kind === 'meta' && targetOpts.bossId != null) {
        const boss = _data.getMetaBoss(targetOpts.bossId);
        if (boss) return _engine.makeMetaTarget(boss, targetOpts.tier ?? null, targetOpts.overrides || {});
        // boss data absent → graceful fallback to a preset
    }
    return _engine.makeTarget(targetOpts.presetKey || 'heavy', targetOpts.overrides || {});
}

/**
 * Compute fleet damage vs a target preset or META boss. Reuses fleet-sim.calc.js for
 * buffed stats (so equips/tech/affinity/passives are already applied).
 *
 * resolvePassiveBuffs(targetShip, allFleetShips) expects SHIP DATA OBJECTS
 * (from getShipByGid), NOT slot configs. Verified from fleet-sim.calc.js:384.
 *
 * @param {Array} ships state.ships (6 slots, each { gid, level, ... } or null)
 * @param {{kind?:string, presetKey?:string, bossId?:number, tier?:number, overrides?:object, window?:number}} targetOpts
 * @returns {Promise<object>} { perShip, total, dps, target, clearCheck }
 */
export async function simulateFleetDamage(ships, targetOpts) {
    if (!await _ensureImports()) throw new Error('fleet-sim.damage: failed to load dependencies');

    const target = _buildTarget(targetOpts);
    const techBonuses = _calc.calculateFleetTechBonuses();
    const present = (ships || []).filter(Boolean);

    const engineShips = [];
    for (const slot of present) {
        const computed = _computeStatsForSlot(slot, present, techBonuses);
        if (!computed) continue;
        const { ship, stats } = computed;
        const weapons = resolveShipWeapons(slot, ship, stats);
        engineShips.push({
            ref: slot.gid,
            profile: {
                accuracy: stats.accuracy,
                luck:     stats.luck,
                level:    slot.level || 125,
                reload:   stats.reload,
            },
            weapons,
        });
    }

    const window = targetOpts.window ?? 90;
    const sim = _engine.simulateFleet(engineShips, target, { window });
    const clearCheck = _engine.computeClearCheck({ fleetDps: sim.dps, bossHp: target.hp, timeLimit: window });
    return { ...sim, target, clearCheck };
}

/**
 * Helper: compute one slot's buffed stats + resolve its ship object.
 * resolvePassiveBuffs expects ship data objects for BOTH args (confirmed from calc.js:384).
 */
function _computeStatsForSlot(slot, allPresent, techBonuses) {
    const ship = _data.getShipByGid(slot.gid);
    if (!ship) return null;

    // resolvePassiveBuffs(targetShip, allFleetShips) — both args are ship data objects
    const allShipObjects = allPresent.map((s) => _data.getShipByGid(s.gid)).filter(Boolean);
    const passiveBuffs = _calc.resolvePassiveBuffs(ship, allShipObjects);

    const res = _calc.calculateShipStats(slot, techBonuses, passiveBuffs);
    if (!res) return null;
    return { ship, stats: res.stats };
}
