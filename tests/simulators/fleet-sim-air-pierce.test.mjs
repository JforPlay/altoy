// tests/simulators/fleet-sim-air-pierce.test.mjs
//
// 항공 저항 관통 is keyed on the HULL, never on the weapon attribute. The Lua gates it on
// `airResistPierceActive`, which only Cloak() raises (battleattr.lua:166), and the cloak
// component is attached to ShipType.CloakShipTypeList alone (battlefleetvo.lua:685). An
// 항공전함 carries aircraft and is NOT on that list, so an attribute-keyed rule would
// silently over-report every one of them — which is exactly what this pins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLOAK_HULL_TYPES } from '../../public/js/simulators/fleet-sim.damage.js';

const roster = JSON.parse(readFileSync(new URL('../../public/data/ship_info_data.json', import.meta.url), 'utf8'));
const ships = Array.isArray(roster) ? roster : Object.values(roster);
const typesOf = (t) => ships.filter((s) => s.type === t);

test('the hull set is ShipType.CloakShipTypeList verbatim', () => {
    // shiptype.lua:248 — QingHang 6 (경항모), ZhengHang 7 (정규항모), DaoQuM 21 (미구-후열).
    assert.deepEqual([...CLOAK_HULL_TYPES].sort((a, b) => a - b), [6, 7, 21]);
});

test('the gate separates carriers from 항공전함, and is not vacuous', () => {
    // Both sides must exist in the committed roster or the distinction proves nothing.
    assert.ok(typesOf(6).length > 0, '경항모 present');
    assert.ok(typesOf(7).length > 0, '정규항모 present');
    const bbv = typesOf(10);
    assert.ok(bbv.length > 0, '항공전함 present — the hull an attribute-keyed rule would wrongly include');
    for (const s of bbv) assert.equal(CLOAK_HULL_TYPES.has(s.type), false, `${s.name} must not pierce`);
});

test('both carriers in the reference fleet are cloak hulls', () => {
    // 아드미랄 나히모프 / 프리츠 루메이 — the 소류·META run this lane was measured against.
    for (const gid of [79902, 40704]) {
        const s = ships.find((x) => x.gid === gid);
        assert.ok(s, `gid ${gid} in roster`);
        assert.ok(CLOAK_HULL_TYPES.has(s.type), `${s.name} (type ${s.type}) is a cloak hull`);
    }
});

// Type 21 ships a ZERO roster count on purpose: the 미구-후열 form is not reachable from a
// ship record (statTableKey always resolves 전열), so the entry mirrors the Lua list and is
// inert today. Asserted so a future pipeline that starts emitting it is a visible change.
test('미구-후열 is carried but unreachable from the roster today', () => {
    assert.equal(typesOf(21).length, 0);
});
