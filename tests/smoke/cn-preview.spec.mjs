/**
 * CN preview skin view: the detail panel must go through the skin detail
 * viewer's gallery — an expression strip and a composited canvas — never the
 * bare hole-punched painting.png. Both disappear silently when the expression
 * manifest lacks the CN ids (a selective §13 run leaves it stale) or when the
 * adapter stops handing the gallery the '클뜯 id' key, so this asserts them.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';

test.setTimeout(60_000);

const PAGE_PATH = PAGE_CATALOG.find(({ key }) => key === 'CN_PREVIEW')?.path;
if (!PAGE_PATH) throw new Error('cn-preview: CN_PREVIEW is missing from PAGE_CATALOG');

const doc = JSON.parse(readFileSync(new URL('../../public/data/preview/cn_preview.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../../public/data/skin/expression_manifest.json', import.meta.url), 'utf8'));
const withFaces = doc.skins.find((skin) => skin.images.painting && manifest[String(skin.id)]?.faces?.length > 1);

test('skin view renders the expression strip, composite canvas and voice table', async ({ page }) => {
    test.skip(!withFaces, 'no CN skin with a multi-face manifest entry in the committed data');

    await page.goto(PAGE_PATH);
    const toggle = page.locator('#cn-preview-view-toggle [data-view="skins"]');
    await expect(toggle).toBeVisible();
    await toggle.click();

    const tile = page.locator(`.cn-skin-tile[data-skin-id="${withFaces.id}"]`);
    await tile.click();
    await expect(tile).toHaveClass(/is-active/);
    await expect(page.locator('#cn-preview-skin-title')).toContainText(withFaces.name);

    // The gallery, not a bare <img>: strip + canvas come from skin.expression.js.
    const thumbs = page.locator('#image-gallery .expression-thumb');
    await expect(thumbs).toHaveCount(manifest[String(withFaces.id)].faces.length);
    await expect(page.locator('#image-gallery canvas.base-image').first()).toBeVisible();
    await expect(page.locator('#image-gallery img.gallery-top-banner')).toHaveCount(0);

    // Picking a face moves the active thumb (the composite itself is covered by the viewer's own tests).
    await thumbs.nth(1).click();
    await expect(thumbs.nth(1)).toHaveClass(/active/);

    if (withFaces.voices.length) {
        await expect(page.locator('#cn-preview-skin-voices .voice-line-table tbody tr')).toHaveCount(withFaces.voices.length);
    }
});
