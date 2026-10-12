// tests/story/story-frames.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { framePlacement, visibleCrop, STAGE_W, STAGE_H } from '../../public/js/story-viewer/story.frames.js';

// I404 (skin 317020), validated against an in-game screenshot.
const I404 = { frame: [5598, 3787, 656, 1556], size: [11830, 10224] };
const near = (a, b, eps = 0.5) => assert.ok(Math.abs(a - b) <= eps, `${a} !≈ ${b}`);

test('I404 in the middle slot reproduces the in-game scale and position', () => {
    const p = framePlacement({ ...I404, side: 2 });
    near(p.scale, 0.40488, 0.0002);
    // frame centre (5926, 4565) lands on the slot centre (960, 555)
    near(p.left + 5926 * p.scale, 960);
    near(p.top + 4565 * p.scale, 555);
    near(p.width, 11830 * p.scale);
    assert.equal(p.flip, false);
});

test('side slots sit at ±591 and actorPosition / actorScale apply in stage units', () => {
    const left = framePlacement({ ...I404, side: 0 });
    near(left.left + 5926 * left.scale, 960 - 591);
    const moved = framePlacement({ ...I404, side: 1, actorPosition: { x: 100, y: 50 }, actorScale: 2 });
    near(moved.scale, 0.40488 * 2, 0.0004);
    near(moved.left + 5926 * moved.scale, 960 + 591 + 100);
    near(moved.top + 4565 * moved.scale, 555 - 50);  // Unity y is up
});

test('dir -1 mirrors the box about the slot centre and flags the flip', () => {
    const a = framePlacement({ ...I404, side: 2 });
    const b = framePlacement({ ...I404, side: 2, dir: -1 });
    assert.equal(b.flip, true);
    near(b.left, 2 * 960 - a.left - a.width);
});

test('no frame falls back to a bottom-anchored fit (stale / missing frames file)', () => {
    const p = framePlacement({ frame: null, size: [1000, 2000], side: 2 });
    assert.ok(p.height <= STAGE_H * 0.92 && p.width <= STAGE_W);
    near(p.top + p.height, STAGE_H);
    near(p.left + p.width / 2, 960);
});

test('visibleCrop keeps only the on-stage part, in painting px and stage units', () => {
    const p = framePlacement({ ...I404, side: 2 });
    const c = visibleCrop(p, I404.size);
    assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= 11830 && c.y + c.h <= 10224);
    assert.ok(c.left <= 0.5 && c.top <= 0.5);
    assert.ok(c.left + c.width >= STAGE_W - 1 && c.top + c.height >= STAGE_H - 1);
    near(c.width / c.w, p.scale, 1e-9);
});

test('visibleCrop mirrors the crop for a flipped painting and is null fully off-stage', () => {
    // The flip mirrors about the slot centre, which is the frame centre: in the
    // middle slot the same painting window stays on stage, only mirrored.
    const a = visibleCrop(framePlacement({ ...I404, side: 2 }), I404.size);
    const b = visibleCrop(framePlacement({ ...I404, side: 2, dir: -1 }), I404.size);
    near(b.x, a.x, 1);
    near(b.w, a.w, 1);
    near(b.left, a.left, 1);
    // In a side slot the window shifts; the crop must map back through the mirror
    // onto exactly the stage box it reports.
    const pf = framePlacement({ ...I404, side: 0, dir: -1 });
    const c = visibleCrop(pf, I404.size);
    near(c.left, pf.left + (11830 - (c.x + c.w)) * pf.scale, 1e-6);
    assert.ok(c.left <= 0.5 && c.left + c.width >= 0 && c.left + c.width <= STAGE_W + 0.5);
    assert.ok(c.x >= 0 && c.x + c.w <= 11830);
    assert.equal(visibleCrop({ left: 5000, top: 0, width: 100, height: 100, flip: false }, [10, 10]), null);
});
