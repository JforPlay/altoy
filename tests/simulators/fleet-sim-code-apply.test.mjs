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
        isEquipAllowed: () => true,
        maxEnhance: () => 13,
        spInfo: () => ({ unique: 0, type: 1, maxLevel: 10 }),
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

test("sp: the ship's OWN 전용 applies, and skips the generic type gate", () => {
    // allowedSPTypes lists the types of the ship's GENERIC options; a 전용
    // weapon's own type need not be among them, so type 9 must still apply.
    const decoded = decodedWith({ sp: { baseId: 10000, level: 10 } });
    const plan = planImport(decoded, ctxWith({
        spInfo: () => ({ unique: 20516, type: 9, maxLevel: 10 }),
    }));
    assert.deepEqual(plan.sp, { baseId: 10000, level: 10 });
    assert.deepEqual(plan.notices, []);
});

test("sp: generic + type-allowed applies; another ship's 전용 or a wrong type skips", () => {
    const decoded = decodedWith({ sp: { baseId: 10000, level: 5 } });
    const ok = planImport(decoded, ctxWith());
    assert.deepEqual(ok.sp, { baseId: 10000, level: 5 });

    const uniqueOther = planImport(decoded, ctxWith({ spInfo: () => ({ unique: 30707, type: 1, maxLevel: 10 }) }));
    assert.equal(uniqueOther.sp, null);
    assert.equal(uniqueOther.notices.length, 1);
    assert.match(uniqueOther.notices[0], /다른 함순이/);

    const wrongType = planImport(decoded, ctxWith({ spInfo: () => ({ unique: 0, type: 9, maxLevel: 10 }) }));
    assert.equal(wrongType.sp, null);
    assert.match(wrongType.notices[0], /함종/);
});

test('sp: an over-max level clamps WITH a notice, like the equip slots do', () => {
    // 슈퍼 레인보우 망치 1호 (id 9000) is the one SP weapon with a single level.
    const decoded = decodedWith({ sp: { baseId: 9000, level: 10 } });
    const plan = planImport(decoded, ctxWith({
        spInfo: () => ({ unique: 20516, type: 1, maxLevel: 0 }),
    }));
    assert.deepEqual(plan.sp, { baseId: 9000, level: 0 });
    assert.ok(plan.notices.some(n => n.includes('특수 장비') && n.includes('최대치 조정')));
});

test('unknown-sp decode errors become a 특수 장비 notice', () => {
    const decoded = decodedWith({ equips: [null, null, null, null, null], errors: [{ kind: 'unknown-sp', slot: 'sp', tierId: 999999 }] });
    const plan = planImport(decoded, ctxWith());
    assert.ok(plan.notices.some(n => n.includes('특수 장비') && n.includes('알 수 없는')));
});

test('token error on a numeric slot becomes a 1-based slot notice', () => {
    const decoded = decodedWith({ errors: [{ kind: 'token', slot: 2 }] });
    const plan = planImport(decoded, ctxWith());
    assert.ok(plan.notices.some(n => n.includes('슬롯 3') && n.includes('잘못된 코드 토큰')));
});

test('token error on the sp slot becomes a 특수 장비 notice', () => {
    const decoded = decodedWith({ errors: [{ kind: 'token', slot: 'sp' }] });
    const plan = planImport(decoded, ctxWith());
    assert.ok(plan.notices.some(n => n.includes('특수 장비') && n.includes('잘못된 코드 토큰')));
});
