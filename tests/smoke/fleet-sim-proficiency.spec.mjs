/**
 * 숙련도 (BattleBuffAddProficiency) reaching the browser — the half no node test can
 * see. `_applyWeaponModifiers` is pure and its own suite hands it a built descriptor,
 * so a row whose `labels` / `gates` are lost somewhere between
 * `fleet_sim_passive_skills.json` and it leaves every one of those green while the
 * page applies the buff to everything, unconditionally. That exact field loss
 * happened once during this feature's own development, in `resolvePassiveBuffs`.
 *
 * 엠덴 15510 is the fixture because her buff is decided by a slot it does not touch.
 * The KR text is 「부무장 슬롯에 경순양함 주포 무기 장비 시, 주포, 부포 슬롯의 무기
 * 효율 상승」, and the game states that as a gated self-cast on buff_15510
 * (`check_weapon index:[2] label:["CL","MG"]`) rather than as a condition the emitted
 * row carries — so swapping her 부무장 from a DD gun to a CL gun raises her 주포
 * damage while her 주포 itself, and its level, stay exactly as they were.
 *
 * Verified non-vacuous: with the proficiency lane stubbed out the 주포 row reads the
 * same in both states, so the swap on its own cannot produce the rise.
 *
 * 엠덴 is a 경순양함 — 전열, so slots 3-5: the picker only offers ships that can take
 * the row it was opened for.
 *
 * NO LABEL FIXTURE EXISTS, and the reason is worth keeping. A `labels` filter scopes
 * WHICH weapon is buffed, so flipping it means changing that weapon — and the swap
 * moves the row for its own reasons, by far more than 15% either way (키타카제 19170's
 * candidate guns span DPS 18 to 252). Worse, the failure it would have to catch is
 * invisible to a differential: drop `labels` from a row that carries no `slots` and
 * the buff applies to every weapon in EVERY state, shifting a constant, not a delta.
 * The node suite's matcher tests are the only place that check can live.
 */
import { test, expect } from '@playwright/test';

const PAGE = 'simulators/fleet-sim/';

async function addShip(page, slot, name) {
  await page.locator(`.ship-card[data-slot="${slot}"] .ship-card-add`).click();
  await expect(page.locator('#ship-picker-grid .picker-item').first()).toBeVisible();
  const unfiltered = await page.locator('#ship-picker-grid .picker-item').count();
  await page.locator('#ship-picker-search').fill(name);
  // The picker is debounced: assert the list NARROWED before asserting the target,
  // or the click lands on the unfiltered list and the search is never observed.
  await expect(page.locator('#ship-picker-grid .picker-item')).not.toHaveCount(unfiltered);
  await page.locator('#ship-picker-grid .picker-item', { hasText: name }).first().click();
  await expect(page.locator(`.ship-card[data-slot="${slot}"] .ship-vitals`)).toBeVisible();
}

async function fitEquip(page, slot, index, name) {
  await page.locator(`.ship-card[data-slot="${slot}"] .equip-slot[data-equip-index="${index}"]`).click();
  await expect(page.locator('#equip-picker-grid .picker-item').first()).toBeVisible();
  const unfiltered = await page.locator('#equip-picker-grid .picker-item').count();
  await page.locator('#equip-picker-search').fill(name);
  await expect(page.locator('#equip-picker-grid .picker-item')).not.toHaveCount(unfiltered);
  // By NAME, not `.first()`: once a slot is filled the grid leads with a 장착 해제
  // entry the search box does not filter out, so `.first()` empties the slot instead.
  await page.locator('#equip-picker-grid .picker-item', { hasText: name }).first().click();
}

/** 일격 (per-hit damage) of one row of a card's weapon breakdown. */
const hit = (page, slot, label) =>
  page.locator(`.ship-card[data-slot="${slot}"] .dmg-weapon-table tbody tr`)
    .filter({ hasText: label }).first().locator('td').nth(1);

const num = async (loc) => Number((await loc.innerText()).replace(/,/g, ''));

test('an install gate decides whether the 숙련도 buff applies, off a slot it does not touch', async ({ page }) => {
  await page.goto(PAGE);
  await addShip(page, 3, '엠덴');
  await page.locator('.ship-card[data-slot="3"] .stats-toggle').click();

  await fitEquip(page, 3, 0, '128mm SKC/41 연장 양용포');
  const main = hit(page, 3, '주포');
  await expect(main).toBeVisible();

  // 부무장 slot holding a DD gun — the gate wants a 경순양함 주포 there.
  await fitEquip(page, 3, 1, '128mm SKC/41 연장 양용포');
  await expect(main).not.toHaveText('');
  const gateShut = await num(main);

  // Same 주포, same slot, same level. Only the OTHER slot changed. Her barrage row
  // appearing is the same gate opening, and it is what says the re-render landed.
  await fitEquip(page, 3, 1, '152mm 단장포');
  await expect(page.locator('.ship-card[data-slot="3"] .dmg-weapon-table .dmg-row-barrage')
    .filter({ hasText: 'Eeny meeny miny moe' })).toHaveCount(1);
  expect(await num(main)).toBeGreaterThan(gateShut);
});
