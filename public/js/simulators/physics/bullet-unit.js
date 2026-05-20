/**
 * physics/bullet-unit.js
 * BulletUnit — the base bullet, mirroring the game's BattleBulletUnit
 * (battlebulletunit.lua). Pure: no DOM, no wall-clock. One simulation tick
 * advances the unit by exactly 1/30 game-second.
 *
 * Coordinate model: `position {x, y}` is the horizontal battlefield plane
 * (the game's x/z); `altitude` is the vertical axis (the game's _position.y).
 */

import {
  BULLET_SPEED_CONVERT, BOMB_DETONATE_HEIGHT, TRACKER_ANGLE, TICK_SECONDS,
} from './constants.js';
import { sqrDistance, magnitude, scale, sub, normalize, dot, rotate, add } from './vec.js';
import { parseAccTable } from './acc-table.js';

const DEG_TO_RAD = Math.PI / 180;

// _trackingTarget state machine: null (unacquired) -> the live target (acquired)
// -> DROPPED (left _trackRange after acquisition; never re-acquired). Mirrors
// the game's setTrackingTarget(-1) sentinel (battlebulletunit.lua:48,52).
const DROPPED = Symbol('dropped');

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
   * else doNothing.
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
    } else if (this.IsTracker()) {
      // doTrack: seed the homing parameters (battlebulletunit.lua:751-758).
      const tracker = this._accTable.tracker;
      this._trackRange = tracker.range ?? 50;
      this._trackerAngularRad = (tracker.angular ?? 3) * DEG_TO_RAD;
      this._trackingTarget = null;
      this.updateSpeed = this.doTrack;
    } else if (this.IsCircle()) {
      // doCircle: seed the orbit state (battlebulletunit.lua:759-764). A data
      // `center` is {x,y,z}; its planar projection is {x: center.x, y:
      // center.z} (game z is the core's y). _centripetalSpeed carries the
      // game's per-tick (1/30 s) scale here so doCircle stays scale-free.
      const circle = this._accTable.circle;
      const center = circle.center;
      this._originPos = center
        ? { x: center.x, y: center.z ?? 0 }
        : this._target;
      this._circleAntiClockwise = !!circle.antiClockWise;
      this._centripetalSpeed = (circle.centripetalSpeed ?? 0) * TICK_SECONDS;
      // The Lua sets _convertedVelocity in ResetVelocity / SetTemplateData
      // before InitSpeed; the core collapses those into construction, and
      // `velocity` is immutable post-construction, so this seeding is safe.
      this._convertedVelocity = this.velocity * BULLET_SPEED_CONVERT;
      this._inverseFlag = 1;
      this.updateSpeed = this.doCircle;
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
   * Resolve the live tracking target, running the game's acquire / drop
   * lifecycle (battlebulletunit.lua:41-55). _trackingTarget is null until the
   * target first enters _trackRange; once bound, leaving _trackRange drops it
   * permanently (the DROPPED sentinel — the game's setTrackingTarget(-1)).
   * Returns the target to home on, or null. Caller guarantees this._target.
   *
   * Boundary: acquire uses `<= _trackRange`, drop uses `_trackRange <` —
   * faithful to the Lua. A target sitting exactly on the range edge acquires
   * and then never drops.
   */
  _resolveTrackingTarget() {
    const distance = magnitude(sub(this._target, this.position));
    if (this._trackingTarget === null && distance <= this._trackRange) {
      this._trackingTarget = this._target;
    }
    if (this._trackingTarget === null || this._trackingTarget === DROPPED) {
      return null;
    }
    if (this._trackRange < distance) {
      this._trackingTarget = DROPPED;
      return null;
    }
    return this._trackingTarget;
  }

  /**
   * Movement function for a homing bullet. Mirrors doTrack
   * (battlebulletunit.lua:40-83) — the spec §B5 fix. Holds heading inside the
   * cos(10deg) deadzone; otherwise turns toward the target, capped at one
   * angular step, and SNAPS exactly onto the target when within one step
   * (the game's dot/cross rotation branch — no oscillation or overshoot).
   */
  doTrack() {
    if (!this._target) return;
    const target = this._resolveTrackingTarget();
    if (!target) return;

    const toTarget = normalize(sub(target, this.position));
    const speedDir = normalize(this.speed);
    const dotValue = dot(speedDir, toTarget);
    if (dotValue >= TRACKER_ANGLE) return;        // inside the 10deg deadzone

    // Game cross with the z->y mapping: slot4.z*slot3.x - slot4.x*slot3.z.
    const crossValue = speedDir.y * toTarget.x - speedDir.x * toTarget.y;

    let cos = dotValue;
    let sin = crossValue;
    if (dotValue < Math.cos(this._trackerAngularRad)) {
      // Target more than one step away: turn by the fixed step toward it.
      cos = Math.cos(this._trackerAngularRad);
      sin = Math.sin(this._trackerAngularRad) * (crossValue >= 0 ? 1 : -1);
    }
    // Within one step (dotValue >= cos(step)): cos/sin stay dot/cross, which
    // rotates the heading by the exact remaining angle — the snap.
    this.speed = rotate(this.speed, cos, sin);
  }

  /**
   * Movement function for a circling bullet. Mirrors doCircle
   * (battlebulletunit.lua:100-113) — the spec §B7 fix. Rotates the
   * position-offset vector around the orbit centre and emits speed as the
   * resulting displacement, which pins an exact radius (the legacy
   * velocity-rotation drifts). _inverseFlag is the radial in/out oscillation;
   * _centripetalSpeed already carries the game's per-tick (1/30 s) scaling
   * applied by InitSpeed. GetSpeedRatio() is 1 and is omitted.
   */
  doCircle() {
    if (!this._originPos) return;

    const offset = sub(this.position, this._originPos);
    const radius = magnitude(offset);
    if (radius - this._centripetalSpeed * this._inverseFlag < 0) {
      this._inverseFlag = -this._inverseFlag;
    }
    if (radius <= 1e-5) return;

    const newRadius = radius - this._centripetalSpeed * this._inverseFlag;
    const angle = (this._convertedVelocity / radius)
      * (this._circleAntiClockwise ? 1 : -1);
    const rotated = rotate(offset, Math.cos(angle), Math.sin(angle));
    const newOffset = scale(rotated, newRadius / radius);
    this.speed = sub(newOffset, offset);
  }

  /**
   * Movement function for an orbiting bullet. Mirrors doOrbit
   * (battlebulletunit.lua:85-91), spec §B6 — the two-mode blend: far from the
   * weapon blend the heading toward it, near (planar distance <= 10) blend it
   * perpendicular. Emits a unit vector.
   *
   * HARNESS-ONLY: InitSpeed never assigns doOrbit — the game's base InitSpeed
   * has no orbit branch and 0 bullets carry acceleration.orbit (spec Open
   * item 1). Built for fidelity / possible future subclass use; dead in-page.
   */
  doOrbit() {
    if (!this._weaponPos) return;

    // Reuse one sub for both the direction and the distance — magnitude
    // ignores sign, so we don't need the reversed (position - weapon) call.
    const offset = sub(this._weaponPos, this.position);
    const distance = magnitude(offset);
    const toWeapon = normalize(offset);
    const headingDir = normalize(this.speed);

    const blendBase = distance > 10
      ? toWeapon                                      // far: toward the weapon
      : { x: -toWeapon.y, y: toWeapon.x };            // near: perpendicular
    this.speed = normalize(add(blendBase, headingDir));
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
