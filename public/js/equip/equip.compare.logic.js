/**
 * equip.compare.logic.js
 * -----------------------
 * Pure comparison + 이론 DPS logic — NO DOM, node-testable. The compare modal
 * (equip.compare.js) resolves each equip's stat values at its chosen level into row
 * descriptors, then asks this module to flag the best/worst cell per row. Kept
 * separate (and import-free) so the tricky comparison rules — inverted "lower is
 * better" for 사속, null/absent handling, ties — are unit-tested in isolation
 * (tests/equip/compare.logic.test.mjs). See expression-face.js for the same
 * "pure core, node-tested" pattern.
 * The DPS pair (theoreticalDps + formatDps) is shared: the compare modal AND the
 * single-equip detail panel (equip.detail.js) both render 이론 DPS from it.
 */

/**
 * Flag each column's value in one stat row as 'best' | 'worst' | 'neutral'.
 * @param {(number|null)[]} values  resolved numeric value per equip column
 * @param {'higher'|'lower'|'none'} dir  'higher' = bigger wins, 'lower' = smaller
 *        wins (e.g. 사속 reload time), 'none' = plain text, never flagged.
 * Rules: null/NaN are always neutral and never count as best/worst; at least two
 * distinct present values are needed to flag anything (all-equal → all neutral).
 */
export function compareRowFlags(values, dir) {
    if (dir === 'none') return values.map(() => 'neutral');

    const present = values.filter(v => typeof v === 'number' && !Number.isNaN(v));
    if (present.length < 2) return values.map(() => 'neutral');

    const max = Math.max(...present);
    const min = Math.min(...present);
    if (max === min) return values.map(() => 'neutral');

    const bestVal = dir === 'lower' ? min : max;
    const worstVal = dir === 'lower' ? max : min;

    return values.map(v => {
        if (typeof v !== 'number' || Number.isNaN(v)) return 'neutral';
        if (v === bestVal) return 'best';
        if (v === worstVal) return 'worst';
        return 'neutral';
    });
}

/**
 * Equip-only "이론 DPS" (theoretical damage-per-second) against ONE armor type.
 * Cannon-form, cross-checked against battleformulas.lua and engine/damage/formula.js:
 *   DPS = damage × (coefficient/100) × bullets × armorMod / reloadSeconds
 * Deliberately ship-independent — it OMITS firepower-stat scaling, accuracy/crit,
 * and the live reload-stat (callers pass the viewer's baseline 사속). So it's a
 * RELATIVE figure for ranking same-group equips, not an in-battle number. The
 * aircraft-AA "RoF×2.2 + cooldown" cadence is intentionally not modeled (ALtoy's
 * reload_max is already at airstrike scale; the ×2.2 is AA-strafe-specific).
 * @param {{damage:number, coefficient:?number, bullets:number, armorMod:?number, reloadSeconds:number}} p
 * @returns {number|null} DPS, or null when any required input is missing/non-positive/NaN.
 */
export function theoreticalDps({ damage, coefficient, bullets, armorMod, reloadSeconds }) {
  const coef = (coefficient == null ? 100 : coefficient) / 100;
  const mod = armorMod == null ? 1 : armorMod;
  // Required positives; coefficient/armorMod may legitimately be <1 but must be finite numbers.
  if (!(damage > 0) || !(bullets > 0) || !(reloadSeconds > 0)) return null;
  if (!Number.isFinite(coef) || !Number.isFinite(mod)) return null;
  return (damage * coef * bullets * mod) / reloadSeconds;
}

/**
 * Format a theoretical-DPS number for display: integers at/above 100 (sub-unit
 * precision is noise at that scale), one decimal below. Shared by the compare
 * modal and the detail panel so both render DPS identically.
 * @param {number} dps
 * @returns {string}
 */
export function formatDps(dps) {
  return dps >= 100 ? String(Math.round(dps)) : dps.toFixed(1);
}

/**
 * Airstrike full-cycle multiplier for aircraft surface DPS. An airstrike's effective
 * period is the launcher reload × this (plane launch + flight + ordnance drop), per the
 * AL wiki's Surface DPS (Module:Thebombzen/EquipmentList) — verified exact against 와이번
 * (50.04) and 시제형 스피어피쉬 (60.53). Surface mounts do NOT use it.
 */
export const AIRCRAFT_DPS_FACTOR = 2.2;

/**
 * Combined "이론 DPS" per armor type [경장, 중형, 중장], summed over an equip's surface weapons.
 * Surface mounts: each weapon's own firing cycle = `reloadSeconds + cycleExtra`, where cycleExtra
 * is the salvo firing time + post-fire 경직 (auto_aftercast) — the wiki's gun cycle, verified to
 * the cent (see equip.data.js). Aircraft: ORDNANCE only — strafing guns (`w.isGun`, weapon type 4)
 * are dropped — over `airstrikeReload × AIRCRAFT_DPS_FACTOR` (a bomb's internal reload is
 * meaningless; the ×2.2 already owns the airstrike cycle, so aircraft IGNORE cycleExtra). Each
 * weapon contributes its OWN armor mod, so the three totals diverge (a torpedo and rockets pull
 * opposite ways). Excludes ship firepower/reload stats → a RELATIVE figure.
 * @param {{damage:number, coefficient:?number, bullets:number, mods:?[number,number,number], reloadSeconds:?number, cycleExtra:?number, isGun:boolean}[]} weapons
 * @param {{isAircraft:boolean, airstrikeReload:?number}} ctx
 * @returns {?[number,number,number]} per-armor DPS totals, or null when nothing qualifies.
 */
export function combinedSurfaceDps(weapons, { isAircraft, airstrikeReload }) {
  const totals = [0, 0, 0];
  let any = false;
  const airReload = isAircraft && airstrikeReload > 0 ? airstrikeReload * AIRCRAFT_DPS_FACTOR : null;
  for (const w of weapons) {
    if (isAircraft && w.isGun) continue; // strafing/AA gun — not surface DPS
    if (!w.mods) continue;
    // Surface cadence is the full fire cycle (reload + salvo time + aftercast); aircraft use ×2.2.
    const reloadSeconds = isAircraft
      ? airReload
      : (w.reloadSeconds == null ? w.reloadSeconds : w.reloadSeconds + (w.cycleExtra || 0));
    for (let a = 0; a < 3; a++) {
      const dps = theoreticalDps({
        damage: w.damage, coefficient: w.coefficient, bullets: w.bullets,
        armorMod: w.mods[a], reloadSeconds,
      });
      if (dps != null) { totals[a] += dps; any = true; }
    }
  }
  return any ? totals : null;
}

/**
 * Attach a best/worst/neutral flag to every cell of every row descriptor.
 * @param {{label:string, dir:string, cells:{value:(number|null), display:string}[]}[]} rows
 * @returns the same rows (metadata preserved) with `cells[i].flag` set, EXCLUDING
 *          rows where every cell displays '-' (no compared item carries that stat).
 */
export function buildComparisonRows(rows) {
    return rows
        .filter(row => row.cells.some(c => c.display !== '-'))
        .map(row => {
            const flags = compareRowFlags(row.cells.map(c => c.value), row.dir);
            return { ...row, cells: row.cells.map((c, i) => ({ ...c, flag: flags[i] })) };
        });
}
