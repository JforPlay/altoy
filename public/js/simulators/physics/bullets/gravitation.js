/**
 * physics/bullets/gravitation.js
 * GravitationBulletUnit — bullet type 11. Mirrors BattleGravitationBulletUnit
 * (battlegravitationbulletunit.lua). Thin: inherits all movement from
 * BulletUnit and adds a lifetime cap from hit_type.time.
 *
 * The visible payoff is what this class does NOT do: the deleted legacy
 * GravitationBehavior invented a FALLING -> ACTIVE -> EXPIRED state machine
 * that position-locked the bullet at spawn. The game Lua has no FALLING phase
 * — the bullet travels at its own velocity and damages on overlap (spec §D3).
 * Replacing it means the bullet now MOVES.
 */

import { BulletUnit } from '../bullet-unit.js';

export class GravitationBulletUnit extends BulletUnit {
  constructor(opts = {}) {
    super(opts);
    // hit_type.time = lifetime cap. Mirror EffectBulletUnit's normalization
    // (Phase 3a): null / <= 0 (incl. the game's -1 sentinel) -> no cap.
    // Range expiry can't fire for a stationary bullet, so for current
    // reached data (all three have hit_type.time in 1..3 s) the cap IS the
    // expiry path — not dormant, unlike the EffectBulletUnit case.
    const t = opts.hitTypeTime;
    this._lifetimeCap = (t != null && t > 0) ? t : null;
    this._explodePos = null;

    // "Random target lock" (skill 15090 / 115090): the game spawns the
    // gravitation bullet AT the target's location and the bullet stays put.
    // The sim's firing pipeline already passes the AIM target as opts.target
    // (game coords). For a bullet with empty acceleration (all three reached
    // gravitations) `_target` is otherwise unused — doNothing doesn't read
    // it. Repurpose it as the spawn-jump destination here. If no target was
    // supplied (harness test or no enemies on stage), the bullet stays where
    // the weapon fired from — acceptable; the lifetime cap still drives
    // expiry the same way.
    if (opts.target
        && Number.isFinite(opts.target.x)
        && Number.isFinite(opts.target.y)) {
      this.position = { x: opts.target.x, y: opts.target.y };
      this.spawnPos = { x: opts.target.x, y: opts.target.y };
    }
  }

  /**
   * The game's BattleGravitationBulletUnit.Update gates base movement on
   * `_pierceCount > 0` (battlegravitationbulletunit.lua:12-16). In the game
   * the bullet spawns at the target lock, hits immediately on its first
   * tick: Hit decrements _pierceCount (1 → 0) and teleports _position.y to
   * 100 (invisible). The gate then closes, the bullet stops moving, and the
   * visible whirlpool is a separate buff/area VFX driven by DealDamage.
   *
   * The simulator has no damage model — we never call Hit, so a literal
   * "Update gates on > 0 → Update keeps running → bullet moves" port
   * diverges from the game's observed behavior (whirlpool stays at target
   * lock, doesn't travel). We mirror the OBSERVED behavior by skipping
   * super.Update entirely: bullet is stationary from spawn, lifetime is
   * driven by hit_type.time (`_pierceCount` is initialized from
   * `bullet_template.pierce_count` in `battlebulletunit.lua:215` but is
   * unused here — recorded in Task 1).
   */
  Update() {
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
