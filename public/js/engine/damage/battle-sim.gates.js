// public/js/engine/damage/battle-sim.gates.js
/**
 * The `check_*` gates on a BattleBuffCastSkill / BattleBuffAddBuff, evaluated
 * against what fleet-sim actually knows about the built ship. Pure.
 *
 * Three answers, not two. `'unknown'` is the D3 case: a gate keyed on battlefield
 * state (a fleet resource, a winning streak, who killed what) that the sim cannot
 * evaluate. The caller blocks the cast AND discloses the skill — never counts it as
 * unconditional, which is the 104-record over-report
 * dev/icebox/2026-08-29-fleet-sim-damage-formula-terms.md §G parks, and never drops
 * it silently, which would understate with no marker on it.
 *
 * HP IS PINNED AT 100%. hpIntervalRequire (battlebuffeffect.lua:703) is an interval
 * on the unit's HP rate: hpUpperBound alone defaults hpLowerBound to 0 (so it reads
 * 「내구도가 N% 미만일 시」 and fails at full HP), hpLowerBound alone defaults
 * hpUpperBound to 1 (so it passes). That is a GAIN, not a loss — it resolves the
 * four two-armed forks (800380 피의 희생, 13750, 17780, 150990) exactly, and the
 * one-armed "when hurt" casts it drops were mostly unreachable anyway (12 of the 15
 * hang off onHPRatioUpdate, which this sim never raises).
 */

/**
 * Every gate key this module accounts for. A key the pruner emits that is absent
 * here silently PASSES — the cast fires on an unevaluated condition with no note on
 * it, which is the over-report D3 forbids and which nothing in the build can see.
 * `fleet-sim-battle-sim-gates.test.mjs` asserts the published graph carries no key
 * outside this set, so adding a key to the pruner without deciding what it means
 * fails the suite instead of quietly widening the answer.
 */
export const KNOWN_GATE_KEYS = new Set([
  'check_target', 'minTargetNumber', 'maxTargetNumber', 'check_weapon',
  'minWeaponNumber', 'maxWeaponNumber', 'type', 'ship_tag_list', 'ship_type_list',
  'nationality', 'hpUpperBound', 'hpLowerBound', 'hpOutInterval', 'hpSigned',
  'check_spweapon', 'exceptCaster',
  // Carried but not a condition on the caster at all — see the doc comment below.
  'group', 'bulletTrigger',
  // ...plus every entry of UNKNOWN_KEYS below, appended after its declaration.
]);

/**
 * Two keys that are KNOWN but never gate anything, so `evalGate` has no branch for
 * either and none is needed:
 *
 * `group` (`slot0._group`, battlebuffcastskill.lua `castSkill`'s `GetGroupData()`
 * loop): when a cast fires it walks every OTHER BattleBuffCastSkill effect
 * currently on the target and suppresses ITSELF if one shares the same `group.id`
 * at a HIGHER `group.level`. That is a rung-suppression comparison against sibling
 * buffs, not a condition on the caster — passing unconditionally is correct unless
 * a higher-level sibling of the same group is also live, which this sim does not
 * track (modelling it is out of scope; see the task-4 report).
 *
 * `bulletTrigger` (`battlebuffcastskill.lua` `onBulletCreate`): names the
 * bullet-lifecycle event (e.g. impact) that should invoke `castSkill` on a bullet
 * this effect spawned — `_bullet:SetBuffFun(bulletTrigger, ...)`. It is a
 * trigger-name selector, playing the same role the buff's own `tr` list plays
 * elsewhere: it says WHEN the cast fires, not whether it is allowed. Zero
 * occurrences in the published graph today (Task 1's walk does not reach
 * onBulletCreate), kept explicit so a future pruner change can't silently widen
 * what this set means without a decision on record.
 */

/** Gate keys keyed on battlefield state the sim does not model. */
const UNKNOWN_KEYS = [
  'fleetAttr', 'fleetAttrConsume', 'fleetAttrDelta', 'stack_require', 'streakRange',
  'effectAttachData', 'killer', 'damageReason', 'deathCause', 'dungeonTypeList',
  'attrCompare', 'attrInterval', 'attrLowerBound', 'attrUpperBound', 'targetMaxHPRatio',
  'be_hit_condition', 'cloak', 'check_target_gap', 'armor_type', 'weaponType',
  // check_weapon sub-filters `GetEquipmentList` also applies (both 100% co-occur
  // with check_weapon in the published graph): `label` requires the equipped
  // ITEM's own label tags (battlebuffcastskill.lua reads
  // `GetWeaponDataFromID(id).label`) to contain every string listed; `weapon_group`
  // requires the item's equip-template `group` id (a weapon-family id finer than
  // `type`, e.g. one gun lineage) to be in the list. UnitCtx only carries the
  // coarse `equipTypes` numbers — no per-item label or group id exists to check.
  'label', 'weapon_group',
  // onFoeAircraftDying's sibling of `killer` (battlebuffeffect.lua
  // onFoeAircraftDying): the shot-down aircraft must be inside the fleet's AA
  // weapon's effective range (`not GetFleetAntiAirWeapon():IsOutOfRange(unit)`) —
  // spatial battlefield state, same class as `killer` right above it.
  'inside',
  // TargetFleetIndex's slot selector (battletargetchoise.lua TargetFleetIndex):
  // picks the ONE ship at a named formation slot (flagship / scout leader / center
  // / rear / consort). UnitCtx has no formation-slot model at all, for this unit or
  // any other in the fleet.
  'fleetPos',
];
for (const k of UNKNOWN_KEYS) KNOWN_GATE_KEYS.add(k);

/** Target tokens that name the ENEMY side, whose composition the sim does not model. */
const ENEMY_TOKENS = new Set([
  'TargetAllHarm', 'TargetHarm', 'TargetHarmRandom', 'TargetHarmNearest',
  'TargetLowestHP', 'TargetHighestHP', 'TargetHighestHPRatio', 'TargetHPCompare',
  'TargetAttrCompare', 'TargetShipArmor',
]);

const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** How many things the check_target clause matches. */
function _matchCount(a, unit, tags) {
  if (arr(a.ship_tag_list).length) {
    return arr(a.ship_tag_list).some((t) => tags.has(String(t))) ? 1 : 0;
  }
  if (arr(a.ship_type_list).length) {
    return arr(a.ship_type_list).includes(unit.shipType) ? 1 : 0;
  }
  if (arr(a.nationality).length) {
    return arr(a.nationality).includes(unit.nationality) ? 1 : 0;
  }
  // No discriminator: a plain fleet-size test. `exceptCaster` drops self.
  return Math.max(0, (unit.allyCount || 1) - (a.exceptCaster ? 1 : 0));
}

export function evalGate(a, unit, tags) {
  if (!a) return true;
  for (const k of UNKNOWN_KEYS) if (a[k] != null) return 'unknown';

  if (a.check_spweapon && !unit.spEquipped) return false;

  // HP interval, pinned at 1.0.
  if (a.hpUpperBound != null || a.hpLowerBound != null) {
    const up = a.hpUpperBound != null ? a.hpUpperBound : 1;
    const lo = a.hpLowerBound != null ? a.hpLowerBound : 0;
    // Transcribed literally from hpIntervalRequire: the out-of-interval test is two
    // independent NON-STRICT comparisons (`up <= hp || hp <= lo`), not the negation of
    // the in-interval one. They diverge exactly at hp === up or hp === lo, which HP
    // pinned at 1 reaches whenever hpOutInterval pairs with a bare hpLowerBound (upper
    // then defaults to 1). No record has that shape today; the literal form cannot
    // acquire the bug if one appears.
    const ok = a.hpOutInterval ? (up <= 1 || 1 <= lo) : (1 <= up && lo <= 1);
    if (!ok) return false;
  }

  if (a.check_weapon) {
    const types = arr(a.type);
    const slots = arr(a.index);
    let n = 0;
    for (let i = 0; i < (unit.equipTypes || []).length; i++) {
      if (slots.length && !slots.includes(i + 1)) continue;
      if (!types.length || types.includes(unit.equipTypes[i])) n += 1;
    }
    if (n < (a.minWeaponNumber || 0)) return false;
    if (a.maxWeaponNumber != null && n > a.maxWeaponNumber) return false;
  }

  if (a.check_target) {
    if (arr(a.check_target).some((t) => ENEMY_TOKENS.has(t))) return 'unknown';
    const n = _matchCount(a, unit, tags);
    if (n < (a.minTargetNumber || 0)) return false;
    if (a.maxTargetNumber != null && n > a.maxTargetNumber) return false;
    return true;
  }

  // WITHOUT check_target these keys do NOT gate the cast. castSkill skips the whole
  // check_target block when it is absent and casts anyway; the keys then ride `target`
  // to filter who RECEIVES the buff. The sim models ONE ship, so it cannot say whether
  // that recipient is the ship being simulated — the same unanswerable question an
  // enemy target token asks, and it takes the same answer.
  //
  // Returning `false` here instead was a SILENT under-count: 사우스다코타's 11011 and
  // 하쿠호's 151541 are cross-ship pairing bonuses whose weapons simply vanished with no
  // note. Measured on the published graph: all 20 effects of this shape target ANOTHER
  // ship (18 TargetAllHelp+TargetShipTag, 1 TargetAllHarm+TargetShipTag, 1
  // TargetNationalityFriendly) — not one is TargetSelf, so no self-check is lost.
  if (arr(a.ship_tag_list).length || arr(a.ship_type_list).length || arr(a.nationality).length) {
    return 'unknown';
  }
  return true;
}
