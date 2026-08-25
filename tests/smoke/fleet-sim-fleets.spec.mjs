/**
 * Guards for fleet-sim multi-fleet (R3). Each assertion locks a claim the
 * release makes by construction:
 *   - the fleets are genuinely independent: a ship placed in one is absent
 *     from the next, and each survives a round trip through the other
 *   - the strip enforces both ends — no removing the last fleet, no adding a
 *     fifth
 *   - a SINGLE-fleet share link still emits the legacy {s} payload, so every
 *     link already in the wild keeps decoding on an older build
 *   - a multi-fleet share link restores every fleet and the active index
 *   - a save carries all its fleets and the library row says how many
 *   - un-equipping a 전용 특수 장비 survives a save/load round trip: the two
 *     formats now write an explicit null, so "removed" no longer reads as
 *     "written before the field existed" and get refilled
 *
 * Not covered: clearDamageCache(). Its symptom is a single stale frame of the
 * previous fleet's per-weapon table, and pinning that needs an assertion
 * inside an in-flight async render — a flaky test for two lines.
 */
import { test, expect } from '@playwright/test';

const PAGE = 'simulators/fleet-sim/';

/** 애리조나 is a 전함 (slots 0-2) and carries the 전용 장비 다시는 울지 않아. */
const SP_SHIP = '애리조나';

const tabs = (page) => page.locator('#fleet-tabs [data-action="switch-fleet"]');
const slot0 = (page) => page.locator('.ship-card[data-slot="0"]');

/** Put a named ship in slot 0. By name, not index — roster order gives no
 *  stable index for a specific ship. */
async function addNamedShip(page, name) {
    await slot0(page).locator('.ship-card-add').click();
    await expect(page.locator('#ship-picker-grid .picker-item').first()).toBeVisible();
    await page.locator('#ship-picker-search').fill(name);
    await page.locator('#ship-picker-grid .picker-item', { hasText: name }).first().click();
    await expect(slot0(page).locator('.equip-slot').first()).toBeVisible();
}

async function shipName(page) {
    return (await slot0(page).locator('.ship-name').textContent()).trim();
}

/** The ?fleet= payload the 공유 button just wrote into the address bar. */
async function sharedPayload(page) {
    await page.locator('#share-btn').click();
    await expect(page).toHaveURL(/[?&]fleet=/);
    const encoded = new URL(page.url()).searchParams.get('fleet');
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
}

async function saveAs(page, name) {
    await page.locator('#save-load-btn').click();
    await page.locator('#save-name-input').fill(name);
    await page.locator('#save-btn').click();
    await expect(page.locator('#save-slot-list .save-slot-item')).toHaveCount(1);
}

async function loadFirstSave(page) {
    await page.locator('#save-load-btn').click();
    await page.locator('#save-slot-list .save-slot-info').first().click();
    await expect(page.locator('#saveLoadModal')).toBeHidden();
}

test('fleets hold their own ships, and switching preserves both', async ({ page }) => {
    await page.goto(PAGE);
    await expect(tabs(page)).toHaveCount(1);

    await addNamedShip(page, SP_SHIP);
    const first = await shipName(page);

    await page.locator('[data-action="add-fleet"]').click();
    await expect(tabs(page)).toHaveCount(2);
    // The new fleet starts empty rather than inheriting fleet 1.
    await expect(slot0(page)).toHaveClass(/ship-card--empty/);

    await addNamedShip(page, '유니콘');
    expect(await shipName(page)).not.toBe(first);

    await tabs(page).nth(0).click();
    expect(await shipName(page)).toBe(first);
    await expect(tabs(page).nth(0)).toHaveClass(/is-active/);
});

test('the strip refuses to drop the last fleet or add a fifth', async ({ page }) => {
    await page.goto(PAGE);
    const add = page.locator('[data-action="add-fleet"]');
    const remove = page.locator('[data-action="remove-fleet"]');

    await expect(remove).toBeDisabled();
    await expect(add).toBeEnabled();

    for (let i = 0; i < 3; i++) await add.click();
    await expect(tabs(page)).toHaveCount(4);
    await expect(add).toBeDisabled();
    await expect(remove).toBeEnabled();

    // An empty fleet needs no confirmation, so this exercises the plain path.
    await remove.click();
    await expect(tabs(page)).toHaveCount(3);
    await expect(add).toBeEnabled();
});

test('a single-fleet share link keeps the legacy {s} payload', async ({ page }) => {
    await page.goto(PAGE);
    await addNamedShip(page, SP_SHIP);

    const payload = await sharedPayload(page);
    // An {f} wrapper here would break every link already in the wild on any
    // build that predates multi-fleet.
    expect(Object.keys(payload)).toContain('s');
    expect(payload.f).toBeUndefined();
    expect(payload.af).toBeUndefined();
});

test('a multi-fleet share link restores every fleet', async ({ page }) => {
    await page.goto(PAGE);
    await addNamedShip(page, SP_SHIP);
    await page.locator('[data-action="add-fleet"]').click();
    await addNamedShip(page, '유니콘');

    const payload = await sharedPayload(page);
    expect(payload.f).toHaveLength(2);
    expect(payload.af).toBe(1);

    await page.goto(page.url());
    await expect(tabs(page)).toHaveCount(2);
    await expect(tabs(page).nth(1)).toHaveClass(/is-active/);
    expect(await shipName(page)).toBe('유니콘');
    await tabs(page).nth(0).click();
    expect(await shipName(page)).toBe(SP_SHIP);
});

test('a save carries all its fleets, and the library row says how many', async ({ page }) => {
    await page.goto(PAGE);
    await addNamedShip(page, SP_SHIP);
    await page.locator('[data-action="add-fleet"]').click();
    await addNamedShip(page, '유니콘');

    await saveAs(page, '2함대 저장');
    await expect(page.locator('#save-slot-list .save-slot-meta')).toContainText('2함대');

    // Reload so the load path hydrates from storage, not from live state.
    await page.goto(PAGE);
    await expect(tabs(page)).toHaveCount(1);
    await loadFirstSave(page);

    await expect(tabs(page)).toHaveCount(2);
    expect(await shipName(page)).toBe(SP_SHIP);
    await tabs(page).nth(1).click();
    expect(await shipName(page)).toBe('유니콘');
});

test('an un-equipped 전용 특수 장비 stays un-equipped through a save/load', async ({ page }) => {
    await page.goto(PAGE);
    await addNamedShip(page, SP_SHIP);

    const sp = slot0(page).locator('.equip-slot.sp-slot');
    await expect(sp).toHaveClass(/equipped/);
    await sp.click();
    await page.locator('#equip-picker-grid .picker-item-unequip').click();
    await expect(sp).not.toHaveClass(/equipped/);

    await saveAs(page, '전용 해제');
    await page.goto(PAGE);
    await loadFirstSave(page);

    // Before R3 both formats simply omitted the field, so the hydration step
    // that rescues pre-R2 saves put the 전용 straight back on.
    await expect(slot0(page).locator('.equip-slot.sp-slot')).not.toHaveClass(/equipped/);
});
