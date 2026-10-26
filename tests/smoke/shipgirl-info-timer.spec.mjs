/**
 * 건조 시간표 popup: opens from the header without optional downloads, filters
 * by digit-prefix search / pool / 등급, keeps chart bars fixed and disabled when
 * empty, jumps on bar click, opens a candidate's detail, and fits a phone.
 * Expectations are re-derived from the committed lite data.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';
import { seedFuse } from './helpers.mjs';

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

const SHIPGIRL_INFO_PATH = PAGE_CATALOG.find(
    ({ key }) => key === 'SHIPGIRL_INFO'
)?.path;

if (!SHIPGIRL_INFO_PATH) {
    throw new Error('shipgirl-info-timer: SHIPGIRL_INFO is missing from PAGE_CATALOG');
}

const OPTIONAL_DATA_PATHS = [
    '/data/ship_info_data.json',
    '/data/sim/skill_data_template.json',
    '/data/skill_icon_mapping.json',
    '/data/skill_to_icon_id.json',
];
const POOL_KEYS = ['light', 'heavy', 'special', 'limited'];
const RARITIES = ['N', 'R', 'SR', 'SSR', 'UR'];

const liteShips = JSON.parse(readFileSync(
    new URL('../../public/data/ship_info_lite.json', import.meta.url),
    'utf8'
));
const included = liteShips.filter((s) => s.timer != null && POOL_KEYS.some((k) => s[k] === true));
const timers = new Set(included.map((s) => s.timer));
const bucketOf = (timer) => {
    const [h, m] = timer.split(':').map(Number);
    return Math.floor((h * 60 + m) / 30);
};

function collectOptionalRequests(page) {
    const requested = [];
    page.on('request', (request) => {
        const { pathname } = new URL(request.url());
        const path = OPTIONAL_DATA_PATHS.find((p) => pathname.endsWith(p));
        if (path) requested.push(path);
    });
    return requested;
}

async function openTimer(page) {
    await page.goto(SHIPGIRL_INFO_PATH, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#shipgirls .shipgirl-card').first()).toBeVisible();
    await expect(page.locator('#loading')).toBeHidden();
    await page.locator('#buildTimerBtn').click();
    await expect(page.locator('#buildTimerModal')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
    await seedFuse(page);
});

test('opens with one row per included timer and no optional downloads', async ({ page }) => {
    const requested = collectOptionalRequests(page);
    await openTimer(page);

    expect(timers.size).toBeGreaterThan(100);
    await expect(page.locator('#btRows .bt-row')).toHaveCount(timers.size);
    expect(requested, 'the timer popup must not fetch optional data').toEqual([]);
});

test('digit search narrows to one timer and composes with the pool selector', async ({ page }) => {
    await openTimer(page);
    const rows = page.locator('#btRows .bt-row');
    await expect(rows).toHaveCount(timers.size);

    await page.locator('#btSearch').fill('0410');
    await expect(rows).not.toHaveCount(timers.size);
    await expect(rows).toHaveCount(1);
    await expect(rows.locator('.bt-time')).toHaveText('04:10:00');
    const at0410 = included.filter((s) => s.timer === '04:10:00');
    await expect(rows.locator('.bt-cards .shipgirl-card')).toHaveCount(at0410.length);

    await page.locator('.bt-pools [data-pool="heavy"]').click();
    await expect(rows.locator('.bt-cards .shipgirl-card'))
        .toHaveCount(at0410.filter((s) => s.heavy === true).length);
    await expect(page.locator('#btSummary')).toContainText('04:10:00');
});

test('filters that match nothing show the empty state; empty bars are disabled', async ({ page }) => {
    await openTimer(page);
    const rows = page.locator('#btRows .bt-row');
    const match = (pool, rarity) => included.filter((s) => s[pool] === true && s.rarity === rarity);

    // special + UR: the computed count (non-zero in today's data).
    await page.locator('.bt-pools [data-pool="special"]').click();
    await page.locator('#btRarity').selectOption('UR');
    await expect(page.locator('#btRows .bt-cards .shipgirl-card')).toHaveCount(match('special', 'UR').length);

    // A pool + 등급 combination with no ships at all exercises the empty state.
    const empty = POOL_KEYS.flatMap((pool) => RARITIES.map((rarity) => ({ pool, rarity })))
        .find(({ pool, rarity }) => match(pool, rarity).length === 0);
    expect(empty, 'lite data has no empty pool + 등급 combination').toBeTruthy();
    await page.locator(`.bt-pools [data-pool="${empty.pool}"]`).click();
    await page.locator('#btRarity').selectOption(empty.rarity);
    await expect(rows).toHaveCount(0);
    await expect(page.locator('#btRows')).toContainText('조건에 맞는 함순이가 없습니다.');
    await expect(page.locator('#btSummary')).toHaveText(/^0명 · 0개 건조 시간$/);

    // Back to a non-empty view: every bar is disabled exactly when its bucket is empty.
    await page.locator('.bt-pools [data-pool="special"]').click();
    await page.locator('#btRarity').selectOption('UR');
    const counts = new Map();
    for (const s of match('special', 'UR')) counts.set(bucketOf(s.timer), (counts.get(bucketOf(s.timer)) ?? 0) + 1);
    const bars = await page.locator('#btChart .bt-bar').evaluateAll((els) =>
        els.map((el) => ({ bucket: Number(el.dataset.bucket), disabled: el.disabled })));
    expect(bars.length).toBe(Math.max(...included.map((s) => bucketOf(s.timer))) + 1);
    for (const bar of bars) {
        expect(bar.disabled, `bucket ${bar.bucket}`).toBe(!counts.get(bar.bucket));
    }
});

test('clicking a bar shows only that half-hour in place; clicking it again shows all', async ({ page }) => {
    await openTimer(page);
    const rows = page.locator('#btRows .bt-row');
    await page.locator('#btSearch').fill('0410');
    await expect(rows).toHaveCount(1);

    const bucket = Number(await page.locator('#btChart .bt-bar:not([disabled]):not([data-bucket="8"])')
        .first().getAttribute('data-bucket'));
    const bar = page.locator(`#btChart .bt-bar[data-bucket="${bucket}"]`);
    const inBucket = new Set(included.filter((s) => bucketOf(s.timer) === bucket).map((s) => s.timer));
    await bar.click();
    await expect(page.locator('#btSearch')).toHaveValue('');
    await expect(bar).toHaveAttribute('aria-pressed', 'true');
    await expect(rows).toHaveCount(inBucket.size);
    expect(await rows.evaluateAll((els) => els.map((el) => Number(el.dataset.bucket))))
        .toEqual([...inBucket].map(() => bucket));
    expect(await page.locator('#buildTimerModal .c-modal-dialog').evaluate((el) => el.scrollTop)).toBe(0);

    await bar.click();
    await expect(bar).toHaveAttribute('aria-pressed', 'false');
    await expect(rows).toHaveCount(timers.size);

    // Typing a time drops the bar filter, so the two never combine into an empty list.
    await bar.click();
    await page.locator('#btSearch').fill('0410');
    await expect(bar).toHaveAttribute('aria-pressed', 'false');
    await expect(rows).toHaveCount(1);
});

test('clicking a card closes the popup and opens the detail view by gid', async ({ page }) => {
    await openTimer(page);
    await page.locator('#btRows .bt-cards .shipgirl-card').first().click();

    await expect(page.locator('#buildTimerModal')).toBeHidden();
    await expect(page.locator('#detailView')).toBeVisible();
    expect(page.url()).toContain('gid=');
});

test('phone: three cards per line and no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTimer(page);

    const layout = await page.evaluate(() => {
        const row = [...document.querySelectorAll('#btRows .bt-row')]
            .find((r) => r.querySelectorAll('.bt-cards .shipgirl-card').length >= 4);
        const tops = [...row.querySelectorAll('.bt-cards .shipgirl-card')].slice(0, 4)
            .map((card) => Math.round(card.getBoundingClientRect().top));
        const root = document.documentElement;
        return { tops, overflow: root.scrollWidth > root.clientWidth + 1 };
    });

    expect(layout.overflow).toBe(false);
    expect(new Set(layout.tops.slice(0, 3)).size).toBe(1);
    expect(layout.tops[3]).toBeGreaterThan(layout.tops[0]);
});

test('back from a candidate reopens the popup; a manual close stops that', async ({ page }) => {
    await openTimer(page);
    await page.locator('#btSearch').fill('0410');
    await expect(page.locator('#btRows .bt-row')).toHaveCount(1);

    await page.locator('#btRows .bt-cards .shipgirl-card').first().click();
    await expect(page.locator('#detailView')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#buildTimerModal')).toBeVisible();
    await expect(page.locator('#btSearch')).toHaveValue('0410');
    await expect(page.locator('#btRows .bt-row')).toHaveCount(1);

    await page.locator('#buildTimerModal .modal-close').click();
    await expect(page.locator('#buildTimerModal')).toBeHidden();
    expect(await page.evaluate(() => history.state?.timerOpen)).toBeFalsy();

    await page.locator('#shipgirls .shipgirl-card').first().click();
    await expect(page.locator('#detailView')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#mainView')).toBeVisible();
    await expect(page.locator('#buildTimerModal')).toBeHidden();
});

test('forward after the back-restore closes the popup over the detail view', async ({ page }) => {
    await openTimer(page);
    await page.locator('#btRows .bt-cards .shipgirl-card').first().click();
    await expect(page.locator('#detailView')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#buildTimerModal')).toBeVisible();

    await page.goForward();
    await expect(page.locator('#detailView')).toBeVisible();
    await expect(page.locator('#buildTimerModal')).toBeHidden();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');

    await page.goBack(); // the flag survives a programmatic close
    await expect(page.locator('#buildTimerModal')).toBeVisible();
});
