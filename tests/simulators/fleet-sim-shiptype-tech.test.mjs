/**
 * 함종 기술 — the second fleet-tech system, which the sim ignored entirely.
 *
 * Unlike 진영 기술 (point thresholds → a level's `add` table) this one is a flat
 * sum: every ship grants a stat to a hull type on 획득 and again on Lv120. It is
 * worth enough to move every reload readout — 항모 tops out at +30 장전, 경항모
 * at +34 — which is why a carrier's air CD read long before it was applied.
 *
 * Reads only committed data (never a data:split artifact).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    TECH_STAT_BY_ATTR_ID, shipTypeTechCaps, shipTypeTechFromProgress,
    parseTechOverride, effectiveShipTypeTech,
} from '../../public/js/simulators/fleet-sim.tech.js';

const GROUPS = JSON.parse(
    readFileSync(new URL('../../public/data/ship_group_data.json', import.meta.url), 'utf8'));

// A ship that grants both clauses, so the get/level split is actually exercised.
const [SAMPLE_GID, SAMPLE] = Object.entries(GROUPS)
    .find(([, g]) => g.add_get_attr && g.add_level_attr
        && g.add_get_attr !== g.add_level_attr && g.add_get_shiptype?.length);

test('획득 and Lv120 are separate clauses keyed off separate progress bits', () => {
    const type = SAMPLE.add_get_shiptype[0];
    const getStat = TECH_STAT_BY_ATTR_ID[SAMPLE.add_get_attr];
    const levelStat = TECH_STAT_BY_ATTR_ID[SAMPLE.add_level_attr];

    const owned = shipTypeTechFromProgress(GROUPS, { [SAMPLE_GID]: 1 });         // 보유
    assert.equal(owned[type][getStat], SAMPLE.add_get_value);
    assert.equal(owned[type][levelStat], undefined, 'Lv120 clause must not fire on 보유 alone');

    // 풀돌 (bit 4) is worth tech POINTS only — no stat clause hangs off it, so it
    // must not change the table.
    assert.deepEqual(shipTypeTechFromProgress(GROUPS, { [SAMPLE_GID]: 1 | 4 }), owned);

    const maxed = shipTypeTechFromProgress(GROUPS, { [SAMPLE_GID]: 1 | 2 | 4 });  // Lv120
    assert.equal(maxed[type][levelStat], SAMPLE.add_level_value);
});

test('the caps are the whole roster obtained AND Lv120', () => {
    const caps = shipTypeTechCaps(GROUPS);
    const everything = Object.fromEntries(Object.keys(GROUPS).map((gid) => [gid, 1 | 2 | 4]));
    assert.deepEqual(shipTypeTechFromProgress(GROUPS, everything), caps);
});

test('항모/경항모 carry the 장전 the air CD was missing', () => {
    const caps = shipTypeTechCaps(GROUPS);
    // Guards the wiring, not the exact figure: if these ever read 0 the fold has
    // stopped seeing add_*_attr 6 and every carrier CD silently gets long again.
    assert.ok(caps[7].reload > 20, `항모 장전 cap ${caps[7]?.reload}`);
    assert.ok(caps[6].reload > 20, `경항모 장전 cap ${caps[6]?.reload}`);
    assert.ok(caps[10].reload > 0, `항전 장전 cap ${caps[10]?.reload}`);
});

test('an override replaces only its own cell and cannot exceed the cap', () => {
    const caps = { 7: { reload: 30, aviation: 60 } };
    const derived = { 7: { reload: 12, aviation: 25 } };

    const one = effectiveShipTypeTech(derived, { 7: { reload: 30 } }, caps);
    assert.equal(one[7].reload, 30, 'the edited cell wins');
    assert.equal(one[7].aviation, 25, 'its neighbour stays tracker-derived');

    const over = effectiveShipTypeTech(derived, { 7: { reload: 999 } }, caps);
    assert.equal(over[7].reload, 30, 'clamped to the roster ceiling');
});

test('an override for a type the tracker knows nothing about still applies', () => {
    // The whole point of the manual path: a visitor who never used the tracker.
    const out = effectiveShipTypeTech({}, { 7: { reload: 30 } }, { 7: { reload: 30 } });
    assert.equal(out[7].reload, 30);
});

test('parseTechOverride never throws and drops anything unusable', () => {
    assert.deepEqual(parseTechOverride(null), {});
    assert.deepEqual(parseTechOverride([1, 2]), {});
    assert.deepEqual(parseTechOverride({ 7: { reload: '12.6', bogus: 5 }, x: { reload: 1 }, 8: 3 }),
        { 7: { reload: 13 } });
    assert.deepEqual(parseTechOverride({ 7: { reload: -5 } }), {});
});
