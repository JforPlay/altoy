import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupAndFilterEvents } from '../../public/js/story-viewer/event-story.filter.js';

const FIX = [
  { id: 107, name: '옥토끼', subtype: 3, year: 2017, faction: '' },
  { id: 119, name: '다른 차원의 방문자', subtype: 2, year: 2019, faction: '' },
  { id: 148, name: '청홍의 메아리', subtype: 1, year: 2023, faction: '사쿠라' },
  { id: 900, name: '연도미상 이벤트', subtype: 3, year: null, faction: '' },
];

test('groups by year descending, null bucket last', () => {
  const g = groupAndFilterEvents(FIX);
  assert.deepEqual(g.map(x => x.label), ['2023', '2019', '2017', '연도 미상']);
});

test('subtype filter keeps only selected subtypes', () => {
  const ids = groupAndFilterEvents(FIX, { subtypes: [3] }).flatMap(x => x.events.map(e => e.id));
  assert.deepEqual(ids.sort((a, b) => a - b), [107, 900]);
});

test('search is case-insensitive substring on name', () => {
  const g = groupAndFilterEvents(FIX, { search: '메아리' });
  assert.equal(g.length, 1);
  assert.equal(g[0].events[0].id, 148);
});

test('faction filter matches any selected faction', () => {
  assert.equal(groupAndFilterEvents(FIX, { factions: ['사쿠라'] }).flatMap(x => x.events).length, 1);
  assert.equal(groupAndFilterEvents(FIX, { factions: ['사쿠라', '없는진영'] }).flatMap(x => x.events).length, 1);
});

test('events within a year sorted by start date descending', () => {
  const g = groupAndFilterEvents([
    { id: 2, name: 'a', subtype: 3, year: 2020, dateRange: '2020/03/05' },
    { id: 5, name: 'b', subtype: 3, year: 2020, dateRange: '2020/11/19' },
    { id: 9, name: 'c', subtype: 3, year: 2020, dateRange: '2020/07/01' },
  ]);
  assert.deepEqual(g[0].events.map(e => e.id), [5, 9, 2]);
});

test('date sort parses range start and dotted curator format', () => {
  const g = groupAndFilterEvents([
    { id: 1, name: 'range', subtype: 3, year: 2019, dateRange: '2019/02/14 ~ 2019/02/28' },
    { id: 2, name: 'dotted', subtype: 3, year: 2019, dateRange: '2019. 9. 5' },
    { id: 3, name: 'plain', subtype: 3, year: 2019, dateRange: '2019/05/30' },
  ]);
  assert.deepEqual(g[0].events.map(e => e.id), [2, 3, 1]);
});

test('undated events go last within their year, ties break by id ascending', () => {
  const g = groupAndFilterEvents([
    { id: 8, name: 'undated', subtype: 3, year: 2023 },
    { id: 4, name: 'same-day-b', subtype: 3, year: 2023, dateRange: '2023/01/18' },
    { id: 3, name: 'same-day-a', subtype: 3, year: 2023, dateRange: '2023/01/18' },
    { id: 6, name: 'newer', subtype: 3, year: 2023, dateRange: '2023/06/08' },
  ]);
  assert.deepEqual(g[0].events.map(e => e.id), [6, 3, 4, 8]);
});

test('empty subtypes/factions/search returns everything', () => {
  assert.equal(groupAndFilterEvents(FIX, {}).flatMap(x => x.events).length, 4);
});
