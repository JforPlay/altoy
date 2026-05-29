// tests/damage-engine/targets.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARMOR_PRESETS, makeTarget, DEFAULT_ADAPT } from '../../public/js/engine/damage/targets.js';

test('presets carry real arbiter armor types', () => {
  assert.equal(ARMOR_PRESETS.light.armorType, 1);
  assert.equal(ARMOR_PRESETS.medium.armorType, 2);
  assert.equal(ARMOR_PRESETS.heavy.armorType, 3);
  assert.equal(DEFAULT_ADAPT, 'base');
});

test('makeTarget heavy/base flattens The Hermit IX base tier', () => {
  const t = makeTarget('heavy');
  assert.equal(t.armorType, 3);
  assert.equal(t.evasion, 74);
  assert.equal(t.antiAir, 385);
  assert.equal(t.hp, 1915376);
  assert.equal(t.luck, 45);
  assert.equal(t.level, 125);
  assert.equal(t.armorReduce, 0);
});

test('adapt tier swaps antiAir + hp only', () => {
  const base = makeTarget('heavy', { adapt: 'base' });
  const noAdapt = makeTarget('heavy', { adapt: 'noAdapt' });
  assert.equal(noAdapt.antiAir, 501);
  assert.equal(noAdapt.hp, 2489989);
  assert.equal(noAdapt.evasion, base.evasion); // unchanged across tiers
});

test('overrides win over preset/tier', () => {
  const t = makeTarget('medium', { evasion: 250, antiAir: 999, armorReduce: 0.1 });
  assert.equal(t.armorType, 2);
  assert.equal(t.evasion, 250);
  assert.equal(t.antiAir, 999);
  assert.equal(t.armorReduce, 0.1);
});

test('unknown preset/tier throws', () => {
  assert.throws(() => makeTarget('bogus'));
  assert.throws(() => makeTarget('light', { adapt: 'nope' }));
});
