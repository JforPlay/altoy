/**
 * equip-code.js — game-compatible 장비 코드 codec (pure, node-tested).
 *
 * Format (cracked 2026-07-01 — dev/active/2026-06-30-fleet-sim-enhancements-design.md
 * F3-UPDATE):
 *   payload   = b32(t1)/b32(t2)/b32(t3)/b32(t4)/b32(t5) + '\' + b32(sp)
 *   code      = base64(UPPERCASE(payload))
 *   game full = code&gid(b32)&tag1&tag2      (parsed here; we emit payload-only)
 *
 * tN = per-tier equip_data_template id (0 = empty slot); sp = per-level
 * spweapon_data_statistics id (0 = none). Tier ids come from EXPLICIT maps —
 * never base+level arithmetic: 12 SP upgrade chains are non-consecutive
 * (breakthrough tiers, e.g. 1010110 → 1010120).
 *
 * Pure module: no DOM, no fetch, no module state. Callers load the two data
 * files and hold the maps (fleet-sim.data.js getEquipCodeMaps()).
 */

const B32_TOKEN = /^[0-9a-v]+$/;

/**
 * Build tier-id lookup maps.
 * @param {object} equipFullData - equip_data_full.json root (baseId → { levels: [{id,...}] })
 * @param {object} spWeapons - spweapon_data.json `weapons` (baseId → { level_ids: [...] })
 */
export function buildTierMaps(equipFullData, spWeapons) {
    const equipTierToBase = new Map();
    const equipBaseToTiers = new Map();
    for (const [baseKey, equip] of Object.entries(equipFullData || {})) {
        const baseId = Number(baseKey);
        const levels = Array.isArray(equip?.levels) ? equip.levels : [];
        const tiers = [];
        for (let i = 0; i < levels.length; i++) {
            const tierId = Number(levels[i]?.id);
            if (!Number.isFinite(tierId)) continue;
            tiers.push(tierId);
            equipTierToBase.set(tierId, { baseId, level: i });
        }
        if (tiers.length) equipBaseToTiers.set(baseId, tiers);
    }

    const spTierToBase = new Map();
    const spBaseToTiers = new Map();
    for (const [baseKey, weapon] of Object.entries(spWeapons || {})) {
        const baseId = Number(baseKey);
        const ids = Array.isArray(weapon?.level_ids) ? weapon.level_ids : [];
        const tiers = [];
        for (let i = 0; i < ids.length; i++) {
            const tierId = Number(ids[i]);
            if (!Number.isFinite(tierId)) continue;
            tiers.push(tierId);
            spTierToBase.set(tierId, { baseId, level: i });
        }
        if (tiers.length) spBaseToTiers.set(baseId, tiers);
    }

    return { equipTierToBase, equipBaseToTiers, spTierToBase, spBaseToTiers };
}

/** One slot entry → base-32 token; '0' for empty/unmappable. Level clamps into the tier list. */
function _tierToken(entry, baseToTiers) {
    if (!entry) return '0';
    const baseId = Number(entry.baseId);
    if (!Number.isFinite(baseId)) return '0';
    const tiers = baseToTiers.get(baseId);
    if (!tiers || !tiers.length) return '0';
    const level = Math.max(0, Math.min(Number(entry.level) || 0, tiers.length - 1));
    return tiers[level].toString(32);
}

/**
 * Encode one loadout as a game-pasteable code (payload-only emission).
 * @param {{equips: Array<{baseId,level}|null>, sp: {baseId,level}|null}} entries
 * @returns {string|null} null when there is nothing to encode
 */
export function encodeEquipCode(entries, maps) {
    const slotTokens = [];
    for (let i = 0; i < 5; i++) {
        slotTokens.push(_tierToken(entries?.equips?.[i], maps.equipBaseToTiers));
    }
    const spToken = _tierToken(entries?.sp, maps.spBaseToTiers);
    if (spToken === '0' && slotTokens.every(t => t === '0')) return null;
    const payload = (slotTokens.join('/') + '\\' + spToken).toUpperCase();
    return btoa(payload);
}

/**
 * Decode a pasted 장비 코드. Accepts payload-only strings and full 4-field
 * game strings. Never throws; failures land in `errors`.
 */
export function decodeEquipCode(text, maps) {
    const result = {
        ok: false,
        equips: [null, null, null, null, null],
        sp: null,
        gid: null,
        errors: [],
    };
    const raw = String(text || '').trim();
    if (!raw) {
        result.errors.push({ kind: 'empty' });
        return result;
    }

    // Full game strings are code&gid(b32)&tag1&tag2 — isolate field 1 first.
    const fields = raw.split('&');
    if (fields.length > 1) {
        const gid = parseInt(fields[1].trim(), 32);
        if (Number.isFinite(gid) && gid > 0) result.gid = gid;
    }

    let payload;
    try {
        payload = atob(fields[0].replace(/\s+/g, ''));
    } catch {
        result.errors.push({ kind: 'format' });
        return result;
    }

    const backslashAt = payload.indexOf('\\');
    const slotsPart = backslashAt === -1 ? payload : payload.slice(0, backslashAt);
    const spPart = backslashAt === -1 ? '' : payload.slice(backslashAt + 1);

    const tokens = slotsPart.split('/').slice(0, 5);
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i].trim().toLowerCase();
        if (!t || t === '0') continue;
        if (!B32_TOKEN.test(t)) {
            result.errors.push({ kind: 'token', slot: i });
            continue;
        }
        const tierId = parseInt(t, 32);
        const hit = maps.equipTierToBase.get(tierId);
        if (!hit) {
            result.errors.push({ kind: 'unknown-equip', slot: i, tierId });
            continue;
        }
        result.equips[i] = { baseId: hit.baseId, level: hit.level };
    }

    const spTok = (spPart.split('/')[0] || '').trim().toLowerCase();
    if (spTok && spTok !== '0') {
        if (!B32_TOKEN.test(spTok)) {
            result.errors.push({ kind: 'token', slot: 'sp' });
        } else {
            const tierId = parseInt(spTok, 32);
            const hit = maps.spTierToBase.get(tierId);
            if (hit) result.sp = { baseId: hit.baseId, level: hit.level };
            else result.errors.push({ kind: 'unknown-sp', slot: 'sp', tierId });
        }
    }

    result.ok = result.equips.some(Boolean) || !!result.sp;
    return result;
}
