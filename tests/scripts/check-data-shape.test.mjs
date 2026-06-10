/**
 * Tests for scripts/check-data-shape.mjs — the build-time data-shape guard.
 * Pure-logic cases exercise validateOne()/sampleIndices()/profileRecords(); the
 * integration case asserts the live MANIFEST still matches the real public/data
 * (skipped if data isn't present).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
    validateOne, validateShape, sampleIndices, profileRecords, MANIFEST, DATA_DIR,
} from '../../scripts/check-data-shape.mjs';

// --- container kind ---

test('array: passes when sampled records satisfy the fields contract', () => {
    const entry = { file: 'x', kind: 'array', fields: { id: 'number', name: 'string' } };
    assert.deepEqual(validateOne(entry, [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]), []);
});

test('array: fails when empty', () => {
    assert.match(validateOne({ file: 'x', kind: 'array', fields: {} }, [])[0], /empty/);
});

test('array: fails when the value is not an array', () => {
    assert.match(validateOne({ file: 'x', kind: 'array', fields: {} }, { a: 1 })[0], /expected a JSON array/);
});

test('dict: passes when sampled values satisfy the contract', () => {
    const entry = { file: 'x', kind: 'dict', fields: { a: 'number' } };
    assert.deepEqual(validateOne(entry, { '1': { a: 1 }, '2': { a: 2 } }), []);
});

test('dict: empty fields still requires non-empty dict of objects', () => {
    const entry = { file: 'x', kind: 'dict', fields: {} };
    assert.deepEqual(validateOne(entry, { '1': { anything: 1 } }), []);
    assert.match(validateOne(entry, {})[0], /empty/);
    assert.match(validateOne(entry, { '1': 5 })[0], /not an object/);
});

test('dict: fails when given an array', () => {
    assert.match(validateOne({ file: 'x', kind: 'dict', fields: {} }, [1, 2])[0], /expected a JSON object \(dict\)/);
});

test('object: checks fields at the top level', () => {
    assert.deepEqual(validateOne({ file: 'x', kind: 'object', fields: { v: 'number' } }, { v: 1 }), []);
    assert.match(validateOne({ file: 'x', kind: 'object', fields: { v: 'number' } }, { w: 1 })[0], /missing field "v"/);
});

// --- field contract semantics ---

test('missing required field is reported', () => {
    const entry = { file: 'x', kind: 'array', fields: { id: 'number', name: 'string' } };
    assert.match(validateOne(entry, [{ id: 1 }])[0], /missing field "name"/);
});

test('type mismatch is reported with actual vs expected', () => {
    const entry = { file: 'x', kind: 'array', fields: { id: 'number' } };
    assert.match(validateOne(entry, [{ id: '1' }])[0], /field "id" .* is string, expected number/);
});

test('union spec accepts any listed type, rejects others', () => {
    const entry = { file: 'x', kind: 'array', fields: { timer: 'string|null' } };
    assert.deepEqual(validateOne(entry, [{ timer: 'soon' }]), []);
    assert.deepEqual(validateOne(entry, [{ timer: null }]), []);
    assert.match(validateOne(entry, [{ timer: 5 }])[0], /is number, expected string\|null/);
});

test('null and array are distinct types (not "object")', () => {
    const entry = { file: 'x', kind: 'array', fields: { v: 'object' } };
    assert.match(validateOne(entry, [{ v: null }])[0], /is null/);
    assert.match(validateOne(entry, [{ v: [1] }])[0], /is array/);
});

test('optional field: absence OK, wrong type when present fails', () => {
    const entry = { file: 'x', kind: 'array', fields: { retrofit: 'object?' } };
    assert.deepEqual(validateOne(entry, [{}]), []);
    assert.deepEqual(validateOne(entry, [{ retrofit: { a: 1 } }]), []);
    assert.match(validateOne(entry, [{ retrofit: 'yes' }])[0], /is string, expected object/);
});

// --- sampling ---

test('sampleIndices: all indices when small, first+last+spread when large', () => {
    assert.deepEqual(sampleIndices(3, 5), [0, 1, 2]);
    const idx = sampleIndices(100, 5);
    assert.equal(idx[0], 0);
    assert.equal(idx[idx.length - 1], 99);
    assert.equal(idx.length, 5);
});

test('drift beyond record[0] is caught (the old guard only checked the first record)', () => {
    const records = Array.from({ length: 50 }, () => ({ id: 1 }));
    records[49] = { id: 'oops' }; // last record always sampled
    const entry = { file: 'x', kind: 'array', fields: { id: 'number' } };
    assert.match(validateOne(entry, records)[0], /record\[49\].*is string/);
});

test('same field failing on several sampled records is reported once', () => {
    const records = Array.from({ length: 50 }, () => ({}));
    const entry = { file: 'x', kind: 'array', fields: { id: 'number' } };
    const errors = validateOne(entry, records);
    assert.equal(errors.length, 1);
});

test('non-object sampled record is reported', () => {
    const entry = { file: 'x', kind: 'array', fields: { id: 'number' } };
    assert.match(validateOne(entry, [42])[0], /not an object/);
});

// --- describe profiling (contract authoring helper) ---

test('profileRecords: counts presence and collects observed types', () => {
    const profile = profileRecords([{ a: 1, b: 'x' }, { a: null }]);
    assert.equal(profile.get('a').count, 2);
    assert.deepEqual([...profile.get('a').types].sort(), ['null', 'number']);
    assert.equal(profile.get('b').count, 1);
});

// Integration: the real data must satisfy the manifest. Doubles as a regression guard
// that the MANIFEST contracts stay in sync with the actual files. Skipped when data is absent.
test('MANIFEST matches the real public/data', { skip: !existsSync(DATA_DIR) }, () => {
    const errors = validateShape(MANIFEST, DATA_DIR);
    assert.deepEqual(errors, [], `data-shape errors:\n${errors.join('\n')}`);
});
