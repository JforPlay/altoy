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
