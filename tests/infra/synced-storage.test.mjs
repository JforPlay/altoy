/**
 * Tests for public/js/synced-storage.js — the cross-tab localStorage primitive.
 * Transport (localStorage I/O, storage events) is stubbed; the contract under
 * test is the {v, d} envelope, migrate hook, debounce, and remote-change wiring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncedStorage } from '../../public/js/synced-storage.js';

/** Install localStorage + window stubs; returns the backing map and the captured storage handler. */
function stubBrowser(t) {
    const store = new Map();
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
    };
    const captured = { handler: null, removed: false };
    globalThis.window = {
        addEventListener: (type, fn) => { if (type === 'storage') captured.handler = fn; },
        removeEventListener: (type, fn) => { if (type === 'storage' && fn === captured.handler) captured.removed = true; },
    };
    t.after(() => { delete globalThis.localStorage; delete globalThis.window; });
    return { store, captured };
}

const passthroughParse = (v) => (v && typeof v === 'object' ? v : { empty: true });

test('throws without a key or parse function', (t) => {
    stubBrowser(t);
    assert.throws(() => syncedStorage('', { parse: passthroughParse }));
    assert.throws(() => syncedStorage('k', {}));
});

test('un-versioned round-trip: save writes JSON, load parses it back', (t) => {
    const { store } = stubBrowser(t);
    const s = syncedStorage('k', { parse: passthroughParse });
    s.save({ a: 1 });
    assert.equal(store.get('k'), '{"a":1}');
    assert.deepEqual(s.load(), { a: 1 });
});

test('load maps empty/malformed storage to parse(null)', (t) => {
    const { store } = stubBrowser(t);
    const s = syncedStorage('k', { parse: passthroughParse });
    assert.deepEqual(s.load(), { empty: true });
    store.set('k', 'not-json{');
    assert.deepEqual(s.load(), { empty: true });
});

test('version option wraps writes in a {v, d} envelope and unwraps on load', (t) => {
    const { store } = stubBrowser(t);
    const s = syncedStorage('k', { parse: passthroughParse, version: 1 });
    s.save({ a: 1 });
    assert.deepEqual(JSON.parse(store.get('k')), { v: 1, d: { a: 1 } });
    assert.deepEqual(s.load(), { a: 1 });
});

test('migrate runs on version mismatch with (oldVersion, oldData)', (t) => {
    const { store } = stubBrowser(t);
    const migrations = [];
    const s = syncedStorage('k', {
        parse: passthroughParse,
        version: 2,
        migrate: (oldV, oldData) => { migrations.push([oldV, oldData]); return { migrated: true }; },
    });
    store.set('k', JSON.stringify({ v: 1, d: { a: 1 } }));
    assert.deepEqual(s.load(), { migrated: true });
    assert.deepEqual(migrations, [[1, { a: 1 }]]);
});

test('migrate sees legacy un-versioned payloads as version 0', (t) => {
    const { store } = stubBrowser(t);
    const migrations = [];
    const s = syncedStorage('k', {
        parse: passthroughParse,
        version: 1,
        migrate: (oldV, oldData) => { migrations.push([oldV, oldData]); return { migrated: true }; },
    });
    store.set('k', JSON.stringify({ legacy: true }));
    assert.deepEqual(s.load(), { migrated: true });
    assert.deepEqual(migrations, [[0, { legacy: true }]]);
});

test('version mismatch without migrate falls back to the stored data', (t) => {
    const { store } = stubBrowser(t);
    const s = syncedStorage('k', { parse: passthroughParse, version: 2 });
    store.set('k', JSON.stringify({ v: 1, d: { a: 1 } }));
    assert.deepEqual(s.load(), { a: 1 });
});

test('debounce coalesces rapid saves into the last write', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { store } = stubBrowser(t);
    const s = syncedStorage('k', { parse: passthroughParse, debounce: 200 });
    s.save({ n: 1 });
    s.save({ n: 2 });
    assert.equal(store.has('k'), false);
    t.mock.timers.tick(200);
    assert.equal(store.get('k'), '{"n":2}');
});

test('onRemoteChange fires for this key only, with the parsed remote state', (t) => {
    const { captured } = stubBrowser(t);
    const remote = [];
    syncedStorage('k', { parse: passthroughParse, version: 1, onRemoteChange: (next) => remote.push(next) });
    assert.ok(captured.handler, 'storage handler should be subscribed');

    captured.handler({ key: 'other-key', newValue: '{"x":1}' });
    assert.deepEqual(remote, []);

    captured.handler({ key: 'k', newValue: JSON.stringify({ v: 1, d: { a: 2 } }) });
    assert.deepEqual(remote, [{ a: 2 }]);
});

test('close() unsubscribes the storage listener', (t) => {
    const { captured } = stubBrowser(t);
    const s = syncedStorage('k', { parse: passthroughParse });
    s.close();
    assert.equal(captured.removed, true);
});
