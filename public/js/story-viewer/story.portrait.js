/**
 * story.portrait.js
 * The dialogue box's own image slot (dialoguestoryplayer.lua UpdatePortrait):
 * a static `StoryIcon/<name>` bust named by the step's `portrait` field —
 * independent of the stage painting, with the face baked in (no expressions).
 * The pipeline normalizes `portrait` to the lowercase bundle name; numeric
 * values (an un-normalized skin id) resolve to null rather than guessing.
 */

/** dialoguestep.lua:123 — these two sit small at the box's left, not as a bust. */
export const MINI_PORTRAITS = new Set(['zhihuiguan', 'tongxunqi']);

/**
 * @param {object|null|undefined} line - script step
 * @param {string} baseUrl - data_for_toy base ending in '/'
 * @returns {{name:string, url:string, mini:boolean, noise:boolean}|null}
 */
export function resolveStoryPortrait(line, baseUrl) {
    const raw = line?.portrait;
    if (typeof raw !== 'string') return null;
    const name = raw.trim().toLowerCase();
    if (!name) return null;
    return {
        name,
        url: `${baseUrl}storyicon/${name}.webp`,
        mini: MINI_PORTRAITS.has(name),
        noise: line.portraitNoise === true,
    };
}
