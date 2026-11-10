/**
 * ship-acquisition.js
 * A ship's actual acquisition routes, shared by research-tracker (source groups)
 * and shipgirl-info (실제 드랍 정보). DOM-free so node tests cover it.
 *
 * The game's `description` is the acquisition TOOLTIP, frozen at a ship's debut:
 * it names one stage, misses 상시편입 build-pool additions and keeps event text.
 * So drops and builds come from generated data instead:
 *   상시 건조  — light/heavy/special flags (ship_info_*.json)
 *   해역 드랍  — `maps` (chapter-indexed main-story stages)
 *   작전문서   — archive_drop_index.json
 *   상점 / 기타 — `acquire`, MrLar's numeric source codes (EN-server lineups;
 *                 the WSL adapter swaps the known KR differences, 아야나미/Z23).
 *                 User-verified against KR 2026-11-10: where MrLar and the tooltip
 *                 disagree, MrLar is right (e.g. 플레처 is not in 대함대 상점).
 * The tooltip text is only the fallback for data generated before `acquire` existed.
 */

// Tooltip entries that are NOT map/archive drops but still grant the ship permanently.
const NON_DROP_PERMANENT_PATTERNS = [
    /^소형함 건조/,
    /^중형함 건조/,
    /^대형함 건조/,
    /^특형함 건조/,
    /^훈장/,
    /^코어/,
    /^군수 상점/,
    /^원형 상점/,
    /^함대 상점/,
    /^연습 상점/,
    /^지원 신청/,
    /^특별 ?보급/,
    /^상설 UR/,
    /^UR Exchange/,
    /^상점의 대함대/,
    /^주간 임무/,
    /^도감 업적/,
    /^출석 스탬프/,
    /^히든 임무/,
    /^연구 ?도크/,
];

const SHOP_PATTERNS = [
    /^원형 상점 교환/,
    /^군수 상점 교환/,
    /^상점의 대함대 보급에서 획득/,
    /^코어 상점/,
    /^코어 교환/,
    /^특별 ?보급/,
    /^함대 상점 교환/,
    /^훈장 상점 교환/,
    /^훈장 교환/,
];

// Tooltip prefix → shop name. More specific first; every SHOP_PATTERNS entry must
// resolve here. Rollups: 군수 상점 + 특별 보급 → 연습전 상점 (both spend 공훈치);
// 함대 상점 + 대함대 보급 → 대함대 상점 (one guild storefront).
const SHOP_LABEL_RULES = [
    { pattern: /^원형 상점/, label: '원형 상점' },
    { pattern: /^군수 상점/, label: '연습전 상점' },
    { pattern: /^코어/, label: '코어 상점' },
    { pattern: /^함대 상점/, label: '대함대 상점' },
    { pattern: /^훈장 상점/, label: '훈장 상점' },
    { pattern: /^훈장 교환/, label: '훈장 상점' },
    { pattern: /^상점의 대함대/, label: '대함대 상점' },
    { pattern: /^특별 ?보급/, label: '연습전 상점' },
];

// Guards isOtherRoute only: the 상시 건조 pool itself comes from the flags.
const isBuildText = d => /건조/.test(d) && !/한정/.test(d) && !/이벤트/.test(d) && !/기간/.test(d);

const isShopRoute = d => SHOP_PATTERNS.some(p => p.test(d));

const isOtherRoute = d => !isBuildText(d) && !isShopRoute(d)
    && NON_DROP_PERMANENT_PATTERNS.some(p => p.test(d));

/** Distinct shop names named by a tooltip list, in tooltip order. */
function shopLabels(description) {
    const labels = new Set();
    for (const d of description || []) {
        const rule = SHOP_LABEL_RULES.find(r => r.pattern.test(d));
        if (rule) labels.add(rule.label);
    }
    return [...labels];
}

/** `maps` (index = chapter - 1) → ['2-1', '3-4', …]. */
export function mapStages(maps) {
    if (!Array.isArray(maps)) return [];
    return maps.flatMap((area, i) => (Array.isArray(area) ? area.map(d => `${i + 1}-${d.map}`) : []));
}

/** '1-4, 3-2, 5-1 +N' — the first `max` stages, then the remainder count. */
export function stageLabel(stages, max) {
    return stages.length <= max
        ? stages.join(', ')
        : `${stages.slice(0, max).join(', ')} +${stages.length - max}`;
}

const ARCHIVE_DROP_INDEX_VERSION = 1;

/** The `{gid: label}` entries of archive_drop_index.json, or null for a missing / unknown-schema file. */
export function archiveDropEntries(index) {
    const entries = index?.version === ARCHIVE_DROP_INDEX_VERSION ? index.entries : null;
    return entries && typeof entries === 'object' && !Array.isArray(entries) ? entries : null;
}

const BUILD_POOLS = [['light', '소형'], ['heavy', '중형'], ['special', '특형']];
const MAX_STAGES_SHOWN = 6;

// MrLar `other` codes → KR names, taken from the KR client text where the name is
// not the tooltip's own (gametip: 월드 투어 = battlepass, 훈장 지원 =
// honor_medal_support, 비콘·META / 파일 비콘 = world_boss / its archives).
// 11 (Cruise Pass) and 13 (META Showdown) are left out on purpose: MrLar's notes tie
// each to one past season / rotation, so they are events, like `limited` banners.
// Their standing follow-ups, 12 META 상점 and 14 파일 비콘, stay.
// An unknown future code renders nothing.
const SHOP_CODES = { 0: '대함대 상점', 1: '훈장 상점', 2: '코어 상점', 3: '연습전 상점', 5: '원형 상점', 12: 'META 상점' };
const OTHER_CODES = {
    4: '훈장 지원', 6: '상설 UR 교환', 7: '주간 임무', 8: '출석 스탬프', 9: '귀환 지휘관 보상',
    10: '도감 업적', 14: '파일 비콘', 15: '연구 도크', 16: '임무 보상',
};

const sourceCodes = ship => (Array.isArray(ship.acquire) ? ship.acquire : null);
const named = (codes, table) => [...new Set(codes.map(c => table[c]).filter(Boolean))];

/** Shop names for one ship: its `acquire` codes, else its tooltip. */
export function shopRoutes(ship) {
    const codes = sourceCodes(ship);
    return codes ? named(codes, SHOP_CODES) : shopLabels(ship.description);
}

/** 기타 sources for one ship: its `acquire` codes, else its tooltip lines. */
export function otherRoutes(ship) {
    const codes = sourceCodes(ship);
    return codes ? named(codes, OTHER_CODES) : (ship.description || []).filter(isOtherRoute);
}

/**
 * The 실제 드랍 정보 rows for one ship: [{ kind, label, text }]. Empty means no
 * permanent route — the ship is event-only.
 */
export function acquisitionRoutes(ship, archiveLabel) {
    const routes = [];
    const pools = BUILD_POOLS.filter(([key]) => ship[key]).map(([, name]) => name);
    if (pools.length) routes.push({ kind: 'build', label: '상시 건조', text: pools.join(' · ') });

    const stages = mapStages(ship.maps);
    if (stages.length) routes.push({ kind: 'map', label: '해역 드랍', text: stageLabel(stages, MAX_STAGES_SHOWN) });

    if (archiveLabel) routes.push({ kind: 'archive', label: '작전문서', text: archiveLabel });

    const shops = shopRoutes(ship);
    if (shops.length) routes.push({ kind: 'shop', label: '상점 교환', text: shops.join(', ') });

    const other = otherRoutes(ship);
    if (other.length) routes.push({ kind: 'other', label: '기타', text: other.join(', ') });
    return routes;
}
