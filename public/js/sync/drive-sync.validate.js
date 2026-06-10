/**
 * drive-sync.validate.js
 * Per-key shape validation for synced values arriving from outside the app —
 * Drive downloads and file imports (applyRemoteData in drive-sync.engine.js).
 * Imported values land in localStorage and are later JSON.parsed by their
 * consumer pages, so reject values whose root shape can't be what the
 * consumer writes.
 *
 * Checks are shallow on purpose — root type + size only — so consumer-side
 * schema evolution (e.g. migrating a key to the syncedStorage `{v, d}`
 * envelope, whose root is still an object) doesn't invalidate older exports.
 *
 * Keep VALUE_KINDS in sync with utils.js SYNCED_KEYS — an infra test fails
 * when a synced key has no entry here. A key missing at RUNTIME is accepted
 * (size-capped only) so an out-of-date validator never drops user data.
 */

// localStorage quota is ~5 MB total; the largest legitimate value
// (fleetSimSaves) is tens of KB. Caps a malicious file's quota damage.
export const MAX_VALUE_BYTES = 1024 * 1024;

function tryParse(raw) {
    try { return JSON.parse(raw); }
    catch { return undefined; }
}

/**
 * Expected root shape per synced key:
 * - 'object'          JSON whose root is a non-array object
 * - 'array'           JSON whose root is an array
 * - 'object-or-array' either (keys like skinCollection accept both forms)
 * - 'json'            any valid JSON (inner shape unknown/consumer-owned)
 * - 'string'          plain string stored raw, not JSON (size cap only)
 * - 'number-string'   numeric string, e.g. '12345'
 */
export const VALUE_KINDS = {
    shipgirlTrackerProgress: 'object',
    shipgirlTrackerSelectedGoal: 'string',
    researchTrackerPinned: 'array',
    secretaryStoryCompletion: 'object',
    skinCollection: 'object-or-array',
    'island-restaurant-rank': 'string',
    'island-restaurant-events': 'array',
    'island-restaurant-shipgirl1': 'json',
    'island-restaurant-shipgirl2': 'json',
    'island-restaurant-planner-plan-v2': 'object',
    'island-restaurant-planner-presets-v2': 'object',
    'island-season-quantities': 'object',
    'island-season-owned-points': 'number-string',
    'island-tech-completion': 'array',
    fleetSimSaves: 'object-or-array',
    'bgm-misc-player': 'object',
};

/**
 * Validate one imported key/value pair against its expected shape.
 * @param {string} key - Synced localStorage key
 * @param {string} value - Raw string value from the imported payload
 * @returns {boolean} True if the value is safe to write to localStorage
 */
export function validateSyncedValue(key, value) {
    if (typeof value !== 'string') return false;
    // String length under-counts multi-byte UTF-8, but as a quota cap the
    // 1 MB order of magnitude is what matters — not byte exactness.
    if (value.length > MAX_VALUE_BYTES) return false;

    const kind = VALUE_KINDS[key];
    if (!kind) return true;

    switch (kind) {
        case 'string':
            return true;
        case 'number-string':
            return value.trim() !== '' && Number.isFinite(Number(value));
        case 'json':
            return tryParse(value) !== undefined;
        case 'array':
            return Array.isArray(tryParse(value));
        case 'object': {
            const parsed = tryParse(value);
            return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
        }
        case 'object-or-array': {
            const parsed = tryParse(value);
            return typeof parsed === 'object' && parsed !== null;
        }
        default:
            return false;
    }
}
