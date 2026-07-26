/**
 * R7 loading boundary: the default map sidebar must remain catalog-only.
 * Full chapters and their supporting lookup data start on the first feature
 * that needs them, while map/compare deep links restore normally.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

const MAP_VIEWER_PATH = PAGE_CATALOG.find(
    ({ path }) => path.includes('map-viewer')
)?.path;

if (!MAP_VIEWER_PATH) {
    throw new Error('map-viewer-loading: map-viewer is missing from PAGE_CATALOG');
}

const OPTIONAL_DATA_PATHS = {
    full: '/data/maps/map_data_full.json',
    ship: '/data/ship_info_lite.json',
    world: '/data/maps/world_target_data.json',
};

const liteData = JSON.parse(readFileSync(
    new URL('../../public/data/maps/map_data_lite.json', import.meta.url),
    'utf8'
));
const mainMapIds = liteData.main?.slice(0, 2).map(({ id }) => String(id)) || [];

if (mainMapIds.length < 2) {
    throw new Error('map-viewer-loading: two main maps are required for reuse/compare coverage');
}

function optionalDataPath(url) {
    const pathname = new URL(url).pathname;
    return Object.values(OPTIONAL_DATA_PATHS).find(
        (suffix) => pathname.endsWith(suffix)
    ) || null;
}

function collectOptionalRequests(page) {
    const requested = [];
    page.on('request', (request) => {
        const path = optionalDataPath(request.url());
        if (path) requested.push(path);
    });
    return requested;
}

function waitForOptionalData(page, paths) {
    return Promise.all(paths.map((path) => page.waitForResponse(
        (response) => optionalDataPath(response.url()) === path && response.ok(),
        { timeout: 30_000 }
    )));
}

async function openFirstSidebarGroup(page) {
    const header = page.locator('#mapSidebar .sidebar-group-header').first();
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
}

test('R7: optional map data starts on first use and is reused by later maps', async ({ page }) => {
    const requested = collectOptionalRequests(page);

    await page.goto(MAP_VIEWER_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#mapSidebar .sidebar-item');
    await page.waitForTimeout(1_000);
    expect(requested, 'default map-viewer boot must remain catalog-only').toEqual([]);

    await openFirstSidebarGroup(page);
    const firstMapData = waitForOptionalData(page, [
        OPTIONAL_DATA_PATHS.full,
        OPTIONAL_DATA_PATHS.ship,
    ]);
    await page.locator(
        `#mapSidebar .sidebar-item[data-map-id="${mainMapIds[0]}"]`
    ).click();
    await firstMapData;
    await expect(page.locator('#mapContent')).toBeVisible();

    expect([...requested].sort()).toEqual([
        OPTIONAL_DATA_PATHS.full,
        OPTIONAL_DATA_PATHS.ship,
    ].sort());

    await page.locator(
        `#mapSidebar .sidebar-item[data-map-id="${mainMapIds[1]}"]`
    ).click();
    await expect(page.locator(
        `#mapSidebar .sidebar-item[data-map-id="${mainMapIds[1]}"]`
    )).toHaveClass(/active/);
    expect(requested, 'later standard maps must reuse full and ship data').toHaveLength(2);

    await page.locator('#mapTabs .map-tab[data-tab="world"]').click();
    await openFirstSidebarGroup(page);
    const worldTargetData = waitForOptionalData(page, [OPTIONAL_DATA_PATHS.world]);
    await page.locator('#mapSidebar .sidebar-item').first().click();
    await worldTargetData;
    await expect(page.locator('#mapContent')).toBeVisible();

    expect([...requested].sort()).toEqual(Object.values(OPTIONAL_DATA_PATHS).sort());
    expect(requested, 'each optional map dataset must be requested at most once').toHaveLength(3);
});

test('R7: search tools load only the lookup they consume', async ({ page }) => {
    const requested = collectOptionalRequests(page);

    await page.goto(MAP_VIEWER_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#mapSidebar .sidebar-item');

    const shipSearchData = waitForOptionalData(page, [OPTIONAL_DATA_PATHS.ship]);
    await page.locator('#searchShipBtn').click();
    await shipSearchData;
    await expect(page.locator('#searchModalBody .search-result-item').first()).toBeVisible();
    expect(requested).toEqual([OPTIONAL_DATA_PATHS.ship]);

    await page.locator('#searchModalClose').click();
    await expect(page.locator('#searchModal')).toBeHidden();

    const blueprintSearchData = waitForOptionalData(page, [OPTIONAL_DATA_PATHS.full]);
    await page.locator('#searchBlueprintBtn').click();
    await blueprintSearchData;
    await expect(page.locator('#searchModalBody .search-result-item').first()).toBeVisible();
    expect([...requested].sort()).toEqual([
        OPTIONAL_DATA_PATHS.full,
        OPTIONAL_DATA_PATHS.ship,
    ].sort());
});

test('R7: a map deep link loads only the detail data needed for that map', async ({ page }) => {
    const requested = collectOptionalRequests(page);
    const deepLinkData = waitForOptionalData(page, [
        OPTIONAL_DATA_PATHS.full,
        OPTIONAL_DATA_PATHS.ship,
    ]);

    await page.goto(
        `${MAP_VIEWER_PATH}?tab=main&map=${encodeURIComponent(mainMapIds[0])}`,
        { waitUntil: 'domcontentloaded' }
    );
    await deepLinkData;

    expect([...requested].sort()).toEqual([
        OPTIONAL_DATA_PATHS.full,
        OPTIONAL_DATA_PATHS.ship,
    ].sort());
    await expect(page.locator('#mapContent')).toBeVisible();
    await expect(page.locator(
        `#mapSidebar .sidebar-item[data-map-id="${mainMapIds[0]}"]`
    )).toHaveClass(/active/);
});

test('R7: a compare-only deep link loads full chapters without unrelated lookups', async ({ page }) => {
    const requested = collectOptionalRequests(page);
    const compareData = waitForOptionalData(page, [OPTIONAL_DATA_PATHS.full]);

    await page.goto(
        `${MAP_VIEWER_PATH}?compare=${mainMapIds.join(',')}`,
        { waitUntil: 'domcontentloaded' }
    );
    await compareData;

    expect(requested).toEqual([OPTIONAL_DATA_PATHS.full]);
    await expect(page.locator('#compareModal')).toBeVisible();
    await expect(page.locator('#compareModalBody .compare-sides')).toBeVisible();
});

test('R7: a failed full-data load is retried by the next map activation', async ({ page }) => {
    let fullDataAttempts = 0;
    await page.route('**/data/maps/map_data_full.json', async (route) => {
        fullDataAttempts += 1;
        if (fullDataAttempts === 1) {
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: '{}',
            });
            return;
        }
        await route.continue();
    });

    await page.goto(MAP_VIEWER_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#mapSidebar .sidebar-item');
    await openFirstSidebarGroup(page);

    const mapItem = page.locator(
        `#mapSidebar .sidebar-item[data-map-id="${mainMapIds[0]}"]`
    );
    await mapItem.click();
    await expect(page.locator('#mapEmpty .page-status-error')).toBeVisible();
    expect(fullDataAttempts).toBe(1);

    const retryData = waitForOptionalData(page, [OPTIONAL_DATA_PATHS.full]);
    await mapItem.click();
    await retryData;

    expect(fullDataAttempts).toBe(2);
    await expect(page.locator('#mapContent')).toBeVisible();
});
