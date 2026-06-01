/**
 * Tests for scripts/check-data-shape.mjs — the build-time data-shape guard.
 * Pure-logic cases exercise validateOne(); the integration case asserts the live
 * MANIFEST still matches the real public/data (skipped if data isn't present).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { validateOne, validateShape, MANIFEST, DATA_DIR } from '../../scripts/check-data-shape.mjs';

test('array: passes when sample record has all required keys', () => {
    assert.equal(validateOne({ file: 'x', kind: 'array', requireKeys: ['id', 'name'] }, [{ id: 1, name: 'a' }]), null);
});

test('array: fails when empty', () => {
    assert.match(validateOne({ file: 'x', kind: 'array', requireKeys: [] }, []), /empty/);
});

test('array: fails when a required key is missing', () => {
    assert.match(validateOne({ file: 'x', kind: 'array', requireKeys: ['id', 'name'] }, [{ id: 1 }]), /missing key\(s\) \[name\]/);
});

test('array: fails when the value is not an array', () => {
    assert.match(validateOne({ file: 'x', kind: 'array', requireKeys: [] }, { a: 1 }), /expected a JSON array/);
});

test('dict: passes when first value has all required keys', () => {
    assert.equal(validateOne({ file: 'x', kind: 'dict', requireKeys: ['a'] }, { '1': { a: 1 } }), null);
});

test('dict: passes with empty requireKeys as long as first value is a non-empty object', () => {
    assert.equal(validateOne({ file: 'x', kind: 'dict', requireKeys: [] }, { '1': { anything: 1 } }), null);
});

test('dict: fails when first value misses a required key', () => {
    assert.match(validateOne({ file: 'x', kind: 'dict', requireKeys: ['a'] }, { '1': { b: 1 } }), /missing key/);
});

test('dict: fails when first value is not an object', () => {
    assert.match(validateOne({ file: 'x', kind: 'dict', requireKeys: [] }, { '1': 5 }), /not an object/);
});

test('dict: fails when given an array', () => {
    assert.match(validateOne({ file: 'x', kind: 'dict', requireKeys: [] }, [1, 2]), /expected a JSON object \(dict\)/);
});

test('object: checks keys at the top level', () => {
    assert.equal(validateOne({ file: 'x', kind: 'object', requireKeys: ['v'] }, { v: 1 }), null);
    assert.match(validateOne({ file: 'x', kind: 'object', requireKeys: ['v'] }, { w: 1 }), /missing key/);
});

// Integration: the real data must satisfy the manifest. Doubles as a regression guard
// that the MANIFEST keys stay in sync with the actual files. Skipped when data is absent.
test('MANIFEST matches the real public/data', { skip: !existsSync(DATA_DIR) }, () => {
    const errors = validateShape(MANIFEST, DATA_DIR);
    assert.deepEqual(errors, [], `data-shape errors:\n${errors.join('\n')}`);
});
