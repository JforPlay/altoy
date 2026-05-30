import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BeamUnit, BEAM_STATE } from '../../public/js/simulators/physics/weapons/beam-unit.js';

// A barrage with a sweep, an offset, and a short AoE lifetime.
const BARRAGE = {
  angle: 10, delta_angle: 2,
  offset_x: 3, offset_z: -4,
  delta_offset_x: 8, delta_offset_z: 6,
  delay: 0.1, senior_delay: 0.05, delta_delay: 0.02,
};
const BULLET = { modle_ID: 'beam_fx', extra_param: {} };

test('BeamUnit: starts READY with no AoE', () => {
  const b = new BeamUnit(BULLET, BARRAGE);
  assert.equal(b.GetBeamState(), BEAM_STATE.READY);
  assert.equal(b.IsBeamActive(), false);
  assert.equal(b.getPosition(), null);
});

test('BeamUnit: CreateAoe anchors at host+offset, dims from delta_offset, angle = barrage.angle + aim', () => {
  const b = new BeamUnit(BULLET, BARRAGE);
  b.SetAimAngle(90);
  b.CreateAoe({ x: 100, y: 200 });
  assert.deepEqual(b.getPosition(), { x: 103, y: 196 }); // 100+3, 200+(-4)
  assert.deepEqual(b.getDims(), { dx: 8, dy: 6 });       // delta_offset_x, delta_offset_z
  assert.equal(b.getAngle(), 100);                       // angle 10 + aim 90
  assert.equal(b.IsBeamActive(), true);
});

test('BeamUnit: UpdateBeamAngle sweeps += delta_angle each call (angleRatio = 1)', () => {
  const b = new BeamUnit(BULLET, BARRAGE);
  b.SetAimAngle(0);
  b.CreateAoe({ x: 0, y: 0 });
  assert.equal(b.getAngle(), 10);
  b.UpdateBeamAngle();
  assert.equal(b.getAngle(), 12);
  b.UpdateBeamAngle();
  assert.equal(b.getAngle(), 14);
});

test('BeamUnit: UpdateBeamPos re-anchors to a moved host', () => {
  const b = new BeamUnit(BULLET, BARRAGE);
  b.CreateAoe({ x: 0, y: 0 });
  b.UpdateBeamPos({ x: 50, y: 60 });
  assert.deepEqual(b.getPosition(), { x: 53, y: 56 });   // 50+3, 60+(-4)
});

test('BeamUnit: AgeAoe deactivates after `delay` seconds', () => {
  const b = new BeamUnit(BULLET, BARRAGE);
  b.CreateAoe({ x: 0, y: 0 });
  b.AgeAoe(0.05); assert.equal(b.IsBeamActive(), true);
  b.AgeAoe(0.04); assert.equal(b.IsBeamActive(), true);  // 0.09 < 0.1
  b.AgeAoe(0.02); assert.equal(b.IsBeamActive(), false); // 0.11 >= 0.1
});

test('BeamUnit: damage cadence — senior_delay then delta_delay (schedule only, no damage)', () => {
  const b = new BeamUnit(BULLET, BARRAGE);
  b.CreateAoe({ x: 0, y: 0 });
  b.BeginFocus(1.0);                       // nextDamageTime = 1.05
  assert.equal(b.CanDealDamage(1.04), false);
  assert.equal(b.CanDealDamage(1.06), true);
  b.DealDamage(1.06);                      // nextDamageTime = 1.08
  assert.equal(b.CanDealDamage(1.07), false);
  assert.equal(b.CanDealDamage(1.09), true);
});

test('BeamUnit: ClearBeam -> FINISH, AoE dropped', () => {
  const b = new BeamUnit(BULLET, BARRAGE);
  b.CreateAoe({ x: 0, y: 0 });
  b.ClearBeam();
  assert.equal(b.GetBeamState(), BEAM_STATE.FINISH);
  assert.equal(b.IsBeamActive(), false);
  assert.equal(b.getPosition(), null);
});
