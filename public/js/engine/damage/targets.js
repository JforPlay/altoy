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

/**
 * Build a TargetProfile from a META boss record + tier number. Same shape as
 * makeTarget so the damage formula is unchanged. META bosses have no adapt tier.
 * Unknown/null tier → highest tier. Boss level is unreliable in the source
 * (fixed-stat tiers, no growth), so level<=0 defaults to 125 (neutral advantage
 * vs a maxed fleet); the 레벨 override can adjust it.
 *
 * injureRatio is the boss's OWN always-on 받는 피해 skill, baked in by WSL
 * meta_boss_process.py from its enemy buff_list (8830 通用易伤 +20% on most of the
 * roster, 요크타운's 基础减伤 -60%, 브리스톨 -20%). It feeds the existing
 * (1 + injureRatio) term, so nothing about the formula changes — the field simply
 * stops being hardcoded 0. unmodeledBuffs rides along as metadata: the count of
 * phase/stack/timer buffs on the same boss whose conditions this sim does not
 * model, so the panel can disclose them rather than quietly under-reporting.
 * @param {object} boss meta_bosses.json record { id, name, tiers:[...] }
 * @param {number|null} tier tier number to select
 * @param {object} overrides optional TargetProfile field overrides
 */
export function makeMetaTarget(boss, tier, overrides = {}) {
  if (!boss || !Array.isArray(boss.tiers) || boss.tiers.length === 0) {
    throw new Error(`makeMetaTarget: boss ${boss && boss.id} has no tiers`);
  }
  const rec = boss.tiers.find((t) => t.tier === tier) || boss.tiers[boss.tiers.length - 1];
  return {
    bossId: boss.id,
    tier: rec.tier,
    name: boss.name,
    armorType: rec.armorType,
    evasion: overrides.evasion ?? rec.evasion,
    antiAir: overrides.antiAir ?? rec.antiAir,
    level: overrides.level ?? (rec.level > 0 ? rec.level : 125),
    luck: overrides.luck ?? rec.luck,
    hp: overrides.hp ?? rec.hp,
    armorReduce: overrides.armorReduce ?? DEFAULT_ARMOR_REDUCE,
    injureRatio: overrides.injureRatio ?? rec.injureRatio ?? 0,
    ammoReduce: overrides.ammoReduce ?? 0,
    adapt: null,
    unmodeledBuffs: rec.unmodeledBuffs ?? 0,
  };
}
