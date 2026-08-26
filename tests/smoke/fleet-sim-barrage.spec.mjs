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
  await expect(barrage.first().locator('td').nth(2)).toHaveText('20초마다');
});

test('a second recompute does not duplicate the 미모델 note', async ({ page }) => {
  // 윌리엄 D 포터 is a DD (전열/front-row type) — slots 0-2 are 후열, so she must
  // go in a front-row slot (3-5) or the picker legitimately shows zero matches.
  // She carries unmodelled barrages, unlike 워싱턴 above, which is the point:
  // _buildWeaponBreakdownHTML's return can be [table, note] now, and the
  // incremental patch in _updateCardBreakdowns must clean up BOTH siblings
  // before re-appending, not just the table, or the note orphans on every
  // recompute after the first.
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
  // note-bearing fixture — a ship with unmodeledBarrages === 0 (like 워싱턴)
  // cannot exercise this at all.
  await expect(note).toHaveCount(1);

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
