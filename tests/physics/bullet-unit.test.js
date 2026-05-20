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

test('GetAcceleration: returns the latest record whose t has elapsed', () => {
  const b = new BulletUnit({ acceleration: [{ t: 0, u: 1, v: 0 }, { t: 0.5, u: 5, v: 0 }] });
  b.timeElapsed = 0.1;
  assert.deepEqual(b.GetAcceleration(), { u: 1, v: 0 });
  b.timeElapsed = 0.6;
  assert.deepEqual(b.GetAcceleration(), { u: 5, v: 0 });
});

test('GetAcceleration: before the first record, returns zero', () => {
  const b = new BulletUnit({ acceleration: [{ t: 1, u: 9, v: 0 }] });
  b.timeElapsed = 0.5;
  assert.deepEqual(b.GetAcceleration(), { u: 0, v: 0 });
});

test('doAccelerate: a positive u accelerates along the forward vector', () => {
  const b = new BulletUnit({ acceleration: [{ t: 0, u: 0.5, v: 0 }] });
  b.speed = { x: 1, y: 0 };
  b._speedNormal = { x: 1, y: 0 };
  b._speedCross = { x: 0, y: 1 };
  b._speedLength = 1;
  b.doAccelerate();
  assert.deepEqual(b.speed, { x: 1.5, y: 0 });
  assert.equal(b._speedLength, 1.5);
});

test('doAccelerate: a v adds a cross-vector component and re-derives the basis', () => {
  const b = new BulletUnit({ acceleration: [{ t: 0, u: 0, v: 0.5 }] });
  b.speed = { x: 1, y: 0 };
  b._speedNormal = { x: 1, y: 0 };
  b._speedCross = { x: 0, y: 1 };
  b._speedLength = 1;
  b.doAccelerate();
  assert.deepEqual(b.speed, { x: 1, y: 0.5 });          // (1,0) + (0,1)*0.5
  const len = Math.sqrt(1.25);
  assert.ok(Math.abs(b._speedLength - len) < 1e-9);
  assert.ok(Math.abs(b._speedNormal.x - 1 / len) < 1e-9);
  assert.ok(Math.abs(b._speedNormal.y - 0.5 / len) < 1e-9);
  assert.ok(Math.abs(b._speedCross.x - (-0.5 / len)) < 1e-9, 'cross = (-normal.y, normal.x)');
  assert.ok(Math.abs(b._speedCross.y - 1 / len) < 1e-9);
});

test('doAccelerate: u=0 and v=0 is a no-op', () => {
  const b = new BulletUnit({ acceleration: [{ t: 0, u: 0, v: 0 }] });
  b.speed = { x: 2, y: 0 };
  b._speedNormal = { x: 1, y: 0 };
  b._speedCross = { x: 0, y: 1 };
  b._speedLength = 2;
  b.doAccelerate();
  assert.deepEqual(b.speed, { x: 2, y: 0 });
});

test('doAccelerate: a negative u that would reverse the speed flips every u', () => {
  // u -2 against forward speed 1: _speedLength + u = -1 < 0 -> reverseAcceleration.
  const b = new BulletUnit({ acceleration: [{ t: 0, u: -2, v: 0 }] });
  b.speed = { x: 1, y: 0 };
  b._speedNormal = { x: 1, y: 0 };
  b._speedCross = { x: 0, y: 1 };
  b._speedLength = 1;
  b.doAccelerate();
  // reverseAcceleration flips the stored record, but `u` was already
  // destructured locally before the flip, so this tick still applies -2.
  assert.deepEqual(b.speed, { x: -1, y: 0 });
  assert.equal(b._accTable.accels[0].u, 2, 'future records are flipped positive');
});

test('doAccelerate: u and v applied together compose correctly along forward and cross', () => {
  // speed (1,0), normal (1,0), cross (0,1); u=0.3, v=0.4
  // -> speed = (1+1*0.3+0*0.4, 0+0*0.3+1*0.4) = (1.3, 0.4)
  const b = new BulletUnit({ acceleration: [{ t: 0, u: 0.3, v: 0.4 }] });
  b.speed = { x: 1, y: 0 };
  b._speedNormal = { x: 1, y: 0 };
  b._speedCross = { x: 0, y: 1 };
  b._speedLength = 1;
  b.doAccelerate();
  assert.ok(Math.abs(b.speed.x - 1.3) < 1e-9);
  assert.ok(Math.abs(b.speed.y - 0.4) < 1e-9);
});

test('InitSpeed: an accelerating bullet resolves to doAccelerate', () => {
  const b = new BulletUnit({ velocity: 10, yAngle: 0, acceleration: [{ t: 0, u: 1, v: 0 }] });
  b.InitSpeed();
  assert.equal(b.updateSpeed, b.doAccelerate);
  assert.ok(Math.abs(b._speedNormal.x - 1) < 1e-9);
  assert.ok(Math.abs(b._speedNormal.y - 0) < 1e-9);
  assert.ok(Math.abs(b._speedCross.x - 0) < 1e-9);
  assert.ok(Math.abs(b._speedCross.y - 1) < 1e-9);
  assert.equal(b._speedLength, 2, 'velocity 10 * 0.2');
});

test('InitSpeed: the accel basis follows yAngle 90 deg', () => {
  const b = new BulletUnit({ velocity: 10, yAngle: 90, acceleration: [{ t: 0, u: 1, v: 0 }] });
  b.InitSpeed();
  assert.ok(Math.abs(b._speedNormal.x - 0) < 1e-9);
  assert.ok(Math.abs(b._speedNormal.y - 1) < 1e-9);
  assert.ok(Math.abs(b._speedCross.x - (-1)) < 1e-9);
  assert.ok(Math.abs(b._speedCross.y - 0) < 1e-9);
});

test('InitSpeed: a plain bullet still resolves to doNothing', () => {
  const b = new BulletUnit({ velocity: 10, yAngle: 0 });
  b.InitSpeed();
  assert.equal(b.updateSpeed, b.doNothing);
});

test('Update: an accelerating bullet curves off the firing axis', () => {
  // Fired along +x with a constant cross-acceleration v=0.5 -> it curves +y.
  const b = new BulletUnit({
    velocity: 5, yAngle: 0, range: 500, rangeOffset: 0,
    acceleration: [{ t: 0, u: 0, v: 0.5 }],
  });
  b.FixRange();
  b.InitSpeed();
  b.Update();
  b.Update();
  assert.ok(b.position.y > 0, 'the bullet has curved off the x-axis');
});

// doTrack test harness: seed the fields InitSpeed's tracker branch will set
// (Task 7), then drive doTrack directly.
function trackerBullet({ speed, target, trackRange = 100, angularDeg = 30 }) {
  const b = new BulletUnit({ velocity: 10, yAngle: 0 });
  b.speed = { ...speed };
  b.position = { x: 0, y: 0 };
  b._target = target;
  b._trackRange = trackRange;
  b._trackerAngularRad = angularDeg * (Math.PI / 180);
  b._trackingTarget = null;
  return b;
}

test('doTrack: turns toward a target more than one angular step away', () => {
  // Heading +x, target at 45deg, angular step 30deg -> turn 30deg toward +y.
  const b = trackerBullet({ speed: { x: 2, y: 0 }, target: { x: 10, y: 10 }, angularDeg: 30 });
  b.doTrack();
  // rotate((2,0), cos30, -sin30): cross is negative so s = -sin30.
  assert.ok(Math.abs(b.speed.x - 2 * Math.cos(Math.PI / 6)) < 1e-9);
  assert.ok(Math.abs(b.speed.y - 2 * Math.sin(Math.PI / 6)) < 1e-9);
  assert.ok(Math.abs(Math.hypot(b.speed.x, b.speed.y) - 2) < 1e-9, 'speed preserved');
});

test('doTrack: snaps onto the target when within one angular step', () => {
  // Heading +x, target at 45deg, angular step 90deg -> snap straight to 45deg.
  const b = trackerBullet({ speed: { x: 2, y: 0 }, target: { x: 10, y: 10 }, angularDeg: 90 });
  b.doTrack();
  assert.ok(Math.abs(b.speed.x - Math.SQRT2) < 1e-9, 'heading lands on the target');
  assert.ok(Math.abs(b.speed.y - Math.SQRT2) < 1e-9);
});

test('doTrack: no turn inside the 10deg deadzone', () => {
  // Target ~2.86deg off the heading -> within cos(10deg) -> no turn.
  const b = trackerBullet({ speed: { x: 2, y: 0 }, target: { x: 100, y: 5 } });
  b.doTrack();
  assert.deepEqual(b.speed, { x: 2, y: 0 });
});

test('doTrack: a target beyond trackRange is never acquired', () => {
  const b = trackerBullet({
    speed: { x: 2, y: 0 }, target: { x: 20, y: 20 }, trackRange: 5,
  });
  b.doTrack();
  assert.deepEqual(b.speed, { x: 2, y: 0 }, 'unacquired -> no turn');
});

test('doTrack: a target that leaves trackRange is dropped permanently', () => {
  const b = trackerBullet({ speed: { x: 2, y: 0 }, target: { x: 5, y: 5 }, trackRange: 10 });
  b.doTrack();                                  // acquired (dist ~7.07 < 10), turns
  const turned = { ...b.speed };
  b._target = { x: 80, y: 80 };                 // dist ~113 > 10 -> dropped
  b.doTrack();
  b._target = { x: 3, y: 3 };                   // back in range...
  const before = { ...b.speed };
  b.doTrack();
  assert.deepEqual(b.speed, before, 'a dropped target is never re-acquired');
  assert.notDeepEqual(turned, { x: 2, y: 0 });  // sanity: the first call did turn
});

test('doTrack: with no target at all, it is a no-op', () => {
  const b = trackerBullet({ speed: { x: 2, y: 0 }, target: null });
  b.doTrack();
  assert.deepEqual(b.speed, { x: 2, y: 0 });
});

test('InitSpeed: a tracker bullet resolves to doTrack', () => {
  const b = new BulletUnit({
    velocity: 10, yAngle: 0, acceleration: { tracker: { angular: 3, range: 50 } },
  });
  b.InitSpeed();
  assert.equal(b.updateSpeed, b.doTrack);
  assert.equal(b._trackRange, 50);
  assert.ok(Math.abs(b._trackerAngularRad - 3 * Math.PI / 180) < 1e-12);
  assert.equal(b._trackingTarget, null);
});

test('InitSpeed: accel records outrank a tracker key (game priority)', () => {
  const b = new BulletUnit({
    velocity: 10, yAngle: 0,
    acceleration: { 1: { t: 0, u: 1, v: 0 }, tracker: { angular: 3, range: 50 } },
  });
  b.InitSpeed();
  assert.equal(b.updateSpeed, b.doAccelerate, 'HasAcceleration wins over IsTracker');
});

test('InitSpeed: a tracker with no fields falls back to defaults', () => {
  const b = new BulletUnit({ velocity: 10, yAngle: 0, acceleration: { tracker: {} } });
  b.InitSpeed();
  assert.equal(b._trackRange, 50);
  assert.ok(Math.abs(b._trackerAngularRad - 3 * Math.PI / 180) < 1e-12);
});

// doCircle test harness: seed the fields InitSpeed's circle branch will set.
function circleBullet({ position, originPos, convertedVelocity, centripetalSpeed = 0,
                        antiClockwise = false, inverseFlag = 1 }) {
  const b = new BulletUnit({ velocity: 10, yAngle: 0 });
  b.position = { ...position };
  b._originPos = originPos;
  b._convertedVelocity = convertedVelocity;
  b._centripetalSpeed = centripetalSpeed;
  b._circleAntiClockwise = antiClockwise;
  b._inverseFlag = inverseFlag;
  return b;
}

test('doCircle: with no centripetal pull, the radius is pinned exactly', () => {
  const b = circleBullet({
    position: { x: 10, y: 0 }, originPos: { x: 0, y: 0 }, convertedVelocity: 2,
  });
  b.doCircle();
  // speed is a displacement; the next position must stay on the radius-10 circle.
  const next = { x: b.position.x + b.speed.x, y: b.position.y + b.speed.y };
  const newRadius = Math.hypot(next.x, next.y);
  assert.ok(Math.abs(newRadius - 10) < 1e-9, `radius pinned at 10, got ${newRadius}`);
});

test('doCircle: an inward spiral shrinks the radius by centripetalSpeed', () => {
  // radius 10, centripetal 2, flag 1: 10 - 2*1 = 8 (>= 0, flag stays +1).
  // newRadius = 8 -> next position lands on the radius-8 circle.
  const b = circleBullet({
    position: { x: 10, y: 0 }, originPos: { x: 0, y: 0 },
    convertedVelocity: 2, centripetalSpeed: 2, inverseFlag: 1,
  });
  b.doCircle();
  const next = { x: b.position.x + b.speed.x, y: b.position.y + b.speed.y };
  const newRadius = Math.hypot(next.x, next.y);
  assert.ok(Math.abs(newRadius - 8) < 1e-9, `expected radius 8, got ${newRadius}`);
  assert.equal(b._inverseFlag, 1, 'flag does not flip when radius - centripetal >= 0');
});

test('doCircle: the inverse flag flips when the radius would go negative', () => {
  // radius 10, centripetal 15, flag 1: 10 - 15*1 = -5 < 0 -> flag flips to -1.
  const b = circleBullet({
    position: { x: 10, y: 0 }, originPos: { x: 0, y: 0 }, convertedVelocity: 2,
    centripetalSpeed: 15, inverseFlag: 1,
  });
  b.doCircle();
  assert.equal(b._inverseFlag, -1);
});

test('doCircle: with no origin, it is a no-op', () => {
  const b = circleBullet({
    position: { x: 10, y: 0 }, originPos: null, convertedVelocity: 2,
  });
  b.speed = { x: 7, y: 7 };
  b.doCircle();
  assert.deepEqual(b.speed, { x: 7, y: 7 });
});
