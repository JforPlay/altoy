/**
 * relmap-layout.test.mjs
 * Build-time layout for 함순이 관계도 (scripts/relmap-layout.mjs): nation
 * "countries", class "provinces" inside them, no overlapping shipgirls, and
 * the same input always gives the same map.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutRelmap, classStrip } from '../../scripts/relmap-layout.mjs';
import { pointInHull, rectHitsCircle } from '../../public/js/shipgirl/shipgirl-relations.camera.js';

// 40 nodes: nation 1 = 0..19 (provinces A = 0..5, B = 6..11), nation 2 = 20..31, nation 3 = 32..39.
const nodes = Array.from({ length: 40 }, (_, i) => ({
    nat: i < 20 ? 1 : i < 32 ? 2 : 3,
    r: 5 + Math.sqrt(i % 7) * 2.4,
}));
const links = [];
for (let i = 0; i < 40; i++) {
    links.push({ a: i, b: (i * 7 + 3) % 40, score: 1 + (i % 5) });
    if (i % 3 === 0) links.push({ a: i, b: (i + 1) % 40, score: 6 });
}
const provinces = [
    { nat: 1, kr: '알베르토 디 주사노급', members: [0, 1, 2, 3, 4, 5] },
    { nat: 1, kr: 'Z급', members: [6, 7, 8, 9, 10, 11] },
];
const topOf = (members) => Math.min(...members.map((i) => out.xy[i][1] - nodes[i].r));
const input = () => ({ nodes, links, provinces, mainNations: [1, 2] });
const out = layoutRelmap(input());

test('layout is deterministic for the same input and seed', () => {
    assert.deepEqual(layoutRelmap(input()), out);
});

test('no two shipgirls overlap by more than 1 px', () => {
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const d = Math.hypot(out.xy[i][0] - out.xy[j][0], out.xy[i][1] - out.xy[j][1]);
            assert.ok(d >= nodes[i].r + nodes[j].r - 1, `${i}-${j}: ${d.toFixed(2)}`);
        }
    }
});

test("every shipgirl sits inside her nation's outline", () => {
    assert.deepEqual(out.nations.map((n) => n.nat), [1, 2, 3]);
    for (const nation of out.nations) {
        for (const i of nation.members) {
            assert.equal(nodes[i].nat, nation.nat);
            assert.ok(pointInHull(nation.hull, out.xy[i][0], out.xy[i][1]), `node ${i}`);
        }
    }
});

test('province members sit closer to their own centroid than to a sister province', () => {
    const centroid = (m) => [0, 1].map((k) => m.reduce((s, i) => s + out.xy[i][k], 0) / m.length);
    const [ca, cb] = provinces.map((p) => centroid(p.members));
    const dist = (i, c) => Math.hypot(out.xy[i][0] - c[0], out.xy[i][1] - c[1]);
    for (const i of provinces[0].members) assert.ok(dist(i, ca) < dist(i, cb), `A ${i}`);
    for (const i of provinces[1].members) assert.ok(dist(i, cb) < dist(i, ca), `B ${i}`);
});

test('province outlines and labels are emitted per province', () => {
    assert.equal(out.provinces.length, 2);
    for (const p of out.provinces) {
        assert.ok(p.hull.length >= 6 && p.hull.every(Number.isInteger));
        assert.ok(Number.isFinite(p.labelX) && Number.isFinite(p.labelY));
    }
});

test('no other shipgirl sits inside the strip reserved for a class name', () => {
    for (const p of provinces) {
        const cx = p.members.reduce((s, i) => s + out.xy[i][0], 0) / p.members.length;
        const strip = classStrip(p.kr, cx, topOf(p.members));
        for (let i = 0; i < nodes.length; i++) {
            if (p.members.includes(i)) continue;
            assert.ok(!rectHitsCircle(strip, out.xy[i][0], out.xy[i][1], nodes[i].r), `${p.kr}: node ${i}`);
        }
    }
});

test('class names sit in their strip and nation names sit above the strips', () => {
    out.provinces.forEach((lp, pi) => {
        const strip = classStrip(provinces[pi].kr, lp.labelX, topOf(provinces[pi].members));
        assert.ok(lp.labelY > strip.y0 && lp.labelY <= strip.y1, `${provinces[pi].kr}: ${lp.labelY}`);
    });
    for (const nation of out.nations) {
        assert.ok(nation.labelY < classStrip('', 0, topOf(nation.members)).y0, `nation ${nation.nat}`);
    }
});

// Collab nations form their own block; an edge nation (Universal) is not pulled inward.
// Main nations 1–6: 10 each; collab 101/102: 4 each; edge 98: 3, linked to every main nation.
const MAINS = [1, 2, 3, 4, 5, 6];
const sideNodes = [
    ...MAINS.flatMap((nat) => Array.from({ length: 10 }, () => ({ nat, r: 7 }))),
    ...[101, 102].flatMap((nat) => Array.from({ length: 4 }, () => ({ nat, r: 7 }))),
    ...Array.from({ length: 3 }, () => ({ nat: 98, r: 7 })),
];
const sideLinks = [];
for (let i = 0; i < 60; i++) sideLinks.push({ a: i, b: (i + 11) % 60, score: 4 });
for (let k = 0; k < 3; k++) for (const nat of MAINS) sideLinks.push({ a: 68 + k, b: (nat - 1) * 10 + k, score: 12 });
sideLinks.push({ a: 60, b: 0, score: 12 }, { a: 64, b: 30, score: 12 }); // collab ↔ main pulls are ignored
const side = layoutRelmap({
    nodes: sideNodes, links: sideLinks, provinces: [], mainNations: MAINS,
    collabNations: [101, 102], edgeNations: [98],
});
const isCollab = (i) => sideNodes[i].nat >= 100;

test('collab nations get one outline that holds them and no other shipgirl', () => {
    assert.ok(side.collab, 'collab block emitted');
    sideNodes.forEach((n, i) => {
        assert.equal(pointInHull(side.collab.hull, side.xy[i][0], side.xy[i][1]), isCollab(i), `node ${i}`);
    });
});

test('the collab block sits clear of the main nations, with a gap', () => {
    const xs = (pred) => sideNodes.map((n, i) => i).filter(pred).map((i) => side.xy[i][0]);
    const collabRight = Math.max(...xs(isCollab)) + 7, mainLeft = Math.min(...xs((i) => !isCollab(i))) - 7;
    assert.ok(mainLeft - collabRight >= 60, `gap ${(mainLeft - collabRight).toFixed(1)}`);
});

test('an edge nation sits outside the main nations, not among them', () => {
    const centre = (nat) => {
        const m = sideNodes.map((n, i) => i).filter((i) => sideNodes[i].nat === nat);
        return [0, 1].map((k) => m.reduce((s, i) => s + side.xy[i][k], 0) / m.length);
    };
    const mains = MAINS.map(centre);
    const mid = [0, 1].map((k) => mains.reduce((s, c) => s + c[k], 0) / mains.length);
    const far = (c) => Math.hypot(c[0] - mid[0], c[1] - mid[1]);
    const edge = far(centre(98));
    for (const [i, c] of mains.entries()) assert.ok(edge > far(c), `nation ${i + 1}: ${far(c).toFixed(0)} ≥ edge ${edge.toFixed(0)}`);
});
