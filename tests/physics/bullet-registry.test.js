import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBulletUnit } from '../../public/js/simulators/physics/bullet-registry.js';
import { CannonBulletUnit } from '../../public/js/simulators/physics/bullets/cannon.js';
import { TorpedoBulletUnit } from '../../public/js/simulators/physics/bullets/torpedo.js';
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

test('type 3 (TORPEDO) resolves to a TorpedoBulletUnit', () => {
  const u = createBulletUnit(3, { velocity: 10, yAngle: 0 });
  assert.ok(u instanceof TorpedoBulletUnit);
});

test('a TorpedoBulletUnit is also a BulletUnit', () => {
  const u = createBulletUnit(3, { velocity: 10, yAngle: 0 });
  assert.ok(u instanceof BulletUnit);
});

test('type 9 maps to EffectBulletUnit', async () => {
  const { EffectBulletUnit } = await import(
    '../../public/js/simulators/physics/bullets/effect.js'
  );
  const unit = createBulletUnit(9, { velocity: 10, yAngle: 0, range: 10 });
  assert.ok(unit instanceof EffectBulletUnit);
});

test('type 5 maps to ShrapnelBulletUnit', async () => {
  const { ShrapnelBulletUnit } = await import(
    '../../public/js/simulators/physics/bullets/shrapnel.js'
  );
  const unit = createBulletUnit(5, { velocity: 10, yAngle: 0, range: 10 });
  assert.ok(unit instanceof ShrapnelBulletUnit);
});
