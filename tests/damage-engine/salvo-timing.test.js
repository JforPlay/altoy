// tests/damage-engine/salvo-timing.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salvoFiringDuration, weaponSalvoDuration } from '../../public/js/engine/damage/salvo-timing.js';

const round2 = x => Math.round(x * 100) / 100;

// ===== salvoFiringDuration =====
// Span from first to last bullet of ONE barrage:
//   first_delay + senior_repeat×senior_delay + primal_repeat×delay
// (the AL wiki's "VT" volley time — verified against real barrages 1001 / 1024).

test('salvoFiringDuration: real barrage 1001 (100mm改) — 2 waves × 0.1s = 0.10', () => {
  // senior_repeat 1, senior_delay 0.1, primal_repeat 1, delay 0
  assert.equal(round2(salvoFiringDuration({ senior_repeat: 1, senior_delay: 0.1, primal_repeat: 1, delay: 0 })), 0.10);
});

test('salvoFiringDuration: real barrage 1024 (127mm/138.6mm) — 3 waves × 0.08s = 0.16', () => {
  assert.equal(round2(salvoFiringDuration({ senior_repeat: 2, senior_delay: 0.08, primal_repeat: 1, delay: 0 })), 0.16);
});

test('salvoFiringDuration: intra-wave delay spaces bullets within a wave', () => {
  // single wave, 4 bullets (primal_repeat 3) spaced 0.05s → 3 × 0.05 = 0.15
  assert.equal(round2(salvoFiringDuration({ senior_repeat: 0, senior_delay: 0, primal_repeat: 3, delay: 0.05 })), 0.15);
});

test('salvoFiringDuration: combines first_delay + inter-wave + intra-wave', () => {
  // 0.2 + 2×0.1 + 1×0.05 = 0.45
  assert.equal(round2(salvoFiringDuration({ first_delay: 0.2, senior_repeat: 2, senior_delay: 0.1, primal_repeat: 1, delay: 0.05 })), 0.45);
});

test('salvoFiringDuration: a plain single shot has zero span', () => {
  assert.equal(salvoFiringDuration({ senior_repeat: 0, primal_repeat: 0, senior_delay: 0, delay: 0 }), 0);
});

test('salvoFiringDuration: missing fields default to 0', () => {
  assert.equal(salvoFiringDuration({}), 0);
});

test('salvoFiringDuration: null/undefined barrage → 0', () => {
  assert.equal(salvoFiringDuration(null), 0);
  assert.equal(salvoFiringDuration(undefined), 0);
});

// ===== weaponSalvoDuration =====
// A weapon reloads after its LONGEST barrage finishes → max span across barrage_ID
// (barrages in one volley fire together). getBarrage resolves an id → barrage row.

test('weaponSalvoDuration: single barrage → its own span', () => {
  const getBarrage = id => ({ 1024: { senior_repeat: 2, senior_delay: 0.08, primal_repeat: 1, delay: 0 } }[id]);
  assert.equal(round2(weaponSalvoDuration([1024], getBarrage)), 0.16);
});

test('weaponSalvoDuration: multiple barrages → the longest span (parallel volley)', () => {
  const bars = {
    10: { senior_repeat: 1, senior_delay: 0.1, primal_repeat: 0, delay: 0 },   // 0.10
    20: { senior_repeat: 2, senior_delay: 0.15, primal_repeat: 0, delay: 0 },  // 0.30
  };
  const getBarrage = id => bars[id];
  assert.equal(round2(weaponSalvoDuration([10, 20], getBarrage)), 0.30);
});

test('weaponSalvoDuration: skips missing barrages', () => {
  const getBarrage = id => ({ 5: { senior_repeat: 1, senior_delay: 0.2 } }[id]);
  assert.equal(round2(weaponSalvoDuration([5, 999], getBarrage)), 0.20);
});

test('weaponSalvoDuration: non-array / empty → 0', () => {
  assert.equal(weaponSalvoDuration(null, () => null), 0);
  assert.equal(weaponSalvoDuration([], () => null), 0);
});
