/**
 * stats-retrofit.test.mjs
 * Guards the two data contracts the shipgirl-stats 개조 toggle and PR/DR chips
 * rest on. Both read committed data (ship_info_data.json / fleet_tech_goal.json),
 * never a data:split artifact.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
    RETROFIT_RARITY,
    statTableKey,
    computeShipStats,
} from '../../public/js/shipgirl/shipgirl-stats.data.js';
import { normalizeRomanNumerals, RARITY_ORDER } from '../../public/js/utils.js';

const read = (rel) =>
    JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8'));

const ships = read('../../public/data/ship_info_data.json');
const goals = read('../../public/data/shipgirl/fleet_tech_goal.json');
const retrofitShips = ships.filter(s => s.retrofit);

test('roster fixtures are non-trivial', () => {
    assert.ok(ships.length > 800, `only ${ships.length} ships`);
    assert.ok(retrofitShips.length > 50, `only ${retrofitShips.length} retrofit ships`);
});

test('every retrofit rarity bump lands on a real tier', () => {
    for (const ship of retrofitShips) {
        const bumped = RETROFIT_RARITY[ship.rarity];
        assert.ok(bumped, `${ship.name}: no bump for rarity ${ship.rarity}`);
        assert.ok(bumped in RARITY_ORDER, `${ship.name}: bumped to unknown tier ${bumped}`);
        // The game's rule is +1 tier; RARITY_ORDER counts DOWN from UR: 0.
        assert.equal(
            RARITY_ORDER[bumped], RARITY_ORDER[ship.rarity] - 1,
            `${ship.name}: ${ship.rarity} → ${bumped} is not one tier up`,
        );
    }
});

test('no UR ship has a retrofit, so the bump never overflows', () => {
    assert.equal(retrofitShips.filter(s => s.rarity === 'UR').length, 0);
});

test('statTableKey resolves a real table for every ship, both toggle states', () => {
    for (const ship of ships) {
        for (const useRetrofit of [false, true]) {
            const key = statTableKey(ship, useRetrofit);
            assert.ok(ship.base[key],  `${ship.name}: base[${key}] missing (retrofit=${useRetrofit})`);
            assert.ok(ship.growth[key], `${ship.name}: growth[${key}] missing (retrofit=${useRetrofit})`);
        }
    }
});

test('statTableKey picks the 改 table by retrofit.id, not by key position', () => {
    // 카스미's 改 table sorts FIRST and 안샨's is the second-to-last of six —
    // an index rule reads the wrong row on both.
    const positional = ships.filter(s => {
        if (!s.retrofit) return false;
        const keys = Object.keys(s.base);
        return String(s.retrofit.id) !== keys[keys.length - 1];
    });
    assert.ok(positional.length > 0, 'fixture no longer covers the positional trap');

    for (const ship of positional) {
        assert.equal(statTableKey(ship, true), String(ship.retrofit.id), ship.name);
        assert.notEqual(statTableKey(ship, false), String(ship.retrofit.id), ship.name);
    }
});

test('a ship without a retrofit never moves with the toggle', () => {
    for (const ship of ships.filter(s => !s.retrofit)) {
        assert.deepEqual(
            computeShipStats(ship, true), computeShipStats(ship, false),
            `${ship.name} moved without a retrofit`,
        );
    }
});

test('the 개조 bonus is applied on top of the 改 table', () => {
    // Only asserted where the 改 table matches MLB (102 of 108). The other six
    // swap hulls outright and a stat may legitimately DROP: 모가미 경순→중순 trades
    // 장전 69/482 for 66/462, which her +5 bonus does not recover.
    const sameTable = ships.filter(
        s => s.retrofit
            && JSON.stringify(s.base[statTableKey(s, true)])
               === JSON.stringify(s.base[statTableKey(s, false)]),
    );
    assert.ok(sameTable.length > 90, `only ${sameTable.length} bonus-only retrofits`);

    for (const ship of sameTable) {
        const off = computeShipStats(ship, false);
        const on  = computeShipStats(ship, true);
        for (const [stat, value] of Object.entries(ship.retrofit.bonus || {})) {
            if (!(stat in off) || typeof value !== 'number' || value <= 0) continue;
            assert.ok(on[stat] > off[stat], `${ship.name}: ${stat} did not gain the 개조 bonus`);
        }
    }
});

test('the six hull-swap retrofits actually read a different 改 table', () => {
    const swapped = ships.filter(
        s => s.retrofit
            && JSON.stringify(s.base[statTableKey(s, true)])
               !== JSON.stringify(s.base[statTableKey(s, false)]),
    );
    assert.ok(swapped.length > 0, 'fixture no longer covers the hull-swap case');
    for (const ship of swapped) {
        assert.notDeepEqual(
            computeShipStats(ship, true), computeShipStats(ship, false), ship.name,
        );
    }
});

test('9 retrofits change 함종 and retrofit.type is always present', () => {
    const changed = retrofitShips.filter(s => s.retrofit.type && s.retrofit.type !== s.type);
    assert.equal(changed.length, 9, changed.map(s => s.name).join(', '));
    for (const ship of retrofitShips) {
        assert.equal(typeof ship.retrofit.type, 'number', `${ship.name}: no retrofit.type`);
    }
});

test('equipment_proficiency bonus keys never leak into the stat block', () => {
    const withProficiency = retrofitShips.filter(
        s => Object.keys(s.retrofit.bonus || {}).some(k => k.startsWith('equipment_proficiency')),
    );
    assert.ok(withProficiency.length > 0, 'fixture no longer covers proficiency bonuses');
    for (const ship of withProficiency) {
        const stats = computeShipStats(ship, true);
        for (const key of Object.keys(stats)) {
            assert.ok(!key.startsWith('equipment_proficiency'), `${ship.name}: ${key} leaked`);
        }
    }
});

test('the research roster joins by name with nothing unmatched', () => {
    const key = (name) => normalizeRomanNumerals(String(name)).replace(/\s+/g, '');
    const byKey = new Map(ships.map(s => [key(s.name), s]));

    const names = Object.keys(goals);
    assert.ok(names.length > 40, `only ${names.length} research goals`);

    const unmatched = names.filter(n => !byKey.has(key(n)));
    assert.deepEqual(unmatched, [], 'research names with no ship');
});

test('PR is SSR and DR is UR, and no research ship is retrofittable', () => {
    const key = (name) => normalizeRomanNumerals(String(name)).replace(/\s+/g, '');
    const byKey = new Map(ships.map(s => [key(s.name), s]));
    const expected = { PR: 'SSR', DR: 'UR' };

    for (const [name, goal] of Object.entries(goals)) {
        const ship = byKey.get(key(name));
        assert.equal(ship.rarity, expected[goal.rarity_type], `${name} (${goal.rarity_type})`);
        // The two features never interact — the 개조 toggle cannot move a PR/DR row.
        assert.equal(ship.retrofit, undefined, `${name} is both research and retrofittable`);
    }
});
