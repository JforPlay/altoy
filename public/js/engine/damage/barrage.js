// public/js/engine/damage/barrage.js
/**
 * Barrage (탄막) activation rates. Converts a fleet_sim_barrages.json trigger
 * record into an EXPECTED activation count over the battle window, mirroring
 * the KR battle Lua. Pure: no DOM, no wall-clock, no input mutation.
 *
 * The two rant semantics are NOT interchangeable, and both are read from source:
 *  - count: battlebuffeffect.lua:783-791 resets the counter unless the cast
 *    returned "overheat". A failed proc returns "chance", so it STILL consumes
 *    the counter -> rant is a plain multiply.
 *  - fire:  battlebuffcastskill.lua checks rant BEFORE casting and calls
 *    enterCoolDown only after a success, so a failed proc does NOT start the
 *    cooldown -> rant widens the period instead of scaling the count.
 */

const RANT_FULL = 10000;

/** Salvos fired by the slots this trigger watches; no slot list means all of them. */
function _salvos(slots, salvosBySlot) {
  const map = salvosBySlot || {};
  const keys = (slots && slots.length) ? slots : Object.keys(map);
  let n = 0;
  for (const k of keys) n += map[k] || 0;
  return n;
}

/**
 * @param {{t:{k:string,n?:number,d?:number,slots?:number[]}, p?:number, q?:number}} rec
 * @param {{window:number, salvosBySlot:object, airstrikes:number}} ctx
 * @returns {number} expected activations over the window (>= 0, may be fractional)
 */
export function barrageActivations(rec, ctx) {
  const t = rec && rec.t;
  if (!t) return 0;
  const p = (rec.p ?? RANT_FULL) / RANT_FULL;
  const window = ctx.window ?? 0;
  let n = 0;

  if (t.k === 'count') {
    n = Math.floor(_salvos(t.slots, ctx.salvosBySlot) / t.n) * p;
  } else if (t.k === 'timer') {
    n = (Math.floor((window - (t.d ?? 0)) / t.n) + 1) * p;
  } else if (t.k === 'fire') {
    const salvos = _salvos(t.slots, ctx.salvosBySlot);
    if (salvos <= 0) return 0;
    // Average gap between qualifying fire events; a failed roll costs one gap,
    // so the expected wait for a success after the cooldown is gap / p.
    const gap = window / salvos;
    const period = (t.n || 0) + gap / p;
    n = Math.min(Math.floor((window - (t.d ?? 0)) / period) + 1, salvos);
  } else if (t.k === 'air') {
    n = (ctx.airstrikes || 0) * p;
  } else if (t.k === 'once') {
    n = 1 * p;
  } else {
    return 0;               // unknown kind: contribute nothing, never guess
  }

  n = Math.max(0, n);
  return rec.q != null ? Math.min(n, rec.q) : n;
}
