/**
 * A timer barrage contributes to the breakdown with no equipment fitted, which
 * is why 워싱턴 (매 20초) is the fixture rather than a count-based ship: a count
 * barrage counts weapon FIRES, so an unequipped card correctly shows nothing.
 */
import { test, expect } from '@playwright/test';

const PAGE = 'simulators/fleet-sim/';

test('a timer barrage renders as a 탄막 row carrying its cadence, not a reload time', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('.ship-card[data-slot="0"] .ship-card-add').click();
  await expect(page.locator('#ship-picker-grid .picker-item').first()).toBeVisible();
  const unfiltered = await page.locator('#ship-picker-grid .picker-item').count();
  await page.locator('#ship-picker-search').fill('워싱턴');
  // Assert the search actually narrowed the list BEFORE asserting the target —
  // the picker is debounced, so a "target is present" assertion alone passes on
  // the unfiltered list and never observes the filter at all.
  await expect(page.locator('#ship-picker-grid .picker-item')).not.toHaveCount(unfiltered);
  await page.locator('#ship-picker-grid .picker-item').first().click();

  // The breakdown table lives inside the per-card stats collapsible, which
  // starts collapsed for every slot — open it before looking for the row.
  await page.locator('.ship-card[data-slot="0"] .stats-toggle').click();

  const barrage = page.locator('.ship-card[data-slot="0"] .dmg-weapon-table .dmg-row-barrage');
  await expect(barrage.first()).toBeVisible();
  await expect(barrage.first().locator('td').nth(0)).toContainText('탄막 ·');
  // The proc chance is part of the cadence: 워싱턴 rolls 70% every 20s, and without
  // it the column contradicts the 발사/90초 beside it (90 / 20 != 2.8).
  await expect(barrage.first().locator('td').nth(2)).toHaveText('20초마다 70%');
});

test('a second recompute does not duplicate the unmodelled-barrage note', async ({ page }) => {
  // 윌리엄 D 포터 is a DD (전열/front-row type) — slots 0-2 are 후열, so she must
  // go in a front-row slot (3-5) or the picker legitimately shows zero matches.
  // She carries a barrage gap, unlike 워싱턴 above, which is the point:
  // _buildWeaponBreakdownHTML returns [table, note] and the incremental patch in
  // _updateCardBreakdowns must clean up EVERY sibling before re-appending, not
  // just the table, or the note orphans on every recompute after the first.
  await page.goto(PAGE);
  await page.locator('.ship-card[data-slot="3"] .ship-card-add').click();
  await expect(page.locator('#ship-picker-grid .picker-item').first()).toBeVisible();
  const unfiltered = await page.locator('#ship-picker-grid .picker-item').count();
  await page.locator('#ship-picker-search').fill('윌리엄 D 포터');
  await expect(page.locator('#ship-picker-grid .picker-item')).not.toHaveCount(unfiltered);
  await page.locator('#ship-picker-grid .picker-item').first().click();

  await page.locator('.ship-card[data-slot="3"] .stats-toggle').click();
  const note = page.locator('.ship-card[data-slot="3"] .dmg-unmodeled-note');
  const table = page.locator('.ship-card[data-slot="3"] .dmg-weapon-table');
  // Confirms the FIRST damage recompute has landed and this ship is actually a
  // note-bearing fixture — a ship with no barrage gaps (like 워싱턴) cannot
  // exercise this at all.
  //
  // She used to show TWO notes, the second being a count barrage that reads fine
  // but counts weapon FIRES an unequipped card had none of. Since
  // `default_equip_list` reached `ship_info_data.json` an empty slot is no longer
  // an idle slot - the card arms the ship's default guns and the count barrage
  // activates - so that note is gone here, and is now hard to reach at all.
  await expect(note).toHaveCount(1);
  await expect(note).toHaveText(/발동 조건이 아직 구현되지 않은/);

  // Trigger a second recompute cycle without touching the ship itself. The
  // adapt row is rebuilt only inside renderDamagePanel's async completion, so
  // waiting for the clicked button's is-active class confirms the SECOND
  // cycle has actually landed rather than racing the first.
  const fullAdaptBtn = page.locator('.dmg-adapt-btn[data-adapt="full"]');
  await fullAdaptBtn.click();
  await expect(fullAdaptBtn).toHaveClass(/is-active/);

  await expect(table).toHaveCount(1);
  await expect(note).toHaveCount(1);
});
