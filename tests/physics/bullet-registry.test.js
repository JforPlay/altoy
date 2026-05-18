import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBulletUnit } from '../../public/js/simulators/physics/bullet-registry.js';
import { CannonBulletUnit } from '../../public/js/simulators/physics/bullets/cannon.js';
import { BulletUnit } from '../../public/js/simulators/physics/bullet-unit.js';

test('type 1 (CANNON) resolves to a CannonBulletUnit', () => {
  const u = createBulletUnit(1, { velocity: 10, yAngle: 0 });
  assert.ok(u instanceof CannonBulletUnit);
});

test('type 8 (STRAY) also resolves to a CannonBulletUnit', () => {
  const u = createBulletUnit(8, { velocity: 10, yAngle: 0 });
  assert.ok(u instanceof CannonBulletUnit);
});

test('an unregistered type falls back to the BulletUnit base', () => {
  const u = createBulletUnit(999, { velocity: 10, yAngle: 0 });
  assert.ok(u instanceof BulletUnit);
  assert.ok(!(u instanceof CannonBulletUnit));
});

test('createBulletUnit forwards the options to the constructor', () => {
  const u = createBulletUnit(1, { velocity: 25, yAngle: 90 });
  assert.equal(u.velocity, 25);
  assert.equal(u.yAngle, 90);
});
