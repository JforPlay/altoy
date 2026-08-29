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
import { barrageActivations } from '../engine/damage/barrage.js';
import { defaultWindow } from './fleet-sim.saves.js';
import { weaponCycleInterval } from '../engine/damage/reload.js';
import { countSalvos } from '../engine/damage/timeline.js';

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

    // Does the weapon open the battle reloading? battleweaponunit.lua InitialCD is a
    // no-op unless `initial_over_heat == 1`, and the flag splits the roster cleanly:
    // every 전함 주포 / 어뢰 / 미사일 carries it, no 부포 or 구축·경순·중순 주포 does.
    // So a destroyer opens fire at t=0 and a battleship's first salvo is one reload in.
    const startsOnCooldown = weapon.initial_over_heat === 1;
    // Mounts flagged SetModifyInitialCD skip that opening cooldown — but only for the
    // manual/charge classes, and never more of them than the slot actually has.
    const preloaded = PRELOADABLE_TYPES.has(weapon.type) ? (deps.preloadCount || 0) : 0;
    const preloadShare = mountCount > 0 ? Math.min(preloaded, mountCount) / mountCount : 0;

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
        startsOnCooldown,
        preloadShare,
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

/**
 * Window salvo count grouped by `keyOf(descriptor)`. Derived through
 * weaponCycleInterval so the count is the same one simulateAttacker computes,
 * not a second copy that can drift.
 */
function _salvoCounts(descriptors, reloadStat, window, keyOf) {
    const out = {};
    for (const d of descriptors) {
        if (d.slotIndex == null) continue;
        const interval = weaponCycleInterval(d, reloadStat);
        const k = keyOf(d);
        out[k] = (out[k] || 0) + countSalvos(interval, d.initialDelay ?? 0, window);
    }
    return out;
}

/** Salvos per EQUIP SLOT, keyed 1-based to match the game's own `index` on BattleBuffCount. */
export const salvosBySlot = (descriptors, reloadStat, window) =>
    _salvoCounts(descriptors, reloadStat, window, (d) => d.slotIndex + 1);

/**
 * Salvos per ATTACK ATTRIBUTE — what a trigger that names a weapon class filters
 * on (`t.a`). The class cannot ride a slot index: the torpedo slot moves by hull
 * (구축함 2번, 잠수함 1·2번), while the attribute is the same wherever it sits.
 */
export const salvosByAttr = (descriptors, reloadStat, window) =>
    _salvoCounts(descriptors, reloadStat, window, (d) => d.attackAttribute);

/**
 * Korean cadence text for a trigger. The DATA holds machine keys; Korean lives here.
 * `rant` is part of the cadence, not a footnote: without it 워싱턴 reads `20초마다`
 * beside `발사/90초 = 2.8`, and 90 / 20 does not give 2.8.
 */
export function cadenceLabel(t, p) {
    if (!t) return '';
    let base = '';
    if (t.k === 'count') {
        base = (t.slots && t.slots.length === 1 && t.slots[0] === 1)
            ? `주포 ${t.n}회마다`
            : `${t.n}회 발사마다`;
    } else if (t.k === 'timer') {
        base = (t.d && t.d !== t.n) ? `${t.d}초 후 ${t.n}초마다` : `${t.n}초마다`;
    } else if (t.k === 'fire') {
        base = t.n ? `발사 시 (재사용 ${t.n}초)` : '발사 시';
    } else if (t.k === 'air') {
        base = '항공 공격 시';
    } else if (t.k === 'once') {
        base = '전투 시작 시';
    } else {
        return '';
    }
    // `p` is basis points (10000 = certain), and it is omitted at 10000.
    return p != null && p < 10000 ? `${base} ${Math.round(p / 10) / 10}%` : base;
}

/**
 * Resolve a ship's barrage skills into WeaponDescriptors carrying a pre-resolved
 * activation count. Every id in `skillIds` is already a `weapon_true` skill — R5's
 * own definition of "barrage" — so ANY skill that produces no descriptor counts as
 * unmodelled: table-absent, unreadable cadence, AND weapons that never resolve alike.
 * The design doc is explicit (§D step 4: "the count of the ship's barrage skills that
 * produced no descriptor"; §A: "Anything outside these kinds is not emitted; the page
 * counts it under D3") — the extractor deliberately emits nothing rather than guess at
 * a rate (submarine / conditional / untraced / no-readable-cadence skills), and that
 * honesty is exactly why the gap must surface here instead of silently vanishing.
 *
 * ZERO ACTIVATIONS IS NOT THE SAME ANSWER and is counted apart (`inactive`). The
 * trigger was read and the loadout simply never fires it: an unequipped ship (every
 * count/fire barrage), any CARRIER (no air descriptor carries a slotIndex, so
 * salvosBySlot is empty), a 대공-slot trigger. Calling those "발동 조건이 아직
 * 구현되지 않은" is wrong — the condition IS implemented, it computed to zero
 * — and it made an
 * empty or carrier card look broken. Both stay visible, which is what D3 asks for.
 *
 * FAILS SAFE if `deps.getBarrageSkill` isn't callable (Task 8's loader landing
 * after this adapter, or a stale cached fleet-sim.damage.js paired with a fresh
 * fleet-sim.data.js behind the network-first service worker): every requested
 * skill counts as unmodelled instead of throwing, which would otherwise blank
 * the whole damage panel (resolveShipWeapons -> simulateFleetDamage -> the
 * panel's catch clears container.innerHTML for the entire fleet).
 */
export function resolveBarrageDescriptors(skillIds, deps) {
    if (typeof deps.getBarrageSkill !== 'function') {
        return { descriptors: [], unmodeled: (skillIds || []).length, inactive: 0 };
    }
    const descriptors = [];
    let unmodeled = 0;
    let inactive = 0;
    for (const sid of skillIds || []) {
        const rec = deps.getBarrageSkill(String(sid));
        if (!rec) { unmodeled++; continue; }
        const cadence = cadenceLabel(rec.t, rec.p);
        if (!cadence) { unmodeled++; continue; }        // unknown trigger kind
        const n = barrageActivations(rec, deps.ctx);
        if (!(n > 0)) { inactive++; continue; }         // read fine, this loadout never fires it
        let produced = false;
        for (const wid of rec.w || []) {
            const raw = deps.getWeapon(wid);
            if (!raw) continue;
            const weapon = mergeWeaponWithBase(raw, deps.getWeapon);
            const d = resolveWeaponDescriptor(weapon, deps.stats, {
                getBarrage: deps.getBarrage,
                getBullet: deps.getBullet,
                label: `탄막 · ${rec.n}`,
                mountCount: 1,      // the barrage expansion IS the bullet count
                potential: 1,       // not equipment — no slot proficiency
                reloadMaxOverride: 0,
            });
            if (!d) continue;
            d.activations = n;
            d.activationWindow = deps.ctx?.window ?? 0;   // the count is FOR this window
            d.cadence = cadence;
            descriptors.push(d);
            produced = true;
        }
        if (!produced) unmodeled++;   // every weapon id in rec.w failed to resolve
    }
    return { descriptors, unmodeled, inactive };
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

/**
 * weapon_property.type for an aircraft launcher whose planes feed the ship's
 * 항공 지원 (air assist). battleconst.lua EquipmentType.STRIKE_AIRCRAFT = 10.
 *
 * THE HIVE IS A PROPERTY OF THE EQUIPPED WEAPON, NEVER OF THE HULL. Keying it on
 * "is the ship a CV/CVL" silently dropped every 항전/BBV aviation slot (키어사지,
 * 이세·휴가 retrofit) and 할포드's: their launcher went down the surface path,
 * where an airstrike launcher's `bullet_ID` is empty — its "bullets" are AIRCRAFT
 * ids — so resolveWeaponDescriptor returned null and the slot did no damage at
 * all. battleplayerunit.lua AddWeapon (:245) files a weapon into `_hiveList` on
 * `type == STRIKE_AIRCRAFT` and on nothing else; the hull type never enters.
 * INTERCEPT_AIRCRAFT (11, 수상기) is deliberately excluded — for a PLAYER unit it
 * falls through to AddAutoWeapon and is not part of the strike (BattleUnit's own
 * setWeapon pools both, but that path serves enemies).
 */
const STRIKE_AIRCRAFT_TYPE = 10;

/**
 * A plane's strafing autocannon (EquipmentType.ANTI_AIR). CreateWeaponUnit maps it
 * to BattleAntiAirUnit, which only ever shoots aircraft, so it cannot contribute
 * boss DPS — excluded exactly as the equip viewer's 이론 DPS does
 * (equip.data.js AIRCRAFT_GUN_WEAPON_TYPE, validated against the AL wiki).
 */
const AIRCRAFT_GUN_TYPE = 4;

/**
 * Weapon types whose instances can be PRELOADED past the opening cooldown.
 * battleplayerunit.lua setWeapon calls SetModifyInitialCD on the first
 * `preload_count[slot]` instances, but only for these classes — the manual /
 * charge queues (전함 주포, 어뢰, 미사일). A 부포 is never preloaded because it
 * never starts on cooldown in the first place.
 */
const PRELOADABLE_TYPES = new Set([
    16,  // MANUAL_TORPEDO — the 구축/경순 어뢰 slot
    23,  // POINT_HIT_AND_LOCK — 전함 주포
    27,  // DISPOSABLE_TORPEDO
    31,  // MANUAL_MISSILE
    33,  // MANUAL_METEOR
]);

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
 * Merged launcher weapon_property entries for an equip at an enhance level, in
 * weapon_id order. An equip can carry several — a fighter ships a STRIKE and an
 * INTERCEPT variant of itself — and every entry is sparse, hence the base merge.
 */
function _launchersForEquip(equipId, enhanceLevel) {
    const full = _data.getEquipFullById(equipId);
    if (!full || !full.levels) return [];
    const idx = Math.min(Math.max(0, enhanceLevel || 0), full.levels.length - 1);
    const wid = full.levels[idx]?.weapon_id;
    const ids = Array.isArray(wid) ? wid : (wid != null ? [wid] : []);
    const out = [];
    for (const id of ids) {
        const raw = _data.getWeaponProperty(id);
        if (raw) out.push(mergeWeaponWithBase(raw, _data.getWeaponProperty));
    }
    return out;
}

/** The single launcher an empty slot's default equipment arms, if the data has one. */
function _defaultLauncher(defaultId) {
    if (!defaultId) return [];
    const raw = _data.getWeaponProperty(defaultId);
    if (!raw) return [];
    const merged = mergeWeaponWithBase(raw, _data.getWeaponProperty);
    return merged ? [merged] : [];
}

/**
 * Ordnance descriptors for one strike launcher's planes.
 *
 * The launcher id IS the aircraft_template id (battlehiveunit.lua SpwanAircraft
 * hands its own `_tmpData.id` to CreateAircraft), so one hop lands on the plane,
 * whose weapon_ID[] holds the bombs / torpedoes / rockets it drops. Sub-weapons
 * are sparse and merged with their base; strafing guns are dropped (see
 * AIRCRAFT_GUN_TYPE). `reloadMax` is filled in by the caller with the combined
 * air-assist figure — the airstrike's cadence, not each bomb's internal reload.
 */
function _aircraftOrdnance(launcher, stats, mountCount, potential) {
    const ac = mergeWeaponWithBase(_data.getAircraftTemplate(launcher.id), _data.getAircraftTemplate);
    if (!ac || !Array.isArray(ac.weapon_ID)) return [];

    const out = [];
    const seen = new Set();       // one descriptor per distinct sub-weapon
    for (const sparseId of ac.weapon_ID) {
        const sparse = _data.getWeaponProperty(sparseId);
        if (!sparse) continue;
        const baseId = sparse.base || sparseId;
        if (seen.has(baseId)) continue;
        seen.add(baseId);

        const merged = mergeWeaponWithBase(sparse, _data.getWeaponProperty);
        if (!merged || merged.type === AIRCRAFT_GUN_TYPE) continue;

        const attackAttribute = attackAttributeKey(merged.attack_attribute);
        if (!attackAttribute) continue;
        const bulletId = Array.isArray(merged.bullet_ID) ? merged.bullet_ID[0] : merged.bullet_ID;
        const bullet = _data.getBullet(bulletId);
        if (!bullet) continue;
        const barrageExpansion = barrageBulletCount(merged.barrage_ID, _data.getBarrage);
        if (barrageExpansion === 0) continue;

        out.push({
            attackAttribute,
            stat: stats[ATTR_KEY_TO_STAT[attackAttribute]] ?? 0,
            damage: merged.damage,
            corrected: merged.corrected,
            ratio: merged.attack_attribute_ratio,
            potential,
            bulletsPerSalvo: barrageExpansion * mountCount,   // base_list planes each drop the barrage
            damageType: bullet.damage_type,
            ammoType: bullet.ammo_type,
            reloadMax: 0,       // overwritten below with the combined air-assist reload
            initialDelay: 0,
            // The air assist ALWAYS opens on cooldown: BattleAllInStrike.InitialCD calls
            // AddCDTimer(GetReloadTime()) flat, with no initial_over_heat test, and the
            // hives themselves take EnterCoolDown() at CreateWeaponUnit. There is no
            // preload_count path into it, so the first strike is one full cycle in.
            startsOnCooldown: true,
            preloadShare: 0,
            label: '항공기',
        });
    }
    return out;
}

/**
 * Resolve a ship's three equip slots into WeaponDescriptors.
 *
 * Each slot is classified by WHAT IS IN IT, not by the hull: a strike-aircraft
 * launcher joins the ship's air assist, anything else fires on its own reload.
 * Both kinds coexist on one ship (항전 = 주포 + 항공), which is exactly what the
 * old carrier-or-surface fork could not express.
 *
 * The air assist's reload_max is the base_list-WEIGHTED mean of its launchers ×2.2
 * (battleformulas.lua CaclulateAirAssistReloadMax, summed over `_hiveList`):
 * setWeapon instantiates one hive per plane, `base_list[slot]` of them, so a 3/3/2
 * carrier weighs its slots 3:3:2 and a plain mean of three slot values is wrong.
 * Pushing one array entry per hive buys that weighting for free.
 *
 * @returns {{weapons: object[], airReloadMax: number}} airReloadMax is 0 when the
 *   ship has no hive — it also paces `air`-triggered barrages, and it must be
 *   derived from the hives themselves rather than from a produced descriptor
 *   (an ASW plane is a real hive whose ordnance is anti-sub, so it yields none).
 */
function _resolveEquippedWeapons(slotConfig, shipType, stats, baseList, prof, preload, defaults) {
    const labels = SLOT_LABELS[shipType] || ['슬롯1', '슬롯2', '슬롯3'];
    const equips = slotConfig.equips || [];
    const deps = { getBarrage: _data.getBarrage, getBullet: _data.getBullet };
    const surface = [];
    const air = [];
    const hiveReloads = [];       // one entry per hive unit — the ×base_list weighting

    for (let i = 0; i < 3; i++) {
        const ec = equips[i];
        const mountCount = baseList[i] ?? 1;   // 포좌/함재기 수: mounts or planes per wave
        const potential = prof[i] ?? 1;        // equipment_proficiency for this slot
        // An empty slot still fires: setWeapon's else-branch arms
        // default_equip_list[slot] (a WEAPON id on that path, so it resolves
        // straight through weapon_property). Absent field ⇒ slot stays idle.
        const launchers = (ec && ec.id)
            ? _launchersForEquip(ec.id, ec.level)
            : _defaultLauncher(defaults[i]);
        if (!launchers.length) continue;
        const hives = launchers.filter((w) => w.type === STRIKE_AIRCRAFT_TYPE);

        if (hives.length) {
            for (const hive of hives) {
                for (let n = 0; n < mountCount; n++) hiveReloads.push(hive.reload_max);
                air.push(..._aircraftOrdnance(hive, stats, mountCount, potential));
            }
            continue;
        }

        if (labels[i] === '대공') continue;     // anti-air excluded from boss DPS
        const weapon = launchers[0];
        if (!weapon) continue;
        const d = resolveWeaponDescriptor(weapon, stats, {
            ...deps,
            label: labels[i],
            preloadCount: preload[i] ?? 0,  // mounts that skip the opening cooldown
            mountCount,
            potential,
        });
        if (d) {
            d.slotIndex = i;
            surface.push(d);
        }
    }

    const airReloadMax = _engine.calculateAirAssistReloadMax(hiveReloads);
    for (const d of air) d.reloadMax = airReloadMax;
    return { weapons: surface.concat(air), airReloadMax };
}

/**
 * Resolve all in-scope weapons for one ship slot config, PLUS the ship's active
 * barrage skills (each expanded into its own WeaponDescriptor with a pre-resolved
 * `activations` count). Must be called from an async context after _ensureImports().
 * @param {object} slotConfig  { gid, level, retrofit, equips: [{id, level}, ...] }
 * @param {object} ship        Ship data object (from getShipByGid)
 * @param {object} stats       Buffed ship stats { firepower, torpedo, aviation, ... }
 * @param {number} [window]    Battle time window in seconds (barrage activation counts need it)
 * @returns {{weapons: object[], unmodeled: number, inactive: number}} WeaponDescriptor[],
 *   the count of barrage skills that produced no descriptor (unreadable cadence, missing
 *   weapon data), and the count whose trigger read fine but yields zero activations for
 *   this loadout (unequipped ship, carrier, 대공-slot trigger).
 */
export function resolveShipWeapons(slotConfig, ship, stats, window = 90, damageBuffs = null) {
    if (!_data) return { weapons: [], unmodeled: 0, inactive: 0 };   // needs _ensureImports() first — route external callers through simulateFleetDamage
    const useRetrofit = slotConfig.retrofit !== false && !!ship.retrofit;
    const shipType = _data.getEffectiveShipType(ship, useRetrofit);
    const baseList = (_calc.getShipBaseList(ship, useRetrofit)) || [];   // [s1,s2,s3] mount/plane count; ×1 fallback
    const prof = effectiveProficiency(ship, useRetrofit);               // max-LB efficiency + retrofit-toggle deltas
    const preload = ship.preload_count || [];                          // [s1,s2,s3] mounts ready at t=0
    const defaults = ship.default_equip_list || [];                    // empty-slot fallback; absent on older data
    const { weapons, airReloadMax } = _resolveEquippedWeapons(slotConfig, shipType, stats, baseList, prof, preload, defaults);

    // Barrage skills the ship actually has active. Two filters, and BOTH matter.
    const skillIds = activeBarrageSkillIds(ship, useRetrofit, slotConfig.fate !== false);
    const airstrikes = airReloadMax > 0
        ? _engine.countSalvos(_engine.calculateReloadTime(airReloadMax, stats.reload), 0, window)
        : 0;
    const { descriptors, unmodeled, inactive } = resolveBarrageDescriptors(skillIds, {
        getBarrageSkill: _data.getBarrageSkill,
        getWeapon: _data.getWeaponProperty,
        getBarrage: _data.getBarrage,
        getBullet: _data.getBullet,
        stats,
        ctx: {
            window,
            salvosBySlot: salvosBySlot(weapons, stats.reload, window),
            salvosByAttr: salvosByAttr(weapons, stats.reload, window),
            airstrikes,
        },
    });

    // Damage multipliers ride EVERY weapon the ship fires, barrages included — the
    // Lua reads them off the attacker at damage time, not off the weapon.
    const all = weapons.concat(descriptors);
    if (damageBuffs) {
        const byAttr = { cannon: damageBuffs.cannon, torpedo: damageBuffs.torpedo, air: damageBuffs.air };
        for (const d of all) {
            d.damageRatio = damageBuffs.bullet || 0;
            d.attrDamageRatio = byAttr[d.attackAttribute] || 0;
        }
    }
    return { weapons: all, unmodeled, inactive };
}

/**
 * The barrage skills a built ship actually fires.
 *
 * SUPERSEDED SKILLS ARE THE TRAP. A ship lists every rung of an upgrade chain,
 * not just the live one: 듀이 carries BOTH 20011 (Limit Break 1, upgrade→20012)
 * and 20012 (Limit Break 3, downgrade→20011). At max limit break only 20012
 * fires. 564 of the roster's barrage skills have this shape, so iterating
 * ship.skill naively counts most destroyers' and cruisers' barrage TWICE and
 * roughly doubles their contribution — a wrong headline number that looks
 * entirely plausible.
 *
 * `requirement` is the raw game string ("Default", "Limit Break 1/2/3",
 * "Retrofit", "Devs 10", "Fate Simulation 5", …). The sim assumes max limit
 * break / max development; 개장 and 운명 시뮬레이션 are the two live gates.
 *
 * A skill is superseded only when its successor is ITSELF live under the
 * current gates — not merely present in the list. 엘드릿지's 29022 (no gate)
 * upgrades into 29023 (Retrofit-gated): with the retrofit toggle off, 29023
 * fails its own gate, so 29022 must survive as the live rung. Checking
 * "does the target exist" instead of "is the target eligible" silently drops
 * BOTH ends of the chain whenever it crosses a gate boundary this way — 15
 * ships have this shape, 11 of them losing real modelled damage.
 */
export function liveSkillIds(ship, useRetrofit, useFate = true) {
    const skills = ship?.skill || {};
    const eligible = (sk) => (sk.requirement === 'Retrofit' ? !!useRetrofit
        : isFateGated(sk) ? useFate !== false : true);
    return Object.keys(skills).filter((sid) => {
        const sk = skills[sid];
        if (!sk || !eligible(sk)) return false;
        const target = sk.upgrade != null ? skills[String(sk.upgrade)] : null;
        return !(target && eligible(target));   // superseded only if the successor is itself live
    });
}

/** The subset that actually fires a barrage. */
export function activeBarrageSkillIds(ship, useRetrofit, useFate = true) {
    const skills = ship?.skill || {};
    return liveSkillIds(ship, useRetrofit, useFate).filter((sid) => skills[sid].weapon_true);
}

/** `requirement` is "Fate Simulation 3"/"…5" — the step, which none-vs-max ignores. */
const isFateGated = (sk) => typeof sk?.requirement === 'string' && sk.requirement.startsWith('Fate Simulation');

/**
 * True when anything the ship has is gated behind 운명 시뮬레이션, which is what
 * decides whether the card shows the toggle at all (33 research ships).
 */
export function hasFateSimulation(ship) {
    return Object.values(ship?.skill || {}).some(isFateGated);
}

/**
 * Build the engine TargetProfile from targetOpts. META kind resolves the boss
 * record from loaded data and defers to makeMetaTarget; anything else (or a
 * missing boss) falls back to the generic armor preset, flagged `bossMissing`
 * so the panel can say so instead of silently showing a different target's
 * name with the tier controls hidden. Must run after _ensureImports().
 */
function _buildTarget(targetOpts) {
    if (targetOpts.kind === 'meta' && targetOpts.bossId != null) {
        const boss = _data.getMetaBoss(targetOpts.bossId);
        if (boss) return _engine.makeMetaTarget(boss, targetOpts.tier ?? null, targetOpts.overrides || {});
        // Boss data absent (e.g. a share link from an older roster). Fall back to a
        // preset, but flag it so the panel can say so instead of silently showing
        // a different target's name with the tier controls hidden.
        const missing = _engine.makeTarget(targetOpts.presetKey || 'heavy', targetOpts.overrides || {});
        missing.bossMissing = true;
        return missing;
    }
    return _engine.makeTarget(targetOpts.presetKey || 'heavy', targetOpts.overrides || {});
}

/**
 * Compute fleet damage vs a target preset or META boss. Reuses fleet-sim.calc.js for
 * buffed stats (so equips/tech/affinity/passives are already applied).
 *
 * resolvePassiveBuffs(targetShip, allFleetShips, slot) expects SHIP DATA OBJECTS
 * (from getShipByGid), NOT slot configs, and the array must stay POSITIONAL —
 * slots 0–2 are 주력 and 3–5 전열, so compacting it moves ships between the rows
 * and mis-resolves every vanguard/main/flagship-targeted 지휘 skill.
 *
 * @param {Array} ships state.ships (6 slots, each { gid, level, ... } or null)
 * @param {{kind?:string, presetKey?:string, bossId?:number, tier?:number, overrides?:object, window?:number}} targetOpts
 * @returns {Promise<object>} { perShip, total, dps, target, clearCheck }
 */
export async function simulateFleetDamage(ships, targetOpts) {
    if (!await _ensureImports()) throw new Error('fleet-sim.damage: failed to load dependencies');

    const target = _buildTarget(targetOpts);
    const techBonuses = _calc.calculateFleetTechBonuses();
    const slots = ships || [];
    const fleetShips = slots.map((s) => (s && s.gid ? _data.getShipByGid(s.gid) : null));
    // The user's 제한 시간 is the fight clock; the fleet cannot fire for all of it
    // (approach + intro), so the sim window is that much shorter.
    const limit = targetOpts.window ?? defaultWindow(targetOpts.kind);
    const window = Math.max(1, limit - _engine.BATTLE_START_DELAY);

    const engineShips = [];
    const barrageGapsByRef = new Map();
    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (!slot) continue;
        const computed = _computeStatsForSlot(slot, i, fleetShips, techBonuses, slots);
        if (!computed) continue;
        const { ship, stats, damageBuffs } = computed;
        const { weapons, unmodeled, inactive } = resolveShipWeapons(slot, ship, stats, window, damageBuffs);
        barrageGapsByRef.set(slot.gid, { unmodeled, inactive });
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

    const full = _engine.simulateFleet(engineShips, target, { window });
    const clearCheck = _engine.computeClearCheck({
        damageAt: full.damageAt,
        bossHp: target.hp,
        timeLimit: limit,
        startDelay: _engine.BATTLE_START_DELAY,
    });

    // The fight ends when the boss dies, so every figure is rolled up to THAT
    // moment: a 90s roll-up against a boss that died at 40s reports overkill as
    // if it were sustained damage, and its average hides the opening burst.
    // The re-roll is arithmetic over descriptors that are already resolved.
    const killAt = clearCheck.clears
        ? Math.max(1, clearCheck.ttkSeconds - _engine.BATTLE_START_DELAY)
        : window;
    const sim = killAt < window ? _engine.simulateFleet(engineShips, target, { window: killAt }) : full;

    for (const s of sim.perShip) {
        const gaps = barrageGapsByRef.get(s.ref) || {};
        s.unmodeledBarrages = gaps.unmodeled || 0;
        s.inactiveBarrages = gaps.inactive || 0;
    }
    return { ...sim, target, clearCheck, timeLimit: limit };
}

/**
 * Helper: compute one slot's buffed stats + resolve its ship object.
 * `fleetShips` is the positional 6-array of ship data objects (null = empty slot)
 * and `slotIndex` says where this ship sits — both are what the vanguard/main/
 * flagship target modes read.
 */
function _computeStatsForSlot(slot, slotIndex, fleetShips, techBonuses, slots) {
    const ship = fleetShips[slotIndex];
    if (!ship) return null;

    const passiveBuffs = _calc.resolvePassiveBuffs(ship, fleetShips, slotIndex, slots);

    const res = _calc.calculateShipStats(slot, techBonuses, passiveBuffs);
    if (!res) return null;
    // The same resolved list carries both kinds; calculateShipStats keeps the stat
    // clauses and ignores the rest, sumDamageBuffs takes the damage multipliers.
    return { ship, stats: res.stats, damageBuffs: _calc.sumDamageBuffs(passiveBuffs) };
}
