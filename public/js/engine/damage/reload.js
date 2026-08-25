// public/js/engine/damage/reload.js
/**
 * Reload timing — port of battleformulas.lua CalculateReloadTime (:313)
 * and CaclulateAirAssistReloadMax (:326). Pure; full float precision
 * (callers round for display). Mirrors fleet-sim.calc.js _reloadFormula.
 */
import { RELOAD_K1, RELOAD_K2, RELOAD_K3, AIR_ASSIST_RELOAD_RATIO } from './constants.js';

/** Seconds between volleys: reloadMax / K1 / sqrt((reloadStat + K2) × K3). */
export function calculateReloadTime(reloadMax, reloadStat) {
  const denom = RELOAD_K1 * Math.sqrt((reloadStat + RELOAD_K2) * RELOAD_K3);
  if (!Number.isFinite(denom) || denom === 0) return 0;
  return reloadMax / denom;
}

/** Carrier combined airstrike reload_max = average(reload_max) × 2.2. */
export function calculateAirAssistReloadMax(reloadMaxValues) {
  if (!reloadMaxValues || reloadMaxValues.length === 0) return 0;
  const sum = reloadMaxValues.reduce((a, b) => a + b, 0);
  return (sum / reloadMaxValues.length) * AIR_ASSIST_RELOAD_RATIO;
}

/**
 * Seconds between a weapon's salvos, including the fixed 발사 후 경직 the reload
 * stat does NOT scale. Exported so callers that need a salvo count (the barrage
 * adapter) derive it from the same line simulateAttacker uses, rather than a
 * second copy that can drift.
 */
export function weaponCycleInterval(weapon, reloadStat) {
  return calculateReloadTime(weapon.reloadMax, reloadStat) + (weapon.cycleExtra ?? 0);
}
