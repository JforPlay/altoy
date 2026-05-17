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
