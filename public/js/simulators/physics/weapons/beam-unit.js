/**
 * physics/weapons/beam-unit.js
 * BeamUnit — one swept AoE beam, mirroring BattleBeamUnit (battlebeamunit.lua).
 * Owned and driven by LaserUnit. Clean READY -> ATTACK -> FINISH state machine.
 *
 * The Lua's lasting-cube AoE (BattleLaserUnit.createBeam -> SpawnLastingCubeArea)
 * is modeled here as plain internal `_aoe` state: position, swept angle, dims,
 * and an `active` flag that ages out over `barrage.delay` seconds. No DOM — a
 * future renderer reads the geometry getters (getPosition/getAngle/getDims).
 *
 * Damage is OUT of scope (the sim has no damage model). The damage *cadence*
 * (_nextDamageTime advancing senior_delay then delta_delay) is ported as
 * observable schedule state, NOT as damage — CanDealDamage() lets LaserUnit
 * count ticks the same way the game does.
 *
 * Coordinate note: Lua ground plane (x, z) -> physics (x, y). `offset_z` and
 * `delta_offset_z` map to the y axis.
 */
const BEAM_STATE = { READY: 'ready', ATTACK: 'attack', FINISH: 'finish' };

export class BeamUnit {
  constructor(bulletTemplate, barrageTemplate) {
    this._bulletTemp = bulletTemplate || {};
    this._beamTemp = barrageTemplate || {};
    this._state = BEAM_STATE.READY;
    this._aimAngle = 0;
    this._angle = 0;
    this._aoe = null;             // { x, y, angle, dx, dy, lifetime, elapsed, active }
    this._nextDamageTime = null;
  }

  GetBeamState() { return this._state; }
  ChangeBeamState(s) { this._state = s; }

  /** Set the IFF-resolved aim angle (degrees); added to the swept _angle. */
  SetAimAngle(deg) { this._aimAngle = deg ?? 0; }

  /**
   * Create the lasting AoE (mirrors createBeam's SpawnLastingCubeArea +
   * BattleBeamUnit.SetAoeData). Anchored at host + (offset_x, offset_z); dims
   * delta_offset_x x delta_offset_z; lifetime = barrage.delay seconds; initial
   * angle = barrage.angle + aimAngle.
   */
  CreateAoe(hostPos) {
    const b = this._beamTemp;
    this._angle = b.angle ?? 0;
    this._aoe = {
      x: hostPos.x + (b.offset_x ?? 0),
      y: hostPos.y + (b.offset_z ?? 0),
      angle: this._angle + this._aimAngle,
      dx: b.delta_offset_x ?? 0,
      dy: b.delta_offset_z ?? 0,
      lifetime: b.delay ?? 0,
      elapsed: 0,
      active: true,
    };
  }

  /** Mirrors IsBeamActive -> aoe:GetActiveFlag(). */
  IsBeamActive() { return !!this._aoe && this._aoe.active; }

  /** Age the AoE one tick; it deactivates after `lifetime` seconds. */
  AgeAoe(dt) {
    if (!this._aoe) return;
    this._aoe.elapsed += dt;
    if (this._aoe.elapsed >= this._aoe.lifetime) this._aoe.active = false;
  }

  /** Re-anchor the AoE to the host (mirrors UpdateBeamPos). */
  UpdateBeamPos(hostPos) {
    if (!this._aoe) return;
    const b = this._beamTemp;
    this._aoe.x = hostPos.x + (b.offset_x ?? 0);
    this._aoe.y = hostPos.y + (b.offset_z ?? 0);
  }

  /** Sweep one tick (mirrors UpdateBeamAngle; angleRatio = 1 in fixed-tick). */
  UpdateBeamAngle() {
    if (!this._aoe) return;
    this._angle += (this._beamTemp.delta_angle ?? 0);
    this._aoe.angle = this._angle + this._aimAngle;
  }

  /** Start the damage-tick schedule (mirrors BeginFocus). `now` = combat time. */
  BeginFocus(now) {
    this._nextDamageTime = now + (this._beamTemp.senior_delay ?? 0);
  }

  /** Advance the schedule after a tick fires (mirrors DealDamage; no damage). */
  DealDamage(now) {
    this._nextDamageTime = now + (this._beamTemp.delta_delay ?? 0);
  }

  /** Is a damage tick due? (mirrors CanDealDamage -> _nextDamageTime < now). */
  CanDealDamage(now) {
    return this._nextDamageTime != null && this._nextDamageTime < now;
  }

  /** End the beam (mirrors ClearBeam). */
  ClearBeam() {
    this._state = BEAM_STATE.FINISH;
    this._aoe = null;
    this._nextDamageTime = null;
  }

  // ---- Geometry exposure (for a future renderer; asserted by tests) ----
  getPosition() { return this._aoe ? { x: this._aoe.x, y: this._aoe.y } : null; }
  getAngle() { return this._aoe ? this._aoe.angle : null; }
  getDims() { return this._aoe ? { dx: this._aoe.dx, dy: this._aoe.dy } : null; }
}

export { BEAM_STATE };
