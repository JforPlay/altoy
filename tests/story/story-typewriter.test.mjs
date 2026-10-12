// tests/story/story-typewriter.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revealCounts } from '../../public/js/story-viewer/story.typewriter.js';

test('reveal fills text nodes in order across <color> spans', () => {
    assert.deepEqual(revealCounts([3, 4, 2], 0), [0, 0, 0]);
    assert.deepEqual(revealCounts([3, 4, 2], 5), [3, 2, 0]);
    assert.deepEqual(revealCounts([3, 4, 2], 9), [3, 4, 2]);
    assert.deepEqual(revealCounts([3, 4, 2], 99), [3, 4, 2]);
    assert.deepEqual(revealCounts([], 5), []);
});
