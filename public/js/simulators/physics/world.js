/**
 * physics/world.js
 * World — the fixed-timestep container for the physics simulation. step()
 * advances every live unit by exactly one 1/30 game-second tick (the game's
 * fixed Update rate). The view driver calls step() from a real-time
 * accumulator; the physics itself never reads wall-clock time.
 */

import { TICK_SECONDS } from './constants.js';
import { createBulletUnit } from './bullet-registry.js';

export class World {
  constructor() {
    this.bullets = [];
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
   * Create an airdrop bomb, resolve its airdrop spawn geometry and detonation,
   * and add it to the simulation. Unlike spawnBullet, a bomb's spawn position
   * is derived from its explode point — the firing pipeline supplies a planar
   * explodePos — so this validates explodePos (and velocity) rather than
   * spawnX/spawnY. Returns null on non-finite input. Precondition: opts.type is
   * a registered bomb type (2 or 16); the sim.engine.bullet.js dispatch
   * guarantees it.
   */
  spawnBomb(opts) {
    if (!Number.isFinite(opts.explodePos?.x) ||
        !Number.isFinite(opts.explodePos?.y) ||
        !Number.isFinite(opts.velocity)) {
      return null;
    }
    const unit = createBulletUnit(opts.type, opts);
    unit.FixRange();
    unit.SetSpawnPosition();   // airdrop geometry + vertical-speed solve
    unit.InitSpeed();          // aim toward the explode point
    this.bullets.push(unit);
    return unit;
  }

  /**
   * Advance the whole simulation by one fixed tick.
   *
   * Three phases: (1) Update every bullet alive at tick start, (2) drain
   * each one's emit queue through onEmit, (3) cull expired units.
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
  }
}
