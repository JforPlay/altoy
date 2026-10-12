// tests/smoke/story-reader.spec.mjs
/**
 * Story reader rework — behaviour smoke. Fixtures are found in COMMITTED story
 * masters (never data:split chunks). Run after `npm run build`:
 *   SMOKE_PORT=4399 npx playwright test tests/smoke/story-reader.spec.mjs --workers=1
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';

test.setTimeout(60_000);

const pagePath = (fragment) => {
    const p = PAGE_CATALOG.find(({ path }) => path.includes(fragment))?.path;
    if (!p) throw new Error(`story-reader: ${fragment} missing from PAGE_CATALOG`);
    return p;
};
const EVENT_STORY = pagePath('event-story');
const LORA_STORY = pagePath('lora-story');

const readMaster = (file) => JSON.parse(readFileSync(
    new URL(`../../public/data/story-viewer/${file}`, import.meta.url), 'utf8'));

test('child pages load the expression manifest when a story starts', async ({ page }) => {
    const manifest = page.waitForResponse((r) => r.url().endsWith('/data/skin/expression_manifest.json'));
    await page.goto(LORA_STORY, { waitUntil: 'domcontentloaded' });
    await page.locator('.lora-card:not(.polaroid-card)').first().click();
    await manifest;
    await expect(page.locator('#story-viewer-view')).toBeVisible();
    await expect(page.locator('#story-title')).not.toHaveText('');
});

/** First event line (no branch flag) whose step names a full-bust portrait. */
function findPortraitLine() {
    const events = readMaster('event_story_data.json');
    for (const ev of Object.values(events)) {
        if (ev?.route !== 'inline' && ev?.route !== undefined) continue;
        for (const mem of ev.memory_id || []) {
            const scripts = Array.isArray(mem?.story?.scripts) ? mem.story.scripts : [];
            const i = scripts.findIndex(s => typeof s?.portrait === 'string' && s.say
                && s.optionFlag === undefined && !['zhihuiguan', 'tongxunqi'].includes(s.portrait));
            if (i >= 0) return { eventId: String(ev.id), memoryId: String(mem.id), index: i, name: scripts[i].portrait };
        }
    }
    throw new Error('story-reader: no portrait line in event_story_data.json — run Task A3 first');
}
const PORTRAIT = findPortraitLine();

// A 1x1 transparent PNG: the portrait assertions must not depend on whether
// data_for_toy has published the storyicon yet (a live 404 would hide the bust).
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function openLine(page, { eventId, memoryId, index }) {
    await page.goto(`${EVENT_STORY}?eventid=${eventId}&story=${memoryId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#story-viewer-view')).toBeVisible();
    await page.evaluate((i) => { window.StoryViewer.scriptIndex = i; window.StoryViewer.renderScriptLine(); }, index);
}

test('a portrait line shows its storyicon bust (URL, not just visibility)', async ({ page }) => {
    await page.route('**/storyicon/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
    await openLine(page, PORTRAIT);
    const src = await page.locator('#actor-portrait img').getAttribute('src');
    expect(src).toMatch(new RegExp(`/storyicon/${PORTRAIT.name}\\.webp$`));
    await expect(page.locator('#dialogue-box')).toHaveClass(/has-portrait/);
    await expect(page.locator('#actor-portrait')).toBeVisible();
});

test('missing storyicon hides the bust', async ({ page }) => {
    await page.route('**/storyicon/**', (r) => r.fulfill({ status: 404, body: '' }));
    // An empty portrait slot is already "hidden"; prove the bust was attempted first.
    const attempted = page.waitForRequest(new RegExp(`/storyicon/${PORTRAIT.name}\\.webp$`));
    await openLine(page, PORTRAIT);
    await attempted;
    await expect(page.locator('#actor-portrait')).toBeHidden();
    await expect(page.locator('#dialogue-box')).not.toHaveClass(/has-portrait/);
});

/** Main story 하늘의 문 (chapter 90, memory 4602): I404's line, the spec's worked example. */
const MAIN_STORY = pagePath('story-viewer/main-story/');
const I404_LINE = { eventId: '90', memoryId: '4602', index: 4 };

test('I404 is placed by her duihua frame (game scale), not fit to the stage', async ({ page }) => {
    await page.goto(`${MAIN_STORY}?eventid=${I404_LINE.eventId}&story=${I404_LINE.memoryId}`);
    await expect(page.locator('#story-viewer-view')).toBeVisible();
    await page.evaluate((i) => { window.StoryViewer.scriptIndex = i; window.StoryViewer.renderScriptLine(); }, I404_LINE.index);
    const scale = Number(await page.locator('.painting-container[data-side="2"]').getAttribute('data-scale'));
    expect(scale).toBeGreaterThan(0.40);
    expect(scale).toBeLessThan(0.41);
});

test('without painting_frames.json the painting still renders (fit fallback)', async ({ page }) => {
    await page.route('**/data/skin/painting_frames.json', (r) => r.fulfill({ status: 404, body: '' }));
    await page.goto(`${MAIN_STORY}?eventid=${I404_LINE.eventId}&story=${I404_LINE.memoryId}`);
    await expect(page.locator('#story-viewer-view')).toBeVisible();
    await page.evaluate((i) => { window.StoryViewer.scriptIndex = i; window.StoryViewer.renderScriptLine(); }, I404_LINE.index);
    const scale = Number(await page.locator('.painting-container[data-side="2"]').getAttribute('data-scale'));
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(0.2);
});

test('portrait phone: the stage canvas covers the viewer, centred', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${MAIN_STORY}?eventid=${I404_LINE.eventId}&story=${I404_LINE.memoryId}`);
    await expect(page.locator('#story-viewer-view')).toBeVisible();
    const r = await page.evaluate(() => {
        const s = document.querySelector('.story-stage').getBoundingClientRect();
        const c = document.querySelector('.story-stage-canvas').getBoundingClientRect();
        return { s: [s.left, s.top, s.width, s.height], c: [c.left, c.top, c.width, c.height] };
    });
    const [sl, st, sw, sh] = r.s, [cl, ct, cw, ch] = r.c;
    expect(ch).toBeGreaterThanOrEqual(sh - 1);
    expect(cw).toBeGreaterThanOrEqual(sw - 1);
    expect(Math.abs((cl + cw / 2) - (sl + sw / 2))).toBeLessThan(1);
    expect(Math.abs((ct + ch / 2) - (st + sh / 2))).toBeLessThan(1);
});

test('I404 composites only the visible crop (sharp: canvas ≥ its on-screen size)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${MAIN_STORY}?eventid=${I404_LINE.eventId}&story=${I404_LINE.memoryId}`);
    await expect(page.locator('#story-viewer-view')).toBeVisible();
    await page.evaluate((i) => { window.StoryViewer.scriptIndex = i; window.StoryViewer.renderScriptLine(); }, I404_LINE.index);
    const canvas = page.locator('.painting-container[data-side="2"] canvas.painting-base');
    // An undrawn <canvas> is 300 px wide by default; wait for the real composite.
    await expect.poll(() => canvas.evaluate((c) => c.width), { timeout: 30_000 }).not.toBe(300);
    const m = await canvas.evaluate((c) => {
        const r = c.getBoundingClientRect();
        const s = document.querySelector('.story-stage-canvas').getBoundingClientRect();
        return { px: c.width, css: r.width, inside: r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1 };
    });
    // The engine shows I404's painting_n (9816 px), which a 4096 cap barely
    // covers on screen — so also assert the crop itself: nothing drawn off-stage.
    expect(m.inside).toBe(true);
    expect(m.px).toBeGreaterThanOrEqual(m.css * 0.95);
});

test('layout A: chrome chips, band and ending card replace the old bars', async ({ page }) => {
    await openLine(page, PORTRAIT);
    await expect(page.locator('.story-chrome .chrome-btn')).toHaveCount(5);
    await expect(page.locator('.bottom-bar-container')).toHaveCount(0);
    await expect(page.locator('#dialogue-box')).toHaveClass(/dialogue-band/);
    await page.evaluate(() => { const v = window.StoryViewer; v.scriptIndex = v.currentStoryScript.length - 1; v.renderScriptLine(); });
    await expect(page.locator('#up-next')).toBeVisible();
    await expect(page.locator('#return-btn')).toBeVisible();
});

test('first tap while typing finishes the line; left third goes back', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('storyReaderSettings', JSON.stringify({ v: 1, d: { reveal: 'type', cps: 10 } })));
    await openLine(page, { ...PORTRAIT, index: Math.max(1, PORTRAIT.index) });
    const full = await page.evaluate(() => window.StoryViewer.currentStoryScript[window.StoryViewer.scriptIndex].say.replace(/<[^>]+>/g, ''));
    const box = await page.locator('#viewer-container').boundingBox();
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.5);
    await expect(page.locator('#dialogue-text')).toHaveText(full);
    const before = await page.evaluate(() => window.StoryViewer.scriptIndex);
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.5);
    await expect.poll(() => page.evaluate(() => window.StoryViewer.scriptIndex)).toBeLessThan(before);
});

test('H hides the UI; a tap restores it without advancing', async ({ page }) => {
    await openLine(page, PORTRAIT);
    await page.keyboard.press('KeyH');
    const hit = await page.evaluate(() => {
        const b = document.querySelector('#dialogue-box').getBoundingClientRect();
        return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('#dialogue-box') !== null;
    });
    expect(hit).toBe(false);
    const idx = await page.evaluate(() => window.StoryViewer.scriptIndex);
    await page.mouse.click(400, 400);
    await expect(page.locator('#story-viewer-view')).toHaveAttribute('data-ui', 'shown');
    expect(await page.evaluate(() => window.StoryViewer.scriptIndex)).toBe(idx);
});

test('settings change the band and survive a reload', async ({ page }) => {
    await openLine(page, PORTRAIT);
    await page.locator('#settings-btn').click();
    await expect(page.locator('#reader-settings')).toHaveClass(/open/);
    // One scrolling view: every section is there at once, no tabs.
    await expect(page.locator('#reader-settings .rs-section')).toHaveCount(3);
    await expect(page.locator('#reader-settings [role="tab"]')).toHaveCount(0);
    await page.locator('[data-setting="size"][data-step="1"]').click();
    await page.locator('#rs-boxOpacity').fill('30');
    const fs = await page.locator('#dialogue-text').evaluate((n) => getComputedStyle(n).fontSize);
    await page.reload();
    await expect(page.locator('#story-viewer-view')).toBeVisible();
    expect(await page.locator('#dialogue-text').evaluate((n) => getComputedStyle(n).fontSize)).toBe(fs);
    expect(await page.locator('#story-viewer-view').evaluate((n) => n.style.getPropertyValue('--rd-box-alpha'))).toBe('0.3');
});

test('auto-play counts down 8 s at the end and starts the next story', async ({ page }) => {
    await page.clock.install();
    await page.goto(`${EVENT_STORY}?eventid=${PORTRAIT.eventId}&story=${PORTRAIT.memoryId}`);
    await expect(page.locator('#story-viewer-view')).toBeVisible();
    const hasNext = await page.evaluate(() => !!window.StoryViewer.nextMemory);
    test.skip(!hasNext, 'fixture memory is the last of its event');
    await page.locator('#auto-play-btn').click();
    await page.evaluate(() => { const v = window.StoryViewer; v.scriptIndex = v.currentStoryScript.length - 1; v.renderScriptLine(); v.typewriter.finish(); });
    await expect(page.locator('#up-next')).toHaveClass(/is-counting/);
    const first = await page.evaluate(() => window.StoryViewer.currentMemoryId);
    await page.clock.runFor(8_500);
    await expect.poll(() => page.evaluate(() => window.StoryViewer.currentMemoryId)).not.toBe(first);
    await expect(page.locator('#auto-play-btn')).toHaveAttribute('aria-pressed', 'true');
});

test('leaving during the countdown never starts another story', async ({ page }) => {
    await page.clock.install();
    await page.goto(`${EVENT_STORY}?eventid=${PORTRAIT.eventId}&story=${PORTRAIT.memoryId}`);
    await expect(page.locator('#story-viewer-view')).toBeVisible();
    await page.locator('#auto-play-btn').click();
    await page.evaluate(() => { const v = window.StoryViewer; v.scriptIndex = v.currentStoryScript.length - 1; v.renderScriptLine(); });
    await page.locator('#return-btn').click();
    await expect(page.locator('#memory-selection-view')).toBeVisible();
    await page.clock.runFor(10_000);
    await expect(page.locator('#memory-selection-view')).toBeVisible();
    await expect(page.locator('#story-viewer-view')).toBeHidden();
});

test('finishing a story marks it read on its memory card; the checkbox toggles it back', async ({ page }) => {
    await page.goto(`${EVENT_STORY}?eventid=${PORTRAIT.eventId}&story=${PORTRAIT.memoryId}`);
    await expect(page.locator('#story-viewer-view')).toBeVisible();
    await page.evaluate(() => { const v = window.StoryViewer; v.scriptIndex = v.currentStoryScript.length - 1; v.renderScriptLine(); });
    await expect(page.locator('#up-next-read')).toBeVisible();
    await page.locator('#return-btn').click();
    const box = page.locator(`#memory-grid .grid-card[data-id="${PORTRAIT.memoryId}"] .card-checkbox`);
    await expect(box).toHaveAttribute('aria-checked', 'true');
    await box.click();
    await expect(box).toHaveAttribute('aria-checked', 'false');
    const stored = await page.evaluate(() => localStorage.getItem('storyReadLog'));
    expect(JSON.parse(stored).d.event?.[PORTRAIT.eventId] ?? []).not.toContain(PORTRAIT.memoryId);
});

// ---- Final-review fixes (2026-10-12) ---------------------------------------

/** An inline event memory (not its event's last) whose final line is a plain spoken line. */
function findEndSayStory() {
    for (const ev of Object.values(readMaster('event_story_data.json'))) {
        if (ev?.route !== 'inline') continue;
        const mems = ev.memory_id || [];
        for (const mem of mems.slice(0, -1)) {
            const sc = Array.isArray(mem?.story?.scripts) ? mem.story.scripts : [];
            const last = sc[sc.length - 1];
            if (last?.say && last.say.length > 20 && !last.sequence && last.optionFlag === undefined && !last.options) {
                return { eventId: String(ev.id), memoryId: String(mem.id) };
            }
        }
    }
    throw new Error('story-reader: no end-with-a-spoken-line fixture');
}
const END_SAY = findEndSayStory();

/** A story with one choice whose option `flag` dead-ends before the script does. */
function findDeadEnd() {
    for (const ev of Object.values(readMaster('event_story_data.json'))) {
        if (ev?.route !== 'inline') continue;
        for (const mem of ev.memory_id || []) {
            const sc = Array.isArray(mem?.story?.scripts) ? mem.story.scripts : null;
            const last = sc?.[sc.length - 1];
            if (!sc || last?.optionFlag === undefined) continue;
            const oi = sc.findIndex(l => Array.isArray(l.options) && l.options.length >= 2 && l.optionFlag === undefined);
            if (oi < 0 || sc.slice(oi + 1).some(l => Array.isArray(l.options) && l.options.length)) continue;
            const other = sc[oi].options.find(o => o.flag !== last.optionFlag);
            const deadEnd = sc.map((l, i) => (l.optionFlag === other?.flag && l.say ? i : -1)).filter(i => i >= 0).pop();
            if (other && deadEnd != null) return { eventId: String(ev.id), memoryId: String(mem.id), optionsIndex: oi, flag: other.flag, deadEnd };
        }
    }
    throw new Error('story-reader: no branch dead-end fixture');
}
const DEAD = findDeadEnd();

const withSettings = (page, d) => page.addInitScript((s) => localStorage.setItem('storyReaderSettings', JSON.stringify({ v: 1, d: s })), d);
const toLastLine = (page) => page.evaluate(() => { const v = window.StoryViewer; v.scriptIndex = v.currentStoryScript.length - 1; v.renderScriptLine(); });

test('a missing storyicon stays hidden on the next line of the same portrait', async ({ page }) => {
    await page.route('**/storyicon/**', (r) => r.fulfill({ status: 404, body: '' }));
    const attempted = page.waitForRequest(new RegExp(`/storyicon/${PORTRAIT.name}\\.webp$`));
    await openLine(page, PORTRAIT);
    await attempted;
    await expect(page.locator('#dialogue-box')).not.toHaveClass(/has-portrait/);
    await page.evaluate(() => window.StoryViewer.renderScriptLine());   // same portrait again
    await expect(page.locator('#dialogue-box')).not.toHaveClass(/has-portrait/);
    await expect(page.locator('#actor-portrait')).toBeHidden();
});

test('the flashback tint stays inside the stage, under the band', async ({ page }) => {
    const OLD = (() => {
        for (const ev of Object.values(readMaster('event_story_data.json'))) {
            if (ev?.route !== 'inline') continue;
            for (const mem of ev.memory_id || []) {
                const sc = Array.isArray(mem?.story?.scripts) ? mem.story.scripts : [];
                const i = sc.findIndex(l => l.oldPhoto && l.say && l.optionFlag === undefined);
                if (i >= 0) return { eventId: String(ev.id), memoryId: String(mem.id), index: i };
            }
        }
        throw new Error('story-reader: no oldPhoto fixture');
    })();
    await openLine(page, OLD);
    await expect(page.locator('.story-oldphoto-overlay')).toHaveCount(1);
    expect(await page.locator('.story-oldphoto-overlay').evaluate((o) => !!o.closest('.story-stage'))).toBe(true);
});

test('the end-card countdown waits until the last line has finished typing', async ({ page }) => {
    await withSettings(page, { reveal: 'type', cps: 10 });
    await page.clock.install();
    await page.goto(`${EVENT_STORY}?eventid=${END_SAY.eventId}&story=${END_SAY.memoryId}`);
    await expect(page.locator('#story-viewer-view')).toBeVisible();
    await page.locator('#auto-play-btn').click();
    await toLastLine(page);
    await expect(page.locator('#up-next')).toBeVisible();
    expect(await page.evaluate(() => window.StoryViewer.typewriter.isTyping())).toBe(true);
    await expect(page.locator('#up-next')).not.toHaveClass(/is-counting/);
    await page.evaluate(() => window.StoryViewer.typewriter.finish());
    await expect(page.locator('#up-next')).toHaveClass(/is-counting/);
});

test('Enter on a focused control activates it instead of advancing; Ctrl+A is not AUTO', async ({ page }) => {
    await openLine(page, PORTRAIT);
    const idx = await page.evaluate(() => window.StoryViewer.scriptIndex);
    await page.locator('#settings-btn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#reader-settings')).toHaveClass(/open/);
    expect(await page.evaluate(() => window.StoryViewer.scriptIndex)).toBe(idx);
    await page.locator('[data-rs-close]').click();
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+KeyA');
    await expect(page.locator('#auto-play-btn')).toHaveAttribute('aria-pressed', 'false');
});

test('at a branch dead end, advancing does not replay the line; ↶ returns to the choice', async ({ page }) => {
    await withSettings(page, { reveal: 'type', cps: 40 });
    await openLine(page, { eventId: DEAD.eventId, memoryId: DEAD.memoryId, index: DEAD.optionsIndex });
    await page.evaluate(({ flag, deadEnd }) => {
        const v = window.StoryViewer;
        v.handleOptionSelect(flag);
        v.scriptIndex = deadEnd; v.renderScriptLine(); v.typewriter.finish();
    }, DEAD);
    await expect(page.locator('#branch-end')).toBeVisible();
    await page.keyboard.press('Space');
    expect(await page.evaluate(() => window.StoryViewer.typewriter.isTyping())).toBe(false);
    await page.locator('#branch-back-btn').click();
    await expect(page.locator('#options-box .option-button').first()).toBeVisible();
    expect(await page.evaluate(() => window.StoryViewer.scriptIndex)).toBe(DEAD.optionsIndex);
});

test('opening 보기 설정 pauses the end-card countdown; closing resumes it', async ({ page }) => {
    await withSettings(page, { reveal: 'instant' });
    await page.clock.install();
    await page.goto(`${EVENT_STORY}?eventid=${END_SAY.eventId}&story=${END_SAY.memoryId}`);
    await expect(page.locator('#story-viewer-view')).toBeVisible();
    await page.locator('#auto-play-btn').click();
    await toLastLine(page);
    await expect(page.locator('#up-next')).toHaveClass(/is-counting/);
    await page.locator('#settings-btn').click();
    await expect(page.locator('#up-next')).not.toHaveClass(/is-counting/);
    await page.locator('[data-rs-close]').click();
    await expect(page.locator('#up-next')).toHaveClass(/is-counting/);
});

test('AUTO keeps going when the next story is opened from the grid', async ({ page }) => {
    await withSettings(page, { reveal: 'instant' });
    await page.clock.install();
    await page.goto(`${EVENT_STORY}?eventid=${END_SAY.eventId}&story=${END_SAY.memoryId}`);
    await expect(page.locator('#story-viewer-view')).toBeVisible();
    await page.locator('#auto-play-btn').click();
    await page.evaluate(() => window.StoryViewer.returnToMemorySelection());
    await expect(page.locator('#memory-selection-view')).toBeVisible();
    await page.locator(`#memory-grid .grid-card[data-id="${END_SAY.memoryId}"]`).click();
    await expect(page.locator('#story-viewer-view')).toBeVisible();
    const start = await page.evaluate(() => window.StoryViewer.scriptIndex);
    await page.clock.runFor(7_000);
    await expect.poll(() => page.evaluate(() => window.StoryViewer.scriptIndex)).toBeGreaterThan(start);
});

test('the LOG pauses AUTO; closing it resumes', async ({ page }) => {
    await withSettings(page, { reveal: 'instant' });
    await page.clock.install();
    await openLine(page, PORTRAIT);
    await page.locator('#auto-play-btn').click();
    await expect(page.locator('#dialogue-box')).toHaveClass(/is-counting/);
    await page.locator('#view-script-btn').click();
    await expect(page.locator('#dialogue-box')).not.toHaveClass(/is-counting/);
    const idx = await page.evaluate(() => window.StoryViewer.scriptIndex);
    await page.clock.runFor(8_000);
    expect(await page.evaluate(() => window.StoryViewer.scriptIndex)).toBe(idx);
    await page.locator('#close-modal-btn').click();
    await expect(page.locator('#dialogue-box')).toHaveClass(/is-counting/);
});

test('secretary and hof get the 전체 복사 transcript toolbar', async ({ page }) => {
    for (const p of [pagePath('secretary-story'), pagePath('story-viewer/hof')]) {
        await page.goto(p, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#copy-script-btn')).toHaveCount(1);
    }
});

test('Escape during the countdown leaves for good', async ({ page }) => {
    await withSettings(page, { reveal: 'instant' });
    await page.clock.install();
    await page.goto(`${EVENT_STORY}?eventid=${END_SAY.eventId}&story=${END_SAY.memoryId}`);
    await expect(page.locator('#story-viewer-view')).toBeVisible();
    await page.locator('#auto-play-btn').click();
    await toLastLine(page);
    await expect(page.locator('#up-next')).toHaveClass(/is-counting/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#memory-selection-view')).toBeVisible();
    await page.clock.runFor(10_000);
    await expect(page.locator('#story-viewer-view')).toBeHidden();
});

test('hidden UI takes its controls out of the Tab order', async ({ page }) => {
    await openLine(page, PORTRAIT);
    await page.keyboard.press('KeyH');
    await expect.poll(() => page.locator('#settings-btn').evaluate((b) => getComputedStyle(b).visibility)).toBe('hidden');
});

// ---- Toolbar / band / BGM polish (2026-10-12) --------------------------------

test('the toolbar controls are equal squares, the BGM one included, icons centred', async ({ page }) => {
    await openLine(page, PORTRAIT);
    await page.evaluate(() => window.StoryViewer.handleBgm('battle-2'));
    await expect(page.locator('#bgm-btn')).toBeVisible();
    const buttons = await page.evaluate(() => [...document.querySelectorAll('.story-chrome .chrome-btn')].map((b) => {
        const r = b.getBoundingClientRect();
        const svg = b.querySelector(':scope > svg');
        const s = svg?.getBoundingClientRect();
        // A legacy #id rule once overrode the square's grid centring (icon pinned left).
        return { size: [r.width, r.height], off: s ? [s.x + s.width / 2 - (r.x + r.width / 2), s.y + s.height / 2 - (r.y + r.height / 2)] : [0, 0] };
    }));
    expect(buttons).toHaveLength(5);
    for (const { size, off } of buttons) {
        expect(size).toEqual([buttons[0].size[0], buttons[0].size[0]]);
        expect(Math.abs(off[0])).toBeLessThan(1.5);
        expect(Math.abs(off[1])).toBeLessThan(1.5);
    }
});

/** Main story 29/1061 line 17: both side slots filled. */
const TWO_SIDES = { eventId: '29', memoryId: '1061', index: 17 };

test('a narrow viewer fits both side paintings on screen; 16:9 keeps the game stage', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${MAIN_STORY}?eventid=${TWO_SIDES.eventId}&story=${TWO_SIDES.memoryId}`);
    await expect(page.locator('#story-viewer-view')).toBeVisible();
    await page.evaluate((i) => { window.StoryViewer.scriptIndex = i; window.StoryViewer.renderScriptLine(); }, TWO_SIDES.index);
    const measure = () => page.evaluate(() => {
        const v = window.StoryViewer;
        const r = (e) => e.getBoundingClientRect();
        const stage = r(document.querySelector('.story-stage'));
        const layer = r(v.elements.paintingLayer);
        const canvas = r(document.querySelector('.story-stage-canvas'));
        const shown = [...v.paintingsBySide.values()].map(({ element }) => {
            const b = r(element);
            return { onScreen: (Math.min(b.right, stage.right) - Math.max(b.left, stage.left)) / b.width, height: b.height, pad: element._pad };
        });
        return { sides: [...v.paintingsBySide.keys()].sort(), layerW: layer.width, layerH: layer.height, canvasW: canvas.width, shown };
    });
    const phone = await measure();
    expect(phone.sides).toEqual([0, 1]);
    expect(phone.layerW).toBeLessThan(phone.canvasW * 0.6);
    for (const s of phone.shown) {
        expect(s.onScreen).toBeGreaterThan(0.6);
        // The crop reaches past the shrunken layer, so its edges never show as hard cuts.
        expect(s.height).toBeGreaterThan(phone.layerH);
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect.poll(async () => {
        const m = await measure();
        return [Math.round(m.layerW - m.canvasW), ...m.shown.map((s) => s.pad)];
    }).toEqual([0, 0, 0]);
});

test('the band is sized by its text: the same height and name offset at any window height', async ({ page }) => {
    await openLine(page, PORTRAIT);
    const measure = async (height) => {
        await page.setViewportSize({ width: 1280, height });
        return page.evaluate(() => {
            const band = document.querySelector('#dialogue-box').getBoundingClientRect();
            const name = document.querySelector('#actor-name').getBoundingClientRect();
            return { band: band.height, nameOffset: name.top - band.top };
        });
    };
    const short = await measure(700);
    expect(await measure(1100)).toEqual(short);
});

test('the text column is centred and its ‹ › close it at the bottom-right', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });   // wide enough to leave room around the column
    await openLine(page, PORTRAIT);
    const g = await page.evaluate(() => {
        const band = document.querySelector('#dialogue-box');
        const cs = getComputedStyle(band);
        const b = band.getBoundingClientRect();
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const col = r('.dialogue-content'), nav = r('.band-nav'), text = r('#dialogue-text');
        return {
            leftGap: col.left - (b.left + parseFloat(cs.paddingLeft)),
            rightGap: (b.right - parseFloat(cs.paddingRight)) - col.right,
            navRight: col.right - nav.right,
            navBottom: text.bottom - nav.bottom,
        };
    });
    expect(g.leftGap).toBeGreaterThan(10);
    expect(Math.abs(g.leftGap - g.rightGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.navRight)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.navBottom)).toBeLessThanOrEqual(1);
});

test('the ▼ continue cue follows the last character and leaves on a choice line', async ({ page }) => {
    await openLine(page, PORTRAIT);
    await expect(page.locator('#dialogue-box')).toHaveClass(/can-continue/);
    expect(await page.locator('#dialogue-text').evaluate((t) => getComputedStyle(t, '::after').content)).toContain('▼');
    await openLine(page, { eventId: DEAD.eventId, memoryId: DEAD.memoryId, index: DEAD.optionsIndex });
    await expect(page.locator('#options-box .option-button').first()).toBeVisible();
    await expect(page.locator('#dialogue-box')).not.toHaveClass(/can-continue/);
});

test('the BGM pop-up opens on click with play/pause inside and shares the volume setting', async ({ page }) => {
    await openLine(page, PORTRAIT);
    await page.evaluate(() => window.StoryViewer.handleBgm('battle-2'));
    await expect(page.locator('#bgm-pop')).toBeHidden();
    await page.locator('#bgm-btn').click();
    await expect(page.locator('#bgm-pop')).toBeVisible();
    await expect(page.locator('#bgm-btn')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#bgm-pop #play-pause-btn')).toBeVisible();
    await page.locator('#bgm-volume').fill('40');
    await expect(page.locator('#rs-volume')).toHaveValue('40');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('storyReaderSettings')).d.volume)).toBe(40);
    // A tap on the art closes it without turning the page …
    const idx = await page.evaluate(() => window.StoryViewer.scriptIndex);
    const box = await page.locator('#viewer-container').boundingBox();
    await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.45);
    await expect(page.locator('#bgm-pop')).toBeHidden();
    expect(await page.evaluate(() => window.StoryViewer.scriptIndex)).toBe(idx);
    // … and Escape closes it without leaving the story.
    await page.locator('#bgm-btn').click();
    await expect(page.locator('#bgm-pop')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#bgm-pop')).toBeHidden();
    await expect(page.locator('#story-viewer-view')).toBeVisible();
});
