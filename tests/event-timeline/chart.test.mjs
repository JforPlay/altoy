/**
 * chart.test.mjs
 * Pure chart-model helpers for the 무딱 차트 view (public/js/event-timeline.chart.js).
 * Fixture runs through the real buildGroups() so the model contract can't drift
 * from the grouping module.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroups } from '../../public/js/event-timeline.groups.js';
import { monthIndex, isMudak, buildMudakChart, toRelativeRows } from '../../public/js/event-timeline.chart.js';

const FIX = [
    { ID: '1', 이벤트명: '무딱 트리플', 복각여부: '신규', '무딱 이벤?': 'O', 날짜: '2020. 9. 24' },
    { ID: '2', 이벤트명: '무딱 트리플', 복각여부: '복각', '무딱 이벤?': 'O', 날짜: '2022. 7. 21', 원본ID: '1' },
    { ID: '3', 이벤트명: '무딱 트리플', 복각여부: '상시편입', '무딱 이벤?': 'O', 날짜: '2024. 2. 1', 원본ID: '1' },
    { ID: '4', 이벤트명: '딱지 이벤트', 복각여부: '신규', '무딱 이벤?': 'X', 날짜: '2021. 1. 1' },
    { ID: '5', 이벤트명: '복각 대기 중', 복각여부: '신규', '무딱 이벤?': 'O', 날짜: '2024. 6. 6' },
    { ID: '6', 이벤트명: '상시 대기 중', 복각여부: '신규', '무딱 이벤?': 'X', 날짜: '2023. 9. 28' },
    { ID: '7', 이벤트명: '상시 대기 중', 복각여부: '복각', '무딱 이벤?': 'O', 날짜: '2025. 12. 10', 원본ID: '6' },
    { ID: '8', 이벤트명: '일회성 콜라보', 복각여부: '', '무딱 이벤?': 'O', 날짜: '2021. 7. 15' },
    { ID: '9', 이벤트명: '날짜 없음', 복각여부: '신규', '무딱 이벤?': 'O', 날짜: '미정' }
];
const NOW = new Date(2026, 6, 15); // 2026-07 → end mi 24318

function chart() {
    return buildMudakChart(buildGroups(FIX).values(), { now: NOW });
}

test('monthIndex / isMudak basics', () => {
    assert.equal(monthIndex(new Date(2020, 8, 24)), 24248);
    assert.equal(isMudak({ '무딱 이벤?': 'O' }), true);
    assert.equal(isMudak({ '무딱 이벤?': 'X' }), false);
    assert.equal(isMudak(undefined), false);
});

test('selection: any-run O includes the group; non-O and dateless-only drop', () => {
    const keys = chart().rows.map(r => r.key);
    assert.ok(!keys.includes('4'), 'pure X group excluded');
    assert.ok(!keys.includes('9'), 'group with no dated run excluded');
    assert.ok(keys.includes('6'), 'X anchor + O rerun → included (any-run rule)');
});

test('rows sorted by first run month asc; start snaps to January', () => {
    const c = chart();
    assert.deepEqual(c.rows.map(r => r.key), ['1', '8', '6', '5']);
    assert.equal(c.start, 2020 * 12); // Jan 2020
    assert.equal(c.end, 24318);
});

test('spans: month gaps + phase from the PREVIOUS run status', () => {
    const row = chart().rows.find(r => r.key === '1');
    assert.deepEqual(row.runs.map(r => r.mi), [24248, 24270, 24289]);
    assert.deepEqual(row.spans, [
        { from: 24248, to: 24270, months: 22, phase: 'new' },
        { from: 24270, to: 24289, months: 19, phase: 'rerun' }
    ]);
    assert.equal(row.startYear, 2020);
});

test('tails: permanent / wait-rerun / wait-permanent / none for one-offs', () => {
    const rows = chart().rows;
    assert.deepEqual(rows.find(r => r.key === '1').tail, { kind: 'permanent', from: 24289, months: 29 });
    assert.deepEqual(rows.find(r => r.key === '5').tail, { kind: 'wait-rerun', from: 24293, months: 25 });
    assert.deepEqual(rows.find(r => r.key === '6').tail, { kind: 'wait-permanent', from: 24311, months: 7 });
    assert.equal(rows.find(r => r.key === '8').tail, null);
});

test('tail months clamp at 0 for a future-dated run', () => {
    const g = buildGroups([{ ID: '1', 복각여부: '신규', '무딱 이벤?': 'O', 날짜: '2027. 1. 1' }]);
    const c = buildMudakChart(g.values(), { now: NOW });
    assert.equal(c.rows[0].tail.months, 0);
});

test('relative: multi-run only, rebased to 0, first-run date order kept, tails dropped', () => {
    const rel = toRelativeRows(chart().rows);
    assert.deepEqual(rel.rows.map(r => r.key), ['1', '6']); // 신규 2020 before 2023
    const r1 = rel.rows[0];
    assert.deepEqual(r1.runs.map(r => r.mi), [0, 22, 41]);
    assert.deepEqual(r1.spans.map(s => [s.from, s.to]), [[0, 22], [22, 41]]);
    assert.equal(r1.tail, null);
    assert.equal(rel.maxMi, 41);
});

test('relative keeps chronological order even when gap order disagrees', () => {
    const g = buildGroups([
        { ID: '1', 이벤트명: '먼저 큰 갭', 복각여부: '신규', '무딱 이벤?': 'O', 날짜: '2020. 1. 1' },
        { ID: '2', 이벤트명: '먼저 큰 갭', 복각여부: '복각', '무딱 이벤?': 'O', 날짜: '2023. 1. 1', 원본ID: '1' },
        { ID: '3', 이벤트명: '나중 작은 갭', 복각여부: '신규', '무딱 이벤?': 'O', 날짜: '2021. 1. 1' },
        { ID: '4', 이벤트명: '나중 작은 갭', 복각여부: '복각', '무딱 이벤?': 'O', 날짜: '2021. 6. 1', 원본ID: '3' }
    ]);
    const rel = toRelativeRows(buildMudakChart(g.values(), { now: NOW }).rows);
    assert.deepEqual(rel.rows.map(r => r.key), ['1', '3']); // date order, NOT gap order (36 vs 5)
});

test('empty input → no rows, start === end', () => {
    const c = buildMudakChart([], { now: NOW });
    assert.deepEqual(c.rows, []);
    assert.equal(c.start, c.end);
});
