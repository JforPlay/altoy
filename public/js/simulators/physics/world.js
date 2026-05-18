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
   * simulation. Rejects a non-finite spawn position or heading (mirrors the
   * NaN guard in the current sim.engine.bullet.js createBullet) and returns
   * null in that case.
   */
  spawnBullet(opts) {
    if (!Number.isFinite(opts.spawnX) ||
        !Number.isFinite(opts.spawnY) ||
        !Number.isFinite(opts.yAngle)) {
      return null;
    }
    const unit = createBulletUnit(opts.type, opts);
    unit.FixRange();
    unit.InitSpeed();
    this.bullets.push(unit);
    return unit;
  }

  /** Advance the whole simulation by one fixed tick, then cull expired units. */
  step() {
    for (const bullet of this.bullets) {
      bullet.timeElapsed += TICK_SECONDS;
      bullet.Update();
    }
    this.bullets = this.bullets.filter((b) => !b.reachDestFlag);
  }
}
