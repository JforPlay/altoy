import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReleaseDate, releaseSortKey, mergeReleaseDates } from '../public/js/skin/skin.dates.js';

test('formatReleaseDate: exact date passes through', () => {
    assert.equal(formatReleaseDate('2020-05-14'), '2020-05-14');
});

test('formatReleaseDate: floor value renders "이전"', () => {
    assert.equal(formatReleaseDate('<2019-01-30'), '2019-01-30 이전');
});

test('formatReleaseDate: range value renders month span', () => {
    assert.equal(formatReleaseDate('2019-11-01/2020-02-10'), '2019-11 ~ 2020-02');
});

test('formatReleaseDate: lua floor sentinel renders "이전"', () => {
    assert.equal(formatReleaseDate('2021-08-14'), '2021-08-14 이전');
});

test('formatReleaseDate: missing values return null', () => {
    assert.equal(formatReleaseDate(null), null);
    assert.equal(formatReleaseDate(undefined), null);
    assert.equal(formatReleaseDate(''), null);
});

test('releaseSortKey: exact date passes through', () => {
    assert.equal(releaseSortKey('2020-05-14'), '2020-05-14');
});

test('releaseSortKey: floor reduces to its bound date', () => {
    assert.equal(releaseSortKey('<2019-01-30'), '2019-01-30');
});

test('releaseSortKey: range reduces to its lower bound', () => {
    assert.equal(releaseSortKey('2019-11-01/2020-02-10'), '2019-11-01');
});

test('releaseSortKey: lua sentinel passes through', () => {
    assert.equal(releaseSortKey('2021-08-14'), '2021-08-14');
});

test('releaseSortKey: missing value returns empty string', () => {
    assert.equal(releaseSortKey(null), '');
    assert.equal(releaseSortKey(undefined), '');
    assert.equal(releaseSortKey(''), '');
});

test('mergeReleaseDates: legacy fills only floored skins', () => {
    const lua = { '1': '2022-03-01', '2': '2021-08-14', '3': '2021-08-14' };
    const legacy = { '2': '<2019-01-30' };
    assert.deepEqual(mergeReleaseDates(lua, legacy), {
        '1': '2022-03-01',   // precisely dated by lua — untouched
        '2': '<2019-01-30',  // floored + legacy has it — legacy wins
        '3': '2021-08-14',   // floored but legacy lacks it — sentinel kept
    });
});

test('mergeReleaseDates: drops the _meta key', () => {
    const lua = { '1': '2022-03-01', '_meta': { version: 1 } };
    const legacy = { '_meta': { version: 0 } };
    assert.deepEqual(mergeReleaseDates(lua, legacy), { '1': '2022-03-01' });
});

test('mergeReleaseDates: legacy never overrides a precise lua date', () => {
    const lua = { '1': '2022-03-01' };
    const legacy = { '1': '<2019-01-30' };
    assert.deepEqual(mergeReleaseDates(lua, legacy), { '1': '2022-03-01' });
});

test('mergeReleaseDates: null/empty legacy degrades to lua alone', () => {
    const lua = { '1': '2021-08-14' };
    assert.deepEqual(mergeReleaseDates(lua, null), { '1': '2021-08-14' });
    assert.deepEqual(mergeReleaseDates(lua, {}), { '1': '2021-08-14' });
});
