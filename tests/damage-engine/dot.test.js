import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dotSchedule, dotUptime, dotApplyChance } from '../../public/js/engine/damage/dot.js';

// 起火 (buff 311) — the case 129 of the 167 DOT-carrying barrage records use.
const IGNITE = { life: 15.1, int: 3, a: 'cannon', num: 5, k: 0.6 };
// 라이온 151222 — permanent, leveled, and the only reachable burn with injureRatio.
const LION = {
  life: 0, int: 3, a: 'cannon', num: 10, k: 0.62, inj: 0.1,
  lv: { 1: { num: 10, k: 0.62 }, 10: { num: 100, k: 0.8 } },
};

test('a burn re-applied faster than it decays is up for the whole window', () => {
  // 20 applications over 78s = a 3.9s gap against a 15.1s life: continuous.
  assert.equal(dotUptime(15.1, 20, 78), 78);
});

test('a burn re-applied slower than it decays only sums its own lifetimes', () => {
  assert.equal(Number(dotUptime(15.1, 5, 78).toFixed(4)), 75.5);
});

test('life 0 means the buff never expires, so one application covers the window', () => {
  assert.equal(dotUptime(0, 1, 78), 78);
});

test('no applications is no uptime', () => {
  assert.equal(dotUptime(15.1, 0, 78), 0);
});

test('attach chance is per bullet, so a volley is far likelier than one shot', () => {
  // rant 100 = 1%. One bullet is 1%, twenty is 18% — reading it as a flat 1%
  // per volley under-counts every low-rant burn by most of its value.
  assert.equal(Number(dotApplyChance({ rant: 100, bullets: 1 }).toFixed(4)), 0.01);
  assert.ok(dotApplyChance({ rant: 100, bullets: 20 }) > 0.17);
});

test('a miss blocks the attach unless the bullet says hit_ignore', () => {
  const missy = { rant: 10000, bullets: 1, hitRate: 0.8 };
  assert.equal(dotApplyChance(missy), 0.8);
  assert.equal(dotApplyChance({ ...missy, hitIgnore: true }), 1);
});

test('라이온 lv10 ticks every 3s for the whole fight and reads floor(number + corrected x (1+화력%) x k)', () => {
  // GetCorrectedDMG 200 (damage 200 x corrected 100 x 1%), 화력 400, k 0.8, number 100.
  const s = dotSchedule(LION, {
    window: 78, activations: 6, bullets: 20, rant: 10000, hitIgnore: true,
    level: 10, correctedDmg: 200, stat: 400,
  });
  assert.equal(s.tickDamage, Math.floor(100 + 200 * 5 * 0.8));   // 900
  assert.equal(s.uptime, 78);
  assert.equal(s.ticks, 26);
  assert.equal(s.interval, 3);
});

test('the level comes from the bullet, not the ship — lv1 and lv10 differ', () => {
  const ctx = { window: 78, activations: 6, bullets: 20, rant: 10000, hitIgnore: true, correctedDmg: 200, stat: 400 };
  assert.equal(dotSchedule(LION, { ...ctx, level: 1 }).tickDamage, Math.floor(10 + 200 * 5 * 0.62));
  assert.equal(dotSchedule(LION, { ...ctx, level: 10 }).tickDamage, Math.floor(100 + 200 * 5 * 0.8));
  // No level named falls back to the buff's own top-level payload (= its level 1).
  assert.equal(dotSchedule(LION, ctx).tickDamage, dotSchedule(LION, { ...ctx, level: 1 }).tickDamage);
});

test('an ignite is bounded by its 15.1s life, not by the window', () => {
  // One activation, certain attach: 5 ticks (floor(15.1 / 3)) and no more, even
  // though the fight runs 78s. Reading `life` as the window is the whole point.
  const s = dotSchedule(IGNITE, {
    window: 78, activations: 1, bullets: 10, rant: 10000, hitRate: 1,
    correctedDmg: 50, stat: 300,
  });
  assert.equal(s.ticks, 5);
  assert.equal(s.tickDamage, Math.floor(5 + 50 * 4 * 0.6));
});

test('a low attach chance shrinks the burn instead of dropping it', () => {
  const ctx = { window: 78, activations: 5, bullets: 10, hitRate: 0.85, correctedDmg: 50, stat: 300 };
  const certain = dotSchedule(IGNITE, { ...ctx, rant: 10000 });
  const chancy = dotSchedule(IGNITE, { ...ctx, rant: 100 });
  assert.ok(chancy.ticks > 0 && chancy.ticks < certain.ticks);
  assert.equal(chancy.tickDamage, certain.tickDamage);   // rant changes uptime, never the tick
});

test('a payload the sim cannot evaluate returns null so the caller can disclose it', () => {
  // currentHPRatio needs an hp timeline the sim does not have. 0 reachable records
  // use one today, and a silent 0 would be an undisclosed under-report.
  const chp = { life: 12, int: 1, a: 'cannon', num: 5, k: 0.4, chp: 0.015 };
  assert.equal(dotSchedule(chp, { window: 78, activations: 5, bullets: 10, rant: 10000, correctedDmg: 50, stat: 300 }), null);
  assert.equal(dotSchedule({ life: 5, int: 0, a: 'cannon', num: 1, k: 0 }, { window: 78 }), null);
  assert.equal(dotSchedule(null, { window: 78 }), null);
});
