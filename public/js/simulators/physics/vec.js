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

/** Unit vector in the direction of `v`; a zero vector returns zero. */
export function normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

/** Dot product. */
export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

/** Component-wise a + b. */
export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** Scalar multiple of `v`. */
export function scale(v, k) {
  return { x: v.x * k, y: v.y * k };
}

/**
 * Rotate `v` by the angle whose cosine and sine are given. This is the game's
 * RotateY (battlebulletunit.lua:93-98) projected onto the core's {x, y} plane
 * — the game's z axis is the core's y:
 *   RotateY(v, a) = (v.x*cos + v.z*sin, v.y, v.z*cos - v.x*sin)
 * Taking cos/sin directly (not an angle) lets doTrack rotate by the angle it
 * only knows as a dot/cross pair.
 */
export function rotate(v, cos, sin) {
  return {
    x: v.x * cos + v.y * sin,
    y: v.y * cos - v.x * sin,
  };
}
