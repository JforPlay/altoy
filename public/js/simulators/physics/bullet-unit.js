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
import { sqrDistance, magnitude, scale } from './vec.js';
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
   * else doNothing. The tracker / circle branches are wired in following tasks.
   */
  InitSpeed() {
    this.calcSpeed();
    if (this.HasAcceleration()) {
      // doAccelerate: seed the forward / cross basis from the firing heading
      // (battlebulletunit.lua:745-750). _speedCross is _speedNormal rotated
      // 90deg (the game's Cross with Vector3.up).
      const rad = this.yAngle * DEG_TO_RAD;
      this._speedLength = magnitude(this.speed);
      this._speedNormal = { x: Math.cos(rad), y: Math.sin(rad) };
      this._speedCross = { x: -this._speedNormal.y, y: this._speedNormal.x };
      this.updateSpeed = this.doAccelerate;
    } else {
      this.updateSpeed = this.doNothing;
    }
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
   * The acceleration (u, v) active at the current time. Mirrors GetAcceleration
   * (battlebulletunit.lua:427-442): the latest record whose `t` has elapsed.
   * The game quantises the lookup to ACC_INTERVAL because it can be called at a
   * variable rate; the fixed-timestep core advances `timeElapsed` by exactly
   * one ACC_INTERVAL per tick, so the quantisation is structural and the lookup
   * is a plain threshold test. `accels` is pre-sorted ascending by `t`.
   *
   * `GetSpeedRatio()` multiplies u and v in the game; the simulator has no buff
   * system so the ratio is always 1 and is omitted (same rationale as calcSpeed).
   */
  GetAcceleration() {
    const accels = this._accTable.accels;
    // Scan from the LAST record backward, matching the game's loop direction
    // (battlebulletunit.lua:432-439). accels is sorted ascending by t, so the
    // first record found with t <= timeElapsed IS the latest active one.
    // O(1) in the steady state — typically the last or second-to-last record.
    for (let i = accels.length - 1; i >= 0; i--) {
      const rec = accels[i];
      if (rec.t <= this.timeElapsed) return { u: rec.u, v: rec.v };
    }
    return { u: 0, v: 0 };
  }

  /**
   * Flip every acceleration record's u sign. Mirrors reverseAcceleration
   * (battlebulletunit.lua:444-448) — the bounce when a negative u would drive
   * the forward speed below zero. Safe to mutate: parseAccTable returns fresh
   * record objects.
   */
  reverseAcceleration() {
    for (const rec of this._accTable.accels) rec.u = -rec.u;
  }

  /**
   * Movement function for an accelerating bullet. Mirrors doAccelerate
   * (battlebulletunit.lua:18-38) — the spec §B4 fix. Adds u along the forward
   * unit vector `_speedNormal` and v along the cross vector `_speedCross` as
   * velocity-vector components, then re-derives the basis from the new speed.
   * The turn a given v produces therefore scales with the speed magnitude —
   * the serpentine weave the legacy fixed-degree turn could not reproduce.
   */
  doAccelerate() {
    const { u, v } = this.GetAcceleration();
    if (u === 0 && v === 0) return;

    if (u < 0 && this._speedLength + u < 0) {
      this.reverseAcceleration();
    }

    this.speed = {
      x: this.speed.x + this._speedNormal.x * u + this._speedCross.x * v,
      y: this.speed.y + this._speedNormal.y * u + this._speedCross.y * v,
    };

    this._speedLength = magnitude(this.speed);
    if (this._speedLength !== 0) {
      this._speedNormal = scale(this.speed, 1 / this._speedLength);
    }
    // _speedCross = _speedNormal rotated 90deg (game: Cross with Vector3.up).
    this._speedCross = { x: -this._speedNormal.y, y: this._speedNormal.x };
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
