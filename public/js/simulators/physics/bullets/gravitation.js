/**
 * physics/bullets/gravitation.js
 * GravitationBulletUnit — bullet type 11. Mirrors BattleGravitationBulletUnit
 * (battlegravitationbulletunit.lua). Thin: inherits all movement from
 * BulletUnit and adds a lifetime cap from hit_type.time.
 *
 * The visible payoff is what this class does NOT do: the legacy
 * GravitationBehavior in sim.engine.bullet.factory.js invents a
 * FALLING -> ACTIVE -> EXPIRED state machine that position-locks the bullet
 * at spawn. The game Lua has no FALLING phase — the bullet travels at its
 * own velocity and damages on overlap (spec §D3). Migrating it means the
 * bullet now MOVES.
 */

import { BulletUnit } from '../bullet-unit.js';

export class GravitationBulletUnit extends BulletUnit {
  constructor(opts = {}) {
    super(opts);
    // hit_type.time = lifetime cap, in addition to range expiry. Mirror
    // EffectBulletUnit's normalization (Phase 3a): null / <= 0 (incl. the
    // game's -1 sentinel) -> only range expiry applies.
    const t = opts.hitTypeTime;
    this._lifetimeCap = (t != null && t > 0) ? t : null;
    this._explodePos = null;
  }

  /**
   * Pierce-count gate (battlegravitationbulletunit.lua:12-16). The game's
   * _pierceCount decrements only on Hit, which the simulator (no damage
   * model) never fires. Result: the gate effectively never closes — Update
   * always runs. We omit the gate rather than guard on a value we never
   * decrement. (Initial-value source recorded in Task 1.)
   */
  Update() {
    super.Update();                            // base movement + range expiry
    if (this._lifetimeCap != null && this.timeElapsed >= this._lifetimeCap) {
      this.reachDestFlag = true;
    }
  }

  /**
   * Mirrors BattleGravitationBulletUnit.SetExplodePosition (:28-30). Stored
   * but not used by movement — the simulator has no buff-area model.
   */
  SetExplodePosition(pos) {
    this._explodePos = pos;
  }
}
