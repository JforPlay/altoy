// public/js/engine/damage/targets.js
/**
 * Arbiter target presets (real KR hard-mode stats, user-supplied 2026-05-28).
 * Across adapt tiers only antiAir + hp change; evasion/luck/level constant.
 * armorType: 1=Light, 2=Medium, 3=Heavy.
 */
export const ARMOR_PRESETS = {
  light: {
    name: 'Temperance XIV', shipClass: 'CL', armorType: 1, evasion: 94, luck: 45, level: 125,
    adapt: { base: { antiAir: 481, hp: 1420678 }, noAdapt: { antiAir: 626, hp: 1846881 }, full: { antiAir: 337, hp: 994475 } },
  },
  medium: {
    name: 'Strength VIII (Normal)', shipClass: 'CA', armorType: 2, evasion: 84, luck: 45, level: 125,
    adapt: { base: { antiAir: 348, hp: 1411293 }, noAdapt: { antiAir: 452, hp: 1834681 }, full: { antiAir: 243, hp: 987905 } },
  },
  heavy: {
    name: 'The Hermit IX', shipClass: 'BB', armorType: 3, evasion: 74, luck: 45, level: 125,
    adapt: { base: { antiAir: 385, hp: 1915376 }, noAdapt: { antiAir: 501, hp: 2489989 }, full: { antiAir: 270, hp: 1340763 } },
  },
};

export const DEFAULT_ADAPT = 'base';        // base | noAdapt | full
export const DEFAULT_ARMOR_REDUCE = 0;

/** Flatten a preset + adapt tier (+ overrides) into a TargetProfile. */
export function makeTarget(presetKey, overrides = {}) {
  const preset = ARMOR_PRESETS[presetKey];
  if (!preset) throw new Error(`Unknown armor preset: ${presetKey}`);
  const adaptKey = overrides.adapt || DEFAULT_ADAPT;
  const tier = preset.adapt[adaptKey];
  if (!tier) throw new Error(`Unknown adapt tier: ${adaptKey}`);
  return {
    presetKey,
    name: preset.name,
    armorType: preset.armorType,
    evasion: overrides.evasion ?? preset.evasion,
    antiAir: overrides.antiAir ?? tier.antiAir,
    level: overrides.level ?? preset.level,
    luck: overrides.luck ?? preset.luck,
    hp: overrides.hp ?? tier.hp,
    armorReduce: overrides.armorReduce ?? DEFAULT_ARMOR_REDUCE,
    injureRatio: overrides.injureRatio ?? 0,
    ammoReduce: overrides.ammoReduce ?? 0,
    adapt: adaptKey,
  };
}
