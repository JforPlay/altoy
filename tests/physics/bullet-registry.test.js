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

test('type 11 maps to GravitationBulletUnit', async () => {
  const { GravitationBulletUnit } = await import(
    '../../public/js/simulators/physics/bullets/gravitation.js'
  );
  const unit = createBulletUnit(11, { velocity: 10, yAngle: 0, range: 50 });
  assert.ok(unit instanceof GravitationBulletUnit);
});

test('type 13 (MISSILE) falls through to BulletUnit (harness-only — deliberately unregistered)', () => {
  // MissileBulletUnit exists in physics/bullets/missile.js but is intentionally
  // NOT registered (the doOrbit precedent — 0 reached against current data).
  const unit = createBulletUnit(13, { velocity: 10, yAngle: 0, range: 50 });
  assert.ok(unit.constructor.name === 'BulletUnit', 'type 13 must fall through to base');
});

test('type 15 (SCALE) falls through to BulletUnit (harness-only — deliberately unregistered)', () => {
  const unit = createBulletUnit(15, { velocity: 10, yAngle: 0, range: 50 });
  assert.ok(unit.constructor.name === 'BulletUnit', 'type 15 must fall through to base');
});

test('type 4 (DIRECT) falls through to the BulletUnit base (straight mover)', () => {
  const u = createBulletUnit(4, { velocity: 10, yAngle: 0, range: 50 });
  assert.equal(u.constructor.name, 'BulletUnit', 'type 4 must use the straight base');
});

test('type 6 (ANTIAIR) falls through to the BulletUnit base (straight mover)', () => {
  const u = createBulletUnit(6, { velocity: 10, yAngle: 0, range: 50 });
  assert.equal(u.constructor.name, 'BulletUnit', 'type 6 must use the straight base');
});

test('type 7 (ANTISEA) falls through to the BulletUnit base (straight mover)', () => {
  const u = createBulletUnit(7, { velocity: 10, yAngle: 0, range: 50 });
  assert.equal(u.constructor.name, 'BulletUnit', 'type 7 must use the straight base');
});

test('a base type-4 bullet advances straight by speed each tick', () => {
  const b = createBulletUnit(4, { velocity: 50, yAngle: 0, range: 100, rangeOffset: 0 });
  b.FixRange();
  b.InitSpeed();
  b.Update();
  assert.equal(b.position.x, 10);   // 50 * 0.2
  assert.equal(b.position.y, 0);
});
