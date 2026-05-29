// tests/damage-engine/salvo.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSalvo } from '../../public/js/engine/damage/salvo.js';

test('expectedSalvo = expectedHit × bulletsPerSalvo × hitRate', () => {
  const hit = { expectedHit: 1000, hitRate: 0.8 };
  const r = computeSalvo(hit, 6);
  assert.equal(r.expectedSalvo, 4800);   // 1000 * 6 * 0.8
  assert.equal(r.bulletsPerSalvo, 6);
  assert.equal(r.hitRate, 0.8);
  assert.equal(r.perHit, hit);
});

test('zero bullets → zero salvo', () => {
  assert.equal(computeSalvo({ expectedHit: 1000, hitRate: 1 }, 0).expectedSalvo, 0);
});
