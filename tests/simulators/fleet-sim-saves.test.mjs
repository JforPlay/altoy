/**
 * fleet-sim-saves.test.mjs
 * Pure save-envelope helpers (public/js/simulators/fleet-sim.saves.js).
 * fleetSimSaves migrates from a bare array (legacy) to the syncedStorage
 * {v:1, d} envelope; these helpers are the parse/migrate contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_SAVE_SLOTS, SAVES_VERSION,
    parseSaves, migrateSaves, serializeFleet, deserializeFleet, clampLevel,
} from '../../public/js/simulators/fleet-sim.saves.js';

test('constants: cap 30, version 1', () => {
    assert.equal(MAX_SAVE_SLOTS, 30);
    assert.equal(SAVES_VERSION, 1);
});

test('parseSaves: null and malformed roots become []', () => {
    assert.deepEqual(parseSaves(null), []);
    assert.deepEqual(parseSaves('nope'), []);
    assert.deepEqual(parseSaves({ v: 1 }), []);
});

test('parseSaves: drops rows without a ships array, keeps valid rows', () => {
    const good = { name: 'a', timestamp: 1, ships: [null, null, null, null, null, null] };
    assert.deepEqual(parseSaves([good, { name: 'bad' }, null]), [good]);
});

test('migrateSaves: legacy (v0) bare array passes through', () => {
    const legacy = [{ name: 'old', timestamp: 1, ships: [] }];
    assert.deepEqual(migrateSaves(0, legacy), legacy);
    assert.deepEqual(migrateSaves(0, { not: 'array' }), []);
});

test('serializeFleet/deserializeFleet round-trip preserves slot configs', () => {
    const ships = [
        { gid: 20516, level: 125, affinity: 'love',
          equips: [{ id: 500, level: 13 }, null, null, null, null],
          spWeapon: { id: 10000, level: 10 }, retrofit: true },
        null, null, null, null, null,
    ];
    const round = deserializeFleet(serializeFleet(ships));
    assert.equal(round.length, 6);
    assert.equal(round[0].gid, 20516);
    assert.deepEqual(round[0].equips[0], { id: 500, level: 13 });
    assert.deepEqual(round[0].spWeapon, { id: 10000, level: 10 });
    assert.equal(round[0].retrofit, true);
});

test('deserializeFleet: clamps levels and pads to exactly 6 slots', () => {
    const out = deserializeFleet([{ gid: 1, level: 999, equips: [{ id: 2, level: 99 }] }]);
    assert.equal(out.length, 6);
    assert.equal(out[0].level, 125);
    assert.equal(out[0].equips[0].level, 13);
});

test('clampLevel: parses, clamps, falls back', () => {
    assert.equal(clampLevel('7', 1, 125), 7);
    assert.equal(clampLevel(999, 1, 125), 125);
    assert.equal(clampLevel('x', 0, 13, 0), 0);
});
