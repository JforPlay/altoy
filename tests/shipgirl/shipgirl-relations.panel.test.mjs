/**
 * shipgirl-relations.panel.test.mjs
 * Evidence panel markup for 함순이 관계도 (public/js/shipgirl/shipgirl-relations.panel.js):
 * exact fleet-trigger wording, escaping, alias highlighting, and the
 * no-link / evidence-failed / zero-visible states.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ON, parseGraph, visibleLinks } from '../../public/js/shipgirl/shipgirl-relations.model.js';
import { panelHtml, storyPath } from '../../public/js/shipgirl/shipgirl-relations.panel.js';

// 0 찰스 오스본 — fleet (2 of 4 Little Beavers) with 1 大처; 1 대처; 2 얼릭; 3 푸트; 4 스펜스;
// 5 퀸 엘리자베스 — mentioned by 6 벨파스트 as 폐하; 7 플레처 / 8 니콜라스 — sisters, no links.
const GRAPH = {
    v: 1,
    nodes: [
        [10111, '찰스 오스본', 1, 0, 0, 7, 1, -1],
        [10112, '대처', 1, 30, 0, 7, 1, -1],
        [10113, '얼릭', 1, 60, 0, 5, 0, -1],
        [10114, '푸트', 1, 90, 0, 5, 0, -1],
        [10115, '스펜스', 1, 120, 0, 5, 0, -1],
        [20101, '퀸 엘리자베스', 2, 300, 0, 7, 1, -1],
        [20102, '벨파스트', 2, 330, 0, 7, 1, -1],
        [10120, '플레처', 1, 0, 90, 5, 0, 0],
        [10121, '니콜라스', 1, 30, 90, 5, 0, 0],
    ],
    links: [
        [0, 1, 1, 0, 0, 0],
        [5, 6, 0, 1, 1.5, 0],
    ],
    nations: [[1, '이글 유니온', 0, -40, 7, [0, 0, 1, 0, 1, 1]], [2, '로열 네이비', 300, -40, 2, [0, 0, 1, 0, 1, 1]]],
    classes: [['플레처급', 'Fletcher-Class', [7, 8]]],
    provinces: [[0, 1, 15, 80, [0, 0, 1, 0, 1, 1]]],
};
const EVIDENCE = {
    v: 1,
    links: [
        [[[0, '비버즈, 31노트 전속 전진!', 'https://x/a.ogg', [1, 2, 3, 4], 2]], [], 0, []],
        [[], [[6, '<b>"정의"</b> 폐하께서 부르십니다', null, '폐하']], 3, [
            ['e', 123, 456, '홍차와 <스콘>', '로열 이벤트'],
            ['m', 1, 620, '프롤로그', '청홍의 메아리'],
        ]],
    ],
};
const href = (p) => `/altoy/${p}`;
const model = parseGraph(GRAPH);
visibleLinks(model, ALL_ON, 0);
const linksOf = (n) => n.adj.filter((l) => l.vis).sort((a, b) => b.s - a.s);
const render = (i, extra = {}) => {
    const node = model.nodes[i];
    return panelHtml({
        node, model, links: linksOf(node), evidence: EVIDENCE, evidenceState: 'ready',
        on: ALL_ON, showClasses: true, href, ...extra,
    });
};

test('a 2-of-4 fleet line states exactly who is needed', () => {
    const html = render(1);
    assert.match(html, /대처·얼릭·푸트·스펜스 중 2명과 함께 출격하면/);
    assert.match(html, /찰스 오스본/);
    assert.match(html, /data-audio="https:\/\/x\/a\.ogg"/);
});

test('quotes are escaped and the alias, not the target name, is marked', () => {
    const html = render(5);
    assert.ok(!html.includes('<b>"정의"</b>'), 'raw HTML must not survive');
    assert.match(html, /&lt;b&gt;&quot;정의&quot;&lt;\/b&gt; <mark>폐하<\/mark>께서/);
    assert.ok(!html.includes('<mark>퀸 엘리자베스</mark>'));
});

test('story titles deep-link and the rest is counted', () => {
    const html = render(5);
    assert.match(html, /href="\/altoy\/story-viewer\/event-story\/\?eventid=123&amp;story=456"/);
    assert.match(html, /홍차와 &lt;스콘&gt;/);
    assert.match(html, /외 1편/);
});

test('a shipgirl with no links says so and lists her sisters', () => {
    const html = render(7);
    assert.match(html, /연결 없음/);
    assert.match(html, /연결 0명/);
    assert.match(html, /같은 함급/);
    assert.match(html, /data-i="8"/);
    assert.match(html, /플레처급 2명/);
});

test('failed evidence keeps the counts and says why quotes are missing', () => {
    const html = render(5, { evidence: null, evidenceState: 'error' });
    assert.match(html, /대사를 불러오지 못했습니다/);
    assert.match(html, /언급 1/);
    assert.match(html, /data-i="6"/);
});

test('loading evidence shows a status line', () => {
    assert.match(render(5, { evidence: null, evidenceState: 'loading' }), /대사 불러오는 중/);
});

test('with every source off the panel shows 연결 0명', () => {
    const node = model.nodes[0];
    const html = panelHtml({
        node, model, links: [], evidence: EVIDENCE, evidenceState: 'ready',
        on: { fleet: false, mention: false, story: false, juus: false }, showClasses: false, href,
    });
    assert.match(html, /연결 0명/);
});

test('storyPath maps the source letter to its viewer', () => {
    assert.equal(storyPath('e', 123, 456), 'story-viewer/event-story/?eventid=123&story=456');
    assert.equal(storyPath('m', 1, 620), 'story-viewer/main-story/?eventid=1&story=620');
    assert.equal(storyPath('w', 7, 8), 'story-viewer/world-story/?eventid=7&story=8');
});

test('panel icons fall back to the shared placeholder', () => {
    const html = render(1);
    const imgs = html.match(/<img [^>]*>/g);
    assert.ok(imgs.length >= 2);
    for (const img of imgs) assert.match(img, /data-fallback="data:image\/svg\+xml/);
});

test('the panel is not one big live region (re-renders on every slider tick)', async () => {
    const { readFileSync } = await import('node:fs');
    const astro = readFileSync(new URL('../../src/pages/shipgirl/shipgirl-relations.astro', import.meta.url), 'utf8');
    const panelTag = astro.match(/<aside[^>]*id="relmap-panel"[^>]*>/)[0];
    assert.ok(!panelTag.includes('aria-live'), panelTag);
});
