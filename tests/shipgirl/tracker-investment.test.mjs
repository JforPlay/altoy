import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseInvestment, investedCost, nextBreakCost, sumInvestment, rosterTotal,
    BREAK_LEVELS, applyCapChange, applyMaskChange, MEMO_MAX,
    PROGRESS_RUNGS, RUNG_LABELS, progressRung, stepRung,
} from '../../public/js/shipgirl/tracker-investment.js';
import { SHEET_PROGRESS } from '../../public/js/shipgirl/tracker-sheet-codec.js';

test('parseInvestment: null/array/garbage -> {}', () => {
    assert.deepEqual(parseInvestment(null), {});
    assert.deepEqual(parseInvestment([1, 2]), {});
    assert.deepEqual(parseInvestment('x'), {});
});

test('parseInvestment: clamps fields, drops empty records', () => {
    const raw = {
        '10102': { cap: 7, ret: 3, fav: 1, aff: 9, skl: -1, memo: 42 },
        '10103': { cap: 2 },
        '10104': {},                       // nothing set -> dropped
        '10105': { memo: 'x'.repeat(600) } // clamped to MEMO_MAX
    };
    const out = parseInvestment(raw);
    assert.deepEqual(out['10102'], { cap: 5, ret: 1, fav: 1, aff: 4 });
    assert.deepEqual(out['10103'], { cap: 2 });
    assert.equal(out['10104'], undefined);
    assert.equal(out['10105'].memo.length, MEMO_MAX);
});

test('parseInvestment: drops zero/false/negative/out-of-range fields (sparse semantics)', () => {
    assert.deepEqual(parseInvestment({'1':{cap:0}}), {});
    assert.deepEqual(parseInvestment({'1':{ret:0}}), {});
    assert.deepEqual(parseInvestment({'1':{fav:false}}), {});
    assert.deepEqual(parseInvestment({'1':{cap:-3}}), {});
    assert.deepEqual(parseInvestment({'1':{aff:0,skl:0}}), {});
});

test('investedCost per rarity', () => {
    assert.deepEqual(investedCost(0, 'SR'), { u1: 0, u2: 0 });
    assert.deepEqual(investedCost(3, 'UR'), { u1: 300 + 600 + 900, u2: 0 });
    assert.deepEqual(investedCost(5, 'N'), { u1: 60 + 120 + 180 + 300 + 80, u2: 40 });
    assert.deepEqual(investedCost(5, 'UR'), { u1: 3750, u2: 225 });
    assert.equal(investedCost(2, 'Unknown Rarity'), null);
});

test('nextBreakCost', () => {
    assert.deepEqual(nextBreakCost(0, 'SSR'), { level: 105, u1: 200, u2: 0 });
    assert.deepEqual(nextBreakCost(4, 'R'), { level: 125, u1: 120, u2: 60 });
    assert.equal(nextBreakCost(5, 'R'), null);
    assert.equal(nextBreakCost(0, 'Unknown Rarity'), null);
});

test('sumInvestment + rosterTotal skip unknown rarities', () => {
    const rarityByGid = { '1': 'N', '2': 'UR', '3': 'Unknown Rarity' };
    assert.deepEqual(rosterTotal(rarityByGid), { u1: 740 + 3750, u2: 40 + 225 });
    const inv = { '1': { cap: 5 }, '2': { cap: 1 }, '3': { cap: 5 }, '9': { cap: 2 } };
    // gid 9 absent from rarityByGid -> skipped too
    assert.deepEqual(sumInvestment(inv, rarityByGid), { u1: 740 + 300, u2: 40 });
});

test('capLimit scopes both sides to a break ceiling (the Lv120 summary basis)', () => {
    const rarityByGid = { '1': 'N', '2': 'UR' };
    // Lv120 = the first four breaks, which never spend 유닛II
    assert.deepEqual(rosterTotal(rarityByGid, 4), { u1: 660 + 3300, u2: 0 });
    // a ship parked at Lv125 counts only its first four breaks on this basis,
    // so invested can never exceed the total it is shown against
    assert.deepEqual(sumInvestment({ '1': { cap: 5 } }, rarityByGid, 4), { u1: 660, u2: 0 });
    // default stays the full Lv125 basis
    assert.deepEqual(sumInvestment({ '1': { cap: 5 } }, rarityByGid), { u1: 740, u2: 40 });
});

test('BREAK_LEVELS is the exported 5-break ladder', () => {
    assert.deepEqual(BREAK_LEVELS, [105, 110, 115, 120, 125]);
});

test('applyCapChange: cap>=1 forces get+upgrade; cap>=4 sets level, cap<4 clears it', () => {
    assert.deepEqual(applyCapChange(5, 4), { mask: 7, cap: 4 }); // 120 cap == Lv120 달성
    assert.deepEqual(applyCapChange(0, 5), { mask: 7, cap: 5 });
    assert.deepEqual(applyCapChange(0, 2), { mask: 5, cap: 2 });
    assert.deepEqual(applyCapChange(7, 3), { mask: 5, cap: 3 }); // level bit cleared
    assert.deepEqual(applyCapChange(7, 4), { mask: 7, cap: 4 });
    assert.deepEqual(applyCapChange(5, 0), { mask: 5, cap: 0 }); // 풀돌 stays
});

test('applyMaskChange couples per changed control', () => {
    // check 120 달성 -> cap>=4, get+upgrade forced
    assert.deepEqual(applyMaskChange(2, 0, 'level', true), { mask: 7, cap: 4 });
    assert.deepEqual(applyMaskChange(7, 5, 'level', true), { mask: 7, cap: 5 }); // cap 5 kept
    // uncheck 120 달성 -> cap untouched
    assert.deepEqual(applyMaskChange(5, 4, 'level', false), { mask: 5, cap: 4 });
    // uncheck 풀돌 -> cap 0, level cleared
    assert.deepEqual(applyMaskChange(3, 4, 'upgrade', false), { mask: 1, cap: 0 });
    // uncheck 보유 -> everything down (caller already cleared level/upgrade bits)
    assert.deepEqual(applyMaskChange(0, 3, 'get', false), { mask: 0, cap: 0 });
    // plain checks don't invent caps
    assert.deepEqual(applyMaskChange(1, 0, 'get', true), { mask: 1, cap: 0 });
    assert.deepEqual(applyMaskChange(5, 0, 'upgrade', true), { mask: 5, cap: 0 });
});

// ===== 요약 wall ladder =====

test('PROGRESS_RUNGS is the single ladder the sheet codec also speaks', () => {
    // One rung per sheet value. If these ever diverge, importing "120" and
    // clicking the 120 stop stop meaning the same thing — the exact bug the
    // shared table exists to prevent.
    assert.equal(PROGRESS_RUNGS.length, SHEET_PROGRESS.length);
    assert.equal(RUNG_LABELS.length, PROGRESS_RUNGS.length);
    // Every rung round-trips through progressRung.
    PROGRESS_RUNGS.forEach(({ mask, cap }, i) => {
        assert.equal(progressRung(mask, cap), i, `rung ${i}`);
    });
});

test('progressRung: reads off-ladder state by export priority', () => {
    assert.equal(progressRung(0, 0), 0);
    assert.equal(progressRung(1, 0), 1);          // 보유
    assert.equal(progressRung(5, 0), 2);          // 풀돌
    assert.equal(progressRung(7, 4), 3);          // Lv120
    assert.equal(progressRung(7, 5), 4);          // Lv125
    // Caps 1-3 are unsettable in the UI but importable — they read as 풀돌,
    // never as a rung of their own and never off the ladder.
    assert.equal(progressRung(5, 1), 2);
    assert.equal(progressRung(5, 3), 2);
    // cap 5 wins over a missing level bit; a cap-4 record without it does not.
    assert.equal(progressRung(5, 5), 4);
    assert.equal(progressRung(5, 4), 2);
    // Tolerates a missing cap entirely (undefined/null records).
    assert.equal(progressRung(1, undefined), 1);
    assert.equal(progressRung(7, null), 3);
});

test('stepRung: clamps at both ends and lands on canonical state', () => {
    assert.deepEqual(stepRung(0, 0, 1), { mask: 1, cap: 0, rung: 1 });
    assert.deepEqual(stepRung(5, 0, 1), { mask: 7, cap: 4, rung: 3 });
    assert.deepEqual(stepRung(7, 4, 1), { mask: 7, cap: 5, rung: 4 });
    assert.deepEqual(stepRung(7, 5, 1), { mask: 7, cap: 5, rung: 4 }); // clamped at top
    assert.deepEqual(stepRung(7, 5, -1), { mask: 7, cap: 4, rung: 3 });
    assert.deepEqual(stepRung(0, 0, -1), { mask: 0, cap: 0, rung: 0 }); // clamped at bottom
    // Stepping is what normalises an off-ladder cap: 110 reads as 풀돌, so up
    // lands on Lv120 and drops the orphan cap rather than preserving it.
    assert.deepEqual(stepRung(5, 2, 1), { mask: 7, cap: 4, rung: 3 });
    assert.deepEqual(stepRung(5, 2, -1), { mask: 1, cap: 0, rung: 1 });
});

test('stepRung never mutates or aliases the shared table', () => {
    const before = JSON.stringify(PROGRESS_RUNGS);
    const got = stepRung(0, 0, 1);
    got.cap = 99;
    assert.equal(PROGRESS_RUNGS[1].cap, 0);
    assert.equal(JSON.stringify(PROGRESS_RUNGS), before);
});

test('every rung is a fixed point of applyCapChange', () => {
    // The wall lands directly on PROGRESS_RUNGS states; the 육성 레벨 bar routes
    // the same states through applyCapChange. A rung that is not a fixed point
    // would make the two controls disagree about the same ship.
    PROGRESS_RUNGS.forEach(({ mask, cap }, i) => {
        const coupled = applyCapChange(mask, cap);
        assert.deepEqual(coupled, { mask, cap }, `rung ${i}`);
        assert.equal(progressRung(coupled.mask, coupled.cap), i, `rung ${i} round-trip`);
    });
});
