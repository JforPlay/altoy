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

test('Update: range expiry in NORMAL transitions to SPLIT; empty groups -> EXPIRE next tick', () => {
  // range 5 -> sqrRange 25; speed 10/tick -> range exceeded in 1 tick.
  // Range expiry is the legacy ShrapnelBehavior's primary split trigger
  // (apex is secondary, for gravity-bullets with vertical motion). With
  // empty extraParam.shrapnel, SPLIT vacuously forwards to EXPIRE on the
  // next tick.
  const b = new ShrapnelBulletUnit({
    velocity: 50, yAngle: 0, range: 5, rangeOffset: 0,
    spawnX: 0, spawnY: 0, extraParam: {},
  });
  b.FixRange();
  b.InitSpeed();
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  assert.equal(b.GetCurrentState(), STATE.SPLIT, 'range expiry triggers SPLIT');
  assert.equal(b.reachDestFlag, false, 'lattice not yet at EXPIRE');
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  assert.equal(b.GetCurrentState(), STATE.EXPIRE);
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
  // With zero split groups, SPLIT auto-forwards to EXPIRE (vacuously all
  // groups emitted). reachDestFlag is set by the SPLIT->EXPIRE path, not
  // by IsOutRange — the range check is still muted outside NORMAL.
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
  // SPLIT with no groups -> immediate EXPIRE via split completion, not IsOutRange.
  assert.equal(b.GetCurrentState(), STATE.EXPIRE, 'SPLIT auto-expires when no groups');
  assert.equal(b.reachDestFlag, true, 'reachDestFlag set by SPLIT->EXPIRE, not IsOutRange');
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

test('Trailing: a record with initialSplit=true emits during NORMAL', () => {
  // Two-shot trailing record: shots at t = first_delay and t = first_delay + delay.
  const child = { type: 1, velocity: 10, range: 50 };
  const barrage = {
    barrage_ID: 1, primal_repeat: 1, first_delay: 0, delay: TICK_SECONDS, delta_delay: 0,
    angle: 0, delta_angle: 0,
  };
  const extraParam = {
    shrapnel: [
      { initialSplit: true, barrage_ID: 1, bullet_ID: 'B', inheritAngle: false, reaim: false },
    ],
  };
  const b = new ShrapnelBulletUnit({
    velocity: 10, yAngle: 0, range: 10000, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    extraParam,
    bulletTemplates: { B: child },
    barrages: { 1: barrage },
  });
  b.FixRange();
  b.InitSpeed();

  // Tick 1: t = 1/30 >= first_delay 0 -> emit child #0
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  let emits = b.drainEmits();
  assert.equal(emits.length, 1, 'first shot fired');
  assert.equal(emits[0].bulletInfo, child);
  // Tick 2: t = 2/30. next shot was scheduled at first_delay + delay = 1/30. Emit #1.
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  emits = b.drainEmits();
  assert.equal(emits.length, 1, 'second shot fired');
  // Tick 3: no more shots queued (totalShots = primal_repeat+1 = 2 fired).
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  emits = b.drainEmits();
  assert.equal(emits.length, 0);
});

test('Trailing: delta_delay grows the interval each shot', () => {
  const child = { type: 1, velocity: 10, range: 50 };
  const barrage = {
    barrage_ID: 1, primal_repeat: 2,         // -> 3 shots
    first_delay: 0,
    delay: TICK_SECONDS,                     // initial interval
    delta_delay: TICK_SECONDS,               // each subsequent interval grows by 1 tick
    angle: 0, delta_angle: 0,
  };
  const extraParam = {
    shrapnel: [
      { initialSplit: true, barrage_ID: 1, bullet_ID: 'B' },
    ],
  };
  const b = new ShrapnelBulletUnit({
    velocity: 10, yAngle: 0, range: 10000, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    extraParam,
    bulletTemplates: { B: child },
    barrages: { 1: barrage },
  });
  b.FixRange();
  b.InitSpeed();

  const shotTicks = [];
  for (let tick = 1; tick <= 10; tick++) {
    b.timeElapsed += TICK_SECONDS;
    b.Update();
    const emits = b.drainEmits();
    if (emits.length > 0) shotTicks.push(tick);
  }
  // Shot 0 at first_delay (0)        -> tick 1
  // Shot 1 at 0 + delay (1)          -> tick 2
  // Shot 2 at 0 + delay + (delay+delta) (1 + 2) -> tick 4
  assert.deepEqual(shotTicks, [1, 2, 4]);
});

test('Trailing: no trailing record -> no emission', () => {
  const b = new ShrapnelBulletUnit({
    velocity: 10, yAngle: 0, range: 10000, rangeOffset: 0,
    spawnX: 0, spawnY: 0, extraParam: {},
  });
  b.FixRange();
  b.InitSpeed();
  for (let i = 0; i < 5; i++) {
    b.timeElapsed += TICK_SECONDS;
    b.Update();
  }
  assert.equal(b.drainEmits().length, 0);
});

test('Split: a single group emits primal_repeat+1 children at SPLIT entry', () => {
  // primal_repeat = 2 -> 3 children at the same tick.
  const child = { type: 1, velocity: 10, range: 50 };
  const barrage = {
    barrage_ID: 1, primal_repeat: 2,
    first_delay: 0, delay: 0, delta_delay: 0,
    angle: 0, delta_angle: 10,
  };
  const extraParam = {
    shrapnel: [
      { initialSplit: false, barrage_ID: 1, bullet_ID: 'B' },
    ],
  };
  const b = new ShrapnelBulletUnit({
    velocity: 10, yAngle: 0, range: 10000, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    extraParam,
    bulletTemplates: { B: child },
    barrages: { 1: barrage },
  });
  b.FixRange();
  b.InitSpeed();
  b.ChangeShrapnelState(STATE.SPLIT);                       // external trigger
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  const emits = b.drainEmits();
  assert.equal(emits.length, 3, 'primal_repeat+1 children at one instant');
  // delta_angle spread: 0, 10, 20.
  assert.equal(emits[0].angle, 0);
  assert.equal(emits[1].angle, 10);
  assert.equal(emits[2].angle, 20);
});

test('Split: shift_split_delay staggers different groups by group index', () => {
  // Two groups, both 1 child, shift_split_delay = 2 ticks each.
  const child = { type: 1, velocity: 10, range: 50 };
  const barrage = {
    barrage_ID: 1, primal_repeat: 0, first_delay: 0, delay: 0, delta_delay: 0,
    angle: 0, delta_angle: 0,
  };
  const extraParam = {
    shrapnel: [
      { initialSplit: false, barrage_ID: 1, bullet_ID: 'B', shift_split_delay: 2 * TICK_SECONDS },
      { initialSplit: false, barrage_ID: 1, bullet_ID: 'B', shift_split_delay: 2 * TICK_SECONDS },
    ],
  };
  const b = new ShrapnelBulletUnit({
    velocity: 10, yAngle: 0, range: 10000, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    extraParam,
    bulletTemplates: { B: child },
    barrages: { 1: barrage },
  });
  b.FixRange();
  b.InitSpeed();
  b.ChangeShrapnelState(STATE.SPLIT);
  // Tick 1: group 0 (delay 0 * 2 = 0) fires.
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  let emits = b.drainEmits();
  assert.equal(emits.length, 1);
  // Tick 2: group 1 deadline = 0 + 2 ticks = 2/30. timeElapsed = 2/30 -> fires.
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  emits = b.drainEmits();
  assert.equal(emits.length, 1);
  // Tick 3: nothing left.
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  emits = b.drainEmits();
  assert.equal(emits.length, 0);
});

test('Split: after all groups emit -> FINAL_SPLIT -> EXPIRE -> reachDestFlag', () => {
  const child = { type: 1, velocity: 10, range: 50 };
  const barrage = {
    barrage_ID: 1, primal_repeat: 0, first_delay: 0, delay: 0, delta_delay: 0,
    angle: 0, delta_angle: 0,
  };
  const extraParam = {
    shrapnel: [
      { initialSplit: false, barrage_ID: 1, bullet_ID: 'B' },
    ],
  };
  const b = new ShrapnelBulletUnit({
    velocity: 10, yAngle: 0, range: 10000, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    extraParam,
    bulletTemplates: { B: child },
    barrages: { 1: barrage },
  });
  b.FixRange();
  b.InitSpeed();
  b.ChangeShrapnelState(STATE.SPLIT);
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  assert.equal(b.GetCurrentState(), STATE.EXPIRE);
  assert.equal(b.reachDestFlag, true);
});

test('fragile=1: SPLIT trigger emits no children but completes the lattice to EXPIRE', () => {
  const child = { type: 1, velocity: 10, range: 50 };
  const barrage = { barrage_ID: 1, primal_repeat: 0, angle: 0, delta_angle: 0 };
  const extraParam = {
    fragile: 1,
    shrapnel: [{ initialSplit: false, barrage_ID: 1, bullet_ID: 'B' }],
  };
  const b = new ShrapnelBulletUnit({
    velocity: 10, yAngle: 0, range: 10000, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    extraParam,
    bulletTemplates: { B: child },
    barrages: { 1: barrage },
  });
  b.FixRange();
  b.InitSpeed();
  b.ChangeShrapnelState(STATE.SPLIT);
  b.timeElapsed += TICK_SECONDS;
  b.Update();
  assert.equal(b.drainEmits().length, 0, 'no children emitted');
  // Visual-only split: the bullet still completes the lattice, just without
  // child specs.
  assert.equal(b.GetCurrentState(), STATE.EXPIRE);
});

test('flare: solves convertedVelocity and verticalSpeed to land on explodePos at child hit_type.time', () => {
  // Pinpoint the formula:
  //   childGrav = |-0.0005| = 0.0005, childHitTime = 60/30 s = 2 s, CALC_FPS = 30
  //   spawnAlt = 0, dist = sqrt((10-0)^2 + 0^2) = 10
  //   h = 0.5 * 0.0005 * (2*30)^2 - 0 = 0.5 * 0.0005 * 3600 = 0.9
  //   convertedVelocity = sqrt(-0.5 * -0.0001 * 100 / 0.9) = sqrt(0.0055..) ~ 0.0745
  //   t = 10 / 0.0745 = 134.16
  //   verticalSpeed = 0.9 / 134.16 - 0.5 * -0.0001 * 134.16 = 0.00671 + 0.00671 = 0.01342
  const childTpl = { extra_param: { gravity: -0.0005 }, hit_type: { time: 2 } };
  const b = new ShrapnelBulletUnit({
    velocity: 50, yAngle: 0, range: 100, rangeOffset: 0, gravity: -0.0001,
    spawnX: 0, spawnY: 0,
    extraParam: { flare: true, shrapnel: [{ bullet_ID: 'C', barrage_ID: 1 }] },
    explodePos: { x: 10, y: 0 },
    bulletTemplates: { C: childTpl },
    barrages: { 1: { barrage_ID: 1, primal_repeat: 0, angle: 0, delta_angle: 0 } },
  });
  b.FixRange();
  b.SetSpawnPosition();
  // Tolerate small floating-point drift.
  assert.ok(Math.abs(b._convertedVelocity - 0.07453559924999298) < 1e-6,
    `expected ~0.0745, got ${b._convertedVelocity}`);
  assert.ok(Math.abs(b.verticalSpeed - 0.01341640786499874) < 1e-6,
    `expected ~0.01342, got ${b.verticalSpeed}`);
});
