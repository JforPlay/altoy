// public/js/engine/damage/salvo-timing.js
/**
 * Salvo firing time ("VT" / volley time) from barrage config — the span a weapon
 * spends emitting one volley, BEFORE it can begin its post-fire recovery + reload.
 * The AL wiki folds this into a gun's effective fire cycle:
 *   cycle = reloadSeconds + salvoFiringDuration + auto_aftercast
 * (verified to the cent vs the wiki for 100mm 98식改 / 127mm 5식 / 138.6mm Mle1934 —
 * see equip.data.js getTheoreticalSurfaceDps and fleet-sim.damage.js).
 *
 * Pure; takes raw barrage rows (or a getBarrage lookup) so both adapters share it —
 * equip-viewer 이론 DPS and fleet-sim combat DPS. Mirrors the param shape of
 * fleet-sim.damage.js barrageBulletCount(barrageIds, getBarrage).
 *
 * NOTE: models the steady inter/intra spacing (first_delay + senior_repeat×senior_delay
 * + primal_repeat×delay). The incremental `delta_delay` ramp is NOT modeled — it is 0
 * for the verified cases; add it here if a delta_delay weapon ever needs cent accuracy.
 */

/** Span from first to last bullet of ONE barrage row, in seconds (0 for a single shot / null). */
export function salvoFiringDuration(barrage) {
  if (!barrage) return 0;
  const firstDelay = barrage.first_delay || 0;
  const interWave = (barrage.senior_repeat || 0) * (barrage.senior_delay || 0);
  const intraWave = (barrage.primal_repeat || 0) * (barrage.delay || 0);
  return firstDelay + interWave + intraWave;
}

/**
 * A weapon's salvo firing time: the LONGEST barrage span across its barrage_ID
 * (barrages in one volley fire together, so the weapon is busy until the last finishes).
 * @param {number[]} barrageIds  weapon_property.barrage_ID
 * @param {(id:number)=>object|null} getBarrage  id → barrage row
 * @returns {number} seconds (0 when there are no resolvable barrages)
 */
export function weaponSalvoDuration(barrageIds, getBarrage) {
  if (!Array.isArray(barrageIds)) return 0;
  let max = 0;
  for (const id of barrageIds) {
    const span = salvoFiringDuration(getBarrage(id));
    if (span > max) max = span;
  }
  return max;
}
