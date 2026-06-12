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
// 청문회-tab contract: pre-populated, one row per equip. Synced headers:
// 장비id, 별명, plus 한줄평1..N detected dynamically; display columns
// (이름/아이콘/레어도 …) ignored.

const HEADER = '장비id,이름,아이콘,레어도,별명,한줄평1,한줄평2,한줄평3';

test('mapRows maps by header name, ignores display columns, skips empty 한줄평 cells', () => {
    const rows = parseCsv(`${HEADER}\n740,FI-282 헬리콥터,X,SSR,헬리,굿,,프롤테카\n`);
    assert.deepEqual(mapRows(rows), [
        { equipId: '740', alias: '헬리', reviews: ['굿', '프롤테카'] },
    ]);
});

test('mapRows orders reviews by 한줄평 number even when columns are shuffled', () => {
    const rows = parseCsv('한줄평2,장비id,별명,한줄평1\nsecond,740,,first\n');
    assert.deepEqual(mapRows(rows)[0].reviews, ['first', 'second']);
});

test('mapRows drops pre-populated rows with no input', () => {
    assert.deepEqual(mapRows(parseCsv(`${HEADER}\n740,이름,X,SSR,,,,\n`)), []);
});

test('mapRows throws when 장비id/별명/한줄평1 columns are missing', () => {
    assert.throws(() => mapRows(parseCsv('장비id,별명\n')), /한줄평/);
    assert.throws(() => mapRows(parseCsv('별명,한줄평1\n')), /장비id/);
});

test('mapRows trims, normalizes newlines, and extracts ids from "id — name" composites', () => {
    const rows = parseCsv('장비id,별명,한줄평1\n"740 — FI-282 헬리콥터","  헬리 ","l1\r\nl2"\n');
    assert.deepEqual(mapRows(rows)[0],
        { equipId: '740', alias: '헬리', reviews: ['l1\nl2'] });
});

// --- validateRows ---

const VALID_IDS = new Set(['740', '23120']);
const mkRow = (over = {}) => ({ equipId: '740', alias: '', reviews: ['굿'], ...over });

test('validateRows passes a clean row set', () => {
    assert.deepEqual(validateRows([mkRow()], VALID_IDS).errors, []);
});

test('validateRows fails unknown 장비id unless allowUnknown', () => {
    const rows = [mkRow({ equipId: '99999' })];
    assert.match(validateRows(rows, VALID_IDS).errors[0], /unknown 장비id/);
    assert.deepEqual(validateRows(rows, VALID_IDS, { allowUnknown: true }).errors, []);
});

test('validateRows flags non-numeric and duplicate 장비id', () => {
    const { errors } = validateRows([
        mkRow({ equipId: 'abc' }),   // non-numeric
        mkRow(), mkRow(),            // duplicate id
    ], VALID_IDS);
    assert.equal(errors.length, 2);
});

// --- buildHearingJson ---

test('buildHearingJson maps rows directly to entries keyed by id', () => {
    const out = buildHearingJson([
        { equipId: '740', alias: '헬기', reviews: ['굿', '좋음'] },
        { equipId: '23120', alias: '', reviews: ['강함'] },
    ], '2026-06-11');
    assert.equal(out._meta.synced, '2026-06-11');
    assert.equal(out._meta.count, 2);
    assert.deepEqual(out.entries['740'], { alias: '헬기', reviews: ['굿', '좋음'] });
    assert.deepEqual(out.entries['23120'], { alias: '', reviews: ['강함'] });
});

// --- diffSummary ---

test('diffSummary counts added/changed/removed entries', () => {
    const prev = { a: { alias: 'x', reviews: [] }, b: { alias: 'y', reviews: [] } };
    const next = { a: { alias: 'x2', reviews: [] }, c: { alias: 'z', reviews: [] } };
    assert.deepEqual(diffSummary(prev, next), { added: 1, removed: 1, changed: 1 });
});
