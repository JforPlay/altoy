/**
 * story-effects.test.mjs
 * Pure-plan tests for the story viewer's flash blink (`line.flash`),
 * mirroring the game's StartBlinkAnimation (storyplayer.lua:1484-1515):
 * each cycle rises alpha[0]→alpha[1] over dur/2, holds `wait`, falls
 * back over dur/2 — it must always end back at alpha[0] (never leaves
 * the screen covered).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBlinkPlan } from '../../public/js/story-viewer/story.effects.js';

test('single cycle: rise, hold wait, fall — data-shape from main story', () => {
    // Real shape: all 26 occurrences look like this (white, no black flag).
    const plan = buildBlinkPlan({ alpha: [0, 1], delay: 0.3, dur: 0.5, number: 1, wait: 0.2 });
    assert.deepEqual(plan, [
        { at: 300, from: 0, to: 1, dur: 250 },
        { at: 750, from: 1, to: 0, dur: 250 },
    ]);
});

test('multiple cycles run sequentially', () => {
    const plan = buildBlinkPlan({ alpha: [0, 1], dur: 0.5, number: 2, wait: 0.2 });
    assert.equal(plan.length, 4);
    assert.deepEqual(plan.map(p => p.at), [0, 450, 700, 1150]);
    // Every cycle ends back at the starting alpha.
    assert.equal(plan[1].to, 0);
    assert.equal(plan[3].to, 0);
});

test('defaults: missing fields fall back sanely', () => {
    const plan = buildBlinkPlan({ alpha: [0, 1] });
    assert.deepEqual(plan, [
        { at: 0, from: 0, to: 1, dur: 250 },
        { at: 250, from: 1, to: 0, dur: 250 },
    ]);
});

test('no spec → empty plan', () => {
    assert.deepEqual(buildBlinkPlan(null), []);
    assert.deepEqual(buildBlinkPlan(undefined), []);
});
