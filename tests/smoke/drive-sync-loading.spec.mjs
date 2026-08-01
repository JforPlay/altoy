/**
 * R6 loading boundary: static routes render only the lightweight Drive Sync
 * trigger. The UI/engine/auth/API stack loads on first activation, remains
 * cached after mount, and can retry a failed module request.
 */
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);
test.beforeEach(async ({ page }) => {
    // The feature boundary is entirely same-origin. Blocking optional fonts and
    // analytics keeps DOMContentLoaded deterministic in offline test runs.
    await page.route(/^https:\/\//, (route) => route.abort());
});

const PRIVACY_PATH = 'privacy/';
const SYNC_MODULE_PREFIX = '/altoy/js/sync/';
const SYNC_UI_MODULE_PATH = `${SYNC_MODULE_PREFIX}drive-sync.ui.js`;
const SYNC_MODULE_PATHS = [
    'drive-sync.api.js',
    'drive-sync.auth.js',
    'drive-sync.config.js',
    'drive-sync.engine.js',
    'drive-sync.summary.js',
    'drive-sync.ui.js',
    'drive-sync.validate.js',
].map((name) => `${SYNC_MODULE_PREFIX}${name}`);

const isSyncRequest = (url) => url.pathname.includes(SYNC_MODULE_PREFIX);
const isSyncUIRequest = (url) => url.pathname.endsWith(SYNC_UI_MODULE_PATH);

function collectSyncRequests(page) {
    const requested = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (isSyncRequest(url)) requested.push(url);
    });
    return requested;
}

async function openPrivacy(page, suffix = '') {
    await page.goto(`${PRIVACY_PATH}${suffix}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.privacy-page h1')).toBeVisible();
}

async function expectNoDocumentOverflow(page) {
    await expect.poll(() => page.evaluate(() => (
        document.documentElement.scrollWidth
        <= document.documentElement.clientWidth + 1
    ))).toBe(true);
}

async function expectInsideViewport(page, locator) {
    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test('R6: default boot excludes Drive Sync stack and first activation reuses it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const requested = collectSyncRequests(page);
    await openPrivacy(page);

    const trigger = page.locator('#sync-nav-icon');
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const desktopTriggerBox = await trigger.boundingBox();
    expect(desktopTriggerBox.width).toBeGreaterThanOrEqual(40);
    expect(desktopTriggerBox.height).toBeGreaterThanOrEqual(40);
    await expectNoDocumentOverflow(page);
    await page.waitForTimeout(250);
    expect(requested, 'static boot must not fetch Drive Sync modules').toEqual([]);
    await expect(page.locator('#sync-popover')).toHaveCount(0);

    await trigger.click();
    const popover = page.locator('#sync-popover');
    await expect(popover).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expectInsideViewport(page, popover);
    await expect.poll(() => requested.map(({ pathname }) => pathname).sort()).toEqual(
        [...SYNC_MODULE_PATHS].sort()
    );

    const firstUseCount = requested.length;
    await trigger.click();
    await expect(popover).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(trigger).toBeVisible();
    await expectNoDocumentOverflow(page);
    await trigger.click();
    await expect(popover).toBeVisible();
    await expectInsideViewport(page, popover);
    await page.waitForTimeout(250);

    expect(requested, 'later activations must reuse the mounted sync stack').toHaveLength(firstUseCount);
    await expect(page.locator('#sync-popover')).toHaveCount(1);
    await expect(page.locator('#sync-conflict-modal')).toHaveCount(1);
});

test('R6: failed Drive Sync import exposes click-to-retry and succeeds', async ({ page }) => {
    const uiRequests = [];
    let uiAttempts = 0;
    await page.route(isSyncUIRequest, async (route) => {
        uiAttempts += 1;
        uiRequests.push(new URL(route.request().url()));
        if (uiAttempts === 1) {
            await route.fulfill({
                status: 503,
                contentType: 'application/javascript',
                body: '/* deterministic Drive Sync import failure */',
            });
            return;
        }
        await route.continue();
    });

    await openPrivacy(page);
    const trigger = page.locator('#sync-nav-icon');
    await trigger.click();

    await expect(trigger).toHaveAttribute('aria-label', /로드 실패, 다시 시도/);
    await expect(trigger.locator('.material-symbols-outlined')).toHaveText('cloud_off');
    expect(uiAttempts).toBe(1);
    await expect(page.locator('#sync-popover')).toHaveCount(0);

    await trigger.click();
    await expect(page.locator('#sync-popover')).toBeVisible();

    expect(uiAttempts).toBe(2);
    expect(uiRequests[0].search).toBe('');
    expect(uiRequests[1].searchParams.get('retry')).toBe('1');
});

test('R6: sync query preference keeps the shell click-lazy or removes it', async ({ page }) => {
    const requested = collectSyncRequests(page);
    await page.addInitScript(() => {
        localStorage.setItem('altoy:sync:beta', 'off');
    });

    await openPrivacy(page, '?sync=on');
    await expect(page.locator('#sync-nav-icon')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('altoy:sync:beta'))).toBe('on');
    await page.waitForTimeout(150);
    expect(requested).toEqual([]);

    await openPrivacy(page, '?sync=off');
    await expect(page.locator('#sync-nav-icon')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('altoy:sync:beta'))).toBe('off');
    await page.waitForTimeout(150);
    expect(requested).toEqual([]);
});
