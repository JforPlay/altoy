/**
 * pickVitalStats decides what the always-on card strip shows. The load-bearing
 * claim is that it is an explicit offensive subset, NOT "first N non-zero" —
 * DISPLAY_STATS leads with 내구, which would otherwise take a slot on every card.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickVitalStats } from '../../public/js/simulators/fleet-sim.calc.js';

/** Only the keys pickVitalStats reads; real calcResult.stats carries more. */
const stats = (over) => ({
    health: 5820, firepower: 0, aviation: 0, torpedo: 0,
    antiair: 0, evasion: 0, accuracy: 0, reload: 0, ...over,
});

test('battleship: 포격 + 대공 + 장전, no 항공/뇌장', () => {
    const out = pickVitalStats(stats({ firepower: 412, antiair: 96, reload: 148 }));
    assert.deepEqual(out.map((v) => v.key), ['firepower', 'antiair', 'reload']);
    assert.deepEqual(out.map((v) => v.label), ['포격', '대공', '장전']);
});

test('carrier: 항공 leads, 포격 absent', () => {
    const out = pickVitalStats(stats({ aviation: 388, antiair: 210, reload: 152 }));
    assert.deepEqual(out.map((v) => v.key), ['aviation', 'antiair', 'reload']);
});

test('destroyer: four entries, capped at max', () => {
    const out = pickVitalStats(stats({ firepower: 96, torpedo: 402, antiair: 145, reload: 189 }));
    assert.equal(out.length, 4);
    assert.deepEqual(out.map((v) => v.key), ['firepower', 'torpedo', 'antiair', 'reload']);
});

test('all five vitals survive the default cap, 장전 included', () => {
    const out = pickVitalStats(stats({
        firepower: 96, aviation: 40, torpedo: 402, antiair: 145, reload: 189,
    }));
    assert.equal(out.length, 5);
    // reload is last in VITAL_STATS, so a cap below 5 drops 장전 specifically —
    // the number this page exists to help you read.
    assert.ok(out.some((v) => v.key === 'reload'));
});

test('내구 never appears, however large', () => {
    const out = pickVitalStats(stats({ health: 99999, firepower: 412 }));
    assert.ok(!out.some((v) => v.key === 'health'));
    assert.deepEqual(out.map((v) => v.key), ['firepower']);
});

test('기동/명중 are excluded even when non-zero', () => {
    const out = pickVitalStats(stats({ firepower: 412, evasion: 88, accuracy: 77 }));
    assert.deepEqual(out.map((v) => v.key), ['firepower']);
});

test('max is respected', () => {
    const out = pickVitalStats(
        stats({ firepower: 1, aviation: 2, torpedo: 3, antiair: 4, reload: 5 }), 2);
    assert.equal(out.length, 2);
});

test('values are floored integers', () => {
    const [v] = pickVitalStats(stats({ firepower: 412.87 }));
    assert.equal(v.value, 412);
});

test('empty and null inputs yield an empty list, not a crash', () => {
    assert.deepEqual(pickVitalStats(stats({})), []);
    assert.deepEqual(pickVitalStats(null), []);
    assert.deepEqual(pickVitalStats(undefined), []);
});
