/**
 * Tests for scripts/skin-attributes.mjs — the v1 attribute vocabulary and its
 * cell parser. Pure; no I/O.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ATTRIBUTES, ID_HEADER, CHECKED_HEADER, CHARACTER_TRAIT_KEYS,
    parseAttributeCell, buildLabelSchema, selectAttributes,
} from '../../scripts/skin-attributes.mjs';

const byKey = (k) => ATTRIBUTES.find((a) => a.key === k);

// --- shape ---

test('ATTRIBUTES has the 8 v1 attributes with unique keys and headers', () => {
    assert.equal(ATTRIBUTES.length, 8);
    assert.equal(new Set(ATTRIBUTES.map((a) => a.key)).size, 8);
    assert.equal(new Set(ATTRIBUTES.map((a) => a.header)).size, 8);
    assert.deepEqual(ATTRIBUTES.map((a) => a.key), [
        'eyewear', 'posture', 'facing', 'emphasis',
        'hairColor', 'hairMultiTone', 'eyeColor', 'beastFeatures',
    ]);
});

test('only beastFeatures is multi-valued', () => {
    assert.deepEqual(ATTRIBUTES.filter((a) => a.multi).map((a) => a.key), ['beastFeatures']);
});

test('hairColor carries no multi-tone bucket — the pattern lives on its own axis', () => {
    assert.ok(!byKey('hairColor').values.includes('다중색'));
    assert.ok(byKey('hairMultiTone').values.includes('브릿지'));
});

test('CHARACTER_TRAIT_KEYS are all real attribute keys', () => {
    const keys = new Set(ATTRIBUTES.map((a) => a.key));
    for (const k of CHARACTER_TRAIT_KEYS) assert.ok(keys.has(k), `${k} is not an attribute`);
});

test('reserved headers do not collide with attribute headers', () => {
    const headers = new Set(ATTRIBUTES.map((a) => a.header));
    assert.ok(!headers.has(ID_HEADER));
    assert.ok(!headers.has(CHECKED_HEADER));
});

// --- parseAttributeCell: single-valued ---

test('parseAttributeCell accepts an in-enum value and trims it', () => {
    assert.deepEqual(parseAttributeCell(byKey('posture'), '  서기 '), { value: '서기', error: null });
});

test('parseAttributeCell maps a blank cell to null, not to 없음', () => {
    assert.deepEqual(parseAttributeCell(byKey('eyewear'), ''), { value: null, error: null });
    assert.deepEqual(parseAttributeCell(byKey('eyewear'), '   '), { value: null, error: null });
});

test('parseAttributeCell treats 없음 as a positive determination', () => {
    assert.deepEqual(parseAttributeCell(byKey('eyewear'), '없음'), { value: '없음', error: null });
});

test('parseAttributeCell rejects an out-of-enum value', () => {
    const { value, error } = parseAttributeCell(byKey('facing'), '측면');
    assert.equal(value, null);
    assert.match(error, /방향/);
    assert.match(error, /측면/);
});

// --- parseAttributeCell: multi-valued ---

test('parseAttributeCell splits multi cells on comma and trims each part', () => {
    const attr = byKey('beastFeatures');
    assert.deepEqual(parseAttributeCell(attr, '동물귀, 꼬리'), { value: ['동물귀', '꼬리'], error: null });
    assert.deepEqual(parseAttributeCell(attr, '동물귀,꼬리'), { value: ['동물귀', '꼬리'], error: null });
});

test('parseAttributeCell drops empty segments from a multi cell', () => {
    assert.deepEqual(parseAttributeCell(byKey('beastFeatures'), '뿔, ,날개'),
        { value: ['뿔', '날개'], error: null });
});

test('parseAttributeCell de-duplicates repeated multi values', () => {
    assert.deepEqual(parseAttributeCell(byKey('beastFeatures'), '꼬리, 꼬리'),
        { value: ['꼬리'], error: null });
});

test('없음 is exclusive in a multi cell', () => {
    const { value, error } = parseAttributeCell(byKey('beastFeatures'), '없음, 꼬리');
    assert.equal(value, null);
    assert.match(error, /없음/);
});

test('없음 alone is valid in a multi cell', () => {
    assert.deepEqual(parseAttributeCell(byKey('beastFeatures'), '없음'), { value: ['없음'], error: null });
});

test('a blank multi cell is null, not an empty array', () => {
    assert.deepEqual(parseAttributeCell(byKey('beastFeatures'), ''), { value: null, error: null });
});

test('parseAttributeCell rejects an out-of-enum part of a multi cell', () => {
    const { value, error } = parseAttributeCell(byKey('beastFeatures'), '동물귀, 지느러미');
    assert.equal(value, null);
    assert.match(error, /지느러미/);
});

// --- buildLabelSchema ---

test('buildLabelSchema requires every attribute and forbids extra properties', () => {
    const schema = buildLabelSchema();
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, ATTRIBUTES.map((a) => a.key));
});

test('buildLabelSchema lets every attribute abstain with null', () => {
    const schema = buildLabelSchema();
    for (const attr of ATTRIBUTES) {
        const branches = schema.properties[attr.key].anyOf;
        assert.ok(branches.some((b) => b.type === 'null'), `${attr.key} cannot be null`);
    }
});

test('buildLabelSchema constrains single attributes to their enum', () => {
    const branch = buildLabelSchema().properties.facing.anyOf.find((b) => b.type === 'string');
    assert.deepEqual(branch.enum, ['정면', '후면']);
});

test('buildLabelSchema models a multi attribute as an array of its enum', () => {
    const branch = buildLabelSchema().properties.beastFeatures.anyOf.find((b) => b.type === 'array');
    assert.deepEqual(branch.items.enum, byKey('beastFeatures').values);
});

test('buildLabelSchema narrows to the requested attributes only', () => {
    const schema = buildLabelSchema(['posture', 'facing']);
    assert.deepEqual(Object.keys(schema.properties), ['posture', 'facing']);
    assert.deepEqual(schema.required, ['posture', 'facing']);
});

// --- selectAttributes ---

test('selectAttributes returns ATTRIBUTES order, not the caller argument order', () => {
    // The CSV columns follow this order, so a shuffled --only must not shuffle them.
    assert.deepEqual(selectAttributes(['facing', 'eyewear']).map((a) => a.key), ['eyewear', 'facing']);
});

test('selectAttributes defaults to every attribute', () => {
    for (const arg of [undefined, []]) {
        assert.equal(selectAttributes(arg).length, ATTRIBUTES.length);
    }
});

test('selectAttributes throws on an unknown key', () => {
    // A typo'd --only that silently labelled nothing would waste a paid batch run.
    assert.throws(() => selectAttributes(['postures']), /unknown attribute "postures"/);
});
