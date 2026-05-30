import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpaceLaserUnit } from '../../public/js/simulators/physics/weapons/space-laser-unit.js';
import { TICK_SECONDS } from '../../public/js/simulators/physics/constants.js';

function step(unit) {
  unit.timeElapsed += TICK_SECONDS;
  unit.Update();
}

// cld_box JS indices: [0] radius, [2] thickness.
const BULLET_AIM = {
  cld_box: [6, 99, 2],            // radius 6, thickness 2 ([1] is ignored)
  hit_type: { interval: 0.1 },
  extra_param: { aim_time: 0.07, attack_time: 0.1 },   // ~2 ticks alert, ~3 attack
};
const BULLET_NOAIM = {
  cld_box: [6, 99, 2],
  hit_type: { interval: 0.1 },
  extra_param: { aim_time: 0, attack_time: 0.1 },
};

function makeSL(bullet, beamCount = 1) {
  return new SpaceLaserUnit({ hostPos: { x: 7, y: 8 }, bulletTemplate: bullet, beamCount });
}

test('SpaceLaserUnit: with aim_time, DoAttack emits an ALERT column with the cylinder dims', () => {
  const sl = makeSL(BULLET_AIM);
  sl.DoAttack();
  const cols = sl.getColumns();
  assert.equal(cols.length, 1);
  assert.equal(cols[0].stage, 'alert');
  assert.deepEqual(cols[0].cylinder, { radius: 6, thickness: 2 });
  assert.deepEqual(cols[0].position, { x: 7, y: 8 });
  assert.equal(sl.finished, false);
});

test('SpaceLaserUnit: alert hands off to attack at aim_time, then cools down at attack_time', () => {
  const sl = makeSL(BULLET_AIM);
  sl.DoAttack();
  // aim_time 0.07: alert active ticks 1(0.033),2(0.067) then expires on tick 3 -> attack spawns.
  step(sl); assert.equal(sl.getColumns()[0].stage, 'alert');
  step(sl); assert.equal(sl.getColumns()[0].stage, 'alert');
  step(sl); assert.equal(sl.getColumns()[0].stage, 'attack', 'handed off at aim_time');
  // attack_time 0.1 from spawn-of-attack: ~3 more ticks then cooldown.
  let guard = 0;
  while (!sl.finished && guard < 50) { step(sl); guard++; }
  assert.equal(sl.finished, true);
  assert.equal(sl.getColumns().length, 0);
});

test('SpaceLaserUnit: aim_time == 0 skips the alert and emits an attack column directly', () => {
  const sl = makeSL(BULLET_NOAIM);
  sl.DoAttack();
  const cols = sl.getColumns();
  assert.equal(cols.length, 1);
  assert.equal(cols[0].stage, 'attack');
});

test('SpaceLaserUnit: beamCount emits one column per shot', () => {
  const sl = makeSL(BULLET_AIM, 3);
  sl.DoAttack();
  assert.equal(sl.getColumns().length, 3);
  assert.ok(sl.getColumns().every((c) => c.stage === 'alert'));
});

test('SpaceLaserUnit: SingleFire is unsupported', () => {
  const sl = makeSL(BULLET_AIM);
  assert.throws(() => sl.SingleFire(), /not support/i);
});

test('SpaceLaserUnit: a zero-column unit cools down immediately', () => {
  const sl = makeSL(BULLET_AIM, 0);
  sl.DoAttack();
  assert.equal(sl.finished, true);
});
