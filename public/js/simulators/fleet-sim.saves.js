/**
 * fleet-sim.saves.js — pure save-envelope helpers for the fleet simulator.
 *
 * fleetSimSaves lives in localStorage as a syncedStorage {v:1, d} envelope
 * (legacy payloads were the bare saves array — migrateSaves handles v0).
 * Extracted from fleet-sim.main.js so parse/migrate/serialize logic is
 * node-testable; main.js owns the syncedStorage instance and all DOM.
 *
 * The ?fleet= share codec lives here too (encode/decodeFleetConfig): it is the
 * same pure shape work, and the preset library reads share codes directly.
 */

export const MAX_SAVE_SLOTS = 30;
export const SAVES_VERSION = 1;
/** Fleets fight in sequence in game; 1함대/2함대 plus two scratch variants. */
export const MAX_FLEETS = 4;

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

/** Serialize fleet slots for saving.
 *  spWeapon is ALWAYS written, null included: an absent field means "written
 *  before the 전용 장비 became real slot state", and main.js fills those back
 *  in — so omitting it would resurrect a 전용 the user deliberately removed. */
export function serializeFleet(ships) {
    return (ships || []).map(s => {
        if (!s) return null;
        const out = {
            gid: s.gid,
            level: s.level,
            affinity: s.affinity,
            equips: (s.equips || []).map(eq => eq ? { id: eq.id, level: eq.level } : null),
            spWeapon: s.spWeapon ? { id: s.spWeapon.id, level: s.spWeapon.level } : null,
        };
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
            // undefined = legacy payload, main.js fills the 전용 back in.
            spWeapon: 'spWeapon' in s ? null : undefined,
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

// ===== ?fleet= share codec =====
//
// One fleet emits the legacy { s } shape, so every link already in the wild
// keeps decoding and the common single-fleet link does not get longer.
// >1 fleet emits { f: [slots…], af }.

/** Compact one fleet's slots for the URL payload. `sp` is always present
 *  (null included) for the same reason serializeFleet always writes it. */
function _encodeSlots(ships) {
    return (ships || []).map(s => {
        if (!s) return null;
        const o = {
            g: s.gid,
            l: s.level,
            a: s.affinity,
            e: (s.equips || []).map(eq => eq ? [eq.id, eq.level] : null),
            sp: s.spWeapon ? [s.spWeapon.id, s.spWeapon.level] : null,
        };
        if (s.retrofit !== undefined) o.r = s.retrofit ? 1 : 0;
        return o;
    });
}

/** Inverse of _encodeSlots, hardened: the payload is untrusted, so ids coerce
 *  to finite positives and levels clamp. Anything unreadable becomes an empty
 *  slot rather than throwing. */
function _decodeSlots(saved, spMaxLevel) {
    const ships = (Array.isArray(saved) ? saved : []).map(s => {
        if (!s || typeof s !== 'object') return null;
        const gid = Number(s.g);
        if (!Number.isFinite(gid) || gid <= 0) return null;
        const slot = {
            gid,
            level: clampLevel(s.l, 1, 125, 125),
            affinity: s.a || 'love',
            equips: (Array.isArray(s.e) ? s.e : []).slice(0, 5).map(eq => {
                const id = Array.isArray(eq) ? Number(eq[0]) : NaN;
                return Number.isFinite(id) && id > 0
                    ? { id, level: clampLevel(eq[1], 0, 13, 0) }
                    : null;
            }),
            // undefined = pre-1.68.0 link, main.js fills the 전용 back in.
            spWeapon: 'sp' in s ? null : undefined,
        };
        const spId = Array.isArray(s.sp) ? Number(s.sp[0]) : NaN;
        if (Number.isFinite(spId) && spId > 0) {
            slot.spWeapon = { id: spId, level: clampLevel(s.sp[1], 0, spMaxLevel(spId), 0) };
        }
        if (s.r !== undefined) slot.retrofit = s.r === 1;
        return slot;
    });
    while (ships.length < 6) ships.push(null);
    ships.length = 6;
    return ships;
}

/** Encode state.fleets + the damage target into the ?fleet= base64 payload. */
export function encodeFleetConfig(state) {
    const fleets = state.fleets || [];
    const config = fleets.length > 1
        ? { f: fleets.map(_encodeSlots), af: state.activeFleet || 0 }
        : { s: _encodeSlots(fleets[0]) };

    const dt = state.damageTarget;
    if (dt) {
        config.t = dt.kind === 'meta'
            ? { k: 'meta', b: dt.bossId, ti: dt.tier }
            : { k: 'preset', p: dt.presetKey, ad: dt.adapt };
        if (dt.overrides && Object.keys(dt.overrides).length) config.t.o = dt.overrides;
        if (dt.window && dt.window !== 90) config.t.w = dt.window;
    }
    return btoa(unescape(encodeURIComponent(JSON.stringify(config))));
}

/**
 * Decode a ?fleet= payload into { fleets, activeFleet, target }, or null if it
 * is not readable at all. `spMaxLevel(id)` supplies the per-weapon level cap
 * (SP weapons run to levels.length - 1); the default keeps this pure for tests
 * and for callers with no ship data loaded.
 */
export function decodeFleetConfig(encoded, spMaxLevel = () => 10) {
    let config;
    try {
        config = JSON.parse(decodeURIComponent(escape(atob(encoded))));
    } catch {
        return null;
    }
    if (!config || typeof config !== 'object') return null;

    const raw = Array.isArray(config.f) ? config.f : [config.s];
    const fleets = raw.slice(0, MAX_FLEETS).map(f => _decodeSlots(f, spMaxLevel));
    const af = parseInt(config.af, 10);

    return {
        fleets,
        activeFleet: Number.isInteger(af) && af >= 0 && af < fleets.length ? af : 0,
        target: _decodeTarget(config.t),
    };
}

/** Damage-target half of the payload → a setDamageTarget patch, or null. */
function _decodeTarget(t) {
    if (!t || typeof t !== 'object') return null;
    const patch = t.k === 'meta'
        ? { kind: 'meta', bossId: t.b ?? null, tier: t.ti ?? null }
        : { kind: 'preset', presetKey: t.p || 'heavy', adapt: t.ad || 'base' };
    // Untrusted input — coerce overrides to finite numbers (matching the live
    // Number() edit path); drops non-numeric values (XSS/NaN guard).
    patch.overrides = {};
    if (t.o && typeof t.o === 'object') {
        for (const [k, v] of Object.entries(t.o)) {
            const n = Number(v);
            if (Number.isFinite(n)) patch.overrides[k] = n;
        }
    }
    const w = Number(t.w);
    patch.window = Number.isFinite(w) ? w : 90;
    return patch;
}
