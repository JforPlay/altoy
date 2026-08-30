// public/js/engine/damage/dot.js
/**
 * DOT (지속 피해 / 점화) scheduling. Turns a fleet_sim_dots.json record plus the
 * barrage that carries it into an expected tick count over the battle window.
 * Pure: no DOM, no wall-clock, no input mutation.
 *
 * Every term is read from the KR battle Lua, and most of them cancel:
 *  - battlebuffdot.lua CalcNumber — one tick is floor(number + igniteDMG), with
 *    igniteDMG = weapon:GetCorrectedDMG() * (1 + attr*0.01) * k
 *    (battleformulas.lua:195). `stack` is 1 on every reachable buff and
 *    repressReduce is 1 outside chapter suppression, and DOT_CONFIG[dotType]
 *    names no attr a modelled ship or boss carries, so the stack, suppression
 *    and (1 + enhanceRate) terms are all identity here.
 *  - The tick BYPASSES armor. HandleDirectDamage (battledataproxylogic.lua:173)
 *    goes straight to UpdateHP with no armor type, ammo type or damage-type
 *    lookup, which is why a burn is its own lane rather than a fake weapon.
 *  - onTrigger dispatches by the effect's OWN trigger list
 *    (battlebuffunit.lua:244) and no bullet-reachable DOT lists `onRemove`
 *    (0 of 76), so there is no extra tick on expiry: a burn ticks for exactly as
 *    long as it is up.
 *  - battledataproxylogic.lua:144 attaches on hit unless `hit_ignore` (2 of 161
 *    barrage-carried burns), and HandleBuffPlacer then rolls `rant`.
 *    CaclulateDOTPlace's accuracy/resist attrs are 0 for both sides here, so the
 *    roll is a flat rant/10000.
 *  - AddBuff on an already-present buff Stacks it (battleunit.lua:976), which
 *    refreshes the expiry but leaves `_nextEffectTime` alone — re-application
 *    EXTENDS a burn instead of restarting its tick clock. That is why this counts
 *    total uptime and not ticks-per-application.
 */
import { PERCENT } from './constants.js';

const RANT_FULL = 10000;

/** P(at least one bullet of a volley lands the buff). */
export function dotApplyChance({ rant, bullets, hitRate = 1, hitIgnore = false }) {
  const p = ((rant ?? RANT_FULL) / RANT_FULL) * (hitIgnore ? 1 : hitRate);
  if (!(p > 0) || !(bullets > 0)) return 0;
  return 1 - (1 - p) ** bullets;
}

/**
 * Seconds the burn is up over `window`: the union of `applications` lifetimes
 * spread uniformly through it, which is the same uniform-in-time assumption
 * barrageActivations already makes for salvos. `life` 0 means the buff never
 * expires (3 of the 76 reachable buffs, 라이온's among them).
 *
 * The two regimes it has to get right are re-application faster than the burn
 * decays (uptime saturates at the window) and slower (uptime is the sum of
 * separate burns); min(gap, life) covers both from one expression.
 */
export function dotUptime(life, applications, window) {
  if (!(applications > 0) || !(window > 0)) return 0;
  const gap = window / applications;
  return Math.min(window, applications * (life > 0 ? Math.min(gap, life) : gap));
}

/**
 * @param {{life:number,int:number,a:string,num:number,k:number,chp?:number,inj?:number,lv?:object}} rec
 * @param {{window:number, activations:number, bullets:number, hitRate?:number,
 *          rant?:number, hitIgnore?:boolean, level?:number,
 *          correctedDmg:number, stat:number}} ctx
 * @returns {{ticks:number, tickDamage:number, uptime:number, interval:number}|null}
 *   null when the record needs something the sim does not track — the caller
 *   discloses those rather than dropping them silently.
 *
 * Ticks are floor(uptime / interval), which is exact in both regimes above and
 * can be one high across several short disjoint burns (life 4 vs a 3.5s tick).
 */
export function dotSchedule(rec, ctx) {
  if (!rec || !(rec.int > 0)) return null;
  // Level comes from the BULLET's attach_buff.buff_level, never from the ship's
  // skill level — the same explicit-level doctrine as the barrage table and the
  // equip tier ids. 75 of 76 buffs have no ladder at all.
  const payload = (rec.lv && ctx.level != null && rec.lv[String(ctx.level)]) || rec;
  // A share of the target's CURRENT hp. The sim carries no hp timeline, so this
  // is disclosed instead of guessed at. 0 of the reachable records today.
  if (payload.chp) return null;
  const applications = ctx.activations * dotApplyChance(ctx);
  const uptime = dotUptime(rec.life, applications, ctx.window);
  const tickDamage = Math.max(0, Math.floor(
    (payload.num || 0) + ctx.correctedDmg * (1 + ctx.stat * PERCENT) * (payload.k || 0)));
  return { ticks: Math.floor(uptime / rec.int), tickDamage, uptime, interval: rec.int };
}
