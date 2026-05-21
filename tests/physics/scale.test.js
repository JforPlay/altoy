import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScaleBulletUnit } from '../../public/js/simulators/physics/bullets/scale.js';
import { TICK_SECONDS, BULLET_SPEED_CONVERT } from '../../public/js/simulators/physics/constants.js';

test('ScaleBulletUnit: cldMax is read as a scalar (regression guard vs legacy cldMax[0]/cldMax[1] bug)', () => {
  // The legacy ScaleBehavior reads cldMax[0]/cldMax[1] — wrong; the data
  // is a scalar. Spec §D4 + all 91 type-15 bullets in bullet_template.json.
  const s = new ScaleBulletUnit({
    velocity: 10, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    extraParam: { cldMax: 5, scaleSpeed: 0.5 },
    cldBox: [2, 1, 1],
  });
  assert.equal(s._scaleLimit, 5, 'cldMax read as scalar');
});

test('ScaleBulletUnit: InitSpeed grow-phase magnitude = scaleSpeed * 0.5 along yAngle', () => {
  const s = new ScaleBulletUnit({
    velocity: 10, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    extraParam: { cldMax: 5, scaleSpeed: 0.4 },
    cldBox: [0, 1, 0],                          // cld_box[1] = 1
  });
  s.FixRange();
  s.InitSpeed();
  // scaleSpeed * 0.5 = 0.2 along yAngle 0
  assert.ok(Math.abs(s.speed.x - 0.2) < 1e-9);
  assert.ok(Math.abs(s.speed.y) < 1e-9);
});

test('ScaleBulletUnit: growing phase increments _scaleX additively per tick', () => {
  // cldMax = 5, cld_box[1] = 1. While _scaleX + 1 < 5 -> grow.
  const s = new ScaleBulletUnit({
    velocity: 10, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    extraParam: { cldMax: 5, scaleSpeed: 0.5 },
    cldBox: [0, 1, 0],
  });
  s.FixRange();
  s.InitSpeed();
  assert.equal(s._scaleX, 0);
  s.timeElapsed += TICK_SECONDS;
  s.Update();
  assert.equal(s._scaleX, 0.5);
  assert.equal(s.currentBoxWidth, 1.5);
  s.timeElapsed += TICK_SECONDS;
  s.Update();
  assert.equal(s._scaleX, 1.0);
  assert.equal(s.currentBoxWidth, 2.0);
});

test('ScaleBulletUnit: growing phase keeps speed magnitude at scaleSpeed * 0.5', () => {
  const s = new ScaleBulletUnit({
    velocity: 10, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    extraParam: { cldMax: 5, scaleSpeed: 0.4 },
    cldBox: [0, 1, 0],
  });
  s.FixRange();
  s.InitSpeed();
  s.timeElapsed += TICK_SECONDS;
  s.Update();
  assert.ok(Math.abs(s.speed.x - 0.2) < 1e-9, 'still growing -> scaleSpeed*0.5');
});

test('ScaleBulletUnit: settled transition restores base speed magnitude (velocity * 0.2)', () => {
  // cldMax = 1.5, cld_box[1] = 1, scaleSpeed = 1. Lua's strict `<` settle
  // condition (`scaleLimit < scaleX + cld_box[1]`):
  //   Tick 1: condition `1.5 < (0 + 1) = 1`  FALSE -> grow, _scaleX -> 1
  //   Tick 2: condition `1.5 < (1 + 1) = 2`  TRUE  -> settle, calcSpeed
  // cldMax = 2 would NOT settle at tick 2 (the Lua's `2 < 2` is false), so
  // the cap must be strictly less than the post-grow current_box.
  const s = new ScaleBulletUnit({
    velocity: 10, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    extraParam: { cldMax: 1.5, scaleSpeed: 1 },
    cldBox: [0, 1, 0],
  });
  s.FixRange();
  s.InitSpeed();
  s.timeElapsed += TICK_SECONDS;
  s.Update();                                   // grows once: _scaleX = 1
  assert.equal(s._settled, false, 'not yet settled at the grow tick');
  s.timeElapsed += TICK_SECONDS;
  s.Update();                                   // 1.5 < 2 -> settled
  assert.equal(s._settled, true);
  // Base speed = velocity * 0.2 = 2 along yAngle 0
  assert.ok(Math.abs(s.speed.x - 2) < 1e-9);
});

test('ScaleBulletUnit: settled phase does not grow _scaleX further', () => {
  const s = new ScaleBulletUnit({
    velocity: 10, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    extraParam: { cldMax: 1.5, scaleSpeed: 1 },
    cldBox: [0, 1, 0],
  });
  s.FixRange();
  s.InitSpeed();
  s.timeElapsed += TICK_SECONDS;
  s.Update();                                   // grow
  s.timeElapsed += TICK_SECONDS;
  s.Update();                                   // settle
  const settledScaleX = s._scaleX;
  s.timeElapsed += TICK_SECONDS;
  s.Update();
  assert.equal(s._scaleX, settledScaleX, '_scaleX frozen after settle');
});

test('ScaleBulletUnit: base range expiry applies', () => {
  // Tiny range; even with grow-phase speed (0.2/tick) the bullet covers
  // distance and should expire by range eventually.
  const s = new ScaleBulletUnit({
    velocity: 10, yAngle: 0, range: 1, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    extraParam: { cldMax: 100, scaleSpeed: 0.4 },     // huge cldMax -> stays in grow
    cldBox: [0, 1, 0],
  });
  s.FixRange();
  s.InitSpeed();
  // sqrRange = 1; per-tick speed 0.2 -> sqrDist crosses 1 at tick 6 (1.2^2=1.44).
  for (let i = 0; i < 10; i++) {
    s.timeElapsed += TICK_SECONDS;
    s.Update();
    if (s.reachDestFlag) break;
  }
  assert.equal(s.reachDestFlag, true);
});
