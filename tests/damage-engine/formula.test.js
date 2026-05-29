// tests/damage-engine/formula.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHitDamage } from '../../public/js/engine/damage/formula.js';

const approx = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

// Shared fixture. stat=1000, ratio=100 → statScale = 1 + 1000*100*1e-4 = 11.
// correctedDmg = 100*1*100*0.01 = 100. base = 11*100 + 1 = 1101.
const attacker = { accuracy: 200, luck: 45, level: 125, reload: 200 };
const cannon = {
  attackAttribute: 'cannon', stat: 1000, damage: 100, corrected: 100, ratio: 100,
  potential: 1, bulletsPerSalvo: 1, damageType: [1.0, 0.8, 0.5], ammoType: 1,
  reloadMax: 240, label: '주포',
};
const lightTgt = { armorType: 1, evasion: 74, antiAir: 150, level: 125, luck: 45 };

test('cannon vs light: base, armorMod, hit/crit, expectedHit', () => {
  const r = computeHitDamage(attacker, cannon, lightTgt);
  assert.equal(r.base, 1101);
  assert.equal(r.armorMod, 1.0);                  // damageType[0]
  assert.equal(r.airMitigation, 1);
  assert.equal(r.levelAdv, 1);                    // same level
  assert.ok(approx(r.hitRate, 0.82464, 1e-4));    // 0.1 + 200/276
  assert.ok(approx(r.critRate, 0.13795, 1e-4));   // 0.05 + 200/2274
  assert.ok(approx(r.expectedHit, 1176.94, 0.1)); // 1101 * (1 + 0.13795*0.5)
});

test('heavy armor uses damageType[2]=0.5', () => {
  const r = computeHitDamage(attacker, cannon, { ...lightTgt, armorType: 3 });
  assert.equal(r.armorMod, 0.5);
  assert.ok(approx(r.expectedHit, 588.47, 0.1));  // half of light
});

test('air attribute applies AA mitigation 150/(AA+150)', () => {
  const air = { ...cannon, attackAttribute: 'air' };
  const r = computeHitDamage(attacker, air, { ...lightTgt, antiAir: 150 });
  assert.equal(r.airMitigation, 0.5);             // 150/300
  assert.ok(approx(r.expectedHit, 588.47, 0.1));  // light armorMod 1.0 × 0.5 mitigation
});

test('level advantage clamps at ±25 × 0.02', () => {
  const r = computeHitDamage({ ...attacker, level: 200 }, cannon, { ...lightTgt, level: 100 });
  assert.equal(r.levelAdv, 1.5);                  // +25 cap × 0.02 = +0.5
});

test('does not mutate inputs', () => {
  const a = { ...attacker }, w = { ...cannon }, t = { ...lightTgt };
  computeHitDamage(a, w, t);
  assert.deepEqual(a, attacker); assert.deepEqual(w, cannon); assert.deepEqual(t, lightTgt);
});
