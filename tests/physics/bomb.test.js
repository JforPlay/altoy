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
