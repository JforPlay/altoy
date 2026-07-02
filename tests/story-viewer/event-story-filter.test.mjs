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

test('events within a year sorted by id ascending', () => {
  const g = groupAndFilterEvents([
    { id: 5, name: 'b', subtype: 3, year: 2020 },
    { id: 2, name: 'a', subtype: 3, year: 2020 },
  ]);
  assert.deepEqual(g[0].events.map(e => e.id), [2, 5]);
});

test('empty subtypes/factions/search returns everything', () => {
  assert.equal(groupAndFilterEvents(FIX, {}).flatMap(x => x.events).length, 4);
});
