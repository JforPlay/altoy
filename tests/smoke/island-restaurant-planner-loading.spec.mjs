/**
 * R21 loading boundary: restoring the normal restaurant tab must not request
 * or initialize the meal planner. First planner activation loads it once, and
 * a failed module request remains retryable from the standard status UI.
 */
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';
import { seedFuse } from './helpers.mjs';

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

const ISLAND_PATH = PAGE_CATALOG.find(({ key }) => key === 'ISLAND')?.path;
const PLANNER_MODULE_PATH = '/js/island/island.restaurant.planner.js';

if (!ISLAND_PATH) {
    throw new Error('island-restaurant-planner-loading: ISLAND is missing from PAGE_CATALOG');
}

const isPlannerRequest = (url) => url.pathname.endsWith(PLANNER_MODULE_PATH);

function collectPlannerRequests(page) {
    const requested = [];
    page.on('request', (request) => {
        if (isPlannerRequest(new URL(request.url()))) {
            requested.push(request.url());
        }
    });
    return requested;
}

async function openSavedRestaurantTab(page) {
    await seedFuse(page);
    await page.addInitScript(() => {
        localStorage.setItem('island-active-tab', 'restaurant');
    });
    await page.goto(ISLAND_PATH, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#restaurant-tabs .restaurant-tab').first()).toBeVisible();
    await expect(page.locator('#restaurant-menu-list .menu-card').first()).toBeVisible();
}

async function openPlannerTab(page) {
    await page.locator('.restaurant-tab[data-restaurant-id="planner"]').click();
    await expect(page.locator('#restaurant-planner-view .planner-layout-grid')).toBeVisible();
}

async function expectNoDocumentOverflow(page) {
    await expect.poll(() => page.evaluate(() => (
        document.documentElement.scrollWidth
        <= document.documentElement.clientWidth + 1
    ))).toBe(true);
}

test('R21: saved restaurant restoration excludes planner until first use and reuses it', async ({ page }) => {
    const requested = collectPlannerRequests(page);

    await openSavedRestaurantTab(page);

    expect(requested, 'normal restaurant view must not fetch the planner module').toEqual([]);
    await expect(page.locator('#restaurant-planner-view')).toBeHidden();
    expect(await page.evaluate(() => (
        Object.hasOwn(window.RestaurantModule.state(), 'plannerPlan')
    ))).toBe(false);

    const firstPlannerResponse = page.waitForResponse((response) => (
        isPlannerRequest(new URL(response.url())) && response.ok()
    ));
    await openPlannerTab(page);
    await firstPlannerResponse;

    expect(requested).toHaveLength(1);
    expect(await page.evaluate(() => (
        Object.hasOwn(window.RestaurantModule.state(), 'plannerPlan')
    ))).toBe(true);
    await expectNoDocumentOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#restaurant-planner-view .planner-layout-grid')).toBeVisible();
    await expectNoDocumentOverflow(page);

    await page.locator('.restaurant-tab:not(.planner-tab)').first().click();
    await expect(page.locator('#restaurant-menu-list .menu-card').first()).toBeVisible();
    await openPlannerTab(page);
    await page.waitForTimeout(250);

    expect(requested, 'later planner activations must reuse the loaded module').toHaveLength(1);
});

test('R21: failed planner import exposes a retry action and succeeds on retry', async ({ page }) => {
    let plannerAttempts = 0;
    await page.route(isPlannerRequest, async (route) => {
        plannerAttempts += 1;
        if (plannerAttempts === 1) {
            await route.fulfill({
                status: 503,
                contentType: 'application/javascript',
                body: '/* deterministic planner import failure */',
            });
            return;
        }
        await route.continue();
    });

    await openSavedRestaurantTab(page);
    await page.locator('.restaurant-tab[data-restaurant-id="planner"]').click();

    const retry = page.locator('#restaurant-planner-view .page-status-retry');
    await expect(retry).toBeVisible();
    expect(plannerAttempts).toBe(1);

    await retry.click();
    await expect(page.locator('#restaurant-planner-view .planner-layout-grid')).toBeVisible();

    expect(plannerAttempts).toBe(2);
});
