import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BulletUnit } from '../../public/js/simulators/physics/bullet-unit.js';

test('calcSpeed: speed = velocity * 0.2, decomposed along yAngle (0 deg)', () => {
  const b = new BulletUnit({ velocity: 50, yAngle: 0 });
  b.calcSpeed();
  assert.equal(b.speed.x, 10);            // 50 * 0.2 * cos(0)
  assert.equal(b.speed.y, 0);
});

test('calcSpeed: yAngle 90 deg fires straight up the y-axis', () => {
  const b = new BulletUnit({ velocity: 50, yAngle: 90 });
  b.calcSpeed();
  assert.ok(Math.abs(b.speed.x) < 1e-9, 'x component is ~0');
  assert.equal(b.speed.y, 10);            // 50 * 0.2 * sin(90)
});

test('FixRange: range_offset 0 leaves range exact; sqrRange = range^2', () => {
  const b = new BulletUnit({ velocity: 10, range: 40, rangeOffset: 0 });
  b.FixRange();
  assert.equal(b.range, 40);
  assert.equal(b.sqrRange, 1600);
});

test('FixRange: range = base + offset*(rng()-0.5)', () => {
  // rng() = 0  ->  (0 - 0.5) = -0.5  ->  range = 40 + 20*(-0.5) = 30
  const b = new BulletUnit({ range: 40, rangeOffset: 20, rng: () => 0 });
  b.FixRange();
  assert.equal(b.range, 30);
  assert.equal(b.sqrRange, 900);
});

test('FixRange: a negative roll is clamped to 0', () => {
  // rng() = 0  ->  range = 10 + 100*(-0.5) = -40  ->  clamp to 0
  const b = new BulletUnit({ range: 10, rangeOffset: 100, rng: () => 0 });
  b.FixRange();
  assert.equal(b.range, 0);
  assert.equal(b.sqrRange, 0);
});

test('InitSpeed: calcSpeed runs and updateSpeed defaults to doNothing', () => {
  const b = new BulletUnit({ velocity: 50, yAngle: 0 });
  b.InitSpeed();
  assert.equal(b.speed.x, 10, 'InitSpeed calls calcSpeed');
  assert.equal(b.updateSpeed, b.doNothing, 'cannon uses the doNothing path');
});

test('doNothing: no gravity -> verticalSpeed stays 0', () => {
  const b = new BulletUnit({ velocity: 10, yAngle: 0, gravity: 0 });
  b.doNothing();
  assert.equal(b.verticalSpeed, 0);
});

test('doNothing: with gravity -> verticalSpeed accrues gravity per tick', () => {
  const b = new BulletUnit({ velocity: 10, yAngle: 0, gravity: -0.05 });
  b.doNothing();
  assert.equal(b.verticalSpeed, -0.05);
  b.doNothing();
  assert.equal(b.verticalSpeed, -0.1);
});

test('Update: a cannon advances position by speed each tick', () => {
  const b = new BulletUnit({ velocity: 50, yAngle: 0, range: 40, rangeOffset: 0 });
  b.FixRange();
  b.InitSpeed();
  b.Update();
  assert.equal(b.position.x, 10);
  assert.equal(b.position.y, 0);
  b.Update();
  assert.equal(b.position.x, 20);
});

test('Update: reachDestFlag trips when squared distance passes sqrRange', () => {
  // range 25 -> sqrRange 625. speed.x = 10/tick.
  const b = new BulletUnit({ velocity: 50, yAngle: 0, range: 25, rangeOffset: 0 });
  b.FixRange();
  b.InitSpeed();
  b.Update();                       // x=10, sqrDist 100
  b.Update();                       // x=20, sqrDist 400 < 625
  assert.equal(b.reachDestFlag, false);
  b.Update();                       // x=30, sqrDist 900 > 625
  assert.equal(b.reachDestFlag, true);
});

test('Update: a gravity bullet detonates at the bomb-detonation height', () => {
  // gravity -0.5 is an exaggerated test value chosen for exact arithmetic.
  // spawnAltitude 12, verticalSpeed -2: doNothing accrues gravity each tick,
  // so altitude falls by 2.5, 3.0, 3.5, 4.0 -> 9.5, 6.5, 3.0, -1.0; the bullet
  // detonates once altitude <= BOMB_DETONATE_HEIGHT (1.2).
  const b = new BulletUnit({ velocity: 0, yAngle: 0, gravity: -0.5, spawnAltitude: 12 });
  b.InitSpeed();
  b.verticalSpeed = -2;       // seeded as SetSpawnPosition would
  b.Update();                 // altitude 9.5
  b.Update();                 // altitude 6.5
  b.Update();                 // altitude 3.0
  assert.equal(b.reachDestFlag, false, 'still above the detonation height');
  b.Update();                 // altitude -1.0
  assert.equal(b.reachDestFlag, true, 'detonates at/below 1.2');
});

test('_accTable: an array of records makes HasAcceleration true', () => {
  const b = new BulletUnit({ acceleration: [{ t: 0, u: 1, v: 0 }] });
  assert.equal(b.HasAcceleration(), true);
  assert.equal(b.IsTracker(), false);
  assert.equal(b.IsCircle(), false);
  assert.equal(b.IsOrbit(), false);
});

test('_accTable: a tracker object makes IsTracker true, HasAcceleration false', () => {
  const b = new BulletUnit({ acceleration: { tracker: { angular: 3, range: 50 } } });
  assert.equal(b.IsTracker(), true);
  assert.equal(b.HasAcceleration(), false);
});

test('_accTable: a circle object makes IsCircle true', () => {
  const b = new BulletUnit({ acceleration: { circle: { centripetalSpeed: -1 } } });
  assert.equal(b.IsCircle(), true);
});

test('_accTable: an orbit object makes IsOrbit true', () => {
  const b = new BulletUnit({ acceleration: { orbit: { radius: 10 } } });
  assert.equal(b.IsOrbit(), true);
  assert.equal(b.HasAcceleration(), false);
  assert.equal(b.IsTracker(), false);
  assert.equal(b.IsCircle(), false);
});

test('_accTable: accel records AND a tracker — both predicates true', () => {
  // The game priority chain (InitSpeed) resolves this to doAccelerate; the
  // predicates themselves just report what data is present.
  const b = new BulletUnit({
    acceleration: { 1: { t: 0, u: 1, v: 0 }, tracker: { angular: 3, range: 50 } },
  });
  assert.equal(b.HasAcceleration(), true);
  assert.equal(b.IsTracker(), true);
});

test('_accTable: a plain bullet has an empty table — every predicate false', () => {
  const b = new BulletUnit({ velocity: 10, yAngle: 0 });
  assert.equal(b.HasAcceleration(), false);
  assert.equal(b.IsTracker(), false);
  assert.equal(b.IsCircle(), false);
  assert.equal(b.IsOrbit(), false);
});
