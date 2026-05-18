/**
 * physics/bullet-unit.js
 * BulletUnit — the base bullet, mirroring the game's BattleBulletUnit
 * (battlebulletunit.lua). Pure: no DOM, no wall-clock. One simulation tick
 * advances the unit by exactly 1/30 game-second.
 *
 * Coordinate model: `position {x, y}` is the horizontal battlefield plane
 * (the game's x/z); `altitude` is the vertical axis (the game's _position.y).
 */

import { BULLET_SPEED_CONVERT } from './constants.js';
import { sqrDistance } from './vec.js';

const DEG_TO_RAD = Math.PI / 180;

export class BulletUnit {
  constructor(opts = {}) {
    this.type = opts.type ?? 1;
    this.velocity = opts.velocity ?? 0;       // base data velocity
    this.yAngle = opts.yAngle ?? 0;           // heading, degrees
    this.gravity = opts.gravity ?? 0;         // 0 for cannon
    this.rng = opts.rng ?? Math.random;

    this._baseRange = opts.range ?? 0;
    this._rangeOffset = opts.rangeOffset ?? 0;

    const sx = opts.spawnX ?? 0;
    const sy = opts.spawnY ?? 0;
    this.position = { x: sx, y: sy };
    this.spawnPos = { x: sx, y: sy };

    this.speed = { x: 0, y: 0 };  // per-tick horizontal displacement vector
    this.verticalSpeed = 0;       // per-tick altitude change
    this.altitude = opts.spawnAltitude ?? 0;

    this.range = 0;
    this.sqrRange = 0;
    this.timeElapsed = 0;
    this.reachDestFlag = false;
  }

  /**
   * Build the per-tick speed vector from the data velocity and heading.
   * Mirrors calcSpeed (battlebulletunit.lua:780-782). The game also multiplies
   * by (1 + bulletSpeedRatio); the simulator has no buff system, so that term
   * is its identity value (1) and is omitted.
   */
  calcSpeed() {
    const rad = this.yAngle * DEG_TO_RAD;
    const converted = this.velocity * BULLET_SPEED_CONVERT;
    this.speed = {
      x: converted * Math.cos(rad),
      y: converted * Math.sin(rad),
    };
  }

  /**
   * Resolve the effective range. Mirrors FixRange (battlebulletunit.lua:819-831):
   *   range_offset == 0  ->  range unchanged
   *   else               ->  range + range_offset * (random() - 0.5)
   * then clamp to >= 0. sqrRange is cached for the squared-distance expiry test.
   */
  FixRange() {
    this.range = this._rangeOffset === 0
      ? this._baseRange
      : this._baseRange + this._rangeOffset * (this.rng() - 0.5);
    this.range = Math.max(0, this.range);
    this.sqrRange = this.range * this.range;
  }

  /**
   * Pick the single per-tick movement function. Mirrors InitSpeed
   * (battlebulletunit.lua:738-768). The game's priority chain is
   * HasAcceleration -> doAccelerate, IsTracker -> doTrack, IsCircle -> doCircle,
   * else doNothing. Acceleration/tracker/circle are added in Phase 2; for now
   * every bullet resolves to doNothing.
   */
  InitSpeed() {
    this.calcSpeed();
    this.updateSpeed = this.doNothing;
  }

  /**
   * The movement function for a non-accel/track/circle bullet. Mirrors doNothing
   * (battlebulletunit.lua:115-119): it is the gravity integrator. GetSpeedRatio()
   * is 1 in all default cases, so it is omitted.
   */
  doNothing() {
    if (this.gravity !== 0) {
      this.verticalSpeed += this.gravity;
    }
  }

  /**
   * Advance the bullet one fixed tick. Mirrors Update (battlebulletunit.lua:
   * 139-157): run the chosen movement function, integrate position by `speed`
   * and altitude by `verticalSpeed`, then test range expiry.
   *
   * Only the non-gravity (`gravity === 0`) expiry branch is implemented here;
   * the gravity-bullet detonation branch (`altitude <= BombDetonateHeight`)
   * arrives with the bomb work in Phase 2.
   */
  Update() {
    this.updateSpeed();
    this.position.x += this.speed.x;
    this.position.y += this.speed.y;
    this.altitude += this.verticalSpeed;

    if (this.gravity === 0) {
      this.reachDestFlag = this.sqrRange < sqrDistance(this.spawnPos, this.position);
    }
  }
}
