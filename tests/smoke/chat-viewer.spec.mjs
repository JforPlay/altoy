/**
 * chat-viewer.spec.mjs
 * JUUS 보기 / 3D숙소 JUUS messenger layout: opening a chat, both modes on the
 * game's branch rule, mode memory, phone panes, and (Task 3) search.
 *
 * Fixture: 건스웨이 「작은 여행 계획」 (first story of the 건스웨이 chat).
 *   first choice 「좋아! 가자!」 / 「좀 더 고민해볼게.」; the first-option path ends at
 *   「그럼, 약속한 거다? 바로 그쪽으로 갈게.」 and must NOT run on into
 *   「알았어. 다 끝나면 연락해~」 (the unpicked flag-5 branch today's engine plays).
 * Every test gets a fresh browser context, so localStorage (the remembered mode)
 * starts empty → 재생.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { isGroupChat } from '../../public/js/chat-viewer/chat-viewer.script.js';

const JUUS = 'chat-viewer/juus/';
const DORM = 'chat-viewer/dorm3d/';
const LINE_WAIT = { timeout: 10_000 }; // 재생 shows one line per 1.3 s

// Chip counts follow the committed data, so a data refresh that adds a chat does not break the spec.
const juusChats = Object.values(JSON.parse(readFileSync(new URL('../../public/data/chat-viewer/juus_chat_data.json', import.meta.url), 'utf8')));
const GROUP_CHATS = juusChats.filter((stories) => isGroupChat(Object.values(stories)[0])).length;

async function openGanj(page) {
    await page.goto(JUUS);
    await expect(page.locator('#chat-list .chat-row').first()).toBeVisible();
    await page.locator('.chat-row[data-chat="건스웨이"]').click();
}

test('the list renders and a chat opens with its @아이디 and stories', async ({ page }) => {
    await page.goto(JUUS);
    await expect(page.locator('#chat-list .chat-row').first()).toBeVisible();
    await expect(page.locator('#chat-empty')).toBeVisible();
    await expect(page.locator('.chat-row[data-chat="건스웨이"] .chat-handle')).toHaveText('@Ganj-i-sawai');
    // The row previews how the chat starts: first message of the first story.
    await expect(page.locator('.chat-row[data-chat="건스웨이"] .chat-row-preview')).toHaveText('지휘관~ 가이드북에 흥미로운 유적이 몇 개 실려 있던데.');
    await page.locator('.chat-row[data-chat="건스웨이"]').click();
    await expect(page.locator('#chat-head-name')).toHaveText('건스웨이');
    await expect(page.locator('#chat-head-sub')).toContainText('@Ganj-i-sawai');
    await expect(page.locator('#chat-tabs .chat-tab.is-active')).toHaveText('작은 여행 계획');
    await expect(page.locator('#chat-log .chat-unlock')).toContainText('해금 조건');
});

test('전체 대본 renders the first-option path and a choice tab switches branch', async ({ page }) => {
    await openGanj(page);
    await page.locator('#chat-mode [data-mode="full"]').click();
    const log = page.locator('#chat-log');
    await expect(log.locator('.chat-end')).toBeVisible();
    await expect(log).toContainText('그럼, 약속한 거다? 바로 그쪽으로 갈게.');
    await expect(log).not.toContainText('알았어. 다 끝나면 연락해~');
    await expect(log.locator('.chat-msg--character .chat-speaker').first()).toContainText('@Ganj-i-sawai');

    await log.locator('.chat-choice').first().getByRole('button', { name: '좀 더 고민해볼게.' }).click();
    await expect(log.locator('.chat-choice').first().locator('.chip.active')).toHaveText('좀 더 고민해볼게.');
    await expect(log).toContainText('일이 바빠서 그래? 아니면 걱정되는 거라도 있어?');
    await expect(log).not.toContainText('짐도 바로 싸야겠네');
});

test('재생 stops at a choice and a pick shows its reply line once', async ({ page }) => {
    await openGanj(page);
    const reply = page.locator('#chat-reply');
    await expect(reply.getByRole('button', { name: '좋아! 가자!' })).toBeVisible(LINE_WAIT);
    await reply.getByRole('button', { name: '좋아! 가자!' }).click();
    // The next choice (a single option) proves the lines after the pick have played.
    await expect(reply.locator('.chat-reply-btn')).toHaveCount(1, LINE_WAIT);
    const player = page.locator('#chat-log .chat-msg--player');
    await expect(player).toHaveCount(1);
    await expect(player).toHaveText('좋아! 가자!');
});

test('switching story mid-재생 drops the old story\'s queued lines', async ({ page }) => {
    await openGanj(page);
    const log = page.locator('#chat-log');
    await expect(log).toContainText('가이드북에 흥미로운 유적', LINE_WAIT);
    await page.locator('#chat-tabs .chat-tab').nth(1).click();
    await page.waitForTimeout(2_000); // longer than one 재생 interval
    await expect(log).not.toContainText('잠깐 짧게 여행 다녀오지 않을래?');
    await expect(log).not.toContainText('가이드북에 흥미로운 유적');
});

test('재생 picks carry over into 전체 대본', async ({ page }) => {
    await openGanj(page);
    const reply = page.locator('#chat-reply');
    await expect(reply.getByRole('button', { name: '좀 더 고민해볼게.' })).toBeVisible(LINE_WAIT);
    await reply.getByRole('button', { name: '좀 더 고민해볼게.' }).click();
    await page.locator('#chat-mode [data-mode="full"]').click();
    const log = page.locator('#chat-log');
    await expect(log).toContainText('일이 바빠서 그래? 아니면 걱정되는 거라도 있어?');
    await expect(log).not.toContainText('응! 유적 관람 계획은 내가 다 세웠으니까');
});

test('the chosen mode is remembered across reloads', async ({ page }) => {
    await openGanj(page);
    await page.locator('#chat-mode [data-mode="full"]').click();
    await page.reload();
    await expect(page.locator('#chat-list .chat-row').first()).toBeVisible();
    await page.locator('.chat-row[data-chat="건스웨이"]').click();
    await expect(page.locator('#chat-mode [data-mode="full"]')).toHaveClass(/is-active/);
    await expect(page.locator('#chat-log .chat-end')).toBeVisible();
});

test('3D숙소 JUUS boots on the same layout', async ({ page }) => {
    await page.goto(DORM);
    await expect(page.locator('#chat-list .chat-row').first()).toBeVisible();
    await expect(page.locator('#chat-kind')).toBeHidden(); // no group rooms to filter
    await expect(page.locator('#chat-sort')).toBeVisible();
    await page.locator('#chat-list .chat-row').first().click();
    await expect(page.locator('#chat-head-sub')).toContainText('@');
    await expect(page.locator('#chat-log .chat-msg').first()).toBeVisible(LINE_WAIT);
});

test('phone width shows one pane at a time', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openGanj(page);
    await expect(page.locator('#chat-pane')).toBeVisible();
    await expect(page.locator('#chat-list')).toBeHidden();
    await page.locator('#chat-back').click();
    await expect(page.locator('#chat-list')).toBeVisible();
    await expect(page.locator('#chat-pane')).toBeHidden();
});

// ===== Search (Task 3) =====

test('대사 search lists hits and opening one follows its branch', async ({ page }) => {
    await page.goto(JUUS);
    await expect(page.locator('#chat-list .chat-row').first()).toBeVisible();
    // Shares no characters with any chat name, and sits in the flag-5 branch — off the
    // first-option path — so landing on it proves the walk-back picked 1 → 3 → 5.
    await page.fill('#chat-search', '첫 여행이라 너무 기대');
    await expect(page.locator('#chat-list')).toBeHidden();
    const hits = page.locator('#chat-results [data-open="line"]');
    await expect(hits).toHaveCount(1);
    await hits.first().click();
    const log = page.locator('#chat-log');
    await expect(log.locator('.is-focus')).toContainText('지휘관이랑 가는 첫 여행이라 너무 기대되네♪');
    await expect(log).not.toContainText('그럼, 약속한 거다? 바로 그쪽으로 갈게.');
    await expect(page.locator('#chat-jump')).toContainText('1건 중 1');
    await expect(page.locator('#chat-mode [data-mode="full"]')).toHaveClass(/is-active/);
});

test('함순이 search by @아이디 lists her 1:1 chat and the group rooms she speaks in', async ({ page }) => {
    await page.goto(JUUS);
    await expect(page.locator('#chat-list .chat-row').first()).toBeVisible();
    await page.fill('#chat-search', '@Dolphin');
    const speaker = page.locator('#chat-results .chat-hit-speaker', { hasText: '돌핀' });
    await expect(speaker).toBeVisible();
    await expect(speaker.locator('[data-open="chat"]')).toHaveCount(1);
    await expect(speaker.locator('[data-open="speaker"]')).toHaveCount(2);
    await expect(speaker.locator('[data-open="speaker"] .chat-hit-count').first()).toHaveText(/^채팅 \d+$/);

    await speaker.locator('[data-open="speaker"]', { hasText: '템페스타 채팅방' }).click();
    await expect(page.locator('#chat-head-name')).toHaveText('템페스타 채팅방');
    const jump = page.locator('#chat-jump');
    await expect(page.locator('#chat-head-sub')).toHaveText(/^그룹 채팅방 · 참여자 \d+명 · 스토리 \d+개$/);
    await expect(jump).toContainText('돌핀 채팅 · 이 대화에서 5건 중 1');
    // Her 3rd line sits in the flag-4 branch reached through the flag-2 choice (index 24,
    // not the flag-1 one at 17 that offers the same flags) — stepping there must re-pick.
    await jump.locator('[data-step="1"]').click();
    await jump.locator('[data-step="1"]').click();
    await expect(jump).toContainText('5건 중 3');
    await expect(page.locator('#chat-log .is-focus')).toContainText('나? 이미 집무실에 와 있어~');
    await expect(page.locator('#chat-log .chat-msg.is-hit')).toHaveCount(5);
});

test('Escape clears the search and brings the list back', async ({ page }) => {
    await page.goto(JUUS);
    await expect(page.locator('#chat-list .chat-row').first()).toBeVisible();
    await page.fill('#chat-search', '돌핀');
    await expect(page.locator('#chat-results .chat-hit-speaker').first()).toBeVisible();
    await page.locator('#chat-search').press('Escape');
    await expect(page.locator('#chat-list')).toBeVisible();
    await expect(page.locator('#chat-results')).toBeHidden();
    await expect(page.locator('#chat-filter')).toBeVisible();
});

test('on a phone, a search result opens the chat pane', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(JUUS);
    await expect(page.locator('#chat-list .chat-row').first()).toBeVisible();
    await page.fill('#chat-search', '첫 여행이라 너무 기대');
    await page.locator('#chat-results [data-open="line"]').first().click();
    await expect(page.locator('#chat-pane')).toBeVisible();
    await page.locator('#chat-back').click();
    await expect(page.locator('#chat-results')).toBeVisible();
});

test('the 1:1 / 그룹 chips filter the chat list', async ({ page }) => {
    await page.goto(JUUS);
    const rows = page.locator('#chat-list .chat-row:visible');
    await expect(rows.first()).toBeVisible();
    await expect(rows).toHaveCount(juusChats.length);
    await page.locator('#chat-filter [data-kind="group"]').click();
    await expect(rows).toHaveCount(GROUP_CHATS);
    await expect(page.locator('.chat-row[data-chat="템페스타 채팅방"]')).toBeVisible();
    await page.locator('#chat-filter [data-kind="dm"]').click();
    await expect(rows).toHaveCount(juusChats.length - GROUP_CHATS);
    await expect(page.locator('.chat-row[data-chat="템페스타 채팅방"]')).toBeHidden();
    await page.locator('#chat-filter [data-kind="all"]').click();
    await expect(rows).toHaveCount(juusChats.length);
});

test('the sort menu orders the list by added date or name, and is remembered', async ({ page }) => {
    await page.goto(JUUS);
    const rows = page.locator('#chat-list .chat-row');
    await expect(rows.first()).toBeVisible();
    const order = () => rows.evaluateAll(nodes => nodes.map(n => n.dataset.chat));
    const sort = page.locator('#chat-sort');
    await expect(sort).toHaveValue('new');
    const newest = await order();
    await sort.selectOption('old');
    // Story ids 1-3: the first chat Juus ever shipped stays the oldest whatever is added later.
    await expect(rows.first()).toHaveAttribute('data-chat', '건스웨이');
    expect(await order()).toEqual([...newest].reverse());
    await sort.selectOption('name');
    const byName = await order();
    expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b, 'ko')));
    await sort.selectOption('name-desc');
    expect(await order()).toEqual([...byName].reverse());
    await page.reload();
    await expect(sort).toHaveValue('name-desc');
    await expect(rows.first()).toHaveAttribute('data-chat', byName.at(-1));
});

// ===== Final-review regressions =====

test('clicking the open chat again keeps the story being read', async ({ page }) => {
    await openGanj(page);
    await page.locator('#chat-tabs .chat-tab').nth(1).click();
    await expect(page.locator('#chat-tabs .chat-tab.is-active')).toHaveText('함께 저녁 식사');
    await page.locator('.chat-row[data-chat="건스웨이"]').click();
    await expect(page.locator('#chat-tabs .chat-tab.is-active')).toHaveText('함께 저녁 식사');
});

test('a story tab past the strip\'s edge scrolls into view and the strip shows a scrollbar', async ({ page }) => {
    await page.goto(DORM);
    await page.locator('.chat-row[data-chat="다이호"]').click();
    const tabs = page.locator('#chat-tabs .chat-tab');
    await expect(tabs).toHaveCount(10);
    await expect(page.locator('#chat-tabs')).not.toHaveCSS('scrollbar-width', 'none');
    await tabs.last().evaluate(el => el.click()); // a DOM click scrolls nothing by itself
    await expect(tabs.last()).toHaveClass(/is-active/);
    const inView = await page.evaluate(() => {
        const strip = document.getElementById('chat-tabs').getBoundingClientRect();
        const tab = document.querySelector('#chat-tabs .chat-tab.is-active').getBoundingClientRect();
        return tab.left >= strip.left - 1 && tab.right <= strip.right + 1;
    });
    expect(inView).toBe(true);
});

test('a 대사 row opens with the query it was built from, even if the box changed since', async ({ page }) => {
    await page.goto(JUUS);
    await expect(page.locator('#chat-list .chat-row').first()).toBeVisible();
    await page.fill('#chat-search', '첫 여행이라 너무 기대');
    const hit = page.locator('#chat-results [data-open="line"]');
    await expect(hit).toHaveCount(1);
    await page.locator('#chat-search').evaluate(el => { el.value = '첫 여행이라 너무 기대되'; }); // typed, debounce not yet fired
    await hit.click();
    await expect(page.locator('#chat-jump')).toContainText("'첫 여행이라 너무 기대' · 이 대화에서 1건 중 1");
});

// data_for_toy is an external host and new art may not be pushed yet: answer the Juus art
// paths with a 1×1 PNG so an <img> keeps the src under test instead of its error fallback.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
async function openJuusWithArt(page, chat) {
    await page.route(/\/data_for_toy\/main\/juus_(emoji|room)\//, (route) => route.fulfill({ contentType: 'image/png', body: PIXEL }));
    await page.goto(JUUS);
    await expect(page.locator('#chat-list .chat-row').first()).toBeVisible();
    if (!chat) return;
    await page.locator(`.chat-row[data-chat="${chat}"]`).click();
    await page.locator('#chat-mode [data-mode="full"]').click();
}

test('a sticker draws the art emoji_template names, not its own id (갤런트 「서프라이즈」)', async ({ page }) => {
    await openJuusWithArt(page, '갤런트');
    // 239 → line_part2_39 (used to be blank); 13 → 11 (used to show emoji 15's art).
    await expect(page.locator('#chat-log img.chat-sticker[alt="[…거다！]"]')).toHaveAttribute('src', /\/juus_emoji\/line_part2_39\.webp$/);
    await expect(page.locator('#chat-log img.chat-sticker[alt="[심쿵]"]')).toHaveAttribute('src', /\/juus_emoji\/11\.webp$/);
});

test('a video sticker shows its label in place of art (차파예프 「애완동물」)', async ({ page }) => {
    await openJuusWithArt(page, '차파예프');
    await expect(page.locator('#chat-log .chat-sticker--missing', { hasText: '[청소 준비]' })).toBeVisible();
});

test('group rooms show their game avatar, including the five that had none', async ({ page }) => {
    await openJuusWithArt(page);
    await expect(page.locator('.chat-row[data-chat="튤리퍼 채널"] img.chat-avatar')).toHaveAttribute('src', /\/juus_room\/110\.webp$/);
    await expect(page.locator('.chat-row[data-chat="공용 채팅방"] img.chat-avatar')).toHaveAttribute('src', /\/juus_room\/200\.webp$/);
});

test('search announces a one-line count, not the whole results list', async ({ page }) => {
    await page.goto(JUUS);
    await expect(page.locator('#chat-list .chat-row').first()).toBeVisible();
    await expect(page.locator('#chat-results')).not.toHaveAttribute('aria-live');
    const status = page.locator('#chat-search-status');
    await page.fill('#chat-search', '@Ganj');
    await expect(status).toHaveText(/^함순이 1명 · 대사 \d+건$/);
    await page.fill('#chat-search', '없는검색어zzz');
    await expect(status).toHaveText("'없는검색어zzz' 검색 결과가 없습니다.");
    await page.press('#chat-search', 'Escape');
    await expect(status).toHaveText('');
});

test('clearing the search resets 더 보기, so the same query starts on its first page again', async ({ page }) => {
    await page.goto(JUUS);
    await expect(page.locator('#chat-list .chat-row').first()).toBeVisible();
    const rows = page.locator('#chat-results [data-open="line"]');
    await page.fill('#chat-search', '지휘관');
    await expect(rows).toHaveCount(50);
    await page.locator('#chat-results [data-open="more"]').click();
    await expect(rows).toHaveCount(100);
    await page.press('#chat-search', 'Escape');
    await expect(page.locator('#chat-results')).toBeHidden();
    // The hidden list still holds 100 rows, so this only passes once the retyped query re-renders.
    await page.fill('#chat-search', '지휘관');
    await expect(rows).toHaveCount(50);
});

test('<color> tags render as colored text, never as raw markup (로열 네이비 @mentions)', async ({ page }) => {
    await page.goto(JUUS);
    await page.locator('.chat-row[data-chat="로열 네이비 채팅방"]').click();
    await page.locator('#chat-mode [data-mode="full"]').click();
    await page.locator('#chat-tabs .chat-tab[data-story="353"]').click();
    const mention = page.locator('#chat-log .chat-color', { hasText: '@Surrey' });
    await expect(mention).toBeVisible();
    await expect(page.locator('#chat-log')).not.toContainText('<color');
    // The clamped color must survive the CSS minifier: an invalid value would inherit the bubble's.
    const [own, bubble] = await mention.evaluate((n) => [getComputedStyle(n).color, getComputedStyle(n.parentElement).color]);
    expect(own).not.toBe(bubble);
});

test('an avatar that fails to load falls back to the shared "?" placeholder', async ({ page }) => {
    await page.route(/\/skin_icon\/201390\.webp$/, (route) => route.fulfill({ status: 404 }));
    await page.goto(JUUS);
    const avatar = page.locator('.chat-row[data-chat="갤런트"] img.chat-avatar');
    await avatar.scrollIntoViewIfNeeded(); // lazy: an off-screen row never requests its avatar
    // IMG_FALLBACKS.DEFAULT draws a "?" glyph.
    await expect(avatar).toHaveAttribute('src', /%3E\?%3C\/text%3E/);
});

test('쥬쥬 핫 이슈 keeps its centered header (it shares base.css with these pages)', async ({ page }) => {
    await page.goto('chat-viewer/juus-hot-issue/');
    const header = page.locator('.main-header');
    await expect(header).toBeVisible();
    await expect(header).toHaveCSS('text-align', 'center');
});
