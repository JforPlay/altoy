import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBattleSim } from '../../public/js/engine/damage/battle-sim.js';

/** A ctx with no weapon events — timer-only skills. */
const ctx = (window = 78, events = []) => ({
  window,
  events,
  unit: { equipTypes: [], tags: new Set(), nationality: 0, shipType: 0, spEquipped: false, allyCount: 6 },
});

const g = (b, s) => ({ b, s });
const fireSkill = (wid) => ({ e: [{ ty: 'BattleSkillFire', a: { weapon_id: wid } }] });

test('one salvo raising several trigger names fires a matching edge ONCE', () => {
  // A cannon salvo raises onFire, onChargeWeaponFire, onChargeWeaponReady and
  // onWeaponSteday together. An edge listing two of them must not fire twice.
  const events = [{ t: 10, names: ['onFire', 'onChargeWeaponFire'], slot: 1, attr: 'cannon' }];
  const graph = g(
    { 1: { t: 0, e: [{ ty: 'BattleBuffCastSkill', tr: ['onFire', 'onChargeWeaponFire'], a: { skill_id: 9 } }] } },
    { 9: fireSkill(100) },
  );
  const { fired } = runBattleSim(['1'], ctx(78, events), graph);
  assert.equal(fired[0].activations, 1);
});

test('a plain onUpdate cast fires once per cooldown, opening one cooldown in', () => {
  const graph = g(
    { 1: { t: 0, e: [{ ty: 'BattleBuffCastSkill', tr: ['onUpdate'], a: { skill_id: 9, time: 20 } }] } },
    { 9: fireSkill(100) },
  );
  const { fired } = runBattleSim(['1'], ctx(78), graph);
  assert.equal(fired.length, 1);
  // enterCoolDown is armed at SetArgs with _nextEffectTime = now + time (no
  // initialCD), so the first cast is at t=20, then 40 and 60: three in 78s.
  assert.equal(Math.round(fired[0].activations), 3);
  assert.ok(Math.abs(fired[0].first - 20) < 0.1, `first at ${fired[0].first}`);
  assert.ok(Math.abs(fired[0].period - 20) < 0.5, `period ${fired[0].period}`);
});

test('initialCD arms the edge ready, so the first cast is at t=0', () => {
  const graph = g(
    { 1: { t: 0, e: [{ ty: 'BattleBuffCastSkill', tr: ['onUpdate'], a: { skill_id: 9, time: 20, initialCD: true } }] } },
    { 9: fireSkill(100) },
  );
  const { fired } = runBattleSim(['1'], ctx(78), graph);
  assert.equal(Math.round(fired[0].activations), 4);   // 0, 20, 40, 60
  assert.equal(fired[0].first, 0);
});

// castSkill rolls rant BEFORE enterCoolDown, so a failed roll costs no cooldown.
// onUpdate is raised every frame, so a failure retries next frame -> rant is very
// nearly a no-op here, NOT a multiply. The old barrage.js multiplied.
test('rant on an onUpdate cast widens the period by a frame or two, it does not scale the count', () => {
  const graph = g(
    { 1: { t: 0, e: [{ ty: 'BattleBuffCastSkill', tr: ['onUpdate'], a: { skill_id: 9, time: 20, rant: 7000 } }] } },
    { 9: fireSkill(100) },
  );
  const { fired } = runBattleSim(['1'], ctx(78), graph);
  // 0.7 x 3 = 2.1 would be the old answer. The truth is ~3.
  assert.ok(fired[0].activations > 2.8, `expected ~3, got ${fired[0].activations}`);
  assert.ok(fired[0].activations <= 3.05, `expected ~3, got ${fired[0].activations}`);
});

// The same scalar, on a trigger raised once per salvo, reproduces the OLD `fire`
// formula exactly: a failed roll costs one salvo gap, so the period is n + gap/p.
test('rant on an onFire cast widens the period by one gap per failure', () => {
  const events = [];
  for (let t = 0; t <= 78; t += 3) events.push({ t, names: ['onFire'], slot: 1, attr: 'cannon' });
  const graph = g(
    { 1: { t: 0, e: [{ ty: 'BattleBuffCastSkill', tr: ['onFire'], a: { skill_id: 9, time: 0, rant: 5000 } }] } },
    { 9: fireSkill(100) },
  );
  const { fired } = runBattleSim(['1'], ctx(78, events), graph);
  // No cooldown -> every salvo rolls -> 27 salvos x 0.5.
  assert.ok(Math.abs(fired[0].activations - 13.5) < 0.1, `got ${fired[0].activations}`);
});

// The period a proc-chance edge REPORTS, not just the count it produces. Downstream
// this is scored against the KR skill text's stated integer at +/-0.35s, so a period
// that is right without a rant and wrong with one fails the acceptance gate.
test('a proc-chance onUpdate edge still reports its real period, not one tick', () => {
  const mk = (rant) => g(
    { 1: { t: 0, e: [{ ty: 'BattleBuffCastSkill', tr: ['onUpdate'], a: { skill_id: 9, time: 20, ...(rant ? { rant } : {}) } }] } },
    { 9: fireSkill(100) },
  );
  assert.ok(Math.abs(runBattleSim(['1'], ctx(78), mk(0)).fired[0].period - 20) < 0.5);
  assert.ok(Math.abs(runBattleSim(['1'], ctx(78), mk(7000)).fired[0].period - 20) < 0.5);
});

// Same defect, coarser grain: a cooldown-gated FIRE edge accrues a sliver on every
// salvo while its availability converges, so measuring gives the salvo gap (3) rather
// than the cadence. The cooldown is the period, and it is also what the 「발사 시
// (재사용 N초)」 label wants. With no cooldown there is no cadence to report at all —
// 0 keeps the label a bare 「발사 시」 instead of inventing one from the salvo gap.
test('a fire edge reports its cooldown, and 0 when it has none', () => {
  const events = [];
  for (let t = 0; t <= 78; t += 3) events.push({ t, names: ['onFire'], slot: 1, attr: 'cannon' });
  const mk = (time) => g(
    { 1: { t: 0, e: [{ ty: 'BattleBuffCastSkill', tr: ['onFire'], a: { skill_id: 9, time, rant: 5000 } }] } },
    { 9: fireSkill(100) },
  );
  assert.equal(runBattleSim(['1'], ctx(78, events), mk(10)).fired[0].period, 10);
  assert.equal(runBattleSim(['1'], ctx(78, events), mk(0)).fired[0].period, 0);
});

// The convergence tail must terminate. Without an epsilon on `mass` the sim keeps
// scheduling a cooldown restore every tick for the rest of the battle.
// The proc chance here is 1%, NOT 70%: at a high chance the edge self-bounds and the
// test passes against the very bug it exists to catch. At 1% the cooldown replenishes
// `avail` faster than it can decay, so the edge re-fires every tick forever and each
// pending restore lives a whole cooldown. Measured with a flat restore list: 13.2 s.
test('proc-chance cooldown edges drain restores in O(1) per tick', () => {
  const b = {}, s = {};
  for (let k = 0; k < 50; k++) {
    b[k] = { t: 0, e: [{ ty: 'BattleBuffCastSkill', tr: ['onUpdate'], a: { skill_id: 1000 + k, time: 20, rant: 100 } }] };
    s[1000 + k] = fireSkill(100 + k);
  }
  const t0 = Date.now();
  const { fired } = runBattleSim(Object.keys(b), ctx(600), g(b, s));
  const ms = Date.now() - t0;
  assert.equal(fired.length, 50);
  assert.ok(fired[0].activations > 20, `expected ~25 activations, got ${fired[0].activations}`);
  assert.ok(ms < 3000, `50 proc-chance edges over 600s took ${ms}ms — restore drain is O(n) again`);
});

// ...while a cast whose cadence comes from the buff that RE-ADDS it has no `time` of
// its own, so its period must still be measured. Reading the cast's own `time` here
// is the 4x error the replaced heuristic made on 워싱턴.
test('an onAttach cast re-added on a period reports the PARENT period', () => {
  const graph = g(
    { 1: { t: 0, e: [{ ty: 'BattleBuffAddBuff', tr: ['onUpdate'], a: { buff_id: 2, time: 20 } }] },
      2: { t: 5, e: [{ ty: 'BattleBuffCastSkill', tr: ['onAttach'], a: { skill_id: 9 } }] } },
    { 9: fireSkill(100) },
  );
  assert.ok(Math.abs(runBattleSim(['1'], ctx(78), graph).fired[0].period - 20) < 0.5);
});

test('quota is spent in expected units and stops the edge', () => {
  const graph = g(
    { 1: { t: 0, e: [{ ty: 'BattleBuffCastSkill', tr: ['onUpdate'], a: { skill_id: 9, time: 20, quota: 1 } }] } },
    { 9: fireSkill(100) },
  );
  const { fired } = runBattleSim(['1'], ctx(78), graph);
  assert.equal(fired[0].activations, 1);
});

test('a buff lifetime bounds its casts, and 0 means never expires', () => {
  const mk = (life) => g(
    { 1: { t: 0, e: [{ ty: 'BattleBuffAddBuff', tr: ['onStartGame'], a: { buff_id: 2 } }] },
      2: { t: life, e: [{ ty: 'BattleBuffCastSkill', tr: ['onUpdate'], a: { skill_id: 9, time: 10, initialCD: true } }] } },
    { 9: fireSkill(100) },
  );
  assert.equal(Math.round(runBattleSim(['1'], ctx(78), mk(25)).fired[0].activations), 3);   // 0, 10, 20
  assert.equal(Math.round(runBattleSim(['1'], ctx(78), mk(0)).fired[0].activations), 8);    // 0..70
});

// The AddBuff's `time` is a CADENCE, the buff's own `time` is its LIFETIME. Reading
// the wrong one is the 4x error CLAUDE.md records for 워싱턴 11000.
test('an onUpdate AddBuff re-adds on ITS OWN period, giving the child a fresh quota', () => {
  const graph = g(
    { 1: { t: 0, e: [{ ty: 'BattleBuffAddBuff', tr: ['onUpdate'], a: { buff_id: 2, time: 20 } }] },
      2: { t: 1, e: [{ ty: 'BattleBuffCastSkill', tr: ['onAttach'], a: { skill_id: 9, quota: 1 } }] } },
    { 9: fireSkill(100) },
  );
  const { fired } = runBattleSim(['1'], ctx(78), graph);
  assert.equal(Math.round(fired[0].activations), 3);   // re-added at 20, 40, 60
});

test('rant on an AddBuff scales everything the child buff casts', () => {
  const graph = g(
    { 1: { t: 0, e: [{ ty: 'BattleBuffAddBuff', tr: ['onStartGame'], a: { buff_id: 2, rant: 5000 } }] },
      2: { t: 0, e: [{ ty: 'BattleBuffCastSkill', tr: ['onUpdate'], a: { skill_id: 9, time: 20, initialCD: true } }] } },
    { 9: fireSkill(100) },
  );
  const { fired } = runBattleSim(['1'], ctx(78), graph);
  assert.ok(Math.abs(fired[0].activations - 2) < 0.05, `got ${fired[0].activations}`);   // 4 x 0.5
});

test('a root that fires nothing returns no rows and is not blocked', () => {
  const graph = g({ 1: { t: 0, e: [{ ty: 'BattleBuffAddTag', tr: ['onStartGame'], a: { tag: 'X' } }] } }, {});
  const { fired, blocked } = runBattleSim(['1'], ctx(78), graph);
  assert.deepEqual(fired, []);
  assert.deepEqual(blocked, []);
});

test('a count trigger fires every countTarget salvos, on its own slot only', () => {
  const events = [];
  for (let t = 0; t <= 78; t += 3) events.push({ t, names: ['onFire'], slot: 1, attr: 'cannon' });
  for (let t = 0; t <= 78; t += 2) events.push({ t, names: ['onFire'], slot: 2, attr: 'cannon' });
  const graph = g(
    { 1: { t: 0, e: [
      { ty: 'BattleBuffCount', tr: ['onFire'], a: { countType: 700, countTarget: 15, index: [1] } },
      { ty: 'BattleBuffCastSkill', tr: ['onBattleBuffCount'], a: { countType: 700, skill_id: 9 } },
    ] } },
    { 9: fireSkill(100) },
  );
  const { fired } = runBattleSim(['1'], ctx(78, events), graph);
  // 27 slot-1 salvos / 15 = 1. Slot 2's 40 salvos must not count.
  assert.equal(Math.round(fired[0].activations), 1);
});

// BattleBuffCastSkillRandom rolls ONCE and casts exactly one of skill_id_list,
// weighted by the `range` bands. Emitting each alternative at the parent's cadence
// multiplies the barrage by the list length — the 2B 117034/5/6 bug.
// Bands are 0-1 FRACTIONS in the corpus (68 of the 70 non-empty ones), not basis
// points. Using the real convention is what makes this test able to tell the span rule
// (`bands[last][1]`) from a hardcoded 10000 denominator — under a fraction convention
// the latter would give shares of ~0.00003.
test('a random cast splits its mass across the list by band width', () => {
  const mk = (range) => g(
    { 1: { t: 0, e: [{ ty: 'BattleBuffCastSkillRandom', tr: ['onUpdate'],
                       a: { skill_id_list: [9, 8], range, time: 20, initialCD: true } }] } },
    { 9: fireSkill(100), 8: fireSkill(200) },
  );
  const by = (range) => Object.fromEntries(
    runBattleSim(['1'], ctx(78), mk(range)).fired.map((r) => [r.weaponId, r.activations]));

  const full = by([[0, 0.3], [0.3, 1]]);
  assert.ok(Math.abs(full[100] - 1.2) < 0.05, `w100 ${full[100]}`);   // 4 casts x 0.30
  assert.ok(Math.abs(full[200] - 2.8) < 0.05, `w200 ${full[200]}`);   // 4 casts x 0.70

  // A span that is not the whole probability space: the uncovered share is a real
  // proc miss and must NOT be renormalised away.
  const part = by([[0, 0.25], [0.25, 0.5]]);
  assert.ok(Math.abs(part[100] - 1.0) < 0.05, `w100 ${part[100]}`);   // 4 x 0.25
  assert.ok(Math.abs(part[200] - 1.0) < 0.05, `w200 ${part[200]}`);   // 4 x 0.25

  // A band running past 1 is the corpus's one data typo (buff 152051). The engine
  // fires it on any roll >= its lower bound, so its probability is the overlap with
  // [0,1) — 0.67 here, not the raw width and not a clamped 1.0.
  const over = by([[0, 0.33], [0.33, 66]]);
  assert.ok(Math.abs(over[200] - 4 * 0.67) < 0.05, `w200 ${over[200]}`);
});

// battlebuffcount.lua:98 — an onStack counter reads GetStack(), it does not tally.
// 92 records in the published graph do this, all on buffs with a stack cap above 1.
test('an onStack counter reads the stack LEVEL, not the number of stack events', () => {
  // buff 2 is re-added every 10s and lives 60s, so it stacks 1,2,3 and caps at 3.
  const graph = g(
    { 1: { t: 0, e: [{ ty: 'BattleBuffAddBuff', tr: ['onUpdate'], a: { buff_id: 2, time: 10, initialCD: true } }] },
      2: { t: 60, s: 3, e: [
        { ty: 'BattleBuffCount', tr: ['onStack'], a: { countType: 900, countTarget: 3 } },
        { ty: 'BattleBuffCastSkill', tr: ['onBattleBuffCount'], a: { countType: 900, skill_id: 9 } },
      ] } },
    { 9: fireSkill(100) },
  );
  const { fired } = runBattleSim(['1'], ctx(78), graph);
  // Stacks reach the cap of 3 at t=20 and STAY there, so every later re-add re-reads 3
  // and fires again: one activation per re-add from t=20 to t=60 (the buff's life).
  // A tally would instead reset to 0 at each threshold and fire only every 3rd event.
  assert.ok(fired.length === 1, 'one weapon row expected');
  assert.ok(fired[0].activations >= 5,
    `stack-level read should fire on every re-add past the cap, got ${fired[0].activations}`);
});

// battlebuffaddtag.lua overrides exactly two methods, onAttach and onRemove, so those
// are the only triggers that touch a tag; every other name falls through to
// BattleBuffEffect, whose onTrigger only decrements quota. All 342 AddTag effects in
// the published graph are `onAttach` (277 of them also `onRemove`), so the fixture uses
// the shape the corpus actually has.
test('a stamped tag is visible to a later gate in the same run', () => {
  const graph = g(
    { 1: { t: 0, e: [
      { ty: 'BattleBuffAddTag', tr: ['onAttach'], a: { tag: 'MyTag' } },
      { ty: 'BattleBuffCastSkill', tr: ['onUpdate'],
        a: { skill_id: 9, time: 20, initialCD: true, check_target: ['TargetSelf', 'TargetShipTag'],
             ship_tag_list: ['MyTag'], minTargetNumber: 1 } },
    ] } },
    { 9: fireSkill(100) },
  );
  const { fired } = runBattleSim(['1'], ctx(78), graph);
  assert.equal(Math.round(fired[0].activations), 4);
});

// A TAG LIVES EXACTLY AS LONG AS THE BUFF HOLDING IT (battlebuffaddtag.lua: onAttach ->
// AddLabelTag, onRemove -> RemoveLabelTag). Treated as permanent, a one-second window
// becomes the whole battle: 드미트리 돈스코이 180000/190000 gate an uncooled onUpdate
// cast on `xietongdaji`, stamped by a 1 s buff, and read 2251 casts for a 78 s fight.
test('a tag expires with the buff that stamped it', () => {
  const graph = g(
    // buff 2 stamps the tag for 5s and is never re-added; the gated cast is armed
    // ready and would otherwise fire at 0/20/40/60.
    { 1: { t: 0, e: [
      { ty: 'BattleBuffAddBuff', tr: ['onStartGame'], a: { buff_id: 2 } },
      { ty: 'BattleBuffCastSkill', tr: ['onUpdate'],
        a: { skill_id: 9, time: 20, initialCD: true, check_target: ['TargetSelf', 'TargetShipTag'],
             ship_tag_list: ['MyTag'], minTargetNumber: 1 } },
    ] },
      2: { t: 5, e: [{ ty: 'BattleBuffAddTag', tr: ['onAttach', 'onRemove'], a: { tag: 'MyTag' } }] } },
    { 9: fireSkill(100) },
  );
  const { fired } = runBattleSim(['1'], ctx(78), graph);
  assert.equal(Math.round(fired[0].activations), 1, 't=0 only; the tag is gone by t=20');
});

// battleunit.lua keeps a MULTISET — _labelTagList plus a per-tag counter — so two live
// holders of one tag survive either one expiring. A boolean would clear it at the first
// onRemove and silently shorten every overlapping stamp.
test('two buffs stamping one tag: the tag outlives the shorter one', () => {
  const graph = g(
    { 1: { t: 0, e: [
      { ty: 'BattleBuffAddBuff', tr: ['onStartGame'], a: { buff_id: 2 } },
      { ty: 'BattleBuffAddBuff', tr: ['onStartGame'], a: { buff_id: 3 } },
      { ty: 'BattleBuffCastSkill', tr: ['onUpdate'],
        a: { skill_id: 9, time: 20, initialCD: true, check_target: ['TargetSelf', 'TargetShipTag'],
             ship_tag_list: ['MyTag'], minTargetNumber: 1 } },
    ] },
      2: { t: 5, e: [{ ty: 'BattleBuffAddTag', tr: ['onAttach', 'onRemove'], a: { tag: 'MyTag' } }] },
      3: { t: 50, e: [{ ty: 'BattleBuffAddTag', tr: ['onAttach', 'onRemove'], a: { tag: 'MyTag' } }] } },
    { 9: fireSkill(100) },
  );
  const { fired } = runBattleSim(['1'], ctx(78), graph);
  // The 5s holder expiring must not clear what the 50s one still holds: 0/20/40 fire,
  // 60 does not. A boolean tag gives 1, a permanent one gives 4.
  assert.equal(Math.round(fired[0].activations), 3, `0/20/40, got ${fired[0].activations}`);
});

// A LOCKOUT tag is the same mechanism read backwards — `maxTargetNumber: 0` passes only
// while the tag is ABSENT — so a stuck tag SILENCES a barrage instead of inflating one.
// 패서디나 151820 is the case: her 10s `Pasadena_NOTCoolDown` fired once in 78s.
test('a lockout tag releases when its holder expires', () => {
  const graph = g(
    { 1: { t: 0, e: [
      { ty: 'BattleBuffCastSkill', tr: ['onUpdate'],
        a: { skill_id: 9, check_target: ['TargetSelf', 'TargetShipTag'],
             ship_tag_list: ['Lockout'], maxTargetNumber: 0 } },
    ] },
      2: { t: 10, e: [{ ty: 'BattleBuffAddTag', tr: ['onAttach', 'onRemove'], a: { tag: 'Lockout' } }] } },
    // Firing arms the 10s lockout, so the cast re-opens every 10s: 0/10/20...70 = 8.
    { 9: { e: [{ ty: 'BattleSkillFire', a: { weapon_id: 100 } },
      { ty: 'BattleSkillAddBuff', a: { buff_id: 2 } }] } },
  );
  const { fired } = runBattleSim(['1'], ctx(78), graph);
  assert.equal(Math.round(fired[0].activations), 8,
    `a permanent tag fires once, got ${fired[0].activations}`);
});

// ---------------------------------------------------------------------------
// The three defects the KR-text gate found (2026-08-30). Each of these fails if
// its fix is reverted; that was checked by reverting, not by reading.
// ---------------------------------------------------------------------------

// Defect 3a. BattleBuffCancelBuff is what BOUNDS a loop: `count` (default 99999, and a
// literal 0 stays 0 — Lua's `or` only replaces nil) counts down per trigger and at <= 0
// cancels THE BUFF HOLDING IT, at now+`delay`. 애버크롬비 11300 is the shape: two
// onUpdate adders with time:15 plus {count:0, delay:16}, so the cancel at t=16 makes
// both adders one-shot openers and buff_11301 then re-adds the caster every 20 s —
// 15/35/55/75, the prose's 「전투 개시 15초 후에 … 그 뒤 20초마다」. Without the cancel
// the 15 s adder never stops (15/30/35/45/55/60/75) and the barrage over-counts by 75%.
test('a delayed BattleBuffCancelBuff turns a periodic adder into a one-shot opener', () => {
  const graph = g(
    { 1: { t: 0, e: [
      { ty: 'BattleBuffAddBuff', tr: ['onUpdate'], a: { buff_id: 2, time: 15 } },
      { ty: 'BattleBuffAddBuff', tr: ['onUpdate'], a: { buff_id: 3, time: 15 } },
      { ty: 'BattleBuffCancelBuff', tr: ['onUpdate'], a: { count: 0, delay: 16 } },
    ] },
      3: { t: 0, e: [{ ty: 'BattleBuffAddBuff', tr: ['onUpdate'], a: { buff_id: 2, time: 20 } }] },
      2: { t: 5, e: [{ ty: 'BattleBuffCastSkill', tr: ['onAttach'], a: { skill_id: 9 } }] } },
    { 9: fireSkill(100) },
  );
  const row = runBattleSim(['1'], ctx(78), graph).fired[0];
  assert.equal(Math.round(row.activations), 4, `15/35/55/75, got ${row.activations}`);
  assert.ok(Math.abs(row.first - 15) < 0.05, `first at ${row.first}`);
  assert.ok(Math.abs(row.period - 20) < 0.05, `period ${row.period}`);
});

// Defect 3b. BattleBuffCleanse strips its `buff_id_list` FROM THE UNIT, so unlike the
// cancel above it can end a loop it does not hold. 꼬마 다이호 16800: buff_16802 stacks
// to 6, its onStack counter fires there and the cleanse removes 16801 AND 16802 — the
// prose's 「총 6회의 함재기 공격을 소환할 때까지」. Dropped, BOTH halves break in opposite
// directions: the plane loop runs every second for the rest of the battle, and the
// 사이운 opener fires once instead of every 20 s, because a buff that is never removed
// can only Stack() and its onAttach never runs again.
test('a BattleBuffCleanse at a count threshold ends the loop, and lets the opener re-arm', () => {
  const graph = g(
    { 1: { t: 0, e: [{ ty: 'BattleBuffAddBuff', tr: ['onUpdate'], a: { buff_id: 2, time: 20 } }] },
      2: { t: 0, e: [
        { ty: 'BattleBuffAddBuff', tr: ['onUpdate'], a: { buff_id: 3, time: 1 } },
        { ty: 'BattleBuffCastSkill', tr: ['onAttach'], a: { skill_id: 9, quota: 1 } },
      ] },
      3: { t: 0, s: 6, e: [
        { ty: 'BattleBuffCastSkill', tr: ['onAttach', 'onStack'], a: { skill_id: 8 } },
        { ty: 'BattleBuffCount', tr: ['onAttach', 'onStack'], a: { countType: 700, countTarget: 6 } },
        { ty: 'BattleBuffCleanse', tr: ['onBattleBuffCount'], a: { countType: 700, buff_id_list: [2, 3] } },
      ] } },
    { 9: fireSkill(100), 8: fireSkill(200) },
  );
  const { fired } = runBattleSim(['1'], ctx(78), graph);
  // The planes ride two rows — the cycle's first is an onAttach, the other five are
  // onStack — so this sums per weapon rather than picking a row.
  const total = (w) => fired.filter((r) => r.weaponId === w)
    .reduce((n, r) => n + r.activations, 0);
  // Three cycles at 20/40/60, six planes each (t+1 … t+6) and one opener apiece.
  assert.equal(Math.round(total(200)), 18, `six per cycle, got ${total(200)}`);
  assert.equal(Math.round(total(100)), 3, `opener per cycle, got ${total(100)}`);
  const opener = fired.find((r) => r.weaponId === 100);
  assert.ok(Math.abs(opener.period - 20) < 0.05, `opener period ${opener.period}`);
});

// Defect 1. A cast with a finite QUOTA cannot fire twice on its own cooldown per
// attachment, so its `time` is a stagger offset, not a cadence — the barrage repeats at
// whatever RE-ADDS the holder. 르 말랭 13770's buff_13771 (life 3.1) carries
// {time:1, quota:1} and {time:2, quota:1} casts of one staggered launcher re-added every
// 20 s: firings at 21/22, 41/42, 61/62. Reading `a.time` labels it 「2초마다」 and a mean
// over all six gaps reads 8.2; the between-burst gap is the prose's 20.
test('a quota-bounded stagger reports the cadence that RE-ADDS it, not its own offset', () => {
  const graph = g(
    { 1: { t: 0, e: [{ ty: 'BattleBuffCastSkill', tr: ['onUpdate'], a: { skill_id: 9, time: 20 } }] },
      2: { t: 3.1, e: [
        { ty: 'BattleBuffCastSkill', tr: ['onUpdate'], a: { skill_id: 8, time: 1, quota: 1 } },
        { ty: 'BattleBuffCastSkill', tr: ['onUpdate'], a: { skill_id: 8, time: 2, quota: 1 } },
      ] } },
    { 9: { e: [{ ty: 'BattleSkillAddBuff', a: { buff_id: 2 } }] }, 8: fireSkill(100) },
  );
  const row = runBattleSim(['1'], ctx(78), graph).fired[0];
  assert.equal(Math.round(row.activations), 6, `two per cycle x three, got ${row.activations}`);
  assert.ok(Math.abs(row.period - 20) < 0.05, `period ${row.period}`);
});

// Defect 2. addBuff RAISES onAttach/onStack, so a cast reached through
// count -> AddBuff -> the child's onAttach used to lose the count context entirely.
// 안샨 29801 「주포로 16회 공격할 때마다」 is that shape: the COUNT was always right — 48 s
// is exactly 16 salvos at the nominal 3 s gap — and only the label was gone, leaving a
// row that read as a one-shot with nothing for 「주포 N회마다」 to be built from.
test('a count threshold survives an AddBuff hop into the child onAttach', () => {
  const events = [];
  for (let t = 3; t <= 78; t += 3) events.push({ t, names: ['onFire'], slot: 1, attr: 'cannon' });
  const graph = g(
    { 1: { t: 0, e: [
      { ty: 'BattleBuffCount', tr: ['onFire'], a: { countType: 700, countTarget: 16, index: [1] } },
      { ty: 'BattleBuffAddBuff', tr: ['onBattleBuffCount'], a: { buff_id: 2, countType: 700 } },
    ] },
      2: { t: 3, e: [{ ty: 'BattleBuffCastSkill', tr: ['onAttach'], a: { skill_id: 9 } }] } },
    { 9: fireSkill(100) },
  );
  const row = runBattleSim(['1'], ctx(78, events), graph).fired[0];
  assert.equal(row.trigger, 'onBattleBuffCount', 'the row answers the count, not the attach');
  assert.equal(row.countTarget, 16);
  assert.equal(row.slot, 1);
  assert.equal(Math.round(row.activations), 1);
  assert.ok(Math.abs(row.first - 48) < 0.05, `16 salvos at 3s = 48, got ${row.first}`);
});

// ...and the equipIndex filter must NOT ride along on that hop. battlebuffeffect.lua
// checks equipIndexRequire in the WEAPON-event wrappers (onFire / onBulletHit / onCombo
// read `slot3.equipIndex`); onAttach, onStack and onBattleBuffCount carry no equipIndex
// and their wrappers never call it. 38 onAttach edges in the published graph carry an
// `index`, and without this scope they would start being filtered against whatever slot
// the originating salvo came from.
test('a threaded event does not apply its slot filter to an onAttach edge', () => {
  const events = [{ t: 10, names: ['onFire'], slot: 1, attr: 'cannon' }];
  const graph = g(
    { 1: { t: 0, e: [{ ty: 'BattleBuffAddBuff', tr: ['onFire'], a: { buff_id: 2 } }] },
      2: { t: 0, e: [{ ty: 'BattleBuffCastSkill', tr: ['onAttach'], a: { skill_id: 9, index: [3] } }] } },
    { 9: fireSkill(100) },
  );
  const { fired } = runBattleSim(['1'], ctx(78, events), graph);
  assert.equal(fired.length, 1, 'the onAttach cast fires despite naming another slot');
});

// A cast on onBattleBuffCount LOOKS raised, so a counter that can never reach its
// threshold used to hide behind it: the root produced no rows and was not disclosed,
// landing in 「현재 편성에서 발동하지 않는」 when the honest note is 「발동 조건이 아직
// 구현되지 않은」. 비토리오 쿠니베르티 18950 is the case — 「이 특수 탄막이 적에게 10회
// 명중할 때마다」 counts on onBulletCollide, battlefield state this sim never raises.
test('a cast behind a counter on an unraised trigger is disclosed, not silently zero', () => {
  const mk = (countTrigger) => g(
    { 1: { t: 0, e: [
      { ty: 'BattleBuffCount', tr: [countTrigger], a: { countType: 700, countTarget: 2 } },
      { ty: 'BattleBuffCastSkill', tr: ['onBattleBuffCount'], a: { countType: 700, skill_id: 9 } },
    ] } },
    { 9: fireSkill(100) },
  );
  const events = [];
  for (let t = 3; t <= 78; t += 3) events.push({ t, names: ['onFire'], slot: 1, attr: 'cannon' });

  const dead = runBattleSim(['1'], ctx(78, events), mk('onBulletCollide'));
  assert.deepEqual(dead.fired, [], 'the counter can never reach its threshold');
  assert.deepEqual(dead.blocked, ['1'], 'and that must be DISCLOSED, not silently zero');

  // ...and only when the counter really is dead: the same shape on a raised trigger
  // fires and must not be disclosed, or the rule would disclose every count skill.
  const live = runBattleSim(['1'], ctx(78, events), mk('onFire'));
  assert.ok(live.fired.length, 'a live counter still fires');
  assert.deepEqual(live.blocked, [], 'a live counter is not disclosed');
});
