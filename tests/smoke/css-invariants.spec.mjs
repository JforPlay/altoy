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
    // Glass card token from mainpage.core.css (light): rgba(255, 255, 255, 0.6).
    // CSS minification may strip the leading zero (0.6 -> .6), so normalize before asserting.
    const cardBg = (await bodyVar(page, '--card-bg')).replace(/\b0(\.\d)/g, '$1');
    expect(cardBg).toContain('255, 255, 255, .6');
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

// --- Wave-1 spinner unification: canonical-applied probes ---------------------
// probeStyle injects <div class="<cls>"> and reads a computed prop. After
// migration the canonical spinner.css is delivered to each page and its local
// spinner CSS is deleted, so the injected element resolves to the canonical
// animation. RED before migration (local stats-spin / 1s / no .spin rule).

test('spinner: canonical .spinner reaches a default-theme page (shipgirl-stats)', async ({ page }) => {
    await page.goto(pathFor('shipgirl-stats'), { waitUntil: 'load' });
    expect(await probeStyle(page, 'spinner', 'animationName')).toBe('spin');
    expect(await probeStyle(page, 'spinner', 'animationDuration')).toBe('0.8s');
});

test('spinner: canonical .spinner reaches an accent-theme page (expression-viewer)', async ({ page }) => {
    await page.goto(pathFor('expression-viewer'), { waitUntil: 'load' });
    expect(await probeStyle(page, 'spinner', 'animationName')).toBe('spin');
    // RED before migration: expression's local .spinner uses 1s; canonical is 0.8s.
    expect(await probeStyle(page, 'spinner', 'animationDuration')).toBe('0.8s');
});

test('spinner: canonical .spin icon-utility reaches island', async ({ page }) => {
    await page.goto(pathFor('island/'), { waitUntil: 'load' });
    expect(await probeStyle(page, 'spin', 'animationName')).toBe('spin');
});

// --- Wave-1 status unification: canonical .page-status applied -----------------
// status.css is imported globally via Layout.astro, so the canonical state
// component must resolve on ANY page without a per-page import.

test('status: canonical .page-status is delivered globally (homepage)', async ({ page }) => {
    await page.goto('./', { waitUntil: 'load' });
    expect(await probeStyle(page, 'page-status', 'display')).toBe('flex');
    expect(await probeStyle(page, 'page-status', 'flexDirection')).toBe('column');
});

test('status: a migrated page dropped its old local loading rule (map-viewer)', async ({ page }) => {
    await page.goto(pathFor('map-viewer'), { waitUntil: 'load' });
    // .map-loading was deleted (→ canonical .page-status); an injected element
    // now falls back to the default block display. RED before migration (flex).
    expect(await probeStyle(page, 'map-loading', 'display')).toBe('block');
});

// --- Wave-1 focus-ring unification: canonical --focus-ring applied -------------
// theme.css defines `body { --focus-ring: 0 0 0 3px var(--primary-alpha-15) }`,
// loaded site-wide via Layout. Inject a probe whose box-shadow consumes the token
// and read the resolved color: it must be the canonical blue ring (α0.15), flip
// light↔dark via --primary-alpha-15, and be identical on accent-theme pages
// (accent does not redefine --primary-alpha-*). Proves the canonical is in force.
const probeFocusRing = (page) =>
    page.evaluate(() => {
        const el = document.createElement('div');
        el.style.boxShadow = 'var(--focus-ring)';
        document.body.appendChild(el);
        const value = getComputedStyle(el).boxShadow;
        el.remove();
        return value;
    });

test('focus-ring: canonical blue ring resolves in light mode (shipgirl-stats)', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('theme', 'light'); });
    await page.goto(pathFor('shipgirl-stats'), { waitUntil: 'load' });
    const ring = await probeFocusRing(page);
    expect(ring, `expected light blue ring, got: ${ring}`).toContain('0, 113, 235'); // accent-blue light
    expect(ring).toContain('3px'); // canonical spread
});

test('focus-ring: auto-adapts to dark mode (shipgirl-stats, default dark)', async ({ page }) => {
    await page.goto(pathFor('shipgirl-stats'), { waitUntil: 'load' }); // site defaults to dark
    const ring = await probeFocusRing(page);
    expect(ring, `expected dark blurple ring, got: ${ring}`).toContain('114, 137, 218'); // accent-blue dark
    expect(ring).toContain('3px');
});

test('focus-ring: identical on an accent-theme page (expression-viewer, light)', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('theme', 'light'); });
    await page.goto(pathFor('expression-viewer'), { waitUntil: 'load' });
    const ring = await probeFocusRing(page);
    // Accent theme does NOT override --primary-alpha-*, so the ring is the same blue.
    expect(ring, `expected same blue ring on accent page, got: ${ring}`).toContain('0, 113, 235');
    expect(ring).toContain('3px');
});

// --- Wave-1 badge unification: canonical .badge applied ------------------------
// badge.css is imported globally via Layout.astro, so the canonical display badge
// must resolve on ANY page without a per-page import. Injecting a bare `.badge`
// proves the rectangular base (--radius-sm = 4px) is in force everywhere — RED
// before migration (no global badge component → display:block, radius 0px) and on
// pages that had a local OVAL `.badge` (event-timeline was 1.25rem).

test('badge: canonical rectangular .badge is delivered globally (homepage)', async ({ page }) => {
    await page.goto('./', { waitUntil: 'load' });
    expect(await probeStyle(page, 'badge', 'display')).toBe('inline-flex');
    // --radius-sm = 0.25rem = 4px; never the old 1.25rem/999px pill.
    expect(await probeStyle(page, 'badge', 'borderRadius')).toBe('4px');
});

test('badge: a previously-oval page now resolves the rectangular canonical (event-timeline)', async ({ page }) => {
    await page.goto(pathFor('event-timeline'), { waitUntil: 'load' });
    // RED before migration: event-timeline's local `.badge` was border-radius 1.25rem (20px).
    expect(await probeStyle(page, 'badge', 'borderRadius')).toBe('4px');
});

test('badge: --count bubble is accent-blue, not a red alert (homepage, light)', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('theme', 'light'); });
    await page.goto('./', { waitUntil: 'load' });
    const bg = await probeStyle(page, 'badge badge--count', 'backgroundColor');
    expect(bg, `expected accent-blue count, got: ${bg}`).toBe('rgb(0, 113, 235)');
});

test('badge: the hidden attribute still hides a badge (homepage)', async ({ page }) => {
    await page.goto('./', { waitUntil: 'load' });
    // Regression: the author `display:inline-flex` on .badge beats the UA
    // [hidden]{display:none} rule, so a count bubble toggled via el.hidden (e.g.
    // equip-viewer's 0-count tag filter) leaked an empty circle. .badge[hidden]
    // restores it. probeStyle can't set attributes, so inline the element.
    const display = await page.evaluate(() => {
        const el = document.createElement('span');
        el.className = 'badge badge--count';
        el.hidden = true;
        document.body.appendChild(el);
        const v = getComputedStyle(el).display;
        el.remove();
        return v;
    });
    expect(display, `a hidden badge must not render, got: ${display}`).toBe('none');
});

// --- Wave-1 card-hover unification: canonical lift token applied ---------------
// theme.css defines `body { --card-lift: -2px; --card-hover-shadow: var(--shadow-lg) }`
// and components/card.css (global via Layout) maps .card-hover:hover to the tokens;
// the .card base + every per-page card selector consume them. Assert the token is
// delivered globally AND actually applies on a real hover — proving every migrated
// card lifts by the single canonical amount. RED before migration: no --card-lift
// token (empty) and pages carried bespoke -3/-5/-7px lifts.

test('card-hover: --card-lift token is delivered globally (homepage)', async ({ page }) => {
    await page.goto('./', { waitUntil: 'load' });
    expect(await bodyVar(page, '--card-lift')).toBe('-2px');
});

// Inject a .card-hover element, genuinely hover it (Playwright moves the mouse),
// and read the resolved transform. transition:none avoids reading a mid-animation
// frame. translateY(-2px) computes to matrix(1, 0, 0, 1, 0, -2).
const probeCardHoverLift = async (page) => {
    await page.evaluate(() => {
        const el = document.createElement('div');
        el.id = '__card_hover_probe__';
        el.className = 'card-hover';
        el.style.cssText =
            'position:fixed;top:0;left:0;width:60px;height:60px;z-index:99999;transition:none;';
        document.body.appendChild(el);
    });
    await page.hover('#__card_hover_probe__');
    return page.evaluate(() => {
        const el = document.getElementById('__card_hover_probe__');
        const t = getComputedStyle(el).transform;
        el.remove();
        return t;
    });
};

test('card-hover: canonical lift applies on hover (shipgirl-stats, default theme)', async ({ page }) => {
    await page.goto(pathFor('shipgirl-stats'), { waitUntil: 'load' });
    // RED if a page kept a -3/-5/-7px literal instead of var(--card-lift).
    expect(await probeCardHoverLift(page)).toBe('matrix(1, 0, 0, 1, 0, -2)');
});

test('card-hover: canonical lift is identical on an accent-theme page (expression-viewer)', async ({ page }) => {
    await page.goto(pathFor('expression-viewer'), { waitUntil: 'load' });
    // Accent theme does not redefine --card-lift, so the lift is the same -2px.
    expect(await probeCardHoverLift(page)).toBe('matrix(1, 0, 0, 1, 0, -2)');
});

// --- Wave-1 button unification: canonical .btn applied ------------------------
// button.css is imported globally via Layout.astro, so the canonical button must
// resolve on ANY page without a per-page import. The FILLED states use a stable
// hue (--accent-blue), never the grayscale --primary-color — injecting
// `.btn .btn-primary` and reading the background proves global delivery AND the
// contrast-safe fill AND that the global layer wins over page CSS. RED before
// migration: no global .btn (display:block) and the old sim base filled
// --primary-color (= silver #4a4a4a on the default light theme).

test('button: canonical .btn is delivered globally (homepage)', async ({ page }) => {
    await page.goto('./', { waitUntil: 'load' });
    expect(await probeStyle(page, 'btn', 'display')).toBe('inline-flex');
});

test('button: .btn-primary fills accent-blue on a default-theme page (shipgirl-stats, light)', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('theme', 'light'); });
    await page.goto(pathFor('shipgirl-stats'), { waitUntil: 'load' });
    const bg = await probeStyle(page, 'btn btn-primary', 'backgroundColor');
    // accent-blue light = #0071eb; NEVER the grayscale --primary-color (#4a4a4a).
    expect(bg, `expected accent-blue primary, got: ${bg}`).toBe('rgb(0, 113, 235)');
});

test('button: .btn-primary auto-adapts to dark (shipgirl-stats, default dark)', async ({ page }) => {
    await page.goto(pathFor('shipgirl-stats'), { waitUntil: 'load' }); // site defaults to dark
    const bg = await probeStyle(page, 'btn btn-primary', 'backgroundColor');
    expect(bg, `expected dark accent-blue, got: ${bg}`).toBe('rgb(114, 137, 218)'); // #7289da
});

test('button: segmented .btn.is-active fills accent-blue on an accent page (expression-viewer, light)', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('theme', 'light'); });
    await page.goto(pathFor('expression-viewer'), { waitUntil: 'load' });
    const bg = await probeStyle(page, 'btn is-active', 'backgroundColor');
    // Accent theme inherits --accent-blue from :root → same blue as default.
    expect(bg, `expected accent-blue active, got: ${bg}`).toBe('rgb(0, 113, 235)');
});

test('button: .btn-close is borderless (homepage)', async ({ page }) => {
    await page.goto('./', { waitUntil: 'load' });
    // Distinguishes .btn-close from bordered .btn-icon: transparent border resolves
    // to rgba(0, 0, 0, 0). The base .btn supplies `border: 1px solid transparent`.
    expect(await probeStyle(page, 'btn btn-close', 'borderTopColor')).toBe('rgba(0, 0, 0, 0)');
});

test('button: a segmented .btn-secondary carries a visible fill (sim-weapon, light)', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('theme', 'light'); });
    await page.goto(pathFor('sim-weapon'), { waitUntil: 'load' });
    // Regression: speed/pagination segments were bare .btn (transparent) → invisible
    // until selected. The neutral segment look comes from .btn-secondary, which must
    // resolve to a real surface (--bg-elevated), never the transparent base.
    const bg = await probeStyle(page, 'btn btn-secondary', 'backgroundColor');
    expect(bg, `expected a visible segment surface, got: ${bg}`).not.toBe('rgba(0, 0, 0, 0)');
});

// --- Wave-2 grid unification: canonical .card-grid applied --------------------
// grid.css is imported globally via Layout.astro. The canonical responsive grid
// is parameterized by per-consumer --grid-min/--grid-gap hooks; a bare injected
// .card-grid falls back to display:grid + gap var(--spacing-md). Assert global
// delivery, then prove a REAL migrated consumer carries the class AND resolves
// the var-hook (its local display:grid/grid-template-columns/gap were deleted).
// RED before migration: no global .card-grid (display:block); the consumer had
// no card-grid class and no --grid-min custom property.

test('grid: canonical .card-grid is delivered globally (homepage)', async ({ page }) => {
    await page.goto('./', { waitUntil: 'load' });
    expect(await probeStyle(page, 'card-grid', 'display')).toBe('grid');
    // Default --grid-gap is var(--spacing-md) = 1rem = 16px (theme-stable on default pages).
    expect(await probeStyle(page, 'card-grid', 'rowGap')).toBe('16px');
});

test('grid: a real consumer resolves the canonical var-hook (shipgirl-info)', async ({ page }) => {
    await page.goto(pathFor('shipgirl-info'), { waitUntil: 'load' });
    const probe = await page.evaluate(() => {
        const el = document.querySelector('.shipgirl-grid');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
            hasClass: el.classList.contains('card-grid'),
            display: cs.display,
            gridMin: cs.getPropertyValue('--grid-min').trim(),
        };
    });
    expect(probe, 'no .shipgirl-grid container found').not.toBeNull();
    expect(probe.hasClass, 'container must carry the canonical card-grid class').toBe(true);
    expect(probe.display).toBe('grid');
    // RED before migration: the local rule baked the min-width into
    // grid-template-columns and set no --grid-min (responsive value, so assert
    // it's a real length rather than an exact rem to stay viewport-tolerant).
    expect(probe.gridMin, `expected a --grid-min length, got: "${probe.gridMin}"`).toMatch(/\d/);
});

test('grid: a --fit consumer carries the auto-fit modifier (shipgirl-build-sim)', async ({ page }) => {
    await page.goto(pathFor('shipgirl-build-sim'), { waitUntil: 'load' });
    const probe = await page.evaluate(() => {
        const el = document.querySelector('.stats-grid');
        if (!el) return null;
        return { hasFit: el.classList.contains('card-grid--fit'), display: getComputedStyle(el).display };
    });
    expect(probe, 'no .stats-grid container found').not.toBeNull();
    expect(probe.hasFit, 'sparse grid must carry card-grid--fit').toBe(true);
    expect(probe.display).toBe('grid');
});

// --- section-title (Wave 2) --------------------------------------------------
// Canonical .section-title (flex row + 2px bottom rule) + .section-title--sm
// (borderless compact label) ship globally via Layout. These prove DELIVERY (the
// base reaches an arbitrary page) and that a real emitted consumer adopts it.
// RED before migration: no global .section-title (display:block, no border); the
// equip type header had its own local flex+border rule, not the canonical class.

test('section-title: canonical base is delivered globally (homepage)', async ({ page }) => {
    await page.goto('./', { waitUntil: 'load' });
    expect(await probeStyle(page, 'section-title', 'display')).toBe('flex');
    expect(await probeStyle(page, 'section-title', 'borderBottomWidth')).toBe('2px');
    expect(await probeStyle(page, 'section-title', 'borderBottomStyle')).toBe('solid');
});

test('section-title: the --sm variant drops the underline (homepage)', async ({ page }) => {
    await page.goto('./', { waitUntil: 'load' });
    // Compact label keeps the base flex row but loses the rule and goes 600.
    expect(await probeStyle(page, 'section-title section-title--sm', 'display')).toBe('flex');
    expect(await probeStyle(page, 'section-title section-title--sm', 'borderBottomStyle')).toBe('none');
    expect(await probeStyle(page, 'section-title section-title--sm', 'fontWeight')).toBe('600');
});

test('section-title: a real consumer adopts the canonical class (equip-viewer)', async ({ page }) => {
    await page.goto(pathFor('equip-viewer'), { waitUntil: 'load' });
    await page.waitForSelector('.type-section-header', { timeout: 15_000 });
    const probe = await page.evaluate(() => {
        const el = document.querySelector('.type-section-header');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
            hasClass: el.classList.contains('section-title'),
            display: cs.display,
            borderBottomWidth: cs.borderBottomWidth,
        };
    });
    expect(probe, 'no .type-section-header found on equip-viewer').not.toBeNull();
    expect(probe.hasClass, 'type header must carry the canonical section-title class').toBe(true);
    expect(probe.display).toBe('flex');
    // RED before migration: equip's 2px rule lived in equip.style.css; with the
    // class added the underline now comes from the global section-title base.
    expect(probe.borderBottomWidth).toBe('2px');
});
