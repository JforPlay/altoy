/**
 * 요약 wall guard for /shipgirl/shipgirl-tracker/:
 * the three-view cycle, the step gesture writing through to the other views,
 * the 지표 toggle re-reading the same tiles, and descending sort by CSS order.
 *
 * The load-bearing claim under test is that the wall is a third PRESENTATION of
 * the same card DOM — so anything stepped here must be visible in 목록 and the
 * sort must leave the DOM untouched.
 */
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

const TRACKER_PATH = PAGE_CATALOG.find(({ key }) => key === 'SHIPGIRL_TRACKER')?.path;
if (!TRACKER_PATH) throw new Error('shipgirl-tracker-wall: SHIPGIRL_TRACKER missing from PAGE_CATALOG');

async function bootWall(page) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(TRACKER_PATH);
    await expect(page.locator('#ship-list-container .ship-card').first()).toBeVisible();
    // Default view is 카드; one click reaches 요약.
    await page.locator('#view-toggle-btn').click();
    await expect(page.locator('#ship-list-container')).toHaveAttribute('data-view', 'wall');
}

/** The card for a gid, addressed the way every other view addresses it. */
const cardFor = (page, gid) => page.locator(`.ship-card[data-ship-id="${gid}"]`);

async function firstGid(page) {
    return page.locator('#ship-list-container .ship-card').first().getAttribute('data-ship-id');
}

test('view toggle cycles 카드 → 요약 → 목록 → 카드', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(TRACKER_PATH);
    const container = page.locator('#ship-list-container');
    await expect(container.locator('.ship-card').first()).toBeVisible();
    await expect(container).toHaveAttribute('data-view', 'cards');
    for (const expected of ['wall', 'ledger', 'cards']) {
        await page.locator('#view-toggle-btn').click();
        await expect(container).toHaveAttribute('data-view', expected);
    }
});

test('지표 row is present only in the wall', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(TRACKER_PATH);
    await expect(page.locator('#ship-list-container .ship-card').first()).toBeVisible();
    const row = page.locator('#wall-metric-row');
    await expect(row).toBeHidden();
    await page.locator('#view-toggle-btn').click();
    await expect(row).toBeVisible();
    await page.locator('#view-toggle-btn').click();
    await expect(row).toBeHidden();
});

test('clicking a tile walks the 육성 레벨 ladder and the 목록 view agrees', async ({ page }) => {
    await bootWall(page);
    const gid = await firstGid(page);
    const card = cardFor(page, gid);
    const tile = card.locator('.lr-tile');

    // Up to Lv120 from a known floor: step down to 0 first so the test doesn't
    // depend on whatever localStorage held.
    for (let i = 0; i < 5; i++) await tile.click({ modifiers: ['Shift'] });
    await expect(card).toHaveAttribute('data-wall', '0');
    await expect(card).toHaveAttribute('data-wall-owned', '0');

    await tile.click();
    await expect(card).toHaveAttribute('data-wall', '1');
    await expect(card).toHaveAttribute('data-wall-owned', '1');

    // Rung 1 is 보유 alone — 풀돌 is off this ladder, so the step must not have
    // set it. Checked here rather than at the top rung, where the forward rule
    // legitimately turns all three on and the assertion would not discriminate.
    await page.locator('#view-toggle-btn').click();
    await expect(page.locator('#ship-list-container')).toHaveAttribute('data-view', 'ledger');
    await expect(card.locator('[data-type="get"]')).toBeChecked();
    await expect(card.locator('[data-type="upgrade"]')).not.toBeChecked();
    await expect(card.locator('[data-type="level"]')).not.toBeChecked();

    // Back to 요약 and up one more: rung 2 IS Lv120, and entering it from below
    // applies the same forward rule the Lv120 checkbox does.
    await page.locator('#view-toggle-btn').click();
    await page.locator('#view-toggle-btn').click();
    await expect(page.locator('#ship-list-container')).toHaveAttribute('data-view', 'wall');
    await tile.click();
    await expect(card).toHaveAttribute('data-wall', '2');

    // The wall wrote through to the shared card DOM, not to a private store.
    await page.locator('#view-toggle-btn').click();
    await expect(card.locator('[data-type="get"]')).toBeChecked();
    await expect(card.locator('[data-type="upgrade"]')).toBeChecked();
    await expect(card.locator('[data-type="level"]')).toBeChecked();
});

test('unchecking 풀돌 leaves Lv120 and the 성정 유닛 cap standing', async ({ page }) => {
    // The headline of the decoupling: META / UR / research PR/DR ships reach
    // Lv120 without 한계돌파. The pure rules are node-tested; this covers the
    // DOM path they run through (handleCheckboxLogic -> coupleCardAfterChange
    // -> renderInvestmentCells), which those tests cannot see.
    await bootWall(page);
    const gid = await firstGid(page);
    const card = cardFor(page, gid);
    await page.locator('#view-toggle-btn').click();   // → 목록
    await expect(page.locator('#ship-list-container')).toHaveAttribute('data-view', 'ledger');

    const cap120 = card.locator('[data-action="cap"][data-break="4"]');
    const upgrade = card.locator('[data-type="upgrade"]');
    await card.locator('[data-type="level"]').check();
    await expect(upgrade).toBeChecked();                       // forward rule
    await expect(cap120).toHaveAttribute('aria-pressed', 'true');

    await upgrade.uncheck();
    await expect(upgrade).not.toBeChecked();
    await expect(card.locator('[data-type="level"]')).toBeChecked();
    await expect(cap120).toHaveAttribute('aria-pressed', 'true');

    // Survives a reload, i.e. it was persisted rather than only left in the DOM.
    await page.reload();
    await expect(page.locator('#ship-list-container .ship-card').first()).toBeVisible();
    const reloaded = cardFor(page, gid);
    await expect(reloaded.locator('[data-type="upgrade"]')).not.toBeChecked();
    await expect(reloaded.locator('[data-type="level"]')).toBeChecked();
});

test('top of the ladder clamps and lights the 완료 colour', async ({ page }) => {
    await bootWall(page);
    const gid = await firstGid(page);
    const card = cardFor(page, gid);
    const tile = card.locator('.lr-tile');
    for (let i = 0; i < 6; i++) await tile.click();
    await expect(card).toHaveAttribute('data-wall', '3');
    await expect(card).toHaveAttribute('data-wall-top', '1');
    // Lv125 is cap 5, which the 육성 레벨 bar shows as both stops lit.
    await page.locator('#view-toggle-btn').click();
    await expect(card.locator('[data-action="cap"][data-break="5"]')).toHaveAttribute('aria-pressed', 'true');
});

test('지표 toggle re-reads every tile against a different ladder', async ({ page }) => {
    await bootWall(page);
    const gid = await firstGid(page);
    const card = cardFor(page, gid);
    const tile = card.locator('.lr-tile');
    for (let i = 0; i < 6; i++) await tile.click();
    await expect(card).toHaveAttribute('data-wall', '3');   // 육성 레벨 maxed

    // The accent is stamped on the grid AND the 지표 bar (siblings), so the tile
    // bars and the filled toggle segment resolve the same hue.
    const accentOf = sel => page.evaluate(s =>
        getComputedStyle(document.querySelector(s)).getPropertyValue('--wall-accent').trim(), sel);
    const lvAccent = await accentOf('#ship-list-container');
    expect(lvAccent).not.toBe('');
    expect(await accentOf('#wall-metric-row')).toBe(lvAccent);

    await page.locator('#wall-metric-group button[data-metric="skl"]').click();
    expect(await accentOf('#ship-list-container')).not.toBe(lvAccent);
    expect(await accentOf('#wall-metric-row')).not.toBe(lvAccent);
    // 스작 is a different field — the same ship reads 0 there.
    await expect(card).toHaveAttribute('data-wall', '0');
    await expect(card).toHaveAttribute('data-wall-top', '0');
    // ...but ownership is metric-independent, so it is NOT greyed.
    await expect(card).toHaveAttribute('data-wall-owned', '1');

    // Stepping now writes 스작 — a different field, read and written through
    // the same tile.
    for (let i = 0; i < 5; i++) await tile.click();
    await expect(card).toHaveAttribute('data-wall', '3');
    await expect(card).toHaveAttribute('data-wall-top', '1');

    // The 기타 육성 chip is the other face of the same field.
    await page.locator('#view-toggle-btn').click();
    await expect(card.locator('[data-action="skl"]')).toContainText('스작 완료');
});

test('sort is descending, order-only, and holds still between presses', async ({ page }) => {
    await bootWall(page);
    const domOrderBefore = await page.evaluate(() =>
        [...document.querySelectorAll('#ship-list-container .ship-card')].slice(0, 12)
            .map(c => c.dataset.shipId));

    const ranks = await page.evaluate(() =>
        [...document.querySelectorAll('#ship-list-container .ship-card')]
            .map(c => ({
                order: Number(c.style.order),
                wall: Number(c.dataset.wall),
                owned: c.dataset.wallOwned === '1',
            })));
    expect(ranks.length).toBeGreaterThan(50);
    // order = (max - value) * 2 + (미획득 ? 1 : 0), max 3 for 육성 레벨: a higher 지표 value never
    // sorts later, and an unowned ship never outranks an owned one that ties it.
    for (const { order, wall, owned } of ranks) {
        expect(order).toBe((3 - wall) * 2 + (owned ? 0 : 1));
    }

    // Stepping does NOT re-sort — the tile must stay put mid-sweep.
    const gid = await firstGid(page);
    const card = cardFor(page, gid);
    const orderBefore = await card.evaluate(el => el.style.order);
    await card.locator('.lr-tile').click();
    expect(await card.evaluate(el => el.style.order)).toBe(orderBefore);

    // 재정렬 does.
    await page.locator('#wall-sort-btn').click();
    expect(await card.evaluate(el => el.style.order)).not.toBe(orderBefore);

    // Sorting never moved a node.
    const domOrderAfter = await page.evaluate(() =>
        [...document.querySelectorAll('#ship-list-container .ship-card')].slice(0, 12)
            .map(c => c.dataset.shipId));
    expect(domOrderAfter).toEqual(domOrderBefore);
});

test('재정렬 still separates owned from 미획득 under a 지표 with no data', async ({ page }) => {
    // The reported symptom: 재정렬 looked level-only. Under 스작/호감작 an
    // unrecorded ship and an unowned one both read 0, so they tied and
    // interleaved — nothing appeared to move.
    await bootWall(page);
    const gids = await page.evaluate(() =>
        [...document.querySelectorAll('#ship-list-container .ship-card')]
            .slice(0, 3).map(c => c.dataset.shipId));
    const [ownedGid, , untouchedGid] = gids;

    await cardFor(page, ownedGid).locator('.lr-tile').click();      // 보유
    await expect(cardFor(page, ownedGid)).toHaveAttribute('data-wall-owned', '1');

    await page.locator('#wall-metric-group button[data-metric="skl"]').click();
    // Both read 0 on this ladder — only ownership separates them.
    await expect(cardFor(page, ownedGid)).toHaveAttribute('data-wall', '0');
    await expect(cardFor(page, untouchedGid)).toHaveAttribute('data-wall', '0');
    await page.locator('#wall-sort-btn').click();

    const orderOf = gid => cardFor(page, gid).evaluate(el => Number(el.style.order));
    expect(await orderOf(ownedGid)).toBeLessThan(await orderOf(untouchedGid));
});

test('leaving the wall clears the order so the other views are untouched', async ({ page }) => {
    await bootWall(page);
    const card = cardFor(page, await firstGid(page));
    expect(await card.evaluate(el => el.style.order)).not.toBe('');
    await page.locator('#view-toggle-btn').click();   // → 목록
    expect(await card.evaluate(el => el.style.order)).toBe('');
});

test('the tile is a real button reachable by keyboard', async ({ page }) => {
    await bootWall(page);
    const card = cardFor(page, await firstGid(page));
    const tile = card.locator('.lr-tile');
    await expect(tile).toHaveAttribute('aria-label', /육성 레벨/);
    await tile.focus();
    const before = await card.getAttribute('data-wall');
    await page.keyboard.press('Enter');
    await expect(card).not.toHaveAttribute('data-wall', before);
});

test('booting straight into a stored 요약 pref arrives sorted', async ({ page }) => {
    // applyView runs before any card exists, so its sort is a no-op — the order
    // has to be applied again after the first render or a returning visitor
    // lands on an unsorted wall.
    await bootWall(page);
    const gid = await firstGid(page);
    const tile = cardFor(page, gid).locator('.lr-tile');
    for (let i = 0; i < 5; i++) await tile.click();     // push one ship to the top

    await page.reload();
    await expect(page.locator('#ship-list-container')).toHaveAttribute('data-view', 'wall');
    await expect(page.locator('#ship-list-container .ship-card').first()).toBeVisible();
    const ranks = await page.evaluate(() =>
        [...document.querySelectorAll('#ship-list-container .ship-card')]
            .map(c => ({
                order: c.style.order,
                wall: Number(c.dataset.wall),
                owned: c.dataset.wallOwned === '1',
            })));
    expect(ranks.every(r => r.order !== '')).toBe(true);
    for (const { order, wall, owned } of ranks) {
        expect(Number(order)).toBe((3 - wall) * 2 + (owned ? 0 : 1));
    }
});
