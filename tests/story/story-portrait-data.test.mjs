/**
 * Every committed story master carries `portrait` as the lowercase storyicon
 * bundle name (Task A1 normalizes it; hof is hand-edited). A numeric or mixed-
 * case value would silently resolve to a 404 bust in the browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = [
    'event_story_data.json', 'main_story_data.json', 'secretary_story_data.json',
    'hof_kr.json', 'hof_kr_dummy.json', 'lora_story_data.json',
    'navi_story_data.json', 'tb_story_data.json',
];

function* portraits(node) {
    if (Array.isArray(node)) { for (const v of node) yield* portraits(v); return; }
    if (!node || typeof node !== 'object') return;
    if ('portrait' in node) yield node.portrait;
    for (const v of Object.values(node)) yield* portraits(v);
}

for (const file of FILES) {
    test(`${file}: portraits are lowercase bundle names`, () => {
        const data = JSON.parse(readFileSync(new URL(`../../public/data/story-viewer/${file}`, import.meta.url), 'utf8'));
        const bad = [...portraits(data)].filter(p => typeof p !== 'string' || p !== p.trim().toLowerCase() || !p);
        assert.deepEqual(bad.slice(0, 5), [], `${bad.length} non-normalized portraits`);
    });
}

test('main + event masters carry portraits at all (the pipeline stopped stripping them)', () => {
    let n = 0;
    for (const file of ['event_story_data.json', 'main_story_data.json']) {
        const data = JSON.parse(readFileSync(new URL(`../../public/data/story-viewer/${file}`, import.meta.url), 'utf8'));
        for (const _ of portraits(data)) n++;
    }
    assert.ok(n > 5000, `only ${n} portraits in main+event`);
});
