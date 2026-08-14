/**
 * story-search.spec.mjs
 * 함순이별 스토리 찾기 — end-to-end: search a character, pick a result, and
 * confirm the deep links actually open that memory in the target viewer.
 *
 * The generated index is a data:split artifact, so this exercises the real
 * built data rather than a fixture (the node tests cover the builder itself).
 */
import { test, expect } from '@playwright/test';

const PAGE = 'story-viewer/story-search/';

test('default list, search, and selection render memories', async ({ page }) => {
    await page.goto(PAGE);

    // Before any query the most-featured characters seed the list.
    const ships = page.locator('.story-search-ship');
    await expect(ships.first()).toBeVisible();
    const defaultCount = await ships.count();
    expect(defaultCount).toBeGreaterThan(5);

    await page.fill('#ship-search', '엔터프라이즈');
    await expect(ships.first()).toContainText('엔터프라이즈');

    // The top hit is auto-selected, so memories appear without a second click.
    await expect(page.locator('.story-search-results-title')).toContainText('엔터프라이즈');
    await expect(page.locator('.story-search-memory').first()).toBeVisible();

    // Grouped by source, and the counts add up to the character's badge.
    const groups = page.locator('.story-search-group');
    expect(await groups.count()).toBeGreaterThan(0);
    const total = Number((await page.locator('.story-search-results-count').textContent()).replace(/\D/g, ''));
    expect(await page.locator('.story-search-memory').count()).toBe(total);
});

test('?gid= restores a selection and highlights it in the list', async ({ page }) => {
    await page.goto(`${PAGE}?gid=10706`);
    await expect(page.locator('.story-search-results-title')).toContainText('엔터프라이즈');
    await expect(page.locator('.story-search-ship[aria-pressed="true"]')).toContainText('엔터프라이즈');
});

test('each source group deep-links into a viewer that opens the memory', async ({ page }) => {
    await page.goto(PAGE);
    await page.fill('#ship-search', '엔터프라이즈');
    await expect(page.locator('.story-search-results-title')).toContainText('엔터프라이즈');

    const groups = page.locator('.story-search-group');
    for (let i = 0; i < await groups.count(); i++) {
        const group = groups.nth(i);
        const label = await group.locator('.section-title').textContent();
        const href = await group.locator('.story-search-memory').first().getAttribute('href');
        const title = await group.locator('.story-search-memory-title').first().textContent();

        await page.goto(href);
        // The viewer lands directly in the story pane with that memory loaded.
        // Its heading may prefix the event name, so match on containment.
        await expect(page.locator('#story-viewer-view'), `${label} → ${href}`).toBeVisible();
        await expect(page.locator('#story-title')).toContainText(title.trim());
        await page.goBack();
    }
});
