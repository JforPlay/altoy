/**
 * physics/world.js
 * World — the fixed-timestep container for the physics simulation. step()
 * advances every live unit by exactly one 1/30 game-second tick (the game's
 * fixed Update rate). The view driver calls step() from a real-time
 * accumulator; the physics itself never reads wall-clock time.
 */

import { TICK_SECONDS } from './constants.js';
import { createBulletUnit } from './bullet-registry.js';
import { createWeaponUnit } from './weapons/weapon-registry.js';

export class World {
  constructor() {
    this.bullets = [];
    this.weapons = [];
    /**
     * Optional emit callback. A unit that produces children mid-tick (e.g.
     * ShrapnelBulletUnit on SPLIT) pushes child specs onto its own
     * _pendingEmits queue and returns them from drainEmits(); step() routes
     * each through onEmit so the view driver can run them through its
     * existing createBullet dispatch. Null = no children supported.
     */
    this.onEmit = null;
  }

  /**
   * Create a bullet, resolve its range and initial speed, and add it to the
   * simulation. Rejects a non-finite spawn position, heading or velocity — a
   * NaN velocity yields a bullet whose squared-distance range check never
   * trips, so it would leak — and returns null in that case.
   *
   * Curving bullets need no extra spawn path: `opts.acceleration` (plus
   * `barrageAngle` and `target`) flows straight through to the BulletUnit
   * constructor, and InitSpeed picks doAccelerate / doTrack / doCircle.
   */
  spawnBullet(opts) {
    if (!Number.isFinite(opts.spawnX) ||
        !Number.isFinite(opts.spawnY) ||
        !Number.isFinite(opts.yAngle) ||
        !Number.isFinite(opts.velocity)) {
      return null;
    }
    const unit = createBulletUnit(opts.type, opts);
    unit.FixRange();
    if (typeof unit.SetSpawnPosition === 'function') {
      unit.SetSpawnPosition();
    }
    unit.InitSpeed();
    this.bullets.push(unit);
    return unit;
  }

  /**
   * Create a bomb and add it to the simulation. Two modes:
   *
   * Airdrop (default): position derived from explodePos by BombBulletUnit's
   * SetSpawnPosition; validates explodePos and velocity.
   *
   * Non-airdrop (opts.airdrop === false): position from spawnX/spawnY like
   * spawnBullet; validates spawnX/spawnY/yAngle/velocity. explodePos may be
   * null (bomb falls along yAngle). Returns null on non-finite input.
   *
   * Precondition: opts.type is a registered bomb type (2 or 16); the
   * sim.engine.bullet.js dispatch guarantees it.
   */
  spawnBomb(opts) {
    if (opts.airdrop === false) {
      if (!Number.isFinite(opts.spawnX) ||
          !Number.isFinite(opts.spawnY) ||
          !Number.isFinite(opts.yAngle) ||
          !Number.isFinite(opts.velocity)) {
        return null;
      }
    } else {
      if (!Number.isFinite(opts.explodePos?.x) ||
          !Number.isFinite(opts.explodePos?.y) ||
          !Number.isFinite(opts.velocity)) {
        return null;
      }
    }
    const unit = createBulletUnit(opts.type, opts);
    unit.FixRange();
    unit.SetSpawnPosition();   // mode-branched inside BombBulletUnit
    unit.InitSpeed();          // priority chain via base
    this.bullets.push(unit);
    return unit;
  }

  /**
   * Create a long-lived weapon driver (beam type 24 / space-laser type 28),
   * begin its attack, and add it to the simulation. Mirrors spawnBullet's
   * validate-then-init shape. Returns null on a non-finite host position or an
   * unresolved weapon type.
   *
   * Unlike a bullet, a weapon unit re-anchors to a live host each tick: the
   * driver writes unit.hostPos (via updateHostPos) before each step().
   */
  spawnWeapon(opts) {
    if (!Number.isFinite(opts.hostPos?.x) || !Number.isFinite(opts.hostPos?.y)) {
      return null;
    }
    const unit = createWeaponUnit(opts.type, opts);
    if (!unit) return null;
    unit.DoAttack();
    this.weapons.push(unit);
    return unit;
  }

  /**
   * Advance the whole simulation by one fixed tick.
   *
   * Bullets advance in three phases: (1) Update every bullet alive at tick
   * start, (2) drain each one's emit queue through onEmit, (3) cull expired
   * units. Weapons then take an independent update + cull pass (no emit queue).
   *
   * Length-cached iteration is the mid-tick spawn invariant: a child
   * spawned via onEmit appends to `bullets` past index `n` and Updates on
   * the NEXT step(), not this one. This matches the Lua's loop semantics —
   * `for ... in pairs(BulletList)` does not see newly-inserted entries on
   * the current iteration — and it makes split timing deterministic.
   */
  step() {
    const n = this.bullets.length;
    for (let i = 0; i < n; i++) {
      this.bullets[i].timeElapsed += TICK_SECONDS;
      this.bullets[i].Update();
    }
    if (this.onEmit) {
      for (let i = 0; i < n; i++) {
        const b = this.bullets[i];
        if (b.drainEmits) {
          const emits = b.drainEmits();
          for (const spec of emits) this.onEmit(spec);
        }
      }
    }
    this.bullets = this.bullets.filter((b) => !b.reachDestFlag);

    // Weapons run their own update + cull, independent of bullets. Length-cached
    // like the bullet loop (a unit added mid-tick Updates on the next step()).
    const wn = this.weapons.length;
    for (let i = 0; i < wn; i++) {
      this.weapons[i].timeElapsed += TICK_SECONDS;
      this.weapons[i].Update();
    }
    this.weapons = this.weapons.filter((w) => !w.finished);
  }
}
