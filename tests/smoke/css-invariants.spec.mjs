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

// --- A7: skin.common.css decoupling sentinels -------------------------------
// Inject a probe element carrying a class, read a distinctive computed prop,
// then remove it. This proves whether a CSS RULE is DELIVERED to a page's
// bundle, independent of whether the page renders such an element at runtime.
const probeStyle = (page, className, prop) =>
    page.evaluate(({ className, prop }) => {
        const el = document.createElement('div');
        el.className = className;
        document.body.appendChild(el);
        const value = getComputedStyle(el)[prop];
        el.remove();
        return value;
    }, { className, prop });

// THE decoupling invariant. RED before the refactor (sim-weapon imports
// skin.common.css, which sets .filter-container { display: flex }); GREEN after
// (sim-weapon imports common.css only; sim.common.css has no .filter-container).
test('A7: sim-weapon no longer receives the skin-only .filter-container rule', async ({ page }) => {
    await page.goto(pathFor('sim-weapon'), { waitUntil: 'load' });
    expect(await probeStyle(page, 'filter-container', 'display')).toBe('block');
});

// Base layer still reaches a non-skin importer: .main-container is defined only
// by common.css among sim-weapon's imports (sim.common.css does not set it).
test('A7: sim-weapon still receives the shared base layer (common.css)', async ({ page }) => {
    await page.goto(pathFor('sim-weapon'), { waitUntil: 'load' });
    expect(await probeStyle(page, 'main-container', 'maxWidth')).toBe('1200px'); // 75rem
});

// .card relocated into common.css and still reaches a skin page (skin-detail
// does NOT import sim.common.css, so common.css's gradient .card wins).
test('A7: skin-detail-viewer keeps the shared .card (now in common.css)', async ({ page }) => {
    await page.goto(pathFor('skin-detail-viewer'), { waitUntil: 'load' });
    expect(await probeStyle(page, 'card', 'backgroundImage')).toContain('gradient');
});

// Skin-only UI still reaches skin pages (skin.list.viewer overrides radius, not display).
test('A7: skin-list-viewer keeps the skin-only .filter-container rule', async ({ page }) => {
    await page.goto(pathFor('skin-list-viewer'), { waitUntil: 'load' });
    expect(await probeStyle(page, 'filter-container', 'display')).toBe('flex');
});
