/**
 * fleet-sim.code-apply.js — pure import policy for pasted 장비 코드.
 * Turns a decodeEquipCode() result + injected predicates into an apply/skip
 * plan, so the rules (spec §2.5) are node-testable without DOM or data
 * singletons. Notices are pre-built Korean strings; the UI renders them via
 * textContent (codes are untrusted input).
 */

/** @returns {{apply: Array<{slot,baseId,level}>, sp: {baseId,level}|null, notices: string[], gidMismatch: boolean}} */
export function planImport(decoded, ctx) {
    const plan = { apply: [], sp: null, notices: [], gidMismatch: false };

    plan.gidMismatch = !!(decoded.gid && ctx.shipGid && decoded.gid !== ctx.shipGid);

    // decode-level failures the user should see (1-based slot numbers)
    for (const err of decoded.errors || []) {
        if (err.kind === 'unknown-equip') {
            plan.notices.push(`슬롯 ${err.slot + 1}: 알 수 없는 장비 ID — 건너뜀`);
        } else if (err.kind === 'unknown-sp') {
            plan.notices.push('특수 장비: 알 수 없는 장비 ID — 건너뜀');
        } else if (err.kind === 'token' && typeof err.slot === 'number') {
            plan.notices.push(`슬롯 ${err.slot + 1}: 잘못된 코드 토큰 — 건너뜀`);
        } else if (err.kind === 'token') {
            plan.notices.push('특수 장비: 잘못된 코드 토큰 — 건너뜀');
        }
    }

    (decoded.equips || []).forEach((entry, slot) => {
        if (!entry) return;
        if (!ctx.isEquipAllowed(entry.baseId, slot)) {
            plan.notices.push(`슬롯 ${slot + 1}: 호환되지 않는 장비 — 건너뜀`);
            return;
        }
        const cap = ctx.maxEnhance(entry.baseId);
        const level = Math.max(0, Math.min(entry.level, cap));
        if (level !== entry.level) {
            plan.notices.push(`슬롯 ${slot + 1}: 강화 +${entry.level} → +${level} (최대치 조정)`);
        }
        plan.apply.push({ slot, baseId: entry.baseId, level });
    });

    // A 전용-장비 함순이 can hold a generic SP weapon too, so the old
    // refuse-the-whole-field rule is gone — what matters is WHOSE 전용 it is.
    if (decoded.sp) {
        const info = ctx.spInfo(decoded.sp.baseId);
        if (!info) {
            plan.notices.push('특수 장비: 알 수 없는 장비 ID — 건너뜀');
        } else if (info.unique !== 0 && info.unique !== ctx.shipGid) {
            plan.notices.push('특수 장비: 다른 함순이의 전용 장비 — 건너뜀');
        } else if (info.unique === 0 && !ctx.allowedSPTypes.has(info.type)) {
            // The ship's own 전용 skips this gate: allowedSPTypes lists the types
            // of its GENERIC options, which a 전용 weapon's type need not be in.
            plan.notices.push('특수 장비: 함종과 호환되지 않음 — 건너뜀');
        } else {
            const cap = info.maxLevel ?? decoded.sp.level;
            const level = Math.max(0, Math.min(decoded.sp.level, cap));
            if (level !== decoded.sp.level) {
                plan.notices.push(`특수 장비: 강화 +${decoded.sp.level} → +${level} (최대치 조정)`);
            }
            plan.sp = { baseId: decoded.sp.baseId, level };
        }
    }

    return plan;
}
