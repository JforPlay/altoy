/**
 * skin.voice-alt.js
 * Pure helpers for the alternate voice bank toggle on the skin detail page.
 *
 * Some ships carry a second FULL voice bank in the KR client, baked into the
 * skin data as per-field `voicelink_alt` + skin-level `voice_alt_kind`:
 *   kind 'cn' — Chinese language pack (Dragon Empery ships; default bank is JP)
 *   kind 'cv' — second-CV recording (recast ships: 리나운/후드/아타고/카가/티르피츠/
 *               그라프 체펠린 + 꼬마/META variants)
 * Pure and node-tested — no DOM, no side effects (tests/skin/voice-alt.test.mjs).
 */

export const VOICE_MODE_DEFAULT = 'default';
export const VOICE_MODE_ALT = 'alt';

/** Toggle button labels for a skin's alt bank kind. */
export function voiceToggleLabels(kind) {
    return kind === 'cn'
        ? { default: 'JP', alt: 'CN' }
        : { default: '기본 CV', alt: '대체 CV' };
}

/**
 * Clamp the requested mode against the skin's capability: a skin without an
 * alt bank always renders the default bank, so a sticky 'alt' selection from
 * a previous skin can't disable every play button on this one.
 */
export function effectiveVoiceMode(kind, requestedMode) {
    return kind ? requestedMode : VOICE_MODE_DEFAULT;
}

/**
 * Resolve the playable source for one line in the given mode.
 * Alt mode deliberately does NOT fall back to the default bank — a missing
 * alt recording renders as a disabled button instead of silently mixing
 * banks (the exact confusion the voicelink clobber bug used to cause).
 */
export function resolveVoiceSrc({ src = '', altSrc = '' } = {}, mode) {
    return mode === VOICE_MODE_ALT ? altSrc : src;
}
