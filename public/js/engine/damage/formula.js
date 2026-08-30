// public/js/engine/damage/formula.js
/**
 * Per-hit expected damage — port of battleformulas.lua CreateContextCalculateDamage
 * (:121 base, :156 final). RNG terms (hit/crit/±0–2 variance) collapsed to
 * expected values. Buff terms not modeled in v1 default to identity. Pure.
 */
import {
  DFT_CRIT_RATE, DFT_CRIT_EFFECT, AIR_MIT_CONST, LVL_ADV_CAP, LVL_ADV_FACTOR,
  RANDOM_DAMAGE_EV, HIT_FLOOR, HIT_DENOM_PAD, CRIT_DENOM_PAD,
  LUCK_HIT_FACTOR, LUCK_CRIT_FACTOR, PERCENT, RATIO_PERCENT,
} from './constants.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Everything that depends only on the (attacker, target) PAIR — hit rate, crit
 * rate and level advantage — with no weapon involved. Split out because the DOT
 * lane needs the hit rate to size a burn's attach chance before any weapon is
 * picked (battledataproxylogic.lua:144 gates the attach on the shot landing),
 * and a second copy of the accuracy formula would be free to drift.
 */
export function computeAccuracy(attacker, target) {
  const lvlDiff = attacker.level - target.level;
  const atkRating = Math.max(attacker.accuracy, 0);
  const luckDelta = attacker.luck - (target.luck ?? 0) + lvlDiff;
  return {
    lvlDiff,
    levelAdv: 1 + clamp(lvlDiff, -LVL_ADV_CAP, LVL_ADV_CAP) * LVL_ADV_FACTOR,
    hitRate: clamp(
      HIT_FLOOR + atkRating / (atkRating + target.evasion + HIT_DENOM_PAD) + luckDelta * LUCK_HIT_FACTOR,
      HIT_FLOOR, 1,
    ),
    critRate: clamp(
      DFT_CRIT_RATE + atkRating / (atkRating + target.evasion + CRIT_DENOM_PAD) + luckDelta * LUCK_CRIT_FACTOR,
      0, 1,
    ),
  };
}

/**
 * @returns {{ base, armorMod, airMitigation, levelAdv, hitRate, critRate,
 *             critMult, expectedHit }} expectedHit = EV of ONE landed hit (incl crit),
 *           BEFORE hitRate is applied (salvo.js applies hitRate × bulletsPerSalvo).
 */
export function computeHitDamage(attacker, weapon, target) {
  const potential = weapon.potential ?? 1;
  const correctedDmg = weapon.damage * potential * weapon.corrected * PERCENT;
  const statScale = 1 + weapon.stat * weapon.ratio * RATIO_PERCENT;
  const base = statScale * correctedDmg + RANDOM_DAMAGE_EV;

  // Weapon-type modifier (battleformulas.lua :124-128): each attribute's term is
  // 1 + the target's injureRatioBy<attr> + the attacker's damageRatioBy<attr>, and
  // the air branch multiplies that by the AA mitigation. `attrDamageRatio` is the
  // attacker half for THIS weapon's attribute (0 when nothing grants one).
  const attrRatio = weapon.attrDamageRatio ?? 0;
  let airMitigation = 1;
  let typeMod = 1 + attrRatio;
  if (weapon.attackAttribute === 'air') {
    airMitigation = AIR_MIT_CONST / (target.antiAir + AIR_MIT_CONST);
    typeMod = airMitigation * (1 + attrRatio);
  }

  // armor effectiveness: damageType[armorType-1]
  const armorMod = weapon.damageType[target.armorType - 1] ?? 1;

  // 대갑 타상 계수 — its own multiply, NOT part of the armor-efficiency term above:
  // battleformulas.lua:156 has `(damage_type[armor] + damageAmmoToArmorRateEnhance_N)`
  // and `(1 + damageToArmorRateEnhance_N)` as two adjacent factors. Indexed by the
  // TARGET's armor class, which is why it rides the descriptor as a map.
  const armorEnhance = weapon.armorDamageRatio?.[target.armorType] ?? 0;

  // 특수 종류 피해 — GetTagAttr (battleattr.lua:700) walks the TARGET's own label
  // tags and multiplies one (1 + n) per tag the ATTACKER has an entry for. Every
  // unit auto-carries exactly two (battleunit.lua:461-462 stamps `T_<함종>` and
  // `N_<진영>` at spawn), and the terms COMPOUND rather than sum, so a fleet that
  // buffs both of a boss's tags multiplies twice.
  let tagMod = 1;
  const tagRatios = weapon.tagDamageRatio;
  if (tagRatios && target.tags) {
    for (const tag of target.tags) {
      const n = tagRatios[tag];
      if (n) tagMod *= 1 + n;
    }
  }

  // 탄약 종류 피해 — keyed on the BULLET's own ammo_type, so the attacker half is
  // already resolved to a scalar by the caller. The defender half (`ammoReduce` =
  // damageReduceFromAmmoType_N) is absent from the entire META + Arbiter roster and
  // stays at its 0 default; it is read here so a future target that has one works.
  const ammoMod = 1 + (weapon.ammoDamageRatio ?? 0) - (target.ammoReduce ?? 0);

  // level advantage (clamped) + expected hit & crit — all weapon-independent
  const { levelAdv, hitRate, critRate } = computeAccuracy(attacker, target);
  const critMult = DFT_CRIT_EFFECT;
  const critEV = 1 + critRate * (critMult - 1);

  const armorReduce = target.armorReduce ?? 0;
  const injureRatio = target.injureRatio ?? 0;

  // `damageRatio` is the attacker's damageRatioBullet — a flat multiply on the
  // finished product (battleformulas.lua :156), applied to every attribute alike.
  // 공습 선도 lands here.
  const damageRatio = weapon.damageRatio ?? 0;

  // Factors in the Lua's own order (battleformulas.lua:156): 속성 → 감쇠 → 대갑 효율
  // → 대갑 타상 → 치명 → 일반 타상 → 특수 종류 → 받는 피해 → 탄약 종류 → 등급 압제.
  const expectedHit =
    base * typeMod * (1 - armorReduce) * armorMod * (1 + armorEnhance) * critEV
    * (1 + damageRatio) * tagMod * (1 + injureRatio) * ammoMod * levelAdv;

  return { base, armorMod, airMitigation, levelAdv, hitRate, critRate, critMult, expectedHit };
}
