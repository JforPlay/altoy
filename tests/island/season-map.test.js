import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    krWindowToMs,
    isWithinAnyWindow,
    findCurrentSeasonId,
    lookupItemSeasonRange,
    SEASON_ID_RANGES,
    initSeasonMap,
    getItemSeason,
    renderSeasonBadge,
    _resetForTests,
} from '../../public/js/island/island.season-map.js';

// Minimal fixture mirroring real island_season.json shape
const SEASONS = {
    '1': {
        id: 1,
        name_short: '시즌Ⅰ',
        time: [[[2025, 11, 20], [0, 0, 0]], [[2026, 2, 26], [12, 0, 0]]],
    },
    '2': {
        id: 2,
        name_short: '시즌Ⅱ',
        time: [[[2026, 2, 26], [0, 0, 0]], [[2026, 5, 21], [12, 0, 0]]],
    },
    '3': {
        id: 3,
        name_short: '시즌Ⅲ',
        time: [[[2026, 5, 21], [0, 0, 0]], [[2026, 8, 20], [12, 0, 0]]],
    },
};

test('krWindowToMs converts KST midnight to correct UTC ms', () => {
    // 2026-05-21 00:00:00 KST == 2026-05-20 15:00:00 UTC
    const ms = krWindowToMs([[2026, 5, 21], [0, 0, 0]]);
    assert.equal(ms, Date.UTC(2026, 4, 20, 15, 0, 0));
});

test('isWithinAnyWindow handles single-window seasons', () => {
    const window = SEASONS['3'].time;
    const inside = Date.UTC(2026, 6, 1, 0, 0, 0); // 2026-07-01 UTC, mid-S3
    const before = Date.UTC(2026, 4, 1, 0, 0, 0); // 2026-05-01 UTC, before S3
    const after = Date.UTC(2026, 8, 1, 0, 0, 0);  // 2026-09-01 UTC, after S3
    assert.equal(isWithinAnyWindow(window, inside), true);
    assert.equal(isWithinAnyWindow(window, before), false);
    assert.equal(isWithinAnyWindow(window, after), false);
});

test('findCurrentSeasonId picks the active season by time window', () => {
    const duringS3 = krWindowToMs([[2026, 5, 22], [0, 0, 0]]);
    assert.equal(findCurrentSeasonId(SEASONS, duringS3), 3);
});

test('findCurrentSeasonId returns null between seasons', () => {
    // After S3 ends, before any hypothetical S4
    const afterS3 = krWindowToMs([[2026, 9, 1], [0, 0, 0]]);
    assert.equal(findCurrentSeasonId(SEASONS, afterS3), null);
});

test('lookupItemSeasonRange resolves known IDs', () => {
    assert.equal(lookupItemSeasonRange(4031).season, 3); // 수박
    assert.equal(lookupItemSeasonRange(4019).season, 2); // 아스파라거스
    assert.equal(lookupItemSeasonRange(4005).season, null); // unclassified pre-system
});

test('lookupItemSeasonRange returns null for non-seasonal IDs', () => {
    assert.equal(lookupItemSeasonRange(1000), null); // 밀
    assert.equal(lookupItemSeasonRange(3011), null); // restaurant menu staple
    assert.equal(lookupItemSeasonRange(5001), null); // 조개 (out of 40xx range)
});

test('SEASON_ID_RANGES table is contiguous within 4001-4099', () => {
    // The table should leave no gaps in 4001-4099; orphans would silently drop badges
    let prevMax = 4000;
    for (const range of SEASON_ID_RANGES) {
        assert.equal(range.min, prevMax + 1, `gap before range starting ${range.min}`);
        prevMax = range.max;
    }
    assert.equal(prevMax, 4099, 'table should cover up to 4099 (S3 loose upper bound)');
});

test('getItemSeason returns current-flag based on now', () => {
    _resetForTests();
    const duringS3 = krWindowToMs([[2026, 6, 1], [0, 0, 0]]);
    initSeasonMap(SEASONS, { items: {}, nowMs: duringS3 });

    const watermelon = getItemSeason(4031);
    assert.equal(watermelon.seasonId, 3);
    assert.equal(watermelon.label, '시즌Ⅲ');
    assert.equal(watermelon.isCurrent, true);

    const asparagus = getItemSeason(4019);
    assert.equal(asparagus.seasonId, 2);
    assert.equal(asparagus.label, '시즌Ⅱ');
    assert.equal(asparagus.isCurrent, false);

    const oldItem = getItemSeason(4005);
    assert.equal(oldItem.seasonId, null);
    assert.equal(oldItem.label, '이전 시즌');
    assert.equal(oldItem.isCurrent, false);
});

test('getItemSeason returns null for non-seasonal items', () => {
    _resetForTests();
    initSeasonMap(SEASONS, { items: {}, nowMs: krWindowToMs([[2026, 6, 1], [0, 0, 0]]) });
    assert.equal(getItemSeason(1000), null);
    assert.equal(getItemSeason(5001), null);
});

test('renderSeasonBadge emits current pill for active-season item', () => {
    _resetForTests();
    initSeasonMap(SEASONS, { items: {}, nowMs: krWindowToMs([[2026, 6, 1], [0, 0, 0]]) });
    const html = renderSeasonBadge(4031);
    assert.match(html, /season-badge--current/);
    assert.match(html, /시즌Ⅲ · 진행중/);
});

test('renderSeasonBadge emits past pill for ended-season item', () => {
    _resetForTests();
    initSeasonMap(SEASONS, { items: {}, nowMs: krWindowToMs([[2026, 6, 1], [0, 0, 0]]) });
    const html = renderSeasonBadge(4019);
    assert.match(html, /season-badge--past/);
    assert.match(html, /시즌Ⅱ · 종료/);
});

test('renderSeasonBadge emits unclassified pill for 4001-4018 item', () => {
    _resetForTests();
    initSeasonMap(SEASONS, { items: {}, nowMs: krWindowToMs([[2026, 6, 1], [0, 0, 0]]) });
    const html = renderSeasonBadge(4005);
    assert.match(html, /season-badge--past/);
    assert.match(html, /이전 시즌 · 종료/);
});

test('renderSeasonBadge returns empty string for non-seasonal item', () => {
    _resetForTests();
    initSeasonMap(SEASONS, { items: {}, nowMs: krWindowToMs([[2026, 6, 1], [0, 0, 0]]) });
    assert.equal(renderSeasonBadge(1000), '');
});

test('renderSeasonBadge returns empty before initSeasonMap is called', () => {
    _resetForTests();
    assert.equal(renderSeasonBadge(4031), '');
});

test('initSeasonMap warns once on orphan 4xxx ids missing from ranges table', () => {
    _resetForTests();
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => { warnings.push(args); };
    try {
        const items = { '4150': { id: 4150, name: '미래 아이템' } };
        initSeasonMap(SEASONS, { items, nowMs: krWindowToMs([[2026, 6, 1], [0, 0, 0]]) });
    } finally {
        console.warn = origWarn;
    }
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0]), /4150/);
});
