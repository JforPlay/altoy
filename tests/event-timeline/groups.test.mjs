/**
 * groups.test.mjs
 * Pure grouping/date helpers for /event-timeline (public/js/event-timeline.groups.js).
 * Grouping truth is the explicit 원본ID field — never fuzzy (see gid-linking lesson).
 * Fixture mirrors the real 홍염의 방문자 triple (IDs 20/70/82).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEventDate, daysBetween, buildGroups, gapLabel } from '../../public/js/event-timeline.groups.js';

test('parseEventDate: KR dotted format', () => {
    assert.equal(parseEventDate('2018. 5. 15').getTime(), new Date(2018, 4, 15).getTime());
});

test('parseEventDate: JP range uses the start date', () => {
    assert.equal(parseEventDate('2017/09/21 ~ 2017/09/30').getTime(), new Date(2017, 8, 21).getTime());
});

test('parseEventDate: rejects rollover dates', () => {
    assert.equal(parseEventDate('2018. 13. 5'), null);
    assert.equal(parseEventDate('2018. 2. 29'), null);
    assert.equal(parseEventDate('2020. 2. 29').getTime(), new Date(2020, 1, 29).getTime());
});

test('parseEventDate: garbage → null', () => {
    assert.equal(parseEventDate(''), null);
    assert.equal(parseEventDate('-'), null);
    assert.equal(parseEventDate(undefined), null);
    assert.equal(parseEventDate('미정'), null);
});

test('daysBetween: whole days, null-safe', () => {
    assert.equal(daysBetween(new Date(2018, 4, 15), new Date(2019, 5, 27)), 408);
    assert.equal(daysBetween(new Date(2018, 4, 15), new Date(2018, 4, 15, 23, 59)), 0);
    assert.equal(daysBetween(null, new Date()), null);
});

const FIX = [
    { ID: '20', 이벤트명: '홍염의 방문자', 복각여부: '신규', 날짜: '2018. 5. 15' },
    { ID: '50', 이벤트명: '딴 이벤트', 복각여부: '', 날짜: '2019. 1. 1' },
    { ID: '70', 이벤트명: '홍염의 방문자', 복각여부: '복각', 날짜: '2019. 6. 27', 원본ID: '20' },
    { ID: '82', 이벤트명: '홍염의 방문자', 복각여부: '상시편입', 날짜: '2019. 10. 10', 원본ID: '20' },
    { ID: '90', 이벤트명: '고아 복각', 복각여부: '복각', 날짜: '2020. 1. 1', 원본ID: '999' }
];

test('buildGroups: 원본ID rows join the anchor group, date-sorted with gaps', () => {
    const g = buildGroups(FIX).get('20');
    assert.deepEqual(g.runs.map(r => r.event.ID), ['20', '70', '82']);
    assert.deepEqual(g.gaps, [408, 105]);
    assert.equal(g.anchor.ID, '20');
    assert.equal(g.latestStatus, '상시편입');
    assert.equal(g.latestDate.getTime(), new Date(2019, 9, 10).getTime());
});

test('buildGroups: rows without 원본ID are their own group', () => {
    assert.equal(buildGroups(FIX).get('50').runs.length, 1);
});

test('buildGroups: dangling 원본ID fails soft to a standalone group', () => {
    const g = buildGroups(FIX).get('90');
    assert.ok(g, 'row 90 must still render as its own group');
    assert.equal(g.runs.length, 1);
});

test('gapLabel: prefix comes from the previous run status', () => {
    const g = buildGroups(FIX).get('20');
    assert.equal(gapLabel(g, 0), null);
    assert.equal(gapLabel(g, 1), '신규 후 +408일');
    assert.equal(gapLabel(g, 2), '복각 후 +105일');
});
