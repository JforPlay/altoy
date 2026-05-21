/**
 * physics/bullets/missile.js
 * MissileBulletUnit — bullet type 13. Mirrors BattleMissileUnit
 * (battlemissileunit.lua). Two-state lattice: LAUNCH -> ATTACK.
 *
 * HARNESS-ONLY: this class is NOT registered in bullet-registry.js and is
 * NOT routed by sim.engine.bullet.js. 0 reached against current data; built
 * for fidelity and node:test verification. If data drift adds a reached
 * missile bullet, register at type 13 and add an _isMigratedMissile
 * predicate + dispatch line in the engine.
 *
 * Spec §D2: extra_param fields are FLAT. The legacy MissileBehavior reads a
 * nested `extra_param.missile` object that exists in 0 bullets (legacy bug).
 */

import { BulletUnit } from '../bullet-unit.js';
import { GRAVITY, BOMB_DETONATE_HEIGHT, TICK_SECONDS, BULLET_SPEED_CONVERT } from '../constants.js';

const STATE = { LAUNCH: 'launch', ATTACK: 'attack' };

export class MissileBulletUnit extends BulletUnit {
  constructor(opts = {}) {
    super(opts);
    const ep = opts.extraParam || {};
    this._launchVrtSpeed = ep.launchVrtSpeed ?? 0;
    this._launchRiseTime = ep.launchRiseTime ?? 0;
    this._fallTime       = ep.fallTime ?? 1;          // guard div-by-0 in CompleteRise
    this._missileGravity = ep.gravity ?? GRAVITY;
    this._explodePos     = opts.explodePos ?? null;

    this._state          = STATE.LAUNCH;
    this.gravity         = this._missileGravity;      // integrates via doNothing in LAUNCH
  }

  /**
   * Mirrors SetSpawnPosition (battlemissileunit.lua:50-54): seed verticalSpeed
   * to the launch impulse. Called by world.spawnBullet between FixRange and
   * InitSpeed.
   */
  SetSpawnPosition() {
    this.verticalSpeed = this._launchVrtSpeed;
  }

  /**
   * Mirrors Update + state transition (battlemissileunit.lua:56-62) plus the
   * IsOutRange ATTACK-altitude detonation (:81-83).
   */
  Update() {
    super.Update();   // base movement + base range expiry

    if (this._state === STATE.LAUNCH
        && this.timeElapsed > this._launchRiseTime) {
      this._completeRise();
    }
    if (this._state === STATE.ATTACK && this.altitude <= BOMB_DETONATE_HEIGHT) {
      this.reachDestFlag = true;
    }
  }

  /**
   * Mirrors CompleteRise (battlemissileunit.lua:64-79): transition to ATTACK,
   * zero gravity, re-aim yAngle at explodePos, re-derive verticalSpeed and
   * velocity so the bullet covers planar distance to explodePos in fallTime
   * seconds and descends through current altitude in the same time.
   *
   * The Lua's `* (1/viewFPS)` is the per-tick scaling, which in our model is
   * TICK_SECONDS (= 1/30). Net per-tick planar displacement is
   * planarDist * TICK_SECONDS / fallTime; we expose this as `velocity`
   * (data units) and let calcSpeed re-derive `speed`.
   */
  _completeRise() {
    this._state = STATE.ATTACK;
    this.gravity = 0;

    if (!this._explodePos) return;            // harness-only path: no explode -> coast

    const dx = this._explodePos.x - this.spawnPos.x;
    const dy = this._explodePos.y - this.spawnPos.y;
    this.yAngle = Math.atan2(dy, dx) * (180 / Math.PI);

    this.verticalSpeed = -(this.altitude / this._fallTime) * TICK_SECONDS;

    // The Lua reads `pg.Tool.FilterY(explodePos - position):Magnitude()` —
    // unsigned planar distance. velocity is a magnitude in BulletUnit and is
    // combined with yAngle (set above from spawnPos -> explodePos) by
    // calcSpeed. An overshooting missile cannot reverse here — but
    // overshoot is a non-game state (launchRiseTime is short enough that the
    // bullet never passes the target in production data).
    const planarDist = Math.hypot(
      this._explodePos.x - this.position.x,
      this._explodePos.y - this.position.y,
    );
    const perTickPlanar = (planarDist * TICK_SECONDS) / this._fallTime;
    this.velocity = perTickPlanar / BULLET_SPEED_CONVERT;
    this.calcSpeed();
  }
}
