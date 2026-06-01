/**
 * Tests for shipgirl/build-sim.probability.js — the build-simulator's pure math.
 * These pin the numbers users rely on (drop chances over N builds, despair pickup, etc.).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildPoolProbabilities,
    applyDespairUrPickup,
    regularShipSingleProb,
    cumulativeChance,
    formatPercent,
} from '../../public/js/shipgirl/build-sim.probability.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('buildPoolProbabilities: N is the remainder and each pool sums to 100', () => {
    const out = buildPoolProbabilities({ heavy: { UR: 1.2, SSR: 7, SR: 12, R: 51 } });
    close(out.heavy.N, 100 - (1.2 + 7 + 12 + 51)); // 28.8
    close(out.heavy.UR + out.heavy.SSR + out.heavy.SR + out.heavy.R + out.heavy.N, 100);
});

test('buildPoolProbabilities: clamps N at 0 when base already exceeds 100', () => {
    const out = buildPoolProbabilities({ x: { UR: 60, SSR: 60, SR: 0, R: 0 } });
    assert.equal(out.x.N, 0);
});

test('buildPoolProbabilities: does not mutate the input', () => {
    const base = { a: { UR: 1, SSR: 2, SR: 3, R: 4 } };
    buildPoolProbabilities(base);
    assert.deepEqual(base, { a: { UR: 1, SSR: 2, SR: 3, R: 4 } });
});

test('applyDespairUrPickup: no UR selected → unchanged copy (not the same object)', () => {
    const base = { UR: 1.2, SSR: 7, SR: 12, R: 51, N: 28.8 };
    const out = applyDespairUrPickup(base, { UR: 2 }, false);
    assert.deepEqual(out, base);
    assert.notEqual(out, base); // fresh object
});

test('applyDespairUrPickup: UR selected → UR rises to pickup rate, N absorbs the increase', () => {
    const base = { UR: 1.2, SSR: 7, SR: 12, R: 51, N: 28.8 };
    const out = applyDespairUrPickup(base, { UR: 2 }, true);
    close(out.UR, 2);
    close(out.N, 28.8 - (2 - 1.2)); // 28.0
    close(out.UR + out.SSR + out.SR + out.R + out.N, 100);
});

test('applyDespairUrPickup: N clamps at 0, never negative', () => {
    const base = { UR: 1, SSR: 0, SR: 0, R: 0, N: 0.5 };
    const out = applyDespairUrPickup(base, { UR: 2 }, true); // increase 1 > N 0.5
    assert.equal(out.N, 0);
});

test('regularShipSingleProb: even split of the leftover after pickups', () => {
    close(regularShipSingleProb(12, 4, 4), 2); // (12-4)/4
});

test('regularShipSingleProb: zero regular ships → 0 (no divide-by-zero)', () => {
    assert.equal(regularShipSingleProb(12, 4, 0), 0);
});

test('regularShipSingleProb: pickups exceeding the rarity total clamp to 0', () => {
    assert.equal(regularShipSingleProb(5, 9, 3), 0);
});

test('cumulativeChance: 1 build returns the single chance', () => {
    close(cumulativeChance(7, 1), 7);
});

test('cumulativeChance: 10 builds at 10% ≈ 65.132156%', () => {
    close(cumulativeChance(10, 10), (1 - 0.9 ** 10) * 100, 1e-9);
});

test('cumulativeChance: 0% stays 0, 100% stays 100', () => {
    close(cumulativeChance(0, 100), 0);
    close(cumulativeChance(100, 5), 100);
});

test('formatPercent: trims float drift and trailing zeros', () => {
    assert.equal(formatPercent(28.79999999), '28.8');
    assert.equal(formatPercent(2), '2');
    assert.equal(formatPercent(2.5), '2.5');
    assert.equal(formatPercent(1.2000001), '1.2');
});
