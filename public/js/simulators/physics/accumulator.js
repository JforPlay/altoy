/**
 * physics/accumulator.js
 * drainAccumulator — pure fixed-timestep accounting for the view driver.
 *
 * The game simulates at a fixed 30 fps; the browser renders at a variable
 * rate. The view driver banks elapsed real time (scaled by playback speed)
 * and, each frame, asks this helper how many whole 1/30 s ticks to run and
 * how much sub-tick time to carry forward. Clamping the tick count stops a
 * long stall (backgrounded tab, GC pause) from firing a catch-up burst.
 */

import { VIEW_FPS } from './constants.js';

/** Real milliseconds in one fixed simulation tick (1000 / 30). */
const TICK_MS = 1000 / VIEW_FPS;

/**
 * Convert a banked real-time accumulator into whole simulation ticks.
 *
 * @param {number} accumulatedMs - banked real time in milliseconds; expected
 *   non-negative.
 * @param {number} [maxTicks=4] - upper bound on ticks returned for one call;
 *   excess whole ticks are discarded (no catch-up burst after a stall).
 * @returns {{ ticks: number, remainder: number }} `ticks` to step now;
 *   `remainder` is the sub-tick time in ms (0 <= remainder < TICK_MS) to carry
 *   into the next frame.
 */
export function drainAccumulator(accumulatedMs, maxTicks = 4) {
  // Guard non-positive / non-finite input. A negative or NaN accumulator
  // would yield negative or NaN ticks and poison the carried remainder
  // permanently. The view-driver loop feeds clamped finite input, so this
  // is defensive — matching the non-finite rigour of world.js spawnBullet.
  if (!(accumulatedMs > 0)) return { ticks: 0, remainder: 0 };
  const rawTicks = Math.floor(accumulatedMs / TICK_MS);
  const ticks = Math.min(Math.max(rawTicks, 0), maxTicks);
  const remainder = accumulatedMs - rawTicks * TICK_MS;
  return { ticks, remainder };
}
