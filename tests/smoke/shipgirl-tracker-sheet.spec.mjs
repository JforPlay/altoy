/**
 * shipgirl-tracker-sheet.spec.mjs
 * Focused coverage for the tracker's Google Sheet import (phase 2).
 *
 * The pasted fixture is a verbatim copy of the user's real sheet — tab
 * separated, header cells carrying cosmetic newlines, display + computed
 * columns present — so this exercises the actual paste path, not a tidy one.
 */

import { test, expect } from '@playwright/test';

const URL = 'shipgirl/shipgirl-tracker/';

// Header exactly as the sheet copies it, including the newlines inside cells.
const HEADER = [
    'ID', '사진', '이름', '레어도', '함종', '진영',
    '"개장\n가능?"', '"개장\n여부"', '즐겨찾기', '"획득/육성\n여부"',
    '"스작\n여부"', '"호감작\n여부"',
    '"자유 코멘트 (입수처 등)\n(메모 필요하면 자유롭게 쓰셈)"',
    '"획득\n기술점수"', '"적용\n함종"', '"적용\n함종"',
].join('\t');

const rows = (...lines) => [HEADER, ...lines].join('\n');

/** dex 1 = 범용형 부린 (gid 10000); M061 = 엘베·META (gid 970605). */
const SAMPLE = rows(
    '1\t\t범용형 부린\tSR\t경항모\t사쿠라\tO\tO\tO\t125\t스작 완료\t200 완료\t메인 함순이\t0\t\t',
    'M061\t\t엘베(META)\tSSR\t경항모\tMETA\tX\t\tX\t미획득\t스작 안함\t호감작 안함\t\t0\t\t',
    'Z001\t\t넵튠(콜라보)\tSR\t경순\t초차원 넵튠\tX\t\tX\t획득\t스작 예정\t100 예정\t콜라보\t0\t\t',
);

async function openImport(page) {
    await page.goto(URL);
    await page.waitForSelector('.ship-card', { timeout: 20000 });
    await page.click('#sheet-import-btn');
    await expect(page.locator('#sheet-modal')).toBeVisible();
}

test('import modal opens from the toolbar', async ({ page }) => {
    await openImport(page);
    await expect(page.locator('#sheet-apply-btn')).toBeDisabled();
});

test('pasting the real sheet format previews a usable match count', async ({ page }) => {
    await openImport(page);
    await page.fill('#sheet-paste', SAMPLE);

    await expect(page.locator('.sheet-summary')).toContainText('3척 인식');
    // A Sheets copy must be detected as TSV, not CSV.
    await expect(page.locator('#sheet-status')).toContainText('TSV');
    await expect(page.locator('#sheet-apply-btn')).toBeEnabled();
    await expect(page.locator('#sheet-apply-btn')).toContainText('3척 적용');
});

test('the (META) vs ·META difference is not reported as a mismatch', async ({ page }) => {
    await openImport(page);
    await page.fill('#sheet-paste', SAMPLE);
    await expect(page.locator('.sheet-summary')).toContainText('3척 인식');
    await expect(page.locator('#sheet-preview')).not.toContainText('이름이 다른 행');
});

test('applying writes through to the cards and the summary', async ({ page }) => {
    await openImport(page);
    await page.fill('#sheet-paste', SAMPLE);
    await page.click('#sheet-apply-btn');

    await expect(page.locator('#sheet-modal')).toBeHidden();

    const card = page.locator('.ship-card[data-ship-id="10000"]');
    // 125 → all three progress bits set and the cap bar at its top stop.
    await expect(card.locator('input[data-type="get"]')).toBeChecked();
    await expect(card.locator('input[data-type="upgrade"]')).toBeChecked();
    await expect(card.locator('input[data-type="level"]')).toBeChecked();
    await expect(card.locator('.lr-cap button[data-break="5"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(card.locator('.lr-chip[data-action="skl"]')).toContainText('스작 완료');
    await expect(card.locator('.lr-star')).toHaveAttribute('aria-pressed', 'true');

    // The 성정 유닛 counters recompute from the imported caps.
    await expect(page.locator('#unit1-120-invested')).not.toHaveText('0');
});

test('imported state survives a reload', async ({ page }) => {
    await openImport(page);
    await page.fill('#sheet-paste', SAMPLE);
    await page.click('#sheet-apply-btn');
    await expect(page.locator('#sheet-modal')).toBeHidden();

    await page.reload();
    await page.waitForSelector('.ship-card');
    const card = page.locator('.ship-card[data-ship-id="10000"]');
    await expect(card.locator('input[data-type="get"]')).toBeChecked();
    await expect(card.locator('.lr-chip[data-action="aff"]')).toContainText('200 완료');
});

test('a bad ID is rejected by line without blocking the good rows', async ({ page }) => {
    await openImport(page);
    await page.fill('#sheet-paste', rows(
        '1\t\t범용형 부린\tSR\t경항모\t사쿠라\tO\tO\tO\t120\t스작 안함\t호감작 안함\t\t0\t\t',
        'Q001\t\t깨진 아이디\tSR\t경순\t로열\tX\t\tX\t획득\t스작 안함\t호감작 안함\t\t0\t\t',
        '99999\t\t유령함\tSR\t경순\t로열\tX\t\tX\t획득\t스작 안함\t호감작 안함\t\t0\t\t',
    ));
    await expect(page.locator('.sheet-summary')).toContainText('1척 인식');
    await expect(page.locator('.sheet-summary')).toContainText('2행 건너뜀');
    await expect(page.locator('#sheet-preview')).toContainText('건너뛴 행 2개');
    await expect(page.locator('#sheet-apply-btn')).toBeEnabled();
});

test('a sheet without an ID column fails loudly instead of importing nothing', async ({ page }) => {
    await openImport(page);
    await page.fill('#sheet-paste', '이름\t획득/육성 여부\n범용형 부린\t획득');
    await expect(page.locator('#sheet-status')).toHaveClass(/is-error/);
    await expect(page.locator('#sheet-status')).toContainText('ID');
    await expect(page.locator('#sheet-apply-btn')).toBeDisabled();
});

test('pasted text is never treated as markup', async ({ page }) => {
    await openImport(page);
    await page.fill('#sheet-paste', rows(
        '1\t\t<img src=x onerror=alert(1)>\tSR\t경항모\t사쿠라\tX\t\tX\t획득\t스작 안함\t호감작 안함\t\t0\t\t',
    ));
    await expect(page.locator('#sheet-preview')).toContainText('이름이 다른 행');
    // The name renders as literal text; no element is created from it.
    expect(await page.locator('#sheet-preview img').count()).toBe(0);
});
