/**
 * CSS structural-dedup invariants — guards the body-background consolidation
 * and mainpage token-scoping. No visual-diff net exists, so we assert the exact
 * failure modes via getComputedStyle: a default page resolves to the shared
 * gradient; an override page does NOT inherit it (no bleed); mainpage keeps its
 * glass tokens after scoping. Rides `npm run test:smoke` (needs a prior build).
 */
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';

// Resolve a catalog page by a substring of its path (robust to key renames).
const pathFor = (sub) => {
    const hit = PAGE_CATALOG.find((p) => p.path.includes(sub));
    if (!hit) throw new Error(`css-invariants: no PAGE_CATALOG path matching "${sub}"`);
    return hit.path;
};

const bodyBgImage = (page) =>
    page.evaluate(() => getComputedStyle(document.body).backgroundImage);
const bodyVar = (page, name) =>
    page.evaluate((n) => getComputedStyle(document.body).getPropertyValue(n).trim(), name);

// Pages that should show the shared global gradient (no own body background).
const DEFAULT_PAGES = ['shipgirl-stats', 'equip-viewer', 'wiki'];
// background-color pitfall pages (Task 6 converts these to shorthand) — must NOT
// inherit the global gradient. island uses `background:` shorthand already → manual pass.
const OVERRIDE_PAGES = ['skin-list-viewer', 'dorm3d', 'main-storyline', 'juustagram'];

for (const sub of DEFAULT_PAGES) {
    test(`default page ${sub} resolves the shared body gradient`, async ({ page }) => {
        await page.goto(pathFor(sub), { waitUntil: 'load' });
        expect(await bodyBgImage(page)).toContain('gradient');
    });
}

for (const sub of OVERRIDE_PAGES) {
    test(`override page ${sub} does not inherit the global gradient`, async ({ page }) => {
        await page.goto(pathFor(sub), { waitUntil: 'load' });
        const bg = await bodyBgImage(page);
        // These pages set a flat color (skin/chat/story/juus) → backgroundImage 'none'.
        // If the global gradient bleeds through a background-color override, this fails.
        expect(bg, `expected no gradient bleed, got: ${bg}`).toBe('none');
    });
}

test('mainpage keeps its scoped glass --card-bg after token scoping', async ({ page }) => {
    // The app defaults to dark mode (getStorageItem('theme','dark') in global.script.js).
    // Force light via localStorage so the light-value assertion is deterministic.
    await page.addInitScript(() => { localStorage.setItem('theme', 'light'); });
    await page.goto('./', { waitUntil: 'load' }); // '/altoy/' homepage, as pages.spec.mjs does
    // Glass card token from mainpage.core.css (light): rgba(255, 255, 255, 0.6)
    expect(await bodyVar(page, '--card-bg')).toContain('255, 255, 255, 0.6');
    expect(await bodyBgImage(page)).toContain('gradient'); // its own 3-stop gradient
});
