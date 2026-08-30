/**
 * shipgirl-info.equip-slots.js
 * Pure, DOM-free logic + HTML builder for the shipgirl-info "장비 효율" section.
 *
 * Mirrors the game's equipment screen: efficiency is shown only for weapon
 * slots (the game hides it for device slots via `not isDevice()` in
 * shipequipview.lua). Slot indexing, the device-type set, and the 포좌 count
 * (base_list) were all verified against AzurLaneLuaScripts/KR — see the spec
 * dev/active/2026-05-31-shipgirl-equip-slot-info.md.
 *
 * The type-name resolver is injected (getTypeName) so this module imports
 * nothing DOM-dependent and stays unit-testable under node --test.
 */

'use strict';

// Device equip types — equiptype.lua DeviceEquipTypes. Slots holding ONLY
// these never show efficiency in-game (Equipment, Sonar, AntiSubAircraft,
// Helicopter, Goods). Used to gate which slots we render.
export const DEVICE_EQUIP_TYPES = new Set([10, 14, 15, 17, 18]);

// Aircraft equip types — equiptype.lua AirDomainEquip. Slots holding these
// report a 함재기 (plane) count rather than a 포좌 (mount) count.
export const AIRCRAFT_EQUIP_TYPES = new Set([7, 8, 9, 12]);

import { limitBreakSteps } from '../ship-stat-table.js';

/** True if the slot accepts at least one non-device (weapon) equip type. */
export function slotIsWeapon(typeIds) {
  return Array.isArray(typeIds) && typeIds.some(id => !DEVICE_EQUIP_TYPES.has(id));
}

/** True if the slot accepts an aircraft type (count is 함재기, not 포좌). */
export function isAircraftSlot(typeIds) {
  return Array.isArray(typeIds) && typeIds.some(id => AIRCRAFT_EQUIP_TYPES.has(id));
}

/**
 * Build the efficiency view-model for a slot.
 *
 * `final` is the max-LB (MLB) value; `lbBase` is the base-LB (LB0) value, set
 * only when it differs from final (so unchanged slots render a single number).
 * Retrofit (`withRetrofit`) applies on top of the MLB value.
 *
 * @param {number} profFinal equipment_proficiency[i] — MLB (e.g. 1.3)
 * @param {(number|null)} profBase equipment_proficiency_base[i] — LB0 (e.g. 1.2)
 * @param {number} retrofitDelta retrofit.bonus.equipment_proficiency_N (0 if none)
 * @returns {{final:number, lbBase:(number|null), deltaPercent:number, withRetrofit:(number|null)}}
 */
export function formatEfficiency(profFinal, profBase = null, retrofitDelta = 0) {
  const final = Math.round(profFinal * 100);
  const baseRounded = (profBase != null) ? Math.round(profBase * 100) : null;
  const lbBase = (baseRounded != null && baseRounded !== final) ? baseRounded : null;
  const out = { final, lbBase, deltaPercent: 0, withRetrofit: null };
  if (retrofitDelta > 0) {
    out.deltaPercent = Math.round(retrofitDelta * 100);
    out.withRetrofit = Math.round((profFinal + retrofitDelta) * 100);
  }
  return out;
}

/**
 * 포좌/함재기 count string across limit-break stages.
 * The map is { sid: [s1,s2,s3] }; `limitBreakSteps` orders and names those keys,
 * because ascending key order is NOT ladder order — 카스미's 改 table sorts
 * first, so "the first key" was her 改 count and the stage name was the label one
 * rung above the one that granted the mount. Constant → "포좌 N"; increasing →
 * "포좌 a → b (stage)".
 */
export function formatMountProgression(ship, baseList, slotIndex, isAircraft = false) {
  const word = isAircraft ? '함재기' : '포좌';
  const steps = limitBreakSteps(ship, baseList).filter(s => baseList[s.key]);
  if (steps.length === 0) return `${word} 0`;
  const counts = steps.map(s => baseList[s.key][slotIndex]);
  const first = counts[0];
  const max = Math.max(...counts);
  if (max === first) return `${word} ${first}`;
  const at = steps[counts.findIndex(c => c === max)];
  return `${word} ${first} → ${max} (${at.label})`;
}

/**
 * Build one view-model per rendered weapon slot (slots 1–3).
 * Skips empty and device-only slots so the output mirrors the in-game display.
 * @param {object} ship ship_info_data entry
 * @param {(id:number)=>string} getTypeName equip-type id → Korean name
 */
export function buildSlotViewModels(ship, getTypeName) {
  const prof = ship.equipment_proficiency || [];           // MLB efficiency
  const profBase = ship.equipment_proficiency_base || [];  // LB0 efficiency (optional)
  // `mounts` is the firing 포좌 count; `base_list` is the weapon-unit count,
  // which on a 전함 주포 slot is the charge-stack cap (주포 장전 상한) instead.
  // See fleet-sim.calc.js getShipBaseList. Fallback keeps older data rendering.
  const baseList = ship.mounts || ship.base_list || {};
  const out = [];

  for (let slotIndex = 0; slotIndex < 3; slotIndex++) {
    const slotNo = slotIndex + 1;
    const typeIds = ship['equip_' + slotNo] || [];
    if (typeIds.length === 0) continue;
    if (!slotIsWeapon(typeIds)) continue;            // device slot — game hides efficiency
    const p = prof[slotIndex];
    if (p == null) continue;

    const retrofitDelta = (ship.retrofit && ship.retrofit.bonus
      && ship.retrofit.bonus['equipment_proficiency_' + slotNo]) || 0;

    const aircraft = isAircraftSlot(typeIds);
    const retroTypes = ship.retrofit && ship.retrofit['equip_' + slotNo];
    const retrofitTypeNote = (retroTypes && JSON.stringify(retroTypes) !== JSON.stringify(typeIds))
      ? retroTypes.map(id => getTypeName(id)).join('/')
      : null;

    out.push({
      slotNo,
      typeName: typeIds.map(id => getTypeName(id)).join('/'),
      eff: formatEfficiency(p, profBase[slotIndex] ?? null, retrofitDelta),
      mountText: formatMountProgression(ship, baseList, slotIndex, aircraft),
      retrofitTypeNote,
    });
  }
  return out;
}

/**
 * Build the "장비 효율" section HTML string. Returns '' when the ship has no
 * weapon slots to show. No DOM — caller injects via innerHTML.
 * @param {object} ship ship_info_data entry
 * @param {(id:number)=>string} getTypeName equip-type id → Korean name
 */
export function renderEquipSlotSection(ship, getTypeName) {
  const slots = buildSlotViewModels(ship, getTypeName);
  if (slots.length === 0) return '';

  const cards = slots.map(s => {
    // base → MLB progression when the LB0 value differs; single number otherwise.
    const effValue = s.eff.lbBase != null
      ? `${s.eff.lbBase}% → ${s.eff.final}%`
      : `${s.eff.final}%`;
    const retroEff = s.eff.withRetrofit != null
      ? ` <span class="equip-slot-eff-retrofit">(개조 +${s.eff.deltaPercent}% → ${s.eff.withRetrofit}%)</span>`
      : '';
    const retroTypeNote = s.retrofitTypeNote
      ? `<div class="equip-slot-retrofit-note">개조 후: ${s.retrofitTypeNote}</div>`
      : '';
    return `
        <div class="equip-slot-card">
          <div class="equip-slot-head">슬롯 ${s.slotNo} · ${s.typeName}</div>
          <div class="equip-slot-eff">효율 ${effValue}${retroEff}</div>
          <div class="equip-slot-mounts">${s.mountText}</div>
          ${retroTypeNote}
        </div>`;
  }).join('');

  return `
      <div class="equip-slot-section">
        <h3 class="section-title">장비 효율</h3>
        <div class="equip-slot-grid">${cards}</div>
      </div>`;
}
