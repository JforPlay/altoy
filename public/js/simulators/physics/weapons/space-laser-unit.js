/**
 * physics/weapons/space-laser-unit.js
 * SpaceLaserUnit — the space-laser weapon driver, mirroring
 * BattleSpaceLaserWeaponUnit (battlespacelaserweaponunit.lua) + the column
 * bullet it emits (battlespacelaserunit.lua / battlecolumnareabulletunit.lua).
 *
 * Two-stage emitter handoff: each shot with extra_param.aim_time spawns an
 * ALERT column (lifetime aim_time); when it expires it hands off to an ATTACK
 * column (lifetime attack_time). A shot with no aim_time spawns the ATTACK
 * column directly. The weapon cools down once no alert is pending and no attack
 * column is live (mirrors EnterCoolDown gating on the attack-bullet life count).
 *
 * EquipmentType 28 (SPACE_LASER). HARNESS-ONLY + purely structural: 0 reached
 * type-28 weapons and 0 reached type-14 bullets. Acceptance is node:test only.
 *
 * Simplification: all `beamCount` shots are emitted at DoAttack; the per-shot
 * emitter scheduling/intervals from CreateEmitter are deferred (nothing reaches
 * them). SingleFire is unsupported, matching the Lua assert(false).
 *
 * Cylinder geometry: Lua BattleColumnCldComponent.New(cld_box[1], cld_box[3]) is
 * 1-indexed -> JS radius = cld_box[0], thickness = cld_box[2]. (The legacy code
 * used the wrong indices; this fixes it.)
 */
import { WeaponUnit } from './weapon-unit.js';
import { TICK_SECONDS } from '../constants.js';

const COLUMN_STAGE = { ALERT: 'alert', ATTACK: 'attack' };

export class SpaceLaserUnit extends WeaponUnit {
  constructor(opts = {}) {
    super(opts);
    this._bulletTemp = opts.bulletTemplate || {};
    this._beamCount = opts.beamCount ?? 1;
    this._columns = [];           // { stage, lifetime, elapsed }
    this._pendingAttacks = 0;     // ALERT columns awaiting handoff
    this._liveAttacks = 0;        // ATTACK columns not yet expired
    this._started = false;
  }

  _cylinder() {
    const c = this._bulletTemp.cld_box || [];
    return { radius: c[0] ?? 0, thickness: c[2] ?? 0 };
  }

  _makeAlert() {
    const ep = this._bulletTemp.extra_param || {};
    this._pendingAttacks++;
    return { stage: COLUMN_STAGE.ALERT, lifetime: ep.aim_time ?? 0, elapsed: 0 };
  }

  _makeAttack() {
    const ep = this._bulletTemp.extra_param || {};
    this._liveAttacks++;
    return { stage: COLUMN_STAGE.ATTACK, lifetime: ep.attack_time ?? 0, elapsed: 0 };
  }

  /** Mirrors the emitter spawn-callback: alert-or-attack per shot. */
  DoAttack() {
    this._started = true;
    const hasAim = !!(this._bulletTemp.extra_param || {}).aim_time;   // present & non-zero
    for (let i = 0; i < this._beamCount; i++) {
      this._columns.push(hasAim ? this._makeAlert() : this._makeAttack());
    }
    if (this._columns.length === 0) this.EnterCoolDown();
  }

  /** Age every column; ALERT expiry hands off to ATTACK; cooldown when empty. */
  Update() {
    if (!this._started) return;
    const survivors = [];
    const spawned = [];
    for (const col of this._columns) {
      col.elapsed += TICK_SECONDS;
      if (col.elapsed < col.lifetime) {
        survivors.push(col);
      } else if (col.stage === COLUMN_STAGE.ALERT) {
        this._pendingAttacks--;
        spawned.push(this._makeAttack());        // alert -> attack handoff
      } else {
        this._liveAttacks--;                     // attack column ended
      }
    }
    this._columns = survivors.concat(spawned);
    if (this._pendingAttacks === 0 && this._liveAttacks === 0) this.EnterCoolDown();
  }

  /** Geometry exposure: each column's stage, shared cylinder, and time left. */
  getColumns() {
    const cyl = this._cylinder();
    return this._columns.map((c) => ({
      stage: c.stage,
      cylinder: cyl,
      position: { x: this.hostPos.x, y: this.hostPos.y },
      remaining: Math.max(0, c.lifetime - c.elapsed),
    }));
  }

  /** Mirrors SingleFire -> assert(false). */
  SingleFire() {
    throw new Error('SingleFire is not supported for SpaceLaserUnit');
  }
}
