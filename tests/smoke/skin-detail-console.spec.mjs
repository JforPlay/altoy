/**
 * Stacking guard for the skin detail console's two full-screen overlays.
 *
 * 전체 표정 (#face-grid) is reachable from INSIDE the fullscreen viewer
 * (#stage-viewer) — openViewer lends the viewer the live 표정 dock, 전체 표정 button
 * included — so the two genuinely stack, and #face-grid is the EARLIER DOM sibling.
 * At equal z-index the viewer therefore wins and the grid opens invisibly behind it.
 *
 * `.sdv-facegrid`'s one-rung z-index bump is what prevents that, and it silently
 * stopped applying once it was written as `.sdv-overlay.sdv-facegrid`: the stage
 * module's `ensureOverlay` assigns `node.className`, so the markup's shared
 * `sdv-overlay` class is gone before anything is ever shown and a two-class selector
 * cannot match. Nothing in the build, check:css-tokens or the page sweep noticed —
 * the rule was present, correct-looking, and dead (fixed 2026-09-22).
 *
 * A "the grid is visible" assertion does NOT catch this: the grid IS displayed and
 * has a real box, it is simply painted under an opaque sibling. Only a hit test at
 * its own centre can tell the two apart.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';
import { seedFuse } from './helpers.mjs';

test.setTimeout(90_000);

const SKIN_DETAIL_PATH = PAGE_CATALOG.find(({ key }) => key === 'SKIN_DETAIL')?.path;
if (!SKIN_DETAIL_PATH) {
    throw new Error('skin-detail-console: SKIN_DETAIL is missing from PAGE_CATALOG');
}

/**
 * 전체 표정 only renders when the 표정 strip overflows the dock frame, so the fixture
 * has to be a skin with a LOT of expressions — picked from the committed manifest
 * rather than hard-coded, so a data refresh that retires one skin cannot silently
 * skip the assertion. Manifest ids are `<clientId>` for the base painting.
 */
const manifest = JSON.parse(readFileSync(
    new URL('../../public/data/skin/expression_manifest.json', import.meta.url), 'utf8'
));
const skinIndex = JSON.parse(readFileSync(
    new URL('../../public/data/skin/skin_voiceline_index.json', import.meta.url), 'utf8'
));

const faceCount = new Map();
for (const [id, entry] of Object.entries(manifest)) {
    if (id.includes('_')) continue;                 // `<id>_n` is the zoomed painting
    faceCount.set(Number(id), (entry?.faces || []).length);
}

let fixture = null;
for (const [character, entry] of Object.entries(skinIndex.characters || {})) {
    for (const skin of entry?.skins || []) {
        if ((faceCount.get(Number(skin.clientId)) || 0) < 16) continue;
        fixture = { character, skin: skin.name };
        break;
    }
    if (fixture) break;
}
if (!fixture) {
    throw new Error('skin-detail-console: no skin with >=16 expressions in the committed manifest');
}

test('전체 표정 opened from the fullscreen viewer paints above it', async ({ page }) => {
    await seedFuse(page);

    const url = `${SKIN_DETAIL_PATH}?character=${encodeURIComponent(fixture.character)}`
        + `&skin=${encodeURIComponent(fixture.skin)}`;
    await page.goto(url);

    // The dock is built from the manifest, so its tiles are the signal that the
    // stage has finished resolving this skin's expressions.
    await expect(page.locator('#stage-dock .sdv-face-tile').first()).toBeAttached({ timeout: 45_000 });

    await page.locator('.sdv-art-full').click();
    await expect(page.locator('#stage-viewer')).not.toHaveClass(/hidden/);

    // The dock MOVES into the viewer's foot rather than being copied, so this is
    // the same button — and it must be reachable there.
    const allFaces = page.locator('#stage-viewer .sdv-face-all');
    await expect(allFaces).toBeVisible();
    await allFaces.click();

    await expect(page.locator('#face-grid')).not.toHaveClass(/hidden/);

    // Every rect in ONE evaluate: three boundingBox() calls are three layout
    // snapshots, and a still-settling overlay moves between them.
    const stacking = await page.evaluate(() => {
        const grid = document.getElementById('face-grid');
        const box = grid.getBoundingClientRect();
        const hit = document.elementFromPoint(
            Math.round(box.left + box.width / 2),
            Math.round(box.top + 80),
        );
        return {
            owner: hit?.closest('#face-grid') ? 'face-grid'
                : hit?.closest('#stage-viewer') ? 'stage-viewer'
                    : (hit?.id || hit?.className || 'none'),
            gridZ: Number(getComputedStyle(grid).zIndex),
            viewerZ: Number(getComputedStyle(document.getElementById('stage-viewer')).zIndex),
        };
    });

    expect(stacking.owner).toBe('face-grid');
    expect(stacking.gridZ).toBeGreaterThan(stacking.viewerZ);

    // A tile in the grid must therefore be clickable — which is the whole point of
    // the overlay, and what was impossible while it was buried.
    await page.locator('#face-grid .sdv-facegrid-tile').first().click();
    await expect(page.locator('#face-grid')).toHaveClass(/hidden/);
});
