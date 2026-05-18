import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drainAccumulator } from '../../public/js/simulators/physics/accumulator.js';
import { VIEW_FPS } from '../../public/js/simulators/physics/constants.js';

const TICK_MS = 1000 / VIEW_FPS;   // 33.33... ms per fixed tick

test('an empty accumulator runs no ticks', () => {
  const r = drainAccumulator(0);
  assert.equal(r.ticks, 0);
  assert.equal(r.remainder, 0);
});

test('under one tick: no ticks run, the whole input is carried forward', () => {
  const r = drainAccumulator(20);   // 20 ms < 33.33 ms
  assert.equal(r.ticks, 0);
  assert.equal(r.remainder, 20);    // exact — nothing consumed
});

test('mid-band input runs the expected whole tick count', () => {
  assert.equal(drainAccumulator(50).ticks, 1);   // in [1*TICK, 2*TICK)
  assert.equal(drainAccumulator(80).ticks, 2);   // in [2*TICK, 3*TICK)
});

test('the carried remainder is a valid sub-tick value', () => {
  const r = drainAccumulator(50);
  assert.ok(r.remainder >= 0 && r.remainder < TICK_MS,
    'remainder is in [0, TICK_MS)');
  // ticks consumed + remainder reconstructs the input when under the clamp.
  assert.ok(Math.abs(r.ticks * TICK_MS + r.remainder - 50) < 1e-9);
});

test('a long stall is clamped to maxTicks (no catch-up burst)', () => {
  // 10 s of banked time is ~300 ticks; the default clamp is 4.
  assert.equal(drainAccumulator(10000).ticks, 4);
});

test('the clamp is configurable', () => {
  assert.equal(drainAccumulator(10000, 2).ticks, 2);
});
