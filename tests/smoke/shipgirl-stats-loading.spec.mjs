/**
 * R12 loading boundary: the default ship dashboard must not request skin data
 * or the skin-only treemap controller. First skin-tab activation loads both;
 * successful data is reused, and failed dependencies remain retryable.
 */
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

const SHIPGIRL_STATS_PATH = PAGE_CATALOG.find(
    ({ key }) => key === 'SHIPGIRL_STATS'
)?.path;

if (!SHIPGIRL_STATS_PATH) {
    throw new Error('shipgirl-stats-loading: SHIPGIRL_STATS is missing from PAGE_CATALOG');
}

const SKIN_DATA_PATHS = [
    '/data/skin/skin_voiceline_data_subset.json',
    '/data/skin/skin_release_dates.json',
    '/data/skin/skin_release_dates_legacy.json',
];
const TREEMAP_DEPENDENCY = 'chartjs-chart-treemap@3';

test.beforeEach(async ({ page }) => {
    for (const dependency of ['chart.js@4', 'chartjs-chart-matrix@2']) {
        await page.route(`**/${dependency}*`, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/javascript',
                body: '/* deterministic base-chart smoke-test stub */',
            });
        });
    }
});

function dependencyForUrl(url) {
    const parsed = new URL(url);
    const skinData = SKIN_DATA_PATHS.find((path) => parsed.pathname.endsWith(path));
    if (skinData) return skinData;
    if (
        parsed.hostname === 'cdn.jsdelivr.net'
        && parsed.pathname.includes(TREEMAP_DEPENDENCY)
    ) {
        return TREEMAP_DEPENDENCY;
    }
    return null;
}

function collectOptionalRequests(page) {
    const requested = [];
    page.on('request', (request) => {
        const dependency = dependencyForUrl(request.url());
        if (dependency) requested.push(dependency);
    });
    return requested;
}

function waitForSkinData(page, paths = SKIN_DATA_PATHS) {
    return Promise.all(paths.map((path) => page.waitForResponse(
        (response) => (
            new URL(response.url()).pathname.endsWith(path)
            && response.ok()
        ),
        { timeout: 30_000 }
    )));
}

async function stubTreemapSuccess(page) {
    await page.route(`**/${TREEMAP_DEPENDENCY}*`, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: '/* deterministic treemap smoke-test stub */',
        });
    });
}

async function waitForShipDashboard(page) {
    await expect(page.locator('#shipTableBody tr').first()).toBeVisible();
    await expect(page.locator('.tab-toggle-btn[data-tab="ship"]')).toHaveAttribute(
        'aria-pressed',
        'true'
    );
}

async function openSkinTab(page) {
    await page.locator('.tab-toggle-btn[data-tab="skin"]').click();
    await expect(page.locator('#skinTableBody tr').first()).toBeVisible();
    await expect(page.locator('#skinTabContent')).toBeVisible();
}

async function expectNoDocumentOverflow(page) {
    await expect.poll(() => page.evaluate(() => (
        document.documentElement.scrollWidth
        <= document.documentElement.clientWidth + 1
    ))).toBe(true);
}

test('R12: skin data and treemap start on first skin-tab activation and are reused', async ({ page }) => {
    await stubTreemapSuccess(page);
    const requested = collectOptionalRequests(page);

    await page.goto(SHIPGIRL_STATS_PATH, { waitUntil: 'domcontentloaded' });
    await waitForShipDashboard(page);
    await page.waitForTimeout(1_000);

    expect(requested, 'default ship dashboard must not load skin dependencies').toEqual([]);
    await expect(page.locator('#skinTabContent')).toBeHidden();

    const firstSkinData = waitForSkinData(page);
    await openSkinTab(page);
    await firstSkinData;

    expect([...requested].sort()).toEqual([
        ...SKIN_DATA_PATHS,
        TREEMAP_DEPENDENCY,
    ].sort());
    await expectNoDocumentOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#skinTabContent')).toBeVisible();
    await expectNoDocumentOverflow(page);

    await page.locator('.tab-toggle-btn[data-tab="ship"]').click();
    await waitForShipDashboard(page);
    await openSkinTab(page);
    await page.waitForTimeout(250);

    expect(
        requested,
        'later skin-tab activations must reuse successful data and script loads'
    ).toHaveLength(4);
});

test('R12: failed skin data exposes the standard retry action', async ({ page }) => {
    await stubTreemapSuccess(page);
    let subsetAttempts = 0;
    await page.route('**/data/skin/skin_voiceline_data_subset.json', async (route) => {
        subsetAttempts += 1;
        if (subsetAttempts === 1) {
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: '{}',
            });
            return;
        }
        await route.continue();
    });

    await page.goto(SHIPGIRL_STATS_PATH, { waitUntil: 'domcontentloaded' });
    await waitForShipDashboard(page);
    await page.locator('.tab-toggle-btn[data-tab="skin"]').click();

    const retry = page.locator('#skinTabStatus .page-status-retry');
    await expect(retry).toBeVisible();
    await expect(page.locator('#skinTabContent')).toBeHidden();
    expect(subsetAttempts).toBe(1);

    const retryResponse = waitForSkinData(page, [SKIN_DATA_PATHS[0]]);
    await retry.click();
    await retryResponse;

    expect(subsetAttempts).toBe(2);
    await expect(page.locator('#skinTableBody tr').first()).toBeVisible();
    await expect(page.locator('#skinTabContent')).toBeVisible();
});

test('R12: a failed treemap request is non-fatal and retries on later activation', async ({ page }) => {
    let treemapAttempts = 0;
    await page.route(`**/${TREEMAP_DEPENDENCY}*`, async (route) => {
        treemapAttempts += 1;
        if (treemapAttempts === 1) {
            await route.abort('failed');
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: '/* deterministic treemap smoke-test retry stub */',
        });
    });
    const requested = collectOptionalRequests(page);

    await page.goto(SHIPGIRL_STATS_PATH, { waitUntil: 'domcontentloaded' });
    await waitForShipDashboard(page);
    const firstSkinData = waitForSkinData(page);
    await openSkinTab(page);
    await firstSkinData;

    expect(treemapAttempts).toBe(1);
    await expect(page.locator('#skinTabContent')).toBeVisible();

    await page.locator('.tab-toggle-btn[data-tab="ship"]').click();
    await waitForShipDashboard(page);
    await openSkinTab(page);

    expect(treemapAttempts).toBe(2);
    for (const path of SKIN_DATA_PATHS) {
        expect(requested.filter((entry) => entry === path)).toHaveLength(1);
    }
});
