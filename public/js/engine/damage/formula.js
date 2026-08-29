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

  // level advantage (clamped) + raw level diff for luck terms
  const lvlDiff = attacker.level - target.level;
  const levelAdv = 1 + clamp(lvlDiff, -LVL_ADV_CAP, LVL_ADV_CAP) * LVL_ADV_FACTOR;

  // expected hit & crit
  const atkRating = Math.max(attacker.accuracy, 0);
  const luckDelta = attacker.luck - (target.luck ?? 0) + lvlDiff;
  const hitRate = clamp(
    HIT_FLOOR + atkRating / (atkRating + target.evasion + HIT_DENOM_PAD) + luckDelta * LUCK_HIT_FACTOR,
    HIT_FLOOR, 1,
  );
  const critRate = clamp(
    DFT_CRIT_RATE + atkRating / (atkRating + target.evasion + CRIT_DENOM_PAD) + luckDelta * LUCK_CRIT_FACTOR,
    0, 1,
  );
  const critMult = DFT_CRIT_EFFECT;
  const critEV = 1 + critRate * (critMult - 1);

  const armorReduce = target.armorReduce ?? 0;
  const injureRatio = target.injureRatio ?? 0;

  // `damageRatio` is the attacker's damageRatioBullet — a flat multiply on the
  // finished product (battleformulas.lua :156), applied to every attribute alike.
  // 공습 선도 lands here.
  const damageRatio = weapon.damageRatio ?? 0;

  const expectedHit =
    base * typeMod * (1 - armorReduce) * armorMod * critEV
    * (1 + damageRatio) * (1 + injureRatio) * levelAdv;

  return { base, armorMod, airMitigation, levelAdv, hitRate, critRate, critMult, expectedHit };
}
