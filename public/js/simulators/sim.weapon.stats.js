/**
 * sim.weapon.stats.js
 * Pure, DOM-free computations for the weapon-sim info panel: weapon cooldown,
 * barrage bullet counts, and skill-description placeholder substitution.
 * No imports, no DOM, no browser globals — unit-tested under `node --test`.
 * Consumed by sim.ui.js (card rendering) and sim.weapon.main.js (description).
 */

// Reload→cooldown constants from BattleConfig (AzurLaneLuaScripts/KR
// mod/battle/data/battleconfig.lua:16-18); formula in battleformulas.lua:312:
//   CalculateReloadTime(reload_max, loadSpeed) = reload_max / K1 / sqrt((loadSpeed + K2) * K3)
const RELOAD_K1 = 6;
const RELOAD_K2 = 100;
const RELOAD_K3 = 3.14;

/**
 * Real weapon cooldown in seconds. loadSpeed defaults to 100 — the in-game
 * equip-detail default (model/vo/equipment.lua:93). Returns null when reloadMax
 * is missing/zero so callers can render '-'.
 */
export function weaponCooldownSeconds(reloadMax, loadSpeed = 100) {
    if (!reloadMax) return null;
    return reloadMax / RELOAD_K1 / Math.sqrt((loadSpeed + RELOAD_K2) * RELOAD_K3);
}

/**
 * Does a skill effect's target_choise resolve to an aimable ENEMY target?
 *
 * WHY this, not weapon.aim_type: skill weapons fire via BattleSkillFire →
 * weapon:SingleFire (battleweaponunit.lua:738), which aims iff a target was
 * passed and NEVER reads aim_type. The target is the skill effect's resolved
 * target list (battleskilleffect.lua Effect():27 — non-empty → DataEffect/aim;
 * empty → DataEffectWithoutTarget → fire forward at baseAngle).
 *
 * The "Harm" family (TargetHarm…, TargetAllHarm, incl. comma-joined combos like
 * "TargetAllHarm,TargetShipTag,TargetRandom") selects opposite-IFF units, i.e.
 * enemies (battletargetchoise.lua: GetIFF()*iff == -1 / TargetFoeUncloak), so it
 * aims. TargetNil/TargetNull (the common "deploy a barrage" case), self, ally
 * (TargetPlayerFlagShip), and bare same-IFF ship-tag choices have no enemy to
 * aim at → forward. TargetSameToLastEffect must be resolved to the prior effect's
 * choise by the caller before reaching here.
 *
 * @param {string|null|undefined} targetChoise resolved target_choise of the effect
 * @returns {boolean} true → aim at enemy; false → fire forward
 */
export function targetChoiceAimsAtEnemy(targetChoise) {
    if (!targetChoise) return false;
    return /Harm/.test(targetChoise);
}

/**
 * Bullet-count + geometry for a weapon's barrage(s), mirroring the firing loop
 * in sim.weapon.controller.js (fireWeapon → fireBarrage → fireWave*).
 * Representative rows (waves/bulletsPerWave/delay/seniorDelay/scatter) come from
 * the first VALID barrage; `totalBullets` sums every pattern in weapon.barrage_ID[].
 * `uniform` is false when patterns differ in bullet count. Returns null when no
 * valid barrage exists.
 *
 * @param {object} weapon       weapon_property entry ({ barrage_ID, bullet_ID, ... })
 * @param {object} dataStores   { barrageData } keyed by barrage id
 * @param {object} [weaponInfo] { quota? } from the skill effect (quota overrides senior_repeat)
 */
export function computeBarrageStats(weapon, dataStores, weaponInfo = {}) {
    const barrageIds = Array.isArray(weapon?.barrage_ID) ? weapon.barrage_ID : [];
    const barrageData = dataStores?.barrageData || {};

    let total = 0;
    let rep = null;            // first valid barrage (representative pattern)
    let firstPerPattern = null;
    let patternCount = 0;
    let uniform = true;

    for (const id of barrageIds) {
        const b = barrageData[id];
        if (!b) continue;
        patternCount++;
        const waves = weaponInfo.quota ?? ((b.senior_repeat || 0) + 1);
        const perPattern = waves * ((b.primal_repeat || 0) + 1);
        total += perPattern;
        if (rep === null) { rep = b; firstPerPattern = perPattern; }
        else if (perPattern !== firstPerPattern) { uniform = false; }
    }

    if (rep === null) return null;

    return {
        totalBullets: total,
        waves: weaponInfo.quota ?? ((rep.senior_repeat || 0) + 1),
        bulletsPerWave: (rep.primal_repeat || 0) + 1,
        delay: rep.delay || 0,
        seniorDelay: rep.senior_delay || 0,
        // Scatter cone — model/vo/equipment.lua:457 (note: primal_repeat, not +1).
        scatterAngle: rep.random_angle
            ? (rep.angle || 0)
            : Math.abs(rep.delta_angle || 0) * (rep.primal_repeat || 0),
        patternCount,
        uniform,
    };
}

/**
 * Substitute $1,$2,… in a skill description.
 *  - descGetAdd populated → replace each $n with its min~max range
 *    (descGetAdd[n-1] = [min, max]); single value when min===max.
 *  - else descGet (pre-formatted max-level string) when present.
 *  - else the raw desc.
 * A single /\$(\d+)/ pass keeps $10 from being mangled by a $1 replacement.
 *
 * @param {string} desc
 * @param {object} [opts] { descGetAdd?: Array, descGet?: string }
 */
export function formatSkillDesc(desc, { descGetAdd, descGet } = {}) {
    if (!desc) return '설명 없음';
    if (Array.isArray(descGetAdd) && descGetAdd.length > 0) {
        return desc.replace(/\$(\d+)/g, (match, numStr) => {
            const params = descGetAdd[Number(numStr) - 1];
            if (params === undefined) return match;
            if (Array.isArray(params)) {
                const first = params[0];
                const last = params[params.length - 1];
                return first === last ? String(first) : `${first} ~ ${last}`;
            }
            return String(params);
        });
    }
    if (typeof descGet === 'string' && descGet.length > 0) return descGet;
    return desc;
}
