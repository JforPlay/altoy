import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    timerShips,
    filterTimerShips,
    matchesTimerQuery,
    groupByTimer,
    timerBucket,
    bucketCounts,
    poolBreakdown,
    summarize,
} from '../../public/js/shipgirl/shipgirl-info.timer.js';

const ship = (gid, name, timer, pools = {}) => ({
    gid, name, rarity: 'SR', nationality: 1, type: 1, timer,
    light: false, heavy: false, special: false, limited: false, ...pools,
});

const A = ship(1, 'A', '04:10:00', { heavy: true });
const B = ship(2, 'B', '04:10:00', { limited: true });          // META-style entry, kept
const C = ship(3, 'C', '04:11:40', { limited: true });
const D = ship(4, 'D', '04:15:00', { heavy: true, special: true });
const E = ship(5, 'E', '04:16:30', { limited: true });
const F = ship(6, 'F', '04:05:00', { heavy: true });
const G = ship(7, 'G', '00:28:00', { light: true });
const H = ship(8, 'H', '00:28:00');                              // no pool → skipped
const I = ship(9, 'I', null, { light: true });                  // no timer → skipped
const J = ship(10, 'J', '06:30:00', { heavy: true });
const ALL = [A, B, C, D, E, F, G, H, I, J];

test('timerShips keeps timed ships with at least one pool flag', () => {
    assert.deepEqual(timerShips(ALL).map(s => s.name), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'J']);
});

test('matchesTimerQuery is a digit-prefix match that ignores non-digits', () => {
    assert.equal(matchesTimerQuery('04:10:00', '0410'), true);
    assert.equal(matchesTimerQuery('04:11:40', '0410'), false);
    assert.equal(matchesTimerQuery('04:10:00', '04:10'), true);
    assert.equal(matchesTimerQuery('04:10:00', 'abc'), true);
    assert.equal(matchesTimerQuery('04:10:00', ''), true);
    assert.deepEqual(['04:05:00', '04:10:00', '04:11:40', '04:15:00', '04:16:30']
        .filter(t => matchesTimerQuery(t, '041')), ['04:10:00', '04:11:40', '04:15:00', '04:16:30']);
});

test('filterTimerShips filters by pool; a multi-pool ship matches each of its pools', () => {
    const inc = timerShips(ALL);
    assert.deepEqual(filterTimerShips(inc, { pool: 'heavy' }).map(s => s.name), ['A', 'D', 'F', 'J']);
    assert.deepEqual(filterTimerShips(inc, { pool: 'special' }).map(s => s.name), ['D']);
    assert.equal(filterTimerShips(inc, {}).length, inc.length);
    assert.deepEqual(filterTimerShips(inc, { rarity: 'UR' }), []);
    assert.equal(filterTimerShips(inc, { nationality: '1', type: '1' }).length, inc.length);
});

test('groupByTimer sorts timers ascending and keeps input order inside a group', () => {
    const groups = groupByTimer(timerShips(ALL));
    assert.deepEqual(groups.map(g => g.timer),
        ['00:28:00', '04:05:00', '04:10:00', '04:11:40', '04:15:00', '04:16:30', '06:30:00']);
    assert.deepEqual(groups[2].ships.map(s => s.name), ['A', 'B']);
});

test('timerBucket and bucketCounts use 30-minute buckets', () => {
    assert.equal(timerBucket('00:29:59'), 0);
    assert.equal(timerBucket('04:10:00'), 8);
    assert.equal(timerBucket('06:30:00'), 13);
    const inc = timerShips(ALL);
    const buckets = bucketCounts(inc, 14);                       // G→0; F,A,B,C,D,E→8; J→13
    assert.equal(buckets.length, 14);
    assert.deepEqual([buckets[0], buckets[8], buckets[13]], [1, 6, 1]);
    assert.equal(buckets.reduce((a, b) => a + b, 0), inc.length);
});

test('poolBreakdown lists non-zero pools in POOLS order, counting multi-pool ships in each', () => {
    const inc = timerShips(ALL);
    assert.deepEqual(poolBreakdown(inc.filter(s => s.timer.startsWith('04'))),
        [{ key: 'heavy', label: '중형', count: 3 }, { key: 'special', label: '특형', count: 1 },
         { key: 'limited', label: '한정', count: 3 }]);
});

test('summarize counts ships and timers; the earliest timer wins a tie for top', () => {
    const inc = timerShips(ALL);
    assert.deepEqual(summarize(groupByTimer(inc)), { count: 8, timers: 7, top: { timer: '04:10:00', count: 2 } });
    const K = { ...G, gid: 99, name: 'K' };                      // 00:28:00 now ties 04:10:00 at 2
    assert.equal(summarize(groupByTimer([...inc, K])).top.timer, '00:28:00');
    assert.deepEqual(summarize([]), { count: 0, timers: 0, top: null });
});
