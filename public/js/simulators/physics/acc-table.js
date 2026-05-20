/**
 * physics/acc-table.js
 * parseAccTable — normalise a bullet template's `acceleration` field into the
 * game's _accTable shape: an ordered list of {t,u,v} acceleration records plus
 * the optional named tracker / circle / orbit entries.
 *
 * The data carries two shapes (verified against bullet_template.json):
 *   - Array:  [{flip,t,u,v}, ...]                  — pure acceleration records
 *   - Object: {tracker:{...}} / {circle:{...}}, optionally with numeric keys
 *             {1:{t,u,v}, 2:{...}, tracker:{...}}   — accel records + a named kind
 * Both are the JSON serialisation of the Lua's mixed table — an array part for
 * the doAccelerate records, named keys for tracker / circle / orbit.
 *
 * The per-record `flip` flag mirrors a symmetric barrage: when set and the
 * barrage angle is in (0, 180), v is negated — faithful to the legacy
 * AccelerationBehavior (spec §E8, verified correct), so a migrated accelerating
 * bullet matches the legacy one.
 *
 * Records are returned as fresh {t,u,v} objects: doAccelerate's
 * reverseAcceleration flips their u signs in place, and the core never mutates
 * an input.
 */

/** True when a `flip` record should have its v negated for this barrage angle. */
function shouldFlipV(barrageAngle) {
  if (barrageAngle == null) return false;
  const normalized = ((barrageAngle % 360) + 360) % 360;
  return normalized > 0 && normalized < 180;
}

/**
 * @param {Array|Object|null} acceleration - the bullet template's raw field.
 * @param {number|null} [barrageAngle] - barrage angle in degrees, for `flip`.
 * @returns {{accels: Array<{t,u,v}>, tracker: ?Object, circle: ?Object, orbit: ?Object}}
 */
export function parseAccTable(acceleration, barrageAngle = null) {
  const table = { accels: [], tracker: null, circle: null, orbit: null };
  if (!acceleration || typeof acceleration !== 'object') return table;

  const rawRecords = [];
  if (Array.isArray(acceleration)) {
    for (const entry of acceleration) {
      if (!entry) continue;
      if (entry.tracker != null) table.tracker = entry.tracker;
      else if (entry.circle != null) table.circle = entry.circle;
      else if (entry.orbit != null) table.orbit = entry.orbit;
      else rawRecords.push(entry);
    }
  } else {
    for (const key of Object.keys(acceleration)) {
      const value = acceleration[key];
      if (key === 'tracker') table.tracker = value;
      else if (key === 'circle') table.circle = value;
      else if (key === 'orbit') table.orbit = value;
      else if (value) rawRecords.push(value);   // numeric-keyed accel record
    }
  }

  const flipV = shouldFlipV(barrageAngle);
  for (const r of rawRecords) {
    const v = r.v ?? 0;
    table.accels.push({
      t: r.t ?? 0,
      u: r.u ?? 0,
      v: (r.flip && flipV) ? -v : v,
    });
  }
  table.accels.sort((a, b) => a.t - b.t);
  return table;
}
