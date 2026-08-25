/**
 * Structural guards for the fleet-sim card rework. Each assertion locks a claim
 * the redesign makes by construction, so a regression is a real behaviour change
 * rather than a styling drift:
 *   - the vitals strip is never emitted empty (its predecessor drew a hollow band)
 *   - the slot-type label survives only where it answers a question (empty
 *     slots keep it, a filled slot drops it for the equip name instead)
 *   - rarity reads as a badge and NOT as a border on the card
 *   - the rarity badge stays a rectangular chip, not rarity.css's default pill
 *   - an empty fleet slot renders compact rather than reserving a populated
 *     card's full height
 *   - the card's action chrome is vertically centred in the identity row,
 *     not pinned to the top like the predecessor
 *   - the level stepper and 호감도 select share one grid column, so their
 *     edges line up by construction rather than by two intrinsic widths
 *     happening to agree
 *   - the identity row exposes data-level/data-rarity (for the compact view
 *     to read), and the dead .ship-name-group wrapper is gone
 *   - every select-wrap select suppresses the native OS chevron, including
 *     the damage panel's .dmg-tier-select — not just the config selects the
 *     original rule was scoped to
 *   - a filled equip slot captions the equip's own name, and both badges
 *     live inside the icon box rather than the caption row
 *   - the efficiency badge is suppressed at exactly 100%, so a fully-fluent
 *     weapon slot doesn't print a redundant "100%"
 *   - equip slots grow fluidly with the card instead of holding a fixed 64px
 *   - a long equip name does not blow out its own grid column: all six equip
 *     slot columns stay equal width regardless of caption length
 *   - 간략 보기 (compact view) collapses a card to one row: portrait then 6
 *     equip squares, left to right
 *   - compact view hides the controls/captions/vitals but keeps the ship
 *     name and still prints the level, via the identity row's data-level
 *   - the chosen view persists across a reload
 *   - at a 390px viewport in the default view, the identity row reflows onto
 *     two rows so the ship name column keeps a real, readable width instead
 *     of collapsing toward the zero end of its minmax(0, 1fr) track
 */
import { test, expect } from '@playwright/test';

const PAGE = 'simulators/fleet-sim/';

/** Put a ship in slot 0 and wait for the populated card to render.
 *  nth defaults to 3 because the first picker entries are the highest-rarity
 *  ships, and index 3 lands on one that reliably carries all five equip slots. */
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

    // The check above only ever measured an UNEQUIPPED slot, whose caption is
    // a short slot-type label. A long, nowrap equip NAME is a much bigger
    // min-content floor, and .equip-slot is a 1fr grid item — without
    // min-width: 0 that floor drags just its own column wider than the other
    // five instead of growing uniformly. Equip the slot with the longest name
    // the picker actually offers (not a hard-coded id, which could go stale).
    const slot0 = page.locator('.ship-card[data-slot="0"] .equip-slot[data-equip-index="0"]');
    await slot0.click();
    await expect(page.locator('#equip-picker-grid .picker-item').first()).toBeVisible();
    const names = await page.locator('#equip-picker-grid .picker-item-name').allInnerTexts();
    let longestIndex = 0;
    for (let i = 1; i < names.length; i++) {
        if (names[i].length > names[longestIndex].length) longestIndex = i;
    }
    // Sanity: the picked name must actually be long enough to stress the
    // layout, or this assertion would pass vacuously on a short-name catalog.
    expect(names[longestIndex].length).toBeGreaterThanOrEqual(12);
    await page.locator('#equip-picker-grid .picker-item').nth(longestIndex).click();
    await expect(slot0).toHaveClass(/equipped/);

    const boxes = page.locator('.ship-card[data-slot="0"] .equip-slot-icon-box');
    await expect(boxes).toHaveCount(6);
    const widths = await boxes.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    // All six are 1fr tracks of the same grid — a working fix keeps them equal
    // no matter how long one slot's caption is.
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(2);
});

test('간략 보기 collapses a card to one row of portrait + 6 equip squares', async ({ page }) => {
    await page.goto(PAGE);
    await addShip(page);
    await page.locator('#view-toggle-btn').click();
    await expect(page.locator('.fleet-grid')).toHaveAttribute('data-view', 'compact');

    const card = page.locator('.ship-card[data-slot="0"]');
    const portrait = await card.locator('.ship-portrait').boundingBox();
    const boxes = card.locator('.equip-slot-icon-box');
    await expect(boxes).toHaveCount(6);

    // All 7 squares sit on one horizontal band, left to right.
    const first = await boxes.first().boundingBox();
    const last = await boxes.last().boundingBox();
    expect(first.x).toBeGreaterThan(portrait.x + portrait.width - 2);
    expect(last.x).toBeGreaterThan(first.x);
    const band = (b) => b.y + b.height / 2;
    expect(Math.abs(band(first) - band(portrait))).toBeLessThan(portrait.height);
    expect(Math.abs(band(last) - band(first))).toBeLessThan(4);
});

test('compact view hides the controls and captions but keeps the level', async ({ page }) => {
    await page.goto(PAGE);
    await addShip(page);
    await page.locator('#view-toggle-btn').click();
    const card = page.locator('.ship-card[data-slot="0"]');

    await expect(card.locator('.ship-identity-controls')).toBeHidden();
    await expect(card.locator('.ship-card-actions')).toBeHidden();
    await expect(card.locator('.ship-vitals')).toBeHidden();
    await expect(card.locator('.stats-toggle')).toBeHidden();
    await expect(card.locator('.equip-slot-caption').first()).toBeHidden();
    // The ship name must survive — a shared screenshot is unreadable without it.
    await expect(card.locator('.ship-name')).toBeVisible();

    // The level lives in the hidden stepper, so compact prints it from
    // data-level via content: attr(). ::after is not a DOM node, so read the
    // computed style rather than locating it.
    const printed = await card.locator('.ship-card-identity')
        .evaluate((el) => getComputedStyle(el, '::after').content);
    expect(printed).toMatch(/\d/);
});

test('the chosen view survives a reload', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('#view-toggle-btn').click();
    await expect(page.locator('.fleet-grid')).toHaveAttribute('data-view', 'compact');
    await page.reload();
    await expect(page.locator('.fleet-grid')).toHaveAttribute('data-view', 'compact');
    // And back again.
    await page.locator('#view-toggle-btn').click();
    await expect(page.locator('.fleet-grid')).toHaveAttribute('data-view', 'default');
});

test.describe('mobile identity row (390px)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the ship name stays visible and readable when the identity row reflows at 390px', async ({ page }) => {
        await page.goto(PAGE);
        await addShip(page);
        const name = page.locator('.ship-card[data-slot="0"] .ship-name');
        await expect(name).toBeVisible();
        const box = await name.boundingBox();
        // Pre-fix, the 5-column identity grid (drag/portrait/identity/controls/
        // chrome) leaves no room for minmax(0, 1fr) at this width: the other
        // four columns are auto tracks sized to their own content and already
        // exceed the card on their own, so the identity column collapses
        // toward 0 and the name renders with zero to one visible characters.
        // 80 sits well clear of that collapse and well under the real ~140px
        // the reflowed column measures.
        expect(box.width).toBeGreaterThan(80);
    });
});
