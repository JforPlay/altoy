/**
 * Boss viewer behaviour: the gallery, its filters, and the detail drawer.
 *
 * The all-pages sweep only proves boss-viewer boots without throwing. This spec
 * proves it actually works, and pins the one rule that is silently dangerous to
 * break: Operation Siren rows must never render numeric stats, because their raw
 * config values are wrong by three orders of magnitude (Hermit IX reads hp=240
 * against a real ~1.9M) and would read as authoritative next to real bosses.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

const BOSS_PATH = PAGE_CATALOG.find(({ key }) => key === 'BOSS_VIEWER')?.path;
if (!BOSS_PATH) {
    throw new Error('boss-viewer-loading: BOSS_VIEWER is missing from PAGE_CATALOG');
}

const bossData = JSON.parse(readFileSync(
    new URL('../../public/data/boss/boss_data.json', import.meta.url), 'utf8'
));
const IDENTITY_COUNT = Object.keys(bossData).length;
const sirenIcon = Object.keys(bossData).find(
    (icon) => bossData[icon].app.some((a) => a.src === 'siren')
);

test('gallery renders every identity and reports the count', async ({ page }) => {
    await page.goto(BOSS_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#bossGrid .boss-card');

    await expect(page.locator('#bossGrid .boss-card')).toHaveCount(IDENTITY_COUNT);
    await expect(page.locator('#bossCount')).toHaveText(`${IDENTITY_COUNT}종`);
    await expect(page.locator('#bossFilters .chip').first()).toBeVisible();
});

test('source and armor chips narrow the grid, and clicking an active chip clears it', async ({ page }) => {
    await page.goto(BOSS_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#bossGrid .boss-card');

    const mainChip = page.locator('#bossFilters .chip[data-value="main"]');
    await mainChip.click();
    await expect(mainChip).toHaveClass(/active/);
    const filtered = await page.locator('#bossGrid .boss-card').count();
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(IDENTITY_COUNT);

    // Armor stacks with source rather than replacing it.
    await page.locator('#bossFilters .chip[data-value="3"]').click();
    const both = await page.locator('#bossGrid .boss-card').count();
    expect(both).toBeLessThanOrEqual(filtered);

    await page.locator('#bossFilters .chip[data-value="3"]').click();
    await mainChip.click();
    await expect(mainChip).not.toHaveClass(/active/);
    await expect(page.locator('#bossGrid .boss-card')).toHaveCount(IDENTITY_COUNT);
});

test('search narrows to a named boss', async ({ page }) => {
    await page.goto(BOSS_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#bossGrid .boss-card');

    await page.locator('#bossSearch').fill('무사시');
    await expect(page.locator('#bossGrid .boss-card').first()).toContainText('무사시');
    expect(await page.locator('#bossGrid .boss-card').count()).toBeLessThan(IDENTITY_COUNT);
});

test('clicking a card opens the drawer with that boss\'s verified stats and a map link', async ({ page }) => {
    await page.goto(BOSS_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#bossGrid .boss-card');

    await page.locator('#bossGrid .boss-card[data-icon="wuzang"]').click();
    await expect(page.locator('#bossDetailPanel')).toHaveClass(/open/);
    await expect(page.locator('#bossDetailTitle')).toHaveText('무사시');
    // 16-4: 455,000 HP at Lv132, cross-checked against KR config.
    const row = page.locator('.boss-row', { hasText: '16–4' }).first();
    await expect(row).toContainText('455,000');
    await expect(row.locator('a.boss-row-link')).toHaveAttribute('href', /map-viewer\/\?map=1604/);

    await page.keyboard.press('Escape');
    await expect(page.locator('#bossDetailPanel')).not.toHaveClass(/open/);
});

test('a ?boss= deep link opens the drawer, and an unknown one is ignored', async ({ page }) => {
    await page.goto(`${BOSS_PATH}?boss=wuzang`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#bossDetailPanel')).toHaveClass(/open/);
    await expect(page.locator('#bossDetailTitle')).toHaveText('무사시');

    await page.goto(`${BOSS_PATH}?boss=not-a-real-boss`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#bossGrid .boss-card');
    await expect(page.locator('#bossDetailPanel')).not.toHaveClass(/open/);
});

test('map-viewer 보스 card links to this boss, closing the crosslink round trip', async ({ page }) => {
    const mapPath = PAGE_CATALOG.find(({ key }) => key === 'MAP_VIEWER').path;
    // 16-4 declares boss icon "wuzang" in chapter_template.
    await page.goto(`${mapPath}?tab=main&map=1604`, { waitUntil: 'domcontentloaded' });

    const bossCard = page.locator('.map-boss-card');
    await expect(bossCard).toBeVisible();
    await expect(bossCard.locator('.map-boss-name')).toHaveText('무사시');

    await bossCard.locator('a.btn').click();
    await page.waitForSelector('#bossDetailPanel.open');
    await expect(page.locator('#bossDetailTitle')).toHaveText('무사시');
});

test('Operation Siren rows show the scaling notice and no numeric stats', async ({ page }) => {
    test.skip(!sirenIcon, 'no siren appearances in the dataset');

    await page.goto(`${BOSS_PATH}?boss=${sirenIcon}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#bossDetailPanel')).toHaveClass(/open/);

    const sirenRows = page.locator('.boss-row', { has: page.locator('.boss-row-scaled') });
    expect(await sirenRows.count()).toBeGreaterThan(0);
    await expect(sirenRows.first()).toContainText('게임 내 보정 적용');
    // The stat grid must be absent entirely, not merely zeroed.
    await expect(sirenRows.first().locator('.boss-row-stats')).toHaveCount(0);
});
