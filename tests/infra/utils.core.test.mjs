/**
 * Tests for the pure / node-testable core of public/js/utils.js.
 * utils.js is side-effect-free on import (see CLAUDE.md), so it imports cleanly
 * in node; helpers that read browser globals at CALL time (window.location,
 * localStorage) are exercised against minimal stubs installed per-test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    escapeHtml, sanitizeClassToken, normalizeRomanNumerals, formatTime,
    compareByRarity, RARITY_ORDER, RARITY_TIERS_DESC,
    dataForToyUrl, DATA_FOR_TOY_BASE, getItemIconUrl, sanitizeFilename,
    debounce, throttle, getBasePath, resolveUrl,
    getStorageItem, setStorageItem, SYNCED_KEYS, DATA_VERSION,
} from '../../public/js/utils.js';

// --- escaping ---

test('escapeHtml escapes the full &<>\'" set', () => {
    assert.equal(escapeHtml(`<img src="x" onerror='a(&b)'>`),
        '&lt;img src=&quot;x&quot; onerror=&#39;a(&amp;b)&#39;&gt;');
});

test('escapeHtml stringifies non-strings and maps nullish to empty', () => {
    assert.equal(escapeHtml(5), '5');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
});

test('sanitizeClassToken strips everything outside [A-Za-z0-9_-]', () => {
    assert.equal(sanitizeClassToken('rarity-SSR'), 'rarity-SSR');
    assert.equal(sanitizeClassToken('x"><script>'), 'xscript');
    assert.equal(sanitizeClassToken(null), '');
});

// --- name normalization ---

test('normalizeRomanNumerals converts ASCII numerals to Unicode', () => {
    assert.equal(normalizeRomanNumerals('울베스 II'), '울베스 Ⅱ');
    assert.equal(normalizeRomanNumerals('IV'), 'Ⅳ');
    assert.equal(normalizeRomanNumerals('IX'), 'Ⅸ');
    assert.equal(normalizeRomanNumerals('X'), 'Ⅹ');
});

test('normalizeRomanNumerals replaces longest patterns first (VIII stays one glyph)', () => {
    assert.equal(normalizeRomanNumerals('VIII'), 'Ⅷ');
    assert.equal(normalizeRomanNumerals('VII'), 'Ⅶ');
    assert.equal(normalizeRomanNumerals('III'), 'Ⅲ');
});

test('normalizeRomanNumerals trims and passes falsy through', () => {
    assert.equal(normalizeRomanNumerals('  네바다  '), '네바다');
    assert.equal(normalizeRomanNumerals(''), '');
    assert.equal(normalizeRomanNumerals(null), null);
});

// --- rarity ---

test('compareByRarity sorts rarest first, unknown last', () => {
    assert.deepEqual(['N', 'UR', 'SR', '???'].sort(compareByRarity), ['UR', 'SR', 'N', '???']);
});

test('RARITY_TIERS_DESC is RARITY_ORDER sorted by rank', () => {
    const fromOrder = Object.entries(RARITY_ORDER).sort((a, b) => a[1] - b[1]).map(([k]) => k);
    assert.deepEqual(RARITY_TIERS_DESC, fromOrder);
});

// --- formatting ---

test('formatTime renders deciseconds as h/m/s parts', () => {
    assert.equal(formatTime(0), '0s');
    assert.equal(formatTime(50), '5s');
    assert.equal(formatTime(600), '1m');
    assert.equal(formatTime(36000), '1h');
    assert.equal(formatTime(37950), '1h 3m 15s');
});

test('sanitizeFilename strips reserved chars, collapses whitespace, caps length', () => {
    assert.equal(sanitizeFilename('a/b:c?d'), 'a_b_c_d');
    assert.equal(sanitizeFilename('a   b\n c'), 'a b c');
    assert.equal(sanitizeFilename('x'.repeat(150)).length, 100);
    assert.equal(sanitizeFilename(''), 'image');
    assert.equal(sanitizeFilename(null, 'fallback'), 'fallback');
});

// --- asset URLs ---

test('dataForToyUrl joins onto the CDN base, tolerating leading slashes', () => {
    assert.equal(dataForToyUrl('memoryicon/akashi.webp'), `${DATA_FOR_TOY_BASE}/memoryicon/akashi.webp`);
    assert.equal(dataForToyUrl('//props/1.webp'), `${DATA_FOR_TOY_BASE}/props/1.webp`);
});

test('getItemIconUrl resolves bare ids, Domain/id paths, and falsy refs', () => {
    assert.equal(getItemIconUrl(18002), `${DATA_FOR_TOY_BASE}/props/18002.webp`);
    assert.equal(getItemIconUrl(18002, 'islandprops'), `${DATA_FOR_TOY_BASE}/islandprops/18002.webp`);
    assert.equal(getItemIconUrl('Equips/85120'), `${DATA_FOR_TOY_BASE}/equips/85120.webp`);
    assert.equal(getItemIconUrl(''), '');
    assert.equal(getItemIconUrl(null), '');
});

// --- base path (window.location stubbed) ---

test('getBasePath/resolveUrl handle the /altoy GitHub Pages base', (t) => {
    globalThis.window = { location: { pathname: '/altoy/skin/skin-poll/' } };
    t.after(() => { delete globalThis.window; });
    assert.equal(getBasePath(), '/altoy');
    assert.equal(resolveUrl('data/x.json'), '/altoy/data/x.json');
    assert.equal(resolveUrl('/data/x.json'), '/data/x.json');
    assert.equal(resolveUrl('https://a.test/x'), 'https://a.test/x');
});

test('getBasePath is empty off GitHub Pages', (t) => {
    globalThis.window = { location: { pathname: '/skin/skin-poll/' } };
    t.after(() => { delete globalThis.window; });
    assert.equal(getBasePath(), '');
    assert.equal(resolveUrl('data/x.json'), '/data/x.json');
});

// --- timing helpers (mock timers) ---

test('debounce fires once after the wait, with the last args', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    const d = debounce((v) => calls.push(v), 100);
    d(1); d(2); d(3);
    t.mock.timers.tick(99);
    assert.deepEqual(calls, []);
    t.mock.timers.tick(1);
    assert.deepEqual(calls, [3]);
});

test('throttle runs at most once per delay, with the first call\'s args', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    const th = throttle((v) => calls.push(v), 50);
    th(1); th(2); th(3);
    t.mock.timers.tick(50);
    assert.deepEqual(calls, [1]);
    th(4);
    t.mock.timers.tick(50);
    assert.deepEqual(calls, [1, 4]);
});

// --- storage (localStorage stubbed) ---

function stubLocalStorage(t, { throwOnAccess = false } = {}) {
    const store = new Map();
    globalThis.localStorage = {
        getItem(k) {
            if (throwOnAccess) throw new Error('denied');
            return store.has(k) ? store.get(k) : null;
        },
        setItem(k, v) {
            if (throwOnAccess) throw new Error('denied');
            store.set(k, String(v));
        },
    };
    t.after(() => { delete globalThis.localStorage; });
    return store;
}

test('getStorageItem returns the value, or the default when missing', (t) => {
    const store = stubLocalStorage(t);
    store.set('k', 'v');
    assert.equal(getStorageItem('k', 'd'), 'v');
    assert.equal(getStorageItem('absent', 'd'), 'd');
});

test('storage helpers swallow localStorage access errors (private browsing)', (t) => {
    stubLocalStorage(t, { throwOnAccess: true });
    assert.equal(getStorageItem('k', 'd'), 'd');
    assert.doesNotThrow(() => setStorageItem('k', 'v'));
});

test('setStorageItem flags Drive-sync dirty only for SYNCED_KEYS', (t) => {
    const store = stubLocalStorage(t);
    setStorageItem('someRandomKey', 'v');
    assert.equal(store.has('altoy:sync:localDirty'), false);

    const syncedKey = [...SYNCED_KEYS][0];
    assert.ok(syncedKey, 'SYNCED_KEYS should not be empty');
    setStorageItem(syncedKey, 'v');
    assert.equal(store.get('altoy:sync:localDirty'), '1');
    assert.ok(store.get('altoy:sync:localDirtyAt'));
});

// --- versioning ---

test('DATA_VERSION is semver-shaped', () => {
    assert.match(DATA_VERSION, /^\d+\.\d+\.\d+$/);
});
