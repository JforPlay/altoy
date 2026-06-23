// tests/damage-engine/index.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateAttacker, simulateFleet, makeTarget } from '../../public/js/engine/damage/index.js';

const approx = (a, b, eps = 0.5) => Math.abs(a - b) < eps;

const attacker = { accuracy: 200, luck: 45, level: 125, reload: 200 };
const cannon = {
  attackAttribute: 'cannon', stat: 1000, damage: 100, corrected: 100, ratio: 100,
  potential: 1, bulletsPerSalvo: 3, damageType: [1.0, 0.8, 0.5], ammoType: 1,
  reloadMax: 240, label: '주포',
};

test('simulateAttacker composes formula→salvo→timeline', () => {
  const target = makeTarget('light');           // armorType 1, evasion 94
  const r = simulateAttacker(attacker, [cannon], target, { window: 90 });
  assert.equal(r.perWeapon.length, 1);
  const w = r.perWeapon[0];
  // reloadInterval = 240/6/sqrt((200+100)*3.14) = 40/sqrt(942) ≈ 1.30327
  assert.ok(approx(w.reloadInterval, 1.30327, 1e-3));
  assert.equal(w.salvoCount, Math.floor(90 / w.reloadInterval) + 1);
  assert.ok(approx(w.total, w.oneSalvoExpected * w.salvoCount, 1e-3));
  assert.equal(r.oneShotExpected, w.oneSalvoExpected);
  assert.ok(approx(r.dps, r.total / 90, 1e-6));
});

test('simulateAttacker: cycleExtra lengthens the fire cycle for DPS, not the reported reloadInterval', () => {
  const target = makeTarget('light');
  const r = simulateAttacker(attacker, [{ ...cannon, cycleExtra: 0.4 }], target, { window: 90 });
  const w = r.perWeapon[0];
  // reported reloadInterval stays the PURE reload (display value), unchanged by cycleExtra
  assert.ok(approx(w.reloadInterval, 1.30327, 1e-3));
  // salvo count reflects the longer cycle = reloadInterval + cycleExtra
  const cycle = 1.30327 + 0.4;
  assert.equal(w.salvoCount, Math.floor(90 / cycle) + 1);
});

test('simulateAttacker: absent cycleExtra is unchanged (backward compatible)', () => {
  const target = makeTarget('light');
  const r = simulateAttacker(attacker, [cannon], target, { window: 90 });
  const w = r.perWeapon[0];
  assert.equal(w.salvoCount, Math.floor(90 / w.reloadInterval) + 1);
});

test('simulateFleet sums per-ship totals', () => {
  const target = makeTarget('heavy');
  const ships = [
    { ref: 'a', profile: attacker, weapons: [cannon] },
    { ref: 'b', profile: attacker, weapons: [cannon] },
  ];
  const r = simulateFleet(ships, target, { window: 90 });
  assert.equal(r.perShip.length, 2);
  assert.equal(r.perShip[0].ref, 'a');
  assert.ok(approx(r.total, r.perShip[0].total + r.perShip[1].total, 1e-3));
  assert.ok(approx(r.dps, r.total / 90, 1e-6));
});

test('empty weapons → zero output', () => {
  const r = simulateAttacker(attacker, [], makeTarget('medium'), { window: 90 });
  assert.equal(r.oneShotExpected, 0);
  assert.equal(r.total, 0);
  assert.equal(r.dps, 0);
});
