/**
 * skin-theme-filter.spec.mjs
 * The 스킨 타입 <select> on skin-list-viewer and skin-poll is filled from the
 * loaded data, not from a hand-typed <option> list. Both pages ship exactly one
 * option in markup ('전체') and JS replaces the list at boot.
 *
 * This is the check the all-pages sweep cannot make: an empty or unpopulated
 * select raises no console error, so pages.spec.mjs stays green while the whole
 * filter is dead. Assert the list GREW past its markup baseline — a bare
 * "some theme is present" assertion would pass against the markup itself.
 */
import { test, expect } from '@playwright/test';

const PAGES = [
    { name: 'skin-list-viewer', url: 'skin/skin-list-viewer/' },
    { name: 'skin-poll', url: 'skin/skin-poll/' },
];

for (const { name, url } of PAGES) {
    test(`${name} derives its 스킨 타입 options from the data`, async ({ page }) => {
        await page.goto(url);

        const options = page.locator('#skin-type-select option');
        // Markup ships 1 option; anything at or below 2 means JS never ran or
        // produced an empty theme list.
        await expect.poll(() => options.count(), { timeout: 15000 })
            .toBeGreaterThan(20);

        const values = await options.evaluateAll(els => els.map(el => el.value));
        expect(values[0]).toBe('all');
        // '기본' is the null-theme bucket — it has no row in the data, so the
        // page must add it rather than derive it.
        expect(values).toContain('기본');

        // Themes that only exist because they were read out of the skin
        // records. 개조/서약 are real shop_type_ids (9997/9998), not markup.
        expect(values).toContain('수영복');
        expect(values).toContain('개조');
        expect(values).toContain('서약');

        // Derived list is ko-sorted after the two fixed leading entries.
        const themes = values.slice(2);
        expect(themes).toEqual([...themes].sort((a, b) => a.localeCompare(b, 'ko')));
    });
}

test('selecting a derived theme actually filters skin-list-viewer', async ({ page }) => {
    await page.goto('skin/skin-list-viewer/');

    const cards = page.locator('.skin-box-link:visible');
    await expect.poll(() => cards.count(), { timeout: 15000 }).toBeGreaterThan(50);
    const unfiltered = await cards.count();

    // 온천 타임 shares no characters with the other theme names, so a fuzzy
    // match cannot carry this assertion with the filter disabled.
    await page.selectOption('#skin-type-select', '온천 타임');

    // Assert the result set MOVED before asserting what is in it — the filter
    // is debounced, and Playwright's auto-retry would otherwise find cards
    // that were already in the unfiltered list.
    await expect.poll(() => cards.count()).not.toBe(unfiltered);
    expect(await cards.count()).toBeLessThan(unfiltered);
});
