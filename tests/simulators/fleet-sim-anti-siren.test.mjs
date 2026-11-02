/**
 * 대세이렌 피해 — both halves land on DMG_TAG_EHC_N_99 (battleattr.lua seeds it from
 * the ship's AntiSiren; the 안티 세이렌 skills BattleBuffAddAttr onto it), which the
 * formula multiplies in only against an N_99 (세이렌) target — the Arbiters.
 * Reads committed data only (CI runs this before any build).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setup as setupCalc, resolvePassiveBuffs, sumDamageBuffs, equipDamageBuffs } from '../../public/js/simulators/fleet-sim.calc.js';
import { setup as setupData } from '../../public/js/simulators/fleet-sim.data.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../../public/data/${p}`, import.meta.url), 'utf8'));
const equipFullData = load('equip/equip_data_full.json');
const passiveSkillData = load('sim/fleet_sim_passive_skills.json');
const ships = Object.values(load('ship_info_data.json'));
setupData({ equipFullData });
setupCalc({ passiveSkillData });

const CORSAIR = 17260;   // F4U 콜세어 (VF-17): +11/+12/+13 = 100/200/300

test('equip anti_siren counts from +11 and reads the tier, never the level number', () => {
    assert.deepEqual(equipDamageBuffs({ equips: [{ id: CORSAIR, level: 10 }] }), []);
    const [b] = equipDamageBuffs({ equips: [{ id: CORSAIR, level: 13 }, null, { id: CORSAIR, level: 11 }] });
    assert.equal(b.attr, 'DMG_TAG_EHC_N_99');
    assert.ok(Math.abs(b.value - 0.04) < 1e-9, '300 + 100 → 4%');
});

test('a PR ship at max 개발 gets ONE 안티 세이렌 rung (Ⅲ, +15%), not all three', () => {
    const georgia = ships.find((s) => s.gid === 19902);
    const fleet = [georgia, null, null, null, null, null];
    const tag = resolvePassiveBuffs(georgia, fleet, 0).filter((b) => b.attr === 'DMG_TAG_EHC_N_99');
    assert.deepEqual(tag.map((b) => b.value), [0.15]);
});

test('skill and equip halves sum into one N_99 bucket', () => {
    const georgia = ships.find((s) => s.gid === 19902);
    const buffs = resolvePassiveBuffs(georgia, [georgia, null, null, null, null, null], 0);
    const out = sumDamageBuffs([...buffs, ...equipDamageBuffs({ equips: [{ id: CORSAIR, level: 13 }] })]);
    assert.ok(Math.abs(out.byTag.N_99 - 0.18) < 1e-9);
});
