/**
 * A class-gated passive reaches its own class and nobody else — the browser half of
 * the static `tag_list` seed. The node tests cover `_clauseApplies` directly; what
 * only a page can show is that `ship_info_data.json`'s new field actually arrives at
 * it, so the fixture is a DIFFERENTIAL and both halves are load-bearing:
 *
 *   퀸시     Astoria-Class   포격 must RISE   — proves the tag is read
 *   펜사콜라  Pensacola-Class 포격 must HOLD   — proves it is not read as "any tag"
 *
 * Without the rise, a build where `tag_list` never reaches the ship record passes
 * this test by blocking every clause — the failure the seed was written to fix,
 * wearing the other sign.
 *
 * 아스토리아 is the caster because 11470 Nasty Asty is her ONLY passive and its
 * `cannonPower +10%` lands on 포격, a headline vital on every 중순. Her two
 * fleet-mates carry no passive of their own, so nothing else can move a number here.
 *
 * All three sit in slots 3-5: the picker offers only the ships that can take the row
 * it was opened for (getShipsByPosition), and a 중순 is 전열, so searching for one
 * from a 주력 slot returns nothing at all.
 */
import { test, expect } from '@playwright/test';

const PAGE = 'simulators/fleet-sim/';

async function addShip(page, slot, name) {
  await page.locator(`.ship-card[data-slot="${slot}"] .ship-card-add`).click();
  await expect(page.locator('#ship-picker-grid .picker-item').first()).toBeVisible();
  const unfiltered = await page.locator('#ship-picker-grid .picker-item').count();
  await page.locator('#ship-picker-search').fill(name);
  // The picker is debounced, so assert the list NARROWED before asserting the
  // target — otherwise the click lands on the unfiltered list and the search is
  // never observed at all.
  await expect(page.locator('#ship-picker-grid .picker-item')).not.toHaveCount(unfiltered);
  await page.locator('#ship-picker-grid .picker-item', { hasText: name }).first().click();
  await expect(page.locator(`.ship-card[data-slot="${slot}"] .ship-vitals`)).toBeVisible();
}

const firepower = (page, slot) =>
  page.locator(`.ship-card[data-slot="${slot}"] .vital-stat`)
    .filter({ hasText: '포격' }).locator('.vital-value');

test('a class-gated passive raises its own class and leaves the rest of the fleet alone', async ({ page }) => {
  await page.goto(PAGE);
  await addShip(page, 3, '퀸시');
  await addShip(page, 4, '펜사콜라');

  const before = { quincy: await firepower(page, 3).innerText(),
                   pensacola: await firepower(page, 4).innerText() };

  await addShip(page, 5, '아스토리아');

  // Assert the RISE first: it retries, so it also waits out the fleet re-render that
  // the hold below depends on having finished.
  await expect(firepower(page, 3)).not.toHaveText(before.quincy);
  expect(Number(await firepower(page, 3).innerText())).toBeGreaterThan(Number(before.quincy));
  await expect(firepower(page, 4)).toHaveText(before.pensacola);
});
