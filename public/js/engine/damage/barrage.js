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

/**
 * Salvos this trigger watches.
 *
 * `t.a` is a weapon-class marker the engine states in the trigger NAME:
 * BattleTorpedoUnit overrides TriggerBuffOnFire to raise onTorpedoWeaponFire, so
 * an `onFire` buff never sees a torpedo and vice versa. Without it a destroyer's
 * main gun counts toward a torpedo trigger — ~32 activations where the text says
 * four. The class rides the attack ATTRIBUTE rather than a slot index because the
 * torpedo slot moves by hull; a class that is slot-stable (the 전함 주포 charge
 * weapon) ships as `t.slots` instead, which already means exactly that.
 */
function _salvos(t, ctx) {
  if (t.a) return (ctx.salvosByAttr || {})[t.a] || 0;
  const map = ctx.salvosBySlot || {};
  const keys = (t.slots && t.slots.length) ? t.slots : Object.keys(map);
  let n = 0;
  for (const k of keys) n += map[k] || 0;
  return n;
}

/**
 * @param {{t:{k:string,n?:number,d?:number,slots?:number[],a?:string,life?:number}, p?:number, q?:number}} rec
 * @param {{window:number, salvosBySlot:object, salvosByAttr?:object, airstrikes:number}} ctx
 * @returns {number} expected activations over the window (>= 0, may be fractional)
 */
export function barrageActivations(rec, ctx) {
  const t = rec && rec.t;
  if (!t) return 0;
  const p = (rec.p ?? RANT_FULL) / RANT_FULL;
  const full = ctx.window ?? 0;
  // A cast can only fire while the buff holding it is alive. `t.life` is when that
  // buff expires, counted from the start of battle, and is emitted only when
  // nothing re-adds it — so it bounds the window outright (나토리 17120's support
  // strike is "전투 시작 후 30초 안에", not for the whole fight).
  const window = t.life != null ? Math.min(full, t.life) : full;
  // Salvos and airstrikes are uniform in time, so the same bound scales them.
  const scale = full > 0 ? window / full : 0;
  let n = 0;

  if (t.k === 'count') {
    n = Math.floor(_salvos(t, ctx) * scale / t.n) * p;
  } else if (t.k === 'timer') {
    n = (Math.floor((window - (t.d ?? 0)) / t.n) + 1) * p;
  } else if (t.k === 'fire') {
    const salvos = _salvos(t, ctx) * scale;
    if (salvos <= 0) return 0;
    // Average gap between qualifying fire events; a failed roll costs one gap,
    // so the expected wait for a success after the cooldown is gap / p.
    const gap = window / salvos;
    const period = (t.n || 0) + gap / p;
    n = Math.min(Math.floor((window - (t.d ?? 0)) / period) + 1, salvos);
  } else if (t.k === 'air') {
    n = (ctx.airstrikes || 0) * scale * p;
  } else if (t.k === 'once') {
    n = 1 * p;
  } else {
    return 0;               // unknown kind: contribute nothing, never guess
  }

  n = Math.max(0, n);
  return rec.q != null ? Math.min(n, rec.q) : n;
}
