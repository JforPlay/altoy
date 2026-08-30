// A maxed 전용 장비 REPLACES one of its ship's skills with an upgraded rung. The
// sim equips the dedicated weapon at max by default, so without this every such
// ship was simulated one rung low.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spSkillUpgradePairs, applySPSkillUpgrade } from '../../public/js/simulators/fleet-sim.damage.js';

const WEAPON = { id: 12345, levels: new Array(11).fill({ v1: 1, v2: 1 }), skill_upgrade: [[19300, 1019300]] };
const getById = (id) => (Number(id) === 12345 ? WEAPON : null);

test('the pair is granted only at MAX enhancement', () => {
    assert.deepEqual(spSkillUpgradePairs({ id: 12345, level: 10 }, getById), [[19300, 1019300]]);
    assert.deepEqual(spSkillUpgradePairs({ id: 12345, level: 9 }, getById), []);
    assert.deepEqual(spSkillUpgradePairs({ id: 12345, level: 0 }, getById), []);
});

test('no weapon, an unknown weapon, or one with no pair grants nothing', () => {
    assert.deepEqual(spSkillUpgradePairs(null, getById), []);
    assert.deepEqual(spSkillUpgradePairs({ id: 999, level: 10 }, getById), []);
    assert.deepEqual(spSkillUpgradePairs({ id: 12345, level: 10 }, () => ({ levels: [{}], skill_upgrade: [] })), []);
});

test('swaps a live id for its upgraded rung', () => {
    const out = applySPSkillUpgrade(['19300', '11000'], [[19300, 1019300]], () => true);
    assert.deepEqual(out, ['1019300', '11000']);
});

// THE POINT OF THE PER-TABLE RULE. 17 of the 230 pairs upgrade into a skill that
// has no record in the table being remapped — 드레이크's 1018300 단죄의 불꽃·改+
// is a flat internal cast with no weapon, so the barrage walk emits nothing for it.
// Swapping regardless would DELETE a modelled barrage; keeping the base rung lets
// the 미구현 note carry it instead.
test('keeps the base rung when the successor has no record in THIS table', () => {
    assert.deepEqual(applySPSkillUpgrade(['19300'], [[19300, 1018300]], () => false), ['19300']);
    const hasRecord = (id) => id === '1019300';
    assert.deepEqual(
        applySPSkillUpgrade(['19300', '18300'], [[19300, 1019300], [18300, 1018300]], hasRecord),
        ['1019300', '18300'],
    );
});

test('a zeroed source is skipped — that is the base record\'s useless copy', () => {
    assert.deepEqual(applySPSkillUpgrade(['19300'], [[0, 1019300]], () => true), ['19300']);
});

test('no pairs returns the input array untouched', () => {
    const ids = ['19300'];
    assert.equal(applySPSkillUpgrade(ids, [], () => true), ids);
    assert.equal(applySPSkillUpgrade(ids, null, () => true), ids);
});

// The whole remap rests on the shipped pairs naming a REAL source. The base record
// states the same upgrade with its source zeroed, so a pipeline regression that
// reverts to reading `base.skill_upgrade` shows up here rather than as ~38 ships
// silently losing their upgraded barrage.
test('every shipped skill_upgrade pair names a source', async () => {
    const url = new URL('../../public/data/sim/spweapon_data.json', import.meta.url);
    const { weapons } = JSON.parse(await readFile(url, 'utf8'));
    const pairs = Object.values(weapons).flatMap((w) => w.skill_upgrade || []);
    assert.ok(pairs.length > 200, `expected the full roster of pairs, got ${pairs.length}`);
    assert.deepEqual(pairs.filter((p) => !p[0]), []);
});
