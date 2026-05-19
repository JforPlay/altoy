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
import { BULLET_SPEED_CONVERT, GRAVITY, AIRCRAFT_HEIGHT } from '../constants.js';

export class BombBulletUnit extends BulletUnit {
  constructor(opts = {}) {
    super(opts);
    // The base defaults gravity to 0; a bomb defaults to BattleConfig.GRAVITY.
    if (opts.gravity == null) this.gravity = GRAVITY;
    this.explodePos = opts.explodePos ?? { x: 0, y: 0 };  // planar aim point
    this.direction = opts.direction ?? 1;                 // host facing (+1 / -1)
    this.offsetY = opts.offsetY ?? AIRCRAFT_HEIGHT;       // drop height; game uses host y
    this.dropOffset = opts.dropOffset ?? false;           // spawn behind the aim point?
    this.launchVrtSpeed = opts.launchVrtSpeed ?? null;    // explicit vertical-speed override
    this.explodeTime = opts.explodeTime ?? null;          // extra_param.timeToExplode, seconds
  }

  /**
   * Resolve the airdrop spawn position. Mirrors getHeightAdjust
   * (battlebullet.lua:226-239): an airdrop bomb spawns at `offsetY` altitude
   * above the explode point and, with dropOffset set, behind it by
   *   sqrt(|2 * offsetY / gravity|) * convertedVelocity
   * (the horizontal distance a projectile covers while falling offsetY),
   * mirrored by host facing. Called once at spawn, before InitSpeed. Task 7
   * extends this with the vertical-speed solve.
   */
  SetSpawnPosition() {
    const convertedVelocity = this.velocity * BULLET_SPEED_CONVERT;
    const dropOffsetX = this.dropOffset
      ? Math.sqrt(Math.abs(2 * this.offsetY / this.gravity))
          * convertedVelocity * Math.sign(this.direction || 1)
      : 0;
    this.position = { x: this.explodePos.x - dropOffsetX, y: this.explodePos.y };
    this.spawnPos = { x: this.position.x, y: this.position.y };
    this.altitude = this.offsetY;
  }
}
