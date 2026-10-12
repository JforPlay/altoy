// tests/story/story-frames-data.test.mjs
/**
 * painting_frames.json guard (spec §5): every row is [x, y, w, h, W, H] in
 * painting.png px, finite, with a positive frame and canvas — a zero or NaN
 * frame size would place a painting at Infinity/NaN with no error anywhere.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const frames = JSON.parse(readFileSync(new URL('../../public/data/skin/painting_frames.json', import.meta.url), 'utf8'));

test('painting_frames.json rows are six finite numbers with a positive frame and canvas', () => {
    const rows = Object.entries(frames);
    assert.ok(rows.length > 3000, `only ${rows.length} rows`);
    const bad = rows.filter(([, r]) => !Array.isArray(r) || r.length !== 6 || !r.every(Number.isFinite)
        || r[2] <= 0 || r[3] <= 0 || r[4] <= 0 || r[5] <= 0);
    assert.deepEqual(bad.slice(0, 5), [], `${bad.length} malformed rows`);
});

test('keys are skin ids, optionally with the _n variant suffix', () => {
    const odd = Object.keys(frames).filter(k => !/^\d+(_n)?$/.test(k));
    assert.deepEqual(odd.slice(0, 5), []);
});
