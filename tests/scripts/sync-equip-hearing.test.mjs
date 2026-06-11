/**
 * Tests for the pure core of scripts/sync-equip-hearing.mjs:
 * RFC4180 CSV parse/serialize, header mapping, validation, grouping, diff.
 * No network — main() is CLI-guarded and never runs on import.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, csvField, buildCatalogCsv, mapRows, validateRows, buildHearingJson, diffSummary } from '../../scripts/sync-equip-hearing.mjs';
import { DATA_FOR_TOY_BASE } from '../../public/js/utils.js';

// --- parseCsv ---

test('parseCsv splits simple rows and fields', () => {
    assert.deepEqual(parseCsv('a,b,c\n1,2,3\n'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('parseCsv handles quoted fields with commas, escaped quotes, and newlines', () => {
    assert.deepEqual(
        parseCsv('a,"x, y",c\n"he said ""hi""","line1\nline2",z\n'),
        [['a', 'x, y', 'c'], ['he said "hi"', 'line1\nline2', 'z']]);
});

test('parseCsv handles CRLF rows and a leading BOM', () => {
    // BOM built via fromCharCode — an invisible literal in source is a foot-gun
    assert.deepEqual(parseCsv(String.fromCharCode(0xFEFF) + 'a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('parseCsv keeps CRLF inside quoted fields as content', () => {
    assert.deepEqual(parseCsv('a\r\n"l1\r\nl2"\r\n'), [['a'], ['l1\r\nl2']]);
});

test('parseCsv handles a missing trailing newline', () => {
    assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

// --- csvField ---

test('csvField quotes only when needed and doubles inner quotes', () => {
    assert.equal(csvField('plain'), 'plain');
    assert.equal(csvField('a,b'), '"a,b"');
    assert.equal(csvField('say "hi"'), '"say ""hi"""');
    assert.equal(csvField('l1\nl2'), '"l1\nl2"');
    assert.equal(csvField(null), '');
    assert.equal(csvField(740), '740');
});

// --- buildCatalogCsv ---

test('buildCatalogCsv emits header + one line per equip with resolved icon URL', () => {
    const csv = buildCatalogCsv([
        { id: 740, name: 'FI-282 헬리콥터', rarity_name: 'SSR', type_name2: '헬리콥터', nation_code: 'KMS', icon: '740' },
        { id: 1, name: 'a,b', rarity_name: 'N', type_name2: '기타', nation_code: 'USS', icon: '1' },
    ]);
    const lines = csv.trim().split('\n');
    assert.equal(lines[0], 'id,name,rarity,type,nation,icon_url');
    assert.equal(lines[1], `740,FI-282 헬리콥터,SSR,헬리콥터,KMS,${DATA_FOR_TOY_BASE}/equips/740.webp`);
    // comma in name gets quoted; icon '1' is the no-icon sentinel → empty URL
    assert.equal(lines[2], '1,"a,b",N,기타,USS,');
});

// --- mapRows ---
// Sheet contract: hearing tab headers are literally
// equip_id, author, 별명, 한줄평, notes — all five required, any order,
// any extra (convenience VLOOKUP/IMAGE) columns ignored.

const HEADER = 'equip_id,author,별명,한줄평,notes';

test('mapRows maps by header name and ignores extra columns', () => {
    const rows = parseCsv(`이름,${HEADER},아이콘\nX,740,jay,헬리,굿,메모,Y\n`);
    assert.deepEqual(mapRows(rows), [
        { equipId: '740', author: 'jay', alias: '헬리', review: '굿', notes: '메모' },
    ]);
});

test('mapRows drops rows with no content in 별명/한줄평/notes', () => {
    assert.deepEqual(mapRows(parseCsv(`${HEADER}\n740,jay,,,\n`)), []);
});

test('mapRows throws on a missing required column', () => {
    assert.throws(() => mapRows(parseCsv('equip_id,author,별명,한줄평\n')),
        /missing required column "notes"/);
});

test('mapRows trims values and normalizes newlines in multi-line notes', () => {
    const rows = parseCsv(`${HEADER}\n740, jay ,"  헬리 ",굿,"l1\r\nl2"\n`);
    assert.deepEqual(mapRows(rows)[0],
        { equipId: '740', author: 'jay', alias: '헬리', review: '굿', notes: 'l1\nl2' });
});

// --- validateRows ---

const VALID_IDS = new Set(['740', '23120']);
const mkRow = (over = {}) =>
    ({ equipId: '740', author: 'jay', alias: '', review: '굿', notes: '', ...over });

test('validateRows passes a clean row set', () => {
    assert.deepEqual(validateRows([mkRow()], VALID_IDS).errors, []);
});

test('validateRows fails unknown equip_id unless allowUnknown', () => {
    const rows = [mkRow({ equipId: '99999' })];
    assert.match(validateRows(rows, VALID_IDS).errors[0], /unknown equip_id/);
    assert.deepEqual(validateRows(rows, VALID_IDS, { allowUnknown: true }).errors, []);
});

test('validateRows flags non-numeric id, missing author, and duplicate (id, author)', () => {
    const { errors } = validateRows([
        mkRow({ equipId: 'abc' }),   // non-numeric
        mkRow({ author: '' }),       // missing author
        mkRow(), mkRow(),            // duplicate pair
    ], VALID_IDS);
    assert.equal(errors.length, 3);
});

// --- buildHearingJson ---

test('buildHearingJson groups comments per equip and merges distinct aliases', () => {
    const out = buildHearingJson([
        { equipId: '740', author: 'jay', alias: '헬기', review: '굿', notes: '' },
        { equipId: '740', author: 'kim', alias: '헬리콥터', review: '좋음', notes: '메모' },
        { equipId: '740', author: 'lee', alias: '헬기', review: '', notes: '' }, // alias-only, duplicate alias
    ], '2026-06-11');
    assert.equal(out._meta.synced, '2026-06-11');
    assert.equal(out._meta.count, 1);
    assert.equal(out.entries['740'].alias, '헬기 / 헬리콥터');
    // lee's alias-only row contributes no comment entry
    assert.deepEqual(out.entries['740'].comments, [
        { author: 'jay', review: '굿', notes: '' },
        { author: 'kim', review: '좋음', notes: '메모' },
    ]);
});

test('buildHearingJson dedups aliases on raw values, even when an alias contains " / "', () => {
    const out = buildHearingJson([
        { equipId: '1', author: 'jay', alias: '', review: 'r1', notes: '' },        // first row has no alias
        { equipId: '1', author: 'kim', alias: 'A / B', review: 'r2', notes: '' },
        { equipId: '1', author: 'lee', alias: 'A / B', review: 'r3', notes: '' },   // exact duplicate must not re-append
    ], '2026-06-11');
    assert.equal(out.entries['1'].alias, 'A / B');
});

// --- diffSummary ---

test('diffSummary counts added/changed/removed entries', () => {
    const prev = { a: { alias: 'x', comments: [] }, b: { alias: 'y', comments: [] } };
    const next = { a: { alias: 'x2', comments: [] }, c: { alias: 'z', comments: [] } };
    assert.deepEqual(diffSummary(prev, next), { added: 1, removed: 1, changed: 1 });
});
