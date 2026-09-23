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

/**
 * Second fixture, for the 확대 test below: a skin the manifest knows under BOTH
 * `<id>` and `<id>_n`. The two paintings share one `baseDir` and are told apart
 * only by the file prefix, so a skin with just one of them cannot see the bug.
 */
let zoomFixture = null;
for (const [character, entry] of Object.entries(skinIndex.characters || {})) {
    for (const skin of entry?.skins || []) {
        const id = Number(skin.clientId);
        if (!manifest[String(id)]?.faces?.length) continue;
        if (!manifest[`${id}_n`]?.faces?.length) continue;
        zoomFixture = { character, skin: skin.name, id };
        break;
    }
    if (zoomFixture) break;
}
if (!zoomFixture) {
    throw new Error('skin-detail-console: no skin with both <id> and <id>_n expression entries');
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

/**
 * The caption must fit the stage at the narrowest desktop width.
 *
 * At 1100px the stage column is 386px. As one unwrapped flex row the caption
 * squeezed the title to one syllable per line and ran the 전체화면 button on under
 * the 대사 column — the test above timed out on that very click in CI (2026-09-23),
 * 1280 being Playwright's default width. Wrapping the whole row instead drops the
 * button onto the 일러 column, so both neighbours are asserted. The art label is
 * awaited because it lands last and is the widest member the row has to fit.
 */
test('caption keeps the 전체화면 button clear of the 대사 and 일러 columns', async ({ page }) => {
    await seedFuse(page);
    await page.setViewportSize({ width: 1100, height: 800 });

    const url = `${SKIN_DETAIL_PATH}?character=${encodeURIComponent(fixture.character)}`
        + `&skin=${encodeURIComponent(fixture.skin)}`;
    await page.goto(url);
    await expect(page.locator('#stage-art-label')).not.toBeEmpty({ timeout: 45_000 });

    const layout = await page.evaluate(() => {
        const rect = sel => document.querySelector(sel).getBoundingClientRect();
        const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const btn = rect('.sdv-art-full');
        const hit = document.elementFromPoint(btn.left + btn.width / 2, btn.top + btn.height / 2);
        const range = document.createRange();
        range.selectNodeContents(document.getElementById('skin-title'));
        return {
            buttonOnTop: !!hit?.closest('.sdv-art-full'),
            onVoice: meets(btn, rect('#sdv-voice')),
            onAssets: meets(btn, rect('#stage-assets')),
            titleLines: new Set([...range.getClientRects()].map(r => Math.round(r.top))).size,
        };
    });

    expect(layout).toMatchObject({ buttonOnTop: true, onVoice: false, onAssets: false });
    expect(layout.titleLines).toBeLessThanOrEqual(2);
});

/**
 * The 표정 rail must draw the faces of the art that is ON the stage.
 *
 * 전체 (`painting`) and 확대 (`painting_n`) resolve to two different paintings in
 * the SAME `output_expressions/<id>/` dir, told apart only by the file prefix, and
 * both have a full set of `_face_N.png` beside each other. So a thumbnail URL that
 * hardcodes `painting_face_` still returns 200 under 확대 — it just returns the
 * wrong face — and neither the console gate, an image-404 check nor a visibility
 * assertion can see it. `thumbUrl` carried exactly that for months.
 *
 * Asserting the URL is the only thing that separates "loaded" from "loaded the
 * right one". It also guards the webp tier the WSL pipeline emits: `thumbs/` is
 * keyed by the same prefix, so one wrong `baseName` there is a 404 per face.
 */
test('확대 rail thumbnails come from painting_n, not the base painting', async ({ page }) => {
    await seedFuse(page);

    const url = `${SKIN_DETAIL_PATH}?character=${encodeURIComponent(zoomFixture.character)}`
        + `&skin=${encodeURIComponent(zoomFixture.skin)}`;
    await page.goto(url);
    await expect(page.locator('#stage-dock .sdv-face-tile').first()).toBeAttached({ timeout: 45_000 });

    // Deferred tiles hold the URL on data-src until they scroll in, so read both.
    const railSources = () => page.locator('#stage-dock .sdv-face-tile img').evaluateAll(
        imgs => imgs.map(img => img.dataset.src || img.getAttribute('src') || '')
    );

    const base = await railSources();
    expect(base.length).toBeGreaterThan(0);
    expect(base.every(src => /\/painting_face_\d+\./.test(src))).toBe(true);

    await page.locator('.sdv-asset[data-asset="확대"]').click();
    // Wait for the rail to be rebuilt for the new asset rather than racing it.
    await expect.poll(async () => (await railSources())[0] ?? '')
        .toMatch(/\/painting_n_face_\d+\./);

    const zoom = await railSources();
    expect(zoom.length).toBeGreaterThan(0);
    expect(zoom.every(src => /\/painting_n_face_\d+\./.test(src))).toBe(true);
});
