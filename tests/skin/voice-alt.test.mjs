/**
 * voice-alt.test.mjs
 * Alternate voice bank helpers (public/js/skin/skin.voice-alt.js).
 *
 * The KR client ships parallel full voice banks (CN packs for Dragon Empery,
 * second-CV recordings for recast ships); the pipeline bakes them into skin
 * data as `voicelink_alt` / `voice_alt_kind`. These helpers drive the JP/CN
 * (기본/대체 CV) toggle on the skin detail page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    VOICE_MODE_DEFAULT,
    VOICE_MODE_ALT,
    voiceToggleLabels,
    effectiveVoiceMode,
    resolveVoiceSrc,
} from '../../public/js/skin/skin.voice-alt.js';

test('labels: cn kind reads JP/CN, cv kind reads 기본/대체 CV', () => {
    assert.deepEqual(voiceToggleLabels('cn'), { default: 'JP', alt: 'CN' });
    assert.deepEqual(voiceToggleLabels('cv'), { default: '기본 CV', alt: '대체 CV' });
});

test('effectiveVoiceMode clamps alt selection on skins without an alt bank', () => {
    assert.equal(effectiveVoiceMode('cn', VOICE_MODE_ALT), VOICE_MODE_ALT);
    assert.equal(effectiveVoiceMode('', VOICE_MODE_ALT), VOICE_MODE_DEFAULT);
    assert.equal(effectiveVoiceMode(undefined, VOICE_MODE_ALT), VOICE_MODE_DEFAULT);
    assert.equal(effectiveVoiceMode('cv', VOICE_MODE_DEFAULT), VOICE_MODE_DEFAULT);
});

test('resolveVoiceSrc picks the bank for the mode', () => {
    const line = { src: 'jp.opus', altSrc: 'cn.opus' };
    assert.equal(resolveVoiceSrc(line, VOICE_MODE_DEFAULT), 'jp.opus');
    assert.equal(resolveVoiceSrc(line, VOICE_MODE_ALT), 'cn.opus');
});

test('resolveVoiceSrc never falls back across banks', () => {
    // Partial alt packs exist (some lines have no alt recording) — alt mode
    // must yield an empty src (disabled button), not the JP audio.
    assert.equal(resolveVoiceSrc({ src: 'jp.opus', altSrc: '' }, VOICE_MODE_ALT), '');
    assert.equal(resolveVoiceSrc({ src: 'jp.opus' }, VOICE_MODE_ALT), '');
    // And a line missing default audio doesn't borrow the alt one.
    assert.equal(resolveVoiceSrc({ src: '', altSrc: 'cn.opus' }, VOICE_MODE_DEFAULT), '');
    assert.equal(resolveVoiceSrc(undefined, VOICE_MODE_DEFAULT), '');
});
