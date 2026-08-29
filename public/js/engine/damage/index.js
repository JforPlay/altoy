// public/js/engine/damage/index.js
/**
 * Damage engine public API. Page-agnostic: callers build AttackerProfile +
 * WeaponDescriptor[] + TargetProfile (see makeTarget) and call simulate*.
 */
import { computeHitDamage } from './formula.js';
import { computeSalvo } from './salvo.js';
import { calculateReloadTime, weaponCycleInterval } from './reload.js';
import { rollUpWeapon } from './timeline.js';

export { computeHitDamage } from './formula.js';
export { computeSalvo } from './salvo.js';
export { countSalvos, countSalvosWithPreload, rollUpWeapon } from './timeline.js';
export { calculateReloadTime, calculateAirAssistReloadMax, weaponCycleInterval } from './reload.js';
export { salvoFiringDuration, weaponSalvoDuration } from './salvo-timing.js';
export { ARMOR_PRESETS, makeTarget, makeMetaTarget, DEFAULT_ADAPT, DEFAULT_ARMOR_REDUCE } from './targets.js';
export { computeClearCheck } from './clear-check.js';

/**
 * Simulate one attacker (ship) firing all its weapons at a target over a window.
 * @param {object} attacker AttackerProfile { accuracy, luck, level, reload }
 * @param {object[]} weapons WeaponDescriptor[]
 * @param {object} target TargetProfile
 * @param {{window?: number}} opts
 */
export function simulateAttacker(attacker, weapons, target, opts = {}) {
  const timeWindow = opts.window ?? 90;
  const perWeapon = weapons.map((w) => {
    const hit = computeHitDamage(attacker, w, target);
    const salvo = computeSalvo(hit, w.bulletsPerSalvo);
    // A barrage carries a pre-resolved activation count (see engine/damage/barrage.js):
    // its cadence comes from a skill trigger, not from the reload stat, so reload
    // and the window roll-up are both bypassed.
    const isBarrage = w.activations != null;
    const reloadInterval = isBarrage ? 0 : calculateReloadTime(w.reloadMax, attacker.reload);
    // Salvos are spaced by the full fire cycle: reload + salvo firing time + 발사 후 경직 (cycleExtra,
    // a fixed time NOT scaled by the reload stat). reloadInterval is still reported raw for display.
    // A weapon that starts the battle reloading opens one RAW reload in (no salvo
    // firing time — battleweaponunit.lua InitialCD passes GetReloadTime() alone),
    // and `preloadShare` is the mounts that skip it. Barrages are exempt: their
    // cadence is a skill trigger, not a reload.
    const roll = isBarrage
      ? {
          salvoCount: w.activations,
          total: salvo.expectedSalvo * w.activations,
          dps: timeWindow > 0 ? (salvo.expectedSalvo * w.activations) / timeWindow : 0,
        }
      : rollUpWeapon(salvo.expectedSalvo, weaponCycleInterval(w, attacker.reload), {
          initialDelay: w.initialDelay ?? 0,
          window: timeWindow,
          coolStart: w.startsOnCooldown ? reloadInterval : 0,
          preloadShare: w.preloadShare ?? 0,
        });
    return {
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
  const oneShotExpected = perWeapon.reduce((s, w) => s + w.oneSalvoExpected, 0);
  const total = perWeapon.reduce((s, w) => s + w.total, 0);
  const dps = timeWindow > 0 ? total / timeWindow : 0;
  return { perWeapon, oneShotExpected, total, dps };
}

/**
 * Simulate a fleet.
 * @param {{ref:any, profile:object, weapons:object[]}[]} ships
 */
export function simulateFleet(ships, target, opts = {}) {
  const timeWindow = opts.window ?? 90;
  const perShip = ships.map((s) => ({ ref: s.ref, ...simulateAttacker(s.profile, s.weapons, target, opts) }));
  const total = perShip.reduce((s, x) => s + x.total, 0);
  const dps = timeWindow > 0 ? total / timeWindow : 0;
  return { perShip, total, dps };
}
