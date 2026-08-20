/**
 * tracker-investment.js
 * Pure state/math layer for the shipgirl-tracker investment features:
 * 성정 유닛 level-cap costs, per-ship investment record validation, and the
 * coupling rules between the legacy 3-bit progress mask (get=1, level=2,
 * upgrade=4 — FROZEN contract shared with research-tracker/fleet-sim) and
 * the new cap state. No DOM, no storage — node-tested.
 */

export const AFF_LABELS = ['호감작', '100 예정', '100 완료', '200 예정', '200 완료'];
export const SKL_LABELS = ['스작', '스작 예정', '스작 중', '스작 완료'];
export const MEMO_MAX = 500;

// 성정 유닛(u1, item 15008) / 유닛II(u2, item 15012) per break, by rarity.
// Source: AzurLaneLuaScripts KR sharecfg/ship_level.lua need_item_rarity2..6
// (rarity codes 2..6 = N/R/SR/SSR/UR); breaks at Lv100/105/110/115/120.
// Gold cost (~10x u1) intentionally not tracked.
const BREAK_COSTS = {
    N:   [{ u1: 60 },  { u1: 120 }, { u1: 180 }, { u1: 300 },  { u1: 80,  u2: 40 }],
    R:   [{ u1: 80 },  { u1: 160 }, { u1: 240 }, { u1: 400 },  { u1: 120, u2: 60 }],
    SR:  [{ u1: 120 }, { u1: 240 }, { u1: 360 }, { u1: 600 },  { u1: 200, u2: 100 }],
    SSR: [{ u1: 200 }, { u1: 400 }, { u1: 600 }, { u1: 1000 }, { u1: 300, u2: 150 }],
    UR:  [{ u1: 300 }, { u1: 600 }, { u1: 900 }, { u1: 1500 }, { u1: 450, u2: 225 }],
};
export const BREAK_LEVELS = [105, 110, 115, 120, 125];

function clampInt(v, min, max) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min) return null;
    return Math.min(n, max);
}

/**
 * Validate an untrusted investment payload (post-JSON, post-envelope).
 * Mirrors the parseProgress contract: never throws, silently drops or clamps
 * malformed entries so a bad write in one tab can't poison another.
 */
export function parseInvestment(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const cleaned = {};
    for (const [gid, rec] of Object.entries(value)) {
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
        const out = {};
        const cap = clampInt(rec.cap, 1, 5);
        const ret = clampInt(rec.ret, 1, 1);
        const fav = clampInt(rec.fav, 1, 1);
        const aff = clampInt(rec.aff, 1, AFF_LABELS.length - 1);
        const skl = clampInt(rec.skl, 1, SKL_LABELS.length - 1);
        if (cap !== null) out.cap = cap;
        if (ret !== null) out.ret = ret;
        if (fav !== null) out.fav = fav;
        if (aff !== null) out.aff = aff;
        if (skl !== null) out.skl = skl;
        if (typeof rec.memo === 'string' && rec.memo.length > 0) {
            out.memo = rec.memo.slice(0, MEMO_MAX);
        }
        if (Object.keys(out).length > 0) cleaned[gid] = out;
    }
    return cleaned;
}

/** Total units spent to reach `cap` breaks at the given rarity, or null. */
export function investedCost(cap, rarity) {
    const table = BREAK_COSTS[rarity];
    if (!table) return null;
    let u1 = 0, u2 = 0;
    for (let i = 0; i < Math.min(cap, 5); i++) {
        u1 += table[i].u1;
        u2 += table[i].u2 || 0;
    }
    return { u1, u2 };
}

/** Cost of the NEXT break from `cap`, or null when maxed / rarity unknown. */
export function nextBreakCost(cap, rarity) {
    const table = BREAK_COSTS[rarity];
    if (!table || cap >= 5) return null;
    const step = table[cap];
    return { level: BREAK_LEVELS[cap], u1: step.u1, u2: step.u2 || 0 };
}

/** Sum invested units over an investment map. Gids with unknown rarity are skipped. */
export function sumInvestment(investment, rarityByGid) {
    let u1 = 0, u2 = 0;
    for (const [gid, rec] of Object.entries(investment)) {
        const cost = investedCost(rec.cap || 0, rarityByGid[gid]);
        if (!cost) continue;
        u1 += cost.u1;
        u2 += cost.u2;
    }
    return { u1, u2 };
}

/** Units needed to take every known-rarity ship in the roster to Lv125. */
export function rosterTotal(rarityByGid) {
    let u1 = 0, u2 = 0;
    for (const rarity of Object.values(rarityByGid)) {
        const cost = investedCost(5, rarity);
        if (!cost) continue;
        u1 += cost.u1;
        u2 += cost.u2;
    }
    return { u1, u2 };
}

/** Coupling after the cap changed: breaks require MLB (풀돌+보유); cap<4 can't claim 120 달성. */
export function applyCapChange(mask, newCap) {
    let m = mask;
    if (newCap >= 1) m |= 5;       // get + upgrade
    if (newCap < 4) m &= ~2;       // level off
    return { mask: m, cap: newCap };
}

/**
 * Coupling after a progress checkbox changed. `mask` already reflects the change
 * (and handleCheckboxLogic's existing get-cascade). Rules:
 * - 120 달성 checked -> cap at least 4, MLB forced.
 * - 풀돌 or 보유 cleared -> no breaks possible -> cap 0 (which clears 120 달성).
 */
export function applyMaskChange(mask, cap, changedType, nowChecked) {
    let m = mask, c = cap;
    if (changedType === 'level' && nowChecked) {
        c = Math.max(c, 4);
        m |= 5;
    }
    if ((changedType === 'upgrade' || changedType === 'get') && !nowChecked) {
        c = 0;
    }
    if (c < 4) m &= ~2;
    return { mask: m, cap: c };
}
