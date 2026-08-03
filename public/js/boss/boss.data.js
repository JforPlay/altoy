/**
 * boss.data.js
 * Loading + lookup for /map/boss-viewer.
 *
 * One 37 KB-gzipped file covers all 379 identities and 1420 appearances, so there
 * is no lazy or split path — the page loads it once up front. State is shared via
 * setup(stateRef) from boss.viewer.js; this module owns no globals.
 */
import { fetchJSONWithCache } from '../utils.js';

let state;

/** Receive shared state from boss.viewer.js. */
export function setup(stateRef) {
    state = stateRef;
}

/**
 * Loader for loadPageData — must THROW on failure so the standardized retry UI
 * takes over. Don't pre-catch inside it.
 */
export async function loadBossData() {
    const data = await fetchJSONWithCache('data/boss/boss_data.json', { maxAge: 86400000 });
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('boss_data.json is empty or malformed');
    }
    state.data = data;
    state.list = Object.entries(data).map(([icon, rec]) => ({ icon, ...rec }));
    return data;
}

/** One identity by its icon key, or null. */
export function getIdentity(icon) {
    if (!state.data || !icon) return null;
    const rec = state.data[icon];
    return rec ? { icon, ...rec } : null;
}

/**
 * All identities as an array, each carrying its own `icon` key. Built once in
 * loadBossData — callers filter this, so identity object references stay stable
 * and can be compared with `includes`.
 */
export function getAllIdentities() {
    return state.list || [];
}

/** The set of `src` values actually present, so the UI only offers real chips. */
export function getPresentSources() {
    const seen = new Set();
    for (const b of getAllIdentities()) {
        for (const a of b.app) seen.add(a.src);
    }
    return seen;
}
