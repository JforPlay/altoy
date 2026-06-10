/**
 * Tests for public/js/cache.db.js — the IndexedDB JSON cache with
 * DATA_VERSION-gated invalidation.
 *
 * A minimal in-memory IndexedDB fake covers exactly the API surface CacheDB
 * uses (open / get / put / delete / clear / timestamp-index cursor). Each test
 * imports cache.db.js with a unique query string to get a fresh module instance,
 * because the version-gate check (`_ensureCacheVersion`) runs once per module.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA_VERSION } from '../../public/js/utils.js';

const CACHE_DB_URL = new URL('../../public/js/cache.db.js', import.meta.url).href;
let importCounter = 0;
const freshCacheDb = () => import(`${CACHE_DB_URL}?t=${++importCounter}`);

/**
 * Install a fake indexedDB + IDBKeyRange. Async completion is modeled with
 * setTimeout(0) so request.onsuccess / tx.oncomplete handlers (assigned
 * synchronously after the call, as CacheDB does) are always in place first.
 * @param {{url: string, data: *, timestamp: number}[]} initialRecords
 * @returns {Map<string, object>} the live backing store, for seeding/asserting
 */
function installFakeIDB(t, initialRecords = []) {
    const records = new Map(initialRecords.map((r) => [r.url, r]));

    const db = {
        objectStoreNames: { contains: () => true },
        transaction() {
            const tx = { oncomplete: null, onerror: null };
            let pending = 0;
            const settle = () => { if (--pending === 0) setTimeout(() => tx.oncomplete?.(), 0); };
            const runAsync = (fn) => { pending++; setTimeout(() => { fn(); settle(); }, 0); };

            tx.objectStore = () => ({
                get(key) {
                    const req = { onsuccess: null, onerror: null, result: null };
                    runAsync(() => { req.result = records.get(key) || null; req.onsuccess?.({ target: req }); });
                    return req;
                },
                put(record) { runAsync(() => { records.set(record.url, record); }); },
                delete(key) { runAsync(() => { records.delete(key); }); },
                clear() { runAsync(() => { records.clear(); }); },
                index() {
                    return {
                        openCursor(range) {
                            const req = { onsuccess: null, onerror: null, result: null };
                            pending++;
                            const matches = [...records.values()]
                                .filter((r) => r.timestamp <= range.upper).map((r) => r.url);
                            let i = 0;
                            const step = () => {
                                if (i < matches.length) {
                                    const key = matches[i++];
                                    req.result = { delete: () => records.delete(key), continue: () => setTimeout(step, 0) };
                                    req.onsuccess?.({ target: req });
                                } else {
                                    req.result = null;
                                    req.onsuccess?.({ target: req });
                                    settle();
                                }
                            };
                            setTimeout(step, 0);
                            return req;
                        },
                    };
                },
            });
            return tx;
        },
    };

    globalThis.indexedDB = {
        open() {
            const req = { onupgradeneeded: null, onsuccess: null, onerror: null };
            setTimeout(() => req.onsuccess?.({ target: { result: db } }), 0);
            return req;
        },
    };
    globalThis.IDBKeyRange = { upperBound: (v) => ({ upper: v }) };
    t.after(() => { delete globalThis.indexedDB; delete globalThis.IDBKeyRange; });
    return records;
}

/** Stub global fetch with a call counter. */
function installFakeFetch(t, payload = { fromNetwork: true }) {
    const calls = { count: 0 };
    globalThis.fetch = async () => { calls.count++; return { ok: true, json: async () => payload }; };
    t.after(() => { delete globalThis.fetch; });
    return calls;
}

const settleTimers = () => new Promise((r) => setTimeout(r, 5));
const versionRecord = (v = DATA_VERSION) => ({ url: '__data_version__', data: v, timestamp: Date.now() });

test('first call fetches from network, second is served from cache', async (t) => {
    installFakeIDB(t);
    const calls = installFakeFetch(t);
    const { fetchJSONWithCache } = await freshCacheDb();

    assert.deepEqual(await fetchJSONWithCache('/data/x.json'), { fromNetwork: true });
    await settleTimers(); // let the fire-and-forget put land
    await fetchJSONWithCache('/data/x.json');
    assert.equal(calls.count, 1);
});

test('forceRefresh bypasses a valid cache entry', async (t) => {
    installFakeIDB(t, [versionRecord(), { url: '/data/x.json', data: { cached: true }, timestamp: Date.now() }]);
    const calls = installFakeFetch(t);
    const { fetchJSONWithCache } = await freshCacheDb();

    assert.deepEqual(await fetchJSONWithCache('/data/x.json', { forceRefresh: true }), { fromNetwork: true });
    assert.equal(calls.count, 1);
});

test('expired entries (older than maxAge) are refetched', async (t) => {
    installFakeIDB(t, [versionRecord(), { url: '/data/x.json', data: { cached: true }, timestamp: Date.now() - 10_000 }]);
    const calls = installFakeFetch(t);
    const { fetchJSONWithCache } = await freshCacheDb();

    assert.deepEqual(await fetchJSONWithCache('/data/x.json', { maxAge: 5_000 }), { fromNetwork: true });
    assert.equal(calls.count, 1);
});

test('matching DATA_VERSION preserves the cache (no network)', async (t) => {
    installFakeIDB(t, [versionRecord(), { url: '/data/x.json', data: { cached: true }, timestamp: Date.now() }]);
    const calls = installFakeFetch(t);
    const { fetchJSONWithCache } = await freshCacheDb();

    assert.deepEqual(await fetchJSONWithCache('/data/x.json'), { cached: true });
    assert.equal(calls.count, 0);
});

test('DATA_VERSION change clears every cached entry and stamps the new version', async (t) => {
    const records = installFakeIDB(t, [
        versionRecord('0.0.1-old'),
        { url: '/data/x.json', data: { cached: true }, timestamp: Date.now() },
        { url: '/data/y.json', data: { cached: true }, timestamp: Date.now() },
    ]);
    const calls = installFakeFetch(t);
    const { fetchJSONWithCache } = await freshCacheDb();

    assert.deepEqual(await fetchJSONWithCache('/data/x.json'), { fromNetwork: true });
    assert.equal(calls.count, 1, 'stale-version cache must not be served');
    await settleTimers();
    assert.equal(records.get('__data_version__').data, DATA_VERSION);
    assert.equal(records.has('/data/y.json'), false, 'version bump clears unrelated entries too');
});

test('purgeOldCache removes only entries older than maxAge and reports the count', async (t) => {
    const records = installFakeIDB(t, [
        { url: '/old1.json', data: 1, timestamp: Date.now() - 100_000 },
        { url: '/old2.json', data: 2, timestamp: Date.now() - 100_000 },
        { url: '/fresh.json', data: 3, timestamp: Date.now() },
    ]);
    const { purgeOldCache } = await freshCacheDb();

    assert.equal(await purgeOldCache(50_000), 2);
    assert.deepEqual([...records.keys()], ['/fresh.json']);
});

test('clearJSONCache empties the store', async (t) => {
    const records = installFakeIDB(t, [{ url: '/x.json', data: 1, timestamp: Date.now() }]);
    const { clearJSONCache } = await freshCacheDb();
    await clearJSONCache();
    assert.equal(records.size, 0);
});

test('a broken IndexedDB degrades gracefully: network still works, no throws', async (t) => {
    globalThis.indexedDB = {
        open() {
            const req = { onupgradeneeded: null, onsuccess: null, onerror: null };
            setTimeout(() => req.onerror?.({ target: { error: new Error('idb unavailable') } }), 0);
            return req;
        },
    };
    globalThis.IDBKeyRange = { upperBound: (v) => ({ upper: v }) };
    t.after(() => { delete globalThis.indexedDB; delete globalThis.IDBKeyRange; });
    const calls = installFakeFetch(t);
    const { fetchJSONWithCache, clearJSONCache, purgeOldCache } = await freshCacheDb();

    assert.deepEqual(await fetchJSONWithCache('/data/x.json'), { fromNetwork: true });
    assert.equal(calls.count, 1);
    await assert.doesNotReject(clearJSONCache());
    assert.equal(await purgeOldCache(1_000), 0);
});
