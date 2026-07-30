/**
 * expression-manifest.js
 * Shared lazy loader for data/skin/expression_manifest.json (~1MB: skinId →
 * face/box metadata for compositing expressions onto extracted paintings).
 * Never load this at page boot — consumers fetch it on first use (story
 * playback, skin selection, lightbox open). Sibling of expression-face.js /
 * expression-composite.js, which stay pure; the network side lives here.
 */
import { fetchJSONWithCache } from './utils.js';

let manifestPromise = null;
let forceRefresh = false;

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
