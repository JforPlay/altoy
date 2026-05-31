/**
 * physics/bullets/shrapnel.js
 * ShrapnelBulletUnit — bullet type 5. Mirrors BattleShrapnelBulletUnit
 * (battleshrapnelbulletunit.lua). Implements the monotonic state lattice
 * NORMAL -> SPIN -> SPLIT -> FINAL_SPLIT -> EXPIRE (spec §C6), gated
 * movement (NORMAL only), game-time emission scheduling, and the §C8
 * SetSpawnPosition overrides (directHit / flare).
 *
 * Pure: no DOM, no wall-clock. Child bullets are emitted via _pendingEmits;
 * the World's onEmit callback hands each spec back to the engine's
 * createBullet dispatch (so children flow through the strangler regardless
 * of their type).
 */

import { BulletUnit } from '../bullet-unit.js';
import { sqrDistance } from '../vec.js';
import { BULLET_SPEED_CONVERT } from '../constants.js';

export const STATE = Object.freeze({
  NORMAL: 'normal',
  SPIN: 'spin',
  SPLIT: 'split',
  FINAL_SPLIT: 'final_split',
  EXPIRE: 'expire',
});

export const STATE_PRIORITY = Object.freeze({
  [STATE.NORMAL]: 1,
  [STATE.SPIN]: 2,
  [STATE.SPLIT]: 3,
  [STATE.FINAL_SPLIT]: 4,
  [STATE.EXPIRE]: 5,
});

export class ShrapnelBulletUnit extends BulletUnit {
  constructor(opts = {}) {
    super(opts);
    this._extraParam = opts.extraParam ?? {};
    this._explodePos = opts.explodePos ?? null;
    this._bulletTemplates = opts.bulletTemplates ?? {};
    this._barrages = opts.barrages ?? {};
    // Injectable RNG so the shotgun spread (below) is deterministic in tests.
    // Production defaults to Math.random; physics stays free of ambient state
    // by taking randomness as a parameter, not reading a global directly.
    this._random = opts.random ?? Math.random;
    this._currentState = STATE.NORMAL;
    this._spinStartTime = -1;
    this._pendingEmits = [];

    this._trailing = [];
    this._splitGroups = [];
    this._splitEntryTime = -1;

    this._setupEmissions();
  }

  /**
   * Walk extra_param.shrapnel[] (a numeric-keyed object in data, plus a
   * conventional FXID string field that's not an entry) and partition into
   * trailing (initialSplit=true) and split groups. Each trailing entry gets
   * its own scheduler; split groups land in Task 10.
   */
  _setupEmissions() {
    const shrapnel = this._extraParam.shrapnel;
    if (!shrapnel) return;
    for (const key of Object.keys(shrapnel)) {
      if (key === 'FXID') continue;
      const info = shrapnel[key];
      if (!info || info === '') continue;
      const barrage = this._barrages[info.barrage_ID];
      const child = this._bulletTemplates[info.bullet_ID];
      if (!barrage || !child) continue;

      if (info.initialSplit) {
        const primalCount = (barrage.primal_repeat ?? 0) + 1;
        const seniorCount = (barrage.senior_repeat ?? 0) + 1;
        this._trailing.push({
          info, barrage, child,
          primalCount,
          seniorCount,
          // Wave (senior) scheduling. Wave 0 is gated by first_delay; later
          // waves arrive every senior_delay. Mirrors SeniorIteration.
          waveFired: 0,
          nextWaveTime: barrage.first_delay ?? 0,
          seniorDelay: barrage.senior_delay ?? 0,
          // Per-wave primal scheduling (reset at each wave start).
          shotsFired: primalCount,           // start "drained" so a wave must open first
          nextShotTime: 0,
          currentInterval: barrage.delay ?? 0,
          deltaInterval: barrage.delta_delay ?? 0,
        });
      } else {
        this._splitGroups.push({ info, barrage, child, emitted: false });
      }
    }
  }

  /**
   * Drain a trailing record against timeElapsed. Mirrors the emitter's
   * SeniorIteration x PrimalIteration: open up to seniorCount waves (staggered
   * by seniorDelay, wave 0 by first_delay), and within the open wave fire up to
   * primalCount shots (staggered by delay/delta_delay). Each shot pushes one
   * child spec.
   */
  _drainTrailing(rec) {
    // Open new waves whose start time has elapsed.
    while (
      rec.waveFired < rec.seniorCount &&
      this.timeElapsed > rec.nextWaveTime &&
      rec.shotsFired >= rec.primalCount
    ) {
      rec.waveFired += 1;
      rec.shotsFired = 0;
      rec.nextShotTime = rec.nextWaveTime;
      rec.currentInterval = rec.barrage.delay ?? 0;
      rec.nextWaveTime += rec.seniorDelay;
    }
    // Fire primal shots within the currently open wave.
    while (rec.shotsFired < rec.primalCount && this.timeElapsed > rec.nextShotTime) {
      this._emitChild(rec.info, rec.barrage, rec.child, rec.shotsFired);
      rec.shotsFired += 1;
      rec.nextShotTime += rec.currentInterval;
      rec.currentInterval += rec.deltaInterval;
    }
  }

  /**
   * Walk the split-group list. Each not-yet-emitted group whose deadline
   * (splitEntry + shift_split_delay * groupIndex) has elapsed fires
   * primal_repeat+1 children at the same instant, spread by the shotgun
   * random draw (delta_angle applies only when emitterType is explicitly
   * 'BattleBulletEmitter'). Returns true if every group has emitted.
   */
  _drainSplitSchedule() {
    const skipEmit = this._extraParam.fragile === 1;
    for (let i = 0; i < this._splitGroups.length; i++) {
      const group = this._splitGroups[i];
      if (group.emitted) continue;
      const delay = (group.info.shift_split_delay ?? 0) * i;
      if (this.timeElapsed < this._splitEntryTime + delay) continue;
      if (!skipEmit) {
        const count = (group.barrage.primal_repeat ?? 0) + 1;
        for (let k = 0; k < count; k++) {
          this._emitChild(group.info, group.barrage, group.child, k);
        }
      }
      group.emitted = true;
    }
    return this._splitGroups.every((g) => g.emitted);
  }

  /**
   * Build one child spec from a shrapnel record (trailing or split) and push
   * it onto _pendingEmits.
   *
   * Shrapnel sub-emitters default to BattleShotgunEmitter
   * (battleshrapnelbulletfactory.lua:143), fired with angleRange =
   * child barrage.angle (line 212). The shotgun REPLACES the per-bullet angle
   * with a random draw — no index·delta_angle fan. Two cases
   * (battleshotgunemitter.lua:26):
   *   Standard:      uniform in [−angleRange/2, +angleRange/2].
   *   random_angle:  two-draw weighted variant, asymmetric range [−angleRange, 0]
   *                  (formula: (rng()−0.5)*(rng()*angleRange) − angleRange/2).
   *                  Faithfully mirrors battleshotgunemitter.lua:26; 0-reached
   *                  for shrapnel in deployed data today.
   * A record may opt back into the normal additive emitter via
   * emitterType = 'BattleBulletEmitter'.
   *
   * Base angle (mirrors bulletSplit's INHERIT_* branch):
   *   - reaim:           atan2(target − position)
   *   - inheritAngle 1:  this.yAngle — frozen firing angle (Lua INHERIT_ANGLE/GetYAngle)
   *   - inheritAngle 2:  atan2(speed) — live velocity heading (Lua NORMALIZE/GetCurrentYAngle)
   *   - else:            0
   * plus shrapnelInfo.rotateOffset in all cases.
   *
   * Position: child spawns at the parent's current position (game coords);
   * the engine's onEmit adapter converts to screen for createBullet.
   */
  _emitChild(info, barrage, child, index) {
    let baseAngleDeg;
    if (info.reaim && this._target) {
      const dx = this._target.x - this.position.x;
      const dy = this._target.y - this.position.y;
      baseAngleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
    } else if (info.inheritAngle === 2) {
      // INHERIT_SPEED_NORMALIZE: the live heading from the velocity vector
      // (mirrors GetCurrentYAngle in bulletSplit).
      baseAngleDeg = Math.atan2(this.speed.y, this.speed.x) * 180 / Math.PI;
    } else if (info.inheritAngle) {
      // INHERIT_ANGLE (1): the frozen firing angle (this.yAngle), sign-independent
      // of the velocity vector. A negative-velocity parent's speed points opposite
      // its firing angle, so atan2(speed) would flip children 180° (시나노 81788).
      baseAngleDeg = this.yAngle;
    } else {
      baseAngleDeg = 0;
    }

    // See doc-comment above for the two-branch shotgun vs. additive spread logic.
    const angleRange = barrage.angle ?? 0;
    let angle;
    if (info.emitterType === 'BattleBulletEmitter') {
      angle = baseAngleDeg
        + angleRange
        + index * (barrage.delta_angle ?? 0)
        + (info.rotateOffset ?? 0);
    } else {
      const spread = barrage.random_angle
        ? (this._random() - 0.5) * (this._random() * angleRange) - angleRange / 2
        : this._random() * angleRange - angleRange / 2;
      angle = baseAngleDeg + (info.rotateOffset ?? 0) + spread;
    }

    this._pendingEmits.push({
      startX: this.position.x,                       // game coords
      startY: this.position.y,
      // The game spawns the child at the parent's full _position, INCLUDING the
      // vertical _position.y. A gravity child uses the base `altitude <=
      // BOMB_DETONATE_HEIGHT` expiry, so it MUST inherit the parent's burst
      // altitude — spawned at 0 it would detonate on tick 1 (the Kirishima 11270
      // "fragments instantly vanish" regression). A non-gravity parent sits at
      // altitude 0, so its children inherit 0 and nothing changes.
      spawnAltitude: this.altitude,
      angle,
      bulletInfo: child,
      enemyTarget: this._target ?? null,
      inheritSpeed: info.inheritSpeed ? this.velocity : null,
      transformChain: [],
      parentBullet: null,
    });
  }

  /**
   * Mirrors BattleShrapnelBulletUnit:SetSpawnPosition (battleshrapnelbulletunit.lua:122-149).
   * Two branches:
   *
   *  - `flare` (§C8): solve convertedVelocity + verticalSpeed so the bullet
   *    lands at explodePos exactly when the first shrapnel child's
   *    hit_type.time elapses. (directHit is 0-reached after VISION exclusion.)
   *
   *  - Default (gravity bullet, no flare): apply the base game's gravity
   *    initial vertical speed `-0.5 * gravity * 60 / convertedVelocity`
   *    (battlebulletunit.lua:511-523, spec §B8). Without this the parent
   *    launches with verticalSpeed=0, immediately falls under gravity,
   *    never arcs — Kirishima skill 11270 was hitting this. The deleted legacy
   *    GravityBehavior applied the same formula.
   */
  SetSpawnPosition() {
    if (this._extraParam.flare && this._explodePos) {
      // SetSpawnPosition runs at construction — this.altitude is still the spawn altitude.
      const shrapnelArr = this._extraParam.shrapnel;
      const firstKey = shrapnelArr
        ? Object.keys(shrapnelArr).find((k) => k !== 'FXID')
        : null;
      const firstEntry = firstKey ? shrapnelArr[firstKey] : null;
      const childTpl = firstEntry
        ? this._bulletTemplates[firstEntry.bullet_ID]
        : null;
      if (childTpl) {
        const CALC_FPS = 30;
        const childGrav = Math.abs(childTpl.extra_param?.gravity ?? -0.0005);
        const childTime = childTpl.hit_type?.time ?? 0;
        const dx = this._explodePos.x - this.spawnPos.x;
        const dy = this._explodePos.y - this.spawnPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const h = 0.5 * childGrav * (childTime * CALC_FPS) ** 2 - this.altitude;
        this._convertedVelocity = Math.sqrt(
          -0.5 * this.gravity * dist * dist / h
        );
        const t = dist / this._convertedVelocity;
        this.verticalSpeed = h / t - 0.5 * this.gravity * t;
      }
      return;
    }

    // Default gravity-init for a non-flare shrapnel parent. Gates on
    // gravity != 0 and velocity > 0 to avoid div-by-zero for gravity-less
    // shrapnel (rare; would otherwise misbehave silently).
    if (this.gravity !== 0 && this.velocity > 0) {
      const convertedVelocity = this.velocity * BULLET_SPEED_CONVERT;
      this.verticalSpeed = -0.5 * this.gravity * 60 / convertedVelocity;
    }
  }

  GetCurrentState() {
    return this._currentState;
  }

  /**
   * Mirrors ChangeShrapnelState (battleshrapnelbulletunit.lua:84-96). The
   * monotonic priority guard enforces forward-only transitions; same or
   * backward calls are a no-op. Side effects: entering SPIN records
   * _spinStartTime; entering SPLIT records _splitEntryTime (Task 10);
   * entering EXPIRE flags reachDestFlag (Task 8 wiring).
   */
  ChangeShrapnelState(next) {
    if (STATE_PRIORITY[next] <= STATE_PRIORITY[this._currentState]) return;
    this._currentState = next;
    if (next === STATE.SPIN) {
      this._spinStartTime = this.timeElapsed;
    } else if (next === STATE.SPLIT) {
      this._splitEntryTime = this.timeElapsed;
    } else if (next === STATE.EXPIRE) {
      this.reachDestFlag = true;
    }
  }

  /**
   * Mirrors Update (battleshrapnelbulletunit.lua:60-82). Branches by state.
   *
   *  - NORMAL: integrate position + altitude inline (NOT via super.Update —
   *    the base's `altitude <= BOMB_DETONATE_HEIGHT` branch is wrong for
   *    shrapnel, which spawn at altitude 0 and would die on tick 1 once
   *    gravity is applied; shrapnel use range expiry instead). Range expiry
   *    OR apex sign-flip transitions to SPLIT — the legacy ShrapnelBehavior's
   *    primary trigger was range, secondary was apex; the spec's apex-only
   *    framing was incomplete.
   *
   *  - SPIN: transition to SPLIT if extra_param.lastTime is falsy (immediate)
   *    or if (timeElapsed - _spinStartTime) >= lastTime (Lua line 79).
   *
   *  - SPLIT: _drainSplitSchedule fires each group at its deadline; when all
   *    groups have emitted, immediately forwards SPLIT -> FINAL_SPLIT -> EXPIRE.
   */
  Update() {
    if (this._currentState === STATE.NORMAL) {
      const prevVerticalSpeed = this.verticalSpeed;
      // Inline the base integration order (updateSpeed → position →
      // altitude) but skip the base's range-OR-altitude expiry check.
      this.updateSpeed();
      this.position.x += this.speed.x;
      this.position.y += this.speed.y;
      this.altitude += this.verticalSpeed;

      for (const rec of this._trailing) this._drainTrailing(rec);

      const rangeExpired =
        sqrDistance(this.spawnPos, this.position) > this.sqrRange;
      const apexFlip = prevVerticalSpeed * this.verticalSpeed < 0;
      if (rangeExpired || apexFlip) {
        this.ChangeShrapnelState(STATE.SPLIT);
      }
      return;
    }

    // SPIN branch unchanged
    if (this._currentState === STATE.SPIN) {
      const lastTime = this._extraParam.lastTime;
      if (!lastTime || (this.timeElapsed - this._spinStartTime) >= lastTime) {
        this.ChangeShrapnelState(STATE.SPLIT);
      }
      return;
    }

    if (this._currentState === STATE.SPLIT) {
      const allEmitted = this._drainSplitSchedule();
      if (allEmitted) {
        // Forward-only lattice: SPLIT -> FINAL_SPLIT -> EXPIRE within one
        // Update. The Lua's emitter coordination doesn't exist here, so
        // collapsing to immediate transition is the minimal faithful
        // interpretation (design §State lattice).
        this.ChangeShrapnelState(STATE.FINAL_SPLIT);
        this.ChangeShrapnelState(STATE.EXPIRE);
      }
      return;
    }

    // FINAL_SPLIT / EXPIRE: nothing to do; reachDestFlag is set on entry
    // to EXPIRE and the world culls next.
  }

  /**
   * Returns the queued child specs and clears the queue. Called once per
   * tick by World.step() after all Updates.
   */
  drainEmits() {
    if (this._pendingEmits.length === 0) return [];
    const out = this._pendingEmits;
    this._pendingEmits = [];
    return out;
  }
}
