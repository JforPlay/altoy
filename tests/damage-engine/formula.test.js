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

// --- 대갑 타상 / 특수 종류 / 탄약 종류 (battleformulas.lua:156 terms 5, 8, 10) ---
// Each is its own multiply, so every case is asserted as a RATIO against the SAME
// target carrying a bare weapon — that cancels armorMod/crit/hit and pins the new
// term's shape alone, without re-deriving floats.
const bare = computeHitDamage(attacker, cannon, lightTgt).expectedHit;
const gain = (w, t) => {
  const tgt = { ...lightTgt, ...t };
  return computeHitDamage(attacker, { ...cannon, ...w }, tgt).expectedHit
       / computeHitDamage(attacker, cannon, tgt).expectedHit;
};

test('대갑 타상 계수 indexes on the TARGET armor class', () => {
  const w = { armorDamageRatio: { 1: 0.15, 3: 0.5 } };
  assert.ok(approx(gain(w, {}), 1.15, 1e-9));                     // light → the _1 entry
  assert.ok(approx(gain(w, { armorType: 2 }), 1, 1e-9));          // medium → no entry, no term
  assert.ok(approx(gain(w, { armorType: 3 }), 1.5, 1e-9));
});

test('특수 종류 피해 compounds per tag the target carries, and only those', () => {
  const w = { tagDamageRatio: { T_5: 0.1, N_99: 0.1, T_1: 9 } };
  assert.ok(approx(gain(w, { tags: ['T_5'] }), 1.1, 1e-9));
  // MULTIPLICATIVE, not summed: GetTagAttr multiplies (1 + n) per matching tag.
  assert.ok(approx(gain(w, { tags: ['T_5', 'N_99'] }), 1.21, 1e-9));
  // T_1 is worth +900% but the target is not a destroyer, so it never applies.
  assert.ok(approx(gain(w, { tags: ['T_2', 'N_97'] }), 1, 1e-9));
  assert.ok(approx(gain(w, {}), 1, 1e-9));                        // target with no tags
});

test('탄약 종류 피해 is the attacker bonus minus the target resist', () => {
  assert.ok(approx(gain({ ammoDamageRatio: 0.25 }, {}), 1.25, 1e-9));
  // The defender half rides the TARGET, so it is measured against the bare fixture
  // (same armor class, so armorMod cancels).
  const resisted = computeHitDamage(attacker, cannon, { ...lightTgt, ammoReduce: 0.2 }).expectedHit;
  assert.ok(approx(resisted / bare, 0.8, 1e-9));
  const both = computeHitDamage(attacker, { ...cannon, ammoDamageRatio: 0.25 },
    { ...lightTgt, ammoReduce: 0.1 }).expectedHit;
  assert.ok(approx(both / bare, 1.15, 1e-9));
});

test('the three terms multiply together and with damageRatioBullet', () => {
  const g = gain(
    { armorDamageRatio: { 1: 0.15 }, tagDamageRatio: { T_5: 0.1 }, ammoDamageRatio: 0.25, damageRatio: 0.2 },
    { tags: ['T_5'] },
  );
  assert.ok(approx(g, 1.15 * 1.1 * 1.25 * 1.2, 1e-9));
});

test('a weapon carrying none of them is unchanged', () => {
  assert.equal(computeHitDamage(attacker, cannon, { ...lightTgt, tags: ['T_5', 'N_99'] }).expectedHit, bare);
});
