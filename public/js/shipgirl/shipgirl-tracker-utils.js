/**
 * shipgirl-tracker-utils.js
 * Utility helpers for shipgirl-tracker.js: checkbox parsing, search dropdown,
 * and tracker item DOM creation. Exported as a single namespace object.
 */

const ShipgirlTrackerUtils = {
    /**
     * Utility function to parse integer from dataset.
     * @param {string} value - Value to parse.
     * @param {number} defaultValue - Default value if parsing fails.
     * @returns {number} Parsed integer or default.
     */
    parseDatasetInt(value, defaultValue = 0) {
        const parsed = parseInt(value, 10);
        return isNaN(parsed) ? defaultValue : parsed;
    },

    /**
     * Validate and normalize a tracker progress payload from `syncedStorage`.
     * Defines the cross-tab sync contract shared by shipgirl-tracker and research-tracker:
     * a plain object whose values are integers in the 3-bit checkbox-mask range [0, 7].
     * Any malformed entry is silently dropped so a bad write in one tab can't poison the other.
     * @param {unknown} value - The post-JSON.parse value handed in by syncedStorage (or null).
     * @returns {Object<string, number>} Cleaned shipId → state map.
     */
    parseProgress(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

        const cleaned = {};
        for (const [shipId, state] of Object.entries(value)) {
            const numericState = Number(state);
            if (Number.isInteger(numericState) && numericState >= 0 && numericState <= 7) {
                cleaned[shipId] = numericState;
            }
        }
        return cleaned;
    }
};

export { ShipgirlTrackerUtils };
