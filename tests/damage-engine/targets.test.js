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

test('difficulty defaults to 하드 and swaps hp + evasion only', () => {
  // The user's stat sheets differ between 일반 and 하드 in exactly two columns;
  // 대공/행운/장갑 are identical, which is why 대공 sits on the preset.
  const hard = makeTarget('medium');
  assert.equal(hard.difficulty, 'hard');
  assert.equal(hard.evasion, 89);
  assert.equal(hard.hp, 1839688);

  const normal = makeTarget('medium', { difficulty: 'normal' });
  assert.equal(normal.evasion, 84);
  assert.equal(normal.hp, 1411293);
  assert.equal(normal.antiAir, hard.antiAir);
  assert.equal(normal.luck, hard.luck);
  assert.equal(normal.armorType, hard.armorType);
});

test('difficulty and adapt tier compose', () => {
  assert.equal(makeTarget('heavy', { difficulty: 'normal', adapt: 'noAdapt' }).hp, 1897169);
  assert.equal(makeTarget('light', { difficulty: 'normal', adapt: 'full' }).hp, 844061);
  // 대공 comes from the shared block, so it must not move with difficulty.
  assert.equal(makeTarget('light', { difficulty: 'normal', adapt: 'full' }).antiAir, 337);
});

test('unknown difficulty throws', () => {
  assert.throws(() => makeTarget('heavy', { difficulty: 'lunatic' }));
});
