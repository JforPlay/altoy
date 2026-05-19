import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../../public/js/simulators/physics/world.js';
import { TICK_SECONDS } from '../../public/js/simulators/physics/constants.js';

test('spawnBullet creates a live, range-resolved, speed-initialised unit', () => {
  const world = new World();
  const b = world.spawnBullet({
    type: 1, velocity: 50, yAngle: 0, range: 40, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
  });
  assert.ok(b, 'spawn succeeds');
  assert.equal(world.bullets.length, 1);
  assert.equal(b.sqrRange, 1600, 'FixRange ran');
  assert.equal(b.speed.x, 10, 'InitSpeed ran');
});

test('step advances every bullet by one 1/30 s tick', () => {
  const world = new World();
  const b = world.spawnBullet({
    type: 1, velocity: 50, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
  });
  world.step();
  assert.equal(b.position.x, 10);
  assert.equal(b.timeElapsed, TICK_SECONDS);
});

test('a cannon bullet flies straight and is culled when it passes its range', () => {
  const world = new World();
  const b = world.spawnBullet({
    type: 1, velocity: 50, yAngle: 0, range: 25, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
  });
  world.step();                         // x=10
  world.step();                         // x=20, sqrDist 400 < 625
  assert.equal(world.bullets.length, 1, 'still in flight');
  world.step();                         // x=30, sqrDist 900 > 625 -> expire
  assert.equal(b.reachDestFlag, true);
  assert.equal(world.bullets.length, 0, 'expired bullet is culled');
});

test('spawnBullet rejects a non-finite spawn coordinate', () => {
  const world = new World();
  const b = world.spawnBullet({
    type: 1, velocity: 10, yAngle: 0, range: 10, spawnX: NaN, spawnY: 0,
  });
  assert.equal(b, null);
  assert.equal(world.bullets.length, 0);
});

test('spawnBullet rejects a non-finite velocity', () => {
  // A NaN velocity yields NaN speed -> NaN position -> the squared-distance
  // range check never trips, so the bullet would leak forever. Reject it.
  const world = new World();
  const b = world.spawnBullet({
    type: 1, velocity: NaN, yAngle: 0, range: 10, spawnX: 0, spawnY: 0,
  });
  assert.equal(b, null);
  assert.equal(world.bullets.length, 0);
});

test('a type-8 STRAY bullet flies straight and is culled at its range', () => {
  // STRAY (8) shares CannonBulletUnit with CANNON (1). This pins type 8
  // explicitly rather than relying on transitivity through the shared class.
  const world = new World();
  // velocity 50 -> speed 10/tick; range 25 -> sqrRange 625.
  world.spawnBullet({
    type: 8, velocity: 50, yAngle: 0, range: 25, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
  });
  world.step();                         // x=10, sqrDist 100
  world.step();                         // x=20, sqrDist 400 < 625
  assert.equal(world.bullets.length, 1, 'still in flight');
  world.step();                         // x=30, sqrDist 900 > 625 -> expire
  assert.equal(world.bullets.length, 0, 'STRAY culled at range');
});

test('a type-3 torpedo flies straight and is culled at its range', () => {
  // Torpedo (3) uses TorpedoBulletUnit — plain straight-line movement.
  const world = new World();
  // velocity 50 -> speed 10/tick; range 25 -> sqrRange 625.
  world.spawnBullet({
    type: 3, velocity: 50, yAngle: 0, range: 25, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
  });
  world.step();                         // x=10, sqrDist 100
  world.step();                         // x=20, sqrDist 400 < 625
  assert.equal(world.bullets.length, 1, 'still in flight');
  world.step();                         // x=30, sqrDist 900 > 625 -> expire
  assert.equal(world.bullets.length, 0, 'torpedo culled at range');
});

test('spawnBomb resolves airdrop geometry, vertical speed, and aim', () => {
  const world = new World();
  const b = world.spawnBomb({
    type: 2, velocity: 5, gravity: -0.25, offsetY: 8, dropOffset: false,
    range: 50, rangeOffset: 0, explodePos: { x: 20, y: 0 }, direction: 1,
  });
  assert.ok(b, 'spawn succeeds');
  assert.equal(world.bullets.length, 1);
  assert.deepEqual(b.position, { x: 20, y: 0 }, 'SetSpawnPosition ran');
  assert.equal(b.altitude, 8, 'altitude seeded to offsetY');
  assert.ok(b.verticalSpeed < 0, 'verticalSpeed solved (descending)');
  assert.equal(b.yAngle, 0, 'InitSpeed ran');
});

test('a spawned bomb falls under gravity and is culled when it detonates', () => {
  const world = new World();
  // Overhead bomb: flightTime ~1.2 ticks; it descends past the detonation
  // height within two ticks.
  world.spawnBomb({
    type: 2, velocity: 5, gravity: -0.25, offsetY: 8, dropOffset: false,
    range: 50, rangeOffset: 0, explodePos: { x: 20, y: 0 }, direction: 1,
  });
  world.step();
  assert.equal(world.bullets.length, 1, 'still falling');
  world.step();
  assert.equal(world.bullets.length, 0, 'detonated and culled');
});

test('spawnBomb rejects a non-finite explode point', () => {
  const world = new World();
  const b = world.spawnBomb({ type: 2, velocity: 5, explodePos: { x: NaN, y: 0 } });
  assert.equal(b, null);
  assert.equal(world.bullets.length, 0);
});
