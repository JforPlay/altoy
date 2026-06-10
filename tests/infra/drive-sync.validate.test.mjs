/**
 * Tests for public/js/sync/drive-sync.validate.js — per-key shape validation
 * applied to Drive downloads and file imports before values reach localStorage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSyncedValue, VALUE_KINDS, MAX_VALUE_BYTES } from '../../public/js/sync/drive-sync.validate.js';
import { SYNCED_KEYS } from '../../public/js/utils.js';

// --- drift guard ---

test('every SYNCED_KEYS key has a VALUE_KINDS entry, and vice versa', () => {
    const kindKeys = new Set(Object.keys(VALUE_KINDS));
    const missing = [...SYNCED_KEYS].filter(k => !kindKeys.has(k));
    const stale = [...kindKeys].filter(k => !SYNCED_KEYS.has(k));
    assert.deepEqual(missing, [], 'synced keys without a validator entry (add to VALUE_KINDS)');
    assert.deepEqual(stale, [], 'validator entries for keys no longer synced (remove from VALUE_KINDS)');
});

// --- realistic values per kind pass ---

test('real-shaped values pass validation', () => {
    // object: tracker bitmask map / syncedStorage {v, d} envelope
    assert.ok(validateSyncedValue('shipgirlTrackerProgress', '{"101031":3,"107061":1}'));
    assert.ok(validateSyncedValue('bgm-misc-player', '{"v":1,"d":{"queue":["a"],"repeat":false}}'));
    // array
    assert.ok(validateSyncedValue('researchTrackerPinned', '["gid1","gid2"]'));
    // object-or-array: both legacy array and future envelope forms
    assert.ok(validateSyncedValue('skinCollection', '["skin1"]'));
    assert.ok(validateSyncedValue('skinCollection', '{"items":["skin1"]}'));
    // plain string (stored raw, not JSON)
    assert.ok(validateSyncedValue('shipgirlTrackerSelectedGoal', '시리우스'));
    assert.ok(validateSyncedValue('island-restaurant-rank', 'S'));
    // numeric string
    assert.ok(validateSyncedValue('island-season-owned-points', '12500'));
    // json (consumer-owned inner shape)
    assert.ok(validateSyncedValue('island-restaurant-shipgirl1', '"공격"'));
});

// --- wrong root shapes are rejected ---

test('wrong root shape or broken JSON is rejected', () => {
    assert.equal(validateSyncedValue('shipgirlTrackerProgress', '["not","a","map"]'), false);
    assert.equal(validateSyncedValue('shipgirlTrackerProgress', 'not json'), false);
    assert.equal(validateSyncedValue('shipgirlTrackerProgress', 'null'), false);
    assert.equal(validateSyncedValue('researchTrackerPinned', '{"not":"array"}'), false);
    assert.equal(validateSyncedValue('skinCollection', '"just a string"'), false);
    assert.equal(validateSyncedValue('island-season-owned-points', 'abc'), false);
    assert.equal(validateSyncedValue('island-season-owned-points', ''), false);
    assert.equal(validateSyncedValue('island-restaurant-shipgirl1', '{broken'), false);
});

// --- global guards ---

test('non-strings and oversized values are rejected for any key', () => {
    assert.equal(validateSyncedValue('shipgirlTrackerProgress', { a: 1 }), false);
    assert.equal(validateSyncedValue('shipgirlTrackerProgress', null), false);
    assert.equal(validateSyncedValue('island-restaurant-rank', 'x'.repeat(MAX_VALUE_BYTES + 1)), false);
});

test('a synced key with no validator entry is accepted (size-capped only)', () => {
    assert.ok(validateSyncedValue('some-future-synced-key', 'anything'));
    assert.equal(validateSyncedValue('some-future-synced-key', 'x'.repeat(MAX_VALUE_BYTES + 1)), false);
});
