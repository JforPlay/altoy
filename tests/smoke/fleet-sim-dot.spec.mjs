/**
 * 라이온 is the fixture because her burn is the one that exercises every branch
 * of the lane at once: hit_ignore (so it attaches on a bare card), a permanent
 * buff (life 0), the only leveled record in the table, and the only reachable
 * one carrying 받는 피해.
 */
import { test, expect } from '@playwright/test';

const PAGE = 'simulators/fleet-sim/';

test('a burn renders as its own 지속 피해 row with no hit or crit', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('.ship-card[data-slot="0"] .ship-card-add').click();
  await expect(page.locator('#ship-picker-grid .picker-item').first()).toBeVisible();
  const unfiltered = await page.locator('#ship-picker-grid .picker-item').count();
  await page.locator('#ship-picker-search').fill('라이온');
  // The picker is debounced, so asserting the target alone would pass on the
  // unfiltered list; assert the list actually narrowed first.
  await expect(page.locator('#ship-picker-grid .picker-item')).not.toHaveCount(unfiltered);
  await page.locator('#ship-picker-grid .picker-item').first().click();

  await page.locator('.ship-card[data-slot="0"] .stats-toggle').click();

  const rows = page.locator('.ship-card[data-slot="0"] .dmg-weapon-table tbody tr');
  const burn = rows.filter({ hasText: '지속 피해 ·' });
  await expect(burn).toHaveCount(1);
  // Ticks are a cadence, not a reload: the burn ticks every 3s for as long as it
  // is up, which for 라이온 (buff time 0) is the whole fight.
  await expect(burn.locator('td').nth(2)).toHaveText('3초마다');
  // A DOT tick is direct damage — no armor, no hit roll, no crit roll — so those
  // columns must say so rather than print a 100% that never happened.
  await expect(burn.locator('td').nth(5)).toHaveText('—');
  await expect(burn.locator('td').nth(6)).toHaveText('—');
  // ...and it has to actually contribute, or the row is decoration.
  await expect(burn.locator('td').nth(4)).not.toHaveText('0');

  // Her burn also raises 받는 피해 for the WHOLE fleet, which is a different claim
  // from the boss's own always-on modifier and is labelled apart from it.
  await expect(page.locator('.dmg-target-injure').filter({ hasText: '지속 피해' })).toHaveCount(1);
});
