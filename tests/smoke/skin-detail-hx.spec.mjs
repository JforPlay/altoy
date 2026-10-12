/**
 * 검열판 toggle on the skin detail stage.
 *
 * The 검열판 manifest lives in JforPlay/data_for_toy_misc beside its PNGs, so the
 * test serves a fixture manifest instead of depending on what that repo holds today,
 * and aborts every other raw.githubusercontent request (no 24 MB paintings).
 *
 * The URLs are what is asserted, not visibility: a `{}` entry means "the painting
 * moves to data_for_toy_misc, the faces STAY in data_for_toy" (the pipeline emits
 * `{}` only when the punched hole is pixel-identical). Either half going wrong still
 * loads an image — the other repo's copy, or a 404 the composite swallows — so only
 * the URL tells "loaded" from "loaded the right one".
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';
import { seedFuse } from './helpers.mjs';

test.setTimeout(90_000);

const SKIN_DETAIL_PATH = PAGE_CATALOG.find(({ key }) => key === 'SKIN_DETAIL')?.path;
if (!SKIN_DETAIL_PATH) {
    throw new Error('skin-detail-hx: SKIN_DETAIL is missing from PAGE_CATALOG');
}
const HX_MANIFEST = 'https://raw.githubusercontent.com/JforPlay/data_for_toy_misc/main/hx/manifest.json';

const manifest = JSON.parse(readFileSync(
    new URL('../../public/data/skin/expression_manifest.json', import.meta.url), 'utf8'
));
const skinIndex = JSON.parse(readFileSync(
    new URL('../../public/data/skin/skin_voiceline_index.json', import.meta.url), 'utf8'
));

// A character with two composited skins: the first under BOTH `<id>` and `<id>_n`
// (it gets the fixture 검열판), the second absent from the fixture (no toggle).
let fixture = null;
for (const [character, entry] of Object.entries(skinIndex.characters || {})) {
    const skins = entry?.skins || [];
    const withHx = skins.find(s => manifest[String(s.clientId)]?.faces?.length
        && manifest[`${s.clientId}_n`]?.faces?.length);
    const other = skins.find(s => s !== withHx && manifest[String(s.clientId)]?.faces?.length);
    if (withHx && other) {
        fixture = { character, skin: withHx.name, id: String(withHx.clientId), other: other.name };
        break;
    }
}
if (!fixture) {
    throw new Error('skin-detail-hx: no character with a two-painting skin and a second skin');
}

test.beforeEach(async ({ page }) => {
    // Routes match last-registered first: the manifest fixture wins over the abort.
    await page.route('https://raw.githubusercontent.com/**', route => route.abort('blockedbyclient'));
    await page.route(HX_MANIFEST, route => route.fulfill({
        json: { [fixture.id]: {}, [`${fixture.id}_n`]: {} }
    }));
    await seedFuse(page);
});

const skinUrl = name => `${SKIN_DETAIL_PATH}?character=${encodeURIComponent(fixture.character)}`
    + `&skin=${encodeURIComponent(name)}`;

const railSrc = (page, key) => page.locator(`.sdv-asset[data-asset="${key}"] img`)
    .evaluate(img => img.getAttribute('src') || img.dataset.src || '');

const faceSources = page => page.locator('#stage-dock .sdv-face-tile img').evaluateAll(
    imgs => imgs.map(img => img.dataset.src || img.getAttribute('src') || '')
);

test('검열판 swaps the painting to data_for_toy_misc and keeps the shared faces', async ({ page }) => {
    await page.goto(skinUrl(fixture.skin));
    await expect(page.locator('#stage-dock .sdv-face-tile').first()).toBeAttached({ timeout: 45_000 });

    const toggle = page.locator('.sdv-art-hx');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(await railSrc(page, '전체')).toContain(`/data_for_toy/main/output_expressions/${fixture.id}/painting.png`);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => railSrc(page, '전체'))
        .toContain(`/data_for_toy_misc/main/hx/${fixture.id}/painting.png`);
    expect(await railSrc(page, '확대')).toContain(`/data_for_toy_misc/main/hx/${fixture.id}/painting_n.png`);

    // The caption is computed from the ACTIVE asset selectAsset just put on stage, so
    // it proves the stage moved too, not only the rail. (The composite itself can't
    // be read here: the aborted painting swaps it for a placeholder box.)
    await expect(page.locator('#stage-art-label')).toContainText('검열판');

    // `{}` = shared faces: every tile still comes from data_for_toy.
    const faces = await faceSources(page);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.every(src => src.includes(`/data_for_toy/main/output_expressions/${fixture.id}/`))).toBe(true);

    await toggle.click();
    await expect.poll(() => railSrc(page, '전체'))
        .toContain(`/data_for_toy/main/output_expressions/${fixture.id}/painting.png`);
});

test('a skin without a 검열판 shows no toggle', async ({ page }) => {
    await page.goto(skinUrl(fixture.other));
    await expect(page.locator('#skin-stage')).toBeVisible({ timeout: 45_000 });
    // The stage has rendered once the caption label has text; only then is the
    // toggle's hidden state a decision rather than its initial markup.
    await expect(page.locator('#stage-art-label')).not.toBeEmpty({ timeout: 45_000 });
    await expect(page.locator('.sdv-art-hx')).toBeHidden();
});
