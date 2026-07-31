/**
 * R13 loading boundary: the skin-detail search shell must not request
 * expression metadata. The first selected skin (including a deep link) loads
 * it once, and a failed optional load is retried by a later selection.
 */
import { existsSync, readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';
import { seedFuse } from './helpers.mjs';

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

const SKIN_DETAIL_PATH = PAGE_CATALOG.find(
    ({ key }) => key === 'SKIN_DETAIL'
)?.path;

if (!SKIN_DETAIL_PATH) {
    throw new Error('skin-detail-expression-loading: SKIN_DETAIL is missing from PAGE_CATALOG');
}

const EXPRESSION_MANIFEST_PATH = '/data/skin/expression_manifest.json';
const skinIndex = JSON.parse(readFileSync(
    new URL('../../public/data/skin/skin_voiceline_index.json', import.meta.url),
    'utf8'
));

let skinFixture = null;
for (const [character, entry] of Object.entries(skinIndex.characters || {})) {
    if (!Array.isArray(entry?.skins) || entry.skins.length < 2) continue;
    if (/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/.test(character)) continue;

    const chunkUrl = new URL(
        `../../public/data/skin/skin_characters/${entry.hash}.json`,
        import.meta.url
    );
    if (!existsSync(chunkUrl)) continue;

    skinFixture = {
        character,
        skins: entry.skins.slice(0, 2).map(({ name }) => name),
    };
    break;
}

if (!skinFixture) {
    throw new Error('skin-detail-expression-loading: no character with two skins is available');
}

test.beforeEach(async ({ page }) => {
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
        await route.abort('blockedbyclient');
    });
    await seedFuse(page);
});

function isExpressionManifest(url) {
    return new URL(url).pathname.endsWith(EXPRESSION_MANIFEST_PATH);
}

function collectExpressionRequests(page) {
    const requested = [];
    page.on('request', (request) => {
        if (isExpressionManifest(request.url())) {
            requested.push(EXPRESSION_MANIFEST_PATH);
        }
    });
    return requested;
}

function waitForExpressionManifest(page) {
    return page.waitForResponse(
        (response) => isExpressionManifest(response.url()) && response.ok(),
        { timeout: 30_000 }
    );
}

async function waitForSearchShell(page) {
    const input = page.locator('#character-search-input');
    await expect(input).toBeEnabled();

    // `charInput` is enabled in the markup and only ever disabled on load
    // failure, so being enabled proves nothing about initialization: the focus
    // handler is attached after initSkinData() resolves, and a focus that lands
    // before that populates nothing and is never retried by the page. Re-focus
    // until the options render — the 250ms gap lets the blur close-timer fire
    // first, so the final focus leaves the dropdown open.
    const options = page.locator('#character-dropdown-content [role="option"]');
    await expect.poll(async () => {
        await input.blur();
        await page.waitForTimeout(250);
        await input.focus();
        return options.count();
    }, { timeout: 30_000, intervals: [250] }).toBeGreaterThan(0);

    await expect(options.first()).toBeVisible();
}

async function chooseCharacter(page) {
    await page.locator('#character-search-input').focus();
    await page.locator('#character-dropdown-content').getByRole('option', {
        name: skinFixture.character,
        exact: true,
    }).click();
    await expect(page.locator('#skin-search-input')).toBeEnabled();
}

async function chooseSkin(page, skinName) {
    const skinInput = page.locator('#skin-search-input');
    // A selected dropdown link may leave the input focused. Force a complete
    // blur/close/focus cycle so the next focus handler repopulates the options.
    await skinInput.blur();
    await page.waitForTimeout(250);
    await skinInput.focus();
    const option = page.locator('#skin-dropdown-content').getByRole('option', {
        name: skinName,
        exact: true,
    });
    await expect(option).toBeVisible();
    await option.click();
    await expect(skinInput).toHaveValue(skinName);
    await expect(page.locator('#loading-skeleton')).toBeHidden();
    await expect(page.locator('#image-gallery')).toBeVisible();
}

test('R13: expression data starts on first skin detail, not search initialization', async ({ page }) => {
    const requested = collectExpressionRequests(page);

    await page.goto(SKIN_DETAIL_PATH, { waitUntil: 'domcontentloaded' });
    await waitForSearchShell(page);
    await page.waitForTimeout(1_000);
    expect(requested, 'default boot and character-search focus must not load expressions').toEqual([]);

    await chooseCharacter(page);

    const firstManifest = waitForExpressionManifest(page);
    await chooseSkin(page, skinFixture.skins[0]);
    await firstManifest;
    expect(requested).toEqual([EXPRESSION_MANIFEST_PATH]);

    await chooseSkin(page, skinFixture.skins[1]);
    await page.waitForTimeout(250);
    expect(requested, 'later skins must reuse the loaded manifest').toHaveLength(1);
});

test('R13: a skin deep link loads expression data before initial detail rendering', async ({ page }) => {
    const requested = collectExpressionRequests(page);
    const manifestResponse = waitForExpressionManifest(page);
    const query = new URLSearchParams({
        character: skinFixture.character,
        skin: skinFixture.skins[0],
    });

    await page.goto(`${SKIN_DETAIL_PATH}?${query}`, {
        waitUntil: 'domcontentloaded',
    });
    await manifestResponse;

    expect(requested).toEqual([EXPRESSION_MANIFEST_PATH]);
    await expect(page.locator('#character-search-input')).toHaveValue(skinFixture.character);
    await expect(page.locator('#skin-search-input')).toHaveValue(skinFixture.skins[0]);
    await expect(page.locator('#loading-skeleton')).toBeHidden();
    await expect(page.locator('#image-gallery')).toBeVisible();
});

test('R13: a failed expression load is retried by the next skin selection', async ({ page }) => {
    let attempts = 0;
    await page.route('**/data/skin/expression_manifest.json', async (route) => {
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

    await page.goto(SKIN_DETAIL_PATH, { waitUntil: 'domcontentloaded' });
    await waitForSearchShell(page);
    await chooseCharacter(page);
    await chooseSkin(page, skinFixture.skins[0]);
    expect(attempts).toBe(1);

    const retryResponse = waitForExpressionManifest(page);
    await chooseSkin(page, skinFixture.skins[1]);
    await retryResponse;

    expect(attempts).toBe(2);
    await expect(page.locator('#image-gallery')).toBeVisible();
});
