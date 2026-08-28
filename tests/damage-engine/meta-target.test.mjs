import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMetaTarget } from '../../public/js/engine/damage/targets.js';

const BOSS = {
  id: 970112, name: '브리스톨·META', prefab: 'x',
  tiers: [
    { tier: 1, hp: 54000, armorType: 1, level: 0, evasion: 25, luck: 50, antiAir: 105 },
    { tier: 2, hp: 58000, armorType: 1, level: 0, evasion: 28, luck: 50, antiAir: 120 },
  ],
};

test('builds a TargetProfile for the requested tier', () => {
  const t = makeMetaTarget(BOSS, 1);
  assert.equal(t.bossId, 970112);
  assert.equal(t.tier, 1);
  assert.equal(t.armorType, 1);
  assert.equal(t.hp, 54000);
  assert.equal(t.evasion, 25);
  assert.equal(t.antiAir, 105);
  assert.equal(t.adapt, null);
});

test('defaults level 0 to 125 (neutral level advantage)', () => {
  assert.equal(makeMetaTarget(BOSS, 1).level, 125);
});

test('unknown/null tier falls back to the highest tier', () => {
  assert.equal(makeMetaTarget(BOSS, null).tier, 2);
  assert.equal(makeMetaTarget(BOSS, 99).tier, 2);
});

test('overrides win over the tier record', () => {
  const t = makeMetaTarget(BOSS, 1, { evasion: 200, level: 130, armorReduce: 0.1 });
  assert.equal(t.evasion, 200);
  assert.equal(t.level, 130);
  assert.equal(t.armorReduce, 0.1);
});

test('throws on a boss with no tiers', () => {
  assert.throws(() => makeMetaTarget({ id: 1, name: 'x', tiers: [] }, 1));
});

// --- boss skills (WSL meta_boss_process resolves the enemy buff_list) --------

test("the boss's own 받는 피해 skill rides the tier record into injureRatio", () => {
  const boss = { ...BOSS, tiers: [{ ...BOSS.tiers[0], injureRatio: -0.6, unmodeledBuffs: 2 }] };
  const t = makeMetaTarget(boss, 1);
  // -0.6 = 요크타운's 基础减伤: the formula's (1 + injureRatio) term makes it 0.4×.
  assert.equal(t.injureRatio, -0.6);
  assert.equal(t.unmodeledBuffs, 2);
});

test('a tier with no boss skill still reads 0, not undefined', () => {
  // The field is omitted when zero (the file is minified), so a missing key must
  // not leak `undefined` into the damage formula.
  const t = makeMetaTarget(BOSS, 1);
  assert.equal(t.injureRatio, 0);
  assert.equal(t.unmodeledBuffs, 0);
});

test('an explicit injureRatio override still wins over the boss skill', () => {
  const boss = { ...BOSS, tiers: [{ ...BOSS.tiers[0], injureRatio: 0.2 }] };
  assert.equal(makeMetaTarget(boss, 1, { injureRatio: 0 }).injureRatio, 0);
});
