/**
 * Tests for the pure core of scripts/sync-skin-labels.mjs.
 * No network — main() is CLI-guarded and never runs on import.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const POLL = {
    1: {
        '클뜯 id': 100002,
        '함순이 이름': '범용형 부린',
        '한글 함순이 + 스킨 이름': '변신! 마법소녀 ★ 부린!',
        '깔끔한 일러': 'https://example.test/skin_shipyard/100002.webp',
        '전체 일러': 'https://example.test/output_expressions/100002/painting.png',
        '스킨 태그': '배경',
        '스킨 타입 - 한글': '동화 속 세계',
    },
    0: {
        '클뜯 id': 100000,
        '함순이 이름': '범용형 부린',
        '한글 함순이 + 스킨 이름': '범용형 부린',
        '깔끔한 일러': 'https://example.test/skin_shipyard/100000.webp',
        '스킨 태그': 'X',
        '스킨 타입 - 한글': null,
    },
};

import { mapRows, validateRows } from '../../scripts/sync-skin-labels.mjs';
import { parseCsv } from '../../scripts/csv.mjs';

const HEADER = '클뜯 id,이름,아이웨어,자세,방향,강조부위,머리색,머리 다중색,눈색,수인특징,검수';
const sheet = (...rows) => parseCsv([HEADER, ...rows].join('\n') + '\n');

// --- mapRows ---

test('mapRows reads columns by header name and returns raw strings', () => {
    const [row] = mapRows(sheet('100002,부린,안경,서기,정면,없음,분홍,그라데이션,청색,동물귀,TRUE'));
    assert.equal(row.skinId, '100002');
    assert.equal(row.raw.eyewear, '안경');
    assert.equal(row.raw.beastFeatures, '동물귀');
    assert.equal(row.checked, true);
});

test('mapRows tolerates reordered and extra display columns', () => {
    const rows = parseCsv('아이콘,자세,클뜯 id,메모,방향\nIMG,눕기,100002,note,후면\n');
    const [row] = mapRows(rows);
    assert.equal(row.skinId, '100002');
    assert.equal(row.raw.posture, '눕기');
    assert.equal(row.raw.facing, '후면');
    assert.equal(row.raw.eyewear, '');
});

test('mapRows extracts the leading digits of an "id — name" composite cell', () => {
    const [row] = mapRows(sheet('100002 — 마법소녀 부린,부린,안경,,,,,,,,'));
    assert.equal(row.skinId, '100002');
});

test('mapRows reads a checkbox as TRUE/FALSE case-insensitively', () => {
    // Each row carries one attribute value so the drop-empty-rows filter keeps it.
    assert.equal(mapRows(sheet('1,a,안경,,,,,,,,true'))[0].checked, true);
    assert.equal(mapRows(sheet('1,a,안경,,,,,,,,FALSE'))[0].checked, false);
    assert.equal(mapRows(sheet('1,a,안경,,,,,,,,'))[0].checked, false);
});

test('mapRows drops a row with no id', () => {
    assert.equal(mapRows(sheet(',,,,,,,,,,')).length, 0);
});

test('mapRows drops a prefilled row that carries no information', () => {
    // No attribute values and not checked — nothing to record, keeps output sparse.
    assert.equal(mapRows(sheet('100002,부린,,,,,,,,,FALSE')).length, 0);
});

test('mapRows keeps a checked row even when every attribute is blank', () => {
    // "a human looked and could not determine anything" is real information.
    assert.equal(mapRows(sheet('100002,부린,,,,,,,,,TRUE')).length, 1);
});

test('mapRows throws when a required header is missing', () => {
    assert.throws(() => mapRows(parseCsv('이름,자세\nA,서기\n')), /클뜯 id/);
});

test('mapRows throws on an empty sheet', () => {
    assert.throws(() => mapRows([]), /empty/);
});

// --- validateRows ---

const IDS = new Set(['100002', '100012']);

test('validateRows parses cells into typed values', () => {
    const rows = mapRows(sheet('100002,부린,안경,서기,정면,없음,분홍,그라데이션,청색,"동물귀, 꼬리",TRUE'));
    const { errors, entries } = validateRows(rows, IDS);
    assert.deepEqual(errors, []);
    assert.deepEqual(entries['100002'], {
        eyewear: '안경', posture: '서기', facing: '정면', emphasis: '없음',
        hairColor: '분홍', hairMultiTone: '그라데이션', eyeColor: '청색',
        beastFeatures: ['동물귀', '꼬리'], checked: true,
    });
});

test('validateRows reports the row and the offending value on a bad enum', () => {
    const rows = mapRows(sheet('100002,부린,,측면,,,,,,,'));
    const { errors } = validateRows(rows, IDS);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /100002/);
    assert.match(errors[0], /측면/);
});

test('validateRows rejects a duplicate id', () => {
    const rows = mapRows(sheet('100002,부린,안경,,,,,,,,', '100002,부린,고글,,,,,,,,'));
    assert.match(validateRows(rows, IDS).errors.join(), /duplicate/i);
});

test('validateRows rejects a non-numeric id', () => {
    const rows = mapRows(sheet('abc,부린,안경,,,,,,,,'));
    assert.match(validateRows(rows, IDS).errors.join(), /invalid/i);
});

test('validateRows rejects an id absent from the catalog, unless allowUnknown', () => {
    const rows = mapRows(sheet('999999,부린,안경,,,,,,,,'));
    assert.match(validateRows(rows, IDS).errors.join(), /999999/);
    assert.deepEqual(validateRows(rows, IDS, { allowUnknown: true }).errors, []);
});

import {
    buildLabelsJson, diffSummary, siblingConflicts, parseAutoCsv, mergeLayers, inheritSiblingTraits,
    buildWorklist, buildWorklistCsv, WORKLIST_FEED_HEADER,
} from '../../scripts/sync-skin-labels.mjs';

// --- parseAutoCsv / mergeLayers ---

const AUTO_CSV = '클뜯 id,아이웨어,자세,방향,강조부위,머리색,머리 다중색,눈색,수인특징\n'
    + '100002,없음,기타,정면,없음,분홍,단색,청색,없음\n';

test('parseAutoCsv reads the labeler CSV through the same validator as the sheet', () => {
    const { errors, entries } = parseAutoCsv(AUTO_CSV, IDS);
    assert.deepEqual(errors, []);
    assert.equal(entries['100002'].posture, '기타');
    assert.deepEqual(entries['100002'].beastFeatures, ['없음']);
});

test('parseAutoCsv treats a missing/empty file as no base layer', () => {
    assert.deepEqual(parseAutoCsv('', IDS), { errors: [], entries: {} });
});

test('parseAutoCsv rejects a model value outside the vocabulary', () => {
    const bad = '클뜯 id,자세\n100002,측면\n';
    assert.match(parseAutoCsv(bad, IDS).errors.join(), /측면/);
});

test('mergeLayers lets a human cell override one attribute and inherit the rest', () => {
    const auto = parseAutoCsv(AUTO_CSV, IDS).entries;
    const human = validateRows(mapRows(sheet('100002,부린,,서기,,,,,,,TRUE')), IDS).entries;
    const merged = mergeLayers(auto, human, IDS);
    assert.equal(merged['100002'].posture, '서기');   // human wins
    assert.equal(merged['100002'].hairColor, '분홍');  // blank cell falls through to the model
    assert.equal(merged['100002'].checked, true);
});

test('mergeLayers keeps a human row for a skin the labeler never covered', () => {
    const human = validateRows(mapRows(sheet('100012,부린,안경,,,,,,,,')), IDS).entries;
    const merged = mergeLayers({}, human, IDS);
    assert.equal(merged['100012'].eyewear, '안경');
    assert.equal(merged['100012'].posture, null);
});

test('mergeLayers drops ids no longer in the catalog and sorts numerically', () => {
    const merged = mergeLayers({ 100012: { posture: '서기' }, 999999: { posture: '눕기' } }, {}, IDS);
    assert.deepEqual(Object.keys(merged), ['100012']);
});

test('mergeLayers reports checked only from the human layer', () => {
    const merged = mergeLayers({ 100002: { posture: '서기', checked: true } }, {}, IDS);
    assert.equal(merged['100002'].checked, false);
});

// --- inheritSiblingTraits ---

const traitRow = (over) => ({
    hairColor: null, hairMultiTone: null, eyeColor: null, beastFeatures: null, ...over,
});

test('inheritSiblingTraits fills a null trait from unanimous siblings', () => {
    const entries = { 100000: traitRow({ hairColor: '분홍' }), 100002: traitRow({}) };
    assert.equal(inheritSiblingTraits(entries), 1);
    assert.equal(entries['100002'].hairColor, '분홍');
});

test('inheritSiblingTraits leaves the trait null when siblings disagree', () => {
    const entries = {
        100000: traitRow({ hairColor: '분홍' }),
        100002: traitRow({ hairColor: '금발' }),
        100004: traitRow({}),
    };
    assert.equal(inheritSiblingTraits(entries), 0);
    assert.equal(entries['100004'].hairColor, null);
});

test('inheritSiblingTraits never overwrites a value that is already there', () => {
    const entries = { 100000: traitRow({ hairColor: '분홍' }), 100002: traitRow({ hairColor: '분홍' }) };
    assert.equal(inheritSiblingTraits(entries), 0);
});

test('inheritSiblingTraits does not cross shipgirls', () => {
    const entries = { 100000: traitRow({ hairColor: '분홍' }), 100010: traitRow({}) };
    assert.equal(inheritSiblingTraits(entries), 0);
});

test('inheritSiblingTraits copies a multi-valued trait as its own array', () => {
    const entries = { 100000: traitRow({ beastFeatures: ['동물귀'] }), 100002: traitRow({}) };
    inheritSiblingTraits(entries);
    assert.deepEqual(entries['100002'].beastFeatures, ['동물귀']);
    entries['100002'].beastFeatures.push('꼬리');
    assert.deepEqual(entries['100000'].beastFeatures, ['동물귀']);
});

// --- buildWorklist ---

const full = (over) => ({
    eyewear: '없음', posture: '서기', facing: '정면', emphasis: '없음', hairColor: '분홍',
    hairMultiTone: '단색', eyeColor: '청색', beastFeatures: ['없음'], checked: false, ...over,
});

test('buildWorklist separates the three queues and dedupes the union', () => {
    const entries = {
        100000: full({ hairColor: '분홍' }),
        100002: full({ hairColor: '금발', posture: null }),  // conflicted AND incomplete
    };
    const work = buildWorklist(entries, new Set(['100000', '100002', '100004']), siblingConflicts(entries));
    assert.deepEqual(work.unlabelled, ['100004']);
    assert.deepEqual(work.incomplete, ['100002']);
    assert.deepEqual(work.conflicted, ['100000', '100002']);
    assert.deepEqual(work.all, ['100000', '100002', '100004']);
});

test('buildWorklist sorts numerically, not lexicographically', () => {
    const entries = { 9600081: full({}), 100000: full({}) };
    const work = buildWorklist(entries, new Set(['9600081', '100000']), []);
    assert.deepEqual(work.all, []);
    assert.deepEqual(buildWorklist({}, new Set(['9600081', '100000']), []).all, ['100000', '9600081']);
});

test('buildWorklist drops a checked entry from the blank and conflict queues', () => {
    // A human already looked — 검수 is the whole meaning of "done", even when a
    // blank or a genuine sibling difference remains.
    const entries = {
        100000: full({ hairColor: '분홍', posture: null, checked: true }),
        100002: full({ hairColor: '금발' }),
    };
    const work = buildWorklist(entries, new Set(['100000', '100002']), siblingConflicts(entries));
    assert.deepEqual(work.incomplete, []);
    assert.deepEqual(work.conflicted, ['100002']);
});

// --- buildWorklistCsv ---

const WORK_IDS = new Set(['100000', '100002']);

test('buildWorklistCsv emits the header contract mirrored by skin-label-sheet.gs', () => {
    const csv = buildWorklistCsv(buildWorklist({}, new Set(), []), {}, POLL);
    assert.equal(csv, WORKLIST_FEED_HEADER.join(',') + '\n');
    assert.equal(WORKLIST_FEED_HEADER.slice(0, 4).join(','), 'id,reason,name,image_url');
});

test('buildWorklistCsv joins name, wsrv-wrapped painting url and prefill values per id', () => {
    const entries = { 100002: full({ posture: null, beastFeatures: ['동물귀', '꼬리'] }) };
    const work = buildWorklist(entries, WORK_IDS, []);
    const [, unlabelledRow, incompleteRow] = buildWorklistCsv(work, entries, POLL).trimEnd().split('\n');

    // 100000: unlabelled — 신규, name/image from poll, every prefill blank.
    assert.ok(unlabelledRow.startsWith('100000,신규,범용형 부린,'));
    assert.ok(unlabelledRow.includes('https://wsrv.nl/?w=400&output=jpg&bg=white&url='
        + encodeURIComponent('https://example.test/skin_shipyard/100000.webp')));
    assert.ok(unlabelledRow.endsWith(',,,,,,,,'));

    // 100002: blank posture — 공란, painting preferred over the shipyard crop,
    // multi values comma-joined (and therefore quoted).
    assert.ok(incompleteRow.startsWith('100002,공란,'));
    assert.ok(incompleteRow.includes(encodeURIComponent('painting.png')));
    assert.ok(incompleteRow.includes('"동물귀, 꼬리"'));
});

test('buildWorklistCsv combines queue reasons with ·', () => {
    const entries = {
        100000: full({ hairColor: '분홍' }),
        100002: full({ hairColor: '금발', posture: null }), // incomplete AND conflicted
    };
    const work = buildWorklist(entries, WORK_IDS, siblingConflicts(entries));
    const rows = buildWorklistCsv(work, entries, POLL).trimEnd().split('\n');
    assert.ok(rows.some((r) => r.startsWith('100002,공란·충돌,')));
});

test('inheritSiblingTraits ignores skin-only attributes', () => {
    const entries = { 100000: traitRow({ posture: '서기' }), 100002: traitRow({ posture: null }) };
    inheritSiblingTraits(entries);
    assert.equal(entries['100002'].posture, null);
});

// --- buildLabelsJson ---

test('buildLabelsJson stamps counts and the sync date', () => {
    const out = buildLabelsJson({
        100002: { posture: '서기', checked: true },
        100012: { posture: '눕기', checked: false },
    }, '2026-07-26');
    assert.equal(out._meta.synced, '2026-07-26');
    assert.equal(out._meta.count, 2);
    assert.equal(out._meta.checked, 1);
    assert.equal(out.entries[100002].posture, '서기');
});

test('buildLabelsJson carries no model name — the sync never runs the model', () => {
    assert.ok(!('model' in buildLabelsJson({}, '2026-07-26')._meta));
});

// --- diffSummary ---

test('diffSummary counts added, changed and removed entries', () => {
    const prev = { 1: { posture: '서기' }, 2: { posture: '눕기' }, 3: { posture: '기타' } };
    const next = { 1: { posture: '서기' }, 2: { posture: '앉기·무릎꿇기' }, 4: { posture: '서기' } };
    assert.deepEqual(diffSummary(prev, next), { added: 1, changed: 1, removed: 1 });
});

test('diffSummary treats an empty previous file as all-added', () => {
    assert.deepEqual(diffSummary({}, { 1: { posture: '서기' } }), { added: 1, changed: 0, removed: 0 });
});

// --- siblingConflicts ---

test('siblingConflicts flags a character trait that disagrees across one shipgirl', () => {
    // 100000..100009 are all skins of gid 10000.
    const conflicts = siblingConflicts({
        100000: { hairColor: '분홍', eyeColor: '청색', beastFeatures: null, hairMultiTone: null },
        100002: { hairColor: '금발', eyeColor: '청색', beastFeatures: null, hairMultiTone: null },
    });
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].gid, 10000);
    assert.equal(conflicts[0].key, 'hairColor');
    assert.deepEqual(conflicts[0].byValue, { 분홍: ['100000'], 금발: ['100002'] });
});

test('siblingConflicts ignores nulls rather than treating them as disagreement', () => {
    assert.deepEqual(siblingConflicts({
        100000: { hairColor: '분홍', eyeColor: null, beastFeatures: null, hairMultiTone: null },
        100002: { hairColor: null, eyeColor: null, beastFeatures: null, hairMultiTone: null },
    }), []);
});

test('siblingConflicts compares multi-valued traits order-insensitively', () => {
    assert.deepEqual(siblingConflicts({
        100000: { beastFeatures: ['동물귀', '꼬리'], hairColor: null, eyeColor: null, hairMultiTone: null },
        100002: { beastFeatures: ['꼬리', '동물귀'], hairColor: null, eyeColor: null, hairMultiTone: null },
    }), []);
});

test('siblingConflicts does not compare across different shipgirls', () => {
    assert.deepEqual(siblingConflicts({
        100000: { hairColor: '분홍', eyeColor: null, beastFeatures: null, hairMultiTone: null },
        100010: { hairColor: '금발', eyeColor: null, beastFeatures: null, hairMultiTone: null },
    }), []);
});

test('siblingConflicts ignores skin-only attributes like posture', () => {
    assert.deepEqual(siblingConflicts({
        100000: { posture: '서기', hairColor: null, eyeColor: null, beastFeatures: null, hairMultiTone: null },
        100002: { posture: '눕기', hairColor: null, eyeColor: null, beastFeatures: null, hairMultiTone: null },
    }), []);
});
