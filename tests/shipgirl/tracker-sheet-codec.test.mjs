/**
 * tracker-sheet-codec.test.mjs
 * Sheet → site import codec for /shipgirl/shipgirl-tracker.
 *
 * The fixture mirrors the REAL sheet: tab-separated (a Google Sheets copy),
 * header cells carrying cosmetic newlines from column-width crunch, a
 * six-times-duplicated 적용 함종 header, and the trailing computed-score block
 * the codec must ignore entirely.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    sniffDelimiter, parseSheetId, foldShipName, parseSheet,
    SHEET_PROGRESS, SHEET_AFF, SHEET_SKL, applyToStores,
} from '../../public/js/shipgirl/tracker-sheet-codec.js';

// Real rows from public/data/ship_info_lite.json (dex → gid, name, rarity).
const SHIPS = [
    { id: 1, gid: 10000, name: '범용형 부린' },
    { id: 2, gid: 10001, name: '시제형 부린 MKⅡ' },
    { id: 420, gid: 10224, name: '클리블랜드(μ장비)' },   // Greek mu U+03BC
    { id: 659, gid: 10152, name: '벨' },
    { id: 10001, gid: 1010001, name: '넵튠(콜라보)' },     // Z001
    { id: 10004, gid: 1010004, name: '벨(콜라보)' },       // Z004 — NOT a 벨 collision
    { id: 20001, gid: 29901, name: '넵튠' },               // P001
    { id: 30061, gid: 970605, name: '엘베·META' },         // M061
];

/** The sheet's real header row, cosmetic newlines and duplicates intact. */
const HEADER = [
    'ID', '사진', '이름', '레어도', '함종', '진영',
    '개장\n가능?', '개장\n여부', '즐겨찾기', '획득/육성\n여부',
    '스작\n여부', '호감작\n여부',
    '자유 코멘트 (입수처 등)\n(메모 필요하면 자유롭게 쓰셈)',
    '획득\n기술점수', '적용\n함종', '적용\n함종', '적용\n함종',
];

/** Serialize rows to TSV, quoting only what needs it (mirrors a Sheets copy). */
function tsv(rows) {
    return rows.map((r) => r.map((f) => {
        const s = String(f ?? '');
        return /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join('\t')).join('\n');
}

/** A data row in the real column order; `over` patches by column index. */
function row(id, name, over = {}) {
    const r = [id, '', name, 'SSR', '경항모', 'META', 'X', '', 'X', '미획득', '스작 안함', '호감작 안함', '', '0', '', '', ''];
    for (const [k, v] of Object.entries(over)) r[k] = v;
    return r;
}

const parse = (rows, opts) => parseSheet(tsv([HEADER, ...rows]), { ships: SHIPS, ...opts });

// ===== Delimiter =====

test('sniffDelimiter: a Sheets copy is TSV', () => {
    assert.equal(sniffDelimiter('ID\t이름\n1\t범용형 부린'), '\t');
});

test('sniffDelimiter: a downloaded file is CSV', () => {
    assert.equal(sniffDelimiter('ID,이름\n1,범용형 부린'), ',');
});

test('sniffDelimiter: counts only the header line, and ignores delimiters inside quotes', () => {
    // A memo full of commas must not make a TSV file look like CSV.
    assert.equal(sniffDelimiter('ID\t"자유 코멘트"\n1\t"a,b,c,d,e,f"'), '\t');
});

test('sniffDelimiter: a single-column file falls back to comma', () => {
    assert.equal(sniffDelimiter('ID\n1'), ',');
});

// ===== Sheet ID rules =====

test('parseSheetId: plain numeric is the dex id as-is', () => {
    assert.equal(parseSheetId('1'), 1);
    assert.equal(parseSheetId('659'), 659);
});

test('parseSheetId: Z/P/M prefixes offset into their bands', () => {
    assert.equal(parseSheetId('Z001'), 10001);
    assert.equal(parseSheetId('P001'), 20001);
    assert.equal(parseSheetId('M061'), 30061);
});

test('parseSheetId: prefix is case-insensitive and zero-padding is optional', () => {
    assert.equal(parseSheetId('m61'), 30061);
    assert.equal(parseSheetId('z1'), 10001);
});

test('parseSheetId: surrounding whitespace is tolerated', () => {
    assert.equal(parseSheetId('  M061 '), 30061);
});

test('parseSheetId: junk returns null rather than guessing', () => {
    for (const bad of ['', '   ', 'ABC', 'Q001', '12x', null, undefined]) {
        assert.equal(parseSheetId(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
});

// ===== Name folding (validation only — never used to match) =====

test('foldShipName: (META) and ·META converge', () => {
    assert.equal(foldShipName('엘베(META)'), foldShipName('엘베·META'));
});

test('foldShipName: micro sign folds onto Greek mu', () => {
    // U+00B5 (micro) vs U+03BC (Greek mu) — 19 ships are named (μ장비).
    assert.equal(foldShipName('클리블랜드(µ장비)'), foldShipName('클리블랜드(μ장비)'));
});

test('foldShipName: ASCII roman numerals fold onto composed ones', () => {
    assert.equal(foldShipName('시제형 부린 MKII'), foldShipName('시제형 부린 MKⅡ'));
});

test('foldShipName: whitespace is insensitive', () => {
    assert.equal(foldShipName('  범용형   부린 '), foldShipName('범용형 부린'));
});

test('foldShipName: distinct ships stay distinct', () => {
    assert.notEqual(foldShipName('벨'), foldShipName('벨(콜라보)'));
});

// ===== Column location =====

test('columns are found by name despite cosmetic newlines in the header', () => {
    const res = parse([row('1', '범용형 부린', { 9: '풀돌' })]);
    assert.equal(res.matched.length, 1);
    assert.equal(res.matched[0].mask, 0b101);
});

test('the six duplicate 적용 함종 headers and the computed block are ignored', () => {
    const res = parse([row('1', '범용형 부린')]);
    assert.deepEqual(res.ignoredColumns.includes('적용함종'), true);
    assert.equal(res.matched[0].inv.skl ?? 0, 0);
});

test('a missing ID column is a hard error, not a silent empty import', () => {
    const res = parseSheet(tsv([['이름', '획득/육성\n여부'], ['범용형 부린', '획득']]), { ships: SHIPS });
    assert.equal(res.ok, false);
    assert.match(res.error, /ID/);
});

test('optional columns absent — those fields are left untouched, not zeroed', () => {
    const res = parseSheet(tsv([['ID', '획득/육성\n여부'], ['1', '120']]), { ships: SHIPS });
    assert.equal(res.ok, true);
    assert.equal(res.matched[0].mask, 0b111);
    assert.equal(res.matched[0].inv.cap, 4);
    assert.equal('skl' in res.matched[0].inv, false, 'absent column must not write skl');
    assert.equal('memo' in res.matched[0].inv, false);
});

// ===== 획득/육성 ladder → mask + cap =====

test('획득/육성 ladder maps to the frozen 3-bit mask and cap', () => {
    // get=1, level=2, upgrade=4 — FROZEN contract shared with research-tracker.
    const cases = [
        ['미획득', 0, 0],
        ['획득', 0b001, 0],
        ['풀돌', 0b101, 0],
        ['120', 0b111, 4],
        ['125', 0b111, 5],
    ];
    for (const [cell, mask, cap] of cases) {
        const res = parse([row('1', '범용형 부린', { 9: cell })]);
        assert.equal(res.matched[0].mask, mask, `mask for ${cell}`);
        assert.equal(res.matched[0].inv.cap ?? 0, cap, `cap for ${cell}`);
    }
});

test('SHEET_PROGRESS is the ladder in stored order', () => {
    assert.deepEqual(SHEET_PROGRESS, ['미획득', '획득', '풀돌', '120', '125']);
});

test('a blank 획득/육성 cell means no opinion, not 미획득', () => {
    const res = parse([row('1', '범용형 부린', { 9: '' })]);
    assert.equal(res.matched[0].mask, null);
});

test('an unrecognised 획득/육성 value rejects the row rather than guessing', () => {
    const res = parse([row('1', '범용형 부린', { 9: '반돌' })]);
    assert.equal(res.matched.length, 0);
    assert.equal(res.rejected.length, 1);
    assert.match(res.rejected[0].reason, /획득\/육성/);
});

// ===== enum ladders =====

test('스작 ladder maps every rung — including the two the UI labels once missed', () => {
    // 스작 안함 / 스작 진행중 are the values a SKL_LABELS.indexOf() would have
    // returned -1 for back when the chips said 스작 / 스작 중.
    SHEET_SKL.forEach((cell, i) => {
        const res = parse([row('1', '범용형 부린', { 10: cell })]);
        assert.equal(res.matched[0].inv.skl, i, `skl for ${cell}`);
    });
});

test('호감작 ladder maps every rung', () => {
    SHEET_AFF.forEach((cell, i) => {
        const res = parse([row('1', '범용형 부린', { 11: cell })]);
        assert.equal(res.matched[0].inv.aff, i, `aff for ${cell}`);
    });
});

test('enum reads tolerate the site\'s older chip wording', () => {
    // Legacy files exported before the vocabulary was aligned.
    assert.equal(parse([row('1', '범용형 부린', { 10: '스작 중' })]).matched[0].inv.skl, 2);
    assert.equal(parse([row('1', '범용형 부린', { 10: '스작' })]).matched[0].inv.skl, 0);
    assert.equal(parse([row('1', '범용형 부린', { 11: '호감작' })]).matched[0].inv.aff, 0);
});

test('enum reads are whitespace-insensitive', () => {
    assert.equal(parse([row('1', '범용형 부린', { 10: ' 스작  진행중 ' })]).matched[0].inv.skl, 2);
});

test('an unrecognised enum value rejects the row', () => {
    const res = parse([row('1', '범용형 부린', { 10: '스작 반쯤' })]);
    assert.equal(res.rejected.length, 1);
    assert.match(res.rejected[0].reason, /스작/);
});

// ===== O / X / blank =====

test('개장 여부 and 즐겨찾기 read O and X', () => {
    const res = parse([row('1', '범용형 부린', { 7: 'O', 8: 'O' })]);
    assert.equal(res.matched[0].inv.ret, 1);
    assert.equal(res.matched[0].inv.fav, 1);
    const off = parse([row('1', '범용형 부린', { 7: 'X', 8: 'X' })]);
    assert.equal(off.matched[0].inv.ret, 0);
    assert.equal(off.matched[0].inv.fav, 0);
});

test('a blank 개장 여부 is no opinion — the sheet leaves it empty when 개장 가능? is X', () => {
    const res = parse([row('1', '범용형 부린', { 7: '' })]);
    assert.equal('ret' in res.matched[0].inv, false);
});

test('O/X reads are case-insensitive', () => {
    assert.equal(parse([row('1', '범용형 부린', { 8: 'o' })]).matched[0].inv.fav, 1);
    assert.equal(parse([row('1', '범용형 부린', { 8: 'x' })]).matched[0].inv.fav, 0);
});

// ===== memo =====

test('memo survives quoting — commas, quotes and newlines inside the cell', () => {
    const memo = 'a,b "quoted"\nsecond line';
    const res = parse([row('1', '범용형 부린', { 12: memo })]);
    assert.equal(res.matched[0].inv.memo, memo);
});

test('memo is clamped to MEMO_MAX so a runaway cell cannot bloat storage', () => {
    const res = parse([row('1', '범용형 부린', { 12: 'あ'.repeat(900) })]);
    assert.equal(res.matched[0].inv.memo.length, 500);
});

test('a blank memo is no opinion, not an erase', () => {
    const res = parse([row('1', '범용형 부린', { 12: '' })]);
    assert.equal('memo' in res.matched[0].inv, false);
});

// ===== ID join + name validation =====

test('rows join by ID across all four bands', () => {
    const res = parse([
        row('1', '범용형 부린'),
        row('Z001', '넵튠(콜라보)'),
        row('P001', '넵튠'),
        row('M061', '엘베(META)'),
    ]);
    assert.equal(res.rejected.length, 0);
    assert.deepEqual(res.matched.map((m) => m.gid), [10000, 1010001, 29901, 970605]);
});

test('the ID join separates 넵튠 from 넵튠(콜라보) — a name join could not', () => {
    const res = parse([row('P001', '넵튠'), row('Z001', '넵튠(콜라보)')]);
    assert.deepEqual(res.matched.map((m) => m.gid), [29901, 1010001]);
});

test('an unknown ID is rejected with its line number', () => {
    const res = parse([row('1', '범용형 부린'), row('9999', '유령함')]);
    assert.equal(res.matched.length, 1);
    assert.equal(res.rejected.length, 1);
    assert.equal(res.rejected[0].line, 3, 'header is line 1');
    assert.match(res.rejected[0].reason, /찾을 수 없/);
});

test('an unparseable ID is rejected, not coerced', () => {
    const res = parse([row('Q001', '무언가')]);
    assert.equal(res.rejected.length, 1);
    assert.match(res.rejected[0].reason, /ID/);
});

test('a blank ID row is skipped silently — sheets carry spacer rows', () => {
    const res = parse([row('', ''), row('1', '범용형 부린')]);
    assert.equal(res.matched.length, 1);
    assert.equal(res.rejected.length, 0);
});

test('a name that disagrees still imports, but is flagged for review', () => {
    const res = parse([row('1', '엉뚱한 이름')]);
    assert.equal(res.matched.length, 1, 'ID is authoritative — the row still imports');
    assert.equal(res.matched[0].nameMismatch, true);
    assert.equal(res.matched[0].siteName, '범용형 부린');
});

test('folded name differences are NOT flagged', () => {
    const res = parse([
        row('M061', '엘베(META)'),
        row('2', '시제형 부린 MKII'),
        row('420', '클리블랜드(µ장비)'),
    ]);
    assert.equal(res.matched.filter((m) => m.nameMismatch).length, 0);
});

test('duplicate IDs keep the last row and report the collision', () => {
    const res = parse([row('1', '범용형 부린', { 9: '획득' }), row('1', '범용형 부린', { 9: '120' })]);
    assert.equal(res.matched.length, 1);
    assert.equal(res.matched[0].mask, 0b111);
    assert.equal(res.duplicates.length, 1);
});

// ===== whole-file =====

test('CSV input parses identically to the TSV copy', () => {
    const asCsv = (rows) => rows.map((r) => r.map((f) => {
        const s = String(f ?? '');
        return /[,\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\n');
    const rows = [HEADER, row('M061', '엘베(META)', { 9: '125', 10: '스작 완료' })];
    const fromTsv = parseSheet(tsv(rows), { ships: SHIPS });
    const fromCsv = parseSheet(asCsv(rows), { ships: SHIPS });
    assert.deepEqual(fromCsv.matched, fromTsv.matched);
});

test('a UTF-8 BOM on a downloaded file does not break the ID column', () => {
    const res = parseSheet('﻿' + tsv([HEADER, row('1', '범용형 부린')]), { ships: SHIPS });
    assert.equal(res.matched.length, 1);
});

test('CRLF line endings parse', () => {
    const res = parseSheet(tsv([HEADER, row('1', '범용형 부린')]).replace(/\n/g, '\r\n'), { ships: SHIPS });
    assert.equal(res.matched.length, 1);
});

test('an empty file is an error, not an empty success', () => {
    assert.equal(parseSheet('', { ships: SHIPS }).ok, false);
});

test('a full realistic sheet round of rows reports a usable summary', () => {
    const res = parse([
        row('1', '범용형 부린', { 7: 'O', 8: 'O', 9: '125', 10: '스작 완료', 11: '200 완료', 12: '메인' }),
        row('659', '벨', { 9: '풀돌' }),
        row('Z004', '벨(콜라보)', { 9: '획득', 12: '콜라보' }),
        row('9999', '유령함'),
        row('Q001', '깨진 ID'),
    ]);
    assert.equal(res.ok, true);
    assert.equal(res.matched.length, 3);
    assert.equal(res.rejected.length, 2);
    assert.deepEqual(res.matched[0].inv, {
        cap: 5, ret: 1, fav: 1, skl: 3, aff: 4, memo: '메인',
    });
    assert.equal(res.matched[0].mask, 0b111);
});

// ===== applyToStores =====

test('applyToStores merges onto existing state without dropping untouched ships', () => {
    const { matched } = parse([row('1', '범용형 부린', { 9: '120' })]);
    const out = applyToStores(matched, {
        progress: { 99999: 0b111 },
        investment: { 99999: { cap: 5 } },
    });
    assert.equal(out.progress[99999], 0b111, 'a ship absent from the sheet is untouched');
    assert.deepEqual(out.investment[99999], { cap: 5 });
    assert.equal(out.progress[10000], 0b111);
    assert.equal(out.investment[10000].cap, 4);
});

test('applyToStores preserves fields the sheet has no column for', () => {
    // The sheet cannot carry a memo here, so an existing one must survive.
    const res = parseSheet(tsv([['ID', '획득/육성\n여부'], ['1', '획득']]), { ships: SHIPS });
    const out = applyToStores(res.matched, { investment: { 10000: { memo: '지키기', skl: 3 } } });
    // cap 0 is the default, so the sparse contract drops it rather than storing it.
    assert.deepEqual(out.investment[10000], { memo: '지키기', skl: 3 });
});

test('applyToStores leaves the mask alone when the row had no opinion', () => {
    const { matched } = parse([row('1', '범용형 부린', { 9: '' })]);
    const out = applyToStores(matched, { progress: { 10000: 0b111 } });
    assert.equal(out.progress[10000], 0b111);
});

test('applyToStores does not mutate the objects it is given', () => {
    const progress = { 10000: 0 };
    const investment = { 10000: { cap: 0 } };
    const { matched } = parse([row('1', '범용형 부린', { 9: '125' })]);
    applyToStores(matched, { progress, investment });
    assert.deepEqual(progress, { 10000: 0 }, 'input must be treated as immutable');
    assert.deepEqual(investment, { 10000: { cap: 0 } });
});

test('applyToStores keeps both stores sparse — no all-default records', () => {
    // The whole roster at defaults must write nothing; 881 zero-filled records
    // would otherwise ride localStorage and Drive sync for no information.
    const { matched } = parse([row('1', '범용형 부린'), row('659', '벨')]);
    const out = applyToStores(matched, {});
    assert.deepEqual(out.investment, {});
    assert.deepEqual(out.progress, {});
    assert.equal(out.changed, 0);
});

test('applyToStores clears a mask back to unowned when the sheet says 미획득', () => {
    const { matched } = parse([row('1', '범용형 부린', { 9: '미획득' })]);
    const out = applyToStores(matched, { progress: { 10000: 0b111 }, investment: { 10000: { cap: 5 } } });
    assert.equal(10000 in out.progress, false, 'a zero mask is omitted, matching collectProgressFromCards');
    assert.equal(10000 in out.investment, false);
    assert.equal(out.changed, 1);
});

test('applyToStores counts only rows that actually changed something', () => {
    const { matched } = parse([row('1', '범용형 부린', { 9: '125' }), row('659', '벨', { 9: '풀돌' })]);
    const fresh = applyToStores(matched, {});
    assert.equal(fresh.changed, 2);
    const again = applyToStores(matched, { progress: fresh.progress, investment: fresh.investment });
    assert.equal(again.changed, 0, 'a second identical import is a no-op');
});

test('applyToStores reports which gids moved, as strings for dataset comparison', () => {
    const { matched } = parse([row('1', '범용형 부린', { 9: '125' }), row('659', '벨')]);
    const out = applyToStores(matched, {});
    // 벨 stays at defaults, so only 범용형 부린 moved.
    assert.deepEqual(out.changedGids, ['10000']);
    assert.equal(typeof out.changedGids[0], 'string', 'card.dataset.shipId is a string');
    assert.equal(out.changed, out.changedGids.length);
});

test('re-importing an unchanged sheet reports nothing to re-render', () => {
    const { matched } = parse([row('1', '범용형 부린', { 9: '125' })]);
    const first = applyToStores(matched, {});
    const second = applyToStores(matched, { progress: first.progress, investment: first.investment });
    assert.deepEqual(second.changedGids, []);
});
