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
  }

  /**
   * Create a bullet, resolve its range and initial speed, and add it to the
   * simulation. Rejects a non-finite spawn position, heading or velocity — a
   * NaN velocity yields a bullet whose squared-distance range check never
   * trips, so it would leak — and returns null in that case.
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
    unit.InitSpeed();
    this.bullets.push(unit);
    return unit;
  }

  /**
   * Advance the whole simulation by one fixed tick, then cull expired units.
   *
   * Invariant: no unit is spawned mid-tick — every bullet present at the start
   * of step() is stepped exactly once. Phase 3 (shrapnel split, transform)
   * introduces mid-tick spawning; when it does, decide explicitly whether a
   * freshly-spawned unit steps in the same tick or the next.
   */
  step() {
    for (const bullet of this.bullets) {
      bullet.timeElapsed += TICK_SECONDS;
      bullet.Update();
    }
    this.bullets = this.bullets.filter((b) => !b.reachDestFlag);
  }
}
