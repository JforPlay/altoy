// tests/story/story-frames.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { framePlacement, visibleCrop, fitWidth, fitPad, STAGE_W, STAGE_H } from '../../public/js/story-viewer/story.frames.js';

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

test('fitWidth spans the outermost frame about the stage centre, capped at the stage', () => {
    const centre = framePlacement({ ...I404, side: 2 });
    const left = framePlacement({ ...I404, side: 0 });
    const right = framePlacement({ ...I404, side: 1 });
    // The focus is the duihua rect, centred on the slot — not the whole painting.
    near((centre.focus[0] + centre.focus[1]) / 2, 960);
    near(centre.focus[1] - centre.focus[0], 656 * centre.scale);
    assert.equal(fitWidth([]), null);
    const one = fitWidth([centre.focus]);
    assert.ok(one > 656 * centre.scale && one < 400);
    // Two side slots need nearly the whole stage; a third in the middle adds nothing.
    const two = fitWidth([left.focus, right.focus]);
    assert.ok(two > 2 * (591 + 100) && two <= STAGE_W);
    assert.equal(fitWidth([left.focus, right.focus, centre.focus]), two);
    assert.equal(fitWidth([[-500, 0], [1920, 2500]]), STAGE_W);
});

test('fitPad is 0 while the layer covers the viewer and steps up as it shrinks', () => {
    assert.equal(fitPad(1835, 1920, 1080), 0);      // 16:9 desktop, two side slots
    assert.equal(fitPad(300, 390, 844), 0);         // phone, one narrow frame still covers
    assert.equal(fitPad(null, 390, 844), 0);
    const phone = fitPad(1835, 390, 844);           // phone, two side slots
    assert.ok(phone >= (1835 * 844 / 390 - 1080) / 2);
    assert.equal(phone % 270, 0);
    assert.ok(fitPad(1835, 390, 600) < phone);
});

test('visibleCrop with a pad keeps the painting past the stage top and bottom', () => {
    const p = framePlacement({ ...I404, side: 2 });
    const tight = visibleCrop(p, I404.size);
    const loose = visibleCrop(p, I404.size, 540);
    assert.equal(loose.x, tight.x);
    assert.equal(loose.w, tight.w);
    assert.ok(loose.top < -0.5 && loose.top >= -540 - 1);
    assert.ok(loose.top + loose.height > STAGE_H + 0.5 && loose.top + loose.height <= STAGE_H + 540 + 1);
    near(loose.height / loose.h, p.scale, 1e-9);
});
