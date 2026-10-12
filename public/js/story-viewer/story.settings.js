/**
 * story.settings.js
 * Reader settings for the story player: model, clamping, CSS variables, and
 * per-device persistence (UI-only prefs → plain getStorageItem, no sync).
 * The DOM panel lives in story.settings-ui.js.
 */
import { getStorageItem, setStorageItem } from '../utils.js';

export const SETTINGS_KEY = 'storyReaderSettings';
const VERSION = 1;

export const AUTO_DELAY_MS = Object.freeze({ slow: 6000, normal: 4000, fast: 2500 });

/** Font families; `href` is the Google Fonts sheet injected on first pick (sans ships globally). */
const FONTS = Object.freeze({
    sans: { family: '"Noto Sans KR", system-ui, sans-serif', href: null },
    serif: { family: '"Noto Serif KR", "Nanum Myeongjo", serif', href: 'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;700&display=swap' },
    round: { family: '"Gowun Dodum", "Noto Sans KR", sans-serif', href: 'https://fonts.googleapis.com/css2?family=Gowun+Dodum&display=swap' },
});
const LINE_HEIGHTS = [1.5, 1.8, 2.1];

export const DEFAULT_SETTINGS = Object.freeze({
    font: 'sans', size: null, lineHeight: 1.8, boxOpacity: 75, boxWidth: 760,
    reveal: 'type', cps: 40, autoSpeed: 'normal', volume: 1,
});

const clampInt = (v, lo, hi, fallback) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN;
    return Number.isNaN(n) ? fallback : Math.min(hi, Math.max(lo, n));
};
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

/**
 * Coerce anything (stored JSON, a foreign shape, garbage) into valid settings.
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function normalizeSettings(raw) {
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const D = DEFAULT_SETTINGS;
    return {
        font: pick(r.font, Object.keys(FONTS), D.font),
        size: r.size == null ? null : clampInt(r.size, 14, 28, null),
        lineHeight: pick(r.lineHeight, LINE_HEIGHTS, D.lineHeight),
        boxOpacity: clampInt(r.boxOpacity, 0, 100, D.boxOpacity),
        boxWidth: clampInt(r.boxWidth, 520, 1100, D.boxWidth),
        reveal: pick(r.reveal, ['instant', 'type'], D.reveal),
        cps: clampInt(r.cps, 10, 80, D.cps),
        autoSpeed: pick(r.autoSpeed, Object.keys(AUTO_DELAY_MS), D.autoSpeed),
        volume: clampInt(r.volume, 0, 100, D.volume),
    };
}

/** CSS custom properties for the player root; null = remove (use the stylesheet default). */
export function settingsToCssVars(s) {
    return {
        '--rd-font': FONTS[s.font].family,
        '--rd-size': s.size == null ? null : `${s.size}px`,
        '--rd-lh': String(s.lineHeight),
        '--rd-box-alpha': String(s.boxOpacity / 100),
        '--rd-box-width': `${s.boxWidth}px`,
    };
}

export function loadSettings() {
    try {
        const stored = JSON.parse(getStorageItem(SETTINGS_KEY, 'null'));
        return normalizeSettings(stored?.v === VERSION ? stored.d : stored);
    } catch {
        return normalizeSettings(null);
    }
}

export function saveSettings(s) {
    setStorageItem(SETTINGS_KEY, JSON.stringify({ v: VERSION, d: s }));
}

/** Inject the font's stylesheet once (CSP already allows fonts.googleapis.com). */
export function ensureFontLoaded(font) {
    const href = FONTS[font]?.href;
    if (!href || document.getElementById(`story-font-${font}`)) return;
    const link = document.createElement('link');
    link.id = `story-font-${font}`;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}
