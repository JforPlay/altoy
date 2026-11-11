/**
 * relmap-layout.mjs
 * Build-time layout for 함순이 관계도: nations become "countries", each class
 * inside a nation a "province", and a seeded force simulation places every
 * shipgirl. Pure and deterministic (Park–Miller RNG), so identical builds give
 * an identical map. Constants are the tuned values from the 2026-11-10 spike.
 */
import { CLASS_LABEL_ZOOM, rectHitsCircle, rectsOverlap } from '../public/js/shipgirl/shipgirl-relations.camera.js';

const NATION_PACK = 0.55;   // area packing for a nation's target radius
const PROVINCE_PACK = 0.6;
const INNER_RING = 420;
const OUTER_RING = 900;
const NATION_ITER = 600;
const SHIP_ITER = 450;
const SETTLE_ITER = 80;  // strips + spacing only, after the forces stop

// Class-name strip, in world units, sized for the zoom where every class name shows:
// 11 px semibold text (+ halo) sitting 3 px above the province's top portrait.
const STRIP_H = 15 / CLASS_LABEL_ZOOM;
const STRIP_GAP = 3 / CLASS_LABEL_ZOOM;
const classNamePx = (s) => [...s].reduce((w, ch) => w + (/[가-힣]/.test(ch) ? 11 : ch === ' ' ? 3 : 6.5), 0) + 10;

/** World box a class name `kr` occupies above a province centred at cx whose top portrait edge is `top`. */
export function classStrip(kr, cx, top) {
    const half = classNamePx(kr) / CLASS_LABEL_ZOOM / 2;
    return { x0: cx - half, x1: cx + half, y0: top - STRIP_GAP - STRIP_H, y1: top - STRIP_GAP };
}

// Monotone-chain convex hull of [x, y] points.
function convexHull(pts) {
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [];
    const up = [];
    for (const p of pts) {
        while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), p) <= 0) lo.pop();
        lo.push(p);
    }
    for (const p of pts.slice().reverse()) {
        while (up.length >= 2 && cross(up.at(-2), up.at(-1), p) <= 0) up.pop();
        up.push(p);
    }
    return lo.slice(0, -1).concat(up.slice(0, -1));
}

// Outline = hull of each member circle padded by `pad`, sampled at `steps` points.
function outline(members, P, R, pad, steps) {
    const pts = [];
    for (const i of members) {
        for (let k = 0; k < steps; k++) {
            const a = (k / steps) * 6.283;
            pts.push([P[i].x + Math.cos(a) * (R[i] + pad), P[i].y + Math.sin(a) * (R[i] + pad)]);
        }
    }
    return convexHull(pts).flat().map((v) => Math.round(v));
}

/**
 * Lay out nodes ({nat, r}) linked by {a, b, score} (node indices), grouping
 * province members ({nat, members}). Returns positions, nation outlines and
 * labels (nations in first-seen order) and province outlines and labels.
 */
export function layoutRelmap({ nodes, links, provinces, mainNations, seed = 7 }) {
    let state = seed;
    const rnd = () => (state = (state * 16807) % 2147483647) / 2147483647;
    const R = nodes.map((n) => n.r);
    const P = nodes.map(() => ({ x: 0, y: 0 }));
    const area = (members, pack) => Math.sqrt(members.reduce((s, i) => s + (R[i] + 4) ** 2, 0) / pack);

    // ----- nations: main ones on an inner ring, the rest outside, then relax -----
    const byNat = new Map();
    nodes.forEach((n, i) => {
        if (!byNat.has(n.nat)) byNat.set(n.nat, { nat: n.nat, members: [] });
        byNat.get(n.nat).members.push(i);
    });
    const C = [...byNat.values()];
    const outer = C.filter((c) => !mainNations.includes(c.nat));
    for (const c of C) {
        c.R = area(c.members, NATION_PACK);
        const m = mainNations.indexOf(c.nat);
        const a = m >= 0 ? (m / mainNations.length) * Math.PI * 2 : (outer.indexOf(c) / outer.length) * Math.PI * 2 + 0.2;
        const ring = m >= 0 ? INNER_RING : OUTER_RING;
        c.x = Math.cos(a) * ring;
        c.y = Math.sin(a) * ring;
    }
    const ci = new Map(C.map((c, i) => [c.nat, i]));
    const cross = new Map(); // cross-nation link weight pulls related nations together
    for (const l of links) {
        const A = ci.get(nodes[l.a].nat), B = ci.get(nodes[l.b].nat);
        if (A === B) continue;
        const k = `${Math.min(A, B)}-${Math.max(A, B)}`;
        cross.set(k, (cross.get(k) || 0) + l.score);
    }
    for (let it = 0; it < NATION_ITER; it++) {
        for (const [k, w] of cross) {
            const [A, B] = k.split('-').map(Number), p = C[A], q = C[B];
            const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1, L = p.R + q.R + 60;
            const f = (d - L) * Math.min(w / 400, 1) * 0.01;
            p.x += (dx / d) * f; p.y += (dy / d) * f; q.x -= (dx / d) * f; q.y -= (dy / d) * f;
        }
        for (const p of C) {
            for (const q of C) {
                if (p === q) continue;
                const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1, L = p.R + q.R + 70;
                if (d < L) { const f = (L - d) * 0.25; p.x -= (dx / d) * f; p.y -= (dy / d) * f; }
            }
        }
        for (const p of C) { p.x *= 0.995; p.y *= 0.995; }
    }

    // ----- provinces: sunflower spiral inside the nation, biggest in the middle -----
    const provs = provinces.map((p) => ({ ...p, R: area(p.members, PROVINCE_PACK), x: 0, y: 0 }));
    const provOf = new Array(nodes.length).fill(null);
    for (const p of provs) for (const i of p.members) provOf[i] = p;
    for (const c of C) {
        const ps = provs.filter((p) => p.nat === c.nat).sort((a, b) => b.members.length - a.members.length);
        ps.forEach((p, k) => {
            const a = k * 2.39996, d = Math.sqrt((k + 0.5) / (ps.length + 2)) * c.R * 0.8;
            p.x = c.x + Math.cos(a) * d;
            p.y = c.y + Math.sin(a) * d;
        });
        for (const i of c.members) {
            const o = provOf[i] || c, a = rnd() * 6.283, d = Math.sqrt(rnd()) * o.R * 0.8;
            P[i].x = o.x + Math.cos(a) * d;
            P[i].y = o.y + Math.sin(a) * d;
        }
    }

    // ----- shipgirls -----
    const shift = (members, dx, dy) => { for (const i of members) { P[i].x += dx; P[i].y += dy; } };
    // Class-name strips: shove any other portrait out along the cheaper axis (the province
    // gives a little too), and slide sister provinces apart when their strips collide.
    function clearStrips() {
        const strips = provs.map((p) => {
            let top = Infinity, sx = 0;
            for (const i of p.members) { top = Math.min(top, P[i].y - R[i]); sx += P[i].x; }
            return { p, ...classStrip(p.kr ?? '', sx / p.members.length, top) };
        });
        for (const b of strips) {
            for (let i = 0; i < nodes.length; i++) {
                const r = R[i] + 2;
                if (provOf[i] === b.p || !rectHitsCircle(b, P[i].x, P[i].y, r)) continue;
                const up = P[i].y + r - b.y0, down = b.y1 - (P[i].y - r);
                const left = P[i].x + r - b.x0, right = b.x1 - (P[i].x - r);
                const m = Math.min(up, down, left, right);
                const [mx, my] = m === up ? [0, -up] : m === down ? [0, down] : m === left ? [-left, 0] : [right, 0];
                P[i].x += mx * 0.6; P[i].y += my * 0.6;
                shift(b.p.members, -mx * 0.25, -my * 0.25);
            }
        }
        for (let a = 0; a < strips.length; a++) {
            for (let b = a + 1; b < strips.length; b++) {
                const A = strips[a], B = strips[b];
                if (A.p.nat !== B.p.nat || !rectsOverlap(A, B)) continue;
                const ox = (Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0)) / 4;
                const s = A.x0 + A.x1 < B.x0 + B.x1 ? -1 : 1;
                shift(A.p.members, s * ox, 0); shift(B.p.members, -s * ox, 0);
            }
        }
    }
    // ponytail: O(n²) collision, fine at ~1k nodes; grid-bucket it if the roster triples
    function separate() {
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const p = P[i], q = P[j], dx = q.x - p.x, dy = q.y - p.y, L = R[i] + R[j] + 3;
                if (Math.abs(dx) > L || Math.abs(dy) > L) continue;
                const d = Math.hypot(dx, dy) || 0.01;
                if (d >= L) continue;
                const f = ((L - d) / 2) * (nodes[i].nat === nodes[j].nat ? 1 : 1.5);
                p.x -= (dx / d) * f; p.y -= (dy / d) * f; q.x += (dx / d) * f; q.y += (dy / d) * f;
            }
        }
    }
    for (let it = 0; it < SHIP_ITER; it++) {
        const alpha = 1 - it / SHIP_ITER;
        for (const l of links) {
            const p = P[l.a], q = P[l.b], same = nodes[l.a].nat === nodes[l.b].nat;
            const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1, L = R[l.a] + R[l.b] + 14;
            // a link across provinces may pull provinces closer, not drag a ship out of hers
            const w = !same ? 0.004 : provOf[l.a] && provOf[l.a] === provOf[l.b] ? 0.06 : 0.015;
            const f = (d - L) * (Math.min(l.score, 15) / 15) * w * alpha;
            p.x += (dx / d) * f; p.y += (dy / d) * f; q.x -= (dx / d) * f; q.y -= (dy / d) * f;
        }
        // province cohesion, then same-nation province separation
        for (const p of provs) {
            p.x = p.members.reduce((s, i) => s + P[i].x, 0) / p.members.length;
            p.y = p.members.reduce((s, i) => s + P[i].y, 0) / p.members.length;
        }
        for (const p of provs) {
            for (const i of p.members) {
                const dx = p.x - P[i].x, dy = p.y - P[i].y, d = Math.hypot(dx, dy) || 1;
                const k = d > p.R * 0.7 ? 0.15 : 0.02;
                P[i].x += dx * k; P[i].y += dy * k;
            }
        }
        for (let a = 0; a < provs.length; a++) {
            for (let b = a + 1; b < provs.length; b++) {
                const p = provs[a], q = provs[b];
                if (p.nat !== q.nat) continue;
                const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 0.01, L = p.R + q.R + 10;
                if (d >= L) continue;
                const f = (L - d) * 0.1, ux = (dx / d) * f, uy = (dy / d) * f;
                const tot = p.members.length + q.members.length;
                for (const i of p.members) { P[i].x -= (ux * q.members.length) / tot; P[i].y -= (uy * q.members.length) / tot; }
                for (const i of q.members) { P[i].x += (ux * p.members.length) / tot; P[i].y += (uy * p.members.length) / tot; }
            }
        }
        clearStrips();
        for (const c of C) {
            for (const i of c.members) {
                const dx = c.x - P[i].x, dy = c.y - P[i].y, d = Math.hypot(dx, dy) || 1;
                const k = d > c.R * 0.85 ? 0.12 : 0.012;
                P[i].x += dx * k * alpha; P[i].y += dy * k * alpha;
            }
        }
        separate();
    }
    // settle: only strips and spacing, so the final positions honour both
    for (let it = 0; it < SETTLE_ITER; it++) { clearStrips(); separate(); }

    // ----- outlines and labels -----
    const top = (members) => Math.min(...members.map((i) => P[i].y - R[i]));
    const meanX = (members) => members.reduce((s, i) => s + P[i].x, 0) / members.length;
    return {
        xy: P.map((p) => [p.x, p.y]),
        nations: C.map((c) => ({
            nat: c.nat, members: c.members,
            labelX: meanX(c.members), labelY: top(c.members) - STRIP_GAP - STRIP_H - 12,
            hull: outline(c.members, P, R, 16, 10),
        })),
        provinces: provs.map((p) => ({
            labelX: meanX(p.members), labelY: top(p.members) - STRIP_GAP - 3 / CLASS_LABEL_ZOOM,
            hull: outline(p.members, P, R, 6, 8),
        })),
    };
}
