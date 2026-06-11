/**
 * story-bgm.test.mjs
 * Tests for the story viewer's pure audio-cue resolution
 * (cueToUrl in public/js/story-viewer/story.bgm.js):
 *   - cue lookup is lowercased (game data casing is unreliable)
 *   - FMOD event:/ paths and unknown cues resolve to null
 *   - paths are percent-encoded per segment (CJK / spaces in filenames)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cueToUrl } from '../../public/js/story-viewer/story.bgm.js';

const BASE = 'https://raw.githubusercontent.com/JforPlay/audio_for_toy/main/';
const MAP = {
    'story-2': 'bgm/story-2/BGM11-剧情BGM2-自然循环.opus',
    'battle-1': 'bgm/battle-1/BGM4-战斗1-循环.opus',
    'theme-dos': 'bgm/theme-dos/Dimensional Ordering System_AL.opus',
};

test('known cue resolves to a fully encoded audio_for_toy URL', () => {
    const url = cueToUrl(MAP, 'story-2');
    assert.equal(url, `${BASE}bgm/story-2/${encodeURIComponent('BGM11-剧情BGM2-自然循环.opus')}`);
});

test('lookup is case-insensitive (game data casing is unreliable)', () => {
    assert.ok(cueToUrl(MAP, 'Battle-1'));
    assert.equal(cueToUrl(MAP, 'Battle-1'), cueToUrl(MAP, 'battle-1'));
});

test('spaces in extracted filenames are percent-encoded, slashes kept', () => {
    const url = cueToUrl(MAP, 'theme-DOS');
    assert.ok(url.endsWith('/Dimensional%20Ordering%20System_AL.opus'));
    assert.ok(url.startsWith(`${BASE}bgm/theme-dos/`));
});

test('FMOD event:/ cues are not bundles and resolve to null', () => {
    assert.equal(cueToUrl(MAP, 'event:/ui/didi'), null);
    assert.equal(cueToUrl(MAP, 'EVENT:/battle/boom1'), null);
});

test('unknown / empty / non-string cues resolve to null', () => {
    assert.equal(cueToUrl(MAP, 'stoy-6'), null); // game-data typo for story-6
    assert.equal(cueToUrl(MAP, ''), null);
    assert.equal(cueToUrl(MAP, null), null);
    assert.equal(cueToUrl(MAP, undefined), null);
    assert.equal(cueToUrl(MAP, 42), null);
    assert.equal(cueToUrl(null, 'story-2'), null);
});
