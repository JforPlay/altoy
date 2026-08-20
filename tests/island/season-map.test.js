import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    krWindowToMs,
    isWithinAnyWindow,
    findCurrentSeasonId,
    lookupItemTheme,
    seasonsForTheme,
    THEME_ID_RANGES,
    SEASON_THEMES,
    getSeasonThematicName,
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
    '4': {
        id: 4,
        name_short: '시즌Ⅳ',
        time: [[[2026, 8, 20], [0, 0, 0]], [[2026, 11, 19], [12, 0, 0]]],
    },
};

const DURING_S3 = krWindowToMs([[2026, 6, 1], [0, 0, 0]]);
const DURING_S4 = krWindowToMs([[2026, 9, 1], [0, 0, 0]]);

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
    // After S4 ends, before any hypothetical S5
    const afterS4 = krWindowToMs([[2026, 12, 1], [0, 0, 0]]);
    assert.equal(findCurrentSeasonId(SEASONS, afterS4), null);
});

test('lookupItemTheme resolves known IDs', () => {
    assert.equal(lookupItemTheme(4001), 'fall');   // 가을 국화
    assert.equal(lookupItemTheme(4005), 'fall');   // 아키즈키 배
    assert.equal(lookupItemTheme(4015), 'spring'); // 봄 죽순
    assert.equal(lookupItemTheme(4019), 'spring'); // 아스파라거스
    assert.equal(lookupItemTheme(4031), 'summer'); // 수박
    assert.equal(lookupItemTheme(4042), 'summer'); // 여름 꽃다발
});

test('lookupItemTheme returns null for non-seasonal IDs', () => {
    assert.equal(lookupItemTheme(1000), null); // 밀
    assert.equal(lookupItemTheme(3011), null); // restaurant menu staple
    assert.equal(lookupItemTheme(5001), null); // 조개 (out of 40xx range)
});

test('THEME_ID_RANGES blocks are contiguous and tightly bounded', () => {
    // Gaps would silently drop badges; a loose tail would mislabel the items a
    // future 겨울 season ships instead of tripping the orphan warn.
    let prevMax = 4000;
    for (const range of THEME_ID_RANGES) {
        assert.equal(range.min, prevMax + 1, `gap before block starting ${range.min}`);
        prevMax = range.max;
    }
    assert.equal(prevMax, 4042, 'last known seasonal item is 4042 (여름 꽃다발)');
});

test('every season has a theme, and every theme has an item block', () => {
    const blocks = new Set(THEME_ID_RANGES.map((r) => r.theme));
    for (const [seasonId, theme] of Object.entries(SEASON_THEMES)) {
        assert.ok(blocks.has(theme), `season ${seasonId} theme "${theme}" has no item block`);
    }
});

test('seasonsForTheme returns every run of a repeated theme', () => {
    // The whole point of the theme model: S4 re-ran S1's 가을 items.
    assert.deepEqual(seasonsForTheme('fall'), [1, 4]);
    assert.deepEqual(seasonsForTheme('spring'), [2]);
    assert.deepEqual(seasonsForTheme('winter'), []);
});

test('getItemSeason returns current-flag based on now', () => {
    _resetForTests();
    initSeasonMap(SEASONS, { items: {}, nowMs: DURING_S3 });

    const watermelon = getItemSeason(4031);
    assert.equal(watermelon.seasonId, 3);
    assert.equal(watermelon.label, '시즌Ⅲ');
    assert.equal(watermelon.isCurrent, true);

    const asparagus = getItemSeason(4019);
    assert.equal(asparagus.seasonId, 2);
    assert.equal(asparagus.label, '시즌Ⅱ');
    assert.equal(asparagus.isCurrent, false);

    // 가을 item during S3: past, and labelled by its most recent run (S1)
    const pear = getItemSeason(4005);
    assert.equal(pear.seasonId, 1);
    assert.equal(pear.label, '시즌Ⅰ');
    assert.equal(pear.isCurrent, false);
});

test('a repeated theme marks its items current again in the later season', () => {
    _resetForTests();
    initSeasonMap(SEASONS, { items: {}, nowMs: DURING_S4 });

    // S4 re-runs S1's 가을 block — these are obtainable right now, so the
    // badge must speak for S4, not the S1 run that first shipped them.
    for (const id of [4001, 4005, 4014]) {
        const item = getItemSeason(id);
        assert.equal(item.theme, 'fall');
        assert.deepEqual(item.seasons, [1, 4]);
        assert.equal(item.seasonId, 4, `item ${id} should report S4`);
        assert.equal(item.label, '시즌Ⅳ');
        assert.equal(item.isCurrent, true);
    }

    // Summer items are done, and report S3 — their only run.
    const watermelon = getItemSeason(4031);
    assert.equal(watermelon.seasonId, 3);
    assert.equal(watermelon.isCurrent, false);
});

test('getSeasonThematicName resolves through the season theme', () => {
    assert.equal(getSeasonThematicName(1), '가을 특산품 경영');
    assert.equal(getSeasonThematicName(2), '봄 특산품 경영');
    assert.equal(getSeasonThematicName(3), '여름 특산품 경영');
    assert.equal(getSeasonThematicName(4), '가을 특산품 경영');
    assert.equal(getSeasonThematicName(99), null);
});

test('getItemSeason returns null for non-seasonal items', () => {
    _resetForTests();
    initSeasonMap(SEASONS, { items: {}, nowMs: DURING_S3 });
    assert.equal(getItemSeason(1000), null);
    assert.equal(getItemSeason(5001), null);
});

test('renderSeasonBadge emits current pill for active-season item', () => {
    _resetForTests();
    initSeasonMap(SEASONS, { items: {}, nowMs: DURING_S3 });
    const html = renderSeasonBadge(4031);
    assert.match(html, /season-badge--current/);
    assert.match(html, /시즌Ⅲ · 진행중/);
});

test('renderSeasonBadge emits past pill for ended-season item', () => {
    _resetForTests();
    initSeasonMap(SEASONS, { items: {}, nowMs: DURING_S3 });
    const html = renderSeasonBadge(4019);
    assert.match(html, /season-badge--past/);
    assert.match(html, /시즌Ⅱ · 종료/);
});

test('renderSeasonBadge emits current pill for a re-run themed item', () => {
    _resetForTests();
    initSeasonMap(SEASONS, { items: {}, nowMs: DURING_S4 });
    const html = renderSeasonBadge(4005);
    assert.match(html, /season-badge--current/);
    assert.match(html, /시즌Ⅳ · 진행중/);
});

test('renderSeasonBadge returns empty string for non-seasonal item', () => {
    _resetForTests();
    initSeasonMap(SEASONS, { items: {}, nowMs: DURING_S3 });
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
        initSeasonMap(SEASONS, { items, nowMs: DURING_S3 });
    } finally {
        console.warn = origWarn;
    }
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0]), /4150/);
});
