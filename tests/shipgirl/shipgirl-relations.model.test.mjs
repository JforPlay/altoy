/**
 * shipgirl-relations.model.test.mjs
 * Shared model for 함순이 관계도 (public/js/shipgirl/shipgirl-relations.model.js):
 * link scoring, dominant source, fleet-trigger wording, graph parsing,
 * the visible-link filter and ?gid= resolution. The data:split builder
 * imports the same scoring, so these numbers pin both sides.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ALL_ON, scoreLink, dominantSource, josaWa, fleetTrigger, nationColor,
    parseGraph, visibleLinks, resolveDeepLink,
} from '../../public/js/shipgirl/shipgirl-relations.model.js';

const OFF = { fleet: false, mention: false, story: false, juus: false };

// 3 nodes: 0 and 1 are class sisters, 0-1 and 1-2 are linked.
const GRAPH = {
    v: 1,
    nodes: [
        [10701, '새러토가', 1, 0, 0, 10, 1, 0],
        [10702, '렉싱턴', 1, 30, 0, 12, 2, 0],
        [20101, '벨파스트', 2, 300, 0, 10, 1, -1],
    ],
    links: [
        [0, 1, 1, 2, 0.5, 0],   // fleet 3 + mention 4 + story .5 = 7.5 (mention dominates)
        [1, 2, 0, 0, 1, 2],     // 1 + 1 = 2
    ],
    nations: [[1, '이글 유니온', 15, -40, 2, [0, 0, 30, 0, 30, 30]]],
    classes: [['렉싱턴급', 'Lexington-Class', [0, 1]]],
    provinces: [[0, 1, 15, -20, [0, 0, 30, 0, 30, 30]]],
};

test('scoreLink weights fleet×3 + min(mention,5)×2 + storyW + juus×0.5', () => {
    assert.equal(scoreLink({ f: 1, m: 7, sw: 0.5, j: 2 }), 14.5);
    assert.equal(scoreLink({ f: 1, m: 7, sw: 0.5, j: 2 }, { ...ALL_ON, mention: false }), 4.5);
});

test('dominantSource picks the highest weighted term', () => {
    assert.equal(dominantSource({ f: 0, m: 1, sw: 3, j: 0 }), 'story');
    assert.equal(dominantSource({ f: 1, m: 0, sw: 0, j: 0 }), 'fleet');
    // tie (fleet 3 vs story 3) breaks in SOURCES order
    assert.equal(dominantSource({ f: 1, m: 0, sw: 3, j: 0 }), 'fleet');
    // a switched-off source never dominates
    assert.equal(dominantSource({ f: 1, m: 0, sw: 0.5, j: 0 }, { ...ALL_ON, fleet: false }), 'story');
});

test('josaWa picks 과 only after a final consonant', () => {
    assert.equal(josaWa('새러토가'), '와');
    assert.equal(josaWa('제퍼슨'), '과');
    assert.equal(josaWa('헬레나·META'), '와');
});

test('fleetTrigger states exactly who is needed', () => {
    assert.equal(fleetTrigger(['새러토가'], 1), '새러토가와 함께');
    assert.equal(fleetTrigger(['렉싱턴', '새러토가'], 2), '렉싱턴·새러토가와 함께');
    assert.equal(fleetTrigger(['오마하', '롤리', '리치몬드'], 1), '오마하·롤리·리치몬드 중 한 명과 함께');
    assert.equal(fleetTrigger(['대처', '얼릭', '푸트', '스펜스'], 2), '대처·얼릭·푸트·스펜스 중 2명과 함께');
});

test('nationColor uses the fixed hue table, desaturated META, hashed fallback', () => {
    assert.deepEqual(nationColor(1), { hue: 210, sat: 60 });
    assert.deepEqual(nationColor(97), { hue: 0, sat: 5 });
    assert.deepEqual(nationColor(105), { hue: (105 * 47) % 360, sat: 60 });
});

test('parseGraph fills adjacency, classes, sisters and the gid index', () => {
    const model = parseGraph(GRAPH);
    const [sara, lex, bel] = model.nodes;
    assert.equal(model.byGid.get(10702), lex);
    assert.deepEqual(lex.adj.map((l) => l.i), [0, 1]);
    assert.deepEqual(bel.adj.map((l) => l.i), [1]);
    assert.deepEqual(sara.classes, [0]);
    assert.deepEqual([...sara.mates], [1]);
    assert.equal(bel.mates.size, 0);
    assert.equal(bel.province, -1);
    assert.deepEqual(model.links[0], { i: 0, a: 0, b: 1, f: 1, m: 2, sw: 0.5, j: 0, s: 7.5, d: 'mention', vis: true });
});

test('visibleLinks is empty when every source is off or the bar is too high', () => {
    const model = parseGraph(GRAPH);
    assert.deepEqual(visibleLinks(model, OFF, 0), []);
    assert.deepEqual(visibleLinks(model, ALL_ON, 999), []);
});

test('visibleLinks scores, colors and sorts weakest first', () => {
    const model = parseGraph(GRAPH);
    const vis = visibleLinks(model, ALL_ON, 0);
    assert.deepEqual(vis.map((l) => l.s), [2, 7.5]);
    assert.deepEqual(vis.map((l) => l.d), ['story', 'mention']);
    assert.deepEqual(visibleLinks(model, ALL_ON, 3).map((l) => l.i), [0]);
});

test('resolveDeepLink accepts only a known numeric gid', () => {
    const model = parseGraph(GRAPH);
    assert.equal(resolveDeepLink(model, '10701'), model.nodes[0]);
    for (const raw of ['abc', '', null, undefined, '99999', '10701abc']) {
        assert.equal(resolveDeepLink(model, raw), null, String(raw));
    }
});

test('loadMatchingEvidence refetches once on a stale stamp, then gives up', async () => {
    const { loadMatchingEvidence } = await import('../../public/js/shipgirl/shipgirl-relations.model.js');
    const calls = [];
    const fresh = await loadMatchingEvidence(async (force) => { calls.push(force); return { id: force ? 'b' : 'a' }; }, 'b');
    assert.deepEqual(fresh, { id: 'b' });
    assert.deepEqual(calls, [false, true]);
    await assert.rejects(loadMatchingEvidence(async () => ({ id: 'old' }), 'new'), /stamp/);
    assert.deepEqual(await loadMatchingEvidence(async () => ({ id: 'x' }), 'x'), { id: 'x' });
});

test('parseGraph keeps the build stamp', () => {
    assert.equal(parseGraph({ ...GRAPH, id: 'abc' }).id, 'abc');
});

test('parseGraph reads the 콜라보 frame, and none from a graph without groups', () => {
    const hull = [0, 0, 40, 0, 40, 40];
    assert.deepEqual(parseGraph({ ...GRAPH, groups: [['콜라보', 20, -60, hull]] }).groups,
        [{ name: '콜라보', labelX: 20, labelY: -60, hull }]);
    assert.deepEqual(parseGraph(GRAPH).groups, []);
});
