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

test('every select-wrap select suppresses its native chrome', async ({ page }) => {
    await page.goto(PAGE);
    await addShip(page);
    // The affinity select is always on screen once a ship is added; assert on
    // it directly (this alone would NOT have caught the .dmg-tier-select
    // regression below, since it already matched the old, narrower selector).
    const selects = page.locator('.select-wrap select');
    await expect(selects.first()).toBeVisible();
    const appearances = await selects.evaluateAll((els) => els.map((el) => getComputedStyle(el).appearance));
    for (const appearance of appearances) {
        expect(appearance).toBe('none');
    }

    // The regression this guards (fixed in f4b1ddb) is that .select-wrap's
    // chevron-suppression rule was scoped to .config-select, so the damage
    // panel's .dmg-tier-select — wrapped the same way in renderDamagePanel —
    // drew a second, native arrow. That real <select> only renders after
    // driving the boss picker to a META target with more than one tier, which
    // would couple this guard to boss data (today all 23 bosses happen to
    // carry 15 tiers, but that is game data, not a contract) and to picker
    // modal/search timing that has nothing to do with the CSS bug. Instead,
    // inject the same markup shape directly into the live page: every real
    // stylesheet is already loaded, so this resolves through the actual
    // cascade rather than a mocked one, while staying independent of data.
    const tier = await page.evaluate(() => {
        const wrap = document.createElement('span');
        wrap.className = 'select-wrap';
        wrap.innerHTML = '<select class="dmg-tier-select"></select>';
        document.body.appendChild(wrap);
        const style = getComputedStyle(wrap.querySelector('select'));
        const result = {
            appearance: style.getPropertyValue('appearance'),
            webkitAppearance: style.getPropertyValue('-webkit-appearance'),
        };
        wrap.remove();
        return result;
    });
    expect(tier.appearance).toBe('none');
    expect(tier.webkitAppearance).toBe('none');
});

test('a filled equip slot captions the equip name and badges inside the icon box', async ({ page }) => {
    await page.goto(PAGE);
    await addShip(page);
    const slot0 = page.locator('.ship-card[data-slot="0"] .equip-slot[data-equip-index="0"]');
    await slot0.click();
    await expect(page.locator('#equip-picker-grid .picker-item').first()).toBeVisible();
    const pickedName = await page.locator('#equip-picker-grid .picker-item').nth(2)
        .locator('.picker-item-name').innerText();
    await page.locator('#equip-picker-grid .picker-item').nth(2).click();

    await expect(slot0).toHaveClass(/equipped/);
    // The caption used to be a duplicated slot-type label; it now names the equip.
    // Exact match against the picker's own text, not just "not empty" — a mere
    // non-empty check still passes if the caption regresses back to the
    // slot-type label, since that label is non-empty too.
    await expect(slot0.locator('.equip-slot-caption')).toHaveText(pickedName.trim());
    // Substring, NOT a RegExp built from data — equip names carry regex
    // metacharacters ("(개조)", "+"), which would fail the test for reasons that
    // have nothing to do with the code under test. getAttribute returns the
    // decoded value, so it compares equal to the picker's rendered text.
    const title = await slot0.getAttribute('title');
    expect(title).toContain(pickedName.trim());
    // Both badges live inside the icon box, not in the caption row beneath it.
    await expect(slot0.locator('.equip-slot-icon-box .equip-enhance-badge')).toHaveCount(1);
    await expect(slot0.locator('.equip-slot-caption .equip-eff-badge')).toHaveCount(0);
});

test('the efficiency badge is suppressed at 100%', async ({ page }) => {
    await page.goto(PAGE);
    await addShip(page);
    // A weapon slot (index < 3) must actually be FILLED — the eff-badge branch
    // never runs on an empty slot, so checking the page for a stray "100%"
    // would pass vacuously (nothing equipped, not "100% suppressed") without
    // this. Slot 2 (AA guns) sits at exactly 100% base proficiency on the
    // default test ship (slot 0 carries a +30% innate bonus and would render
    // regardless of the gate under test, so it cannot exercise this claim).
    const slot2 = page.locator('.ship-card[data-slot="0"] .equip-slot[data-equip-index="2"]');
    await slot2.click();
    await expect(page.locator('#equip-picker-grid .picker-item').first()).toBeVisible();
    await page.locator('#equip-picker-grid .picker-item').first().click();
    await expect(slot2).toHaveClass(/equipped/);
    // effectiveProficiency fills gaps with `?? 1`, so its guard is always true and
    // every weapon slot used to print a percentage — usually a flat 100%. Six
    // copies of that per card is noise, so full efficiency renders nothing.
    await expect(slot2.locator('.equip-eff-badge')).toHaveCount(0);
});

test('equip slots grow with the card instead of holding a fixed 64px', async ({ page }) => {
    await page.goto(PAGE);
    await addShip(page);
    const box = await page.locator('.ship-card[data-slot="0"] .equip-slot-icon-box').first().boundingBox();
    // >64 alone doesn't discriminate: the box carries a 1px dashed border and
    // this stylesheet never sets box-sizing: border-box, so a plain
    // `width: 64px; height: 64px` (content-box, the old fixed rule) still
    // measures 66px — clearing 64 without being the fluid layout under test.
    // The fluid box (100% of a 6-column card at the default 1280px viewport)
    // measures ~93px, so 80 sits well clear of both directions.
    expect(box.width).toBeGreaterThan(80);
    // Squares at every width.
    expect(Math.abs(box.width - box.height)).toBeLessThan(2);
});
