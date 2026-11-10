/**
 * shipgirl-relations.camera.test.mjs
 * Pure camera and hit-test math for the 함순이 관계도 canvas
 * (public/js/shipgirl/shipgirl-relations.camera.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    fitCamera, zoomAt, toScreen, toWorld, hitNode, pointInHull,
} from '../../public/js/shipgirl/shipgirl-relations.camera.js';

const W = 800, H = 600;
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('toWorld inverts toScreen', () => {
    const cam = { x: 120, y: -40, k: 0.7 };
    const [sx, sy] = toScreen(cam, 300, 250, W, H);
    const [x, y] = toWorld(cam, sx, sy, W, H);
    assert.ok(near(x, 300) && near(y, 250));
    assert.deepEqual(toScreen(cam, cam.x, cam.y, W, H), [W / 2, H / 2]);
});

test('zoomAt keeps the world point under the cursor fixed', () => {
    const cam = { x: 0, y: 0, k: 1 };
    const before = toWorld(cam, 100, 500, W, H);
    const next = zoomAt(cam, 100, 500, 1.8, W, H);
    const after = toWorld(next, 100, 500, W, H);
    assert.ok(near(before[0], after[0]) && near(before[1], after[1]));
    assert.equal(next.k, 1.8);
    assert.equal(cam.k, 1, 'input camera is not mutated');
});

test('zoomAt clamps to 0.08–3.5', () => {
    assert.equal(zoomAt({ x: 0, y: 0, k: 3 }, 10, 10, 10, W, H).k, 3.5);
    assert.equal(zoomAt({ x: 0, y: 0, k: 0.1 }, 10, 10, 0.01, W, H).k, 0.08);
});

test('hitNode finds a node at its rim and misses outside it', () => {
    const nodes = [{ x: 0, y: 0, r: 10 }, { x: 100, y: 0, r: 5 }];
    assert.equal(hitNode(nodes, 12.9, 0, 1), nodes[0]);   // r + 3/k slack
    assert.equal(hitNode(nodes, 13.1, 0, 1), null);
    assert.equal(hitNode(nodes, 100, 7, 1), nodes[1]);
    assert.equal(hitNode(nodes, 50, 50, 1), null);
});

test('pointInHull holds inside a square and fails outside', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10];
    assert.equal(pointInHull(square, 5, 5), true);
    assert.equal(pointInHull(square, 0.5, 9.5), true);
    assert.equal(pointInHull(square, 11, 5), false);
    assert.equal(pointInHull(square, 5, -1), false);
});

test('fitCamera keeps the bounds plus 60 px label headroom on screen', () => {
    for (const b of [{ x0: -900, y0: -400, x1: 1100, y1: 700 }, { x0: 0, y0: 0, x1: 300, y1: 2000 }]) {
        const cam = fitCamera(b, W, H);
        const [ax, ay] = toScreen(cam, b.x0, b.y0 - 60, W, H);
        const [bx, by] = toScreen(cam, b.x1, b.y1, W, H);
        for (const v of [ax, bx]) assert.ok(v >= 0 && v <= W, `x ${v}`);
        for (const v of [ay, by]) assert.ok(v >= 0 && v <= H, `y ${v}`);
    }
});
