import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evalGate, KNOWN_GATE_KEYS } from '../../public/js/engine/damage/battle-sim.gates.js';

const unit = (o = {}) => ({
  equipTypes: [1, 3, 11], nationality: 3, shipType: 4, spEquipped: false, allyCount: 6, ...o,
});

test('an effect with no gate args passes', () => {
  assert.equal(evalGate({ skill_id: 9, time: 20 }, unit(), new Set()), true);
});

// 크론시타트 15290's two arms: "주포 8회마다 … 대형 함포 장비 시 4회로 감소" is
// check_weapon type:[3] minWeaponNumber:1 vs type:[11]. Both ship today because the
// extractor cannot tell which arm a loadout takes.
test('check_weapon counts equipped slots of the named types', () => {
  const t = new Set();
  assert.equal(evalGate({ check_weapon: true, type: [3], minWeaponNumber: 1 }, unit(), t), true);
  assert.equal(evalGate({ check_weapon: true, type: [5], minWeaponNumber: 1 }, unit(), t), false);
  assert.equal(evalGate({ check_weapon: true, type: [3], maxWeaponNumber: 0 }, unit(), t), false);
});

// 워싱턴 1011000's branch-2 fork: maxTargetNumber:0 is the "does NOT have the tag"
// arm, minTargetNumber:1 the "has it" arm.
test('ship_tag_list reads the tags stamped during the run', () => {
  const has = new Set(['BB56SPweapon']);
  const args = (min, max) => ({
    check_target: ['TargetSelf', 'TargetShipTag'], ship_tag_list: ['BB56SPweapon'],
    ...(min != null ? { minTargetNumber: min } : {}), ...(max != null ? { maxTargetNumber: max } : {}),
  });
  assert.equal(evalGate(args(1, null), unit(), has), true);
  assert.equal(evalGate(args(null, 0), unit(), has), false);
  assert.equal(evalGate(args(1, null), unit(), new Set()), false);
  assert.equal(evalGate(args(null, 0), unit(), new Set()), true);
});

// HP is pinned at 100%. hpUpperBound alone defaults hpLowerBound to 0, so it reads
// "at or below N" and fails; hpLowerBound alone defaults hpUpperBound to 1 and
// passes. That resolves 800380 피의 희생's two arms exactly.
test('the HP interval is evaluated at a pinned 100%', () => {
  assert.equal(evalGate({ hpUpperBound: 0.2 }, unit(), new Set()), false);
  assert.equal(evalGate({ hpUpperBound: 1, hpLowerBound: 0.2 }, unit(), new Set()), true);
  assert.equal(evalGate({ hpLowerBound: 0.45 }, unit(), new Set()), true);
  assert.equal(evalGate({ hpUpperBound: 0.45, hpLowerBound: 0 }, unit(), new Set()), false);
  assert.equal(evalGate({ hpUpperBound: 0.2, hpOutInterval: true }, unit(), new Set()), true);
});

// These read the roster only when a check_target names them as a CONDITION; standing
// alone they are a recipient filter (see the standalone test below).
test('nationality and ship_type_list read the roster under check_target', () => {
  const ct = (o) => ({ check_target: ['TargetSelf', 'TargetShipTag'], minTargetNumber: 1, ...o });
  assert.equal(evalGate(ct({ nationality: [3] }), unit(), new Set()), true);
  assert.equal(evalGate(ct({ nationality: [7] }), unit(), new Set()), false);
  assert.equal(evalGate(ct({ ship_type_list: [4, 5] }), unit(), new Set()), true);
  assert.equal(evalGate(ct({ ship_type_list: [1] }), unit(), new Set()), false);
});

test('check_spweapon reads whether the dedicated SP weapon is equipped', () => {
  assert.equal(evalGate({ check_spweapon: true }, unit({ spEquipped: true }), new Set()), true);
  assert.equal(evalGate({ check_spweapon: true }, unit({ spEquipped: false }), new Set()), false);
});

// D3: a gate the sim cannot answer never silently passes. It returns 'unknown' and
// the caller discloses the skill instead of counting or dropping it in silence.
// Without check_target these keys select the buff's RECIPIENT, not whether the cast
// happens — so the sim cannot answer them and must disclose rather than drop. Returning
// false here silently deleted 사우스다코타's and 하쿠호's cross-ship pairing barrages.
test('a standalone discriminator is a recipient filter, so it is unknown', () => {
  const t = new Set(['Washington']);
  assert.equal(evalGate({ ship_tag_list: ['Washington'] }, unit(), t), 'unknown');
  assert.equal(evalGate({ ship_tag_list: ['Nobody'] }, unit(), t), 'unknown');
  assert.equal(evalGate({ nationality: [3] }, unit(), t), 'unknown');
  // ...but WITH check_target beside it, it is a real condition and evaluates.
  assert.equal(evalGate({ check_target: ['TargetSelf', 'TargetShipTag'],
                          ship_tag_list: ['Washington'], minTargetNumber: 1 }, unit(), t), true);
});

// The slot restriction on check_weapon, used by 62 records and untested until now.
test('check_weapon honours the 1-based index slot restriction', () => {
  const u = unit({ equipTypes: [1, 3, 11] });
  assert.equal(evalGate({ check_weapon: true, type: [3], index: [2], minWeaponNumber: 1 }, u, new Set()), true);
  assert.equal(evalGate({ check_weapon: true, type: [3], index: [1], minWeaponNumber: 1 }, u, new Set()), false);
  assert.equal(evalGate({ check_weapon: true, type: [11], index: [3], minWeaponNumber: 1 }, u, new Set()), true);
});

// The 113 `label` edges (100% co-occurring with check_weapon, and none of them
// carrying a `type`). GetEquipmentList requires EVERY listed label on the item —
// a table.contains per label with a break on the first miss — so this is the
// opposite of ContainsLabelTag's ANY and must not reuse _matchCount's `.some()`.
test('check_weapon requires ALL of the listed labels on one slot', () => {
  const u = unit({ equipTypes: [1, 3, 11], equipLabels: [['CL', 'MG'], ['DD', 'MG'], ['USS', 'CV']] });
  const g = (label, extra = {}) => ({ check_weapon: true, label, minWeaponNumber: 1, ...extra });
  assert.equal(evalGate(g(['CL', 'MG']), u, new Set()), true);
  assert.equal(evalGate(g(['MG']), u, new Set()), true);
  // 'CL' and 'HE' each sit on a slot, but no ONE slot carries both.
  assert.equal(evalGate(g(['CL', 'HE']), u, new Set()), false);
  assert.equal(evalGate(g(['SN']), u, new Set()), false);
  // The label filter composes with the slot filter rather than replacing it.
  assert.equal(evalGate(g(['DD', 'MG'], { index: [2] }), u, new Set()), true);
  assert.equal(evalGate(g(['DD', 'MG'], { index: [1] }), u, new Set()), false);
  // maxWeaponNumber: 0 is the "no such equip" arm and must still work off labels.
  assert.equal(evalGate({ check_weapon: true, label: ['MG'], maxWeaponNumber: 0 }, u, new Set()), false);
  assert.equal(evalGate({ check_weapon: true, label: ['SN'], maxWeaponNumber: 0 }, u, new Set()), true);
});

// A unit ctx with no equipLabels at all cannot satisfy a label gate. It is
// indistinguishable from an all-empty loadout by design — the empty-slot rule below
// already makes both count zero slots.
test('a label gate finds nothing when the unit carries no labels', () => {
  assert.equal(evalGate({ check_weapon: true, label: ['MG'], minWeaponNumber: 1 }, unit(), new Set()), false);
});

// GetEquipmentList drops an equipment-less slot BEFORE any sub-filter, so a bare
// minWeaponNumber must not be satisfied by empty slots. equipTypes is 0 there; every
// real equip has a non-zero type (890/890).
test('check_weapon does not count empty slots', () => {
  const empty = unit({ equipTypes: [0, 0, 0], equipLabels: [[], [], []] });
  assert.equal(evalGate({ check_weapon: true, minWeaponNumber: 1 }, empty, new Set()), false);
  assert.equal(evalGate({ check_weapon: true, minWeaponNumber: 1 }, unit(), new Set()), true);
  // ...and an empty slot cannot fill a maxWeaponNumber: 0 lockout either way.
  assert.equal(evalGate({ check_weapon: true, maxWeaponNumber: 0 }, empty, new Set()), true);
});

// hp is pinned at 1, so an out-of-interval test with a bare lower bound sits exactly on
// the boundary where the Lua's two non-strict comparisons diverge from a naive negation.
test('the out-of-interval test is the Lua formula, not the negation of the in-test', () => {
  assert.equal(evalGate({ hpLowerBound: 0.2, hpOutInterval: true }, unit(), new Set()), true);
  assert.equal(evalGate({ hpUpperBound: 0.9, hpLowerBound: 0.2, hpOutInterval: true }, unit(), new Set()), true);
});

test('a battlefield-state gate is unknown, not a pass and not a fail', () => {
  for (const a of [{ fleetAttr: 'Judgement=12' }, { stack_require: 3 }, { streakRange: [1, 3] },
                   { effectAttachData: {} }, { killer: 1 }, { dungeonTypeList: [2] }]) {
    assert.equal(evalGate(a, unit(), new Set()), 'unknown', JSON.stringify(a));
  }
});

// A check_target with no ship_tag_list is a plain fleet-size test on the ally side.
// An unresolvable target token is unknown rather than a guess.
test('check_target counts the ally fleet when it names no tag', () => {
  assert.equal(evalGate({ check_target: ['TargetAllHelp'], minTargetNumber: 1 }, unit(), new Set()), true);
  assert.equal(evalGate({ check_target: ['TargetAllHarm'], minTargetNumber: 1 }, unit(), new Set()), 'unknown');
});

// A gate key the pruner emits that evalGate names in NEITHER list silently PASSES —
// the cast fires on an unevaluated condition, with no note on it. That is exactly
// the over-report D3 forbids, and nothing else in the build or the suite can see it.
// This test is what turns that silent gap into a failure.
test('every gate key in the published graph is one evalGate knows about', () => {
  const graph = JSON.parse(readFileSync(new URL('../../public/data/sim/fleet_sim_graph.json', import.meta.url)));
  // `delay` and `buff_id_list` are the two removal classes' own control args (when to
  // cancel the holder / which ids to strip), not conditions on the caster — they join
  // this list rather than KNOWN_GATE_KEYS, which is about what may gate a cast.
  const CONTROL = new Set(['skill_id', 'skill_id_list', 'buff_id', 'time', 'rant', 'quota',
    'initialCD', 'countType', 'countTarget', 'count', 'index', 'buff_level', 'target',
    'repeat_count', 'range', 'keep', 'tag', 'tag_list', 'weapon_id',
    'delay', 'buff_id_list']);
  const seen = new Set();
  for (const node of [...Object.values(graph.b), ...Object.values(graph.s)]) {
    for (const e of node.e) for (const k of Object.keys(e.a)) if (!CONTROL.has(k)) seen.add(k);
  }
  const unknown = [...seen].filter((k) => !KNOWN_GATE_KEYS.has(k));
  assert.deepEqual(unknown, [], `gate keys evalGate ignores: ${unknown.join(', ')}`);
});
