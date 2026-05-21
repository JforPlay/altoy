import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BombBulletUnit } from '../../public/js/simulators/physics/bullets/bomb.js';

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
