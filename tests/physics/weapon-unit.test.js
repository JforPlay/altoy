import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WeaponUnit } from '../../public/js/simulators/physics/weapons/weapon-unit.js';

test('WeaponUnit: defaults — clock 0, not finished, hostPos {0,0}', () => {
  const w = new WeaponUnit();
  assert.equal(w.timeElapsed, 0);
  assert.equal(w.finished, false);
  assert.deepEqual(w.hostPos, { x: 0, y: 0 });
});

test('WeaponUnit: constructor accepts a starting hostPos', () => {
  const w = new WeaponUnit({ hostPos: { x: 5, y: -3 } });
  assert.deepEqual(w.hostPos, { x: 5, y: -3 });
});

test('WeaponUnit: updateHostPos re-anchors; ignores non-finite input', () => {
  const w = new WeaponUnit();
  w.updateHostPos({ x: 10, y: 20 });
  assert.deepEqual(w.hostPos, { x: 10, y: 20 });
  w.updateHostPos({ x: NaN, y: 1 });           // rejected
  assert.deepEqual(w.hostPos, { x: 10, y: 20 });
  w.updateHostPos(null);                        // rejected
  assert.deepEqual(w.hostPos, { x: 10, y: 20 });
});

test('WeaponUnit: EnterCoolDown sets finished', () => {
  const w = new WeaponUnit();
  w.EnterCoolDown();
  assert.equal(w.finished, true);
});

test('WeaponUnit: DoAttack and Update are no-op hooks on the base', () => {
  const w = new WeaponUnit();
  assert.doesNotThrow(() => { w.DoAttack(); w.Update(); });
});
