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
