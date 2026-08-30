// tests/damage-engine/adapter-resolve.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barrageBulletCount, attackAttributeKey, resolveWeaponDescriptor, mergeWeaponWithBase, effectiveProficiency,
  weaponEvents, activeBarrageSkillIds, hasFateSimulation, cadenceLabel, resolveBarrageDescriptors, attachedSPBarrageIds }
  from '../../public/js/simulators/fleet-sim.damage.js';

const approxArr = (a, b, eps = 1e-9) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < eps);

// Fixtures mimicking real template shapes.
const barrageMap = {
  1: { primal_repeat: 0, senior_repeat: 0 },           // 1 bullet
  8: { primal_repeat: 1, senior_repeat: 2 },           // (1+1)*(2+1) = 6 bullets
};
const bulletMap = {
  1400: { damage_type: [1.0, 0.8, 0.5], ammo_type: 1 },
};
const getBarrage = (id) => barrageMap[id] || null;
const getBullet = (id) => bulletMap[id] || null;

test('barrageBulletCount sums (primal+1)*(senior+1) across barrage_ID', () => {
  assert.equal(barrageBulletCount([1], getBarrage), 1);
  assert.equal(barrageBulletCount([8], getBarrage), 6);
  assert.equal(barrageBulletCount([1, 8], getBarrage), 7);
  assert.equal(barrageBulletCount([], getBarrage), 0);
});

test('attackAttributeKey maps 1/2/4; excludes anti-air(3)/anti-sub(5)', () => {
  assert.equal(attackAttributeKey(1), 'cannon');
  assert.equal(attackAttributeKey(2), 'torpedo');
  assert.equal(attackAttributeKey(4), 'air');
  assert.equal(attackAttributeKey(3), null);
  assert.equal(attackAttributeKey(5), null);
});

test('resolveWeaponDescriptor builds a full descriptor; returns null for anti-air', () => {
  const weapon = {
    damage: 45, corrected: 110, attack_attribute: 1, attack_attribute_ratio: 100,
    reload_max: 240, barrage_ID: [8], bullet_ID: [1400],
  };
  const stats = { firepower: 500, torpedo: 300, aviation: 0 };
  const d = resolveWeaponDescriptor(weapon, stats, { getBarrage, getBullet, label: '주포' });
  assert.equal(d.attackAttribute, 'cannon');
  assert.equal(d.stat, 500);               // firepower
  assert.equal(d.damage, 45);
  assert.equal(d.corrected, 110);
  assert.equal(d.ratio, 100);
  assert.equal(d.bulletsPerSalvo, 6);
  assert.deepEqual(d.damageType, [1.0, 0.8, 0.5]);
  assert.equal(d.ammoType, 1);
  assert.equal(d.reloadMax, 240);
  assert.equal(d.label, '주포');

  const aa = resolveWeaponDescriptor({ ...weapon, attack_attribute: 3 }, stats, { getBarrage, getBullet });
  assert.equal(aa, null);
});

test('resolveWeaponDescriptor applies mountCount (포좌) and potential (efficiency); defaults to 1', () => {
  const weapon = {
    damage: 45, corrected: 110, attack_attribute: 1, attack_attribute_ratio: 100,
    reload_max: 240, barrage_ID: [8], bullet_ID: [1400],   // barrage 8 → 6 bullets/wave
  };
  const stats = { firepower: 500, torpedo: 300, aviation: 0 };
  const d = resolveWeaponDescriptor(weapon, stats, { getBarrage, getBullet, mountCount: 3, potential: 2 });
  assert.equal(d.bulletsPerSalvo, 18);   // 6 × 3 mounts
  assert.equal(d.potential, 2);          // equipment_proficiency
  const d1 = resolveWeaponDescriptor(weapon, stats, { getBarrage, getBullet });
  assert.equal(d1.bulletsPerSalvo, 6);   // mountCount defaults to ×1
  assert.equal(d1.potential, 1);
});

// Real equip-resolved weapons are ALWAYS sparse ({base, damage, reload_max, [corrected]});
// the full template (attack_attribute, barrage_ID, bullet_ID, ratio) lives at the base id.
test('mergeWeaponWithBase: leaf overrides base, inherits attack_attribute/barrage/bullet', () => {
  const wp = {
    100: { id: 100, attack_attribute: 1, attack_attribute_ratio: 100, corrected: 120, barrage_ID: [8], bullet_ID: [1400], damage: 10, reload_max: 999 },
    100123: { base: 100, id: 100123, damage: 50, reload_max: 200 },
  };
  const get = (id) => wp[id] || null;
  const m = mergeWeaponWithBase(wp[100123], get);
  assert.equal(m.attack_attribute, 1);     // from base
  assert.deepEqual(m.barrage_ID, [8]);     // from base
  assert.deepEqual(m.bullet_ID, [1400]);   // from base
  assert.equal(m.attack_attribute_ratio, 100);
  assert.equal(m.damage, 50);              // leaf wins
  assert.equal(m.reload_max, 200);         // leaf wins
  assert.equal(m.corrected, 120);          // from base (leaf lacks it)
});

test('mergeWeaponWithBase: leaf corrected wins when present', () => {
  const wp = {
    100: { id: 100, attack_attribute: 1, corrected: 120, damage: 10 },
    100123: { base: 100, id: 100123, damage: 50, corrected: 135 },
  };
  const m = mergeWeaponWithBase(wp[100123], (id) => wp[id] || null);
  assert.equal(m.corrected, 135);
});

test('mergeWeaponWithBase: follows a multi-level base chain', () => {
  const wp = {
    100: { id: 100, attack_attribute: 2, barrage_ID: [1], bullet_ID: [9], damage: 5 },
    200: { base: 100, id: 200, damage: 20 },                  // mid (sparse)
    300: { base: 200, id: 300, damage: 80, reload_max: 150 }, // leaf (sparse)
  };
  const m = mergeWeaponWithBase(wp[300], (id) => wp[id] || null);
  assert.equal(m.attack_attribute, 2);     // from root template
  assert.deepEqual(m.barrage_ID, [1]);
  assert.equal(m.damage, 80);              // leaf wins over mid (20) and root (5)
  assert.equal(m.reload_max, 150);
});

test('mergeWeaponWithBase: no base → returned unchanged', () => {
  const w = { id: 1, attack_attribute: 1, damage: 5 };
  assert.equal(mergeWeaponWithBase(w, () => null), w);
});

// equipment_proficiency: max-LB base (from MLB sid in pipeline) + retrofit-grid
// deltas (retrofit.bonus.equipment_proficiency_N), applied only when the toggle is on.
test('effectiveProficiency: MLB base + retrofit deltas only when toggle on (Nevada)', () => {
  const ship = {
    equipment_proficiency: [1.3, 2, 1],
    retrofit: { bonus: { equipment_proficiency_1: 0.05, equipment_proficiency_2: 0.15 } },
  };
  assert.ok(approxArr(effectiveProficiency(ship, true), [1.35, 2.15, 1]));  // fully built
  assert.deepEqual(effectiveProficiency(ship, false), [1.3, 2, 1]);         // toggle off → no retrofit delta
});

test('effectiveProficiency: missing data / no retrofit defaults to ×1', () => {
  assert.deepEqual(effectiveProficiency({}, true), [1, 1, 1]);
  assert.deepEqual(effectiveProficiency({ equipment_proficiency: [1.2] }, true), [1.2, 1, 1]);
});

test('activeBarrageSkillIds drops the superseded rung of an upgrade chain', () => {
  // 듀이's real shape: both rungs are listed, only the Limit Break 3 one fires.
  // Counting both would roughly double most destroyers' barrage damage.
  const dewey = { skill: {
    12000: { id: 12000, upgrade: null, downgrade: null, requirement: 'Default', weapon_true: false },
    20011: { id: 20011, upgrade: 20012, downgrade: null, requirement: 'Limit Break 1', weapon_true: true },
    20012: { id: 20012, upgrade: null, downgrade: 20011, requirement: 'Limit Break 3', weapon_true: true },
  } };
  assert.deepEqual(activeBarrageSkillIds(dewey, false), ['20012']);
});

test('activeBarrageSkillIds keeps a base rung whose upgrade the ship does not list', () => {
  const ship = { skill: {
    30011: { id: 30011, upgrade: 30012, downgrade: null, requirement: 'Limit Break 1', weapon_true: true },
  } };
  assert.deepEqual(activeBarrageSkillIds(ship, false), ['30011']);
});

test('activeBarrageSkillIds gates a Retrofit skill on the retrofit toggle', () => {
  const ship = { skill: {
    40010: { id: 40010, upgrade: null, downgrade: null, requirement: 'Retrofit', weapon_true: true },
    40020: { id: 40020, upgrade: null, downgrade: null, requirement: 'Limit Break 3', weapon_true: true },
  } };
  assert.deepEqual(activeBarrageSkillIds(ship, false), ['40020']);
  assert.deepEqual(activeBarrageSkillIds(ship, true).sort(), ['40010', '40020']);
});

test('activeBarrageSkillIds keeps the base rung when its successor is Retrofit-gated and the toggle is off (엘드릿지)', () => {
  // Real shape: 29022 (no gate) upgrades into 29023 (Retrofit). "Does the target
  // exist" would drop 29022 as superseded AND drop 29023 on the retrofit gate —
  // net zero, with no unmodeled signal. The successor must be LIVE, not just listed.
  const ship = { skill: {
    29022: { id: 29022, upgrade: 29023, downgrade: null, requirement: 'Limit Break 3', weapon_true: true },
    29023: { id: 29023, upgrade: null, downgrade: 29022, requirement: 'Retrofit', weapon_true: true },
  } };
  assert.deepEqual(activeBarrageSkillIds(ship, false), ['29022']);
  assert.deepEqual(activeBarrageSkillIds(ship, true), ['29023']);
});

test('the 운명 toggle swaps a barrage between its base and fate rung (드레이크)', () => {
  // Real shape: 단죄의 불꽃 19300 upgrades into 단죄의 불꽃 + 18300 at fate step 3.
  // Off, the base rung must survive — the successor fails its own gate, exactly the
  // 엘드릿지 case one gate over. Never both, or the barrage counts twice.
  const drake = { skill: {
    19300: { id: 19300, upgrade: 18300, downgrade: null, requirement: 'Default', weapon_true: true },
    18300: { id: 18300, upgrade: null, downgrade: 19300, requirement: 'Fate Simulation 3', weapon_true: true },
  } };
  assert.deepEqual(activeBarrageSkillIds(drake, false, true), ['18300']);
  assert.deepEqual(activeBarrageSkillIds(drake, false, false), ['19300']);
  assert.deepEqual(activeBarrageSkillIds(drake, false), ['18300'], 'fate defaults to max');
  assert.equal(hasFateSimulation(drake), true);
  assert.equal(hasFateSimulation({ skill: { 19300: { requirement: 'Default' } } }), false);
});

test('weaponEvents emits ONE event per salvo carrying every name that salvo raises', () => {
  // slotIndex is 0-based on the descriptor and 1-based on the event, matching the
  // game's own `index` on a BattleBuffCount.
  const events = weaponEvents([
    { slotIndex: 0, weaponType: 23, reloadMax: 240, cycleExtra: 0, attackAttribute: 'cannon' },  // 전함 주포
    { slotIndex: 1, weaponType: 3, reloadMax: 480, cycleExtra: 0, attackAttribute: 'torpedo' },
    { slotIndex: 2, weaponType: 2, reloadMax: 240, cycleExtra: 0, attackAttribute: 'cannon' },   // 부포
    { slotIndex: null, reloadMax: 240, cycleExtra: 0, attackAttribute: 'air' },   // aircraft ordnance
  ], 150, 90, 12);

  const slot1 = events.filter((e) => e.slot === 1);
  const slot2 = events.filter((e) => e.slot === 2);
  const slot3 = events.filter((e) => e.slot === 3);
  const air = events.filter((e) => e.attr === 'air');
  assert.ok(slot1.length > slot2.length, 'the faster weapon must fire more often');
  // The names ride ONE event: an edge listing two of them must fire once per salvo,
  // and one event per name is a silent 2-4x over-count. But the CLASSES are disjoint —
  // each weapon subclass overrides TriggerBuffOnFire to raise exactly one name, so a
  // 부포 salvo must be invisible to a 「주포 발사 시」 barrage on the 전함 주포 beside it.
  assert.deepEqual(slot1[0].names, ['onChargeWeaponFire', 'onChargeWeaponReady', 'onWeaponSteday']);
  assert.deepEqual(slot2[0].names, ['onTorpedoWeaponFire', 'onWeaponSteday']);
  assert.deepEqual(slot3[0].names, ['onFire', 'onWeaponSteday']);
  // MANUAL_MISSILE is on the charge class but forks inside TriggerBuffOnFire, and an
  // AUTO_MISSILE is a torpedo-ATTRIBUTE weapon that is still a plain BattleWeaponUnit —
  // which is why the split reads `type`, not `attackAttribute`. Both ride the SY-1.
  const missile = weaponEvents([{ slotIndex: 0, weaponType: 31, reloadMax: 240, cycleExtra: 0, attackAttribute: 'torpedo' }], 150, 90, 0);
  assert.deepEqual(missile[0].names, ['onManualMissileFire', 'onManualMissileReady', 'onWeaponSteday']);
  const auto = weaponEvents([{ slotIndex: 0, weaponType: 32, reloadMax: 240, cycleExtra: 0, attackAttribute: 'torpedo' }], 150, 90, 0);
  assert.deepEqual(auto[0].names, ['onFire', 'onWeaponSteday']);
  assert.equal(air.length, Math.floor(90 / 12), 'the airstrike opens one cycle in, never at t=0');
  // slot 1 is what the KR-text acceptance gate emits for an air event. Inert today
  // (0 air-triggered edges in the graph declare an `index`), but production and the
  // gate must not disagree about the event shape the gate is validating.
  assert.equal(air[0].slot, 1);
  // A descriptor with no slot is the air ordnance, which the airstrike schedule owns.
  assert.equal(weaponEvents([{ slotIndex: null, reloadMax: 240, cycleExtra: 0 }], 150, 90, 0).length, 0);
});

test('cadenceLabel renders Korean from the simulated row trigger', () => {
  assert.equal(cadenceLabel({ trigger: 'onBattleBuffCount', countTarget: 15, slot: 1, slots: [1], period: 24 }), '주포 15회마다');
  assert.equal(cadenceLabel({ trigger: 'onBattleBuffCount', countTarget: 10, slot: 2, slots: [2], period: 24 }), '10회 발사마다');
  // 주포 only when slot 1 is the WHOLE list: 힌덴부르크 30062 counts [1, 3] and
  // 얏센 24122 counts [1, 2], and reading the leading entry called both of them 주포.
  assert.equal(cadenceLabel({ trigger: 'onBattleBuffCount', countTarget: 8, slot: 1, slots: [1, 3], period: 24 }), '8회 발사마다');
  assert.equal(cadenceLabel({ trigger: 'onUpdate', period: 20, first: 20 }), '20초마다');
  assert.equal(cadenceLabel({ trigger: 'onUpdate', period: 20, first: 5 }), '5초 후 20초마다');
  assert.equal(cadenceLabel({ trigger: 'onAttach', period: 20, first: 20 }), '20초마다');
  assert.equal(cadenceLabel({ trigger: 'onFire', period: 12, first: 12 }), '발사 시 (재사용 12.0초)');
  assert.equal(cadenceLabel({ trigger: 'onFire', period: 0, first: 3 }), '발사 시');
  assert.equal(cadenceLabel({ trigger: 'onTorpedoWeaponFire', period: 0, first: 20 }), '어뢰 발사 시');
  assert.equal(cadenceLabel({ trigger: 'onAllInStrike', period: 0, first: 12 }), '항공 공격 시');
  assert.equal(cadenceLabel({ trigger: 'onStartGame', period: 0, first: 0 }), '전투 시작 시');
  assert.equal(cadenceLabel({ trigger: 'onAttach', period: 0, first: 0 }), '전투 시작 시');
  assert.equal(cadenceLabel(null), '');
});

// ---------------------------------------------------------------------------
// resolveBarrageDescriptors now drives the battle simulator over a control-flow
// graph, so these fixtures are graph nodes rather than trigger records.
// ---------------------------------------------------------------------------

/** 재블린-shaped: count 15 main-gun salvos, then fire weapon 900. */
const countGraph = {
  b: {
    29081: { e: [
      { ty: 'BattleBuffCount', tr: ['onFire'], a: { countType: 29080, countTarget: 15, index: [1] } },
      { ty: 'BattleBuffCastSkill', tr: ['onBattleBuffCount'], a: { skill_id: 29081, countType: 29080 } },
    ] },
    // A gate on fleet state the sim cannot evaluate: the cast is blocked and the
    // ROOT is disclosed, never counted as unconditional.
    99999: { e: [
      { ty: 'BattleBuffCastSkill', tr: ['onStartGame'], a: { skill_id: 99999, fleetAttr: 'ammo' } },
    ] },
    // Reads fine, fires on a torpedo this loadout does not carry.
    88888: { e: [
      { ty: 'BattleBuffCastSkill', tr: ['onTorpedoWeaponFire'], a: { skill_id: 29081 } },
    ] },
    // Fires a live barrage AND hides an onSink death-rattle the sim never raises.
    77777: { e: [
      { ty: 'BattleBuffCastSkill', tr: ['onStartGame'], a: { skill_id: 29081 } },
      { ty: 'BattleBuffCastSkill', tr: ['onSink'], a: { skill_id: 99999 } },
    ] },
    // One weapon, two triggers — the DOT fixture.
    66666: { e: [
      { ty: 'BattleBuffCastSkill', tr: ['onStartGame'], a: { skill_id: 66666 } },
      { ty: 'BattleBuffCastSkill', tr: ['onUpdate'], a: { skill_id: 66666, time: 30 } },
    ] },
  },
  s: {
    29081: { e: [{ ty: 'BattleSkillFire', a: { weapon_id: 900 } }] },
    99999: { e: [{ ty: 'BattleSkillFire', a: { weapon_id: 901 } }] },
    66666: { e: [{ ty: 'BattleSkillFire', a: { weapon_id: 902 } }] },
  },
};

const barrageWeapons = {
  900: { damage: 30, corrected: 100, attack_attribute: 1, attack_attribute_ratio: 80,
         reload_max: 0, barrage_ID: [8], bullet_ID: [1400] },
  901: { damage: 30, corrected: 100, attack_attribute: 1, attack_attribute_ratio: 80,
         reload_max: 0, barrage_ID: [8], bullet_ID: [1400] },
  902: { damage: 30, corrected: 100, attack_attribute: 1, attack_attribute_ratio: 80,
         reload_max: 0, barrage_ID: [8], bullet_ID: [1401] },
};

const gunEvery3 = (window = 90) => {
  const out = [];
  for (let t = 3; t <= window; t += 3) {
    out.push({ t, names: ['onFire', 'onChargeWeaponFire', 'onChargeWeaponReady', 'onWeaponSteday'],
      slot: 1, attr: 'cannon' });
  }
  return out;
};

const simDeps = (over = {}) => ({
  graph: countGraph,
  getWeapon: (id) => barrageWeapons[id] || null,
  getBarrage,
  getBullet,
  getSkillName: (id) => ({ 29081: '전탄 발사 - 재블린I' }[id] || ''),
  stats: { firepower: 500, torpedo: 0, aviation: 0 },
  simCtx: {
    window: 90,
    events: gunEvery3(),
    unit: { equipTypes: [1, 6, 8], nationality: 1, shipType: 1, spEquipped: false, allyCount: 6, tags: [] },
  },
  ...over,
});

test('resolveBarrageDescriptors builds one descriptor per fired weapon and discloses the rest', () => {
  const { descriptors, unmodeled, inactive } = resolveBarrageDescriptors(['29081', '99999'], simDeps());
  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].activations, 2, '30 salvos over the window, one barrage every 15');
  assert.equal(descriptors[0].potential, 1, 'a barrage is not equipment — no proficiency');
  assert.equal(descriptors[0].cycleExtra, 0, 'a barrage has no gun fire cycle');
  assert.equal(descriptors[0].label, '탄막 · 전탄 발사 - 재블린I');
  assert.equal(descriptors[0].cadence, '주포 15회마다');
  assert.equal(descriptors[0].activationWindow, 90);
  assert.equal(unmodeled, 1, 'the fleetAttr gate is unevaluable, so its root is disclosed');
  assert.equal(inactive, 0);
});

// The two notes answer DIFFERENT questions. "발동 조건이 아직 구현되지 않은" is wrong
// about a barrage whose condition was read and computed to zero — a 대공-slot
// trigger, a torpedo trigger on a ship with no torpedo.
test('resolveBarrageDescriptors counts a zero-activation barrage apart from a disclosed one', () => {
  const { descriptors, unmodeled, inactive } = resolveBarrageDescriptors(['88888', '99999'], simDeps());
  assert.deepEqual(descriptors, []);
  assert.equal(inactive, 1, 'the torpedo trigger read fine; this loadout just never raises it');
  assert.equal(unmodeled, 1, 'only the unevaluable gate is disclosed');
});

// A root the graph has no node for is a THIRD case, and it belongs with the first.
// `expandBarrageSkillIds` returns the parent id unexpanded when nothing resolves, and
// an attached 전용 장비 id is appended with no graph filter at all — such a root installs
// nothing, so no condition is ever read and 「현재 편성에서 발동하지 않는」 asserts
// something false about it. 76 ships reach this, 9 with no equipment fitted.
test('resolveBarrageDescriptors discloses a root the graph has no node for', () => {
  const { descriptors, unmodeled, inactive } = resolveBarrageDescriptors(['12345'], simDeps());
  assert.deepEqual(descriptors, []);
  assert.equal(unmodeled, 1, 'no node = the condition was never read = 미구현');
  assert.equal(inactive, 0, 'and it must NOT claim the condition read and came out false');
});

test('resolveBarrageDescriptors counts a root unmodeled when every weapon it fired fails to resolve', () => {
  const { descriptors, unmodeled } = resolveBarrageDescriptors(['29081'], simDeps({ getWeapon: () => null }));
  assert.deepEqual(descriptors, []);
  assert.equal(unmodeled, 1);
});

// 키로프 14170: its 전용 장비 sibling casts the same skill at t=0 and the cast attaches
// a buff whose BattleBuffCleanse strips 14170 outright. The rows are all there under
// the sibling, so a "발동하지 않는" note beside them would be a lie.
test('resolveBarrageDescriptors suppresses the zero-row note when a sibling fired the same weapons', () => {
  const graph = {
    b: {
      // Cleansed at t=0 by the sibling's cast, so this root never reaches its own cast.
      14170: { e: [{ ty: 'BattleBuffCastSkill', tr: ['onUpdate'], a: { skill_id: 14170, time: 20 } }] },
      14171: { e: [{ ty: 'BattleBuffCastSkill', tr: ['onStartGame'], a: { skill_id: 14170 } }] },
      14172: { e: [{ ty: 'BattleBuffCleanse', tr: ['onAttach'], a: { buff_id_list: [14170] } }] },
    },
    s: { 14170: { e: [{ ty: 'BattleSkillFire', a: { weapon_id: 900 } },
      { ty: 'BattleSkillAddBuff', a: { buff_id: 14172 } }] } },
  };
  const out = resolveBarrageDescriptors(['14170', '14171'], simDeps({ graph }));
  assert.equal(out.descriptors.length, 1, 'the sibling carries the barrage');
  assert.equal(out.inactive, 0, 'no note beside a row that IS this root barrage');
  assert.equal(out.unmodeled, 0);

  // ...but a root whose weapons nobody fired still gets its note.
  const alone = resolveBarrageDescriptors(['88888'], simDeps());
  assert.equal(alone.inactive, 1);
});

// Task 5 raises `blocked` for a root whose only path to some weapon runs through a
// trigger the sim never raises, and it does so UNIFORMLY — a skill with a live
// barrage and an onSink death-rattle really does have an unmodelled half. 67 roots
// are in that state at production scope; gating the note on "produced no rows" would
// undo the rule at the last step.
test('a root that fires AND hides an unraisable branch still gets its 미구현 note', () => {
  const { descriptors, unmodeled, inactive } = resolveBarrageDescriptors(['77777'], simDeps());
  assert.equal(descriptors.length, 1, 'the live half still contributes its row');
  assert.equal(unmodeled, 1, 'the onSink half is disclosed beside it');
  assert.equal(inactive, 0);
});

// One weapon under two triggers is two ROWS, and the burn is attached by the BULLET —
// so it ticks off the weapon's whole schedule, not off whichever row won the group
// tie-break. Four roster burns have this shape (뉴저지 14510 w64220, 아사마 151640
// w169200, 마세나 151400 w168930, 알제리 13270 w69390) and under-counted by up to 4x.
test('a burn on a weapon fired under two triggers counts BOTH schedules', () => {
  // life 15.1 over a 3 s tick is 5 ticks per activation and the window never caps it,
  // so the burn tick count IS the activation sum, readable straight off the assertion.
  const dot = { a: 'cannon', int: 3, life: 15.1, dmg: 100 };
  const deps = simDeps({
    getBullet: (id) => (id === 1401
      ? { damage_type: [1, 0.8, 0.5], ammo_type: 1,
          attach_buff: [{ buff_id: 311, buff_level: 1, rant: 10000, hit_ignore: 1, group_level: 1 }] }
      : getBullet(id)),
    getDot: (id) => (String(id) === '311' ? dot : null),
  });
  const { descriptors } = resolveBarrageDescriptors(['66666'], deps);
  const weaponRows = descriptors.filter((d) => d.tickDamage == null);
  const burn = descriptors.find((d) => d.tickDamage != null);
  assert.equal(weaponRows.length, 2, 'two triggers on one weapon are two rows');
  const total = weaponRows.reduce((n, d) => n + d.activations, 0);
  assert.equal(total, 4, 'onStartGame at t=0 plus onUpdate at 30/60/90');
  assert.ok(burn, 'the barrage attaches a burn');
  assert.equal(burn.activations, 20, 'floor(4 x 15.1 / 3) — the SUM, not one row');

  // The single-trigger control: reading one row would have reported this instead.
  const solo = { ...deps.graph, b: { ...deps.graph.b, 66666: { e: [deps.graph.b[66666].e[0]] } } };
  const { descriptors: one } = resolveBarrageDescriptors(['66666'], simDeps({ ...deps, graph: solo }));
  assert.equal(one.find((d) => d.tickDamage != null).activations, 5);
});

test('resolveBarrageDescriptors fails safe when the graph never loaded', () => {
  const { descriptors, unmodeled } = resolveBarrageDescriptors(['29081', '99999'], simDeps({ graph: null }));
  assert.deepEqual(descriptors, []);
  assert.equal(unmodeled, 2);
});

test('attachedSPBarrageIds dedupes the per-level ladder and skips the ship own skills', () => {
  // 10703's shape: the same pair repeated once per enhancement level, descending cooldown.
  const ship = {
    skill: { 14170: { weapon_true: true }, 14180: { weapon_true: true, requirement: 'Retrofit' } },
    sp_weapon: {
      attached_weapon_skill_id: [
        { id: 1090141, time: 20 }, { id: 1090142, time: 20 },
        { id: 1090141, time: 10 }, { id: 1090142, time: 10 },
        { id: 14170 },   // already in ship.skill — activeBarrageSkillIds owns it
      ],
    },
  };
  assert.deepEqual(attachedSPBarrageIds(ship), ['1090141', '1090142']);
  assert.deepEqual(attachedSPBarrageIds({ skill: {} }), []);
  // 드레이크: one attached id, not among her own skills.
  assert.deepEqual(
    attachedSPBarrageIds({ skill: { 19300: {}, 18300: {} }, sp_weapon: { attached_weapon_skill_id: [{ id: 1019301, time: 10 }] } }),
    ['1019301']);
});
