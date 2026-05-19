import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sub, magnitude, sqrDistance } from '../../public/js/simulators/physics/vec.js';

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
