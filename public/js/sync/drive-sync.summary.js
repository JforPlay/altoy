/**
 * drive-sync.summary.js
 * Per-key summary functions for the Drive sync conflict modal.
 * Takes raw localStorage string values and produces short "N items" labels
 * to show which side has more data in a conflict state.
 */

/**
 * Summarize synced data for the conflict modal.
 * Each function takes the raw localStorage string value and returns a short
 * human-readable count. Return empty string to omit from the summary.
 */

function tryParse(raw) {
    try { return JSON.parse(raw); }
    catch { return null; }
}

function countTrackerProgress(raw) {
    const obj = tryParse(raw);
    if (!obj || typeof obj !== 'object') return '';
    // Bit 0 (value & 1) = ship obtained; only count ships the user has marked
    const count = Object.values(obj).filter(v => (v & 1) === 1).length;
    return count > 0 ? `함순이 ${count}명 트래킹` : '';
}

function countCollection(raw) {
    const obj = tryParse(raw);
    if (!obj) return '';
    const items = Array.isArray(obj) ? obj : (obj.items || []);
    return items.length > 0 ? `스킨 ${items.length}개 수집` : '';
}

function countPlannerPlan(raw) {
    const obj = tryParse(raw);
    if (!obj || typeof obj !== 'object') return '';
    const n = Object.keys(obj).length;
    return n > 0 ? `아일랜드 계획 ${n}개` : '';
}

function countFleetSim(raw) {
    const obj = tryParse(raw);
    if (!obj) return '';
    const saves = Array.isArray(obj) ? obj : (obj.saves || []);
    return saves.length > 0 ? `함대 저장 ${saves.length}개` : '';
}

function countTechCompletion(raw) {
    const arr = tryParse(raw);
    if (!Array.isArray(arr)) return '';
    return arr.length > 0 ? `기술 ${arr.length}개 완료` : '';
}

const SUMMARIZERS = {
    shipgirlTrackerProgress: countTrackerProgress,
    skinCollection: countCollection,
    'island-restaurant-planner-plan-v2': countPlannerPlan,
    fleetSimSaves: countFleetSim,
    'island-tech-completion': countTechCompletion,
};

/**
 * Summarize a map of { key -> rawValue } into a list of short labels.
 * @param {Object<string, string>} dataMap - localStorage-style key → raw string
 * @returns {string[]} Array of human-readable lines; omits empty summaries
 */
export function summarize(dataMap) {
    const lines = [];
    for (const [key, rawValue] of Object.entries(dataMap || {})) {
        const fn = SUMMARIZERS[key];
        if (!fn) continue;
        const label = fn(rawValue);
        if (label) lines.push(label);
    }
    return lines;
}
