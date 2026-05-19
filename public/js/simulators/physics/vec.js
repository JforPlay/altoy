/**
 * physics/vec.js
 * Minimal planar (2D) vector helpers on plain {x, y} objects. Pure — never
 * mutates an input. The game works in Vector3 with the Y component filtered
 * out for movement/range maths; the simulator's horizontal plane is {x, y}.
 */

/** Component-wise a - b. */
export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** Euclidean length. */
export function magnitude(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/** Squared straight-line distance — mirrors the game's Vector3.SqrDistance. */
export function sqrDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
