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
    this._currentState = STATE.NORMAL;
    this._spinStartTime = -1;
    this._pendingEmits = [];

    // Emission state is initialised by _setupEmissions() — implemented in
    // Task 9 (trailing) and Task 10 (split). For Task 7 these fields are
    // declared so the rest of the class can refer to them safely.
    this._trailing = [];
    this._splitGroups = [];
    this._splitEntryTime = -1;
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
    }
    // SPLIT side effect: handled in Task 10.
    // EXPIRE side effect: handled in Task 8.
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
