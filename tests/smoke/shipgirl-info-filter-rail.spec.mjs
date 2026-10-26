/**
 * Filter rail layout: two rail lines on desktop with the counter in the rail;
 * on phones the counter moves to the header row and the three flag toggles
 * share one line without clipping or horizontal page scroll.
 */
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';
import { seedFuse } from './helpers.mjs';

const SHIPGIRL_INFO_PATH = PAGE_CATALOG.find(
    ({ key }) => key === 'SHIPGIRL_INFO'
)?.path;

if (!SHIPGIRL_INFO_PATH) {
    throw new Error('shipgirl-info-filter-rail: SHIPGIRL_INFO is missing from PAGE_CATALOG');
}

async function openCatalog(page, viewport) {
    await page.setViewportSize(viewport);
    await page.goto(SHIPGIRL_INFO_PATH, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#shipgirls .shipgirl-card').first()).toBeVisible();
    await expect(page.locator('#loading')).toBeHidden();
}

test.beforeEach(async ({ page }) => {
    await seedFuse(page);
});

test('desktop rail has two lines and carries the counter', async ({ page }) => {
    await openCatalog(page, { width: 1280, height: 900 });

    await expect(page.locator('.stats-rail')).toBeVisible();
    await expect(page.locator('.stats-header')).toBeHidden();
    await expect(page.locator('#filterRail > .rail-line')).toHaveCount(2);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
    test(`phone ${viewport.width}px: counter in header, toggles on one line`, async ({ page }) => {
        await openCatalog(page, viewport);

        await expect(page.locator('.stats-header')).toBeVisible();
        await expect(page.locator('.stats-rail')).toBeHidden();

        const layout = await page.evaluate(() => {
            const toggles = [...document.querySelectorAll('.rail-toggles .filter-toggle-btn')];
            const tops = toggles.map((btn) => Math.round(btn.getBoundingClientRect().top));
            // nowrap keeps the tops equal by construction; the real failure is the
            // line running past the rail's edge into the page gutter.
            const railRight = document.getElementById('filterRail').getBoundingClientRect().right;
            const pastRail = toggles.filter((btn) => btn.getBoundingClientRect().right > railRight + 1)
                .map((btn) => btn.id);
            // The labels are inline spans (clientWidth 0), so check the button's
            // own overflow and that each label sits inside its button.
            const clipped = [...document.querySelectorAll('.header-stats-row .map-browser-btn')]
                .filter((btn) => {
                    const box = btn.getBoundingClientRect();
                    const label = btn.querySelector('span').getBoundingClientRect();
                    return btn.scrollWidth > btn.clientWidth + 1
                        || label.left < box.left - 1 || label.right > box.right + 1;
                })
                .map((btn) => btn.id);
            const root = document.documentElement;
            return { tops, pastRail, clipped, overflow: root.scrollWidth > root.clientWidth + 1 };
        });

        expect(layout.tops).toHaveLength(3);
        expect(new Set(layout.tops).size, `toggle tops ${layout.tops}`).toBe(1);
        expect(layout.pastRail).toEqual([]);
        expect(layout.clipped).toEqual([]);
        expect(layout.overflow).toBe(false);
    });
}
