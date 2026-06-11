/**
 * story.text.js
 * Text-fidelity helpers for the story viewer, mirroring the KR client's
 * dialogue text handling. Pure data-in/data-out — node-importable for tests.
 */

/**
 * KR client nameColor correction map (dialoguestep.lua:14-32). The raw story
 * configs carry CN-era colors; the KR build remaps them for readability on
 * its dialogue panel. Keys are lowercase 6-digit hex.
 */
export const KR_NAME_COLOR_MAP = {
    '#a9f548': '#5CE6FF',
    '#ff5c5c': '#FF9B93',
    '#ffa500': '#FFC960',
    '#ffff4d': '#FEF15E',
    '#696969': '#BDBDBD',
    '#a020f0': '#C3ABFF',
    '#ffffff': '#FFFFFF',
};

/**
 * Apply the KR client's nameColor correction. Case-insensitive; tolerates
 * 8-digit hex with a trailing alpha pair (the Lua does the same). Unknown
 * colors pass through unchanged.
 */
export function correctKrNameColor(color) {
    if (typeof color !== 'string') return color;
    let key = color.trim().toLowerCase();
    if (/^#[0-9a-f]{8}$/.test(key)) key = key.slice(0, 7);
    if (!/^#[0-9a-f]{6}$/.test(key)) return color;
    return KR_NAME_COLOR_MAP[key] || color;
}
