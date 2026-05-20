import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAccTable } from '../../public/js/simulators/physics/acc-table.js';

test('a null/undefined acceleration yields an empty table', () => {
  const t = parseAccTable(undefined);
  assert.deepEqual(t.accels, []);
  assert.equal(t.tracker, null);
  assert.equal(t.circle, null);
  assert.equal(t.orbit, null);
});

test('an array of records becomes the accels list, sorted by t', () => {
  const t = parseAccTable([
    { t: 1, u: 3, v: 4 },
    { t: 0, u: 1, v: 2 },
  ]);
  assert.deepEqual(t.accels, [
    { t: 0, u: 1, v: 2 },
    { t: 1, u: 3, v: 4 },
  ]);
  assert.equal(t.tracker, null);
});

test('an object with a tracker key becomes table.tracker, accels empty', () => {
  const t = parseAccTable({ tracker: { angular: 3, range: 50 } });
  assert.deepEqual(t.tracker, { angular: 3, range: 50 });
  assert.deepEqual(t.accels, []);
});

test('numeric-keyed records plus a tracker key are both captured', () => {
  // The game _accTable serialised: an array part (numeric keys) + a named key.
  const t = parseAccTable({
    1: { t: 0, u: 1, v: 0 },
    2: { t: 0.5, u: 2, v: 0 },
    tracker: { angular: 3, range: 50 },
  });
  assert.equal(t.accels.length, 2);
  assert.ok(t.tracker, 'tracker captured alongside the accel records');
});

test('an object with a circle key becomes table.circle', () => {
  const t = parseAccTable({ circle: { centripetalSpeed: -1, antiClockWise: true } });
  assert.deepEqual(t.circle, { centripetalSpeed: -1, antiClockWise: true });
});

test('flip negates v when the barrage angle is in (0, 180)', () => {
  const t = parseAccTable([{ t: 0, u: 0, v: 5, flip: true }], 90);
  assert.equal(t.accels[0].v, -5);
});

test('flip leaves v alone when the barrage angle is outside (0, 180)', () => {
  assert.equal(parseAccTable([{ t: 0, u: 0, v: 5, flip: true }], 270).accels[0].v, 5);
  assert.equal(parseAccTable([{ t: 0, u: 0, v: 5, flip: true }], 0).accels[0].v, 5);
  assert.equal(parseAccTable([{ t: 0, u: 0, v: 5, flip: true }], null).accels[0].v, 5);
});

test('flip does nothing for a record without the flag', () => {
  assert.equal(parseAccTable([{ t: 0, u: 0, v: 5 }], 90).accels[0].v, 5);
});

test('parsed records are fresh objects — mutating them never touches the input', () => {
  const input = [{ t: 0, u: 1, v: 0 }];
  const t = parseAccTable(input);
  t.accels[0].u = 99;
  assert.equal(input[0].u, 1, 'the input record is untouched');
});

test('records with zero-valued fields are preserved and sort by t correctly', () => {
  // A real first event is often `{t: 0, u: 0, v: <something>}`. This pins that
  // the t:0 record is not silently dropped and sorts before later records.
  const t = parseAccTable([{ t: 0, u: 0, v: 3 }, { t: 0.5, u: 0, v: -3 }]);
  assert.equal(t.accels.length, 2);
  assert.equal(t.accels[0].t, 0);
  assert.equal(t.accels[0].u, 0);
  assert.equal(t.accels[0].v, 3);
  assert.equal(t.accels[1].t, 0.5);
});
