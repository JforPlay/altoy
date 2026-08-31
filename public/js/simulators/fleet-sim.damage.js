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
import { ATTR_TO_KEY, PERCENT } from '../engine/damage/constants.js';
import { weaponSalvoDuration } from '../engine/damage/salvo-timing.js';
import { runBattleSim } from '../engine/damage/battle-sim.js';
import { dotSchedule } from '../engine/damage/dot.js';
import { defaultWindow } from './fleet-sim.saves.js';
import { weaponCycleInterval } from '../engine/damage/reload.js';
import { unitTags } from '../engine/damage/targets.js';

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
        weaponType: weapon.type,          // weapon_property.type — what a weaponReloadRatio keys on
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
 * The trigger names ONE salvo raises, keyed on the weapon class the engine would have
 * instantiated for it.
 *
 * THE CLASSES ARE MUTUALLY EXCLUSIVE — never a union. `CreateWeaponUnit`
 * (battleunitdatafunction.lua:266) switches on `weapon_property.type`, and each
 * subclass overrides `TriggerBuffOnFire` to raise exactly ONE name:
 *   BattleWeaponUnit          부포 / DD·CL·CA 주포   battleweaponunit.lua:688      onFire
 *   BattlePointHitWeaponUnit  전함 주포              battlepointhitweaponunit.lua:191  onChargeWeaponFire
 *   BattleTorpedoUnit         어뢰                   battletorpedounit.lua:11      onTorpedoWeaponFire
 * Handing every cannon salvo both names removes the only thing separating a 전함 주포
 * from the 부포 beside it, so every 부포 salvo trips every 「주포 발사 시」 barrage: 75
 * BB-family hulls read 2088 activations against a true 566 at BB pace (주포 25 s, 부포
 * 6 s, 78 s window) the last time this was conflated. The published
 * graph is disjoint the same way: 696 onFire-only edges (695 carrying an `index`), 221
 * charge-only (0 carrying one — ON_CHARGE_FIRE's payload is `{}`, so the CLASS is the
 * filter and there is no equipIndex to filter on), and 0 edge listing both.
 *
 * `onWeaponSteday` rides EVERY salvo: no subclass overrides `TriggerBuffOnSteday`, and
 * both DoAttack bodies call it (battleweaponunit.lua:666, battlepointhitweaponunit.lua:127).
 * `onChargeWeaponReady` is the charge class alone, raised from handleCoolDown
 * (battlepointhitweaponunit.lua:143 + :257) — the same cadence as its fire in auto battle.
 *
 * Keyed on `type`, NOT on `attackAttribute`: an AUTO_MISSILE (32) is a torpedo-attribute
 * weapon that is still a plain BattleWeaponUnit, and a MANUAL_MISSILE (31) is a
 * torpedo-attribute weapon on the charge class. Both ride the SY-1, the roster's only
 * missile equip.
 */
const CHARGE_SALVO = ['onChargeWeaponFire', 'onChargeWeaponReady', 'onWeaponSteday'];
// TriggerBuffOnFire/OnReady fork on the type INSIDE the charge class. Neither name is in
// the sim's RAISED set and no graph edge carries one, so a missile salvo correctly
// raises onWeaponSteday alone rather than borrowing another class's trigger.
const MISSILE_SALVO = ['onManualMissileFire', 'onManualMissileReady', 'onWeaponSteday'];
const TORPEDO_SALVO = ['onTorpedoWeaponFire', 'onWeaponSteday'];
const GUN_SALVO = ['onFire', 'onWeaponSteday'];
const SALVO_TRIGGERS = new Map([
    [23, CHARGE_SALVO],   // POINT_HIT_AND_LOCK — 전함 주포
    [33, CHARGE_SALVO],   // MANUAL_METEOR
    [31, MISSILE_SALVO],  // MANUAL_MISSILE
    [3, TORPEDO_SALVO],   // TORPEDO
    [16, TORPEDO_SALVO],  // MANUAL_TORPEDO — the 구축/경순 어뢰 slot
    [27, TORPEDO_SALVO],  // DISPOSABLE_TORPEDO
]);
const salvoTriggers = (weaponType) => SALVO_TRIGGERS.get(weaponType) || GUN_SALVO;

/**
 * The weapon events the barrage simulator raises, off the same cadence the damage
 * roll-up uses — `initialDelay + k x weaponCycleInterval`, so this is one schedule
 * expressed as times rather than a second count that can drift.
 *
 * ONE event per salvo, carrying every name that salvo raises. Emitting one event per
 * name would fire an edge listing two of them twice per salvo.
 *
 * Air events carry `slot: 1`, which is what the KR-text acceptance gate emits. Inert
 * today — 0 of the graph's air-triggered edges declare an `index`, so there is nothing
 * for a slot to be filtered against — but production and the gate disagreeing about the
 * event shape is precisely the ships-vs-validated divergence that gate exists to catch.
 *
 * ponytail: coolStart / preloadShare are ignored, so a preloaded mount's first
 * salvo sits at initialDelay like every other. That is parity with the per-slot salvo
 * counts this replaces, not a new approximation; revisit only if a fixture needs it.
 */
export function weaponEvents(descriptors, reloadStat, window, airstrikeInterval) {
    const out = [];
    for (const d of descriptors) {
        if (d.slotIndex == null) continue;
        const interval = weaponCycleInterval(d, reloadStat);
        if (!(interval > 0)) continue;
        const names = salvoTriggers(d.weaponType);
        for (let t = d.initialDelay ?? 0; t <= window; t += interval) {
            out.push({ t, names, slot: d.slotIndex + 1, attr: d.attackAttribute });
        }
    }
    if (airstrikeInterval > 0) {
        const names = ['onAllInStrike', 'onAllInStrikeSteady', 'onAirAssistReady'];
        for (let t = airstrikeInterval; t <= window; t += airstrikeInterval) out.push({ t, names, slot: 1, attr: 'air' });
    }
    return out;
}

/**
 * Every weapon id one root buff can reach in the graph — what it COULD fire, as
 * opposed to what a given loadout made it fire.
 *
 * Two callers: `expandBarrageSkillIds` (does this root have a barrage of its own, or
 * does its barrage live on an attached id?) and the zero-row note in
 * `resolveBarrageDescriptors` (did a sibling root already fire this root's barrage?).
 * Cheap — the walk covers one root's own subgraph — and only run for the handful of
 * ids that ask.
 *
 * Follows exactly the edges `battle-sim.js` follows, deliberately: a reachability
 * answer that disagreed with the simulator's own would be worse than none. That
 * includes not descending a REMOVAL edge's payload — a cleanse's `buff_id_list` is
 * what it strips, not what it reaches.
 */
export function reachableWeapons(graph, rootId) {
    const weapons = new Set();
    if (!graph || !graph.b) return weapons;
    const seenB = new Set();
    const seenS = new Set();
    const stack = [['b', String(rootId)]];
    while (stack.length) {
        const [kind, id] = stack.pop();
        if (kind === 's') {
            if (seenS.has(id)) continue;
            seenS.add(id);
            for (const e of graph.s[id]?.e || []) {
                if ((e.ty === 'BattleSkillFire' || e.ty === 'BattleSkillFireSupport') && e.a.weapon_id != null) {
                    weapons.add(e.a.weapon_id);
                } else if (e.ty === 'BattleSkillAddBuff' && e.a.buff_id != null) {
                    stack.push(['b', String(e.a.buff_id)]);
                }
            }
            continue;
        }
        if (seenB.has(id)) continue;
        seenB.add(id);
        for (const e of graph.b[id]?.e || []) {
            if (e.a.buff_id != null) stack.push(['b', String(e.a.buff_id)]);
            for (const sid of [e.a.skill_id, ...(e.a.skill_id_list || [])]) {
                if (sid != null) stack.push(['s', String(sid)]);
            }
        }
    }
    return weapons;
}

/** The trigger names a fire-class row can carry — one label, four spellings. */
const FIRE_TRIGGERS = new Set(['onFire', 'onChargeWeaponFire', 'onChargeWeaponReady', 'onWeaponSteday']);
const AIR_TRIGGERS = new Set(['onAllInStrike', 'onAllInStrikeSteady', 'onAirAssistReady']);

/**
 * Korean cadence text for one simulated barrage row. The DATA holds machine keys;
 * Korean lives here, so relabelling stays a JS-only change.
 *
 * The proc chance is gone from the string on purpose: the sim folds `rant` into the
 * activation count itself (a failed roll costs no cooldown, so it widens the period
 * rather than scaling a count), so a trailing 「70%」 beside a period the sim already
 * paid for would state the same discount twice.
 */
export function cadenceLabel(row) {
    if (!row) return '';
    const n = row.period;
    if (row.trigger === 'onBattleBuffCount') {
        // 주포 only when the counter watches slot 1 ALONE. 14 live roots count a
        // multi-slot `index` (힌덴부르크 30062 [1,3], 얏센 24122 [1,2], the privateer
        // family [1,2]), and reading the first entry called every one of them 주포.
        const slots = row.slots || (row.slot != null ? [row.slot] : []);
        return (slots.length === 1 && slots[0] === 1)
            ? `주포 ${row.countTarget}회마다` : `${row.countTarget}회 발사마다`;
    }
    if (FIRE_TRIGGERS.has(row.trigger)) {
        return n > 0 ? `발사 시 (재사용 ${n.toFixed(1)}초)` : '발사 시';
    }
    if (row.trigger === 'onTorpedoWeaponFire') {
        return n > 0 ? `어뢰 발사 시 (재사용 ${n.toFixed(1)}초)` : '어뢰 발사 시';
    }
    if (AIR_TRIGGERS.has(row.trigger)) return '항공 공격 시';
    if (row.trigger === 'onStartGame') return '전투 시작 시';
    if (!(n > 0)) return '전투 시작 시';
    return row.first != null && Math.abs(row.first - n) > 0.5
        ? `${row.first.toFixed(0)}초 후 ${n.toFixed(0)}초마다`
        : `${n.toFixed(0)}초마다`;
}

/**
 * Resolve a ship's barrage skills into WeaponDescriptors carrying a pre-resolved
 * activation count, by SIMULATING the game's buff/skill event bus over the published
 * control-flow graph.
 *
 * ONE `runBattleSim` call for the whole ship, never one per root. Roots on one unit
 * are not independent: they share tag state and counters, and 20 of them carry a
 * `ship_tag_list` gate whose tag a SIBLING root stamps — run one at a time those
 * always take their "tag absent" arm. The KR-text acceptance gate batches the same
 * way, so a per-root loop here would ship a configuration nothing validated.
 *
 * A 지속 피해 the barrage attaches rides along as its own descriptor (see
 * resolveBarrageDot) — it is not weapon damage and takes no armor modifier, so it
 * must never be folded into one of the rows above.
 *
 * THE TWO NOTES ANSWER DIFFERENT QUESTIONS AND MUST NEVER BE MERGED.
 *   `blocked` (`unmodeled`) = the sim could not evaluate a gate, or the only path to
 *     a weapon runs through a trigger it structurally never raises. The condition was
 *     NOT read → 「발동 조건이 아직 구현되지 않은 탄막」.
 *   zero rows, not blocked (`inactive`) = the condition read fine and this loadout
 *     never fires it (a 대공-slot trigger, a torpedo trigger on a ship with no
 *     torpedo) → 「현재 편성에서 발동하지 않는 탄막」.
 * Saying either about the other is the conflation this whole lane exists to remove.
 *
 * ZERO ROWS IS NOT ALWAYS A NOTE. A root whose every reachable weapon another live
 * root already fired has not failed to fire — its barrage MOVED. 키로프's 14170 is
 * the case: its 전용 장비 sibling 14171 casts the same skill_14170 at t=0, and that
 * cast attaches buff_14172, whose `BattleBuffCleanse` strips buff_14170 outright. The
 * rows are all there under the sibling's id, so a note beside them would tell the
 * reader that a barrage they can SEE in the table did not fire.
 *
 * FAILS SAFE when the graph is absent (a failed phase-2 fetch, or a stale cached
 * fleet-sim.damage.js paired with a fresh fleet-sim.data.js behind the service
 * worker): every requested skill counts as unmodelled instead of throwing, which
 * would otherwise blank the whole damage panel (resolveShipWeapons →
 * simulateFleetDamage → the panel's catch clears container.innerHTML for the fleet).
 */
export function resolveBarrageDescriptors(skillIds, deps) {
    const ids = (skillIds || []).map(String);
    if (!deps.graph || !deps.graph.b) {
        return { descriptors: [], unmodeled: ids.length, inactive: 0, unmodeledDots: 0, dotInjure: {} };
    }
    const { fired, blocked } = runBattleSim(ids, deps.simCtx, deps.graph);
    const blockedSet = new Set(blocked.map(String));
    const byRoot = new Map();
    const firedWeapons = new Set();
    for (const row of fired) {
        const k = String(row.skillId);
        if (!byRoot.has(k)) byRoot.set(k, []);
        byRoot.get(k).push(row);
        firedWeapons.add(row.weaponId);
    }

    const descriptors = [];
    let unmodeled = 0;
    let inactive = 0;
    let unmodeledDots = 0;
    const dotInjure = {};
    for (const sid of ids) {
        const rows = byRoot.get(sid) || [];
        // UNIFORM, not narrowed to zero-row roots: a skill with a live barrage AND an
        // onSink death-rattle really does have an unmodelled half, and 67 roots are in
        // exactly that state at production scope. Gating the disclosure on "produced
        // nothing" would undo at the last step the rule the simulator applies on purpose.
        if (blockedSet.has(sid)) unmodeled++;
        if (!rows.length) {
            // A root the graph has no node for installs NOTHING — `addBuff` returns
            // early, so it can neither fire nor be blocked, and no condition was ever
            // read. That is 미구현, not 「이 편성에서 발동하지 않는」, which asserts the
            // condition WAS read and came out false. 76 ships reach here (9 of them
            // with no equipment at all, e.g. 알렌 M. 섬너 14280, 유미 110110): a root
            // `expandBarrageSkillIds` returned unexpanded, or an attached 전용 장비 id
            // that never had a node. Checked BEFORE the sibling test, which reads the
            // same absent node and would call it inactive too.
            if (!deps.graph.b[sid]) unmodeled++;
            else if (!blockedSet.has(sid) && !_movedToSibling(sid, deps.graph, firedWeapons)) inactive++;
            continue;
        }
        // A missing name is ordinary, not a 전용 장비 tell: most attached_weapon_skill_id
        // ids simply have no `skill_data_template` entry of their own (the graph only
        // names ROOT buff nodes, never a borrowed parent name), so the row stays
        // labelled 탄막 instead of inventing an owner for it.
        const name = deps.getSkillName ? deps.getSkillName(sid) : '';
        const label = name ? `탄막 · ${name}` : '탄막';
        const built = [];
        for (const row of rows) {
            const raw = deps.getWeapon(row.weaponId);
            if (!raw) continue;
            const weapon = mergeWeaponWithBase(raw, deps.getWeapon);
            const d = resolveWeaponDescriptor(weapon, deps.stats, {
                getBarrage: deps.getBarrage,
                getBullet: deps.getBullet,
                label,
                mountCount: 1,      // the barrage expansion IS the bullet count
                potential: 1,       // not equipment — no slot proficiency
                reloadMaxOverride: 0,
            });
            if (!d) continue;
            d.activations = row.activations;
            d.activationWindow = deps.simCtx?.window ?? 0;   // the count is FOR this window
            d.cadence = cadenceLabel(row);
            descriptors.push(d);
            built.push({ d, weapon, weaponId: row.weaponId });
        }
        // Every weapon the sim fired failed to resolve — but a root already disclosed
        // for a blocked branch must not be counted twice.
        if (!built.length) { if (!blockedSet.has(sid)) unmodeled++; continue; }
        const burn = resolveBarrageDot(built, name, deps);
        if (!burn) continue;
        if (burn.unmodeled) { unmodeledDots++; continue; }
        descriptors.push(burn.descriptor);
        // Two ships burning the same boss do not stack the debuff (every reachable
        // buff has stack: 1), so the same buff id keeps its largest contribution
        // rather than summing.
        if (burn.injureRatio) {
            dotInjure[burn.buffId] = Math.max(dotInjure[burn.buffId] || 0, burn.injureRatio);
        }
    }
    return { descriptors, unmodeled, inactive, unmodeledDots, dotInjure };
}

/**
 * Did this root's barrage move to a sibling root that fired it?
 *
 * True only when the root reaches at least one weapon in the graph AND every one of
 * them is already on the table under another root — a partial overlap keeps its note,
 * because the half nobody fired is a real gap. Called only for a root that produced
 * no rows of its own, so every hit in `firedWeapons` belongs to a sibling.
 */
function _movedToSibling(sid, graph, firedWeapons) {
    const mine = reachableWeapons(graph, sid);
    if (!mine.size) return false;
    for (const w of mine) if (!firedWeapons.has(w)) return false;
    return true;
}

/**
 * The burn (지속 피해) one barrage's bullets attach, as its own descriptor.
 *
 * A DOT is a property of the BULLET, not of the skill — bullet_template's
 * `attach_buff` names the buff, its level and its attach chance — so this reads
 * the weapons the barrage already resolved rather than walking anything new. That
 * also keeps the two lanes aligned: a barrage the sim cannot model has no burn
 * either, instead of a burn with no barrage under it.
 *
 * ONE burn per root skill, even when several of its weapons carry one. The buff does
 * not stack, and battleunit.lua:976 AddBuff decides which survives: a HIGHER
 * `group_level` removes and re-attaches (fresh igniteDMG from the new weapon),
 * an equal or lower one only Stacks, refreshing the expiry and keeping the old
 * numbers. So the highest group_level wins — 라이온's 200-damage g2 shell over
 * her 20-damage g1 one — with weapon damage as the tiebreak.
 *
 * The tick count rides the WINNING weapon's own descriptor rather than one figure
 * shared by the whole record: the sim gives every fired weapon its own activation
 * count, and the burn is attached by exactly one of them.
 *
 * @returns {{descriptor:object, injureRatio:number, buffId:number}|{unmodeled:true}|null}
 */
export function resolveBarrageDot(built, name, deps) {
    if (typeof deps.getDot !== 'function') return null;
    // ONE WEAPON CAN FIRE UNDER TWO TRIGGERS, and the burn is attached by the BULLET,
    // so it ticks off that weapon's whole schedule rather than off whichever row won
    // the group tie-break below. 63 same-weapon two-trigger pairs exist roster-wide and
    // 4 carry a DOT (뉴저지 14510 w64220 1.00+1.00, 아사마 151640 w169200 1.00+3.00,
    // 마세나 151400 w168930 0.40+2.60, 알제리 13270 w69390 5.53+1.00); reading one row
    // under-counts those burns by up to 4x with no note on it.
    const actsByWeapon = new Map();
    for (const b of built) actsByWeapon.set(b.weaponId, (actsByWeapon.get(b.weaponId) || 0) + (b.d.activations || 0));
    let best = null;
    for (const { d, weapon, weaponId } of built) {
        const bulletIds = weapon.bullet_ID || [];
        const barrageIds = weapon.barrage_ID || [];
        // barrage_ID and bullet_ID are parallel arrays on 1520 of the 1546 weapons
        // a barrage record names, so the attach roll runs against the bullets of
        // ITS OWN barrage rather than the whole volley. That matters because 130 of
        // 161 burns attach on a chance: 1% over 20 bullets is 18%, over 5 it is 5%.
        const parallel = barrageIds.length === bulletIds.length;
        for (let i = 0; i < bulletIds.length; i++) {
            const bullet = deps.getBullet(bulletIds[i]);
            for (const attach of (bullet?.attach_buff || [])) {
                const dot = attach && deps.getDot(attach.buff_id);
                if (!dot) continue;
                const cand = {
                    dot, attach, d, weaponId,
                    bullets: parallel ? barrageBulletCount([barrageIds[i]], deps.getBarrage) : d.bulletsPerSalvo,
                    groupLevel: attach.group_level ?? 1,
                    dmg: d.damage * d.corrected,
                };
                if (!best || cand.groupLevel > best.groupLevel
                    || (cand.groupLevel === best.groupLevel && cand.dmg > best.dmg)) best = cand;
            }
        }
    }
    if (!best) return null;
    const window = deps.simCtx?.window ?? 0;
    const sched = dotSchedule(best.dot, {
        window,
        activations: actsByWeapon.get(best.weaponId) ?? best.d.activations,
        bullets: best.bullets,
        hitRate: deps.hitRate ?? 1,
        rant: best.attach.rant,
        hitIgnore: !!best.attach.hit_ignore,
        level: best.attach.buff_level,
        // GetCorrectedDMG of the weapon that fired the bullet: damage x potential x
        // corrected x 1%. A barrage weapon has no slot proficiency, so potential is 1.
        correctedDmg: best.d.damage * best.d.corrected * PERCENT,
        stat: deps.stats[ATTR_KEY_TO_STAT[best.dot.a]] ?? 0,
    });
    if (!sched) return { unmodeled: true };   // needs something the sim doesn't track
    if (!(sched.ticks > 0)) return null;
    return {
        buffId: best.attach.buff_id,
        // 받는 피해 riding the same buff, pro-rated by how much of the fight it is
        // up. It multiplies what the WHOLE fleet does, so the caller lands it on the
        // target rather than on this ship.
        injureRatio: best.dot.inj ? best.dot.inj * (window > 0 ? sched.uptime / window : 0) : 0,
        descriptor: {
            tickDamage: sched.tickDamage,   // presence of this field IS the DOT lane marker
            bulletsPerSalvo: 1,
            activations: sched.ticks,
            activationWindow: window,
            cadence: `${sched.interval}초마다`,
            label: name ? `지속 피해 · ${name}` : '지속 피해',
        },
    };
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
 * Skills that give a MAIN-FLEET ship's 부포 the reach to fire on a boss.
 *
 * A back-row 부포 normally cannot: the main fleet sits at the bottom of the
 * screen and every 구축포/경순포 the slot takes has a weapon `range` of 50–70
 * (measured across all 159 of them), which the boss never enters. It still
 * shreds trash mobs, so the game shows it working — but against the boss the
 * slot's DPS is fiction, and on a BB it OUT-DPSes the 주포 ~7× because it
 * reloads in ~3s against ~19s. Hence: resolved and displayed, never counted.
 *
 * The exceptions are runtime buffs that set the range to 80/95/105, so they
 * cannot be read off the equipment — this is the full set from a sweep of all
 * 3,155 skill templates for 부포/부무장 × 사거리/색적/조준 범위:
 *
 *   12120  비스마르크    부포 슬롯에 경순 주포 장착 시 사거리 상승
 *   19740  플랑드르      내구 50% 미만 → 사거리 95
 *   106320 타마키        사거리 80 (무조건)
 *   151610 오미          「시의 흥」 5개 → 사거리 95
 *   190110 발파라이소    20초 경과 / 부포 30회 발사 → 사거리 105
 *
 * Three of the five gate on a condition the sim does not model (an equip in the
 * slot, an HP threshold, a stack timer); they count unconditionally by decision
 * — the ship IS the exception, and a half-window credit would need a firing
 * model the panel has no other use for.
 *
 * Carrier skills that extend a 부무장 slot (베아른 13340, 이글 13520, 프리츠
 * 루메이 150760, 베아른·META 801220) are deliberately absent: SLOT_LABELS has no
 * CV entry, so those slots are never labelled 부포 and were never dropped.
 * 프리드리히 데어 그로세's 19220/18220 is a 부포 *탄막* — a barrage descriptor,
 * which this never touches.
 */
const SECONDARY_REACH_SKILLS = new Set(['12120', '19740', '106320', '151610', '190110']);

/** Fleet slots 0–2 are 주력 (back row); 3–5 are 전열. Mirrors MAIN_SLOTS in fleet-sim.calc.js. */
const MAIN_SLOTS = 3;

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
function _resolveEquippedWeapons(slotConfig, shipType, stats, baseList, prof, preload, defaults, dropSecondary) {
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
            // Out of range of the boss, but still fired — so it keeps its row and
            // keeps feeding onFire barrage triggers (the 탄막 it launches DO reach);
            // only its own damage is held out of the total. See SECONDARY_REACH_SKILLS.
            if (dropSecondary && labels[i] === '부포') d.excluded = true;
            surface.push(d);
        }
    }

    const airReloadMax = _engine.calculateAirAssistReloadMax(hiveReloads);
    for (const d of air) d.reloadMax = airReloadMax;
    return { weapons: surface.concat(air), airReloadMax };
}

/**
 * Fold a ship's weapon-scoped skill modifiers into its resolved descriptors.
 *
 * Two things the game scopes to a WEAPON rather than to the ship, both resolved
 * by `sumWeaponModifiers` (fleet-sim.calc.js, which owns the allowlist saying
 * WHICH skills last the whole battle):
 *   reloadByWeaponType — scales that weapon's own reload_max, keyed on
 *     `weapon_property.type`. NOT the 장전 stat: it multiplies the raw reload
 *     before the stat formula ever sees it, which is why it lands here on
 *     `reloadMax` rather than on `stats.reload`.
 *   damageBySlot — a damageRatioBullet on one 1-based EQUIP SLOT, parked on the
 *     descriptor and summed into `damageRatio` with the ship-wide multipliers.
 *
 * `cycleExtra` is deliberately untouched: 일제사 발사시간 + 발사 후 경직 are fixed
 * spans of the firing animation, which no reload modifier scales.
 */
function _applyWeaponModifiers(weapons, mods) {
    if (!mods) return;
    for (const d of weapons) {
        const reload = mods.reloadByWeaponType[d.weaponType];
        if (reload) d.reloadMax = Math.max(0, d.reloadMax * (1 + reload));
        const slotRatio = d.slotIndex != null ? mods.damageBySlot[d.slotIndex + 1] : undefined;
        if (slotRatio) d.slotDamageRatio = slotRatio;
    }
}

/**
 * Resolve all in-scope weapons for one ship slot config, PLUS the ship's active
 * barrage skills (each expanded into its own WeaponDescriptor with a pre-resolved
 * `activations` count) and any 지속 피해 those barrages attach. Must be called from
 * an async context after _ensureImports().
 * @param {object} slotConfig  { gid, level, retrofit, equips: [{id, level}, ...] }
 * @param {object} ship        Ship data object (from getShipByGid)
 * @param {object} stats       Buffed ship stats { firepower, torpedo, aviation, ... }
 * @param {number} [window]    Battle time window in seconds (barrage activation counts need it)
 * @param {object} [damageBuffs] Resolved damage multipliers riding every weapon
 * @param {number} [fleetSlot]   Fleet position 0–5; <3 is 주력 and holds its 부포 out of
 *   the boss total unless a SECONDARY_REACH_SKILLS skill is live. Defaults to the
 *   vanguard so a caller that doesn't know the row never silently drops damage.
 * @param {number} [hitRate]     The (ship, target) hit rate — only the DOT lane reads it,
 *   to size how often a burn actually attaches.
 * @returns {{weapons: object[], unmodeled: number, inactive: number, unmodeledDots: number,
 *   dotInjure: object}} WeaponDescriptor[], the count of barrage skills that produced no
 *   descriptor (unreadable cadence, missing weapon data), the count whose trigger read fine
 *   but yields zero activations for this loadout (unequipped ship, carrier, 대공-slot
 *   trigger), the count of burns needing something the sim doesn't track, and the 받는 피해
 *   each burn keeps up, keyed by buff id for the caller to land on the target.
 */
export function resolveShipWeapons(slotConfig, ship, stats, window = 90, damageBuffs = null, fleetSlot = MAIN_SLOTS, hitRate = 1) {
    if (!_data) return { weapons: [], unmodeled: 0, inactive: 0, unmodeledDots: 0, dotInjure: {} };   // needs _ensureImports() first — route external callers through simulateFleetDamage
    const useRetrofit = slotConfig.retrofit !== false && !!ship.retrofit;
    const shipType = _data.getEffectiveShipType(ship, useRetrofit);
    const baseList = (_calc.getShipBaseList(ship, useRetrofit)) || [];   // [s1,s2,s3] mount/plane count; ×1 fallback
    const prof = effectiveProficiency(ship, useRetrofit);               // max-LB efficiency + retrofit-toggle deltas
    const preload = ship.preload_count || [];                          // [s1,s2,s3] mounts ready at t=0
    const defaults = ship.default_equip_list || [];                    // empty-slot fallback; absent on older data
    const dropSecondary = fleetSlot < MAIN_SLOTS && !hasSecondaryReach(ship, useRetrofit, slotConfig.fate !== false);
    const { weapons, airReloadMax } = _resolveEquippedWeapons(slotConfig, shipType, stats, baseList, prof, preload, defaults, dropSecondary);
    // BEFORE the barrage block, not after: weaponEvents spaces a weapon's salvos by
    // its own reloadMax, so a barrage triggered by 주포 발사 would otherwise be paced
    // against the unmodified cadence.
    _applyWeaponModifiers(weapons, damageBuffs && damageBuffs.weaponMods);

    // Barrage skills the ship actually has active. Two filters, and BOTH matter.
    // Plus the ones its 전용 장비 attaches — granted by the DEDICATED weapon only, so a
    // generic SP weapon in that slot, or an emptied slot, grants nothing.
    const equipRecords = (slotConfig.equips || []).map((e) => _data.getEquipById(e?.id));
    const dedicated = _data.getDedicatedSPWeapon(ship.gid);
    const spEquipped = !!dedicated && Number(slotConfig.spWeapon?.id) === Number(dedicated.id);
    const graph = _data.getGraph();
    // The remap guard is now "does the simulator know this rung", i.e. does the graph
    // carry the buff the engine's InitUnitSkill would install for it.
    const inGraph = (id) => !!graph?.b?.[String(id)];
    // A maxed 전용 장비 REPLACES one of the ship's skills with an upgraded rung, so
    // the swap happens before supersession is expanded — 드레이크 fires 1019300
    // 단죄의 불꽃·改, not the 19300 her card lists.
    const liveBarrageIds = applySPSkillUpgrade(
        activeBarrageSkillIds(ship, useRetrofit, slotConfig.fate !== false),
        spSkillUpgradePairs(slotConfig.spWeapon, _data.getSPWeaponById),
        inGraph,
    );
    const skillIds = expandBarrageSkillIds(ship, liveBarrageIds, inGraph)
        .concat(spEquipped ? attachedSPBarrageIds(ship) : []);
    const airInterval = airReloadMax > 0
        ? _engine.calculateReloadTime(airReloadMax, stats.reload) : 0;
    const { descriptors, unmodeled, inactive, unmodeledDots, dotInjure } = resolveBarrageDescriptors(skillIds, {
        graph,
        getWeapon: _data.getWeaponProperty,
        getBarrage: _data.getBarrage,
        getBullet: _data.getBullet,
        getDot: _data.getDot,
        // The KR skill name is display text only — the sim needs none of it. It rides
        // the graph's own root buff nodes (`n`, set by the pipeline off
        // skill_data_template.json — never fetched here, 1.9 MB, pipeline-only), so a
        // root with no name there falls through to the label's own bare-'탄막' default.
        getSkillName: (id) => graph?.b?.[String(id)]?.n || '',
        stats,
        // Only the DOT lane reads this: a burn attaches on a landed hit unless the
        // bullet says hit_ignore, and it is the same (attacker, target) hit rate for
        // every weapon, so it is resolved once per ship rather than per descriptor.
        hitRate,
        simCtx: {
            window,
            events: weaponEvents(weapons, stats.reload, window, airInterval),
            unit: {
                equipTypes: equipRecords.map((e) => e?.type ?? 0),
                // The gate's own field: GetEquipmentList reads
                // equip_data_statistics[id].label, which equip_data_lite mirrors on
                // 890/890 records. Labels are level-invariant, so the base record is
                // the right read even though the slot holds a tier id.
                equipLabels: equipRecords.map((e) => e?.label || []),
                nationality: ship.nationality,
                shipType,
                spEquipped,
                allyCount: 6,
                // Static tags only. The runtime half — BattleBuffAddTag stamps — is
                // the sim's own multiset, which this seeds rather than replaces.
                // A gate naming a tag that is neither static nor stamped by any graph
                // edge (136 of the 463 check_target edges) still reads absent and is
                // blocked in silence, exactly as it was before the seed.
                tags: unitTags(shipType, ship.nationality, ship.tag_list),
            },
        },
    });

    // Damage multipliers ride EVERY weapon the ship fires, barrages included — the
    // Lua reads them off the attacker at damage time, not off the weapon.
    const all = weapons.concat(descriptors);
    if (damageBuffs) {
        const byAttr = { cannon: damageBuffs.cannon, torpedo: damageBuffs.torpedo, air: damageBuffs.air };
        for (const d of all) {
            // A DOT tick takes none of these: HandleDirectDamage is outside the damage
            // formula entirely, so a 주는 피해 buff cannot reach it.
            if (d.tickDamage != null) continue;
            // Both are damageRatioBullet in the Lua — one granted to the ship, one to a
            // single equip slot — so they land on the same term. A barrage descriptor
            // has no slotIndex and correctly picks up only the ship-wide half.
            d.damageRatio = (damageBuffs.bullet || 0) + (d.slotDamageRatio || 0);
            d.attrDamageRatio = byAttr[d.attackAttribute] || 0;
            // The armor and tag halves depend on the TARGET, so they ride the
            // descriptor as maps and formula.js indexes them at damage time; the
            // ammo half is fixed by this weapon's own bullet and resolves here.
            d.armorDamageRatio = damageBuffs.byArmor;
            d.tagDamageRatio = damageBuffs.byTag;
            d.ammoDamageRatio = damageBuffs.byAmmo?.[d.ammoType] || 0;
        }
    }
    return { weapons: all, unmodeled, inactive, unmodeledDots, dotInjure };
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

/**
 * The `[[from, to]]` skill upgrades a ship's EQUIPPED 전용 장비 grants, or `[]`.
 *
 * The upgrade fires at MAX enhancement only, so an under-levelled weapon grants
 * nothing. `level` is a 0-based index into `levels` (the same convention
 * `_getSPWeaponStatBonuses` clamps against), so max is `levels.length - 1`.
 *
 * Only dedicated weapons carry pairs (228 of 228; 0 generics), so reading them off
 * whatever is equipped needs no "is this the dedicated one" test of its own.
 * @param {object} spConfig slotConfig.spWeapon — { id, level } | null
 * @param {(id:(number|string))=>(object|null)} getSPWeaponById
 */
export function spSkillUpgradePairs(spConfig, getSPWeaponById) {
    if (!spConfig || !spConfig.id) return [];
    const w = getSPWeaponById(spConfig.id);
    const pairs = w?.skill_upgrade;
    if (!Array.isArray(pairs) || !pairs.length) return [];
    const maxLevel = Math.max(0, (w.levels?.length || 0) - 1);
    return (spConfig.level || 0) >= maxLevel ? pairs : [];
}

/**
 * Swap live skill ids for the rungs a maxed 전용 장비 upgrades them into.
 *
 * THE SWAP IS PER-TABLE, never a blind id swap. 17 of the 230 pairs upgrade into a
 * skill that has no record in the table being remapped — 드레이크's `1018300`
 * 단죄의 불꽃·改+ and three other barrages are flat internal casts in `skill.json`
 * with no level ladder and no weapon, so the barrage walk emits nothing for them by
 * design. Swapping regardless would DELETE a modelled component; keeping the base
 * rung lets the 「발동 조건이 아직 구현되지 않은 탄막 N개」 note carry it instead
 * (D3: disclose, never silently under-report).
 *
 * Sources are read from the pair, never computed: `to - 1000000` covers only 111 of
 * the 229 explicit pairs and the rest use other conventions (핫스 108090 → 108240,
 * 2B 117010 → 117030, 건스웨이 150580 → 10150580). WSL `spweapon_data_process.py`
 * takes the pair off the max-enhancement record, because the base record states the
 * same upgrade with its SOURCE ZEROED — a zeroed source is skipped here too.
 * @param {string[]} ids live skill ids
 * @param {Array<Array<number|string>>} pairs from spSkillUpgradePairs
 * @param {(id:string)=>boolean} hasRecord does the CONSUMING table know this id?
 */
export function applySPSkillUpgrade(ids, pairs, hasRecord) {
    if (!pairs || !pairs.length) return ids;
    const up = new Map();
    for (const pair of pairs) {
        const from = String(pair?.[0] ?? '');
        const to = String(pair?.[1] ?? '');
        if (from && from !== '0' && to && hasRecord(to)) up.set(from, to);
    }
    return up.size ? ids.map((id) => up.get(id) || id) : ids;
}

/**
 * Does a live skill give this ship's 부포 boss reach? Rides the same liveness walk
 * as the barrages (retrofit / fate gates, supersession), so a rung that is not in
 * play cannot grant it. See SECONDARY_REACH_SKILLS for the roster and the sweep.
 */
export function hasSecondaryReach(ship, useRetrofit, useFate = true) {
    return liveSkillIds(ship, useRetrofit, useFate).some((sid) => SECONDARY_REACH_SKILLS.has(sid));
}

/** The subset that actually fires a barrage. */
export function activeBarrageSkillIds(ship, useRetrofit, useFate = true) {
    const skills = ship?.skill || {};
    return liveSkillIds(ship, useRetrofit, useFate).filter((sid) => skills[sid].weapon_true);
}

/**
 * Barrage skills the 전용 장비 ATTACHES on top of the ship's own list
 * (`attached_weapon_skill_id`). Unlike `skill_upgrade` this one reaches the browser
 * intact, so it needs nothing from the pipeline — but the raw field has two traps:
 *
 *  - it REPEATS once per enhancement level with a descending cooldown (10703 lists
 *    its pair 10×, 1130001 lists 52 entries). The graph is already level-collapsed
 *    to each id's max rung, so dedupe by id and ignore `time` entirely — read
 *    naively one barrage counts up to 26 times.
 *  - it RE-LISTS skills the ship already has (70204's 14170, 1100001's 110010),
 *    which activeBarrageSkillIds has counted already.
 *
 * ponytail: the 17 ships listing several distinct ids are taken at face value —
 * each id's cadence comes from the simulator, not from this field — which over-counts
 * if any such pair is really alternative rungs rather than a simultaneous set.
 * Needs a KR-text pass to split; ids with no record fall to the 미구현 note as usual.
 */
export function attachedSPBarrageIds(ship) {
    const own = ship?.skill || {};
    const ids = new Set();
    for (const a of ship?.sp_weapon?.attached_weapon_skill_id || []) {
        const id = String(a?.id ?? '');
        if (id && !own[id]) ids.add(id);
    }
    return [...ids];
}

/**
 * Swap a displayed skill for the attached ids that actually fire, where the
 * simulator can model nothing under the skill's own id.
 *
 * Only the PRESENCE TEST moved: it used to ask whether the extractor emitted a record
 * and now asks whether the graph carries the buff `InitUnitSkill` would install. The
 * scope rule itself is unchanged and still load-bearing — a skill that resolves under
 * its own id is left alone, because its attached ids are as often extra volleys of the
 * barrage it already fires as they are separate ones (키어사지 19681..19685 is one
 * staggered barrage in five casts). 알자스 150020, the case this was written for, no
 * longer needs it either way: she has no `skill_150020`, but the sim starts at
 * `buff_150020` and walks to 150021/150022/150025/150026 on its own.
 *
 * DO NOT WIDEN THIS INTO AN UNCONDITIONAL FIELD READ. An attached id is not filtered by
 * supersession, so appending one re-installs a rung `liveSkillIds` correctly dropped —
 * and chain-mates share a `countType`, so the lower threshold trips first and resets the
 * shared counter. 위치타·META lists 801301 (LB1) beside 801302 (LB3), both counting
 * `countType 801300` at 12 and 8: installed together the live rung goes 3.00 → 6.00
 * activations and a phantom 801301 row appears beside it. That is the same corruption
 * the 아일윈 20011/20012 case documents, and `activeBarrageSkillIds` exists to prevent it.
 *
 * Attached ids WITHOUT a graph node fall back to the parent rather than each counting
 * itself, so 미구현 keeps its unit — one per barrage skill the player can see.
 * @param {(id:string)=>boolean} hasRecord does the SIMULATOR know this id?
 */
export function expandBarrageSkillIds(ship, liveIds, hasRecord) {
    const skills = ship?.skill || {};
    const out = [];
    for (const sid of liveIds) {
        const attached = hasRecord(sid)
            ? [] : (skills[sid]?.attached_weapon_skill_id || []);
        const resolved = attached
            .map((a) => String(a?.id ?? ''))
            .filter((id) => id && hasRecord(id));
        out.push(...(resolved.length ? resolved : [sid]));
    }
    return [...new Set(out)];
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
    const dotInjure = new Map();   // buff id -> largest 받는 피해 any ship's burn holds up
    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (!slot) continue;
        const computed = _computeStatsForSlot(slot, i, fleetShips, techBonuses, slots);
        if (!computed) continue;
        const { ship, stats, damageBuffs } = computed;
        const profile = {
            accuracy: stats.accuracy,
            luck:     stats.luck,
            level:    slot.level || 125,
            reload:   stats.reload,
        };
        // The hit rate is a property of the (ship, target) pair, not of a weapon, so
        // it resolves here and the DOT lane sizes its attach chance with it.
        const { hitRate } = _engine.computeAccuracy(profile, target);
        const { weapons, unmodeled, inactive, unmodeledDots, dotInjure: injure } =
            resolveShipWeapons(slot, ship, stats, window, damageBuffs, i, hitRate);
        barrageGapsByRef.set(slot.gid, { unmodeled, inactive, unmodeledDots });
        for (const [buffId, value] of Object.entries(injure || {})) {
            dotInjure.set(buffId, Math.max(dotInjure.get(buffId) || 0, value));
        }
        engineShips.push({ ref: slot.gid, profile, weapons });
    }

    // A burn's 받는 피해 multiplies what the whole fleet does, not just its own
    // ticks, so it lands on the TARGET — the same term a META boss's own always-on
    // skill already uses. Pro-rated by uptime at resolve time; added rather than
    // overwritten so a boss keeps its own modifier.
    const injureFromDots = [...dotInjure.values()].reduce((a, b) => a + b, 0);
    if (injureFromDots) {
        // Kept apart from the boss's own modifier so the panel can name each: one is
        // the fight's baseline, the other is something the fleet brought.
        target.injureFromDots = injureFromDots;
        target.injureRatio = (target.injureRatio || 0) + injureFromDots;
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
        s.unmodeledDots = gaps.unmodeledDots || 0;
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
    return {
        ship,
        stats: res.stats,
        damageBuffs: {
            ..._calc.sumDamageBuffs(passiveBuffs),
            weaponMods: _calc.sumWeaponModifiers(passiveBuffs),
        },
    };
}
