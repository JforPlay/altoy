import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_EQUIP_TYPES,
  AIRCRAFT_EQUIP_TYPES,
  slotIsWeapon,
  isAircraftSlot,
  formatEfficiency,
  formatMountProgression,
  buildSlotViewModels,
  renderEquipSlotSection,
} from '../../public/js/shipgirl/shipgirl-info.equip-slots.js';

// Stub type-name resolver (real one reads state.equipTypeData in the browser).
const NAMES = { 1: '함포', 2: '함포', 5: '어뢰', 6: '대공포', 7: '전투기', 8: '뇌격기', 9: '폭격기', 10: '기타', 14: '설비' };
const getTypeName = (id) => NAMES[id] || `타입 ${id}`;

test('device/aircraft type sets match the game (equiptype.lua)', () => {
  assert.deepEqual([...DEVICE_EQUIP_TYPES].sort((a, b) => a - b), [10, 14, 15, 17, 18]);
  assert.deepEqual([...AIRCRAFT_EQUIP_TYPES].sort((a, b) => a - b), [7, 8, 9, 12]);
});

test('slotIsWeapon: weapon true, all-device false', () => {
  assert.equal(slotIsWeapon([5]), true);          // torpedo
  assert.equal(slotIsWeapon([10, 14]), false);    // device-only aux slot
  assert.equal(slotIsWeapon([10, 5]), true);      // any non-device → weapon
  assert.equal(slotIsWeapon([]), false);
});

test('isAircraftSlot', () => {
  assert.equal(isAircraftSlot([8]), true);
  assert.equal(isAircraftSlot([6]), false);
});

test('formatEfficiency: final only, with LB base, with retrofit', () => {
  assert.deepEqual(formatEfficiency(1.3), { final: 130, lbBase: null, deltaPercent: 0, withRetrofit: null });
  assert.deepEqual(formatEfficiency(1.3, 1.2), { final: 130, lbBase: 120, deltaPercent: 0, withRetrofit: null });
  // base equal to final → no progression shown
  assert.deepEqual(formatEfficiency(1.3, 1.3), { final: 130, lbBase: null, deltaPercent: 0, withRetrofit: null });
  assert.deepEqual(formatEfficiency(1.3, 1.2, 0.05), { final: 130, lbBase: 120, deltaPercent: 5, withRetrofit: 135 });
});

test('formatMountProgression: constant, increasing, aircraft wording', () => {
  const cashin = { sid: 101031 };
  const constant = { '101031': [1, 1, 1], '101034': [1, 1, 1] };
  assert.equal(formatMountProgression(cashin, constant, 0, false), '포좌 1');

  const increasing = { '101031': [1, 1, 1], '101032': [1, 1, 1], '101033': [1, 2, 1], '101034': [1, 2, 1] };
  assert.equal(formatMountProgression(cashin, increasing, 1, false), '포좌 1 → 2 (한계돌파 2)');

  assert.equal(formatMountProgression(cashin, increasing, 1, true), '함재기 1 → 2 (한계돌파 2)');
});

test('formatMountProgression reads the ladder by ID, not by key order', () => {
  // 카스미: her 改 table 301534 sorts FIRST, so ascending key order made its
  // count the "base" (a flat 포좌 2) and named the stage one rung too high.
  const kasumi = { sid: 301811, retrofit: { id: 301534 } };
  const mounts = {
    '301534': [1, 2, 1], '301811': [1, 1, 1], '301812': [1, 1, 1],
    '301813': [1, 2, 1], '301814': [1, 2, 1],
  };
  assert.equal(formatMountProgression(kasumi, mounts, 1, false), '포좌 1 → 2 (한계돌파 2)');

  // 안샨: her two 改 tables are the 미구-전열/후열 pair, so the mount she gains
  // there is named 개조, never 한계돌파 4.
  const anshan = { sid: 501011, retrofit: { id: 520014 } };
  const anshanMounts = {
    '501011': [1, 1, 1], '501012': [1, 1, 1], '501013': [1, 2, 1],
    '501014': [1, 2, 1], '520014': [2, 1, 1], '521014': [2, 1, 1],
  };
  assert.equal(formatMountProgression(anshan, anshanMounts, 0, false), '포좌 1 → 2 (개조 · 전열)');
});

test('buildSlotViewModels: 캐신-like DD (retrofit, torpedo 1→2)', () => {
  const ship = {
    equip_1: [1], equip_2: [5], equip_3: [6],
    equipment_proficiency: [1.2, 1.3, 1.3],
    equipment_proficiency_base: [1.1, 1.2, 1.2],
    sid: 101031,
    base_list: { '101031': [1, 1, 1], '101032': [1, 1, 1], '101033': [1, 2, 1], '101034': [1, 2, 1] },
    retrofit: { id: 1, bonus: { equipment_proficiency_1: 0.05, equipment_proficiency_2: 0.05, equipment_proficiency_3: 0.05 } },
  };
  const vms = buildSlotViewModels(ship, getTypeName);
  assert.equal(vms.length, 3);
  assert.equal(vms[0].typeName, '함포');
  assert.equal(vms[0].eff.final, 120);
  assert.equal(vms[0].eff.lbBase, 110);
  assert.equal(vms[0].eff.withRetrofit, 125);
  assert.equal(vms[1].mountText, '포좌 1 → 2 (한계돌파 2)');
  assert.equal(vms[1].eff.final, 130);
  assert.equal(vms[1].eff.lbBase, 120);
  assert.equal(vms[1].retrofitTypeNote, null);
});

test('buildSlotViewModels: 오마하-like CL hides device slot-4 (0.3)', () => {
  const ship = {
    equip_1: [2], equip_2: [5], equip_3: [6], equip_4: [10, 14], equip_5: [10, 14],
    equipment_proficiency: [1.2, 1.55, 1.3, 0.3],
    equipment_proficiency_base: [1.1, 1.45, 1.2, 0.3],
    sid: 102011,
    base_list: { '102011': [1, 1, 1], '102014': [1, 2, 1] },
  };
  const vms = buildSlotViewModels(ship, getTypeName);
  assert.equal(vms.length, 3, 'device slot 4 must not render');
  assert.equal(vms[1].eff.final, 155);
  assert.equal(vms[1].eff.lbBase, 145);
});

test('buildSlotViewModels: retrofit type swap note (에식스-like)', () => {
  const ship = {
    equip_1: [7], equip_2: [9], equip_3: [8],
    equipment_proficiency: [1, 1, 1],
    sid: 1,
    base_list: { '1': [1, 1, 1] },
    retrofit: { id: 1, equip_2: [7, 8, 9] },
  };
  const vms = buildSlotViewModels(ship, getTypeName);
  assert.equal(vms[1].retrofitTypeNote, '전투기/뇌격기/폭격기');
  assert.equal(vms[0].retrofitTypeNote, null);
});

test('renderEquipSlotSection: empty when no weapon slots', () => {
  const ship = { sid: 1, equip_1: [10], equipment_proficiency: [0.3], base_list: { '1': [1, 1, 1] } };
  assert.equal(renderEquipSlotSection(ship, getTypeName), '');
});

test('renderEquipSlotSection: renders cards with expected text', () => {
  const ship = {
    equip_1: [1], equip_2: [5], equip_3: [6],
    equipment_proficiency: [1.2, 1.3, 1.3],
    equipment_proficiency_base: [1.1, 1.2, 1.2],
    sid: 101031,
    base_list: { '101031': [1, 1, 1], '101033': [1, 2, 1] },
    retrofit: { id: 1, bonus: { equipment_proficiency_2: 0.05 } },
  };
  const html = renderEquipSlotSection(ship, getTypeName);
  assert.match(html, /class="equip-slot-section"/);
  assert.match(html, /슬롯 1 · 함포/);
  assert.match(html, /효율 110% → 120%/);
  assert.match(html, /효율 120% → 130%.*개조 \+5% → 135%/s);
  assert.match(html, /포좌 1 → 2/);
});

test('renderEquipSlotSection: single number when no base data', () => {
  const ship = {
    equip_1: [1], equip_2: [5], equip_3: [6],
    equipment_proficiency: [1.2, 1.3, 1.3],
    sid: 101031,
    base_list: { '101031': [1, 1, 1] },
  };
  const html = renderEquipSlotSection(ship, getTypeName);
  assert.match(html, /효율 120%/);
  assert.doesNotMatch(html, /→ 120%/);
});
