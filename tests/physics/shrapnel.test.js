import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ShrapnelBulletUnit,
  STATE,
  STATE_PRIORITY,
} from '../../public/js/simulators/physics/bullets/shrapnel.js';
import { TICK_SECONDS } from '../../public/js/simulators/physics/constants.js';

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

test('Update: movement runs in NORMAL — position advances', () => {
  const b = new ShrapnelBulletUnit({
    velocity: 50, yAngle: 0, range: 1000, rangeOffset: 0,
    spawnX: 0, spawnY: 0, extraParam: {},
  });
  b.FixRange();
  b.InitSpeed();
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  assert.equal(b.position.x, 10);
});

test('Update: range expiry fires in NORMAL (sets reachDestFlag)', () => {
  // range 5 -> sqrRange 25; speed 10/tick -> expires in 1 tick.
  const b = new ShrapnelBulletUnit({
    velocity: 50, yAngle: 0, range: 5, rangeOffset: 0,
    spawnX: 0, spawnY: 0, extraParam: {},
  });
  b.FixRange();
  b.InitSpeed();
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  assert.equal(b.reachDestFlag, true);
});

test('Update: movement does NOT run outside NORMAL', () => {
  const b = new ShrapnelBulletUnit({
    velocity: 50, yAngle: 0, range: 1000, rangeOffset: 0,
    spawnX: 0, spawnY: 0, extraParam: {},
  });
  b.FixRange();
  b.InitSpeed();
  b.ChangeShrapnelState(STATE.SPLIT);
  const px = b.position.x;
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  assert.equal(b.position.x, px, 'position unchanged outside NORMAL');
});

test('Update: range expiry does NOT fire outside NORMAL', () => {
  // Pre-stretch the bullet past its range, then leave NORMAL — IsOutRange
  // must be inert so the bullet survives in SPLIT until SPLIT-driven expiry.
  const b = new ShrapnelBulletUnit({
    velocity: 50, yAngle: 0, range: 5, rangeOffset: 0,
    spawnX: 0, spawnY: 0, extraParam: {},
  });
  b.FixRange();
  b.InitSpeed();
  b.position.x = 999;                                // way past range
  b.ChangeShrapnelState(STATE.SPLIT);
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  assert.equal(b.reachDestFlag, false, 'IsOutRange muted outside NORMAL');
});

test('NORMAL -> SPLIT on apex (clean sign-flip without zero crossing)', () => {
  // Launch with vs that produces an unambiguous flip: vs=0.07, gravity=-0.05
  //   tick 1 pre: 0.07, post: 0.02  -> 0.07 * 0.02 > 0, no flip
  //   tick 2 pre: 0.02, post: -0.03 -> 0.02 * -0.03 < 0, FLIP
  const b = new ShrapnelBulletUnit({
    velocity: 10, yAngle: 0, range: 10000, rangeOffset: 0, gravity: -0.05,
    spawnX: 0, spawnY: 0, extraParam: {},
  });
  b.verticalSpeed = 0.07;
  b.FixRange();
  b.InitSpeed();
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  assert.equal(b.GetCurrentState(), STATE.NORMAL);
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  assert.equal(b.GetCurrentState(), STATE.SPLIT, 'apex flip enters SPLIT');
});

test('SPIN -> SPLIT immediately when lastTime is falsy', () => {
  const b = new ShrapnelBulletUnit({
    velocity: 10, yAngle: 0, range: 10000, rangeOffset: 0,
    spawnX: 0, spawnY: 0, extraParam: { lastTime: 0 },
  });
  b.FixRange();
  b.InitSpeed();
  b.ChangeShrapnelState(STATE.SPIN);
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  assert.equal(b.GetCurrentState(), STATE.SPLIT, 'falsy lastTime -> immediate');
});

test('SPIN -> SPLIT after lastTime seconds when positive', () => {
  // lastTime = 2 ticks. SPIN enters at t=0, transition expected at t >= 2 ticks.
  const b = new ShrapnelBulletUnit({
    velocity: 10, yAngle: 0, range: 10000, rangeOffset: 0,
    spawnX: 0, spawnY: 0, extraParam: { lastTime: 2 * TICK_SECONDS },
  });
  b.FixRange();
  b.InitSpeed();
  b.ChangeShrapnelState(STATE.SPIN);                 // _spinStartTime = 0
  b.timeElapsed += TICK_SECONDS;                     // t = 1/30
  b.Update();
  assert.equal(b.GetCurrentState(), STATE.SPIN, 'still in SPIN at 1 tick');
  b.timeElapsed += TICK_SECONDS;                     // t = 2/30
  b.Update();
  assert.equal(b.GetCurrentState(), STATE.SPLIT, 'transition at lastTime');
});
