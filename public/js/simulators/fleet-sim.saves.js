/**
 * fleet-sim.saves.js — pure save-envelope helpers for the fleet simulator.
 *
 * fleetSimSaves lives in localStorage as a syncedStorage {v:1, d} envelope
 * (legacy payloads were the bare saves array — migrateSaves handles v0).
 * Extracted from fleet-sim.main.js so parse/migrate/serialize logic is
 * node-testable; main.js owns the syncedStorage instance and all DOM.
 */

export const MAX_SAVE_SLOTS = 30;
export const SAVES_VERSION = 1;

/** syncedStorage parse() contract: never throw; null/garbage → []. */
export function parseSaves(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(s => s && typeof s === 'object' && Array.isArray(s.ships));
}

/** syncedStorage migrate() contract: v0 (un-versioned) payload was the bare array. */
export function migrateSaves(oldVersion, oldData) {
    return Array.isArray(oldData) ? oldData : [];
}

export function clampLevel(value, min, max, fallback = max) {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

/** Serialize fleet slots for saving (same shape main.js always wrote). */
export function serializeFleet(ships) {
    return (ships || []).map(s => {
        if (!s) return null;
        const out = {
            gid: s.gid,
            level: s.level,
            affinity: s.affinity,
            equips: (s.equips || []).map(eq => eq ? { id: eq.id, level: eq.level } : null),
        };
        if (s.spWeapon) out.spWeapon = { id: s.spWeapon.id, level: s.spWeapon.level };
        if (s.retrofit !== undefined) out.retrofit = s.retrofit;
        return out;
    });
}

/** Deserialize saved ships into exactly 6 clamped slot configs.
 *  ids coerce to finite positive Numbers — poisoned saves degrade to empty slots. */
export function deserializeFleet(savedShips) {
    const ships = (Array.isArray(savedShips) ? savedShips : []).map(s => {
        if (!s) return null;
        const gid = Number(s.gid);
        if (!Number.isFinite(gid) || gid <= 0) return null;
        const slot = {
            gid,
            level: clampLevel(s.level, 1, 125, 125),
            affinity: s.affinity || 'love',
            equips: Array.isArray(s.equips)
                ? s.equips.slice(0, 5).map(eq => {
                    const id = eq ? Number(eq.id) : NaN;
                    return Number.isFinite(id) && id > 0
                        ? { id, level: clampLevel(eq.level, 0, 13, 0) }
                        : null;
                })
                : new Array(5).fill(null),
            spWeapon: null,
        };
        const spId = s.spWeapon ? Number(s.spWeapon.id) : NaN;
        if (Number.isFinite(spId) && spId > 0) {
            slot.spWeapon = { id: spId, level: clampLevel(s.spWeapon.level, 0, 10, 0) };
        }
        if (s.retrofit !== undefined) slot.retrofit = s.retrofit;
        return slot;
    });
    while (ships.length < 6) ships.push(null);
    if (ships.length > 6) ships.length = 6;
    return ships;
}
