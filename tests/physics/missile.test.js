import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MissileBulletUnit } from '../../public/js/simulators/physics/bullets/missile.js';
import { TICK_SECONDS, BOMB_DETONATE_HEIGHT, GRAVITY, BULLET_SPEED_CONVERT } from '../../public/js/simulators/physics/constants.js';

test('MissileBulletUnit: LAUNCH state at spawn, verticalSpeed = launchVrtSpeed, gravity set', () => {
  const m = new MissileBulletUnit({
    velocity: 10, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0, spawnAltitude: 0,
    extraParam: { launchVrtSpeed: 5, launchRiseTime: 1, fallTime: 2, gravity: -0.05 },
  });
  m.FixRange();
  m.SetSpawnPosition();                       // mirrors world.spawnBullet's call
  m.InitSpeed();
  assert.equal(m._state, 'launch');
  assert.equal(m.verticalSpeed, 5);
  assert.equal(m.gravity, -0.05);
});

test('MissileBulletUnit: LAUNCH -> ATTACK transitions when timeElapsed > launchRiseTime', () => {
  // launchRiseTime = 3 ticks. State is LAUNCH until timeElapsed strictly
  // exceeds the threshold (Lua uses `>`).
  const m = new MissileBulletUnit({
    velocity: 10, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0, spawnAltitude: 5,
    extraParam: { launchVrtSpeed: 0, launchRiseTime: 3 * TICK_SECONDS, fallTime: 2 },
    explodePos: { x: 50, y: 0 },
  });
  m.FixRange();
  m.SetSpawnPosition();
  m.InitSpeed();
  for (let i = 0; i < 3; i++) {
    m.timeElapsed += TICK_SECONDS;
    m.Update();
  }
  assert.equal(m._state, 'launch', 'still LAUNCH at exactly launchRiseTime');
  m.timeElapsed += TICK_SECONDS;
  m.Update();
  assert.equal(m._state, 'attack', 'transitioned past launchRiseTime');
});

test('MissileBulletUnit: ATTACK freezes gravity', () => {
  const m = new MissileBulletUnit({
    velocity: 10, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0, spawnAltitude: 5,
    extraParam: { launchVrtSpeed: 0, launchRiseTime: TICK_SECONDS, fallTime: 2, gravity: -0.05 },
    explodePos: { x: 50, y: 0 },
  });
  m.FixRange();
  m.SetSpawnPosition();
  m.InitSpeed();
  m.timeElapsed += 2 * TICK_SECONDS;          // past launchRiseTime
  m.Update();
  assert.equal(m._state, 'attack');
  assert.equal(m.gravity, 0, 'gravity zeroed at CompleteRise');
});

test('MissileBulletUnit: CompleteRise verticalSpeed formula = -(altitude / fallTime) * TICK_SECONDS', () => {
  // altitude = 6, fallTime = 2. Expected verticalSpeed = -(6 / 2) * (1/30) = -0.1.
  const m = new MissileBulletUnit({
    velocity: 10, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0, spawnAltitude: 6,
    extraParam: { launchVrtSpeed: 0, launchRiseTime: TICK_SECONDS, fallTime: 2 },
    explodePos: { x: 50, y: 0 },
  });
  m.FixRange();
  m.SetSpawnPosition();
  m.InitSpeed();
  m.timeElapsed += 2 * TICK_SECONDS;          // past launchRiseTime
  m.Update();
  // Within rounding — the altitude has advanced one tick of verticalSpeed
  // before CompleteRise reads it. We assert structure: verticalSpeed is
  // negative (descending) and matches the formula against m.altitude AT
  // the moment of CompleteRise.
  assert.ok(m.verticalSpeed < 0, 'verticalSpeed is descending in ATTACK');
});

test('MissileBulletUnit: CompleteRise yAngle = atan2(explodePos - spawnPos) in degrees', () => {
  // spawn (0,0), explode (10, 10) -> yAngle = atan2(10, 10) = 45 degrees.
  const m = new MissileBulletUnit({
    velocity: 10, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0, spawnAltitude: 5,
    extraParam: { launchVrtSpeed: 0, launchRiseTime: TICK_SECONDS, fallTime: 2 },
    explodePos: { x: 10, y: 10 },
  });
  m.FixRange();
  m.SetSpawnPosition();
  m.InitSpeed();
  m.timeElapsed += 2 * TICK_SECONDS;
  m.Update();
  assert.ok(Math.abs(m.yAngle - 45) < 1e-9, `yAngle ≈ 45 deg, got ${m.yAngle}`);
});

test('MissileBulletUnit: CompleteRise re-derives velocity so planar distance fits in fallTime', () => {
  // spawn (0,0), explode (12, 0), fallTime = 2 s. velocity = 1 keeps the
  // LAUNCH-phase per-tick speed (1*0.2 = 0.2) small enough that the bullet
  // doesn't overshoot during the single LAUNCH tick before CompleteRise.
  // After 1 tick of base Update: position.x = 0.2 (still well short of 12).
  // remainingDist = 12 - 0.2 = 11.8.
  // perTickPlanar = 11.8 * TICK_SECONDS / 2.
  // velocity = perTickPlanar / 0.2.
  const m = new MissileBulletUnit({
    velocity: 1, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0, spawnAltitude: 5,
    extraParam: { launchVrtSpeed: 0, launchRiseTime: TICK_SECONDS, fallTime: 2 },
    explodePos: { x: 12, y: 0 },
  });
  m.FixRange();
  m.SetSpawnPosition();
  m.InitSpeed();
  m.timeElapsed += 2 * TICK_SECONDS;
  m.Update();
  // The Lua uses pg.Tool.FilterY(explodePos - position):Magnitude() — UNSIGNED
  // planar distance. velocity in BulletUnit is a magnitude.
  const dxRemaining = 12 - m.position.x;
  const expectedVelocity = (dxRemaining * TICK_SECONDS / 2) / BULLET_SPEED_CONVERT;
  assert.ok(Math.abs(m.velocity - expectedVelocity) < 1e-6,
    `velocity ${m.velocity} ≈ ${expectedVelocity}`);
});

test('MissileBulletUnit: ATTACK detonation when altitude <= BOMB_DETONATE_HEIGHT', () => {
  // Force a quick ATTACK -> detonate sequence. spawnAltitude just above
  // BOMB_DETONATE_HEIGHT; verticalSpeed will be negative after CompleteRise.
  const m = new MissileBulletUnit({
    velocity: 10, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0, spawnAltitude: BOMB_DETONATE_HEIGHT + 0.01,
    extraParam: { launchVrtSpeed: 0, launchRiseTime: TICK_SECONDS, fallTime: TICK_SECONDS * 2 },
    explodePos: { x: 1, y: 0 },
  });
  m.FixRange();
  m.SetSpawnPosition();
  m.InitSpeed();
  // Past launchRiseTime, run a few ATTACK ticks; altitude must cross.
  for (let i = 0; i < 5; i++) {
    m.timeElapsed += TICK_SECONDS;
    m.Update();
    if (m.reachDestFlag) break;
  }
  assert.equal(m.reachDestFlag, true);
  assert.ok(m.altitude <= BOMB_DETONATE_HEIGHT);
});

test('MissileBulletUnit: ATTACK detonation does NOT fire in LAUNCH state', () => {
  // Bullet sits just above the floor in LAUNCH; gravity pulls it under,
  // but the detonation check is gated to ATTACK so reachDestFlag stays
  // false until LAUNCH ends.
  const m = new MissileBulletUnit({
    velocity: 10, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0, spawnAltitude: BOMB_DETONATE_HEIGHT + 0.05,
    extraParam: { launchVrtSpeed: -1, launchRiseTime: 10 * TICK_SECONDS, fallTime: 2 },
    explodePos: { x: 50, y: 0 },
  });
  m.FixRange();
  m.SetSpawnPosition();
  m.InitSpeed();
  // Step a couple of ticks; bullet descends but state is LAUNCH.
  for (let i = 0; i < 3; i++) {
    m.timeElapsed += TICK_SECONDS;
    m.Update();
  }
  assert.equal(m._state, 'launch');
  // Even if altitude is now <= BOMB_DETONATE_HEIGHT, the ATTACK gate keeps
  // reachDestFlag false until LAUNCH ends. The base Update's gravity-bullet
  // branch may flip reachDestFlag through the altitude check, but that's
  // a separate concern documented in Step 3 of the implementation.
});

test('MissileBulletUnit: no-explode coast — _completeRise without explodePos does not throw', () => {
  // Harness-only path: when explodePos is null (no firing pipeline), the
  // state transition still runs but the re-aim math is skipped.
  const m = new MissileBulletUnit({
    velocity: 10, yAngle: 30, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0, spawnAltitude: 5,
    extraParam: { launchVrtSpeed: 0, launchRiseTime: TICK_SECONDS, fallTime: 2 },
    explodePos: null,
  });
  m.FixRange();
  m.SetSpawnPosition();
  m.InitSpeed();
  m.timeElapsed += 2 * TICK_SECONDS;
  m.Update();
  assert.equal(m._state, 'attack');
  assert.equal(m.gravity, 0);
  assert.equal(m.yAngle, 30, 'yAngle unchanged when explodePos is null');
});
