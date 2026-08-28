/**
 * Arbiter target presets — the ONLY hand-entered data in the damage engine, and
 * they CANNOT be derived: Operation Siren scales Arbiters at runtime via
 * world_enhancement + zone threat in the C# battle layer, so raw config reads
 * hp=240 for Hermit IX against the ~1.9M really in play. Stat sheets supplied by
 * the user (일반 + 하드 for all three, 2026-08-28).
 *
 * Only 내구 and 회피 move between 일반 and 하드 — 대공, 행운 and armor type are
 * identical in both sheets, which is why 대공 is hoisted onto the preset. The
 * sheets' 화력/뇌장/명중/속도 are the boss's own OFFENSE and are not modelled here.
 * Across adapt tiers only 대공 + 내구 change; 회피/행운/레벨 hold.
 * 레벨 is not in the sheets: 125 is a documented assumption (neutral vs a
 * level-125 fleet), adjustable through the 레벨 field.
 * armorType: 1=Light, 2=Medium, 3=Heavy.
 */
export const ARMOR_PRESETS = {
  light: {
    name: 'Temperance XIV', shipClass: 'CL', armorType: 1, luck: 45, level: 125,
    antiAir: { base: 481, noAdapt: 626, full: 337 },
    difficulty: {
      hard: { evasion: 94, hp: { base: 1420678, noAdapt: 1846881, full: 994475 } },
      normal: { evasion: 89, hp: { base: 1205801, noAdapt: 1567541, full: 844061 } },
    },
  },
  medium: {
    name: 'Strength VIII', shipClass: 'CA', armorType: 2, luck: 45, level: 125,
    antiAir: { base: 348, noAdapt: 452, full: 243 },
    difficulty: {
      hard: { evasion: 89, hp: { base: 1839688, noAdapt: 2391595, full: 1287782 } },
      normal: { evasion: 84, hp: { base: 1411293, noAdapt: 1834681, full: 987905 } },
    },
  },
  heavy: {
    name: 'The Hermit IX', shipClass: 'BB', armorType: 3, luck: 45, level: 125,
    antiAir: { base: 385, noAdapt: 501, full: 270 },
    difficulty: {
      hard: { evasion: 74, hp: { base: 1915376, noAdapt: 2489989, full: 1340763 } },
      normal: { evasion: 69, hp: { base: 1459361, noAdapt: 1897169, full: 1021553 } },
    },
  },
};

export const DEFAULT_ADAPT = 'base';        // base | noAdapt | full
export const DEFAULT_DIFFICULTY = 'hard';  // hard | normal
export const DEFAULT_ARMOR_REDUCE = 0;

/** Flatten a preset + difficulty + adapt tier (+ overrides) into a TargetProfile. */
export function makeTarget(presetKey, overrides = {}) {
  const preset = ARMOR_PRESETS[presetKey];
  if (!preset) throw new Error(`Unknown armor preset: ${presetKey}`);
  const adaptKey = overrides.adapt || DEFAULT_ADAPT;
  const difficulty = overrides.difficulty || DEFAULT_DIFFICULTY;
  const diff = preset.difficulty[difficulty];
  if (!diff) throw new Error(`Unknown difficulty: ${difficulty}`);
  const hp = diff.hp[adaptKey];
  const antiAir = preset.antiAir[adaptKey];
  if (hp == null || antiAir == null) throw new Error(`Unknown adapt tier: ${adaptKey}`);
  return {
    presetKey,
    name: preset.name,
    armorType: preset.armorType,
    evasion: overrides.evasion ?? diff.evasion,
    antiAir: overrides.antiAir ?? antiAir,
    level: overrides.level ?? preset.level,
    luck: overrides.luck ?? preset.luck,
    hp: overrides.hp ?? hp,
    armorReduce: overrides.armorReduce ?? DEFAULT_ARMOR_REDUCE,
    injureRatio: overrides.injureRatio ?? 0,
    ammoReduce: overrides.ammoReduce ?? 0,
    adapt: adaptKey,
    difficulty,
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
