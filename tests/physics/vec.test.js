import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sub, magnitude, sqrDistance, normalize, dot, add, scale, rotate,
} from '../../public/js/simulators/physics/vec.js';

test('sub returns the component-wise difference, inputs untouched', () => {
  const a = { x: 5, y: 8 };
  const b = { x: 2, y: 3 };
  assert.deepEqual(sub(a, b), { x: 3, y: 5 });
  assert.deepEqual(a, { x: 5, y: 8 }, 'sub must not mutate its inputs');
});

test('magnitude is the Euclidean length', () => {
  assert.equal(magnitude({ x: 3, y: 4 }), 5);
});

test('sqrDistance is the squared straight-line distance (no sqrt)', () => {
  assert.equal(sqrDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 25);
});

test('normalize: scales a vector to unit length', () => {
  assert.deepEqual(normalize({ x: 3, y: 4 }), { x: 0.6, y: 0.8 });
});

test('normalize: a zero vector returns zero (no division by zero)', () => {
  assert.deepEqual(normalize({ x: 0, y: 0 }), { x: 0, y: 0 });
});

test('dot: sum of products of corresponding components', () => {
  assert.equal(dot({ x: 1, y: 2 }, { x: 3, y: 4 }), 11);
});

test('add: component-wise sum', () => {
  assert.deepEqual(add({ x: 1, y: -2 }, { x: 3, y: 5 }), { x: 4, y: 3 });
});

test('scale: multiplies both components', () => {
  assert.deepEqual(scale({ x: 2, y: -3 }, 2), { x: 4, y: -6 });
  assert.deepEqual(scale({ x: 2, y: 3 }, 0), { x: 0, y: 0 });
  assert.deepEqual(scale({ x: 2, y: 3 }, -1), { x: -2, y: -3 });
});

test('rotate: a +90 deg rotation (cos 0, sin 1) maps +x to -y', () => {
  assert.deepEqual(rotate({ x: 1, y: 0 }, 0, 1), { x: 0, y: -1 });
  assert.deepEqual(rotate({ x: 0, y: 1 }, 0, 1), { x: 1, y: 0 });
});

test('rotate: preserves magnitude for a unit (cos, sin) pair', () => {
  const r = rotate({ x: 2, y: 0 }, Math.cos(0.4), Math.sin(0.4));
  assert.ok(Math.abs(Math.hypot(r.x, r.y) - 2) < 1e-9, 'magnitude unchanged');
});

test('the new helpers never mutate their inputs', () => {
  const v = { x: 3, y: 4 };
  normalize(v);
  assert.deepEqual(v, { x: 3, y: 4 }, 'normalize must not mutate its input');
  scale(v, 5);
  assert.deepEqual(v, { x: 3, y: 4 }, 'scale must not mutate its input');
  rotate(v, 0, 1);
  assert.deepEqual(v, { x: 3, y: 4 }, 'rotate must not mutate its input');
  add(v, v);
  assert.deepEqual(v, { x: 3, y: 4 }, 'add must not mutate either input (aliased)');
  dot(v, v);
  assert.deepEqual(v, { x: 3, y: 4 }, 'dot must not mutate either input (aliased)');
});
