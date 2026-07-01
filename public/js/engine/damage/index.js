// public/js/engine/damage/index.js
/**
 * Damage engine public API. Page-agnostic: callers build AttackerProfile +
 * WeaponDescriptor[] + TargetProfile (see makeTarget) and call simulate*.
 */
import { computeHitDamage } from './formula.js';
import { computeSalvo } from './salvo.js';
import { calculateReloadTime } from './reload.js';
import { rollUpWeapon } from './timeline.js';

export { computeHitDamage } from './formula.js';
export { computeSalvo } from './salvo.js';
export { countSalvos, rollUpWeapon } from './timeline.js';
export { calculateReloadTime, calculateAirAssistReloadMax } from './reload.js';
export { salvoFiringDuration, weaponSalvoDuration } from './salvo-timing.js';
export { ARMOR_PRESETS, makeTarget, DEFAULT_ADAPT, DEFAULT_ARMOR_REDUCE } from './targets.js';
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
    const reloadInterval = calculateReloadTime(w.reloadMax, attacker.reload);
    // Salvos are spaced by the full fire cycle: reload + salvo firing time + 발사 후 경직 (cycleExtra,
    // a fixed time NOT scaled by the reload stat). reloadInterval is still reported raw for display.
    const cycleInterval = reloadInterval + (w.cycleExtra ?? 0);
    const roll = rollUpWeapon(salvo.expectedSalvo, cycleInterval, { initialDelay: w.initialDelay ?? 0, window: timeWindow });
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
