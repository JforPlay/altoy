// tests/damage-engine/index.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateAttacker, simulateFleet, makeTarget, weaponCycleInterval, calculateReloadTime } from '../../public/js/engine/damage/index.js';

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

test('weaponCycleInterval matches what simulateAttacker uses internally', () => {
  const w = { reloadMax: 240, cycleExtra: 1.5 };
  const direct = weaponCycleInterval(w, 150);
  assert.ok(Math.abs(direct - (calculateReloadTime(240, 150) + 1.5)) < 1e-12);
});

test('simulateAttacker uses w.activations verbatim and reports reloadInterval 0', () => {
  const attacker = { accuracy: 100, luck: 20, level: 125, reload: 150 };
  const target = { armorType: 2, evasion: 30, antiAir: 100, level: 125, luck: 10, hp: 100000 };
  const barrage = {
    attackAttribute: 'cannon', stat: 500, damage: 40, corrected: 100, ratio: 100,
    bulletsPerSalvo: 6, damageType: [1, 1, 1], reloadMax: 0,
    activations: 3, cadence: '주포 15회마다', label: '탄막 · 전탄 발사',
  };
  const out = simulateAttacker(attacker, [barrage], target, { window: 90 });
  const row = out.perWeapon[0];
  assert.equal(row.salvoCount, 3);
  assert.equal(row.reloadInterval, 0);
  assert.equal(row.cadence, '주포 15회마다');   // passthrough from the descriptor, unchanged
  assert.ok(Math.abs(row.total - row.oneSalvoExpected * 3) < 1e-9);
  assert.ok(Math.abs(row.dps - row.total / 90) < 1e-9);
});

test('a fractional activation count is honoured (expected value, not a salvo count)', () => {
  const attacker = { accuracy: 100, luck: 20, level: 125, reload: 150 };
  const target = { armorType: 2, evasion: 30, antiAir: 100, level: 125, luck: 10, hp: 100000 };
  const base = {
    attackAttribute: 'cannon', stat: 500, damage: 40, corrected: 100, ratio: 100,
    bulletsPerSalvo: 6, damageType: [1, 1, 1], reloadMax: 0, label: '탄막',
  };
  // A genuine fraction: with two integers a hidden Math.round would pass identically.
  const out = simulateAttacker(attacker, [{ ...base, activations: 2.5 }], target, { window: 90 });
  const row = out.perWeapon[0];
  assert.equal(row.salvoCount, 2.5);
  assert.ok(Math.abs(row.total - row.oneSalvoExpected * 2.5) < 1e-9);
  assert.ok(Math.abs(out.total - row.oneSalvoExpected * 2.5) < 1e-9);
});

test('simulateFleet exposes a cumulative-damage curve that agrees with its own total', () => {
  const target = makeTarget('light');
  const ships = [{ ref: 'a', profile: attacker, weapons: [cannon] }];
  const r = simulateFleet(ships, target, { window: 90 });
  assert.ok(Math.abs(r.damageAt(90) - r.total) < 1e-9);
  assert.ok(r.damageAt(45) < r.total, 'half the window must deal less than the whole');
  assert.ok(r.damageAt(0) > 0, 'a ready weapon fires at t=0');
});

test('a barrage re-rolled at a shorter window scales by the window it was resolved for', () => {
  const target = makeTarget('light');
  const barrage = { label: '탄막', bulletsPerSalvo: 1, damage: 100, coefficient: 1, attackAttribute: 'cannon',
                    damageType: [1, 1, 1], activations: 8, activationWindow: 80 };
  const full = simulateAttacker(attacker, [barrage], target, { window: 80 });
  const half = simulateAttacker(attacker, [barrage], target, { window: 40 });
  assert.equal(full.perWeapon[0].salvoCount, 8);
  assert.equal(half.perWeapon[0].salvoCount, 4);
});
