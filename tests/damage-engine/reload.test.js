// tests/damage-engine/reload.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateReloadTime, calculateAirAssistReloadMax } from '../../public/js/engine/damage/reload.js';

const approx = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

test('calculateReloadTime(240, 100) ≈ 1.59617 (pins K1/K2/K3)', () => {
  // 240 / 6 / sqrt((100+100)*3.14) = 40 / sqrt(628)
  assert.ok(approx(calculateReloadTime(240, 100), 1.59617), 'wrong reload constants');
});

test('higher reload stat → shorter reload time', () => {
  assert.ok(calculateReloadTime(240, 200) < calculateReloadTime(240, 100));
});

test('zero denominator guard returns 0', () => {
  // sqrt((reloadStat+100)*3.14)===0 only if reloadStat=-100; guard returns 0
  assert.equal(calculateReloadTime(240, -100), 0);
});

test('air-assist combined reload = avg × 2.2', () => {
  assert.equal(calculateAirAssistReloadMax([240, 240, 240]), 528); // 240*2.2
  assert.equal(calculateAirAssistReloadMax([100, 200]), 330);      // 150*2.2
  assert.equal(calculateAirAssistReloadMax([]), 0);
});
