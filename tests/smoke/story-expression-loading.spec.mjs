/**
 * R8 loading boundary: story indexes and chapter selection must not request
 * painting metadata. The first story (including a deep link) loads it once,
 * and a failed optional load is retried by a later story activation.
 */
import { existsSync, readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

const EVENT_STORY_PATH = PAGE_CATALOG.find(
    ({ path }) => path.includes('event-story')
)?.path;

if (!EVENT_STORY_PATH) {
    throw new Error('story-expression-loading: event-story is missing from PAGE_CATALOG');
}

const EXPRESSION_MANIFEST_PATH = '/data/skin/expression_manifest.json';
const eventIndex = JSON.parse(readFileSync(
    new URL('../../public/data/story-viewer/event_story_index.json', import.meta.url),
    'utf8'
));

let storyFixture = null;
for (const event of Object.values(eventIndex)) {
    if (event?.route !== 'inline' || !event.id) continue;
    const chunkUrl = new URL(
        `../../public/data/story-viewer/event_story_chunks/chunk_${event.id}.json`,
        import.meta.url
    );
    if (!existsSync(chunkUrl)) continue;

    const detail = JSON.parse(readFileSync(chunkUrl, 'utf8'));
    const memories = detail.memory_id?.filter(
        (memory) => Array.isArray(memory?.story?.scripts) && memory.story.scripts.length > 0
    );
    if (memories?.length >= 2) {
        storyFixture = {
            eventId: String(event.id),
            memoryIds: memories.slice(0, 2).map(({ id }) => String(id)),
        };
        break;
    }
}

if (!storyFixture) {
    throw new Error('story-expression-loading: no inline event with two stories is available');
}

function isExpressionManifest(url) {
    return new URL(url).pathname.endsWith(EXPRESSION_MANIFEST_PATH);
}

function collectExpressionRequests(page) {
    const requested = [];
    page.on('request', (request) => {
        if (isExpressionManifest(request.url())) {
            requested.push(EXPRESSION_MANIFEST_PATH);
        }
    });
    return requested;
}

function waitForExpressionManifest(page) {
    return page.waitForResponse(
        (response) => isExpressionManifest(response.url()) && response.ok(),
        { timeout: 30_000 }
    );
}

async function openFixtureEvent(page) {
    await page.locator(
        `#event-grid .grid-card[data-id="${storyFixture.eventId}"]`
    ).click();
    await expect(page.locator('#memory-selection-view')).toBeVisible();
    await expect(page.locator(
        `#memory-grid .grid-card[data-id="${storyFixture.memoryIds[0]}"]`
    )).toBeVisible();
    await expect(page.locator(
        `#memory-grid .grid-card[data-id="${storyFixture.memoryIds[1]}"]`
    )).toBeVisible();
}

async function openFixtureStory(page, memoryId) {
    await page.locator(`#memory-grid .grid-card[data-id="${memoryId}"]`).click();
    await expect(page.locator('#story-viewer-view')).toBeVisible();
}

test('R8: expression data starts on first story playback, not index or chapter browsing', async ({ page }) => {
    const requested = collectExpressionRequests(page);

    await page.goto(EVENT_STORY_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#event-grid .event-year-section');
    await page.waitForTimeout(1_000);
    expect(requested, 'default story index boot must not load expression data').toEqual([]);

    await openFixtureEvent(page);
    expect(requested, 'chapter browsing must remain expression-data free').toEqual([]);

    const firstManifest = waitForExpressionManifest(page);
    await page.locator(
        `#memory-grid .grid-card[data-id="${storyFixture.memoryIds[0]}"]`
    ).click();
    await firstManifest;
    await expect(page.locator('#story-viewer-view')).toBeVisible();

    expect(requested).toEqual([EXPRESSION_MANIFEST_PATH]);

    await page.locator('#back-to-memory-selection').click();
    await expect(page.locator('#memory-selection-view')).toBeVisible();
    await openFixtureStory(page, storyFixture.memoryIds[1]);
    await page.waitForTimeout(250);

    expect(requested, 'later stories must reuse the loaded manifest').toHaveLength(1);
});

test('R8: a story deep link loads expression data before initial playback', async ({ page }) => {
    const requested = collectExpressionRequests(page);
    const manifestResponse = waitForExpressionManifest(page);

    await page.goto(
        `${EVENT_STORY_PATH}?eventid=${storyFixture.eventId}&story=${storyFixture.memoryIds[0]}`,
        { waitUntil: 'domcontentloaded' }
    );
    await manifestResponse;

    expect(requested).toEqual([EXPRESSION_MANIFEST_PATH]);
    await expect(page.locator('#story-viewer-view')).toBeVisible();
});

test('R8: a failed expression load is retried by the next story activation', async ({ page }) => {
    let attempts = 0;
    await page.route('**/data/skin/expression_manifest.json', async (route) => {
        attempts += 1;
        if (attempts === 1) {
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: '{}',
            });
            return;
        }
        await route.continue();
    });

    await page.goto(EVENT_STORY_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#event-grid .event-year-section');
    await openFixtureEvent(page);
    await openFixtureStory(page, storyFixture.memoryIds[0]);
    expect(attempts).toBe(1);

    await page.locator('#back-to-memory-selection').click();
    await expect(page.locator('#memory-selection-view')).toBeVisible();

    const retryResponse = waitForExpressionManifest(page);
    await page.locator(
        `#memory-grid .grid-card[data-id="${storyFixture.memoryIds[1]}"]`
    ).click();
    await retryResponse;

    expect(attempts).toBe(2);
    await expect(page.locator('#story-viewer-view')).toBeVisible();
});
