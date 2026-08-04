/**
 * R11 loading boundary: the default ship catalog must not request or retain the
 * full ship/skill datasets. Each first-use consumer loads only its dependency
 * group, successful loads are reused, and failed full-data loads remain
 * retryable.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';
import { seedFuse } from './helpers.mjs';

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

const SHIPGIRL_INFO_PATH = PAGE_CATALOG.find(
    ({ key }) => key === 'SHIPGIRL_INFO'
)?.path;

if (!SHIPGIRL_INFO_PATH) {
    throw new Error('shipgirl-info-loading: SHIPGIRL_INFO is missing from PAGE_CATALOG');
}

const FULL_DATA_PATH = '/data/ship_info_data.json';
const SKILL_DATA_PATHS = [
    '/data/sim/skill_data_template.json',
    '/data/skill_icon_mapping.json',
    '/data/skill_to_icon_id.json',
];
const OPTIONAL_DATA_PATHS = [FULL_DATA_PATH, ...SKILL_DATA_PATHS];
const liteShips = JSON.parse(readFileSync(
    new URL('../../public/data/ship_info_lite.json', import.meta.url),
    'utf8'
));
const detailFixture = liteShips.find(({ name, gid }) => name && gid != null);

if (!detailFixture) {
    throw new Error('shipgirl-info-loading: no detail-link fixture is available');
}

function optionalDataPath(url) {
    const pathname = new URL(url).pathname;
    return OPTIONAL_DATA_PATHS.find((path) => pathname.endsWith(path)) ?? null;
}

function collectOptionalRequests(page) {
    const requested = [];
    page.on('request', (request) => {
        const path = optionalDataPath(request.url());
        if (path) requested.push(path);
    });
    return requested;
}

function waitForData(page, paths) {
    return Promise.all(paths.map((path) => page.waitForResponse(
        (response) => (
            new URL(response.url()).pathname.endsWith(path)
            && response.ok()
        ),
        { timeout: 30_000 }
    )));
}

async function waitForCatalog(page) {
    await expect(page.locator('#shipgirls .shipgirl-card').first()).toBeVisible();
    await expect(page.locator('#loading')).toBeHidden();
}

async function expectNoDocumentOverflow(page) {
    await expect.poll(() => page.evaluate(() => (
        document.documentElement.scrollWidth
        <= document.documentElement.clientWidth + 1
    ))).toBe(true);
}

test.beforeEach(async ({ page }) => {
    await seedFuse(page);
});

test('R11: default catalog excludes optional data and exposes one page entry', async ({ page }) => {
    const requested = collectOptionalRequests(page);

    await page.goto(SHIPGIRL_INFO_PATH, { waitUntil: 'domcontentloaded' });
    await waitForCatalog(page);
    // The removed idle warmup had a 3-second timeout. Waiting beyond it proves
    // the boundary is first-use, not a timer moved past semantic readiness.
    await page.waitForTimeout(3_500);

    expect(
        requested,
        'boot must not download data that would then be parsed and retained'
    ).toEqual([]);
    await expect(page.locator('script[type="module"][src*="/js/shipgirl/shipgirl-info"]'))
        .toHaveCount(1);

    await expectNoDocumentOverflow(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoDocumentOverflow(page);
});

test('R11: map browser loads full data only and later full-data consumers reuse it', async ({ page }) => {
    const requested = collectOptionalRequests(page);

    await page.goto(SHIPGIRL_INFO_PATH, { waitUntil: 'domcontentloaded' });
    await waitForCatalog(page);

    const fullData = waitForData(page, [FULL_DATA_PATH]);
    await page.locator('#mapBrowserBtn').click();
    await fullData;
    await expect(page.locator('#mapBrowserModal')).toBeVisible();
    expect(requested).toEqual([FULL_DATA_PATH]);

    await page.locator('#closeMapBrowserModal').click();
    await expect(page.locator('#mapBrowserModal')).toBeHidden();
    await page.locator('#retrofitFilter').click();
    await expect(page.locator('#retrofitFilter')).toHaveAttribute('aria-pressed', 'true');
    expect(requested, 'successful full data must be shared by later consumers').toHaveLength(1);
});

test('R11: a failed full-data request is cleared and retries on the next action', async ({ page }) => {
    let attempts = 0;
    await page.route('**/data/ship_info_data.json', async (route) => {
        attempts += 1;
        if (attempts === 1) {
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: '{}',
            });
            return;
        }
        await route.continue();
    });

    await page.goto(SHIPGIRL_INFO_PATH, { waitUntil: 'domcontentloaded' });
    await waitForCatalog(page);

    const retrofitFilter = page.locator('#retrofitFilter');
    await retrofitFilter.click();
    await expect(page.locator('#global-toast-container'))
        .toContainText('개조 정보를 불러오지 못했습니다');
    await expect(retrofitFilter).toHaveAttribute('aria-pressed', 'false');
    expect(attempts).toBe(1);

    const retryResponse = waitForData(page, [FULL_DATA_PATH]);
    await retrofitFilter.click();
    await retryResponse;

    expect(attempts).toBe(2);
    await expect(retrofitFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(retrofitFilter).not.toHaveAttribute('aria-busy');
});

test('R11: a detail deep link loads full and skill data concurrently, then reuses it', async ({ page }) => {
    const requested = collectOptionalRequests(page);
    const detailData = waitForData(page, OPTIONAL_DATA_PATHS);
    const query = new URLSearchParams({
        ship: detailFixture.name,
        gid: String(detailFixture.gid),
    });

    await page.goto(`${SHIPGIRL_INFO_PATH}?${query}`, {
        waitUntil: 'domcontentloaded',
    });
    await detailData;

    await expect(page.locator('#detailView')).toBeVisible();
    await expect(page.locator('#detailContent')).toContainText(detailFixture.name);
    expect([...requested].sort()).toEqual([...OPTIONAL_DATA_PATHS].sort());

    await page.locator('#homeButton').click();
    await waitForCatalog(page);
    await page.locator('#shipgirls .shipgirl-card').first().click();
    await expect(page.locator('#detailView')).toBeVisible();
    expect(requested, 'later details must reuse both successful data groups')
        .toHaveLength(OPTIONAL_DATA_PATHS.length);
});

// R11 moved a 5.5 MB download onto the first detail click, so the spinner is the
// only feedback there. It has to survive `.hidden { display: none !important }`,
// which an inline style.display cannot override once init() hides the element.
test('R11: the first-use detail load actually renders the loading spinner', async ({ page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route('**/data/ship_info_data.json', async (route) => {
        await held;
        await route.continue();
    });

    await page.goto(SHIPGIRL_INFO_PATH, { waitUntil: 'domcontentloaded' });
    await waitForCatalog(page);

    await page.locator('#shipgirls .shipgirl-card').first().click();
    await expect(page.locator('#loading')).toBeVisible();

    release();
    await expect(page.locator('#detailView')).toBeVisible();
    await expect(page.locator('#loading')).toBeHidden();
});

test('R11: skill search owns the same first-use data group and reuses its corpus', async ({ page }) => {
    const requested = collectOptionalRequests(page);

    await page.goto(SHIPGIRL_INFO_PATH, { waitUntil: 'domcontentloaded' });
    await waitForCatalog(page);

    const searchData = waitForData(page, OPTIONAL_DATA_PATHS);
    await page.locator('#skillSearchBtn').click();
    await searchData;
    await expect(page.locator('#skillSearchResults')).toBeVisible();
    expect([...requested].sort()).toEqual([...OPTIONAL_DATA_PATHS].sort());

    await page.locator('#closeSkillSearchModal').click();
    await expect(page.locator('#skillSearchModal')).toBeHidden();
    await page.locator('#skillSearchBtn').click();
    await expect(page.locator('#skillSearchResults')).toBeVisible();
    expect(requested, 'reopening search must not refetch or rebuild its data group')
        .toHaveLength(OPTIONAL_DATA_PATHS.length);
});
