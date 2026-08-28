/**
 * fleet-sim-saves.test.mjs
 * Pure save-envelope helpers (public/js/simulators/fleet-sim.saves.js).
 * fleetSimSaves migrates from a bare array (legacy) to the syncedStorage
 * {v:1, d} envelope; these helpers are the parse/migrate contract.
 *
 * The same module owns the ?fleet= share codec. Its two load-bearing claims:
 * a single fleet still emits the legacy {s} payload so links in the wild keep
 * working, and an absent sp field stays distinguishable from an explicit null
 * (fill the 전용 back in vs. leave it removed).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_SAVE_SLOTS, MAX_FLEETS, SAVES_VERSION,
    parseSaves, migrateSaves, serializeFleet, deserializeFleet, clampLevel,
    encodeFleetConfig, decodeFleetConfig,
} from '../../public/js/simulators/fleet-sim.saves.js';

test('constants: cap 30 saves, 4 fleets, version 1', () => {
    assert.equal(MAX_SAVE_SLOTS, 30);
    assert.equal(MAX_FLEETS, 4);
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

test('deserializeFleet: non-numeric ids are dropped, not passed through', () => {
    const out = deserializeFleet([
        { gid: '__proto__', level: 100, equips: [] },
        { gid: 20516, level: 100, equips: [{ id: 'x', level: 3 }, { id: 500, level: 3 }], spWeapon: { id: {}, level: 5 } },
    ]);
    assert.equal(out[0], null);
    assert.equal(out[1].gid, 20516);
    assert.equal(out[1].equips[0], null);
    assert.deepEqual(out[1].equips[1], { id: 500, level: 3 });
    assert.equal(out[1].spWeapon, null);
});

// ===== 전용 특수 장비: absent vs. deliberately emptied =====

test('serializeFleet always writes spWeapon, null included', () => {
    const [slot] = serializeFleet([{ gid: 1, level: 1, affinity: 'love', equips: [], spWeapon: null }]);
    assert.equal('spWeapon' in slot, true);
    assert.equal(slot.spWeapon, null);
});

test('deserializeFleet: explicit null stays null, an absent field stays undefined', () => {
    // undefined is the signal main.js's _fillDedicatedSP acts on. Collapsing the
    // two resurrects a 전용 장비 the user removed.
    const [emptied, legacy] = deserializeFleet([
        { gid: 1, level: 1, equips: [], spWeapon: null },
        { gid: 2, level: 1, equips: [] },
    ]);
    assert.equal(emptied.spWeapon, null);
    assert.equal(legacy.spWeapon, undefined);
});

// ===== ?fleet= share codec =====

const shipAt = (gid) => ({
    gid, level: 120, affinity: 'oath',
    equips: [{ id: 500, level: 10 }, null, null, null, null],
    spWeapon: { id: 10000, level: 8 }, retrofit: true,
});
const fleetOf = (gid) => [shipAt(gid), null, null, null, null, null];
const payloadOf = (encoded) => JSON.parse(decodeURIComponent(escape(atob(encoded))));

test('encode/decode round-trips a single fleet, and keeps the legacy {s} shape', () => {
    const state = { fleets: [fleetOf(20516)], activeFleet: 0, damageTarget: null };
    const encoded = encodeFleetConfig(state);
    // Existing links in the wild are {s}; single-fleet links must not grow an
    // {f} wrapper (older builds would decode nothing).
    assert.deepEqual(Object.keys(payloadOf(encoded)), ['s']);

    const out = decodeFleetConfig(encoded);
    assert.equal(out.fleets.length, 1);
    assert.equal(out.activeFleet, 0);
    assert.deepEqual(out.fleets[0][0], shipAt(20516));
});

test('encode/decode round-trips 4 fleets and the active index', () => {
    const state = {
        fleets: [fleetOf(1), fleetOf(2), fleetOf(3), fleetOf(4)],
        activeFleet: 2,
        damageTarget: null,
    };
    const out = decodeFleetConfig(encodeFleetConfig(state));
    assert.equal(out.fleets.length, 4);
    assert.equal(out.activeFleet, 2);
    assert.deepEqual(out.fleets.map(f => f[0].gid), [1, 2, 3, 4]);
});

test('a pre-multi-fleet {s} link decodes to one fleet', () => {
    const legacy = btoa(unescape(encodeURIComponent(JSON.stringify({
        s: [{ g: 20516, l: 100, a: 'love', e: [[500, 3]] }, null],
    }))));
    const out = decodeFleetConfig(legacy);
    assert.equal(out.fleets.length, 1);
    assert.equal(out.fleets[0].length, 6);
    assert.equal(out.fleets[0][0].gid, 20516);
    // No sp field at all: undefined, so main.js fills the 전용 back in.
    assert.equal(out.fleets[0][0].spWeapon, undefined);
});

test('an explicit sp null in a link survives decoding', () => {
    const encoded = encodeFleetConfig({
        fleets: [[{ gid: 7, level: 1, affinity: 'love', equips: [], spWeapon: null }, null]],
        activeFleet: 0,
    });
    assert.equal(decodeFleetConfig(encoded).fleets[0][0].spWeapon, null);
});

test('decode caps the fleet count at MAX_FLEETS', () => {
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify({
        f: [1, 2, 3, 4, 5].map(g => [{ g, l: 1, a: 'love', e: [] }]),
        af: 4,
    }))));
    const out = decodeFleetConfig(encoded);
    assert.equal(out.fleets.length, MAX_FLEETS);
    // af pointed at the dropped 5th fleet — it must land on a real one.
    assert.equal(out.activeFleet, 0);
});

test('decode degrades a poisoned payload to clamped empties instead of throwing', () => {
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify({
        s: [
            { g: '__proto__', l: 5, e: [] },
            { g: 20516, l: 9999, a: 'love', e: [[500, 99], ['x', 1]], sp: ['x', 5] },
            1, 2, 3, 4, 5, 6, 7,
        ],
    }))));
    const out = decodeFleetConfig(encoded);
    assert.equal(out.fleets[0].length, 6);
    assert.equal(out.fleets[0][0], null);
    assert.equal(out.fleets[0][1].level, 125);
    assert.deepEqual(out.fleets[0][1].equips[0], { id: 500, level: 13 });
    assert.equal(out.fleets[0][1].equips[1], null);
    assert.equal(out.fleets[0][1].spWeapon, null);
    assert.equal(out.fleets[0][2], null);
});

test('decode returns null on unreadable input rather than throwing', () => {
    assert.equal(decodeFleetConfig('not base64 !!'), null);
    assert.equal(decodeFleetConfig(btoa('{"broken"')), null);
    assert.equal(decodeFleetConfig(btoa('"a string"')), null);
});

test('decode clamps sp level through the supplied per-weapon max', () => {
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify({
        s: [{ g: 1, l: 1, a: 'love', e: [], sp: [9000, 10] }],
    }))));
    assert.equal(decodeFleetConfig(encoded).fleets[0][0].spWeapon.level, 10);
    // 슈퍼 레인보우 망치 1호 has a single level; the URL must not claim +10.
    assert.equal(decodeFleetConfig(encoded, () => 0).fleets[0][0].spWeapon.level, 0);
});

test('the damage target round-trips, with untrusted overrides coerced', () => {
    const encoded = encodeFleetConfig({
        fleets: [fleetOf(1)],
        activeFleet: 0,
        damageTarget: {
            kind: 'meta', bossId: '970112', tier: 15,
            overrides: { armor: 5, evil: '<img onerror>' }, window: 120,
        },
    });
    const { target } = decodeFleetConfig(encoded);
    assert.equal(target.kind, 'meta');
    assert.equal(target.bossId, '970112');
    assert.equal(target.window, 120);
    assert.deepEqual(target.overrides, { armor: 5 });
});

test('preset difficulty round-trips; a payload older than the field reads 하드', () => {
    const encoded = encodeFleetConfig({
        fleets: [[]],
        damageTarget: { kind: 'preset', presetKey: 'medium', adapt: 'full', difficulty: 'normal' },
    });
    assert.equal(decodeFleetConfig(encoded).target.difficulty, 'normal');

    // Every link shared before the toggle existed meant the hardcoded stats,
    // which were 하드 for two of the three presets.
    const legacy = btoa(JSON.stringify({ s: [], t: { k: 'preset', p: 'medium', ad: 'base' } }));
    assert.equal(decodeFleetConfig(legacy).target.difficulty, 'hard');
    // Untrusted input: anything that is not 'normal' is 하드, never undefined.
    const junk = btoa(JSON.stringify({ s: [], t: { k: 'preset', p: 'medium', df: { x: 1 } } }));
    assert.equal(decodeFleetConfig(junk).target.difficulty, 'hard');
});
