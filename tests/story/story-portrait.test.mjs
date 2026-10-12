// tests/story/story-portrait.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStoryPortrait, MINI_PORTRAITS } from '../../public/js/story-viewer/story.portrait.js';

const BASE = 'https://cdn/';

test('a full bust resolves to storyicon/<name>.webp', () => {
    assert.deepEqual(resolveStoryPortrait({ portrait: 'kelifulan_3' }, BASE),
        { name: 'kelifulan_3', url: 'https://cdn/storyicon/kelifulan_3.webp', mini: false, noise: false });
});

test('zhihuiguan and tongxunqi are mini portraits', () => {
    for (const name of ['zhihuiguan', 'tongxunqi']) {
        assert.equal(resolveStoryPortrait({ portrait: name }, BASE).mini, true);
        assert.ok(MINI_PORTRAITS.has(name));
    }
});

test('portraitNoise sets noise; names are trimmed and lowercased', () => {
    const p = resolveStoryPortrait({ portrait: ' YELLOW ', portraitNoise: true }, BASE);
    assert.equal(p.name, 'yellow');
    assert.equal(p.noise, true);
});

test('no portrait, empty, or non-string values resolve to null', () => {
    for (const line of [{}, { portrait: '' }, { portrait: 499050 }, null, undefined]) {
        assert.equal(resolveStoryPortrait(line, BASE), null);
    }
});
