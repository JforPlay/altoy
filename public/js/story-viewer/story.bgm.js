/**
 * story.bgm.js
 * Audio cue → URL resolution for the story viewer (BGM tracks + one-shot SFX).
 *
 * Story scripts reference audio by asset-bundle cue name (`bgm` /
 * `soundeffect` fields). Self-hosted audio (JforPlay/audio_for_toy) stores
 * each bundle as `<category>/<cue>/<original-bundle-filename>.opus`, so a cue
 * cannot be turned into a URL by naming convention alone. `bgm_map.json`
 * (built by altoy_process/build_story_bgm_map.py from audio_for_toy's
 * audio_manifest.json) supplies the cue → repo-relative-path mapping for
 * every extracted bgm/sfx bundle.
 *
 * Cue handling:
 * - Lookups are lowercased — game data casing is unreliable (`Battle-1`,
 *   `battle-AF`, `airRaidAlarm`) while extracted bundle names are lowercase.
 * - `event:/...` soundeffect values are FMOD event paths, not audio bundles.
 *   They are not extracted (and were never resolvable under the legacy
 *   `<host>/<cue>.ogg` convention either) — they resolve to null.
 */
import { fetchJSONWithCache } from '../utils.js';

const AUDIO_FOR_TOY_BASE = 'https://raw.githubusercontent.com/JforPlay/audio_for_toy/main/';

let cueMapPromise = null;

function loadCueMap() {
    if (!cueMapPromise) {
        cueMapPromise = fetchJSONWithCache('data/story-viewer/bgm_map.json')
            .catch(e => {
                console.warn('bgm_map.json unavailable — story audio disabled.', e);
                return {};
            });
    }
    return cueMapPromise;
}

/**
 * Pure cue → URL resolution against a loaded map (exported for tests).
 * Returns the full audio URL, or null when the cue is unplayable (empty,
 * FMOD event path, or not in the map).
 */
export function cueToUrl(map, cue) {
    if (!cue || typeof cue !== 'string') return null;
    const key = cue.trim().toLowerCase();
    if (!key || key.startsWith('event:/')) return null;
    const path = map ? map[key] : null;
    if (!path) return null;
    // Per-segment encoding: extracted filenames keep the original (often CJK)
    // bundle-internal names, and may contain characters encodeURI leaves raw.
    return AUDIO_FOR_TOY_BASE + path.split('/').map(encodeURIComponent).join('/');
}

/** Resolve an audio cue to a playable URL, or null when unavailable. */
export async function resolveAudioCueUrl(cue) {
    return cueToUrl(await loadCueMap(), cue);
}
