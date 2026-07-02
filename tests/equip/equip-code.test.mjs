/**
 * equip-code.test.mjs
 * Game-compatible 장비 코드 codec (public/js/equip/equip-code.js).
 * Fixtures come from COMMITTED data files only (CI runs tests before build).
 * Format spec: dev/active/2026-06-30-fleet-sim-enhancements-design.md F3-UPDATE.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildTierMaps, encodeEquipCode, decodeEquipCode } from '../../public/js/equip/equip-code.js';

const here = dirname(fileURLToPath(import.meta.url));
const equipFull = JSON.parse(
    readFileSync(join(here, '../../public/data/equip/equip_data_full.json'), 'utf8')
);
const spData = JSON.parse(
    readFileSync(join(here, '../../public/data/sim/spweapon_data.json'), 'utf8')
);
const maps = buildTierMaps(equipFull, spData.weapons);

const EMPTY = { equips: [null, null, null, null, null], sp: null };

test('tier maps: per-tier template ids come from levels[].id, not arithmetic', () => {
    // equip 500 (14 levels): levels[0].id=500, levels[1].id=501 in committed data
    assert.deepEqual(maps.equipTierToBase.get(501), { baseId: 500, level: 1 });
    assert.equal(maps.equipBaseToTiers.get(500)[0], 500);
});

test('encode: single equip at +1 produces the spec payload', () => {
    const code = encodeEquipCode({ ...EMPTY, equips: [{ baseId: 500, level: 1 }, null, null, null, null] }, maps);
    const expectedPayload = `${(501).toString(32)}/0/0/0/0\\0`.toUpperCase();
    assert.equal(code, btoa(expectedPayload));
});

test('encode: empty loadout returns null', () => {
    assert.equal(encodeEquipCode(EMPTY, maps), null);
});

test('encode: level clamps into the tier list', () => {
    const tiers = maps.equipBaseToTiers.get(500);
    const code = encodeEquipCode({ ...EMPTY, equips: [{ baseId: 500, level: 99 }, null, null, null, null] }, maps);
    const decoded = decodeEquipCode(code, maps);
    assert.deepEqual(decoded.equips[0], { baseId: 500, level: tiers.length - 1 });
});

test('round-trip: five equips at mixed levels', () => {
    // pick 5 distinct enhanceable equips from committed data
    const picks = [...maps.equipBaseToTiers.entries()].filter(([, t]) => t.length > 3).slice(0, 5);
    assert.equal(picks.length, 5, 'fixture needs 5 enhanceable equips');
    const equips = picks.map(([baseId, tiers], i) => ({ baseId, level: Math.min(i, tiers.length - 1) }));
    const decoded = decodeEquipCode(encodeEquipCode({ equips, sp: null }, maps), maps);
    assert.equal(decoded.ok, true);
    assert.deepEqual(decoded.equips, equips);
    assert.equal(decoded.sp, null);
});

test('decode: full 4-field game string yields gid', () => {
    const code = encodeEquipCode({ ...EMPTY, equips: [{ baseId: 500, level: 0 }, null, null, null, null] }, maps);
    const full = `${code}&${(20516).toString(32)}&1&2`;
    const decoded = decodeEquipCode(full, maps);
    assert.equal(decoded.ok, true);
    assert.equal(decoded.gid, 20516);
    assert.deepEqual(decoded.equips[0], { baseId: 500, level: 0 });
});

test('decode: lowercase payload tolerated (parseInt base-32 is case-insensitive)', () => {
    const payload = `${(501).toString(32)}/0/0/0/0\\0`; // lowercase b32 digits
    const decoded = decodeEquipCode(btoa(payload), maps);
    assert.deepEqual(decoded.equips[0], { baseId: 500, level: 1 });
});

test('decode: unknown tier id is a per-slot error, other slots still resolve', () => {
    const payload = `${(499999999).toString(32)}/${(500).toString(32)}/0/0/0\\0`.toUpperCase();
    const decoded = decodeEquipCode(btoa(payload), maps);
    assert.equal(decoded.equips[0], null);
    assert.deepEqual(decoded.equips[1], { baseId: 500, level: 0 });
    assert.ok(decoded.errors.some(e => e.kind === 'unknown-equip' && e.slot === 0));
    assert.equal(decoded.ok, true); // something resolved
});

test('decode: junk and empty inputs fail safely', () => {
    assert.equal(decodeEquipCode('', maps).ok, false);
    assert.ok(decodeEquipCode('', maps).errors.some(e => e.kind === 'empty'));
    const junk = decodeEquipCode('not base64 at all!!!', maps);
    assert.equal(junk.ok, false);
    assert.ok(junk.errors.some(e => e.kind === 'format'));
});

test('sp round-trip: dedicated augment at max level (10000 = 용감한 꿈의 베개)', () => {
    const tiers = maps.spBaseToTiers.get(10000);
    assert.ok(tiers && tiers.length >= 11, 'fixture: weapon 10000 must have level_ids');
    const sp = { baseId: 10000, level: tiers.length - 1 };
    const decoded = decodeEquipCode(encodeEquipCode({ equips: [null, null, null, null, null], sp }, maps), maps);
    assert.equal(decoded.ok, true);
    assert.deepEqual(decoded.sp, sp);
    assert.deepEqual(decoded.equips, [null, null, null, null, null]);
});

test('sp: succession weapon (1010120, awakened 듀얼 소드) resolves as its OWN base — not predecessor+12', () => {
    // 1010110 (듀얼 소드 +10, base 1010100) has next=1010120, but 1010120 is a
    // SEPARATE named base weapon (level=1 chain of its own). A game code
    // carrying 1010120 must decode as {baseId:1010120, level:0}; predecessor
    // base+level arithmetic would misresolve it as 1010100 "+12".
    // (F3-UPDATE correction 2026-07-01 — succession links, not intra-chain jumps.)
    assert.deepEqual(maps.spTierToBase.get(1010120), { baseId: 1010120, level: 0 });
    assert.deepEqual(maps.spTierToBase.get(1010110), { baseId: 1010100, level: 10 });
    const sp = { baseId: 1010120, level: 0 };
    const decoded = decodeEquipCode(encodeEquipCode({ equips: [null, null, null, null, null], sp }, maps), maps);
    assert.deepEqual(decoded.sp, sp);
});

test('sp: tier maps cover every level_ids entry exactly once (no dup tier ids)', () => {
    let total = 0;
    for (const w of Object.values(spData.weapons)) {
        total += Array.isArray(w.level_ids) ? w.level_ids.length : 0;
    }
    assert.ok(total > 2000, `fixture sanity: expected thousands of sp tier ids, got ${total}`);
    // Map size == sum of chain lengths ⇒ no id appeared in two chains.
    assert.equal(maps.spTierToBase.size, total);
});

test('sp: unknown sp tier id degrades to error, equips still apply', () => {
    const payload = `${(500).toString(32)}/0/0/0/0\\${(499999999).toString(32)}`.toUpperCase();
    const decoded = decodeEquipCode(btoa(payload), maps);
    assert.deepEqual(decoded.equips[0], { baseId: 500, level: 0 });
    assert.equal(decoded.sp, null);
    assert.ok(decoded.errors.some(e => e.kind === 'unknown-sp'));
});

test('sp: invalid characters in the sp token produce a token error on slot sp', () => {
    // 'z' is outside base-32 digits [0-9a-v]
    const payload = `${(500).toString(32)}/0/0/0/0\\zz!`.toUpperCase();
    const decoded = decodeEquipCode(btoa(payload), maps);
    assert.equal(decoded.sp, null);
    assert.ok(decoded.errors.some(e => e.kind === 'token' && e.slot === 'sp'));
    assert.deepEqual(decoded.equips[0], { baseId: 500, level: 0 });
});
