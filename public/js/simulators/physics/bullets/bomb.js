/**
 * physics/bullets/bomb.js
 * BombBulletUnit — bullet types 2 (BOMB) and 16. Mirrors the game's
 * BattleBombBulletUnit (battlebombbulletunit.lua) plus the airdrop spawn
 * geometry from the view layer's getHeightAdjust (battlebullet.lua:226-239).
 *
 * An airdrop bomb is aimed at an `explodePos` — a planar {x, y} point the
 * firing pipeline supplies. It spawns above that point (and, with dropOffset,
 * behind it), then falls under gravity onto it. The game's explodePos vertical
 * component is always BombDetonateHeight; this core keeps the vertical
 * implicit (the BOMB_DETONATE_HEIGHT constant).
 *
 * Coordinate model: `position {x, y}` is the horizontal plane, `altitude` the
 * vertical axis. A bomb's horizontal `speed` drifts it toward explodePos while
 * `verticalSpeed` (solved at spawn) carries the descent.
 */

import { BulletUnit } from '../bullet-unit.js';
import { BULLET_SPEED_CONVERT, GRAVITY, AIRCRAFT_HEIGHT, BOMB_DETONATE_HEIGHT } from '../constants.js';
import { sqrDistance } from '../vec.js';

const DEG_PER_RAD = 180 / Math.PI;

export class BombBulletUnit extends BulletUnit {
  constructor(opts = {}) {
    super(opts);
    // The base defaults gravity to 0; a bomb defaults to BattleConfig.GRAVITY.
    if (opts.gravity == null) this.gravity = GRAVITY;
    // Mode flag: airdrop (default true for back-compat) repositions the bomb
    // above explodePos and aims at it; non-airdrop spawns at spawnX/spawnY
    // (already placed by super) and aims at explodePos only if one is supplied.
    this.airdrop = opts.airdrop ?? true;
    this.explodePos = opts.explodePos ?? null;            // both modes; null = aim-by-yAngle
    this.direction = opts.direction ?? 1;                 // host facing (+1 / -1)
    this.offsetY = opts.offsetY ?? AIRCRAFT_HEIGHT;       // drop height; game uses host y
    this.dropOffset = opts.dropOffset ?? false;           // spawn behind the aim point?
    this.launchVrtSpeed = opts.launchVrtSpeed ?? null;    // explicit vertical-speed override
    this.explodeTime = opts.explodeTime ?? null;          // extra_param.timeToExplode, seconds
  }

  /**
   * Resolve the spawn geometry. Two modes:
   *
   * Airdrop (this.airdrop === true): mirrors getHeightAdjust
   * (battlebullet.lua:226-239). The bomb spawns at `offsetY` altitude above
   * the explode point and, with dropOffset set, behind it by
   *   sqrt(|2 * offsetY / gravity|) * convertedVelocity
   * mirrored by host facing. Then solves verticalSpeed for parabolic arrival.
   *
   * Non-airdrop: spawn position was already placed by base BulletUnit from
   * spawnX/spawnY; altitude defaults to spawnAltitude (the firing weapon's
   * altitude). If an explodePos was supplied, solves verticalSpeed for the
   * parabola (battlebombbulletunit.lua:73-76). Without one, verticalSpeed
   * stays 0 and the bomb falls under gravity only (doNothing).
   */
  SetSpawnPosition() {
    if (this.airdrop) {
      const convertedVelocity = this.velocity * BULLET_SPEED_CONVERT;
      const dropOffsetX = this.dropOffset
        ? Math.sqrt(Math.abs(2 * this.offsetY / this.gravity))
            * convertedVelocity * Math.sign(this.direction || 1)
        : 0;
      this.position = { x: this.explodePos.x - dropOffsetX, y: this.explodePos.y };
      this.spawnPos = { x: this.position.x, y: this.position.y };
      this.altitude = this.offsetY;

      // SetSpawnPosition (battlebombbulletunit.lua:73-76): solve verticalSpeed
      // so the parabola passes through the explode point at BOMB_DETONATE_HEIGHT.
      // flightTime is in TICKS (convertedVelocity is per-tick displacement). The
      // game's 3D distance keeps the explode point's vertical un-filtered, so the
      // BOMB_DETONATE_HEIGHT term is load-bearing when the bomb is directly
      // overhead (planar distance 0 — flightTime would otherwise be 0).
      if (convertedVelocity !== 0) {
        const flightTime = Math.sqrt(
          sqrDistance(this.spawnPos, this.explodePos)
          + BOMB_DETONATE_HEIGHT * BOMB_DETONATE_HEIGHT,
        ) / convertedVelocity;
        this.verticalSpeed = this.launchVrtSpeed != null
          ? this.launchVrtSpeed
          : (BOMB_DETONATE_HEIGHT - this.altitude) / flightTime
            - 0.5 * this.gravity * flightTime;
      }
      return;
    }

    // Non-airdrop branch. position/spawnPos/altitude already set by super.
    // Only the parabola solve runs, and only if an explodePos was supplied.
    if (this.explodePos && this.velocity !== 0) {
      const convertedVelocity = this.velocity * BULLET_SPEED_CONVERT;
      const flightTime = Math.sqrt(
        sqrDistance(this.spawnPos, this.explodePos)
        + BOMB_DETONATE_HEIGHT * BOMB_DETONATE_HEIGHT,
      ) / convertedVelocity;
      this.verticalSpeed = this.launchVrtSpeed != null
        ? this.launchVrtSpeed
        : (BOMB_DETONATE_HEIGHT - this.altitude) / flightTime
          - 0.5 * this.gravity * flightTime;
    }
  }

  /**
   * Aim the bomb from its spawn to the explode point and pick the movement
   * function. Mirrors BattleBombBulletUnit.InitSpeed (battlebombbulletunit.lua:
   * 15-25). getHeightAdjust spawns the bomb at the explode point's planar y, so
   * the heading is 0 (or 180 for a left-facing host): the bomb drifts purely
   * along x while verticalSpeed carries the descent. _barrageLowPriority is not
   * modelled (0 airdrop bombs use it — Task 1).
   */
  InitSpeed() {
    // TODO(Phase 3c Task 4): null-guard for non-airdrop path; defer to super
    // for priority chain. This dereferences explodePos unconditionally and
    // will throw for non-airdrop bombs whose firing pipeline has no target.
    this.yAngle = Math.atan2(
      this.explodePos.y - this.spawnPos.y,
      this.explodePos.x - this.spawnPos.x,
    ) * DEG_PER_RAD;
    this.calcSpeed();
    this.updateSpeed = this.doNothing;
  }

  /**
   * Advance one tick, then apply the bomb detonation rule. The base Update
   * already sets reachDestFlag from the altitude check; BattleBombBulletUnit.
   * IsOutRange (battlebombbulletunit.lua:37-51) overrides it — a bomb with a
   * timeToExplode deadline detonates ONLY on the timer, never on altitude. The
   * precast `_exist` gate is not modelled (the sim spawns a bomb only once it
   * exists).
   */
  Update() {
    super.Update();
    if (this.explodeTime != null) {
      this.reachDestFlag = this.timeElapsed >= this.explodeTime;
    }
  }
}
