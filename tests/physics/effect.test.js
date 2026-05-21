import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EffectBulletUnit } from '../../public/js/simulators/physics/bullets/effect.js';
import { TICK_SECONDS } from '../../public/js/simulators/physics/constants.js';

test('EffectBulletUnit: extends BulletUnit movement (calcSpeed + Update advances position)', () => {
  const b = new EffectBulletUnit({
    velocity: 50, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
  });
  b.FixRange();
  b.InitSpeed();
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  assert.equal(b.position.x, 10);            // 50 * 0.2
});

test('EffectBulletUnit: lifetime cap expires the bullet at hit_type.time', () => {
  // hitTypeTime = 3 ticks * TICK_SECONDS = 0.1s. Range 1000 keeps range expiry
  // out of the way so the cap is the only expiry path.
  const b = new EffectBulletUnit({
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

test('EffectBulletUnit: range expiry still applies when no lifetime cap', () => {
  // hitTypeTime null -> only range expiry. range 5 -> sqrRange 25, speed 10/tick.
  const b = new EffectBulletUnit({
    velocity: 50, yAngle: 0, range: 5, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    hitTypeTime: null,
  });
  b.FixRange();
  b.InitSpeed();
  b.timeElapsed += TICK_SECONDS;
  b.Update();                                 // x=10, sqrDist 100 > 25 -> expire
  assert.equal(b.reachDestFlag, true);
});

test('EffectBulletUnit: long-lifetime + short-range expires by range', () => {
  // hitTypeTime way out (100 ticks) but range 5 -> expires by range first.
  const b = new EffectBulletUnit({
    velocity: 50, yAngle: 0, range: 5, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    hitTypeTime: 100 * TICK_SECONDS,
  });
  b.FixRange();
  b.InitSpeed();
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  assert.equal(b.reachDestFlag, true, 'range fires before lifetime cap');
});

test('EffectBulletUnit: hitTypeTime <= 0 is treated as no cap (range-only)', () => {
  // The data uses `hit_type.time: -1` as an "infinite lifetime" sentinel
  // (17 templates, 1 reached: bullet 19010). Without the <= 0 guard the
  // cap would be -1 and `timeElapsed >= -1` would fire on tick 1.
  const negCap = new EffectBulletUnit({
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

  // Zero is also "no cap" by the same rule.
  const zeroCap = new EffectBulletUnit({
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

test('EffectBulletUnit: SetExplodePosition stores _explodePos, does not move the bullet', () => {
  const b = new EffectBulletUnit({
    velocity: 0, yAngle: 0, range: 10, rangeOffset: 0,
    spawnX: 5, spawnY: 5,
  });
  b.SetExplodePosition({ x: 99, y: 99 });
  assert.deepEqual(b._explodePos, { x: 99, y: 99 });
  assert.deepEqual(b.position, { x: 5, y: 5 }, 'movement unaffected');
});
