import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseInvestment, investedCost, nextBreakCost, sumInvestment, rosterTotal,
    BREAK_LEVELS, applyCapChange, applyMaskChange, MEMO_MAX,
    PROGRESS_RUNGS, RUNG_LABELS, progressRung, stepRung,
} from '../../public/js/shipgirl/tracker-investment.js';
import { SHEET_PROGRESS, SHEET_STATES } from '../../public/js/shipgirl/tracker-sheet-codec.js';

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

test('applyCapChange: cap>=1 forces get; cap>=4 sets level+풀돌, cap<4 clears level', () => {
    assert.deepEqual(applyCapChange(5, 4), { mask: 7, cap: 4 }); // 120 cap == Lv120 달성
    assert.deepEqual(applyCapChange(0, 5), { mask: 7, cap: 5 });
    assert.deepEqual(applyCapChange(0, 2), { mask: 1, cap: 2 }); // partial cap: 보유 only
    assert.deepEqual(applyCapChange(7, 3), { mask: 5, cap: 3 }); // level bit cleared, 풀돌 kept
    assert.deepEqual(applyCapChange(7, 4), { mask: 7, cap: 4 });
    assert.deepEqual(applyCapChange(5, 0), { mask: 5, cap: 0 }); // 풀돌 stays
    // Clearing the cap never clears 풀돌 — the two are independent facts now.
    assert.deepEqual(applyCapChange(3, 0), { mask: 1, cap: 0 });
});

test('applyMaskChange couples per changed control', () => {
    // check 120 달성 -> cap>=4, get+upgrade forced (the forward rule)
    assert.deepEqual(applyMaskChange(2, 0, 'level', true), { mask: 7, cap: 4 });
    assert.deepEqual(applyMaskChange(7, 5, 'level', true), { mask: 7, cap: 5 }); // cap 5 kept
    // uncheck 120 달성 -> the 유닛 breaks that bought it go with it
    assert.deepEqual(applyMaskChange(5, 4, 'level', false), { mask: 5, cap: 0 });
    assert.deepEqual(applyMaskChange(5, 0, 'level', false), { mask: 5, cap: 0 });
    // uncheck 보유 -> everything down (caller already cleared level/upgrade bits)
    assert.deepEqual(applyMaskChange(0, 3, 'get', false), { mask: 0, cap: 0 });
    // plain checks don't invent caps
    assert.deepEqual(applyMaskChange(1, 0, 'get', true), { mask: 1, cap: 0 });
    assert.deepEqual(applyMaskChange(5, 0, 'upgrade', true), { mask: 5, cap: 0 });
});

test('풀돌 is orthogonal: unchecking it leaves Lv120 and the cap alone', () => {
    // The whole point. A META/UR/PR ship reaches Lv120 without 한계돌파, so
    // dropping 풀돌 must not drop the level bit or the 성정 유닛 record with it.
    assert.deepEqual(applyMaskChange(3, 4, 'upgrade', false), { mask: 3, cap: 4 });
    assert.deepEqual(applyMaskChange(3, 5, 'upgrade', false), { mask: 3, cap: 5 });
    // ...and that state survives any later touch on another control.
    assert.deepEqual(applyMaskChange(3, 4, 'get', true), { mask: 3, cap: 4 });
    assert.equal(progressRung(3, 4), 2); // still reads Lv120
});

test('a level bit with no cap survives — research-tracker interop', () => {
    // research-tracker.js writes the same 3-bit mask but never writes a cap, so
    // a Lv120 set there arrives here as {mask:3, cap:0}. It used to be wiped by
    // the trailing `if (cap < 4) mask &= ~LEVEL`; nothing may clear it now.
    for (const type of ['get', 'upgrade']) {
        assert.deepEqual(applyMaskChange(3, 0, type, true), { mask: 3, cap: 0 }, type);
    }
    assert.equal(progressRung(3, 0), 2);
});

// ===== 요약 wall ladder =====

test('PROGRESS_RUNGS is the level axis the sheet codec composes over', () => {
    // The rungs measure level only; the sheet's 5 values are (rung × 풀돌)
    // pairs. If SHEET_STATES ever names a rung the table doesn't have,
    // importing "120" and clicking the 120 stop stop meaning the same thing —
    // the exact bug the shared table exists to prevent.
    assert.equal(RUNG_LABELS.length, PROGRESS_RUNGS.length);
    assert.equal(SHEET_STATES.length, SHEET_PROGRESS.length);
    SHEET_STATES.forEach(({ rung }, i) => {
        assert.ok(PROGRESS_RUNGS[rung], `sheet value ${SHEET_PROGRESS[i]} -> rung ${rung}`);
    });
    // Every rung round-trips through progressRung.
    PROGRESS_RUNGS.forEach(({ mask, cap }, i) => {
        assert.equal(progressRung(mask, cap), i, `rung ${i}`);
    });
});

test('the sheet still imports its five values to the masks it always did', () => {
    // The sheet is import-only and stays unchanged, so this mapping is frozen:
    // 미획득 / 획득 / 풀돌 / 120 / 125.
    const composed = SHEET_STATES.map(({ rung, upgrade }) => ({
        mask: PROGRESS_RUNGS[rung].mask | (upgrade ? 4 : 0),
        cap: PROGRESS_RUNGS[rung].cap,
    }));
    assert.deepEqual(composed, [
        { mask: 0, cap: 0 },
        { mask: 1, cap: 0 },
        { mask: 5, cap: 0 },
        { mask: 7, cap: 4 },
        { mask: 7, cap: 5 },
    ]);
});

test('progressRung: level axis only, tolerant of off-ladder state', () => {
    assert.equal(progressRung(0, 0), 0);
    assert.equal(progressRung(1, 0), 1);          // 보유
    assert.equal(progressRung(5, 0), 1);          // 풀돌 is off the ladder -> still 보유
    assert.equal(progressRung(7, 4), 2);          // Lv120
    assert.equal(progressRung(7, 5), 3);          // Lv125
    assert.equal(progressRung(3, 4), 2);          // Lv120 without 풀돌 — the new state
    // Caps 1-3 are unsettable in the UI but importable; they buy no rung.
    assert.equal(progressRung(5, 1), 1);
    assert.equal(progressRung(5, 3), 1);
    // The Lv120 weld reads from either side, so a legacy record missing one
    // half still lands on its rung instead of falling off the ladder.
    assert.equal(progressRung(5, 4), 2);          // cap, no level bit
    assert.equal(progressRung(3, 0), 2);          // level bit, no cap
    assert.equal(progressRung(5, 5), 3);
    // Tolerates a missing cap entirely (undefined/null records).
    assert.equal(progressRung(1, undefined), 1);
    assert.equal(progressRung(7, null), 2);
});

test('stepRung: clamps at both ends and lands on canonical state', () => {
    assert.deepEqual(stepRung(0, 0, 1), { mask: 1, cap: 0, rung: 1 });
    assert.deepEqual(stepRung(1, 0, 1), { mask: 7, cap: 4, rung: 2 });
    assert.deepEqual(stepRung(7, 4, 1), { mask: 7, cap: 5, rung: 3 });
    assert.deepEqual(stepRung(7, 5, 1), { mask: 7, cap: 5, rung: 3 }); // clamped at top
    assert.deepEqual(stepRung(7, 5, -1), { mask: 7, cap: 4, rung: 2 });
    assert.deepEqual(stepRung(0, 0, -1), { mask: 0, cap: 0, rung: 0 }); // clamped at bottom
    // Stepping normalises an off-ladder cap: 110 buys no rung, so up lands on
    // Lv120 and drops the orphan cap rather than preserving it.
    assert.deepEqual(stepRung(5, 2, 1), { mask: 7, cap: 4, rung: 2 });
    assert.deepEqual(stepRung(5, 2, -1), { mask: 0, cap: 0, rung: 0 });
});

test('stepRung carries 풀돌 through, adds it going up into Lv120, clears it at 미획득', () => {
    // A META ship the user deliberately un-풀돌'd must survive a wall sweep in
    // both directions — trampling that is the bug the 4-rung ladder exists to
    // avoid. mask 3 = 보유+Lv120, no 풀돌.
    assert.deepEqual(stepRung(3, 4, -1), { mask: 1, cap: 0, rung: 1 }); // down: preserved
    assert.deepEqual(stepRung(3, 4, 1), { mask: 3, cap: 5, rung: 3 });  // up:   preserved
    assert.deepEqual(stepRung(3, 5, -1), { mask: 3, cap: 4, rung: 2 }); // 125 -> 120
    // Entering Lv120 from below applies the same forward rule the checkbox does.
    assert.deepEqual(stepRung(1, 0, 1), { mask: 7, cap: 4, rung: 2 });
    // 미획득 clears everything — an unowned ship cannot be 풀돌.
    assert.deepEqual(stepRung(5, 0, -1), { mask: 0, cap: 0, rung: 0 });
});

test('stepRung never mutates or aliases the shared table', () => {
    const before = JSON.stringify(PROGRESS_RUNGS);
    const got = stepRung(0, 0, 1);
    got.cap = 99;
    assert.equal(PROGRESS_RUNGS[1].cap, 0);
    assert.equal(JSON.stringify(PROGRESS_RUNGS), before);
});

test('every rung is a fixed point of applyCapChange on the level axis', () => {
    // The wall lands directly on PROGRESS_RUNGS states; the 육성 레벨 bar routes
    // the same states through applyCapChange. A rung that is not a fixed point
    // would make the two controls disagree about the same ship.
    // applyCapChange may only ADD the 풀돌 bit (the forward rule); it may never
    // change the rung or the cap.
    const UPGRADE = 4;
    PROGRESS_RUNGS.forEach(({ mask, cap }, i) => {
        const coupled = applyCapChange(mask, cap);
        assert.equal(coupled.cap, cap, `rung ${i} cap`);
        assert.equal(coupled.mask & ~UPGRADE, mask, `rung ${i} level bits`);
        assert.equal(progressRung(coupled.mask, coupled.cap), i, `rung ${i} round-trip`);
    });
});
