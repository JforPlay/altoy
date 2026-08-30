'use strict';

/**
 * ship-stat-table.js
 * Resolve which `base` / `growth` / `mounts` / `base_list` table of a
 * ship_info_data entry is the ship's max state.
 *
 * Pure and dependency-free so both consumers can share it: /shipgirl-stats
 * (roster aggregation) and the fleet simulator (per-slot stats + 포좌). They are
 * two readings of one rule, and letting each keep its own copy is exactly how
 * fleet-sim came to read 카스미's LB2 table with 개조 off.
 */

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
