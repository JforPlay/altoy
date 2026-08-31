// 숙련도 (BattleBuffAddProficiency) — the matcher and the shape of what feeds it.
//
// The Lua (battlebuffaddproficiency.lua calcEnhancement) walks every weapon on the
// unit and ADDS `number` to the ones passing two independent filters: every listed
// `label` must sit on the equipped item (the loop breaks on the first miss) and the
// 1-based `index` must contain the weapon's equip slot. `SetPotentialFactor` feeds
// battleformulas.lua:202, where potential multiplies weapon damage 1:1.
//
// The second half of the file is a data-shape ratchet: the emitted gates must stay
// inside the vocabulary evalGate actually knows, or a cast condition the browser
// cannot read would silently pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _applyWeaponModifiers } from '../../public/js/simulators/fleet-sim.damage.js';
import { KNOWN_GATE_KEYS } from '../../public/js/engine/damage/battle-sim.gates.js';

const mods = (proficiency) => ({ reloadByWeaponType: {}, damageBySlot: {}, proficiency });
const surface = (slot) => ({ potential: 1, slotIndex: slot, equipSlot: slot, reloadMax: 5 });
const air = (slot) => ({ potential: 1, equipSlot: slot, reloadMax: 20, label: '항공기' });
const barrage = () => ({ potential: 1, reloadMax: 0, label: '탄막' });

// 3 slots: a CL main gun, a DD secondary, a US carrier plane.
const LABELS = [['CL', 'MG'], ['DD', 'MG'], ['USS', 'CV', 'TB']];
const UNIT = {
  equipTypes: [1, 2, 7], equipLabels: LABELS, nationality: 3, shipType: 4,
  spEquipped: false, allyCount: 6, tags: ['T_4', 'N_3', 'Fletcher-Class'],
};

test('every listed label must sit on the SAME slot, not one each', () => {
  const w = [surface(0), surface(1), surface(2)];
  _applyWeaponModifiers(w, mods([{ value: 0.25, labels: ['MG'] }]), LABELS, UNIT);
  assert.deepEqual(w.map((d) => d.potential), [1.25, 1.25, 1]);

  const w2 = [surface(0), surface(1), surface(2)];
  _applyWeaponModifiers(w2, mods([{ value: 0.25, labels: ['CL', 'MG'] }]), LABELS, UNIT);
  assert.deepEqual(w2.map((d) => d.potential), [1.25, 1, 1]);

  // 'CL' and 'TB' each sit on a slot, but no ONE slot carries both.
  const w3 = [surface(0), surface(1), surface(2)];
  _applyWeaponModifiers(w3, mods([{ value: 0.25, labels: ['CL', 'TB'] }]), LABELS, UNIT);
  assert.deepEqual(w3.map((d) => d.potential), [1, 1, 1]);
});

test('the slot filter is 1-based, and composes with the label filter', () => {
  const w = [surface(0), surface(1), surface(2)];
  _applyWeaponModifiers(w, mods([{ value: 0.1, slots: [1, 2] }]), LABELS, UNIT);
  assert.deepEqual(w.map((d) => d.potential), [1.1, 1.1, 1]);

  // 엠덴 15510's shape: slots 1-2 AND an MG label.
  const w2 = [surface(0), surface(1), surface(2)];
  _applyWeaponModifiers(w2, mods([{ value: 0.25, slots: [2], labels: ['MG'] }]), LABELS, UNIT);
  assert.deepEqual(w2.map((d) => d.potential), [1, 1.25, 1]);

  // ...and a slot the label does not match stays untouched.
  const w3 = [surface(0), surface(1), surface(2)];
  _applyWeaponModifiers(w3, mods([{ value: 0.25, slots: [3], labels: ['MG'] }]), LABELS, UNIT);
  assert.deepEqual(w3.map((d) => d.potential), [1, 1, 1]);
});

// No emitted record omits both filters today, but the branch must not become a
// no-op if one appears — that shape means "every weapon on the ship".
test('a record with neither filter reaches every equipped weapon', () => {
  const w = [surface(0), surface(1), air(2)];
  _applyWeaponModifiers(w, mods([{ value: 0.05 }]), LABELS, UNIT);
  assert.deepEqual(w.map((d) => d.potential), [1.05, 1.05, 1.05]);
});

// The reason `equipSlot` exists at all: an air descriptor never carries `slotIndex`
// (that field drives weaponEvents and would make air rows raise gun-salvo triggers),
// and carriers are exactly what most label-gated 숙련도 skills are written for.
test('an AIR descriptor is reached through equipSlot, with no slotIndex on it', () => {
  const plane = air(2);
  assert.equal(plane.slotIndex, undefined);
  const w = [surface(0), plane];
  _applyWeaponModifiers(w, mods([{ value: 0.15, labels: ['CV'] }]), LABELS, UNIT);
  assert.deepEqual(w.map((d) => d.potential), [1, 1.15]);
});

// A barrage weapon holds no equipment, so GetEquipmentLabel is empty and
// GetEquipmentIndex is nil — every filtered record misses it in game too.
test('a barrage row carries no equipment and is never touched', () => {
  const b = barrage();
  _applyWeaponModifiers([b], mods([{ value: 0.5, labels: ['MG'] }, { value: 0.5 }]), LABELS, UNIT);
  assert.equal(b.potential, 1);
});

test('proficiency ADDS to the potential factor and several rows stack', () => {
  const w = [surface(0)];
  _applyWeaponModifiers(w, mods([
    { value: 0.25, labels: ['MG'] }, { value: 0.15, slots: [1] },
  ]), LABELS, UNIT);
  assert.equal(Math.round(w[0].potential * 1000) / 1000, 1.4);

  // 르 트리옹팡 11510 pays -30% on one slot for +20% on another; a big enough
  // negative must clamp rather than turn the weapon's damage inside out.
  const w2 = [surface(0)];
  _applyWeaponModifiers(w2, mods([{ value: -3, labels: ['MG'] }]), LABELS, UNIT);
  assert.equal(w2[0].potential, 0);
});

// The install gate — what stops 엠덴's +25% applying to a ship with no CL gun in the
// 부포 slot. A row applies on an exact `true` only: 'unknown' BLOCKS, so a condition
// the sim cannot read under-reports visibly instead of over-reporting in silence.
test('an install gate is evaluated against the loadout before the row applies', () => {
  const pass = { value: 0.25, slots: [1, 2], labels: ['MG'],
                 gates: [{ check_weapon: true, minWeaponNumber: 1, label: ['CL', 'MG'], index: [1] }] };
  const w = [surface(0), surface(1)];
  _applyWeaponModifiers(w, mods([pass]), LABELS, UNIT);
  assert.deepEqual(w.map((d) => d.potential), [1.25, 1.25]);

  // Same row, gate now asking for a CL gun in slot 2 — the ship has a DD gun there.
  const fail = { ...pass, gates: [{ check_weapon: true, minWeaponNumber: 1, label: ['CL', 'MG'], index: [2] }] };
  const w2 = [surface(0), surface(1)];
  _applyWeaponModifiers(w2, mods([fail]), LABELS, UNIT);
  assert.deepEqual(w2.map((d) => d.potential), [1, 1]);

  // 프리드리히 데어 그로세 18240: 「내구도 30% 이하」, and HP is pinned at 100%.
  const hp = { value: 0.3, slots: [1], gates: [{ hpUpperBound: 0.3, hpLowerBound: 0 }] };
  const w3 = [surface(0)];
  _applyWeaponModifiers(w3, mods([hp]), LABELS, UNIT);
  assert.equal(w3[0].potential, 1);

  // weapon_group is unanswerable — evalGate says 'unknown', which must not pass.
  const unknown = { value: 0.3, slots: [1], gates: [{ check_weapon: true, minWeaponNumber: 1, weapon_group: [740] }] };
  const w4 = [surface(0)];
  _applyWeaponModifiers(w4, mods([unknown]), LABELS, UNIT);
  assert.equal(w4[0].potential, 1);
});

// 하쿠류 18400 and 150850 are installed by TWO gated casts — an OR, and reading only
// the first arm would drop a buff the other arm grants.
test('several gates are an OR: any one reading true is enough', () => {
  const row = {
    value: 0.1, labels: ['CV'],
    gates: [
      { check_weapon: true, minWeaponNumber: 1, label: ['IJN', 'CV'] },   // false here
      { check_weapon: true, minWeaponNumber: 1, label: ['USS', 'CV'] },   // true
    ],
  };
  const w = [air(2)];
  _applyWeaponModifiers(w, mods([row]), LABELS, UNIT);
  assert.equal(Math.round(w[0].potential * 100) / 100, 1.1);

  const w2 = [air(2)];
  _applyWeaponModifiers(w2, mods([{ ...row, gates: [row.gates[0]] }]), LABELS, UNIT);
  assert.equal(w2[0].potential, 1);
});

// ---------------------------------------------------------------------------
// Data shape — the ratchet
// ---------------------------------------------------------------------------

const passives = JSON.parse(readFileSync(
  new URL('../../public/data/sim/fleet_sim_passive_skills.json', import.meta.url)));

const profRows = [];
for (const [id, s] of Object.entries(passives)) {
  for (const buffs of Object.values(s.levels || {})) {
    for (const b of buffs) if (b.attr === 'proficiencyRatio') profRows.push({ id, b });
  }
}

test('the emitted 숙련도 corpus keeps its shape', () => {
  const skills = new Set(profRows.map((r) => r.id));
  assert.equal(skills.size, 109, 'skills carrying a 숙련도 row');
  // Every record names at least one filter. A record with neither would buff every
  // weapon on the ship, which the matcher supports but no game record asks for —
  // if one appears, look at it before assuming the branch is right for it.
  assert.equal(profRows.filter((r) => !r.b.slots && !r.b.labels).length, 0);
  // 익스플로레이션 워드's buff_151051 is a 3-stack kill ladder. The extractor drops
  // `onStack` effects on a stacking buff rather than ship its rung-1 value as
  // unconditional, so its skill must not appear here at all.
  assert.equal(skills.has('151050'), false);
});

// A gate key evalGate names in NEITHER of its lists silently PASSES — the buff
// applies on an unevaluated condition with nothing marking it. This is what turns
// a pipeline that starts emitting a new key into a failure instead of a quiet lie.
test('every install-gate key emitted is one evalGate knows about', () => {
  const seen = new Set();
  for (const { b } of profRows) for (const g of b.gates || []) {
    for (const k of Object.keys(g)) seen.add(k);
  }
  assert.ok(seen.size > 0, 'no gates emitted at all — the self-cast lookup is dead');
  const unknown = [...seen].filter((k) => !KNOWN_GATE_KEYS.has(k));
  assert.deepEqual(unknown, [], `gate keys evalGate ignores: ${unknown.join(', ')}`);
});

test('the gated share of the corpus is pinned', () => {
  const gated = new Set(profRows.filter((r) => r.b.gates?.length).map((r) => r.id));
  // 29 of the 109 install themselves through a gated self-cast on buff_<id>. A DROP
  // here means the lookup stopped finding them and the sim is back to applying an
  // equipment-conditional buff unconditionally — the failure this whole gate exists
  // to prevent, and one that no other assertion can see.
  assert.equal(gated.size, 29);
});
