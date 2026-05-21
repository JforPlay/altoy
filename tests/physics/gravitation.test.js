import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GravitationBulletUnit } from '../../public/js/simulators/physics/bullets/gravitation.js';
import { TICK_SECONDS } from '../../public/js/simulators/physics/constants.js';

test('GravitationBulletUnit: stays at spawn (game-observed: target-locked, does not travel)', () => {
  // The game's whirlpool stays at target-lock; the bullet does not travel.
  // We skip super.Update — even with velocity 10, position must not advance.
  const b = new GravitationBulletUnit({
    velocity: 10, yAngle: 0, range: 50, rangeOffset: 0,
    spawnX: 7, spawnY: 3,
  });
  b.FixRange();
  b.InitSpeed();
  for (let i = 0; i < 10; i++) {
    b.timeElapsed += TICK_SECONDS;
    b.Update();
  }
  assert.deepEqual(b.position, { x: 7, y: 3 }, 'position never changes');
});

test('GravitationBulletUnit: range expiry never fires (bullet stationary)', () => {
  // With movement skipped, sqrDistance(spawn, position) is always 0, so the
  // base's range check would never set reachDestFlag — but base Update isn't
  // called either. Either way: range-only bullet (no cap) lives forever.
  const b = new GravitationBulletUnit({
    velocity: 10, yAngle: 0, range: 1, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    hitTypeTime: null,                         // no cap; range is the only candidate
  });
  b.FixRange();
  b.InitSpeed();
  for (let i = 0; i < 100; i++) {
    b.timeElapsed += TICK_SECONDS;
    b.Update();
  }
  assert.equal(b.reachDestFlag, false, 'range expiry cannot fire on a stationary bullet');
});

test('GravitationBulletUnit: spawns at opts.target when provided (target-lock)', () => {
  // "Random target lock" — bullet appears at the enemy's position. The
  // firing pipeline passes the target as opts.target (game coords).
  const b = new GravitationBulletUnit({
    velocity: 10, yAngle: 0, range: 50, rangeOffset: 0,
    spawnX: 0, spawnY: 0,                      // firing weapon position
    target: { x: 42, y: 13 },                  // enemy lock
  });
  b.FixRange();
  b.InitSpeed();
  assert.deepEqual(b.position, { x: 42, y: 13 }, 'position jumped to target');
  assert.deepEqual(b.spawnPos, { x: 42, y: 13 }, 'spawnPos also moved (range origin)');

  // And then it stays put.
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  assert.deepEqual(b.position, { x: 42, y: 13 });
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
