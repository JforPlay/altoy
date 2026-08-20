/**
 * Deep-polish regressions guard for /shipgirl/shipgirl-tracker/:
 * 320px action visibility, no horizontal overflow, drawer below navbar,
 * direct status-menu selection + focus return, view-switch state
 * preservation, desktop sticky stacking.
 */
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

const TRACKER_PATH = PAGE_CATALOG.find(({ key }) => key === 'SHIPGIRL_TRACKER')?.path;
if (!TRACKER_PATH) throw new Error('shipgirl-tracker-polish: SHIPGIRL_TRACKER missing from PAGE_CATALOG');

async function boot(page, viewport) {
    if (viewport) await page.setViewportSize(viewport);
    await page.goto(TRACKER_PATH);
    await expect(page.locator('#ship-list-container .ship-card').first()).toBeVisible();
}

function bodyOverflow(page) {
    return page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test('no horizontal overflow at reviewed widths', async ({ page }) => {
    for (const width of [1440, 1024, 768, 390, 320]) {
        await boot(page, { width, height: 900 });
        expect(await bodyOverflow(page), `${width}px`).toBeLessThanOrEqual(0);
    }
});

test('320px: all toolbar actions visible, name track non-zero', async ({ page }) => {
    await boot(page, { width: 320, height: 800 });
    for (const id of ['view-toggle-btn', 'filter-drawer-btn', 'score-modal-btn', 'goal-modal-btn']) {
        const box = await page.locator(`#${id}`).boundingBox();
        expect(box, id).not.toBeNull();
        expect(box.x, id).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, id).toBeLessThanOrEqual(320);
    }
    const name = await page.locator('.ship-card .lr-nm-text').first().boundingBox();
    expect(name.width).toBeGreaterThan(40);
});

test('drawer header and close sit below the navbar and close by pointer', async ({ page }) => {
    await boot(page, { width: 1440, height: 900 });
    await page.locator('#filter-drawer-btn').click();
    const close = page.locator('#filter-drawer .st-drawer-close');
    await expect(close).toBeVisible();
    const navH = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--navbar-height')) || 65);
    const box = await close.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(navH - 1);
    await close.click();
    await expect(page.locator('#filter-drawer')).not.toHaveClass(/open/);
});

test('status menu selects an exact value and returns focus', async ({ page }) => {
    await boot(page, { width: 1440, height: 900 });
    const chip = page.locator('.ship-card [data-action="aff"]').first();
    await chip.click();
    const menu = page.locator('.st-status-menu');
    await expect(menu).toBeVisible();
    await menu.locator('[data-value="2"]').click();
    await expect(page.locator('.ship-card [data-action="aff"]').first()).toContainText('100 완료');
    await expect(page.locator('.ship-card [data-action="aff"]').first()).toBeFocused();
});

test('cards is the default view and switching preserves state', async ({ page }) => {
    await boot(page, { width: 1440, height: 900 });
    await expect(page.locator('#ship-list-container')).toHaveAttribute('data-view', 'cards');
    // stat bonuses read on the card face, not behind the detail toggle
    await expect(page.locator('.ship-card .lr-stats').first()).toBeVisible();
    const toggle = page.locator('.ship-card .lr-detail-toggle').first();
    await toggle.click();
    await expect(page.locator('.ship-card .lr-detail').first()).toBeVisible();

    await page.locator('.ship-card [data-type="get"]').first().check();
    await page.locator('#view-toggle-btn').click();
    await expect(page.locator('#ship-list-container')).toHaveAttribute('data-view', 'ledger');
    await expect(page.locator('.ship-card [data-type="get"]').first()).toBeChecked();
});

test('sticky surface and ledger head do not overlap on desktop', async ({ page }) => {
    await boot(page, { width: 1440, height: 900 });
    await page.locator('#view-toggle-btn').click(); // cards -> ledger
    await expect(page.locator('#ledger-head')).toBeVisible();
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(300);
    const surface = await page.locator('.st-control-surface').boundingBox();
    const head = await page.locator('#ledger-head').boundingBox();
    expect(head.y).toBeGreaterThanOrEqual(surface.y + surface.height - 1);
});
