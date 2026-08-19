/**
 * drive-sync.summary.js
 * Per-key summary functions for the Drive sync conflict modal.
 * Takes raw localStorage string values and produces short "N items" labels
 * to show which side has more data in a conflict state.
 *
 * Keep SUMMARIZERS in sync with utils.js SYNCED_KEYS — every synced key
 * should have (or explicitly skip) a summary so the conflict modal doesn't
 * render "(요약 가능한 데이터 없음)" for cases we could describe.
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

function countInvestment(raw) {
    const obj = tryParse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
    // v1 envelope {v, d} — or a bare gid->record map (legacy/degraded payload)
    const d = obj.d && typeof obj.d === 'object' && !Array.isArray(obj.d) ? obj.d : obj;
    const count = Object.keys(d).length;
    return count > 0 ? `함순이 ${count}명 육성 기록` : '';
}

function describeGoal(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return `목표 함순이: ${raw}`;
}

function countPinned(raw) {
    const arr = tryParse(raw);
    if (!Array.isArray(arr)) return '';
    return arr.length > 0 ? `고정 ${arr.length}개` : '';
}

function countSecretaryCompletion(raw) {
    const obj = tryParse(raw);
    if (!obj || typeof obj !== 'object') return '';
    const count = Object.values(obj).filter(Boolean).length;
    return count > 0 ? `비서함 스토리 ${count}개 완료` : '';
}

function countCollection(raw) {
    const obj = tryParse(raw);
    if (!obj) return '';
    const items = Array.isArray(obj) ? obj : (obj.items || []);
    return items.length > 0 ? `스킨 ${items.length}개 수집` : '';
}

function describeRestaurantRank(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return `레스토랑 랭크: ${raw}`;
}

function countRestaurantEvents(raw) {
    const arr = tryParse(raw);
    if (!Array.isArray(arr)) return '';
    return arr.length > 0 ? `진행 중 이벤트 ${arr.length}개` : '';
}

function countPlannerPlan(raw) {
    const obj = tryParse(raw);
    if (!obj || typeof obj !== 'object') return '';
    const n = Object.keys(obj).length;
    return n > 0 ? `아일랜드 계획 ${n}개` : '';
}

function countPlannerPresets(raw) {
    const obj = tryParse(raw);
    if (!obj || typeof obj !== 'object') return '';
    const n = Object.keys(obj).length;
    return n > 0 ? `프리셋 ${n}개` : '';
}

function countSeasonQuantities(raw) {
    const obj = tryParse(raw);
    if (!obj || typeof obj !== 'object') return '';
    const n = Object.keys(obj).length;
    return n > 0 ? `시즌 수량 ${n}개 입력` : '';
}

function describeSeasonPoints(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return '';
    return `시즌 포인트: ${n.toLocaleString('ko-KR')}`;
}

function countTechCompletion(raw) {
    const arr = tryParse(raw);
    if (!Array.isArray(arr)) return '';
    return arr.length > 0 ? `기술 ${arr.length}개 완료` : '';
}

function countFleetSim(raw) {
    const obj = tryParse(raw);
    if (!obj) return '';
    // three known shapes: legacy bare array, {v:1, d:[...]} envelope, {saves:[...]}
    const saves = Array.isArray(obj) ? obj
        : Array.isArray(obj.d) ? obj.d
        : (obj.saves || []);
    return saves.length > 0 ? `함대 저장 ${saves.length}개` : '';
}

// Restaurant shipgirl selections are single attribute configurations — having
// them set doesn't carry a meaningful count. Silently skip rather than
// printing "설정됨" noise for the conflict modal.
const SUMMARIZERS = {
    shipgirlTrackerProgress: countTrackerProgress,
    shipgirlTrackerSelectedGoal: describeGoal,
    researchTrackerPinned: countPinned,
    shipgirlInvestment: countInvestment,
    secretaryStoryCompletion: countSecretaryCompletion,
    skinCollection: countCollection,
    'island-restaurant-rank': describeRestaurantRank,
    'island-restaurant-events': countRestaurantEvents,
    'island-restaurant-planner-plan-v2': countPlannerPlan,
    'island-restaurant-planner-presets-v2': countPlannerPresets,
    'island-season-quantities': countSeasonQuantities,
    'island-season-owned-points': describeSeasonPoints,
    'island-tech-completion': countTechCompletion,
    fleetSimSaves: countFleetSim,
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
