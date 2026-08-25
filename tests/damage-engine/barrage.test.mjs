// tests/damage-engine/barrage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barrageActivations } from '../../public/js/engine/damage/barrage.js';

const ctx = (over = {}) => ({ window: 90, salvosBySlot: { 1: 30, 2: 10, 3: 0 }, airstrikes: 4, ...over });

test('count: every N-th fire of the listed slots', () => {
  // 재블린I — 주포 15회마다, 30 slot-1 salvos in the window.
  assert.equal(barrageActivations({ t: { k: 'count', n: 15, slots: [1] } }, ctx()), 2);
  // 핫스 — 주포 10회마다.
  assert.equal(barrageActivations({ t: { k: 'count', n: 10, slots: [1] } }, ctx()), 3);
});

test('count: a failed proc still consumes the counter, so rant is a plain multiply', () => {
  // battlebuffeffect.lua:783-791 resets the counter unless the cast returned
  // "overheat"; a failed roll returns "chance", which is not "overheat".
  assert.equal(barrageActivations({ t: { k: 'count', n: 15, slots: [1] }, p: 5000 }, ctx()), 1);
});

test('count: absent slots means every slot counts', () => {
  assert.equal(barrageActivations({ t: { k: 'count', n: 20 } }, ctx()), 2);   // 30+10+0 = 40
});

test('timer: d is the FIRST CAST TIME, not a delay added to n', () => {
  // initialCD absent -> d = n -> casts at 20/40/60/80 = 4, no cast at t=0.
  assert.equal(barrageActivations({ t: { k: 'timer', n: 20, d: 20 } }, ctx()), 4);
  // initialCD present -> d = 0 -> casts at 0/20/40/60/80 = 5.
  assert.equal(barrageActivations({ t: { k: 'timer', n: 20, d: 0 } }, ctx()), 5);
  // 핫스 108100 — 전투 개시 5초 후, 이후 20초마다 -> 5/25/45/65/85 = 5.
  assert.equal(barrageActivations({ t: { k: 'timer', n: 20, d: 5 } }, ctx()), 5);
});

test('timer: a period longer than the window yields zero, never negative', () => {
  assert.equal(barrageActivations({ t: { k: 'timer', n: 200, d: 200 } }, ctx()), 0);
});

test('fire: a failed proc does NOT start the cooldown, so p widens the period', () => {
  // 후드 — 12s CD, 70%, 9 maingun salvos in 90s -> avg gun interval 10s
  // -> period = 12 + 10/0.7 = 26.29 -> floor((90-12)/26.29)+1 = 3.
  const c = ctx({ salvosBySlot: { 1: 9 } });
  assert.equal(barrageActivations({ t: { k: 'fire', n: 12, d: 12, slots: [1] }, p: 7000 }, c), 3);
  // The naive "cooldown only, then multiply" model would give 7.5 x 0.7 = 5.25.
});

test('fire: cannot activate more often than the gun fires', () => {
  const c = ctx({ salvosBySlot: { 1: 2 } });
  assert.equal(barrageActivations({ t: { k: 'fire', n: 1, d: 0, slots: [1] } }, c), 2);
});

test('air and once', () => {
  assert.equal(barrageActivations({ t: { k: 'air' } }, ctx()), 4);
  assert.equal(barrageActivations({ t: { k: 'once' } }, ctx()), 1);
  assert.equal(barrageActivations({ t: { k: 'once' }, p: 2000 }, ctx()), 0.2);
});

test('quota caps the result', () => {
  assert.equal(barrageActivations({ t: { k: 'count', n: 10, slots: [1] }, q: 2 }, ctx()), 2);
});

test('an unknown kind contributes nothing rather than guessing', () => {
  assert.equal(barrageActivations({ t: { k: 'onSomethingNew' } }, ctx()), 0);
});
