import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BombBulletUnit } from '../../public/js/simulators/physics/bullets/bomb.js';
import { TICK_SECONDS } from '../../public/js/simulators/physics/constants.js';

test('SetSpawnPosition: a no-dropOffset bomb spawns directly above the explode point', () => {
  const b = new BombBulletUnit({
    velocity: 5, gravity: -0.25, offsetY: 8, dropOffset: false,
    explodePos: { x: 20, y: 0 }, direction: 1,
  });
  b.SetSpawnPosition();
  assert.deepEqual(b.position, { x: 20, y: 0 }, 'spawn x = explode x');
  assert.deepEqual(b.spawnPos, { x: 20, y: 0 });
  assert.equal(b.altitude, 8, 'spawn altitude = offsetY');
});

test('SetSpawnPosition: a dropOffset bomb spawns above and behind the explode point', () => {
  // convertedVelocity = 5 * 0.2 = 1.0
  // dropOffsetX = sqrt(|2*8 / -0.25|) * 1.0 = sqrt(64) = 8 -> spawn x = 20 - 8
  const b = new BombBulletUnit({
    velocity: 5, gravity: -0.25, offsetY: 8, dropOffset: true,
    explodePos: { x: 20, y: 0 }, direction: 1,
  });
  b.SetSpawnPosition();
  assert.equal(b.position.x, 12, 'spawn x = explode x - dropOffsetX');
  assert.equal(b.position.y, 0);
  assert.equal(b.altitude, 8);
});

test('SetSpawnPosition: direction -1 mirrors the drop offset', () => {
  const b = new BombBulletUnit({
    velocity: 5, gravity: -0.25, offsetY: 8, dropOffset: true,
    explodePos: { x: 20, y: 0 }, direction: -1,
  });
  b.SetSpawnPosition();
  assert.equal(b.position.x, 28, 'dropOffsetX is negated for a left-facing host');
});

test('SetSpawnPosition: solves verticalSpeed so the bomb lands on the explode point', () => {
  const b = new BombBulletUnit({
    velocity: 5, gravity: -0.25, offsetY: 8, dropOffset: false,
    explodePos: { x: 20, y: 0 }, direction: 1,
  });
  b.SetSpawnPosition();
  // Overhead bomb (planar distance 0): flightTime = sqrt(0 + 1.2^2) / cv
  //   = 1.2 / 1.0 = 1.2 ticks. verticalSpeed solves the parabola.
  const flightTime = 1.2;
  const expected = (1.2 - 8) / flightTime - 0.5 * (-0.25) * flightTime;
  assert.ok(Math.abs(b.verticalSpeed - expected) < 1e-9,
    `verticalSpeed ~= ${expected}, got ${b.verticalSpeed}`);
});

test('SetSpawnPosition: launchVrtSpeed overrides the solved vertical speed', () => {
  const b = new BombBulletUnit({
    velocity: 5, gravity: -0.25, offsetY: 8, dropOffset: false,
    explodePos: { x: 20, y: 0 }, direction: 1, launchVrtSpeed: -0.5,
  });
  b.SetSpawnPosition();
  assert.equal(b.verticalSpeed, -0.5);
});

test('InitSpeed: a bomb aims along x toward the explode point (heading 0)', () => {
  const b = new BombBulletUnit({
    velocity: 5, gravity: -0.25, offsetY: 8, dropOffset: true,
    explodePos: { x: 20, y: 0 }, direction: 1,
  });
  b.SetSpawnPosition();   // spawn x = 12 (behind the explode point)
  b.InitSpeed();
  assert.equal(b.yAngle, 0, 'spawn shares the explode point planar y -> heading 0');
  assert.equal(b.speed.x, 1, 'speed magnitude = velocity * 0.2 = 1.0');
  assert.ok(Math.abs(b.speed.y) < 1e-9, 'no cross-axis drift');
  assert.equal(b.updateSpeed, b.doNothing, 'bomb uses the doNothing gravity integrator');
});

test('InitSpeed: a left-facing bomb aims back along -x (heading 180)', () => {
  const b = new BombBulletUnit({
    velocity: 5, gravity: -0.25, offsetY: 8, dropOffset: true,
    explodePos: { x: 20, y: 0 }, direction: -1,
  });
  b.SetSpawnPosition();   // spawn x = 28 (drop offset mirrored)
  b.InitSpeed();
  assert.equal(b.yAngle, 180);
  assert.ok(Math.abs(b.speed.x - (-1)) < 1e-9);
});

test('Update: a timeToExplode bomb detonates on the timer, not on altitude', () => {
  const b = new BombBulletUnit({
    velocity: 5, gravity: -0.25, offsetY: 8, dropOffset: false,
    explodePos: { x: 20, y: 0 }, direction: 1, explodeTime: 0.5,
  });
  b.SetSpawnPosition();
  b.InitSpeed();
  // Force the bomb below the detonation height: without explodeTime the base
  // Update would flag it at once — explodeTime must suppress that.
  b.altitude = 0;
  b.timeElapsed = 0.3;
  b.Update();
  assert.equal(b.reachDestFlag, false, 'altitude detonation suppressed before the timer');
  b.timeElapsed = 0.5;
  b.Update();
  assert.equal(b.reachDestFlag, true, 'detonates once timeElapsed reaches explodeTime');
});

test('Update: a bomb with no timeToExplode detonates on altitude', () => {
  const b = new BombBulletUnit({
    velocity: 5, gravity: -0.25, offsetY: 8, dropOffset: false,
    explodePos: { x: 20, y: 0 }, direction: 1,   // no explodeTime
  });
  b.SetSpawnPosition();
  b.InitSpeed();
  b.altitude = 0;             // below BOMB_DETONATE_HEIGHT
  b.timeElapsed = 0.01;
  b.Update();
  assert.equal(b.reachDestFlag, true, 'altitude detonation applies when no timer is set');
});

test('SetSpawnPosition: a velocity-0 bomb skips the vertical-speed solve and falls from rest', () => {
  // ~half of all airdrop bombs have velocity 0 (the "drops straight down"
  // case). convertedVelocity 0 -> dropOffsetX is 0 and the solve is skipped,
  // so verticalSpeed stays 0; gravity then accrues it tick by tick (doNothing).
  const b = new BombBulletUnit({
    velocity: 0, gravity: -0.25, offsetY: 8, dropOffset: true,
    explodePos: { x: 20, y: 0 }, direction: 1,
  });
  b.SetSpawnPosition();
  assert.deepEqual(b.position, { x: 20, y: 0 }, 'no horizontal drop offset when convertedVelocity is 0');
  assert.equal(b.altitude, 8, 'spawn altitude = offsetY');
  assert.equal(b.verticalSpeed, 0, 'vertical-speed solve skipped — falls from rest');
});

test('constructor: airdrop defaults to true (back-compat for existing callers)', () => {
  const b = new BombBulletUnit({
    velocity: 5, gravity: -0.25, offsetY: 8,
    explodePos: { x: 20, y: 0 }, direction: 1,
  });
  assert.equal(b.airdrop, true, 'airdrop defaults to true');
});

test('constructor: airdrop:false is honored, explodePos may be null', () => {
  const b = new BombBulletUnit({
    velocity: 5, airdrop: false, spawnX: 10, spawnY: 0, yAngle: 45,
  });
  assert.equal(b.airdrop, false);
  assert.equal(b.explodePos, null, 'non-airdrop with no explodePos -> null');
  assert.equal(b.position.x, 10, 'spawnX flowed through super');
  assert.equal(b.yAngle, 45, 'yAngle flowed through super');
});

test('SetSpawnPosition non-airdrop: no reposition, no parabola solve when explodePos is null', () => {
  const b = new BombBulletUnit({
    velocity: 5, airdrop: false, spawnX: 10, spawnY: 7, yAngle: 30,
    gravity: -0.05,
  });
  b.SetSpawnPosition();
  assert.deepEqual(b.position, { x: 10, y: 7 }, 'spawn position unchanged');
  assert.deepEqual(b.spawnPos, { x: 10, y: 7 });
  assert.equal(b.altitude, 0, 'altitude defaults to spawnAltitude (0)');
  assert.equal(b.verticalSpeed, 0, 'no explodePos -> no parabola solve');
});

test('SetSpawnPosition non-airdrop: spawnAltitude is honored when supplied', () => {
  const b = new BombBulletUnit({
    velocity: 5, airdrop: false, spawnX: 0, spawnY: 0, spawnAltitude: 15,
  });
  b.SetSpawnPosition();
  assert.equal(b.altitude, 15, 'host weapon altitude propagates from super');
});

test('SetSpawnPosition non-airdrop: parabola solve when explodePos is supplied', () => {
  const b = new BombBulletUnit({
    velocity: 5, gravity: -0.25, airdrop: false,
    spawnX: 0, spawnY: 0, explodePos: { x: 20, y: 0 },
  });
  b.SetSpawnPosition();
  // convertedVelocity = 5 * 0.2 = 1.0
  // flightTime = sqrt(20^2 + 1.2^2) / 1.0 = sqrt(401.44) ~= 20.036 ticks
  // verticalSpeed = (1.2 - 0) / 20.036 - 0.5 * (-0.25) * 20.036
  const flightTime = Math.sqrt(400 + 1.44);
  const expected = (1.2 - 0) / flightTime - 0.5 * (-0.25) * flightTime;
  assert.ok(Math.abs(b.verticalSpeed - expected) < 1e-9,
    `non-airdrop parabola solve: expected ${expected}, got ${b.verticalSpeed}`);
});

test('SetSpawnPosition non-airdrop: launchVrtSpeed overrides the parabola solve', () => {
  const b = new BombBulletUnit({
    velocity: 5, gravity: -0.25, airdrop: false,
    spawnX: 0, spawnY: 0, explodePos: { x: 20, y: 0 }, launchVrtSpeed: -2,
  });
  b.SetSpawnPosition();
  assert.equal(b.verticalSpeed, -2, 'explicit override wins over the solve');
});

test('SetSpawnPosition non-airdrop: velocity-0 skips the parabola solve', () => {
  const b = new BombBulletUnit({
    velocity: 0, gravity: -0.25, airdrop: false,
    spawnX: 0, spawnY: 0, explodePos: { x: 20, y: 0 },
  });
  b.SetSpawnPosition();
  assert.equal(b.verticalSpeed, 0, 'velocity 0 -> no solve, no division-by-zero');
});

test('InitSpeed non-airdrop with no explodePos: yAngle preserved from caller', () => {
  const b = new BombBulletUnit({
    velocity: 5, gravity: -0.05, airdrop: false,
    spawnX: 0, spawnY: 0, yAngle: 30,
  });
  b.SetSpawnPosition();
  b.InitSpeed();
  assert.equal(b.yAngle, 30, 'no explodePos -> no override, yAngle from caller stands');
  assert.equal(b.updateSpeed, b.doNothing, 'no acceleration -> doNothing (gravity integrator)');
});

test('InitSpeed non-airdrop with explodePos: yAngle overridden to aim', () => {
  const b = new BombBulletUnit({
    velocity: 5, gravity: -0.05, airdrop: false,
    spawnX: 0, spawnY: 0, yAngle: 30, explodePos: { x: 10, y: 10 },
  });
  b.SetSpawnPosition();
  b.InitSpeed();
  assert.equal(b.yAngle, 45, 'atan2(dy=10, dx=10) * 180/pi = 45');
});

test('InitSpeed with acceleration: priority chain picks doAccelerate', () => {
  const b = new BombBulletUnit({
    velocity: 15, gravity: -0.05, airdrop: false,
    spawnX: 0, spawnY: 0, yAngle: 0,
    acceleration: [{ t: 0.5, u: -1, v: 0, flip: false }],
  });
  b.SetSpawnPosition();
  b.InitSpeed();
  assert.equal(b.updateSpeed, b.doAccelerate,
    'HasAcceleration -> doAccelerate per the base priority chain');
});

test('curving non-airdrop bomb (shape of bullet 164461): horizontal arc, no gravity integration', () => {
  // velocity=15, gravity=-0.05, acceleration=[{t:0.5, u:-1, v:0}]
  // No explodePos -> verticalSpeed stays 0 -> flat trajectory.
  const b = new BombBulletUnit({
    velocity: 15, gravity: -0.05, airdrop: false,
    spawnX: 0, spawnY: 0, yAngle: 0,
    acceleration: [{ t: 0.5, u: -1, v: 0, flip: false }],
  });
  b.SetSpawnPosition();
  b.InitSpeed();
  // Initial: convertedVelocity = 15 * 0.2 = 3.0 along +x.
  assert.equal(b.speed.x, 3.0);
  assert.equal(b.verticalSpeed, 0);

  // Ticks 1-15: acceleration record inactive (t=0.5 > timeElapsed).
  // Floating-point note: accumulated 15*(1/30) = 0.49999...994 < 0.5, so the
  // record does NOT activate until tick 16 (timeElapsed ≈ 0.5333 > 0.5).
  // Speed unchanged; verticalSpeed STAYS 0 even though gravity=-0.05.
  for (let i = 0; i < 15; i++) {
    b.timeElapsed += TICK_SECONDS;
    b.Update();
  }
  // After 15 ticks: timeElapsed ≈ 0.4999...994 (still < 0.5 due to float accumulation)
  assert.ok(Math.abs(b.speed.x - 3.0) < 1e-9, 'forward speed unchanged before t=0.5');
  assert.equal(b.verticalSpeed, 0, '§B3: gravity suppressed because doAccelerate runs');
  assert.equal(b.altitude, 0, 'altitude unchanged when verticalSpeed is 0');

  // Tick 16: timeElapsed ≈ 0.5333 > 0.5. Record activates (Lua: t <= timeElapsed).
  // Note: accumulated float arithmetic means the t=0.5 boundary is first crossed
  // at tick 16, not tick 15 (15*(1/30) underflows 0.5 by ~6e-18).
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  assert.ok(Math.abs(b.speed.x - 2.0) < 1e-9,
    'tick 16: u=-1 decays forward speed by 1');
  assert.equal(b.verticalSpeed, 0, 'still no gravity integration');
});

test('curving non-airdrop bomb: acceleration record activates at t=0.5 exactly (boundary)', () => {
  // Direct boundary test mirroring the Phase 3b lesson: GetAcceleration uses
  // rec.t <= timeElapsed. At timeElapsed === 0.5 the {t:0.5} record is active.
  const b = new BombBulletUnit({
    velocity: 15, airdrop: false, spawnX: 0, spawnY: 0, yAngle: 0,
    acceleration: [{ t: 0.5, u: -1, v: 0, flip: false }],
  });
  b.SetSpawnPosition();
  b.InitSpeed();
  b.timeElapsed = 0.5;
  const before = b.speed.x;
  b.Update();
  assert.ok(before - b.speed.x > 0.9, 'record active at t=0.5 (boundary inclusive)');
});

test('curving airdrop bomb (shape of bullet 170838): launchVrtSpeed override + horizontal decel', () => {
  // velocity=1.5, gravity=-0.05, acceleration=[{t:0.1, u:-0.3, v:0}],
  // launchVrtSpeed=-3, offsetY=60. Airdrop spawn: altitude=60, verticalSpeed=-3.
  const b = new BombBulletUnit({
    velocity: 1.5, gravity: -0.05, airdrop: true,
    offsetY: 60, launchVrtSpeed: -3, dropOffset: false,
    explodePos: { x: 100, y: 0 }, direction: 1,
    acceleration: [{ t: 0.1, u: -0.3, v: 0, flip: false }],
  });
  b.SetSpawnPosition();
  b.InitSpeed();
  assert.equal(b.altitude, 60, 'airdrop spawn altitude');
  assert.equal(b.verticalSpeed, -3, 'launchVrtSpeed override beats parabola solve');
  assert.equal(b.updateSpeed, b.doAccelerate, 'HasAcceleration -> doAccelerate');

  // Ticks 0-2: acceleration record inactive (t=0.1 > timeElapsed for i<3).
  // verticalSpeed stays -3, altitude drops 3/tick. Forward speed unchanged.
  const initialSpeedX = b.speed.x;
  for (let i = 0; i < 3; i++) {
    b.timeElapsed += TICK_SECONDS;
    b.Update();
  }
  // After 3 ticks: timeElapsed = 3/30 = 0.1 exactly -> record activates THIS tick.
  // So: ticks 0-2 had inactive record (early-out); tick 3 (= the 3rd Update call)
  // had timeElapsed=0.1 going in, record active, forward speed decays by 0.3.
  assert.ok(Math.abs(b.speed.x - (initialSpeedX - 0.3)) < 1e-9,
    'record activates at t=0.1 boundary, forward speed decays by 0.3');
  assert.equal(b.verticalSpeed, -3, 'verticalSpeed frozen at launchVrtSpeed');
  assert.equal(b.altitude, 60 - 3 * 3, 'altitude dropped by 3 per tick (3 ticks)');
});
