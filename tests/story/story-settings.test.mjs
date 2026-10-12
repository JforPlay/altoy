// tests/story/story-settings.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, settingsToCssVars, DEFAULT_SETTINGS, AUTO_DELAY_MS } from '../../public/js/story-viewer/story.settings.js';

test('defaults match the spec', () => {
    assert.deepEqual(DEFAULT_SETTINGS, {
        font: 'sans', size: null, lineHeight: 1.8, boxOpacity: 75, boxWidth: 760,
        reveal: 'type', cps: 40, autoSpeed: 'normal', volume: 1,
    });
    assert.deepEqual(AUTO_DELAY_MS, { slow: 6000, normal: 4000, fast: 2500 });
});

test('garbage and foreign shapes fall back to defaults', () => {
    for (const raw of [null, undefined, 'x', 42, [], { v: 9 }, { font: 'comic', size: 'big', reveal: 1 }]) {
        assert.deepEqual(normalizeSettings(raw), DEFAULT_SETTINGS);
    }
});

test('numbers clamp and round; enums snap', () => {
    const s = normalizeSettings({ size: 99, boxOpacity: -5, boxWidth: 4000, cps: 7.6, volume: 150, lineHeight: 2.1, font: 'serif', autoSpeed: 'fast' });
    assert.equal(s.size, 28);
    assert.equal(s.boxOpacity, 0);
    assert.equal(s.boxWidth, 1100);
    assert.equal(s.cps, 10);
    assert.equal(s.volume, 100);
    assert.equal(s.lineHeight, 2.1);
    assert.equal(s.font, 'serif');
    assert.equal(s.autoSpeed, 'fast');
    assert.equal(normalizeSettings({ lineHeight: 1.7 }).lineHeight, 1.8);
});

test('css vars: size null leaves the breakpoint default in charge', () => {
    const v = settingsToCssVars(DEFAULT_SETTINGS);
    assert.equal(v['--rd-size'], null);
    assert.equal(v['--rd-box-alpha'], '0.75');
    assert.equal(v['--rd-box-width'], '760px');
    assert.equal(v['--rd-lh'], '1.8');
    assert.match(v['--rd-font'], /Noto Sans KR/);
    assert.equal(settingsToCssVars({ ...DEFAULT_SETTINGS, size: 20 })['--rd-size'], '20px');
});
