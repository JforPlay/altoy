/**
 * Guards for the fleet-sim SP-weapon slot and the equip picker's 별명 search
 * (R2). Each assertion locks a claim the rework makes by construction:
 *   - a 전용 특수 장비 is now real slot state — equipped by default at max
 *     level, with the same numbers the old display-only branch produced
 *   - that slot is selectable and its level is editable, where the old
 *     dedicated branch rendered an inert "SP" badge with no data-action
 *   - the ship's own 전용 appears in its SP picker, and survives a rarity
 *     chip: it goes through the same projection as the generics, so it
 *     carries rarity_name (the field the chips filter on)
 *   - the level popover derives its max from the weapon's own level count,
 *     not a hardcoded 0..10 — 슈퍼 레인보우 망치 1호 has exactly one level
 *   - 별명 reach the equip picker's search, taking the second half of a
 *     comma-joined pair so the split path is the one under test
 *   - the two pickers share one modal, so opening the equip picker after the
 *     SP picker restores its own title
 */
import { test, expect } from '@playwright/test';

const PAGE = 'simulators/fleet-sim/';

/** 애리조나: backline (전함), so it belongs in slots 0-2, and it carries the
 *  전용 장비 다시는 울지 않아 at 11 levels. */
const BACKLINE_SP = { name: '애리조나', weapon: '다시는 울지 않아', maxLevel: 10 };

/** 특장형 부린 MKIII: frontline (구축) → slots 3-5, and the ONE ship whose
 *  전용 장비 (슈퍼 레인보우 망치 1호) has a single level. */
const FRONTLINE_ONE_LEVEL = { name: '특장형 부린 MKIII', slot: 3 };

/** Put a named ship in a slot. Searching by name rather than by index because
 *  roster order gives no stable index for a specific ship. */
async function addNamedShip(page, slot, name) {
    await page.locator(`.ship-card[data-slot="${slot}"] .ship-card-add`).click();
    await expect(page.locator('#ship-picker-grid .picker-item').first()).toBeVisible();
    await page.locator('#ship-picker-search').fill(name);
    await page.locator('#ship-picker-grid .picker-item', { hasText: name }).first().click();
    await expect(page.locator(`.ship-card[data-slot="${slot}"] .equip-slot`).first()).toBeVisible();
}

test('a 전용 특수 장비 is equipped by default, at max level', async ({ page }) => {
    await page.goto(PAGE);
    await addNamedShip(page, 0, BACKLINE_SP.name);

    const sp = page.locator('.ship-card[data-slot="0"] .equip-slot.sp-slot');
    await expect(sp).toHaveClass(/equipped/);
    await expect(sp.locator('.equip-slot-caption')).toHaveText(BACKLINE_SP.weapon);
    // Max level reproduces the old display-only fallback's numbers exactly.
    await expect(sp.locator('.equip-enhance-badge')).toHaveText(`+${BACKLINE_SP.maxLevel}`);
});

test('the 전용 slot is selectable and its level is editable', async ({ page }) => {
    await page.goto(PAGE);
    await addNamedShip(page, 0, BACKLINE_SP.name);

    const sp = page.locator('.ship-card[data-slot="0"] .equip-slot.sp-slot');
    // The old dedicated branch had no data-action at all — neither the slot nor
    // its badge could be clicked, so there was no level control whatsoever.
    await expect(sp).toHaveAttribute('data-action', 'change-sp-weapon');
    await expect(sp.locator('.equip-enhance-badge')).toHaveAttribute('data-action', 'change-sp-level');

    await sp.locator('.equip-enhance-badge').click();
    await expect(page.locator('.enhance-popover input[type="range"]')).toBeVisible();
});

test("the SP picker lists the ship's own 전용, and a rarity chip cannot hide it", async ({ page }) => {
    await page.goto(PAGE);
    await addNamedShip(page, 0, BACKLINE_SP.name);

    await page.locator('.ship-card[data-slot="0"] .equip-slot.sp-slot').click();
    const own = page.locator('#equip-picker-grid .picker-item', { hasText: BACKLINE_SP.weapon });
    await expect(own).toHaveCount(1);
    await expect(own).toContainText('전용');

    // V3: the chips filter on rarity_name. An entry appended without that field
    // vanishes the moment any chip is active — which reads as "my 전용 장비
    // disappeared" rather than as a filter bug.
    await page.locator('#equip-rarity-filters .chip[data-rarity="ssr"]').click();
    await expect(own).toHaveCount(1);
});

test('the SP level popover derives its max from the weapon, not a hardcoded 10', async ({ page }) => {
    await page.goto(PAGE);
    await addNamedShip(page, FRONTLINE_ONE_LEVEL.slot, FRONTLINE_ONE_LEVEL.name);

    const badge = page.locator(
        `.ship-card[data-slot="${FRONTLINE_ONE_LEVEL.slot}"] .equip-slot.sp-slot .equip-enhance-badge`
    );
    await expect(badge).toHaveText('+0');
    await badge.click();
    // One level ⇒ +0 is the only legal value. Offering +0..+10 here is a lie the
    // damage calc silently clamps back to index 0.
    await expect(page.locator('.enhance-popover input[type="range"]')).toHaveAttribute('max', '0');
});

test('the SP level popover still offers the full range on an 11-level weapon', async ({ page }) => {
    await page.goto(PAGE);
    await addNamedShip(page, 0, BACKLINE_SP.name);

    await page.locator('.ship-card[data-slot="0"] .equip-slot.sp-slot .equip-enhance-badge').click();
    await expect(page.locator('.enhance-popover input[type="range"]'))
        .toHaveAttribute('max', String(BACKLINE_SP.maxLevel));
});

test('별명 find an equip whose own name shares nothing with the query', async ({ page }) => {
    await page.goto(PAGE);
    await addNamedShip(page, 0, BACKLINE_SP.name);

    // 애리조나's slot 4 (index 3) takes the aux types. 엘리트 응급 수리(유니온)'s
    // 별명 is "정예 대미지 컨트롤 만쥬, 다메콘" — the query is the SECOND half, so
    // the comma split is the path exercised, and it shares not one character
    // with the equip's own name, so a name-only index cannot fuzzy-match it.
    // (An overlapping query like 노탄 vs 철갑탄 passes on the name index alone
    // and would make this test vacuous.)
    await page.locator('.ship-card[data-slot="0"] .equip-slot[data-equip-index="3"]').click();
    const items = page.locator('#equip-picker-grid .picker-item');
    await expect(items.first()).toBeVisible();
    const unfiltered = await items.count();

    await page.locator('#equip-picker-search').fill('다메콘');
    // The search is debounced, so assert the grid actually re-rendered first.
    // Asserting the target's presence alone passes against the UNFILTERED grid
    // (it is in the full list) and proves nothing about the search.
    await expect(items).not.toHaveCount(unfiltered);
    await expect(items.filter({ hasText: '엘리트 응급 수리(유니온)' })).toHaveCount(1);
});

test('the equip picker restores its title after an SP picker open', async ({ page }) => {
    await page.goto(PAGE);
    await addNamedShip(page, 0, BACKLINE_SP.name);
    const title = page.locator('#equipPickerModal-title');

    await page.locator('.ship-card[data-slot="0"] .equip-slot.sp-slot').click();
    await expect(title).toHaveText('특수 장비 선택');
    await page.keyboard.press('Escape');

    // Both pickers reuse #equipPickerModal and only the SP one set a title, so
    // every equip picker after an SP open was headed 특수 장비 선택.
    await page.locator('.ship-card[data-slot="0"] .equip-slot[data-equip-index="3"]').click();
    await expect(title).toHaveText('장비 선택');
});
