/**
 * physics/bullets/effect.js
 * EffectBulletUnit — bullet type 9. Mirrors BattleEffectBulletUnit
 * (battleeffectbulletunit.lua). Thin: inherits all movement from BulletUnit
 * and adds a lifetime cap from hit_type.time.
 *
 * The lifetime fix closes spec bug #4 ("lingering red-dot effect, never
 * removed"): the legacy view path has no type-9 cleanup, so the bullet
 * element survives forever. Here, reachDestFlag flips when timeElapsed
 * crosses the cap, the world culls the unit, and the view driver removes
 * the DOM node via its standard expiry path.
 */

import { BulletUnit } from '../bullet-unit.js';

export class EffectBulletUnit extends BulletUnit {
  constructor(opts = {}) {
    super(opts);
    // hit_type.time = lifetime cap, in addition to range expiry.
    // null / undefined / <= 0 -> only range expiry applies. The "<= 0" case
    // is the data's "infinite lifetime" sentinel (bullet 19010 carries
    // `hit_type.time: -1`; 17 templates total, 1 reached in the current
    // skill set) — without this guard a -1 cap would expire on tick 1.
    this._lifetimeCap = (opts.hitTypeTime != null && opts.hitTypeTime > 0)
      ? opts.hitTypeTime
      : null;
    this._explodePos = null;
  }

  Update() {
    super.Update();                                   // movement + IsOutRange
    if (this._lifetimeCap != null && this.timeElapsed >= this._lifetimeCap) {
      this.reachDestFlag = true;
    }
  }

  /**
   * Mirrors BattleEffectBulletUnit.SetExplodePosition (battleeffectbulletunit.lua:71-73).
   * Stored but not used by movement — this sim has no buff-area model.
   */
  SetExplodePosition(pos) {
    this._explodePos = pos;
  }
}
