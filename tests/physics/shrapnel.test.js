import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ShrapnelBulletUnit,
  STATE,
  STATE_PRIORITY,
} from '../../public/js/simulators/physics/bullets/shrapnel.js';

test('ShrapnelBulletUnit: starts in NORMAL', () => {
  const b = new ShrapnelBulletUnit({
    velocity: 50, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0, extraParam: {},
  });
  assert.equal(b.GetCurrentState(), STATE.NORMAL);
});

test('STATE_PRIORITY: monotonic ordering', () => {
  assert.ok(STATE_PRIORITY[STATE.NORMAL] < STATE_PRIORITY[STATE.SPIN]);
  assert.ok(STATE_PRIORITY[STATE.SPIN] < STATE_PRIORITY[STATE.SPLIT]);
  assert.ok(STATE_PRIORITY[STATE.SPLIT] < STATE_PRIORITY[STATE.FINAL_SPLIT]);
  assert.ok(STATE_PRIORITY[STATE.FINAL_SPLIT] < STATE_PRIORITY[STATE.EXPIRE]);
});

test('ChangeShrapnelState: forward transitions succeed', () => {
  const b = new ShrapnelBulletUnit({
    velocity: 50, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0, extraParam: {},
  });
  b.ChangeShrapnelState(STATE.SPLIT);
  assert.equal(b.GetCurrentState(), STATE.SPLIT);
});

test('ChangeShrapnelState: backward transition is a no-op (monotonic guard)', () => {
  const b = new ShrapnelBulletUnit({
    velocity: 50, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0, extraParam: {},
  });
  b.ChangeShrapnelState(STATE.SPLIT);
  b.ChangeShrapnelState(STATE.NORMAL);              // backward
  assert.equal(b.GetCurrentState(), STATE.SPLIT, 'state stays at SPLIT');
});

test('ChangeShrapnelState: same-state transition is a no-op', () => {
  const b = new ShrapnelBulletUnit({
    velocity: 50, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0, extraParam: {},
  });
  b.ChangeShrapnelState(STATE.SPIN);
  const spinStart = b._spinStartTime;
  b.ChangeShrapnelState(STATE.SPIN);                // same
  assert.equal(b._spinStartTime, spinStart, '_spinStartTime not reset');
});

test('ChangeShrapnelState: entering SPIN records timeElapsed as spinStartTime', () => {
  const b = new ShrapnelBulletUnit({
    velocity: 50, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0, extraParam: {},
  });
  b.timeElapsed = 1.5;
  b.ChangeShrapnelState(STATE.SPIN);
  assert.equal(b._spinStartTime, 1.5);
});
