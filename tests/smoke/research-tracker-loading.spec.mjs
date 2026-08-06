import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';
import { seedFuse } from './helpers.mjs';

test.setTimeout(60_000);

const RESEARCH_TRACKER_PATH = PAGE_CATALOG.find(
    ({ key }) => key === 'RESEARCH_TRACKER'
)?.path;

if (!RESEARCH_TRACKER_PATH) {
    throw new Error('research-tracker-loading: RESEARCH_TRACKER is missing from PAGE_CATALOG');
}

const INDEX_PATH = '/data/shipgirl/archive_drop_index.json';
const FULL_MAP_PATH = '/data/maps/map_data_full.json';

test('R2: default boot uses the compact archive index and excludes full map data', async ({ page }) => {
    await seedFuse(page);
    const requested = [];
    page.on('request', (request) => {
        const pathname = new URL(request.url()).pathname;
        if (pathname.endsWith(INDEX_PATH) || pathname.endsWith(FULL_MAP_PATH)) {
            requested.push(pathname);
        }
    });

    await page.goto(RESEARCH_TRACKER_PATH, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#sidebar-content .rt-research-panel')).toBeVisible();
    await expect(page.locator('.rt-group[data-group-key="archive"]')).toBeVisible();
    await expect(page.locator('.rt-group[data-group-key="archive"]')).toContainText('영광스런 최종전');

    expect(requested.filter((path) => path.endsWith(INDEX_PATH))).toHaveLength(1);
    expect(requested.filter((path) => path.endsWith(FULL_MAP_PATH))).toHaveLength(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.rt-group[data-group-key="archive"]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => (
        document.documentElement.scrollWidth
        <= document.documentElement.clientWidth + 1
    ))).toBe(true);
});

test('R2: an unavailable archive index drops only its group, not the page', async ({ page }) => {
    await seedFuse(page);
    await page.route(`**${INDEX_PATH}`, (route) => route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{}',
    }));

    await page.goto(RESEARCH_TRACKER_PATH, { waitUntil: 'domcontentloaded' });

    // The page still boots on the five required files...
    await expect(page.locator('#sidebar-content .rt-research-panel')).toBeVisible();
    await expect(page.locator('.rt-group').first()).toBeVisible();
    // ...and does not fall into the whole-page error state.
    await expect(page.locator('#sidebar-content .page-status-error')).toHaveCount(0);
    // Only the archive group is gone.
    await expect(page.locator('.rt-group[data-group-key="archive"]')).toHaveCount(0);
});
