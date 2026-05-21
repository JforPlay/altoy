import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GravitationBulletUnit } from '../../public/js/simulators/physics/bullets/gravitation.js';
import { TICK_SECONDS } from '../../public/js/simulators/physics/constants.js';

test('GravitationBulletUnit: extends BulletUnit movement (calcSpeed + Update advances position)', () => {
  // Mirrors the visible payoff: a migrated gravitation MOVES (the legacy
  // FALLING/ACTIVE state machine froze it at spawn). At velocity 10, the
  // bullet covers 10 * 0.2 = 2 units per tick along x.
  const b = new GravitationBulletUnit({
    velocity: 10, yAngle: 0, range: 50, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
  });
  b.FixRange();
  b.InitSpeed();
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  assert.equal(b.position.x, 2);
});

test('GravitationBulletUnit: range expiry from base BulletUnit', () => {
  // range 5 -> sqrRange 25; speed 2/tick -> sqrDist at tick 3 = 36 > 25.
  const b = new GravitationBulletUnit({
    velocity: 10, yAngle: 0, range: 5, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
  });
  b.FixRange();
  b.InitSpeed();
  for (let i = 0; i < 2; i++) {
    b.timeElapsed += TICK_SECONDS;
    b.Update();
  }
  assert.equal(b.reachDestFlag, false, 'still alive at sqrDist 16 < 25');
  b.timeElapsed += TICK_SECONDS;
  b.Update();                                  // x=6, sqrDist 36 > 25 -> expire
  assert.equal(b.reachDestFlag, true);
});

test('GravitationBulletUnit: lifetime cap expires the bullet at hit_type.time', () => {
  // Mirror EffectBulletUnit's cap test. hitTypeTime = 3 ticks; range way out
  // so the cap is the only expiry path.
  const b = new GravitationBulletUnit({
    velocity: 1, yAngle: 0, range: 1000, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    hitTypeTime: 3 * TICK_SECONDS,
  });
  b.FixRange();
  b.InitSpeed();
  for (let i = 0; i < 2; i++) {
    b.timeElapsed += TICK_SECONDS;
    b.Update();
  }
  assert.equal(b.reachDestFlag, false, 'still alive at 2 ticks');
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  assert.equal(b.reachDestFlag, true, 'expired at hitTypeTime');
});

test('GravitationBulletUnit: hitTypeTime <= 0 is treated as no cap (range-only)', () => {
  // Same normalization as EffectBulletUnit: -1 and 0 are "no cap" sentinels.
  const negCap = new GravitationBulletUnit({
    velocity: 1, yAngle: 0, range: 1000, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    hitTypeTime: -1,
  });
  negCap.FixRange();
  negCap.InitSpeed();
  for (let i = 0; i < 5; i++) {
    negCap.timeElapsed += TICK_SECONDS;
    negCap.Update();
  }
  assert.equal(negCap.reachDestFlag, false, '-1 cap is treated as no cap');

  const zeroCap = new GravitationBulletUnit({
    velocity: 1, yAngle: 0, range: 1000, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    hitTypeTime: 0,
  });
  zeroCap.FixRange();
  zeroCap.InitSpeed();
  zeroCap.timeElapsed += TICK_SECONDS;
  zeroCap.Update();
  assert.equal(zeroCap.reachDestFlag, false, '0 cap is treated as no cap');
});

test('GravitationBulletUnit: hitTypeTime null is treated as no cap (range-only)', () => {
  const b = new GravitationBulletUnit({
    velocity: 1, yAngle: 0, range: 1000, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    hitTypeTime: null,
  });
  b.FixRange();
  b.InitSpeed();
  for (let i = 0; i < 5; i++) {
    b.timeElapsed += TICK_SECONDS;
    b.Update();
  }
  assert.equal(b.reachDestFlag, false, 'null cap is treated as no cap');
});

test('GravitationBulletUnit: SetExplodePosition stores _explodePos, does not move the bullet', () => {
  const b = new GravitationBulletUnit({
    velocity: 0, yAngle: 0, range: 10, rangeOffset: 0,
    spawnX: 5, spawnY: 5,
  });
  b.SetExplodePosition({ x: 99, y: 99 });
  assert.deepEqual(b._explodePos, { x: 99, y: 99 });
  assert.deepEqual(b.position, { x: 5, y: 5 }, 'movement unaffected');
});
