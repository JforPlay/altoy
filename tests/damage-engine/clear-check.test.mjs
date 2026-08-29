import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeClearCheck } from '../../public/js/engine/damage/clear-check.js';

test('clears when ttk within the time limit', () => {
  const r = computeClearCheck({ fleetDps: 2000, bossHp: 54000, timeLimit: 90 });
  assert.equal(r.clears, true);
  assert.ok(Math.abs(r.ttkSeconds - 27) < 1e-9);
  assert.equal(r.hpRemaining, 0);
});

test('does not clear when ttk exceeds the limit; reports leftover HP', () => {
  const r = computeClearCheck({ fleetDps: 2000, bossHp: 300000, timeLimit: 90 });
  assert.equal(r.clears, false);
  assert.ok(Math.abs(r.ttkSeconds - 150) < 1e-9);
  assert.equal(r.hpRemaining, 300000 - 2000 * 90); // 120000
});

test('zero DPS never clears and leaves full HP', () => {
  const r = computeClearCheck({ fleetDps: 0, bossHp: 54000, timeLimit: 90 });
  assert.equal(r.clears, false);
  assert.equal(r.ttkSeconds, Infinity);
  assert.equal(r.hpRemaining, 54000);
});

// --- curve-based kill time (the fleet stops firing when the boss dies) ---

import { solveTimeToKill } from '../../public/js/engine/damage/clear-check.js';

/** Front-loaded fleet: a 40k alpha strike at t=0, then 1000/s. */
const frontLoaded = (t) => (t < 0 ? 0 : 40000 + 1000 * t);

test('solveTimeToKill finds the crossing on the curve, not hp/avgDps', () => {
  // 90k HP: the curve crosses at 50s. The full-window average would be
  // (40000 + 1000*90)/90 = 1444/s → hp/avgDps = 62.2s, which is 12s too late.
  const t = solveTimeToKill(frontLoaded, 90000, 90);
  assert.ok(Math.abs(t - 50) < 0.1, `ttk ${t}`);
  assert.ok(t < 90000 / (frontLoaded(90) / 90), 'front-loaded damage must kill sooner than the average implies');
});

test('solveTimeToKill returns Infinity when the boss survives the limit', () => {
  assert.equal(solveTimeToKill(frontLoaded, 500000, 90), Infinity);
});

test('solveTimeToKill returns 0 when the alpha strike alone kills', () => {
  assert.equal(solveTimeToKill(frontLoaded, 30000, 90), 0);
});

test('the start delay eats into the usable time and rides on the reported ttk', () => {
  // 80s META limit, 2s before anything fires → 78s of firing.
  const r = computeClearCheck({ damageAt: frontLoaded, bossHp: 90000, timeLimit: 80, startDelay: 2 });
  assert.equal(r.clears, true);
  assert.ok(Math.abs(r.ttkSeconds - 52) < 0.1, `ttk ${r.ttkSeconds}`);   // 50s of firing + the 2s lead-in
  assert.equal(r.hpRemaining, 0);

  // Right at the boundary: 78s of firing deals 118k, so 118,001 does not clear.
  const miss = computeClearCheck({ damageAt: frontLoaded, bossHp: 118001, timeLimit: 80, startDelay: 2 });
  assert.equal(miss.clears, false);
  assert.equal(miss.ttkSeconds, Infinity);
  assert.equal(miss.hpRemaining, 1);
});
