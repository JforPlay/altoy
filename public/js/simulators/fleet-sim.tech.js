/**
 * fleet-sim.tech.js — 함종별 함대 기술 (per-hull-type fleet tech), pure.
 *
 * Two fleet-tech systems exist in game and they are NOT the same thing:
 *   • 진영 기술 (nation) — tech POINTS accumulate per faction, cross a `pt`
 *     threshold, and the whole faction level's `add` table applies. That one
 *     lives in fleet-sim.calc.js against `fleet_tech_template.json`.
 *   • 함종 기술 (this file) — each individual ship grants a flat stat bonus to
 *     every ship of a hull type, once on 획득 (`add_get_*`) and again on Lv120
 *     (`add_level_*`). No thresholds, no levels: it is a plain sum over the
 *     roster, and it is worth a lot (항모 +30 장전 / +60 항공 at the ceiling).
 *
 * Both read the same `shipgirlTrackerProgress` bit mask, whose meaning is the
 * FROZEN 3-bit contract from tracker-investment.js (get=1, level=2, upgrade=4).
 * 풀돌 (4) grants tech POINTS only — no stat clause hangs off it.
 *
 * Manual override: a visitor who does not use the tracker still knows their own
 * numbers, so any (함종, 스탯) cell can be pinned by hand. Overrides sit ON TOP
 * of the derived value per cell rather than replacing the whole table, so a
 * tracker user can correct one cell without re-entering the other eighty.
 *
 * No DOM, no storage — node-tested (tests/simulators/fleet-sim-shiptype-tech.test.mjs).
 */

/** syncedStorage envelope version for `fleetSimTechOverride`. */
export const TECH_OVERRIDE_VERSION = 1;

/**
 * attr_type id → ship stat key. The single source for both tech systems —
 * fleet-sim.calc.js imports it rather than keeping a second copy, because the
 * 진영 `add` table and the 함종 `add_*_attr` fields are the same id space.
 * 7 (장갑) is absent on purpose: it is not a numeric stat we carry.
 */
export const TECH_STAT_BY_ATTR_ID = {
    1: 'health',
    2: 'firepower',
    3: 'torpedo',
    4: 'antiair',
    5: 'aviation',
    6: 'reload',
    8: 'accuracy',
    9: 'evasion',
    10: 'speed',
    11: 'luck',
    12: 'asw',
};

/**
 * Grid order + labels for the override modal. Deliberately its own list rather
 * than calc.js DISPLAY_STATS: that one is the card's eight display stats and
 * carries battleAttr keys, while 함종 기술 also grants 대잠/행속/운.
 */
export const TECH_STATS = [
    { key: 'health',    label: '내구' },
    { key: 'firepower', label: '포격' },
    { key: 'aviation',  label: '항공' },
    { key: 'torpedo',   label: '뇌장' },
    { key: 'antiair',   label: '대공' },
    { key: 'reload',    label: '장전' },
    { key: 'accuracy',  label: '명중' },
    { key: 'evasion',   label: '기동' },
    { key: 'asw',       label: '대잠' },
    { key: 'speed',     label: '행속' },
    { key: 'luck',      label: '운' },
];

const STAT_KEYS = new Set(TECH_STATS.map((s) => s.key));

// Progress bits — FROZEN contract, shared with tracker-investment.js.
const GET = 1, LEVEL = 2;

/** `out[type][stat] += value` with the object walls built lazily. */
function _add(out, type, stat, value) {
    if (!stat || !value) return;
    const bucket = out[type] || (out[type] = {});
    bucket[stat] = (bucket[stat] || 0) + value;
}

/**
 * Fold one ship_group_data record's tech clauses into `out`.
 * `mask` is the ship's progress bits; a clause counts only when its own bit is set.
 */
function _foldGroup(out, group, mask) {
    if (mask & GET) {
        const stat = TECH_STAT_BY_ATTR_ID[group.add_get_attr];
        for (const type of group.add_get_shiptype || []) _add(out, type, stat, group.add_get_value || 0);
    }
    if (mask & LEVEL) {
        const stat = TECH_STAT_BY_ATTR_ID[group.add_level_attr];
        for (const type of group.add_level_shiptype || []) _add(out, type, stat, group.add_level_value || 0);
    }
}

/**
 * The ceiling: every ship in the roster obtained AND at Lv120.
 * Doubles as the modal's per-cell max — a hand-entered value above it would be
 * unreachable in game, so it is clamped rather than trusted.
 * @returns {Object<number, Object<string, number>>} { shipType: { statKey: max } }
 */
export function shipTypeTechCaps(shipGroupData) {
    const out = {};
    for (const group of Object.values(shipGroupData || {})) _foldGroup(out, group, GET | LEVEL);
    return out;
}

/**
 * What the tracker's recorded progress actually unlocks.
 * @param {object} shipGroupData ship_group_data.json
 * @param {object} progress      parsed shipgirlTrackerProgress ({ gid: bitmask })
 */
export function shipTypeTechFromProgress(shipGroupData, progress) {
    const out = {};
    if (!shipGroupData || !progress) return out;
    for (const [gid, bits] of Object.entries(progress)) {
        const group = shipGroupData[gid];
        if (group) _foldGroup(out, group, Number(bits) | 0);
    }
    return out;
}

/**
 * Sanitize an untrusted override payload (post-JSON, post-envelope).
 * Never throws: unknown hull types / stat keys and non-finite values are dropped,
 * so a bad write in another tab (or a hand-edited localStorage) can't poison a render.
 */
export function parseTechOverride(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out = {};
    for (const [type, stats] of Object.entries(value)) {
        const typeId = Number(type);
        if (!Number.isInteger(typeId) || typeId <= 0) continue;
        if (!stats || typeof stats !== 'object' || Array.isArray(stats)) continue;
        for (const [stat, raw] of Object.entries(stats)) {
            if (!STAT_KEYS.has(stat)) continue;
            const n = Number(raw);
            if (!Number.isFinite(n) || n < 0) continue;
            (out[typeId] || (out[typeId] = {}))[stat] = Math.round(n);
        }
    }
    return out;
}

/**
 * derived ⊕ override, clamped to the caps.
 *
 * An override cell wins outright (that is the whole point — the visitor is
 * telling us their real number), but it still cannot exceed the roster ceiling.
 * A cell the override does not mention keeps the tracker-derived value, which is
 * why the two are merged per cell and not per table.
 */
export function effectiveShipTypeTech(derived, override, caps) {
    const out = {};
    const types = new Set([...Object.keys(derived || {}), ...Object.keys(override || {})]);
    for (const type of types) {
        const from = { ...(derived?.[type] || {}), ...(override?.[type] || {}) };
        const cap = caps?.[type] || {};
        const bucket = {};
        for (const [stat, value] of Object.entries(from)) {
            const clamped = Math.max(0, Math.min(value, cap[stat] ?? value));
            if (clamped) bucket[stat] = clamped;
        }
        if (Object.keys(bucket).length) out[type] = bucket;
    }
    return out;
}
