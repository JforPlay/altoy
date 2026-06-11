/**
 * story-text.test.mjs
 * KR nameColor correction map (dialoguestep.lua:14-32 parity).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correctKrNameColor } from '../../public/js/story-viewer/story.text.js';

test('remaps the six corrected colors', () => {
    assert.equal(correctKrNameColor('#a9f548'), '#5CE6FF');
    assert.equal(correctKrNameColor('#ff5c5c'), '#FF9B93');
    assert.equal(correctKrNameColor('#ffa500'), '#FFC960');
    assert.equal(correctKrNameColor('#ffff4d'), '#FEF15E');
    assert.equal(correctKrNameColor('#696969'), '#BDBDBD');
    assert.equal(correctKrNameColor('#a020f0'), '#C3ABFF');
});

test('case-insensitive and tolerates an 8-digit alpha suffix', () => {
    assert.equal(correctKrNameColor('#A9F548'), '#5CE6FF');
    assert.equal(correctKrNameColor('#a9f548ff'), '#5CE6FF');
    assert.equal(correctKrNameColor('  #FF5C5C '), '#FF9B93');
});

test('unknown colors and non-strings pass through unchanged', () => {
    assert.equal(correctKrNameColor('#123456'), '#123456');
    assert.equal(correctKrNameColor('#92fc63'), '#92fc63');
    assert.equal(correctKrNameColor('red'), 'red');
    assert.equal(correctKrNameColor(undefined), undefined);
    assert.equal(correctKrNameColor(null), null);
});
