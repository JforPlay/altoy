// tests/story/story-readlog.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReadLog, isRead, setRead, countRead } from '../../public/js/story-viewer/story.readlog.js';

test('normalize drops junk and stringifies ids', () => {
    assert.deepEqual(normalizeReadLog({ main: { 90: [4602, '4603', null, 4602] }, bad: 3, x: { y: 'z' } }),
        { main: { 90: ['4602', '4603'] } });
    for (const raw of [null, 'x', [], 7]) assert.deepEqual(normalizeReadLog(raw), {});
});

test('setRead is immutable and idempotent; count is per event', () => {
    const a = setRead({}, 'main', 90, 4602, true);
    const b = setRead(a, 'main', 90, 4602, true);
    assert.deepEqual(a, { main: { 90: ['4602'] } });
    assert.deepEqual(b, a);
    assert.equal(countRead(b, 'main', 90), 1);
    assert.equal(isRead(b, 'main', '90', '4602'), true);
    assert.deepEqual(setRead(b, 'main', 90, 4602, false), { main: {} });
});

test('scopes are isolated (memory ids are not unique across sources)', () => {
    const log = setRead({}, 'event', 101, 1, true);
    assert.equal(isRead(log, 'main', 101, 1), false);
    assert.equal(countRead(log, 'world', 101), 0);
});
