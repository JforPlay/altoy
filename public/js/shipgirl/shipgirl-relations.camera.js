/**
 * shipgirl-relations.camera.js
 * Pure camera and hit-test math for the 함순이 관계도 canvas. A camera is
 * {x, y, k}: the world point at the viewport centre and the zoom factor.
 * Node-importable; the build-time layout test reuses pointInHull.
 */

export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 3.5;
// Every class name shows from this zoom on; the build-time layout reserves a strip
// that size above each province, so a class name never covers a portrait.
export const CLASS_LABEL_ZOOM = 0.9;
const LABEL_HEADROOM = 60; // world px above the top nations for their names

const clampZoom = (k) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));

export function toScreen(cam, x, y, W, H) {
    return [(x - cam.x) * cam.k + W / 2, (y - cam.y) * cam.k + H / 2];
}

export function toWorld(cam, sx, sy, W, H) {
    return [(sx - W / 2) / cam.k + cam.x, (sy - H / 2) / cam.k + cam.y];
}

/** Camera that shows the bounds (plus label headroom on top) inside a W×H viewport. */
export function fitCamera({ x0, y0, x1, y1 }, W, H) {
    const top = y0 - LABEL_HEADROOM;
    return {
        x: (x0 + x1) / 2,
        y: (top + y1) / 2,
        k: clampZoom(Math.min(W / (x1 - x0 + 120), (H - 60) / (y1 - top + 120))),
    };
}

/** Zoom by `factor` around screen point (sx, sy), keeping the world point under it fixed. */
export function zoomAt(cam, sx, sy, factor, W, H) {
    const [wx, wy] = toWorld(cam, sx, sy, W, H);
    const k = clampZoom(cam.k * factor);
    return { x: wx - (sx - W / 2) / k, y: wy - (sy - H / 2) / k, k };
}

/** Topmost node (last drawn) whose circle, plus 3 screen px of slack, contains the point. */
export function hitNode(nodes, wx, wy, k) {
    for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (Math.hypot(n.x - wx, n.y - wy) <= n.r + 3 / k) return n;
    }
    return null;
}

/** Screen-px rectangles {x0, y0, x1, y1} share area (touching edges don't count). */
export function rectsOverlap(a, b) {
    return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

/** Rectangle b reaches inside the circle (cx, cy, r). */
export function rectHitsCircle(b, cx, cy, r) {
    const nx = Math.max(b.x0, Math.min(cx, b.x1)), ny = Math.max(b.y0, Math.min(cy, b.y1));
    return (nx - cx) ** 2 + (ny - cy) ** 2 < r * r;
}

/**
 * Keep a nation name (baseline centre x, y; text width w; font size px) inside the
 * part of its nation's screen box that is in the W×H view, so a nation you are
 * zoomed into stays named. `pinned` says it left its natural spot.
 */
export function pinLabel(x, y, w, size, box, W, H) {
    let px = x;
    const lo = Math.max(box.x0, 0) + w / 2 + 8, hi = Math.min(box.x1, W) - w / 2 - 8;
    if (lo <= hi) px = Math.max(lo, Math.min(x, hi));
    else px = Math.max(w / 2 + 8, Math.min(x, W - w / 2 - 8)); // nation narrower than its name: stay in view
    const py = Math.max(size + 10, Math.min(y, Math.min(box.y1, H) - 6));
    return { x: px, y: py, pinned: px !== x || py !== y };
}

/** Even-odd ray cast against a flat [x0, y0, x1, y1, …] polygon. */
export function pointInHull(hull, x, y) {
    let inside = false;
    const n = hull.length / 2;
    for (let a = 0, b = n - 1; a < n; b = a++) {
        const xa = hull[a * 2], ya = hull[a * 2 + 1], xb = hull[b * 2], yb = hull[b * 2 + 1];
        if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
    }
    return inside;
}
