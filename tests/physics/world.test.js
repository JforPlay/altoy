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
