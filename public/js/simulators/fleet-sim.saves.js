/**
 * fleet-sim.saves.js — pure save-envelope helpers for the fleet simulator.
 *
 * fleetSimSaves lives in localStorage as a syncedStorage {v:1, d} envelope
 * (legacy payloads were the bare saves array — migrateSaves handles v0).
 * Extracted from fleet-sim.main.js so parse/migrate/serialize logic is
 * node-testable; main.js owns the syncedStorage instance and all DOM.
 *
 * The ?fleet= share codec lives here too (encode/decodeFleetConfig): it is the
 * same pure shape work, and the curated preset file stores share codes directly.
 */

export const MAX_SAVE_SLOTS = 30;
export const SAVES_VERSION = 1;
/** Fleets fight in sequence in game; 1함대/2함대 plus two scratch variants. */
export const MAX_FLEETS = 4;
export const MAX_SUB_FLEETS = 2;
export const SUB_FLEET_SIZE = 3;
/** 지원함대 (15·16지역 opening battle): 0-2 항모, 3-5 잠수. No fleet tabs. */
export const SUPPORT_SIZE = 6;

// ===== Slot layout =====
//
// Every card carries one `data-slot` in a single address space, so the card,
// picker, popover and equip-code code serve all three sections unchanged:
//   0-5   active main fleet (0-2 후열, 3-5 전열)  — `state.ships`
//   6-8   active 잠수함대
//   9-11  지원함대 · 항모      12-14 지원함대 · 잠수
// Rows are runs of three: drag-and-drop swaps within a row, the picker filters by it.
export const SLOT_COUNT = 15;
export const ROW = { MAIN: 0, VANGUARD: 1, SUB: 2, SUPPORT_CARRIER: 3, SUPPORT_SUB: 4 };
export const slotRow = (slot) => Math.floor(slot / 3);

/** The [array, index] holding `slot` in fleet-sim state, or null when out of range. */
export function slotRef(state, slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) return null;
    if (slot < 6) return [state.fleets[state.activeFleet], slot];
    if (slot < 9) return [state.subFleets[state.activeSubFleet], slot - 6];
    return [state.support, slot - 9];
}

export const emptySlots = (size) => new Array(size).fill(null);
const _hasShip = (slots) => (slots || []).some(Boolean);

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
        if (s.fate !== undefined) out.fate = s.fate;
        return out;
    });
}

/** Deserialize saved ships into exactly `size` clamped slot configs.
 *  ids coerce to finite positive Numbers — poisoned saves degrade to empty slots. */
export function deserializeFleet(savedShips, size = 6) {
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
        if (s.fate !== undefined) slot.fate = s.fate;
        return slot;
    });
    while (ships.length < size) ships.push(null);
    ships.length = size;
    return ships;
}

/** The 잠수함대 / 지원함대 half of a save record, or {} when both are empty — so a
 *  main-fleet-only save stays byte-identical to what older builds wrote. */
export function serializeSections(state) {
    const out = {};
    if (state.subFleets.some(_hasShip)) out.subFleets = state.subFleets.map(serializeFleet);
    if (_hasShip(state.support)) out.support = serializeFleet(state.support);
    return out;
}

/** Inverse of serializeSections; a record without them (every older save) gives
 *  one empty 잠수함대 and an empty 지원함대. */
export function deserializeSections(save) {
    const subs = Array.isArray(save?.subFleets) ? save.subFleets.slice(0, MAX_SUB_FLEETS) : [];
    return {
        subFleets: subs.length
            ? subs.map((f) => deserializeFleet(f, SUB_FLEET_SIZE))
            : [emptySlots(SUB_FLEET_SIZE)],
        activeSubFleet: 0,
        support: deserializeFleet(save?.support, SUPPORT_SIZE),
    };
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
        if (s.fate !== undefined) o.f = s.fate ? 1 : 0;
        return o;
    });
}

/** Inverse of _encodeSlots, hardened: the payload is untrusted, so ids coerce
 *  to finite positives and levels clamp. Anything unreadable becomes an empty
 *  slot rather than throwing. */
function _decodeSlots(saved, spMaxLevel, size = 6) {
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
        if (s.f !== undefined) slot.fate = s.f === 1;
        return slot;
    });
    while (ships.length < size) ships.push(null);
    ships.length = size;
    return ships;
}

/**
 * The fight's time limit by target kind. META joint-boss runs are 80s; the
 * Operation Siren Arbiters are 90s. Shared with fleet-sim.main.js (the state
 * default) and fleet-sim.damage.js (the sim window) so the wire format, the
 * picker and the engine cannot drift apart.
 */
export const defaultWindow = (kind) => (kind === 'meta' ? 80 : 90);

/** Encode state.fleets + the damage target into the ?fleet= base64 payload. */
export function encodeFleetConfig(state) {
    const fleets = state.fleets || [];
    const config = fleets.length > 1
        ? { f: fleets.map(_encodeSlots), af: state.activeFleet || 0 }
        : { s: _encodeSlots(fleets[0]) };
    // 잠수함대 / 지원함대 only when they hold a ship, so a main-fleet link is unchanged.
    const subs = state.subFleets || [];
    if (subs.some(_hasShip)) {
        config.sb = subs.map(_encodeSlots);
        if (state.activeSubFleet) config.asb = state.activeSubFleet;
    }
    if (_hasShip(state.support)) config.su = _encodeSlots(state.support);

    const dt = state.damageTarget;
    if (dt) {
        config.t = dt.kind === 'meta'
            ? { k: 'meta', b: dt.bossId, ti: dt.tier }
            : { k: 'preset', p: dt.presetKey, ad: dt.adapt, df: dt.difficulty };
        if (dt.overrides && Object.keys(dt.overrides).length) config.t.o = dt.overrides;
        if (dt.window && dt.window !== defaultWindow(dt.kind)) config.t.w = dt.window;
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
    const rawSubs = Array.isArray(config.sb) ? config.sb.slice(0, MAX_SUB_FLEETS) : [];
    const subFleets = rawSubs.length
        ? rawSubs.map(f => _decodeSlots(f, spMaxLevel, SUB_FLEET_SIZE))
        : [emptySlots(SUB_FLEET_SIZE)];
    const asb = parseInt(config.asb, 10);

    return {
        fleets,
        activeFleet: Number.isInteger(af) && af >= 0 && af < fleets.length ? af : 0,
        subFleets,
        activeSubFleet: Number.isInteger(asb) && asb >= 0 && asb < subFleets.length ? asb : 0,
        support: _decodeSlots(config.su, spMaxLevel, SUPPORT_SIZE),
        target: _decodeTarget(config.t),
    };
}

/** Damage-target half of the payload → a setDamageTarget patch, or null. */
function _decodeTarget(t) {
    if (!t || typeof t !== 'object') return null;
    const patch = t.k === 'meta'
        ? { kind: 'meta', bossId: t.b ?? null, tier: t.ti ?? null }
        : { kind: 'preset', presetKey: t.p || 'heavy', adapt: t.ad || 'base', difficulty: t.df === 'normal' ? 'normal' : 'hard' };
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
    patch.window = Number.isFinite(w) ? w : defaultWindow(patch.kind);
    return patch;
}

/**
 * A curated preset's `code`, from either the bare ?fleet= payload or the whole
 * URL the 공유 button copies to the clipboard — authoring is paste-what-you-copied.
 * URLSearchParams percent-encodes base64's `+` and `/`, hence the decode.
 */
export function presetCode(raw) {
    const s = String(raw || '');
    const m = s.match(/[?&]fleet=([^&#]+)/);
    return m ? decodeURIComponent(m[1]) : s;
}
