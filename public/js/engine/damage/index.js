// public/js/engine/damage/index.js
/**
 * Damage engine public API. Page-agnostic: callers build AttackerProfile +
 * WeaponDescriptor[] + TargetProfile (see makeTarget) and call simulate*.
 */
import { computeHitDamage } from './formula.js';
import { computeSalvo } from './salvo.js';
import { calculateReloadTime, weaponCycleInterval } from './reload.js';
import { rollUpWeapon } from './timeline.js';

export { computeHitDamage, computeAccuracy } from './formula.js';
export { computeSalvo } from './salvo.js';
export { dotSchedule, dotUptime, dotApplyChance } from './dot.js';
export { countSalvos, countSalvosWithPreload, rollUpWeapon } from './timeline.js';
export { calculateReloadTime, calculateAirAssistReloadMax, weaponCycleInterval } from './reload.js';
export { salvoFiringDuration, weaponSalvoDuration } from './salvo-timing.js';
export { ARMOR_PRESETS, makeTarget, makeMetaTarget, DEFAULT_ADAPT, DEFAULT_ARMOR_REDUCE } from './targets.js';
export { computeClearCheck, solveTimeToKill } from './clear-check.js';
export { BATTLE_START_DELAY } from './constants.js';

/**
 * Roll one weapon's firing schedule up to time `t`.
 *
 * A barrage carries a pre-resolved activation count instead of a reload (its
 * cadence is a skill trigger — see engine/damage/barrage.js), so it is scaled by
 * how much of its resolution window `t` covers rather than re-counted. That
 * matters because the caller re-rolls the whole fleet at the kill time.
 */
function rollSchedule(s, t) {
  if (s.activations != null) {
    const share = s.activationWindow > 0 ? Math.min(1, t / s.activationWindow) : 1;
    const salvoCount = s.activations * share;
    const total = s.expectedSalvo * salvoCount;
    return { salvoCount, total, dps: t > 0 ? total / t : 0 };
  }
  return rollUpWeapon(s.expectedSalvo, s.cycle, {
    initialDelay: s.initialDelay, window: t, coolStart: s.coolStart, preloadShare: s.preloadShare,
  });
}

/** Hit/crit fields a DOT tick has no answer for; null renders as — in the panel. */
const DOT_HIT = { hitRate: null, critRate: null, critMult: null, armorMod: null, airMitigation: null };

/** Cumulative expected damage over the first `t` seconds of firing. Monotone in t. */
export function damageAtTime(schedules, t) {
  let sum = 0;
  for (const s of schedules) sum += rollSchedule(s, t).total;
  return sum;
}

/**
 * Simulate one attacker (ship) firing all its weapons at a target over a window.
 * @param {object} attacker AttackerProfile { accuracy, luck, level, reload }
 * @param {object[]} weapons WeaponDescriptor[]
 * @param {object} target TargetProfile
 * @param {{window?: number}} opts
 */
export function simulateAttacker(attacker, weapons, target, opts = {}) {
  const timeWindow = opts.window ?? 90;
  const schedules = [];
  const perWeapon = weapons.map((w) => {
    // A DOT tick is DIRECT damage: HandleDirectDamage (battledataproxylogic.lua:173)
    // reaches UpdateHP with no armor type, ammo type or damage-type lookup, so a
    // burn skips the armor triple, the hit roll and the crit roll alike. Its tick
    // value is already resolved (engine/damage/dot.js), leaving the engine only to
    // schedule it. The null rates are what tells the panel to print — rather than
    // 100%, which would claim a hit roll that never happened.
    const isDot = w.tickDamage != null;
    const hit = isDot ? DOT_HIT : computeHitDamage(attacker, w, target);
    const salvo = isDot ? { expectedSalvo: w.tickDamage } : computeSalvo(hit, w.bulletsPerSalvo);
    const isBarrage = w.activations != null;
    const reloadInterval = isBarrage ? 0 : calculateReloadTime(w.reloadMax, attacker.reload);
    // Salvos are spaced by the full fire cycle: reload + salvo firing time + 발사 후 경직 (cycleExtra,
    // a fixed time NOT scaled by the reload stat). reloadInterval is still reported raw for display.
    // A weapon that starts the battle reloading opens one RAW reload in (no salvo
    // firing time — battleweaponunit.lua InitialCD passes GetReloadTime() alone),
    // and `preloadShare` is the mounts that skip it.
    const schedule = isBarrage
      ? {
          expectedSalvo: salvo.expectedSalvo,
          activations: w.activations,
          activationWindow: w.activationWindow ?? timeWindow,
        }
      : {
          expectedSalvo: salvo.expectedSalvo,
          cycle: weaponCycleInterval(w, attacker.reload),
          initialDelay: w.initialDelay ?? 0,
          coolStart: w.startsOnCooldown ? reloadInterval : 0,
          preloadShare: w.preloadShare ?? 0,
        };
    // An `excluded` weapon still gets a full row (the caller shows what it WOULD
    // do) but never reaches `schedules`, so it is out of both the ship total and
    // the fleet's damageAt curve — i.e. out of the kill-time solve too.
    if (!w.excluded) schedules.push(schedule);
    const roll = rollSchedule(schedule, timeWindow);
    return {
      excluded: !!w.excluded,
      label: w.label,
      oneSalvoExpected: salvo.expectedSalvo,
      reloadInterval,
      salvoCount: roll.salvoCount,
      total: roll.total,
      dps: roll.dps,
      hitRate: hit.hitRate,
      critRate: hit.critRate,
      critMult: hit.critMult,
      armorMod: hit.armorMod,
      airMitigation: hit.airMitigation,
      cadence: w.cadence ?? null,
    };
  });
  const counted = perWeapon.filter((w) => !w.excluded);
  const oneShotExpected = counted.reduce((s, w) => s + w.oneSalvoExpected, 0);
  const total = counted.reduce((s, w) => s + w.total, 0);
  const dps = timeWindow > 0 ? total / timeWindow : 0;
  return { perWeapon, oneShotExpected, total, dps, schedules };
}

/**
 * Simulate a fleet.
 *
 * `damageAt(t)` is the fleet's cumulative-damage curve, which is what lets a
 * caller solve the kill time instead of dividing HP by an average — damage is
 * front-loaded (preloaded mounts, the opening airstrike), so hp/avgDps overstates
 * the time to kill.
 * @param {{ref:any, profile:object, weapons:object[]}[]} ships
 */
export function simulateFleet(ships, target, opts = {}) {
  const timeWindow = opts.window ?? 90;
  const perShip = ships.map((s) => ({ ref: s.ref, ...simulateAttacker(s.profile, s.weapons, target, opts) }));
  const total = perShip.reduce((s, x) => s + x.total, 0);
  const dps = timeWindow > 0 ? total / timeWindow : 0;
  const schedules = perShip.flatMap((s) => s.schedules);
  return { perShip, total, dps, window: timeWindow, damageAt: (t) => damageAtTime(schedules, t) };
}
