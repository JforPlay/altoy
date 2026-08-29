// public/js/engine/damage/clear-check.js
/**
 * Boss clear-check: time-to-kill + whether the fleet kills the boss in time.
 * Pure — no wall-clock, no DOM. Still an optimistic model (no HP-phase mechanics).
 *
 * The kill time is solved off the fleet's cumulative-damage CURVE, not from
 * hp / averageDps. Fleet damage is front-loaded — preloaded mounts and the
 * opening airstrike all land at t=0 — so the average over a full window is lower
 * than the average up to the kill, and dividing by it overstates the kill time
 * (and understates DPS) by however much overkill the window carried.
 */

const PRECISION = 0.05;   // seconds; the readout shows one decimal

/**
 * Smallest t in [0, limit] with damageAt(t) >= bossHp, or Infinity if the boss
 * survives the limit. damageAt must be monotone non-decreasing.
 */
export function solveTimeToKill(damageAt, bossHp, limit, precision = PRECISION) {
  const hp = Number(bossHp) || 0;
  const cap = Number(limit) || 0;
  if (typeof damageAt !== 'function' || hp <= 0 || cap <= 0) return Infinity;
  if (damageAt(cap) < hp) return Infinity;
  if (damageAt(0) >= hp) return 0;              // the alpha strike alone kills it
  let lo = 0, hi = cap;
  while (hi - lo > precision) {
    const mid = (lo + hi) / 2;
    if (damageAt(mid) >= hp) hi = mid; else lo = mid;
  }
  return hi;
}

/**
 * @param {object} o
 * @param {Function} [o.damageAt]  cumulative-damage curve over FIRING time
 * @param {number}   [o.fleetDps]  fallback when no curve is available (flat DPS)
 * @param {number}   o.bossHp
 * @param {number}   o.timeLimit   the fight's time limit, on the battle clock
 * @param {number}   [o.startDelay] seconds of the limit spent before anything fires
 * @returns {{ttkSeconds:number, clears:boolean, hpRemaining:number}} ttkSeconds is
 *   on the battle clock (startDelay included), so it compares directly to timeLimit.
 */
export function computeClearCheck({ damageAt, fleetDps, bossHp, timeLimit, startDelay = 0 }) {
  const hp = Number(bossHp) || 0;
  const limit = Number(timeLimit) || 0;
  const delay = Number(startDelay) || 0;
  const usable = Math.max(0, limit - delay);

  if (typeof damageAt === 'function') {
    const t = solveTimeToKill(damageAt, hp, usable);
    return {
      ttkSeconds: Number.isFinite(t) ? t + delay : Infinity,
      clears: Number.isFinite(t),
      hpRemaining: Math.max(0, hp - damageAt(usable)),
    };
  }

  const dps = Number(fleetDps) || 0;
  if (dps <= 0 || hp <= 0) return { ttkSeconds: Infinity, clears: false, hpRemaining: hp };
  const ttkSeconds = hp / dps + delay;
  return { ttkSeconds, clears: ttkSeconds <= limit, hpRemaining: Math.max(0, hp - dps * usable) };
}
