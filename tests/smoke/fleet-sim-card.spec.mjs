/**
 * Structural guards for the fleet-sim card rework. Each assertion locks a claim
 * the redesign makes by construction, so a regression is a real behaviour change
 * rather than a styling drift:
 *   - the vitals strip is never emitted empty (its predecessor drew a hollow band)
 *   - the slot-type label survives only where it answers a question
 *   - rarity reads as a badge and NOT as a border on the card
 *   - the rarity badge stays a rectangular chip, not rarity.css's default pill
 */
import { test, expect } from '@playwright/test';

const PAGE = 'simulators/fleet-sim/';

/** Put a ship in slot 0 and wait for the populated card to render. */
async function addShip(page, slot = 0, nth = 3) {
    await page.locator(`.ship-card[data-slot="${slot}"] .ship-card-add`).click();
    await expect(page.locator('#ship-picker-grid .picker-item').first()).toBeVisible();
    await page.locator('#ship-picker-grid .picker-item').nth(nth).click();
    await expect(page.locator(`.ship-card[data-slot="${slot}"] .equip-slot`).first()).toBeVisible();
}

test('vitals strip renders with content on a ship carrying no equipment', async ({ page }) => {
    await page.goto(PAGE);
    await addShip(page);
    const vitals = page.locator('.ship-card[data-slot="0"] .ship-vitals');
    await expect(vitals).toHaveCount(1);
    // The regression being guarded is an EMPTY strip, so assert on content.
    await expect(vitals.locator('.vital-stat')).not.toHaveCount(0);
    await expect(vitals).not.toHaveText('');
});

test('empty equip slots carry their type label, filled ones do not', async ({ page }) => {
    await page.goto(PAGE);
    await addShip(page);
    const slot0 = page.locator('.ship-card[data-slot="0"] .equip-slot[data-equip-index="0"]');
    await expect(slot0.locator('.equip-slot-caption--label')).toHaveCount(1);

    await slot0.click();
    await expect(page.locator('#equip-picker-grid .picker-item').first()).toBeVisible();
    await page.locator('#equip-picker-grid .picker-item').nth(2).click();

    await expect(slot0).toHaveClass(/equipped/);
    await expect(slot0.locator('.equip-slot-caption--label')).toHaveCount(0);
    // The title still carries the slot name for hover and assistive tech.
    await expect(slot0).toHaveAttribute('title', /.+:.+/);
});

test('rarity reads as a badge, and the card has no rarity border', async ({ page }) => {
    await page.goto(PAGE);
    await addShip(page);
    const card = page.locator('.ship-card[data-slot="0"]');
    await expect(card.locator('.ship-rarity-badge')).toHaveCount(1);
    await expect(card).not.toHaveAttribute('data-rarity', /.+/);
    const topBorder = await card.evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(parseFloat(topBorder)).toBeLessThanOrEqual(1);
});

test('empty fleet slots are compact', async ({ page }) => {
    await page.goto(PAGE);
    const box = await page.locator('.ship-card[data-slot="5"]').boundingBox();
    expect(box.height).toBeLessThan(140);
});

test('rarity badge stays rectangular, not a pill', async ({ page }) => {
    await page.goto(PAGE);
    await addShip(page);
    const badge = page.locator('.ship-card[data-slot="0"] .ship-rarity-badge');
    await expect(badge).toHaveCount(1);
    // rarity.css defaults .rarity-badge to a 0.75rem pill; the house rule is
    // rectangular chips (--radius-sm). Guards against a silent revert.
    const radius = await badge.evaluate((el) => getComputedStyle(el).borderRadius);
    expect(parseFloat(radius)).toBeLessThanOrEqual(6);
});

test('card chrome is vertically centred in the identity row', async ({ page }) => {
    await page.goto(PAGE);
    await addShip(page);
    const card = page.locator('.ship-card[data-slot="0"]');
    const row = await card.locator('.ship-card-identity').boundingBox();
    const chrome = await card.locator('.ship-card-actions').boundingBox();
    // The predecessor pinned the chrome with align-self: flex-start while every
    // other cell was centred — that offset IS the reported misalignment.
    const rowMid = row.y + row.height / 2;
    const chromeMid = chrome.y + chrome.height / 2;
    expect(Math.abs(rowMid - chromeMid)).toBeLessThan(4);
});

test('the level stepper and 호감도 select share one column', async ({ page }) => {
    await page.goto(PAGE);
    await addShip(page);
    const card = page.locator('.ship-card[data-slot="0"]');
    const stepper = await card.locator('.ship-identity-controls .level-stepper').boundingBox();
    const select = await card.locator('.ship-identity-controls .select-wrap').boundingBox();
    // Both are grid items in the same column at width:100%, so their edges match
    // by construction rather than by two intrinsic widths happening to agree.
    expect(Math.abs(stepper.x - select.x)).toBeLessThan(2);
    expect(Math.abs((stepper.x + stepper.width) - (select.x + select.width))).toBeLessThan(2);
});

test('identity exposes the level for the compact view, and the dead name wrapper is gone', async ({ page }) => {
    await page.goto(PAGE);
    await addShip(page);
    const card = page.locator('.ship-card[data-slot="0"]');
    await expect(card.locator('.ship-card-identity')).toHaveAttribute('data-level', /^\d+$/);
    // Compact view hides the rarity badge's row, so the grade also has to reach
    // the identity element for the portrait border to carry it there.
    await expect(card.locator('.ship-card-identity')).toHaveAttribute('data-rarity', /^(N|R|SR|SSR|UR)$/);
    // .ship-name-group carried a flex:1 that went inert when its parent became a
    // column; it is deleted rather than patched.
    await expect(card.locator('.ship-name-group')).toHaveCount(0);
});
