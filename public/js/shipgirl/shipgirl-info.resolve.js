/**
 * shipgirl-info.resolve.js
 * Resolve a ship record from the full ship list, preferring a STABLE ship-group
 * id (gid) over the name. Pure + node-testable (no DOM, no state).
 *
 * Why gid-first: ship names drift across data sources (upstream typos like
 * 아드미럴/아드미랄 히퍼, transliteration variants 아드미랄/아드미럴/어드미럴, MKIII vs MKⅢ),
 * so a name-only join silently dead-ends or mis-targets. Cross-page links that
 * carry a gid (?gid=) resolve exactly regardless of spelling. See the skin-side
 * twin `skin.gid.js` and reference_gid_linking.
 *
 * Name matching is deliberately EXACT (raw, then roman-numeral-normalized) —
 * NEVER fuzzy. Fuzzy fallback is exactly what mis-redirected the skin viewer to
 * the wrong ·META unit; this resolver must not reintroduce that class of bug.
 */

import { normalizeRomanNumerals } from '../utils.js';

/**
 * @param {Array<{gid?:number|string, name?:string}>} ships - full ship_info list
 * @param {{gid?:number|string|null, name?:string|null}} query
 * @returns {object|null} the matched ship record, or null if none
 */
export function resolveShip(ships, { gid, name } = {}) {
    if (!Array.isArray(ships)) return null;

    // 1) Stable gid — exact, wins over name when both are supplied.
    if (gid !== undefined && gid !== null && gid !== '') {
        const g = String(gid);
        const byGid = ships.find(s => s && s.gid !== undefined && s.gid !== null && String(s.gid) === g);
        if (byGid) return byGid;
    }

    // 2) Name — exact, then roman-numeral-normalized (still exact equality, no fuzzy).
    if (name) {
        const exact = ships.find(s => s && s.name === name);
        if (exact) return exact;

        const norm = normalizeRomanNumerals(String(name).trim());
        if (norm) {
            const byNorm = ships.find(
                s => s && s.name && normalizeRomanNumerals(String(s.name).trim()) === norm
            );
            if (byNorm) return byNorm;
        }
    }

    return null;
}
