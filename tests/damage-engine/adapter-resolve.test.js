// tests/damage-engine/adapter-resolve.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barrageBulletCount, attackAttributeKey, resolveWeaponDescriptor, mergeWeaponWithBase, effectiveProficiency }
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
