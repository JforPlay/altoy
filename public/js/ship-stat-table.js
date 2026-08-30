'use strict';

/**
 * ship-stat-table.js
 * Resolve which `base` / `growth` / `mounts` / `base_list` table of a
 * ship_info_data entry is the ship's max state.
 *
 * Pure and dependency-free so every consumer can share it: /shipgirl-stats
 * (roster aggregation), the fleet simulator (per-slot stats + 포좌) and
 * /shipgirl-info (the 한계돌파 selector + the 포좌 progression line). They are
 * readings of one rule, and letting each keep its own copy is exactly how
 * fleet-sim came to read 카스미's LB2 table with 개조 off.
 */

/** Own-ladder rungs, indexed by `key - sid` — never by array position. */
export const LIMIT_BREAK_NAMES = ['기본', '한계돌파 1', '한계돌파 2', '한계돌파 3'];

/**
 * Pick the max-state table key for a ship.
 *
 * Keyed by ID, never by key POSITION. All four tables share one key set (verified
 * across the roster), but that set is not ordered the way position assumes:
 *
 *  - 카스미's 改 table `301534` sorts BEFORE her own `sid` (301811), so it is the
 *    FIRST key, not the last — "second to last" then lands on her LB2.
 *  - 안샨/푸슌/창춘/타이위안 carry TWO 改 tables: `retrofit.id` (type 20 미구-전열)
 *    and a second one 1000 higher (type 21 미구-후열, +505 내구 / −40 회피), which
 *    sorts last. The two differ only in 내구/회피 — every offensive stat and the
 *    포좌 are identical — so the pick is a display question, not a damage one.
 *  - The three 부린 have a lone `sid` key and no `sid + 3`, so they fall through.
 *
 * The 후열 form is deliberately NOT reachable here: the ship record carries no id
 * for it (only `retrofit.type: 20`), and which one applies depends on the row the
 * ship is deployed in, which the roster page has no notion of. Resolving it would
 * need the pipeline to emit that second form rather than a `+ 1000` guess.
 *
 * @param {Object} ship - Entry from ship_info_data
 * @param {boolean} useRetrofit - resolve the 改 table when the ship has one
 * @returns {string|null} key into ship.base / growth / mounts / base_list
 */
export function statTableKey(ship, useRetrofit) {
    const base = ship && ship.base;
    if (!base) return null;

    if (useRetrofit && ship.retrofit && base[ship.retrofit.id]) {
        return String(ship.retrofit.id);
    }

    const mlbKey = String(ship.sid + 3);
    if (base[mlbKey]) return mlbKey;

    const baseKeys = Object.keys(base);
    return baseKeys[baseKeys.length - 1] ?? null;
}

/**
 * Order a ship's stat-table keys the way its ladder actually runs, and name each.
 *
 * Labelling by ARRAY POSITION is wrong for the same reason picking a table by
 * position is: 카스미's 改 key sorts before her own `sid`, so every one of her
 * rungs read one step too high (her 改 table showed as 기본), and the 안샨-class
 * pair showed as 한계돌파 4 / 한계돌파 5. The rung is `key - sid`, and anything
 * outside that window is a 改 table.
 *
 * 71 ships state their 改 form AT `sid + 3` (`retrofit.id === sid + 3`, the 改
 * bonus riding `retrofit.bonus` instead of a separate table), so they keep the
 * plain 한계돌파 3 label and produce no 개조 row at all — correct, and unchanged.
 *
 * Only the four 안샨-class carry two 改 tables: `retrofit.id` is the 미구-전열
 * form (`retrofit.type` 20) and the other is its 미구-후열 twin. That second id
 * is absent from the ship record, so it is named by elimination and only when
 * there are exactly two — see dev/icebox for the pipeline fix that would let a
 * consumer resolve it properly.
 *
 * @param {Object} ship - Entry from ship_info_data
 * @param {Object} [table] - key set to order (defaults to ship.base; `mounts`
 *   and `base_list` share it on every ship in the roster)
 * @returns {{key: string, label: string}[]} 기본 → MLB, then the 改 form(s)
 */
export function limitBreakSteps(ship, table) {
    const keys = Object.keys((table || (ship && ship.base)) || {});
    const own = [];
    const retro = [];

    for (const key of keys) {
        const rung = Number(key) - (ship && ship.sid);
        if (rung >= 0 && rung < LIMIT_BREAK_NAMES.length) own.push({ key, rung });
        else retro.push(key);
    }
    own.sort((a, b) => a.rung - b.rung);

    const retroId = String((ship && ship.retrofit && ship.retrofit.id) ?? '');
    retro.sort((a, b) => (a === retroId ? -1 : b === retroId ? 1 : 0));
    const pair = retro.length === 2;

    return [
        ...own.map(({ key, rung }) => ({ key, label: LIMIT_BREAK_NAMES[rung] })),
        ...retro.map((key) => ({
            key,
            label: pair ? (key === retroId ? '개조 · 전열' : '개조 · 후열') : '개조',
        })),
    ];
}
