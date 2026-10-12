/**
 * expression-manifest.js
 * Shared lazy loader for data/skin/expression_manifest.json (~1MB: skinId →
 * face/box metadata for compositing expressions onto extracted paintings).
 * Never load this at page boot — consumers fetch it on first use (story
 * playback, skin selection, lightbox open). Sibling of expression-face.js /
 * expression-composite.js, which stay pure; the network side lives here.
 * Also loads its 검열판 sibling (ensureHxManifest) from data_for_toy_misc.
 */
import { fetchJSONWithCache, DATA_FOR_TOY_MISC_BASE } from './utils.js';

let manifestPromise = null;
let forceRefresh = false;
let hxPromise = null;

/**
 * Fetch the 검열판 manifest once per page: `{ key: {} | face entry }` for the CN
 * client's `_hx` paintings, keyed like the expression manifest (`<id>` / `<id>_n`).
 * An empty entry borrows the base painting's faces; a full one has its own patches.
 * It lives in data_for_toy_misc BESIDE its PNGs, so an entry can never be published
 * ahead of its file. Optional by nature: a failure resolves null (no toggle) and the
 * next call retries.
 *
 * @returns {Promise<Object|null>}
 */
export function ensureHxManifest() {
    hxPromise ??= fetchJSONWithCache(`${DATA_FOR_TOY_MISC_BASE}/hx/manifest.json`)
        .catch((error) => {
            console.warn('검열판 manifest missing', error);
            hxPromise = null;
            return null;
        });
    return hxPromise;
}

/**
 * Fetch the expression manifest once per page. Concurrent callers share one
 * request and a success is cached for the page lifetime. A failed or malformed
 * response resolves null (callers degrade to non-expression rendering), clears
 * the promise, and the next call retries while bypassing the IndexedDB entry.
 *
 * @returns {Promise<Object|null>} manifest, or null when unavailable
 */
export function ensureExpressionManifest() {
    if (!manifestPromise) {
        const promise = fetchJSONWithCache(
            'data/skin/expression_manifest.json',
            { forceRefresh }
        )
            .then((manifest) => {
                if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
                    || Object.keys(manifest).length === 0) {
                    throw new TypeError('Expression manifest must be a non-empty object');
                }
                forceRefresh = false;
                return manifest;
            })
            .catch((error) => {
                console.warn('Expression manifest missing', error);
                forceRefresh = true;
                if (manifestPromise === promise) {
                    manifestPromise = null;
                }
                return null;
            });
        manifestPromise = promise;
    }
    return manifestPromise;
}
