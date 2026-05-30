/**
 * physics/weapons/laser-unit.js
 * LaserUnit — the beam weapon driver, mirroring BattleLaserUnit
 * (battlelaserunit.lua). Owns one BeamUnit per bullet_ID/barrage_ID pair,
 * staggers each beam's start by its barrage.first_delay, sweeps + re-anchors
 * the active beams every tick, and enters cooldown once every beam has
 * FINISHed.
 *
 * EquipmentType 24 (BEAM). HARNESS-ONLY: built + node:test-verified, routed
 * additively (it never replaces the host weapon's normal barrage payload — see
 * sim.weapon.controller.js). DOM rendering deferred; no damage model (the beam
 * damage cadence is ported as schedule state only — see BeamUnit).
 */
import { WeaponUnit } from './weapon-unit.js';
import { BeamUnit, BEAM_STATE } from './beam-unit.js';
import { TICK_SECONDS } from '../constants.js';

export class LaserUnit extends WeaponUnit {
  constructor(opts = {}) {
    super(opts);
    const w = opts.weaponTemplate || {};
    const barrages = opts.barrageTemplates || {};
    const bullets = opts.bulletTemplates || {};
    this._aimPos = opts.aimPos ?? null;
    this._foe = !!opts.foe;

    const bulletIds = w.bullet_ID || [];
    const barrageIds = w.barrage_ID || [];
    this._beamList = bulletIds.map((bid, i) =>
      new BeamUnit(bullets[bid], barrages[barrageIds[i]]));
    this._attackStartTime = null;
  }

  /** Mirrors DoAttack: stage all beams; create first_delay==0 beams now. */
  DoAttack() {
    this._attackStartTime = this.timeElapsed;        // 0 at spawn
    for (const beam of this._beamList) {
      beam.ChangeBeamState(BEAM_STATE.READY);
      if ((beam._beamTemp.first_delay ?? 0) === 0) this._createBeam(beam);
    }
  }

  /** Mirrors updateBeamList, run once per tick while attacking. */
  Update() {
    if (this._attackStartTime == null) return;
    const now = this.timeElapsed;
    const elapsed = now - this._attackStartTime;
    let finishedCount = 0;
    for (const beam of this._beamList) {
      const st = beam.GetBeamState();
      if (st === BEAM_STATE.READY) {
        if ((beam._beamTemp.first_delay ?? 0) < elapsed) this._createBeam(beam);
      } else if (st === BEAM_STATE.ATTACK) {
        beam.AgeAoe(TICK_SECONDS);
        if (!beam.IsBeamActive()) {
          beam.ClearBeam();
          finishedCount++;
        } else {
          beam.UpdateBeamPos(this.hostPos);
          beam.UpdateBeamAngle();
          if (beam.CanDealDamage(now)) beam.DealDamage(now);   // cadence only
        }
      } else if (st === BEAM_STATE.FINISH) {
        finishedCount++;
      }
    }
    if (finishedCount === this._beamList.length) this.EnterCoolDown();
  }

  /** Mirrors EnterCoolDown: clear the attack window, then base finishes. */
  EnterCoolDown() {
    this._attackStartTime = null;
    super.EnterCoolDown();
  }

  /** Mirrors createBeam: IFF aim angle -> AoE -> BeginFocus -> ATTACK. */
  _createBeam(beam) {
    let aimAngle = 0;
    if (this._aimPos) {
      const h = this.hostPos, a = this._aimPos;
      aimAngle = this._foe
        ? Math.atan2(h.y - a.y, h.x - a.x) * (180 / Math.PI)   // FOE_CODE
        : Math.atan2(a.y - h.y, a.x - h.x) * (180 / Math.PI);  // FRIENDLY_CODE
    }
    beam.SetAimAngle(aimAngle);
    beam.CreateAoe(this.hostPos);
    beam.BeginFocus(this.timeElapsed);
    beam.ChangeBeamState(BEAM_STATE.ATTACK);
  }

  /** Geometry exposure: live (ATTACK) beams. */
  getBeams() {
    return this._beamList
      .filter((b) => b.GetBeamState() === BEAM_STATE.ATTACK)
      .map((b) => ({ position: b.getPosition(), angle: b.getAngle(), dims: b.getDims() }));
  }
}
