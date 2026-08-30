import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runBattleSim } from '../../public/js/engine/damage/battle-sim.js';
import { weaponEvents } from '../../public/js/simulators/fleet-sim.damage.js';

const graph = JSON.parse(readFileSync(new URL('../../public/data/sim/fleet_sim_graph.json', import.meta.url)));

/** A 78s window (a META 80s limit minus the 2s approach) with a main gun on slot 1. */
function ctx({ window = 78, mainGunEvery = 3, equipTypes = [1, 6, 8], spEquipped = false, tags = [] } = {}) {
  const events = [];
  // ONE event per salvo carrying every name it raises — an edge listing two of
  // them must fire once, not once per name.
  for (let t = mainGunEvery; t <= window; t += mainGunEvery) {
    events.push({ t, names: ['onFire', 'onChargeWeaponFire', 'onChargeWeaponReady', 'onWeaponSteday'],
                  slot: 1, attr: 'cannon' });
  }
  return { window, events,
    unit: { equipTypes, nationality: 3, shipType: 4, spEquipped, allyCount: 6, tags } };
}

const sum = (rows) => rows.reduce((n, r) => n + r.activations, 0);

test('재블린 29081 fires every 15 main-gun salvos', () => {
  const { fired } = runBattleSim(['29081'], ctx(), graph);
  // 26 salvos in 78s at one every 3s -> floor(26/15) = 1.
  assert.equal(Math.round(sum(fired)), 1);
  assert.ok(fired.some((r) => r.weaponId === 79081), 'fires weapon 79081');
});

// The 8-vs-4 fork is check_weapon type:[3] vs type:[11]. Both arms ship today
// because the extractor cannot tell which one a loadout takes.
test('크론시타트 15290 takes the 4-salvo arm only with a type-11 gun', () => {
  const eight = runBattleSim(['15290'], ctx({ equipTypes: [3, 6, 8] }), graph);
  const four = runBattleSim(['15290'], ctx({ equipTypes: [11, 6, 8] }), graph);
  assert.ok(sum(four.fired) > sum(eight.fired) * 1.5,
    `4-salvo arm should fire ~2x as often: ${sum(four.fired)} vs ${sum(eight.fired)}`);
});

// The record format holds ONE trigger and ONE weapon list. Her upgraded skill fires
// TWO barrages on two cadences, so the shipped record is branch 1 only.
test('워싱턴 1011000 fires BOTH branches', () => {
  const { fired } = runBattleSim(['1011000'], ctx({ spEquipped: true }), graph);
  const branch1 = fired.filter((r) => r.weaponId === 165400);
  const branch2 = fired.filter((r) => r.weaponId === 66390 || r.weaponId === 66410);
  assert.ok(branch1.length, 'branch 1 (경사 탄막, weapon 165400) missing');
  assert.ok(branch2.length, 'branch 2 (강력한 탄막, skill_11001) missing');
  // Branch 1: opener at 10s then every 20s -> 10, 30, 50, 70 = 4.
  assert.ok(Math.abs(sum(branch1) - 4) < 0.6, `branch 1 ~4, got ${sum(branch1)}`);
  // Branch 2: every 20s at rant 7000 on an onAttach cast (no cooldown) -> ~0.7 each.
  assert.ok(sum(branch2) > 0.5, `branch 2 should fire, got ${sum(branch2)}`);
});

// The BB56SPweapon tag is NOT "has the 전용 장비" — buff_11008 stamps it for 15s and
// buff_1011000 adds that buff on onBulletKill from weapons 165391..165400, so it means
// "the 경사 탄막 just got a kill". The sim never raises onBulletKill, so the tag is
// never present and branch 2 must take the maxTargetNumber:0 arm (buff_1011007 ->
// skill_11001 at 70%), not the minTargetNumber:1 one (buff_11007 -> skill_1011003).
test('워싱턴 1011000 branch 2 takes the no-kill-state arm, not the kill-state one', () => {
  const { fired } = runBattleSim(['1011000'], ctx({ spEquipped: true }), graph);
  const ids = new Set(fired.map((r) => r.weaponId));
  assert.ok(ids.has(66390) || ids.has(66410), 'skill_11001 arm (강력한 탄막) must fire');
  // The kill-state arm casts skill_1011003; its weapons must be absent.
  const killArm = (graph.s['1011003']?.e || [])
    .filter((e) => e.ty === 'BattleSkillFire').map((e) => e.a.weapon_id);
  for (const w of killArm) assert.ok(!ids.has(w), `kill-state weapon ${w} must not fire`);
});

// 150026 is `onUpdate time:0.2 quota:8` inside a 5s holder — the 8-volley burst the
// {t,w} record format cannot express and CLAUDE.md books as an accepted under-count.
test('알자스 150020 reaches its burst, at 8 volleys per attachment', () => {
  const { fired } = runBattleSim(['150020'], ctx({ equipTypes: [1, 6, 8] }), graph);
  assert.ok(fired.length, '150020 produced no rows — it has no skill_150020, only buff_150020');
  // Assert the BURST, not the total. Her root has three independent firing branches
  // (164520 and 164550 on onChargeWeaponFire, plus this one), and their combined sum
  // clears any `>= 8` bar on its own — so a total-based assertion passes with the burst
  // mechanism entirely removed. The burst is weapon 164530 specifically: buff_150026's
  // `onUpdate time:0.2 quota:8` inside a 5 s holder that stacks to 2.
  const burst = fired.find((r) => r.weaponId === 164530);
  assert.ok(burst, 'the burst weapon 164530 must fire');
  assert.equal(burst.trigger, 'onUpdate');
  assert.ok(Math.abs(burst.period - 0.2) < 0.01, `burst cadence should be 0.2s, got ${burst.period}`);
  assert.ok(burst.activations >= 8, `at least one full 8-volley burst, got ${burst.activations}`);
});

// The two notes answer different questions. A root whose only weapon path is behind a
// trigger the sim never raises is UNMODELLED, not "inactive in this loadout" — saying the
// second about the first is the conflation the project's disclosure doctrine forbids.
test('a weapon path behind an unraised trigger is disclosed, not silently zero', () => {
  // 13130 CHANGE NEKO! is the shape the uniform rule exists for: an onUpdate cast that
  // fires normally, PLUS an onHPRatioUpdate cast (「내구도가 30% 미만이 될 경우」) that
  // reaches a weapon the sim can never raise. It must do both — count the live half and
  // disclose the other — rather than reporting only what it can see.
  //
  // NOT 워싱턴 1011000, despite her onBulletKill branch: `buff_11008` only stamps the
  // BB56SPweapon tag and names no skill or buff, so it is a gate INPUT, not a weapon
  // path, and the algorithm correctly declines to disclose it.
  const { fired, blocked } = runBattleSim(['13130'], ctx(), graph);
  assert.ok(fired.length, 'the live onUpdate branch still fires');
  assert.ok(blocked.includes('13130'), 'the onHPRatioUpdate branch is disclosed');

  // ...and it must disclose SELECTIVELY. Without this, an implementation that returned
  // true unconditionally would pass every test in this file: `fired` is computed
  // independently, so nothing else here can tell "discloses" from "discloses everything".
  // 재블린 29081 is wholly modelled — one onFire counter into one weapon, no branch the
  // sim cannot raise.
  const jav = runBattleSim(['29081'], ctx(), graph);
  assert.ok(jav.fired.length, '29081 fires');
  assert.deepEqual(jav.blocked, [], '29081 is fully modelled and must NOT be disclosed');
});

// A buff whose ONLY effects are removals reaches no weapon and stamps no tag, so the
// pruner's closure dropped it — third instance of one recurring failure, after the
// AddTag seed and the two removal classes themselves: the effect that BOUNDS a loop
// is control flow, not payload, and losing it makes the loop unbounded.
test('드미트리 180000 fires once per salvo — its window-closing cleanse survived the prune', () => {
  // buff_180000's onUpdate cast is gated on the tag `xietongdaji`, stamped by the 1s
  // buff_190008. Each cast runs skill_180003, which adds buff_190006 — whose sole
  // effect is a BattleBuffCleanse of 190008, i.e. it shuts the window on the spot.
  // Without 190006 in the graph the gate stayed open and the cast fired every tick:
  // 751 activations over the 78s window against 26 main-gun salvos.
  for (const root of ['180000', '190000']) {
    const { fired } = runBattleSim([root], ctx(), graph);
    assert.equal(Math.round(sum(fired)), 26, `${root} should fire once per main-gun salvo`);
  }
});

// C1 REGRESSION. Every fixture above feeds ONE slot-1 cannon, which is exactly why 18 of
// them caught a global x20 and none caught a per-hull x4: with one cannon slot, handing
// that slot both onFire and onChargeWeaponFire is indistinguishable from splitting them.
// The engine's weapon classes are mutually exclusive (CreateWeaponUnit switches on
// `weapon_property.type`; each subclass overrides TriggerBuffOnFire to raise ONE name),
// so a 부포 salvo must be invisible to a 「주포 발사 시」 barrage on a 전함 주포.
test('a 부포 salvo does not trip a 전함 주포 barrage', () => {
  const window = 78;
  // reloadMax 0 + cycleExtra makes weaponCycleInterval exactly `every`, so the two
  // cadences are integers and the activation count can be asserted exactly.
  const mount = (slotIndex, weaponType, every) =>
    ({ slotIndex, weaponType, attackAttribute: 'cannon', reloadMax: 0, cycleExtra: every, initialDelay: 0 });
  const events = weaponEvents([
    mount(0, 23, 25),   // POINT_HIT_AND_LOCK — the 전함 주포
    mount(1, 2, 6),     // SUB_CANNON — the 부포 beside it, four times faster
  ], 0, window, 0);

  const charge = events.filter((e) => e.names.includes('onChargeWeaponFire'));
  const gun = events.filter((e) => e.names.includes('onFire'));
  assert.equal(charge.length, 4, '25s charge salvos at 0/25/50/75');
  assert.equal(gun.length, 14, '6s 부포 salvos at 0..78');
  assert.ok(gun.every((e) => !e.names.includes('onChargeWeaponFire')),
    'a 부포 salvo must not raise onChargeWeaponFire');
  assert.ok(charge.every((e) => !e.names.includes('onFire')),
    'a 전함 주포 salvo must not raise onFire');

  // 카잔 151120 「주포 공격 시 특수 탄막을 발동」 is a bare BattleBuffCastSkill on
  // onChargeWeaponFire — no cooldown, no rant, no `index` (ON_CHARGE_FIRE's payload is
  // `{}`, so the CLASS is the filter) — casting skill_151120's three weapons. It must
  // count the 4 charge salvos and none of the 14 부포 ones.
  const { fired } = runBattleSim(['151120'], { window, events,
    unit: { equipTypes: [23, 2, 8], nationality: 3, shipType: 5, spEquipped: false, allyCount: 6, tags: [] } }, graph);
  assert.equal(fired.length, 3, '151120 fires three weapons');
  assert.equal(Math.round(sum(fired)), 12, 'three weapons x four charge salvos');
});
