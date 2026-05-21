/**
 * physics/bullets/scale.js
 * ScaleBulletUnit — bullet type 15. Mirrors BattleScaleBulletUnit
 * (battlescalebulletunit.lua). A bullet whose collision box grows linearly
 * until it reaches cldMax, then settles into normal flight at the base
 * velocity (the grow-phase speed magnitude is scaleSpeed * 0.5, NOT the
 * base velocity).
 *
 * HARNESS-ONLY: this class is NOT registered in bullet-registry.js and is
 * NOT routed by sim.engine.bullet.js. 0 reached against current data; built
 * for fidelity and node:test verification.
 *
 * Spec §D4: cldMax is a SCALAR in data — the legacy ScaleBehavior reads
 * cldMax[0]/cldMax[1] and breaks all 91 type-15 bullets. The constructor's
 * read is the regression guard.
 */

import { BulletUnit } from '../bullet-unit.js';

export class ScaleBulletUnit extends BulletUnit {
  constructor(opts = {}) {
    super(opts);
    const ep = opts.extraParam || {};
    this._scaleSpeed = ep.scaleSpeed ?? 0;
    this._scaleLimit = ep.cldMax ?? 0;        // scalar — see spec §D4
    this._scaleX     = 0;
    this._settled    = false;
    // cld_box: [width, height, depth]; index 1 is height. The grow-check
    // uses cld_box[1] (battlescalebulletunit.lua:19).
    this._cldBox     = opts.cldBox || [0, 0, 0];
    this.currentBoxWidth = this._cldBox[1] + this._scaleX;
  }

  /**
   * Mirrors InitSpeed (battlescalebulletunit.lua:35-37): the base picks
   * updateSpeed via the priority chain, then calcScaleSpeed overrides the
   * speed magnitude to the grow-phase value (scaleSpeed * 0.5 along yAngle).
   */
  InitSpeed() {
    super.InitSpeed();
    this._calcScaleSpeed();
  }

  /** Mirrors calcScaleSpeed (battlescalebulletunit.lua:40-44). */
  _calcScaleSpeed() {
    const rad = this.yAngle * (Math.PI / 180);
    const mag = this._scaleSpeed * 0.5;
    this.speed = { x: mag * Math.cos(rad), y: mag * Math.sin(rad) };
  }

  /**
   * Mirrors Update (battlescalebulletunit.lua:18-26): grow -> settle
   * transition. The Lua calls calcSpeed every settled tick, but yAngle is
   * immutable so the resulting speed is identical — once at the transition
   * is equivalent.
   */
  Update() {
    // Lua-faithful strict `<` (battlescalebulletunit.lua:19) — the box stops
    // growing only when current_box STRICTLY exceeds scaleLimit; equality
    // still grows. Don't relax to `>=`: that would move the settle by one
    // tick and break parity with the game.
    if (this._scaleLimit < this._scaleX + this._cldBox[1]) {
      if (!this._settled) {
        this.calcSpeed();
        this._settled = true;
      }
    } else {
      this._updateCldBox();
    }
    super.Update();
  }

  /** Mirrors UpdateCLDBox (battlescalebulletunit.lua:46-51): additive growth. */
  _updateCldBox() {
    this._scaleX += this._scaleSpeed;
    this.currentBoxWidth = this._cldBox[1] + this._scaleX;
  }
}
