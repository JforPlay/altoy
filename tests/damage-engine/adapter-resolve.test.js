// tests/damage-engine/adapter-resolve.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barrageBulletCount, attackAttributeKey, resolveWeaponDescriptor, mergeWeaponWithBase, effectiveProficiency,
  salvosBySlot, activeBarrageSkillIds, cadenceLabel, resolveBarrageDescriptors }
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

test('salvosBySlot keys the window salvo count by equip slot (1-based)', () => {
  // slot index in the data is 1-based; descriptors carry a 0-based slotIndex.
  const descriptors = [
    { slotIndex: 0, reloadMax: 240, cycleExtra: 0 },
    { slotIndex: 1, reloadMax: 480, cycleExtra: 0 },
  ];
  const out = salvosBySlot(descriptors, 150, 90);
  assert.ok(out[1] > out[2], 'the faster weapon must fire more often');
  assert.ok(Number.isInteger(out[1]));
});

test('cadenceLabel renders Korean from the machine trigger, and nothing for unknown kinds', () => {
  assert.equal(cadenceLabel({ k: 'count', n: 15, slots: [1] }), '주포 15회마다');
  assert.equal(cadenceLabel({ k: 'count', n: 10 }), '10회 발사마다');
  assert.equal(cadenceLabel({ k: 'timer', n: 20, d: 20 }), '20초마다');
  assert.equal(cadenceLabel({ k: 'timer', n: 20, d: 5 }), '5초 후 20초마다');
  assert.equal(cadenceLabel({ k: 'fire', n: 12, d: 12 }), '발사 시 (재사용 12초)');
  assert.equal(cadenceLabel({ k: 'air' }), '항공 공격 시');
  assert.equal(cadenceLabel({ k: 'once' }), '전투 시작 시');
  assert.equal(cadenceLabel({ k: 'nope' }), '');
});

test('resolveBarrageDescriptors builds one descriptor per fired weapon and counts the rest', () => {
  const table = {
    '29081': { n: '전탄 발사 - 재블린I', w: [900], t: { k: 'count', n: 15, slots: [1] } },
    '99999': { n: '알 수 없음', w: [901], t: { k: 'conditional' } },   // unknown kind
  };
  const weapons = {
    900: { damage: 30, corrected: 100, attack_attribute: 1, attack_attribute_ratio: 80,
           reload_max: 0, barrage_ID: [8], bullet_ID: [1400] },
    901: { damage: 30, corrected: 100, attack_attribute: 1, attack_attribute_ratio: 80,
           reload_max: 0, barrage_ID: [8], bullet_ID: [1400] },
  };
  const { descriptors, unmodeled } = resolveBarrageDescriptors(['29081', '99999', '404040'], {
    getBarrageSkill: (id) => table[id] || null,
    getWeapon: (id) => weapons[id] || null,
    getBarrage, getBullet,
    stats: { firepower: 500, torpedo: 0, aviation: 0 },
    ctx: { window: 90, salvosBySlot: { 1: 30 }, airstrikes: 0 },
  });
  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].activations, 2);
  assert.equal(descriptors[0].potential, 1, 'a barrage is not equipment — no proficiency');
  assert.equal(descriptors[0].cycleExtra, 0, 'a barrage has no gun fire cycle');
  assert.equal(descriptors[0].label, '탄막 · 전탄 발사 - 재블린I');
  assert.equal(descriptors[0].cadence, '주포 15회마다');
  // Both the unknown kind AND the id missing from the table count as unmodelled:
  // activeBarrageSkillIds already filters to weapon_true skills, so every id passed
  // in here IS a real barrage by R5's own definition — the table simply couldn't
  // resolve two of the three (design doc §D step 4 / §A: an unresolved barrage
  // skill is not silently dropped, it is counted).
  assert.equal(unmodeled, 2);
});

test('resolveBarrageDescriptors counts a table-absent skill id as unmodeled on its own', () => {
  const { descriptors, unmodeled } = resolveBarrageDescriptors(['404040'], {
    getBarrageSkill: () => null,   // not in fleet_sim_barrages.json at all
    getWeapon: () => null,
    getBarrage, getBullet,
    stats: { firepower: 500, torpedo: 0, aviation: 0 },
    ctx: { window: 90, salvosBySlot: {}, airstrikes: 0 },
  });
  assert.deepEqual(descriptors, []);
  assert.equal(unmodeled, 1);
});

test('resolveBarrageDescriptors counts a skill unmodeled when every one of its weapon ids fails to resolve', () => {
  const table = {
    '50000': { n: '테스트', w: [999], t: { k: 'count', n: 15, slots: [1] } },
  };
  const { descriptors, unmodeled } = resolveBarrageDescriptors(['50000'], {
    getBarrageSkill: (id) => table[id] || null,
    getWeapon: () => null,   // every weapon id fails to resolve
    getBarrage, getBullet,
    stats: { firepower: 500, torpedo: 0, aviation: 0 },
    ctx: { window: 90, salvosBySlot: { 1: 30 }, airstrikes: 0 },
  });
  assert.deepEqual(descriptors, []);
  assert.equal(unmodeled, 1);
});

// "발동 조건을 계산할 수 없는" is the wrong thing to say about a barrage whose
// condition was computed and came out zero — an unequipped ship, a carrier (no
// air descriptor carries a slotIndex, so salvosBySlot is empty), a 대공-slot
// trigger. Both stay visible (D3), but they are different answers.
test('resolveBarrageDescriptors counts a zero-activation barrage apart from an unreadable one', () => {
  const table = {
    '29081': { n: '전탄 발사', w: [900], t: { k: 'count', n: 15, slots: [1] } },
    '99999': { n: '알 수 없음', w: [900], t: { k: 'conditional' } },
  };
  const weapons = {
    900: { damage: 30, corrected: 100, attack_attribute: 1, attack_attribute_ratio: 80,
           reload_max: 0, barrage_ID: [8], bullet_ID: [1400] },
  };
  const deps = (salvos) => ({
    getBarrageSkill: (id) => table[id] || null,
    getWeapon: (id) => weapons[id] || null,
    getBarrage, getBullet,
    stats: { firepower: 500, torpedo: 0, aviation: 0 },
    ctx: { window: 90, salvosBySlot: salvos, airstrikes: 0 },
  });
  const empty = resolveBarrageDescriptors(['29081', '99999'], deps({}));   // nothing equipped
  assert.deepEqual(empty.descriptors, []);
  assert.equal(empty.inactive, 1, 'the count barrage read fine; this loadout just never fires it');
  assert.equal(empty.unmodeled, 1, 'only the unreadable trigger is unmodelled');

  const armed = resolveBarrageDescriptors(['29081', '99999'], deps({ 1: 30 }));
  assert.equal(armed.descriptors.length, 1);
  assert.equal(armed.inactive, 0);
  assert.equal(armed.unmodeled, 1);
});

test('cadenceLabel keeps the proc chance beside the period', () => {
  // 워싱턴: `20초마다` alone reads as 4.5 activations against a 발사/90초 of 2.8.
  assert.equal(cadenceLabel({ k: 'timer', n: 20, d: 20 }, 7000), '20초마다 70%');
  assert.equal(cadenceLabel({ k: 'timer', n: 20, d: 20 }), '20초마다');
  assert.equal(cadenceLabel({ k: 'timer', n: 20, d: 20 }, 10000), '20초마다');
  assert.equal(cadenceLabel({ k: 'count', n: 15, slots: [1] }, 7500), '주포 15회마다 75%');
  assert.equal(cadenceLabel({ k: 'fire', n: 0 }, 100), '발사 시 1%');
  assert.equal(cadenceLabel({ k: 'conditional' }, 7000), '', 'an unknown kind stays unlabelled');
});

test('resolveBarrageDescriptors fails safe when getBarrageSkill is not callable (Task 8 not yet landed, or a stale cache)', () => {
  const { descriptors, unmodeled } = resolveBarrageDescriptors(['29081', '99999'], {
    getWeapon: () => null,
    getBarrage, getBullet,
    stats: { firepower: 500, torpedo: 0, aviation: 0 },
    ctx: { window: 90, salvosBySlot: {}, airstrikes: 0 },
  });
  assert.deepEqual(descriptors, []);
  assert.equal(unmodeled, 2);
});
