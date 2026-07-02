/**
 * fleet-sim-code-apply.test.mjs
 * Pure import-plan policy (public/js/simulators/fleet-sim.code-apply.js):
 * decoded code + injected predicates → apply/skip plan. Spec §2.5.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { planImport } from '../../public/js/simulators/fleet-sim.code-apply.js';

function ctxWith(overrides = {}) {
    return {
        shipGid: 20516,
        hasDedicatedSP: false,
        isEquipAllowed: () => true,
        maxEnhance: () => 13,
        spInfo: () => ({ unique: 0, type: 1 }),
        allowedSPTypes: new Set([1]),
        ...overrides,
    };
}

function decodedWith(overrides = {}) {
    return {
        ok: true,
        equips: [{ baseId: 500, level: 13 }, null, null, null, null],
        sp: null,
        gid: null,
        errors: [],
        ...overrides,
    };
}

test('compatible equips apply, levels clamp to the data-driven cap', () => {
    const plan = planImport(decodedWith(), ctxWith({ maxEnhance: () => 10 }));
    assert.deepEqual(plan.apply, [{ slot: 0, baseId: 500, level: 10 }]);
    assert.equal(plan.gidMismatch, false);
});

test('incompatible slot is skipped with a notice, others still apply', () => {
    const decoded = decodedWith({
        equips: [{ baseId: 500, level: 0 }, { baseId: 600, level: 0 }, null, null, null],
    });
    const plan = planImport(decoded, ctxWith({
        isEquipAllowed: (baseId) => baseId !== 600,
    }));
    assert.deepEqual(plan.apply, [{ slot: 0, baseId: 500, level: 0 }]);
    assert.equal(plan.notices.length, 1);
    assert.match(plan.notices[0], /슬롯 2/);
});

test('unknown-equip decode errors become notices', () => {
    const decoded = decodedWith({ errors: [{ kind: 'unknown-equip', slot: 2, tierId: 999999 }] });
    const plan = planImport(decoded, ctxWith());
    assert.ok(plan.notices.some(n => n.includes('슬롯 3')));
});

test('gid mismatch is flagged, plan still computed', () => {
    const plan = planImport(decodedWith({ gid: 30707 }), ctxWith());
    assert.equal(plan.gidMismatch, true);
    assert.equal(plan.apply.length, 1);
});

test('matching gid is not a mismatch', () => {
    const plan = planImport(decodedWith({ gid: 20516 }), ctxWith());
    assert.equal(plan.gidMismatch, false);
});

test('sp: dedicated-augment ship ignores the sp field with a notice', () => {
    const decoded = decodedWith({ sp: { baseId: 10000, level: 10 } });
    const plan = planImport(decoded, ctxWith({ hasDedicatedSP: true }));
    assert.equal(plan.sp, null);
    assert.ok(plan.notices.some(n => n.includes('전용')));
});

test('sp: generic + type-allowed applies; unique-to-other or wrong type skips', () => {
    const decoded = decodedWith({ sp: { baseId: 10000, level: 5 } });
    const ok = planImport(decoded, ctxWith());
    assert.deepEqual(ok.sp, { baseId: 10000, level: 5 });

    const uniqueOther = planImport(decoded, ctxWith({ spInfo: () => ({ unique: 30707, type: 1 }) }));
    assert.equal(uniqueOther.sp, null);
    assert.equal(uniqueOther.notices.length, 1);

    const wrongType = planImport(decoded, ctxWith({ spInfo: () => ({ unique: 0, type: 9 }) }));
    assert.equal(wrongType.sp, null);
});
