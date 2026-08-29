/**
 * tracker-investment.js
 * Pure state/math layer for the shipgirl-tracker investment features:
 * 성정 유닛 level-cap costs, per-ship investment record validation, and the
 * coupling rules between the legacy 3-bit progress mask (get=1, level=2,
 * upgrade=4 — FROZEN contract shared with research-tracker/fleet-sim) and
 * the new cap state. No DOM, no storage — node-tested.
 */

// Display labels for the aff/skl ladders. Index IS the stored value, so the
// strings are display-only — re-wording them never migrates data.
//
// The wording deliberately matches the user's Google Sheet vocabulary so the
// sheet codec needs no translation layer, and so these can be the single source
// for BOTH the chips and the filter drawer's option lists (which previously
// hardcoded the sheet wording and drifted from the chips: 스작 진행중 vs 스작 중).
// The codec still keeps its own copy — see tracker-sheet-codec.js.
export const AFF_LABELS = ['호감작 안함', '100 예정', '100 완료', '200 예정', '200 완료'];
export const SKL_LABELS = ['스작 안함', '스작 예정', '스작 진행중', '스작 완료'];
export const MEMO_MAX = 500;

const GET = 1, LEVEL = 2, UPGRADE = 4;

/**
 * The one progress ladder, as (mask, cap) pairs. It measures the LEVEL axis
 * only — 풀돌 is deliberately not a rung.
 *
 * 성정 유닛 is what buys Lv100→125 and every ship pays it, so `LEVEL bit ⟺
 * cap >= 4` is a real identity and stays welded. 한계돌파 is not: META / UR /
 * research PR/DR ships reach Lv100 without it, so a 풀돌-less Lv120 is a
 * legitimate state and 풀돌 rides beside this table as an independent bit.
 *
 * The sheet codec still IMPORTS this rather than declaring its own copy — its
 * five values are (rung × 풀돌) pairs composed over these four (SHEET_STATES in
 * tracker-sheet-codec.js). They silently disagreed once already (importing
 * `120` set the Lv120 bit; clicking the 120 cap stop did not). Keep one table.
 */
export const PROGRESS_RUNGS = [
    { mask: 0, cap: 0 },                // 미획득
    { mask: GET, cap: 0 },              // 보유
    { mask: GET | LEVEL, cap: 4 },      // Lv120
    { mask: GET | LEVEL, cap: 5 },      // Lv125
];

// Site wording for the rungs above — deliberately NOT the sheet's vocabulary
// (the site says 보유 where the sheet says 획득), which is why the codec keeps
// its own display strings while sharing the state table.
export const RUNG_LABELS = ['미획득', '보유', 'Lv120', 'Lv125'];

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

/**
 * Sum invested units over an investment map. Gids with unknown rarity are skipped.
 * `capLimit` counts each ship's spend only up to that break (4 = the Lv120 basis
 * the summary bar reports against), so the pair stays a true 0..100% progress.
 */
export function sumInvestment(investment, rarityByGid, capLimit = 5) {
    let u1 = 0, u2 = 0;
    for (const [gid, rec] of Object.entries(investment)) {
        const cost = investedCost(Math.min(rec.cap || 0, capLimit), rarityByGid[gid]);
        if (!cost) continue;
        u1 += cost.u1;
        u2 += cost.u2;
    }
    return { u1, u2 };
}

/** Units needed to take every known-rarity ship in the roster to `capLimit` breaks (5 = Lv125). */
export function rosterTotal(rarityByGid, capLimit = 5) {
    let u1 = 0, u2 = 0;
    for (const rarity of Object.values(rarityByGid)) {
        const cost = investedCost(capLimit, rarity);
        if (!cost) continue;
        u1 += cost.u1;
        u2 += cost.u2;
    }
    return { u1, u2 };
}

/**
 * Coupling after the cap changed. The 120 cap and the Lv120 달성 bit are the
 * same fact, so they move together in both directions. 풀돌 only ever gets
 * ADDED — reaching Lv120 implies it for the ~778 ordinary ships, and a user who
 * cleared it on a META/UR/PR ship must not have it put back by an unrelated
 * cap edit.
 */
export function applyCapChange(mask, newCap) {
    let m = mask;
    if (newCap >= 1) m |= GET;
    if (newCap >= 4) m |= GET | UPGRADE | LEVEL;
    else m &= ~LEVEL;
    return { mask: m, cap: newCap };
}

/**
 * Which rung a ship sits on, tolerant of off-ladder state. 풀돌 buys no rung —
 * it is off this ladder — so a 풀돌-only record still reads 보유.
 *
 * The Lv120 weld is read from EITHER side so a record missing one half still
 * lands on its rung: research-tracker.js writes the level bit but never a cap,
 * and legacy imports can carry a cap with no bit. A cap of 1-3 (Lv105/110/115)
 * has been unsettable since the 육성 레벨 bar narrowed to 120/125 — it buys no
 * rung and normalises on the next step.
 */
export function progressRung(mask, cap) {
    const c = cap || 0;
    if (c >= 5) return 3;
    if (c >= 4 || (mask & LEVEL)) return 2;
    if (mask & GET) return 1;
    return 0;
}

/**
 * One step along PROGRESS_RUNGS, clamped at both ends. Returns the canonical
 * state for the landing rung, so stepping is also what normalises an
 * off-ladder record. `rung` is returned so callers can detect a no-op at the
 * ends without recomputing.
 *
 * 풀돌 is off this ladder, so it rides every step untouched — trampling a
 * deliberately un-풀돌'd META/UR/PR ship is exactly what the wall's sweep
 * gesture must not do. Two exceptions: 미획득 clears it (an unowned ship cannot
 * be 풀돌), and stepping UP into Lv120 from below applies the same forward rule
 * the Lv120 checkbox does.
 */
export function stepRung(mask, cap, dir) {
    const from = progressRung(mask, cap);
    const rung = Math.min(
        PROGRESS_RUNGS.length - 1,
        Math.max(0, from + (dir > 0 ? 1 : -1)));
    let upgrade = mask & UPGRADE;
    if (rung === 0) upgrade = 0;
    else if (rung >= 2 && from < 2) upgrade = UPGRADE;
    return { mask: PROGRESS_RUNGS[rung].mask | upgrade, cap: PROGRESS_RUNGS[rung].cap, rung };
}

/**
 * Coupling after a progress checkbox changed. `mask` already reflects the change
 * (and handleCheckboxLogic's existing get-cascade). Rules:
 * - Lv120 checked   -> cap at least 4, 보유+풀돌 forced (the forward rule: true
 *                      for the ~778 ordinary ships, and the exceptions uncheck
 *                      풀돌 afterwards, which now sticks).
 * - Lv120 unchecked -> the 유닛 breaks that bought it go with it.
 * - 보유 unchecked   -> no breaks possible -> cap 0.
 *
 * 풀돌 unchecked touches NOTHING else. That is the whole point: it is not a
 * prerequisite for Lv120 on META / UR / research PR/DR ships. The old trailing
 * `if (c < 4) m &= ~LEVEL` is gone with it — it silently wiped the Lv120 bit
 * that research-tracker.js sets without a cap.
 */
export function applyMaskChange(mask, cap, changedType, nowChecked) {
    let m = mask, c = cap;
    if (changedType === 'level') {
        if (nowChecked) { c = Math.max(c, 4); m |= GET | UPGRADE; }
        else if (c >= 4) c = 0;
    }
    if (changedType === 'get' && !nowChecked) c = 0;
    return { mask: m, cap: c };
}
