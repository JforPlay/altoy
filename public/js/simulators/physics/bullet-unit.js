/**
 * physics/bullet-unit.js
 * BulletUnit — the base bullet, mirroring the game's BattleBulletUnit
 * (battlebulletunit.lua). Pure: no DOM, no wall-clock. One simulation tick
 * advances the unit by exactly 1/30 game-second.
 *
 * Coordinate model: `position {x, y}` is the horizontal battlefield plane
 * (the game's x/z); `altitude` is the vertical axis (the game's _position.y).
 */

import { BULLET_SPEED_CONVERT, BOMB_DETONATE_HEIGHT } from './constants.js';
import { sqrDistance } from './vec.js';
import { parseAccTable } from './acc-table.js';

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

    // Movement data. _accTable mirrors the game's mixed _accTable Lua table:
    // an `accels` list for doAccelerate plus optional tracker / circle / orbit
    // entries. The base-class InitSpeed reads it to pick the single
    // updateSpeed function; subclasses that override InitSpeed (e.g.
    // BombBulletUnit) bypass it.
    this._accTable = parseAccTable(opts.acceleration, opts.barrageAngle);
    // Homing target / circle-centre fallback. {x, y} game coords (horizontal plane).
    this._target = opts.target ?? null;
    // Live weapon position for the harness-only doOrbit. {x, y} game coords.
    this._weaponPos = opts.weaponPos ?? null;
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

  // PascalCase mirrors the Lua originals (battlebulletunit.lua:411-423) to
  // keep the priority chain in InitSpeed readable against the source.
  /** #_accTable ~= 0 — the array part is non-empty (battlebulletunit.lua:411). */
  HasAcceleration() {
    return this._accTable.accels.length > 0;
  }

  /** _accTable.tracker is set (battlebulletunit.lua:415). */
  IsTracker() {
    return this._accTable.tracker != null;
  }

  /** _accTable.circle is set (battlebulletunit.lua:423). */
  IsCircle() {
    return this._accTable.circle != null;
  }

  /** _accTable.orbit is set (battlebulletunit.lua:419). */
  IsOrbit() {
    return this._accTable.orbit != null;
  }

  /**
   * Pick the single per-tick movement function. Mirrors InitSpeed
   * (battlebulletunit.lua:738-768). The game's priority chain is
   * HasAcceleration -> doAccelerate, IsTracker -> doTrack, IsCircle -> doCircle,
   * else doNothing. The accel / tracker / circle branches are wired in the
   * following tasks; for now every bullet still resolves to doNothing.
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
   * and altitude by `verticalSpeed`, then test expiry — squared-distance range
   * for a straight bullet (`gravity === 0`), descent past the bomb-detonation
   * height for a gravity bullet (`battlebulletunit.lua:155`, where the game's
   * `_position.y` is this core's `altitude`). The fieldSwitchHeight / dive
   * branch is out of scope.
   */
  Update() {
    this.updateSpeed();
    this.position.x += this.speed.x;
    this.position.y += this.speed.y;
    this.altitude += this.verticalSpeed;

    if (this.gravity === 0) {
      this.reachDestFlag = this.sqrRange < sqrDistance(this.spawnPos, this.position);
    } else {
      this.reachDestFlag = this.altitude <= BOMB_DETONATE_HEIGHT;
    }
  }
}
