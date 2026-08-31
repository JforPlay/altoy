/**
 * A timer barrage contributes to the breakdown with no equipment fitted, which is
 * why 펜실베이니아 (20초마다 60%) is the fixture rather than a count-based ship: a
 * count barrage counts weapon FIRES, so an unequipped card correctly shows nothing.
 *
 * She also carries NO 전용 특수 장비, which matters: the SP skill remap swaps a
 * ship's rung for the one its maxed 전용 장비 fires, so a fixture that has one
 * would re-pin this test on whichever rung the data currently upgrades into.
 * 워싱턴 was that fixture and moved; she is now the remap's own fixture below.
 */
import { test, expect } from '@playwright/test';

const PAGE = 'simulators/fleet-sim/';

test('a timer barrage renders as a 탄막 row carrying its cadence, not a reload time', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('.ship-card[data-slot="0"] .ship-card-add').click();
  await expect(page.locator('#ship-picker-grid .picker-item').first()).toBeVisible();
  const unfiltered = await page.locator('#ship-picker-grid .picker-item').count();
  await page.locator('#ship-picker-search').fill('펜실베이니아');
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
  // The proc chance is NOT in the cadence any more: the simulator folds `rant` into
  // the activation count itself (a failed roll costs no cooldown, so it widens the
  // period rather than scaling a count), so a trailing 60% would state the same
  // discount twice. 발사/90초 beside it is already 60% of 90/20.
  await expect(barrage.first().locator('td').nth(2)).toHaveText('20초마다');
});

/**
 * A maxed 전용 특수 장비 REPLACES one of its ship's skills with an upgraded rung,
 * and the sim equips the dedicated weapon at max by default — so 워싱턴 fires
 * 1011000 영용포격+, not the 11000 용감한 포격 her card lists.
 *
 * The tell is her 경사 탄막 (weapon 165400, 「10초 후 20초마다」): ONLY the upgraded
 * rung casts it, and it rides beside the 20초마다 rows the base rung also fires. That
 * pair is the format ceiling this rework removed — 1011000 fires two barrages on two
 * cadences and the old one-record-per-skill table could hold one, so the remap used to
 * swap which half was modelled rather than adding the missing one.
 */
test('a maxed 전용 장비 swaps the barrage rung it fires', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('.ship-card[data-slot="0"] .ship-card-add').click();
  await expect(page.locator('#ship-picker-grid .picker-item').first()).toBeVisible();
  const unfiltered = await page.locator('#ship-picker-grid .picker-item').count();
  await page.locator('#ship-picker-search').fill('워싱턴');
  await expect(page.locator('#ship-picker-grid .picker-item')).not.toHaveCount(unfiltered);
  await page.locator('#ship-picker-grid .picker-item').first().click();
  await page.locator('.ship-card[data-slot="0"] .stats-toggle').click();

  const barrage = page.locator('.ship-card[data-slot="0"] .dmg-weapon-table .dmg-row-barrage');
  await expect(barrage.first()).toBeVisible();
  // Not `.first()`: the row order follows the sim's own, and the assertion is about
  // WHICH barrages are present, not where the 경사 탄막 sorts among them.
  await expect(barrage.filter({ hasText: '10초 후 20초마다' })).toHaveCount(1);
  // EXACT, on the cadence cell: '20초마다' is a SUBSTRING of the '10초 후 20초마다' row
  // asserted above, so a `hasText` filter on the row is satisfied by that row alone and
  // passes with the base rung — the thing this line exists to check — entirely gone.
  await expect(barrage.locator('td:nth-child(3)').filter({ hasText: /^\s*20초마다\s*$/ }).first())
    .toBeVisible();
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

/**
 * The `label` gate reaches the browser, which is the one thing the node tests cannot
 * see: `evalGate` is pure and its own suite feeds it a hand-built unit, so a bug where
 * `equipLabels` never gets onto `simCtx.unit` would leave every one of them green while
 * silently blocking all 113 label edges in production.
 *
 * 꼬마 아마기 14480 사전 방비 is the fixture, picked by simulating every SP-weapon-less
 * ship twice — once with every label in the graph, once with none — and taking the one
 * whose whole barrage output is the difference: weapon 64090 or nothing at all. Her
 * gate is `["BB", "MG", "AP"]`, so it also exercises the ALL-must-match rule: 410mm
 * 연장포 (삼식탄) is `[IJN, BB, MG, HE]` and 시제형 410mm 3연장포 is `[IJN, BB, MG, AP]`,
 * two 전함 주포 for the same slot differing in one label.
 *
 * Two things make a fixture unusable here and both cost a rewrite before this one:
 * a 전용 특수 장비 (the sim fits it at max, and its skill remap swaps the rung for one
 * gated on a DIFFERENT label — 포미더블 팔로워 윙 `["Albacore"]` becomes 팔로워 윙+
 * `["HMS"]`), and a gated cast whose target skill the graph does not carry, which is
 * most of the 113 (샌 재신토 17390 flips its gate and renders the same rows either way,
 * because the rows come from an ungated sibling branch).
 *
 * The "before" half anchors on the WEAPON rows, not the barrage ones: with the gate
 * shut she has no barrage at all, so an absence assertion would have nothing of its
 * own to wait for and would pass before the sim had run.
 */
test('a label-gated barrage appears only once the equip carrying that label is fitted', async ({ page }) => {
  await page.goto(PAGE);
  // 꼬마 아마기 is a 전함 — 후열, so slots 0-2.
  await page.locator('.ship-card[data-slot="0"] .ship-card-add').click();
  await expect(page.locator('#ship-picker-grid .picker-item').first()).toBeVisible();
  const unfilteredShips = await page.locator('#ship-picker-grid .picker-item').count();
  await page.locator('#ship-picker-search').fill('꼬마 아마기');
  await expect(page.locator('#ship-picker-grid .picker-item')).not.toHaveCount(unfilteredShips);
  await page.locator('#ship-picker-grid .picker-item').first().click();
  await page.locator('.ship-card[data-slot="0"] .stats-toggle').click();

  const barrage = page.locator('.ship-card[data-slot="0"] .dmg-weapon-table .dmg-row-barrage');
  const fitMainGun = async (name) => {
    await page.locator('.ship-card[data-slot="0"] .equip-slot[data-equip-index="0"]').click();
    await expect(page.locator('#equip-picker-grid .picker-item').first()).toBeVisible();
    const unfiltered = await page.locator('#equip-picker-grid .picker-item').count();
    await page.locator('#equip-picker-search').fill('410mm');
    await expect(page.locator('#equip-picker-grid .picker-item')).not.toHaveCount(unfiltered);
    // Pick by NAME, not `.first()`: once a slot is filled the grid leads with a
    // 장착 해제 entry that the search box does not filter out, so `.first()` unequips
    // the slot and the second fit silently becomes a removal.
    await page.locator('#equip-picker-grid .picker-item', { hasText: name }).first().click();
  };

  // The HE gun is one label short of the gate. Its own weapon row is what says the
  // breakdown has rendered, so the absence below means the gate and not "not yet".
  const rows = page.locator('.ship-card[data-slot="0"] .dmg-weapon-table tbody tr');
  await fitMainGun('삼식탄');
  await expect(rows.first()).toBeVisible();
  await expect(barrage.filter({ hasText: '사전 방비' })).toHaveCount(0);

  await fitMainGun('시제형 410mm 3연장포');
  await expect(barrage.filter({ hasText: '사전 방비' })).toHaveCount(1);
});
