// tests/damage-engine/timeline.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSalvos, rollUpWeapon } from '../../public/js/engine/damage/timeline.js';

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('countSalvos: ready-at-0 model = floor((window-delay)/interval) + 1', () => {
  assert.equal(countSalvos(6, 0, 90), 16);   // floor(90/6)+1
  assert.equal(countSalvos(7, 0, 90), 13);   // floor(12.85)+1
  assert.equal(countSalvos(10, 5, 90), 9);   // floor(8.5)+1
});

test('countSalvos: guards', () => {
  assert.equal(countSalvos(0, 0, 90), 0);    // no reload
  assert.equal(countSalvos(6, 100, 90), 0);  // delay past window
});

test('rollUpWeapon: total = salvo × count, dps = total / window', () => {
  const r = rollUpWeapon(1000, 6, { window: 90 });
  assert.equal(r.salvoCount, 16);
  assert.equal(r.total, 16000);
  assert.ok(approx(r.dps, 16000 / 90));
});
