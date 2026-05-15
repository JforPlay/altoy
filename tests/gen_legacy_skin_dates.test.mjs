import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSkinIds, snapToThursday, classify } from '../scripts/gen_legacy_skin_dates.mjs';

test('extractSkinIds: clean pg.ship_skin_template literal', () => {
    const content = 'pg.ship_skin_template = {\n\t[100000] = {\n\t},\n\t[101021] = {\n}';
    assert.deepEqual([...extractSkinIds(content)].sort(), ['100000', '101021']);
});

test('extractSkinIds: Dimbreath slot-assignment format', () => {
    const content = 'slot1[100000] = {\n}\nslot1[10300051] = {\n}';
    assert.deepEqual([...extractSkinIds(content)].sort(), ['100000', '10300051']);
});

test('extractSkinIds: ignores short nested indices', () => {
    const content = '[100000] = {\n\t[1] = {0,0},\n\t[2] = {1,1},\n}';
    assert.deepEqual([...extractSkinIds(content)], ['100000']);
});

test('snapToThursday: Thursday commit is kept', () => {
    assert.equal(snapToThursday(new Date('2021-01-21T01:40:01Z')), '2021-01-21');
});

test('snapToThursday: Friday snaps back to Thursday', () => {
    assert.equal(snapToThursday(new Date('2020-05-15T05:00:00Z')), '2020-05-14');
});

test('snapToThursday: Saturday snaps back to Thursday', () => {
    assert.equal(snapToThursday(new Date('2020-05-16T05:00:00Z')), '2020-05-14');
});

test('snapToThursday: Sunday snaps back to Thursday', () => {
    assert.equal(snapToThursday(new Date('2020-05-17T05:00:00Z')), '2020-05-14');
});

test('snapToThursday: Wednesday is kept (off-schedule update)', () => {
    assert.equal(snapToThursday(new Date('2020-05-13T05:00:00Z')), '2020-05-13');
});

test('classify: present in Binary first commit → floor', () => {
    assert.equal(classify({ ymd: '2019-01-30', isFirstCommit: true }, null), '<2019-01-30');
});

test('classify: later Binary commit → exact', () => {
    assert.equal(classify({ ymd: '2019-05-09', isFirstCommit: false }, null), '2019-05-09');
});

test('classify: absent from Binary, Dimbreath first commit → range', () => {
    assert.equal(classify(null, { ymd: '2020-02-10', isFirstCommit: true }), '2019-11-01/2020-02-10');
});

test('classify: absent from Binary, later Dimbreath → exact', () => {
    assert.equal(classify(null, { ymd: '2020-08-13', isFirstCommit: false }), '2020-08-13');
});

test('classify: Binary takes precedence over Dimbreath', () => {
    assert.equal(
        classify({ ymd: '2019-05-09', isFirstCommit: false }, { ymd: '2020-08-13', isFirstCommit: false }),
        '2019-05-09');
});

test('classify: present in neither source → null', () => {
    assert.equal(classify(null, null), null);
});
