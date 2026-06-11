/**
 * painting-state.test.mjs
 * Tests for the story viewer's pure painting-state core
 * (computePaintingStateAt in public/js/story-viewer/story.painting.js),
 * mirroring the game's dialoguestoryplayer.lua semantics:
 *   - withoutPainting / hidePainting / narration clear ALL sides
 *   - hideOther clears all sides but the current speaker is re-placed
 *   - CENTER placement recycles LEFT + RIGHT
 *   - paintingFadeOut moves the previous painting to a new side
 *   - dim defaults: painting.alpha ?? 0.3 over painting.time ?? 1 per step
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePaintingStateAt, pickFaceCandidates, resolvePortraitFaceUrl } from '../../public/js/story-viewer/story.painting.js';

const MANIFEST = {
    '101': { faces: ['0', '1'], box: [1, 2, 3, 4], size: [100, 200] },
    '102': { faces: ['0'], box: [1, 2, 3, 4], size: [100, 200] },
    '103_n': { faces: ['0'], box: [1, 2, 3, 4], size: [100, 200] },
    '104': { faces: ['0', '2', '5'], default: '5', box: [1, 2, 3, 4], size: [100, 200] },
};

function ctxWith(scripts, { activeOptionFlag = null } = {}) {
    return {
        currentStoryScript: scripts,
        activeOptionFlag,
        expressionManifest: MANIFEST,
        BASE_URL: 'base/',
    };
}

function stateAtEnd(scripts, opts) {
    const ctx = ctxWith(scripts, opts);
    return computePaintingStateAt(ctx, scripts.length - 1);
}

test('places a painting on the line side with defaults', () => {
    const s = stateAtEnd([{ actor: 101, side: 1, say: 'hi' }]);
    assert.equal(s.paintings.size, 1);
    const p = s.paintings.get(1);
    assert.equal(p.actorId, 101);
    assert.equal(p.dir, 1);
    assert.equal(p.expression, null); // no-expression sentinel — face chain decides
    assert.equal(s.activeSide, 1);
    assert.equal(s.dimAlpha, 0.3);
    assert.equal(s.dimTime, 1);
});

test('numeric-string actor (pipeline namecode output) resolves', () => {
    const s = stateAtEnd([{ actor: '101', side: 0, say: 'hi' }]);
    assert.equal(s.paintings.get(0)?.actorId, 101);
});

test('withoutPainting clears everything including the current speaker', () => {
    const s = stateAtEnd([
        { actor: 101, side: 0, say: 'a' },
        { actor: 102, side: 1, say: 'b', withoutPainting: true },
    ]);
    assert.equal(s.paintings.size, 0);
    assert.equal(s.activeSide, null);
});

test('hidePainting clears everything (name stays a renderer concern)', () => {
    const s = stateAtEnd([
        { actor: 101, side: 0, say: 'a' },
        { actor: 102, side: 1, say: 'b', hidePainting: true },
    ]);
    assert.equal(s.paintings.size, 0);
});

test('narration line (no actor/actorName) clears everything', () => {
    const s = stateAtEnd([
        { actor: 101, side: 0, say: 'a' },
        { say: 'narration' },
    ]);
    assert.equal(s.paintings.size, 0);
});

test('hideOther clears other sides but keeps the current speaker', () => {
    const s = stateAtEnd([
        { actor: 101, side: 0, say: 'a' },
        { actor: 102, side: 1, say: 'b', hideOther: true },
    ]);
    assert.equal(s.paintings.size, 1);
    assert.equal(s.paintings.get(1)?.actorId, 102);
    assert.equal(s.activeSide, 1);
});

test('hideOther + same speaker re-places on the same side', () => {
    const s = stateAtEnd([
        { actor: 101, side: 0, say: 'a' },
        { actor: 102, side: 1, say: 'b' },
        { actor: 102, side: 1, say: 'c', hideOther: true },
    ]);
    assert.equal(s.paintings.size, 1);
    assert.equal(s.paintings.get(1)?.actorId, 102);
});

test('CENTER placement recycles LEFT and RIGHT', () => {
    const s = stateAtEnd([
        { actor: 101, side: 0, say: 'a' },
        { actor: 102, side: 1, say: 'b' },
        { actor: 103, side: 2, say: 'c' },
    ]);
    assert.equal(s.paintings.size, 1);
    assert.equal(s.paintings.get(2)?.actorId, 103);
});

test('paintingFadeOut moves the previous painting to the destination side', () => {
    const s = stateAtEnd([
        { actor: 101, side: 0, say: 'a' },
        { actor: 102, side: 1, say: 'b', paintingFadeOut: { side: 2, time: 1 } },
    ]);
    assert.equal(s.paintings.size, 2);
    assert.equal(s.paintings.get(2)?.actorId, 101);
    assert.equal(s.paintings.get(1)?.actorId, 102);
});

test('dim parameters come from the CURRENT step, defaults when absent', () => {
    const s1 = stateAtEnd([
        { actor: 101, side: 0, say: 'a', painting: { alpha: 0.55, time: 2 } },
    ]);
    assert.equal(s1.dimAlpha, 0.55);
    assert.equal(s1.dimTime, 2);

    const s2 = stateAtEnd([
        { actor: 101, side: 0, say: 'a', painting: { alpha: 0.55, time: 2 } },
        { actor: 102, side: 1, say: 'b' },
    ]);
    assert.equal(s2.dimAlpha, 0.3);
    assert.equal(s2.dimTime, 1);
});

test('actor without manifest data places nothing but keeps others', () => {
    const s = stateAtEnd([
        { actor: 101, side: 0, say: 'a' },
        { actor: 999, side: 1, say: 'b' },
    ]);
    assert.equal(s.paintings.size, 1);
    assert.equal(s.paintings.get(0)?.actorId, 101);
    assert.equal(s.activeSide, 1); // dimming still follows the speaker side
});

test('expression carried per line; same actor updates in place', () => {
    const s = stateAtEnd([
        { actor: 101, side: 0, say: 'a', expression: 1 },
        { actor: 101, side: 0, say: 'b', expression: '2' },
    ]);
    assert.equal(s.paintings.get(0)?.expression, '2');
});

test('no-expression line resets to the sentinel so the manifest default wins', () => {
    // Regression: a forced '0' here shadowed ship_skin_expression's default
    // in pickFaceCandidates ('0' exists for 104, so it would rank first).
    const s = stateAtEnd([
        { actor: 104, side: 0, say: 'a', expression: 2 },
        { actor: 104, side: 0, say: 'b' },
    ]);
    const p = s.paintings.get(0);
    assert.equal(p.expression, null);
    assert.equal(pickFaceCandidates(MANIFEST['104'], p.expression)[0], '5');
});

test('branch filtering: flagged lines outside the active branch are skipped', () => {
    // The choice line carries a speaker — an actor-less line would
    // (game-accurately) clear all paintings and mask what we test here.
    const scripts = [
        { actor: 101, side: 0, say: 'choice', options: [{ content: 'x', flag: 1 }, { content: 'y', flag: 2 }] },
        { actor: 102, side: 1, say: 'branch1', optionFlag: 1 },
        { actor: 103, side: 2, say: 'branch2', optionFlag: 2 },
    ];
    // No branch selected: only unflagged lines contribute.
    const sNull = computePaintingStateAt(ctxWith(scripts), 2);
    assert.equal(sNull.paintings.size, 1);
    assert.equal(sNull.paintings.get(0)?.actorId, 101);

    // Branch 1 active: branch-1 line places, branch-2 line (CENTER — would
    // have recycled everything) is skipped.
    const sB1 = computePaintingStateAt(ctxWith(scripts, { activeOptionFlag: 1 }), 2);
    assert.equal(sB1.paintings.get(0)?.actorId, 101);
    assert.equal(sB1.paintings.get(1)?.actorId, 102);
    assert.equal(sB1.paintings.has(2), false);
});

test('painting_n manifest variant resolves (preferred over plain)', () => {
    const s = stateAtEnd([{ actor: 103, side: 0, say: 'a' }]);
    assert.equal(s.paintings.get(0)?.actorId, 103);
});

// ---- pickFaceCandidates: game-priority face resolution ------------------
// Game: sprite name == script expression value (no remap); no-expression
// steps use ship_skin_expression[painting].default; extracted bases always
// have the face hole cut, so a neutral fallback is mandatory web-side.

test('explicit expression that exists leads the candidates', () => {
    const c = pickFaceCandidates({ faces: ['1', '3', '5', '2'] }, '5');
    assert.equal(c[0], '5');
});

test('expression missing from faces is skipped (no wasted fetch)', () => {
    const c = pickFaceCandidates({ faces: ['1', '3', '2'] }, '9');
    assert.ok(!c.includes('9'));
    assert.equal(c[0], '1'); // numeric-smallest neutral
});

test('manifest default (ship_skin_expression) outranks the neutral fallback', () => {
    const c = pickFaceCandidates({ faces: ['2', '1', '0'], default: '1' }, undefined);
    assert.equal(c[0], '1');
});

test('empty default is ignored — falls to 0 then numeric-smallest', () => {
    const withZero = pickFaceCandidates({ faces: ['2', '0', '1'], default: '' }, undefined);
    assert.equal(withZero[0], '0');
    const noZero = pickFaceCandidates({ faces: ['4', '2', '3'], default: '' }, undefined);
    assert.equal(noZero[0], '2'); // numeric-smallest, NOT array order
});

test('non-numeric face names fall back to the first listed face', () => {
    const c = pickFaceCandidates({ faces: ['smile', 'cry'] }, undefined);
    assert.deepEqual(c, ['smile']);
});

test('no faces → no candidates', () => {
    assert.deepEqual(pickFaceCandidates({ faces: [] }, '1'), []);
    assert.deepEqual(pickFaceCandidates(null, '1'), []);
});

// ---- resolvePortraitFaceUrl: dialog-portrait face URL --------------------
// The portrait must resolve through the SAME chain as the painting
// compositor, or the dialog face and the mid-screen face drift apart.

test('portrait URL: explicit expression resolves to that face', () => {
    const data = { faces: ['1', '3'], faceUrlTemplate: 'u/face_{faceId}.png' };
    assert.equal(resolvePortraitFaceUrl(data, 3), 'u/face_3.png');
    assert.equal(resolvePortraitFaceUrl(data, '1'), 'u/face_1.png');
});

test('portrait URL: no expression follows the default-first chain', () => {
    const data = { faces: ['0', '2', '5'], default: '5', faceUrlTemplate: 'u/face_{faceId}.png' };
    assert.equal(resolvePortraitFaceUrl(data, undefined), 'u/face_5.png');
});

test('portrait URL: no manifest data or no faces → null', () => {
    assert.equal(resolvePortraitFaceUrl(null, 1), null);
    assert.equal(resolvePortraitFaceUrl({ faces: [], faceUrlTemplate: 'u/face_{faceId}.png' }, 1), null);
});
