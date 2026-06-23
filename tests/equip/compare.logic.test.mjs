import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareRowFlags,
  buildComparisonRows,
  theoreticalDps,
  formatDps,
  combinedSurfaceDps,
  AIRCRAFT_DPS_FACTOR,
} from '../../public/js/equip/equip.compare.logic.js';

const round2 = arr => arr.map(x => Math.round(x * 100) / 100);

// ===== compareRowFlags =====

test('compareRowFlags: higher-is-better flags max best, min worst', () => {
  assert.deepEqual(compareRowFlags([10, 20, 30], 'higher'), ['worst', 'neutral', 'best']);
});

test('compareRowFlags: lower-is-better (사속) inverts — min best, max worst', () => {
  assert.deepEqual(compareRowFlags([10, 20, 30], 'lower'), ['best', 'neutral', 'worst']);
});

test('compareRowFlags: dir "none" never flags', () => {
  assert.deepEqual(compareRowFlags([10, 20, 30], 'none'), ['neutral', 'neutral', 'neutral']);
});

test('compareRowFlags: nulls are neutral and never win/lose', () => {
  assert.deepEqual(compareRowFlags([null, 20, 30], 'higher'), ['neutral', 'worst', 'best']);
});

test('compareRowFlags: needs >=2 present values to flag anything', () => {
  assert.deepEqual(compareRowFlags([null, null, 5], 'higher'), ['neutral', 'neutral', 'neutral']);
});

test('compareRowFlags: all-equal values are all neutral', () => {
  assert.deepEqual(compareRowFlags([5, 5, 5], 'higher'), ['neutral', 'neutral', 'neutral']);
});

test('compareRowFlags: ties at the best both flagged best', () => {
  assert.deepEqual(compareRowFlags([30, 30, 10], 'higher'), ['best', 'best', 'worst']);
});

test('compareRowFlags: NaN treated like null (neutral)', () => {
  assert.deepEqual(compareRowFlags([NaN, 20, 30], 'higher'), ['neutral', 'worst', 'best']);
});

test('compareRowFlags: two values, lower-is-better', () => {
  assert.deepEqual(compareRowFlags([1.25, 2.5], 'lower'), ['best', 'worst']);
});

// ===== buildComparisonRows =====

test('buildComparisonRows: attaches flags per cell and keeps metadata', () => {
  const rows = buildComparisonRows([
    { label: '포격', dir: 'higher', cells: [
      { value: 10, display: '10' },
      { value: 30, display: '30' },
    ] },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, '포격');
  assert.equal(rows[0].dir, 'higher');
  assert.deepEqual(rows[0].cells.map(c => c.flag), ['worst', 'best']);
  assert.deepEqual(rows[0].cells.map(c => c.display), ['10', '30']);
});

test('buildComparisonRows: drops rows where every cell displays "-"', () => {
  const rows = buildComparisonRows([
    { label: '대잠', dir: 'higher', cells: [
      { value: null, display: '-' },
      { value: null, display: '-' },
    ] },
    { label: '포격', dir: 'higher', cells: [
      { value: 5, display: '5' },
      { value: 9, display: '9' },
    ] },
  ]);
  assert.deepEqual(rows.map(r => r.label), ['포격']);
});

test('buildComparisonRows: keeps a row where only one item has the stat (all neutral)', () => {
  const rows = buildComparisonRows([
    { label: '대공', dir: 'higher', cells: [
      { value: 40, display: '40' },
      { value: null, display: '-' },
    ] },
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].cells.map(c => c.flag), ['neutral', 'neutral']);
});

// ===== theoreticalDps =====
// DPS = damage × (coefficient/100) × bullets × armorMod / reloadSeconds
// (cannon-form equip-only "이론 DPS"; excludes ship firepower/reload stats).

test('theoreticalDps: full formula — damage×coef×bullets×armorMod/reload', () => {
  // 80 × 1.25 × 2 × 0.8 / 4 = 40
  assert.equal(theoreticalDps({ damage: 80, coefficient: 125, bullets: 2, armorMod: 0.8, reloadSeconds: 4 }), 40);
});

test('theoreticalDps: coefficient defaults to 100% when null', () => {
  // 80 × 1 × 1 × 1 / 4 = 20
  assert.equal(theoreticalDps({ damage: 80, coefficient: null, bullets: 1, armorMod: 1, reloadSeconds: 4 }), 20);
});

test('theoreticalDps: armorMod defaults to 1 when null', () => {
  // 100 × 1 × 1 × 1 / 2 = 50
  assert.equal(theoreticalDps({ damage: 100, coefficient: 100, bullets: 1, armorMod: null, reloadSeconds: 2 }), 50);
});

test('theoreticalDps: bullets multiply the volley', () => {
  const one = theoreticalDps({ damage: 50, coefficient: 100, bullets: 1, armorMod: 1, reloadSeconds: 5 });
  const four = theoreticalDps({ damage: 50, coefficient: 100, bullets: 4, armorMod: 1, reloadSeconds: 5 });
  assert.equal(four, one * 4);
});

test('theoreticalDps: a weaker armorMod yields proportionally lower DPS', () => {
  const light = theoreticalDps({ damage: 60, coefficient: 100, bullets: 1, armorMod: 1.0, reloadSeconds: 3 });
  const heavy = theoreticalDps({ damage: 60, coefficient: 100, bullets: 1, armorMod: 0.4, reloadSeconds: 3 });
  assert.equal(heavy, light * 0.4);
});

test('theoreticalDps: missing/zero damage → null (not computable)', () => {
  assert.equal(theoreticalDps({ damage: 0, coefficient: 100, bullets: 1, armorMod: 1, reloadSeconds: 4 }), null);
  assert.equal(theoreticalDps({ damage: null, coefficient: 100, bullets: 1, armorMod: 1, reloadSeconds: 4 }), null);
});

test('theoreticalDps: missing/zero reloadSeconds → null (avoids div-by-zero)', () => {
  assert.equal(theoreticalDps({ damage: 80, coefficient: 100, bullets: 1, armorMod: 1, reloadSeconds: 0 }), null);
  assert.equal(theoreticalDps({ damage: 80, coefficient: 100, bullets: 1, armorMod: 1, reloadSeconds: null }), null);
});

test('theoreticalDps: missing/zero bullets → null', () => {
  assert.equal(theoreticalDps({ damage: 80, coefficient: 100, bullets: 0, armorMod: 1, reloadSeconds: 4 }), null);
});

test('theoreticalDps: NaN inputs → null', () => {
  assert.equal(theoreticalDps({ damage: NaN, coefficient: 100, bullets: 1, armorMod: 1, reloadSeconds: 4 }), null);
  assert.equal(theoreticalDps({ damage: 80, coefficient: 100, bullets: 1, armorMod: NaN, reloadSeconds: 4 }), null);
});

// ===== formatDps =====
// Integers at/above 100 (decimals are noise at that scale); one decimal below.

test('formatDps: below 100 keeps one decimal', () => {
  assert.equal(formatDps(47.36), '47.4');
});

test('formatDps: a small value still shows one decimal', () => {
  assert.equal(formatDps(8), '8.0');
});

test('formatDps: 100 is the boundary — rendered as an integer', () => {
  assert.equal(formatDps(100), '100');
});

test('formatDps: above 100 rounds to an integer', () => {
  assert.equal(formatDps(150.7), '151');
});

// ===== combinedSurfaceDps =====
// Per-armor-type [L,M,H] surface DPS summed over an equip's weapons. Surface mounts use each
// weapon's own reload; aircraft sum ORDNANCE only (guns excluded) over airstrikeReload × 2.2.

test('combinedSurfaceDps: AIRCRAFT_DPS_FACTOR is the wiki airstrike multiplier 2.2', () => {
  assert.equal(AIRCRAFT_DPS_FACTOR, 2.2);
});

test('combinedSurfaceDps: single surface weapon → that weapon DPS per armor, no ×2.2', () => {
  const r = combinedSurfaceDps(
    [{ damage: 100, coefficient: 100, bullets: 1, mods: [1, 0.5, 0.25], reloadSeconds: 2, isGun: false }],
    { isAircraft: false, airstrikeReload: null }
  );
  assert.deepEqual(round2(r), [50, 25, 12.5]);
});

test('combinedSurfaceDps: surface does NOT exclude isGun weapons (exclusion is aircraft-only)', () => {
  const r = combinedSurfaceDps(
    [{ damage: 100, coefficient: 100, bullets: 1, mods: [1, 1, 1], reloadSeconds: 2, isGun: true }],
    { isAircraft: false, airstrikeReload: null }
  );
  assert.deepEqual(round2(r), [50, 50, 50]);
});

test('combinedSurfaceDps: aircraft excludes the gun, divides by airstrikeReload × 2.2', () => {
  // gun skipped; ordnance: 100 × 2 × mod / (10 × 2.2 = 22). Ordnance reloadSeconds is ignored.
  const r = combinedSurfaceDps(
    [
      { damage: 100, coefficient: 100, bullets: 1, mods: [1, 1, 1], reloadSeconds: 1, isGun: true },
      { damage: 100, coefficient: 100, bullets: 2, mods: [0.8, 1, 1.2], reloadSeconds: 99, isGun: false },
    ],
    { isAircraft: true, airstrikeReload: 10 }
  );
  assert.deepEqual(round2(r), [7.27, 9.09, 10.91]);
});

test('combinedSurfaceDps: aircraft sums multiple ordnance, each with its own armor mod', () => {
  // (100×1×1·mod + 50×2×1·mod) / 22 — mirrors Spearfish torpedo + rockets (opposite profiles).
  const r = combinedSurfaceDps(
    [
      { damage: 100, coefficient: 100, bullets: 1, mods: [1, 1, 1], isGun: false },
      { damage: 50, coefficient: 100, bullets: 2, mods: [0.5, 1, 1.5], isGun: false },
    ],
    { isAircraft: true, airstrikeReload: 10 }
  );
  assert.deepEqual(round2(r), [6.82, 9.09, 11.36]);
});

test('combinedSurfaceDps: an all-gun aircraft (fighter) → null (no surface ordnance)', () => {
  const r = combinedSurfaceDps(
    [{ damage: 100, coefficient: 100, bullets: 1, mods: [1, 1, 1], reloadSeconds: 1, isGun: true }],
    { isAircraft: true, airstrikeReload: 10 }
  );
  assert.equal(r, null);
});

test('combinedSurfaceDps: no weapons → null', () => {
  assert.equal(combinedSurfaceDps([], { isAircraft: false, airstrikeReload: null }), null);
});

test('combinedSurfaceDps: aircraft with no airstrike reload → null', () => {
  const r = combinedSurfaceDps(
    [{ damage: 100, coefficient: 100, bullets: 1, mods: [0.8, 1, 1.2], isGun: false }],
    { isAircraft: true, airstrikeReload: null }
  );
  assert.equal(r, null);
});

test('combinedSurfaceDps: weapons with null mods are skipped', () => {
  const r = combinedSurfaceDps(
    [
      { damage: 100, coefficient: 100, bullets: 1, mods: null, reloadSeconds: 2, isGun: false },
      { damage: 100, coefficient: 100, bullets: 1, mods: [1, 1, 1], reloadSeconds: 2, isGun: false },
    ],
    { isAircraft: false, airstrikeReload: null }
  );
  assert.deepEqual(round2(r), [50, 50, 50]);
});

// cycleExtra = salvo firing time + auto_aftercast, extending the SURFACE denominator
// (reloadSeconds + cycleExtra). The wiki's gun cycle; aircraft ignore it (×2.2 already
// captures the airstrike cycle). Absent cycleExtra must behave exactly as before.

test('combinedSurfaceDps: surface cycleExtra extends the denominator (reload + extra)', () => {
  // 100 × 1 / (2 + 0.2 = 2.2) = 45.4545 per armor
  const r = combinedSurfaceDps(
    [{ damage: 100, coefficient: 100, bullets: 1, mods: [1, 1, 1], reloadSeconds: 2, cycleExtra: 0.2, isGun: false }],
    { isAircraft: false, airstrikeReload: null }
  );
  assert.deepEqual(round2(r), [45.45, 45.45, 45.45]);
});

test('combinedSurfaceDps: absent cycleExtra is treated as 0 (backward compatible)', () => {
  const r = combinedSurfaceDps(
    [{ damage: 100, coefficient: 100, bullets: 1, mods: [1, 1, 1], reloadSeconds: 2, isGun: false }],
    { isAircraft: false, airstrikeReload: null }
  );
  assert.deepEqual(round2(r), [50, 50, 50]);
});

test('combinedSurfaceDps: aircraft IGNORE cycleExtra (airstrike ×2.2 owns the cycle)', () => {
  // ordnance 100 × 2 / (10 × 2.2 = 22) = 9.09 — cycleExtra on the descriptor must not apply
  const r = combinedSurfaceDps(
    [{ damage: 100, coefficient: 100, bullets: 2, mods: [1, 1, 1], reloadSeconds: 99, cycleExtra: 5, isGun: false }],
    { isAircraft: true, airstrikeReload: 10 }
  );
  assert.deepEqual(round2(r), [9.09, 9.09, 9.09]);
});
