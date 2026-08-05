/**
 * R1 loading boundary: the equipment-skin catalog must not warm the simulator
 * datasets, while the first preview and a skin deep link must still load them.
 *
 * This remains a Playwright smoke spec (`.spec.mjs`) because the boundary is a
 * browser request contract over the built site, not a DOM-free unit.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';
import { seedFuse } from './helpers.mjs';

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

const EQUIP_SKIN_PATH = PAGE_CATALOG.find(
    ({ path }) => path.includes('equip-skin-viewer')
)?.path;

if (!EQUIP_SKIN_PATH) {
    throw new Error('equip-skin-loading: equip-skin-viewer is missing from PAGE_CATALOG');
}

const SIM_DATA_PATHS = [
    '/data/sim/barrage_template.json',
    '/data/sim/bullet_template.json',
    '/data/sim/weapon_property.json',
];

const skins = JSON.parse(readFileSync(
    new URL('../../public/data/equip/equip_skin_template.json', import.meta.url),
    'utf8'
));
const deepLinkSkin = Object.values(skins).find(
    (skin) => skin?.id && skin?.themeid
);

if (!deepLinkSkin) {
    throw new Error('equip-skin-loading: no valid skin is available for the deep-link test');
}

function simDataPath(url) {
    const pathname = new URL(url).pathname;
    return SIM_DATA_PATHS.find((suffix) => pathname.endsWith(suffix)) || null;
}

function collectSimRequests(page) {
    const requested = [];
    page.on('request', (request) => {
        const path = simDataPath(request.url());
        if (path) requested.push(path);
    });
    return requested;
}

function waitForSimData(page) {
    return Promise.all(SIM_DATA_PATHS.map((path) => page.waitForResponse(
        (response) => simDataPath(response.url()) === path && response.ok(),
        { timeout: 30_000 }
    )));
}

test('R1: simulator data starts on first skin preview, not catalog boot', async ({ page }) => {
    await seedFuse(page);
    const requested = collectSimRequests(page);

    await page.goto(EQUIP_SKIN_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#theme-list .esv-theme-item');
    await page.waitForTimeout(1_000);
    expect(requested, 'default equipment-skin boot must not load simulator data').toEqual([]);

    await page.locator('#theme-list .esv-theme-item').first().click();
    await page.waitForSelector('#skin-grid-container .esv-skin-card');
    expect(requested, 'theme selection must remain catalog-only').toEqual([]);

    const firstPreviewData = waitForSimData(page);
    await page.locator('#skin-grid-container .esv-skin-card').first().click();
    await firstPreviewData;

    expect([...new Set(requested)].sort()).toEqual([...SIM_DATA_PATHS].sort());
    expect(requested, 'first preview must request each simulator file once').toHaveLength(3);
    await expect(page.locator('#skin-info')).toBeVisible();

    const skinCards = page.locator('#skin-grid-container .esv-skin-card');
    if (await skinCards.count() > 1) {
        await skinCards.nth(1).click();
        await page.waitForTimeout(250);
        expect(requested, 'subsequent previews must reuse the loaded simulator data').toHaveLength(3);
    }
});

// The deferral moved a ~32 MiB download onto the first preview, so the spinner
// is the stage's only feedback. It has to actually render on the cold fire and
// never appear again: startLoop re-fires every 3s and a per-cycle flash strobes.
test('R1: the first preview renders a loading spinner and later previews do not', async ({ page }) => {
    await seedFuse(page);
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route('**/data/sim/weapon_property.json', async (route) => {
        await held;
        await route.continue();
    });

    await page.goto(EQUIP_SKIN_PATH, { waitUntil: 'domcontentloaded' });
    await page.locator('#theme-list .esv-theme-item').first().click();
    await page.waitForSelector('#skin-grid-container .esv-skin-card');

    // Count every transition to visible — a poll would miss a brief flash.
    await page.evaluate(() => {
        window.__previewLoadingShows = 0;
        const el = document.getElementById('preview-loading');
        new MutationObserver(() => {
            if (!el.classList.contains('hidden')) window.__previewLoadingShows++;
        }).observe(el, { attributes: true, attributeFilter: ['class'] });
    });

    const loading = page.locator('#preview-loading');
    const cards = page.locator('#skin-grid-container .esv-skin-card');

    await expect(loading).toBeHidden();
    await cards.first().click();
    await expect(loading).toBeVisible();

    release();
    await expect(loading).toBeHidden();

    const warmCard = await cards.count() > 1 ? cards.nth(1) : cards.first();
    await warmCard.click();
    await page.locator('#fire-button').click();
    await page.waitForTimeout(500);

    await expect(loading).toBeHidden();
    expect(
        await page.evaluate(() => window.__previewLoadingShows),
        'only the cold fire may show the spinner'
    ).toBe(1);
});

test('R1: a skin deep link loads the simulator data needed for its preview', async ({ page }) => {
    await seedFuse(page);
    const requested = collectSimRequests(page);
    const deepLinkData = waitForSimData(page);

    await page.goto(`${EQUIP_SKIN_PATH}?skin=${deepLinkSkin.id}`, {
        waitUntil: 'domcontentloaded',
    });
    await deepLinkData;

    expect([...new Set(requested)].sort()).toEqual([...SIM_DATA_PATHS].sort());
    expect(requested, 'deep-link restoration must request each simulator file once').toHaveLength(3);
    await expect(page.locator('#skin-info')).toBeVisible();
    await expect(page.locator(
        `#skin-grid-container .esv-skin-card[data-skin-id="${deepLinkSkin.id}"]`
    )).toHaveClass(/active/);
});
