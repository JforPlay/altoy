import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../../public/js/simulators/physics/world.js';
import { TICK_SECONDS } from '../../public/js/simulators/physics/constants.js';

test('spawnBullet creates a live, range-resolved, speed-initialised unit', () => {
  const world = new World();
  const b = world.spawnBullet({
    type: 1, velocity: 50, yAngle: 0, range: 40, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
  });
  assert.ok(b, 'spawn succeeds');
  assert.equal(world.bullets.length, 1);
  assert.equal(b.sqrRange, 1600, 'FixRange ran');
  assert.equal(b.speed.x, 10, 'InitSpeed ran');
});

test('step advances every bullet by one 1/30 s tick', () => {
  const world = new World();
  const b = world.spawnBullet({
    type: 1, velocity: 50, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
  });
  world.step();
  assert.equal(b.position.x, 10);
  assert.equal(b.timeElapsed, TICK_SECONDS);
});

test('a cannon bullet flies straight and is culled when it passes its range', () => {
  const world = new World();
  const b = world.spawnBullet({
    type: 1, velocity: 50, yAngle: 0, range: 25, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
  });
  world.step();                         // x=10
  world.step();                         // x=20, sqrDist 400 < 625
  assert.equal(world.bullets.length, 1, 'still in flight');
  world.step();                         // x=30, sqrDist 900 > 625 -> expire
  assert.equal(b.reachDestFlag, true);
  assert.equal(world.bullets.length, 0, 'expired bullet is culled');
});

test('spawnBullet rejects a non-finite spawn coordinate', () => {
  const world = new World();
  const b = world.spawnBullet({
    type: 1, velocity: 10, yAngle: 0, range: 10, spawnX: NaN, spawnY: 0,
  });
  assert.equal(b, null);
  assert.equal(world.bullets.length, 0);
});

test('spawnBullet rejects a non-finite velocity', () => {
  // A NaN velocity yields NaN speed -> NaN position -> the squared-distance
  // range check never trips, so the bullet would leak forever. Reject it.
  const world = new World();
  const b = world.spawnBullet({
    type: 1, velocity: NaN, yAngle: 0, range: 10, spawnX: 0, spawnY: 0,
  });
  assert.equal(b, null);
  assert.equal(world.bullets.length, 0);
});

test('a type-8 STRAY bullet flies straight and is culled at its range', () => {
  // STRAY (8) shares CannonBulletUnit with CANNON (1). This pins type 8
  // explicitly rather than relying on transitivity through the shared class.
  const world = new World();
  // velocity 50 -> speed 10/tick; range 25 -> sqrRange 625.
  world.spawnBullet({
    type: 8, velocity: 50, yAngle: 0, range: 25, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
  });
  world.step();                         // x=10, sqrDist 100
  world.step();                         // x=20, sqrDist 400 < 625
  assert.equal(world.bullets.length, 1, 'still in flight');
  world.step();                         // x=30, sqrDist 900 > 625 -> expire
  assert.equal(world.bullets.length, 0, 'STRAY culled at range');
});

test('a type-3 torpedo flies straight and is culled at its range', () => {
  // Torpedo (3) uses TorpedoBulletUnit — plain straight-line movement.
  const world = new World();
  // velocity 50 -> speed 10/tick; range 25 -> sqrRange 625.
  world.spawnBullet({
    type: 3, velocity: 50, yAngle: 0, range: 25, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
  });
  world.step();                         // x=10, sqrDist 100
  world.step();                         // x=20, sqrDist 400 < 625
  assert.equal(world.bullets.length, 1, 'still in flight');
  world.step();                         // x=30, sqrDist 900 > 625 -> expire
  assert.equal(world.bullets.length, 0, 'torpedo culled at range');
});

test('spawnBomb resolves airdrop geometry, vertical speed, and aim', () => {
  const world = new World();
  const b = world.spawnBomb({
    type: 2, velocity: 5, gravity: -0.25, offsetY: 8, dropOffset: false,
    range: 50, rangeOffset: 0, explodePos: { x: 20, y: 0 }, direction: 1,
  });
  assert.ok(b, 'spawn succeeds');
  assert.equal(world.bullets.length, 1);
  assert.deepEqual(b.position, { x: 20, y: 0 }, 'SetSpawnPosition ran');
  assert.equal(b.altitude, 8, 'altitude seeded to offsetY');
  assert.ok(b.verticalSpeed < 0, 'verticalSpeed solved (descending)');
  assert.equal(b.yAngle, 0, 'InitSpeed ran');
});

test('a spawned bomb falls under gravity and is culled when it detonates', () => {
  const world = new World();
  // Overhead bomb: flightTime ~1.2 ticks; it descends past the detonation
  // height within two ticks.
  world.spawnBomb({
    type: 2, velocity: 5, gravity: -0.25, offsetY: 8, dropOffset: false,
    range: 50, rangeOffset: 0, explodePos: { x: 20, y: 0 }, direction: 1,
  });
  world.step();
  assert.equal(world.bullets.length, 1, 'still falling');
  world.step();
  assert.equal(world.bullets.length, 0, 'detonated and culled');
});

test('spawnBomb rejects a non-finite explode point', () => {
  const world = new World();
  const b = world.spawnBomb({ type: 2, velocity: 5, explodePos: { x: NaN, y: 0 } });
  assert.equal(b, null);
  assert.equal(world.bullets.length, 0);
});

test('a velocity-0 bomb free-falls under gravity and detonates', () => {
  const world = new World();
  // verticalSpeed 0 at spawn; doNothing accrues gravity -0.5/tick, so altitude
  // drops by 0.5, 1.0, 1.5, 2.0, 2.5 -> 7.5, 6.5, 5.0, 3.0, 0.5; detonates <= 1.2.
  world.spawnBomb({
    type: 2, velocity: 0, gravity: -0.5, offsetY: 8, dropOffset: false,
    range: 50, rangeOffset: 0, explodePos: { x: 20, y: 0 }, direction: 1,
  });
  let steps = 0;
  while (world.bullets.length > 0 && steps < 100) { world.step(); steps++; }
  assert.equal(world.bullets.length, 0, 'velocity-0 bomb detonated');
  assert.ok(steps > 1, 'it took multiple ticks to fall (not instant)');
});

test('a serpentine accelerating bullet weaves off its firing axis and back', () => {
  // Type-1 cannon fired along +x with an oscillating cross-acceleration — the
  // shape of Alsace's bullets 160907/160908. v=+0.27 for the first 0.5 s curves
  // it +y; v=-0.27 then curves it back. (Reachability audit: doAccelerate is
  // exercised in-page by 514 reached bullets.)
  const world = new World();
  world.spawnBullet({
    type: 1, velocity: 8, yAngle: 0, range: 500, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    acceleration: [{ t: 0, u: 0, v: 0.27 }, { t: 0.5, u: 0, v: -0.27 }],
  });
  const bullet = world.bullets[0];

  for (let i = 0; i < 14; i++) world.step();      // v=+0.27 phase
  assert.ok(bullet.position.y > 0, 'weaved off the +x axis');
  assert.ok(bullet.speed.y > 0, 'still curving up at the end of the + phase');

  for (let i = 0; i < 20; i++) world.step();      // into the v=-0.27 phase
  assert.ok(bullet.speed.y < 0, 'the - phase has fully reversed the weave');
});

test('a homing tracker bullet curves toward its target', () => {
  // Type-1 cannon fired along +x at a target up and to the right.
  const world = new World();
  world.spawnBullet({
    type: 1, velocity: 10, yAngle: 0, range: 300, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
    acceleration: { tracker: { angular: 90, range: 200 } },
    target: { x: 40, y: 40 },
  });
  const bullet = world.bullets[0];

  for (let i = 0; i < 6; i++) world.step();
  assert.ok(bullet.position.y > 0, 'curved off the +x axis toward the target');
  assert.ok(bullet.speed.y > 0, 'heading now has an upward component');
});

test('a plain cannon is unaffected by the curving machinery', () => {
  // Regression: no acceleration data -> doNothing -> dead-straight, as Phase 2.
  const world = new World();
  world.spawnBullet({
    type: 1, velocity: 50, yAngle: 0, range: 100, rangeOffset: 0,
    spawnX: 0, spawnY: 0,
  });
  const bullet = world.bullets[0];
  world.step();
  world.step();
  assert.equal(bullet.position.y, 0, 'a plain cannon flies dead straight');
  assert.equal(bullet.position.x, 20, 'velocity 50 * 0.2 = 10/tick, 2 ticks');
});

test('world.step drains drainEmits() into onEmit, after all Updates', () => {
  const world = new World();
  const events = [];
  world.onEmit = (spec) => events.push(spec);

  // Hand-rolled fake unit — emits two specs every tick.
  const fake = {
    timeElapsed: 0,
    reachDestFlag: false,
    Update() {},
    drainEmits() {
      const out = [{ id: 'a' }, { id: 'b' }];
      return out;
    },
  };
  world.bullets.push(fake);
  world.step();
  assert.deepEqual(events, [{ id: 'a' }, { id: 'b' }]);
});

test('world.step does NOT step a child spawned mid-tick (length-cached loop)', () => {
  const world = new World();
  let childStepped = false;
  const child = {
    timeElapsed: 0,
    reachDestFlag: false,
    Update() { childStepped = true; },
  };
  world.onEmit = () => { world.bullets.push(child); };

  const parent = {
    timeElapsed: 0,
    reachDestFlag: false,
    Update() {},
    drainEmits() { return [{}]; },           // one emit -> spawns child
  };
  world.bullets.push(parent);
  world.step();
  assert.equal(childStepped, false, 'mid-tick child Update deferred to next step');
  assert.ok(world.bullets.includes(child), 'child is queued for the next tick');
});

test('world.step still culls reachDestFlag units when onEmit is set', () => {
  const world = new World();
  world.onEmit = () => {};                   // no-op, just exercise the path
  const dead = {
    timeElapsed: 0,
    reachDestFlag: false,
    Update() { this.reachDestFlag = true; },
  };
  world.bullets.push(dead);
  world.step();
  assert.equal(world.bullets.length, 0);
});

test('world.step handles a reentrant onEmit that calls spawnBullet', () => {
  const world = new World();
  world.onEmit = (spec) => {
    world.spawnBullet({
      type: 1, velocity: 50, yAngle: 0, range: 10, rangeOffset: 0,
      spawnX: spec.x, spawnY: spec.y,
    });
  };
  const parent = {
    timeElapsed: 0,
    reachDestFlag: false,
    Update() {},
    drainEmits() { return [{ x: 0, y: 0 }]; },
  };
  world.bullets.push(parent);
  world.step();
  // parent stayed alive (no reachDestFlag); spawned child also alive.
  assert.equal(world.bullets.length, 2);
});

test('spawnBomb non-airdrop validates spawnX/spawnY/yAngle/velocity', () => {
  const world = new World();
  // NaN spawnX -> reject.
  const a = world.spawnBomb({
    type: 2, airdrop: false, velocity: 5, yAngle: 0,
    spawnX: NaN, spawnY: 0, range: 50, rangeOffset: 0,
  });
  assert.equal(a, null);
  assert.equal(world.bullets.length, 0);

  // NaN velocity -> reject.
  const b = world.spawnBomb({
    type: 2, airdrop: false, velocity: NaN, yAngle: 0,
    spawnX: 0, spawnY: 0, range: 50, rangeOffset: 0,
  });
  assert.equal(b, null);
});

test('spawnBomb non-airdrop with null explodePos succeeds (falls along yAngle)', () => {
  const world = new World();
  const b = world.spawnBomb({
    type: 2, airdrop: false, velocity: 5, yAngle: 0,
    spawnX: 0, spawnY: 0, range: 50, rangeOffset: 0,
    gravity: -0.05, explodePos: null,
  });
  assert.ok(b, 'spawn succeeds with null explodePos');
  assert.equal(world.bullets.length, 1);
  assert.equal(b.yAngle, 0, 'yAngle preserved from caller (no aim override)');
});

test('spawnBomb airdrop validation still rejects NaN explodePos (regression)', () => {
  const world = new World();
  const b = world.spawnBomb({
    type: 2, velocity: 5, explodePos: { x: NaN, y: 0 },
  });
  assert.equal(b, null);
});

test('spawnWeapon adds a live weapon, DoAttack runs, and step() ticks + culls it', () => {
  const world = new World();
  const w = world.spawnWeapon({
    type: 24,
    hostPos: { x: 0, y: 0 },
    weaponTemplate: { bullet_ID: [9001], barrage_ID: [8001] },
    bulletTemplates: { 9001: { extra_param: {} } },
    barrageTemplates: { 8001: {
      angle: 0, delta_angle: 5, first_delay: 0,
      offset_x: 0, offset_z: 0, delta_offset_x: 10, delta_offset_z: 10,
      delay: 0.05, senior_delay: 0, delta_delay: 1,   // ~2-tick lifetime
    } },
    aimPos: null,
  });
  assert.ok(w, 'spawn succeeds');
  assert.equal(world.weapons.length, 1);
  assert.equal(w.getBeams().length, 1, 'first_delay==0 beam created at DoAttack');

  // delay 0.05 -> active tick 1 (0.033) then inactive on tick 2 (0.067) -> finished + culled.
  world.step();
  assert.equal(world.weapons.length, 1, 'still attacking after one tick');
  world.step();
  assert.equal(world.weapons.length, 0, 'finished weapon is culled');
});

test('spawnWeapon rejects a non-finite host position', () => {
  const world = new World();
  const w = world.spawnWeapon({ type: 24, hostPos: { x: NaN, y: 0 }, weaponTemplate: {} });
  assert.equal(w, null);
  assert.equal(world.weapons.length, 0);
});

test('spawnWeapon rejects an unresolved weapon type', () => {
  const world = new World();
  const w = world.spawnWeapon({ type: 1, hostPos: { x: 0, y: 0 } });
  assert.equal(w, null);
  assert.equal(world.weapons.length, 0);
});

test('step() ticks bullets and weapons independently', () => {
  const world = new World();
  world.spawnBullet({ type: 1, velocity: 50, yAngle: 0, range: 100, rangeOffset: 0, spawnX: 0, spawnY: 0 });
  world.spawnWeapon({
    type: 24, hostPos: { x: 0, y: 0 },
    weaponTemplate: { bullet_ID: [9001], barrage_ID: [8001] },
    bulletTemplates: { 9001: { extra_param: {} } },
    barrageTemplates: { 8001: { angle: 0, delta_angle: 0, first_delay: 0, offset_x: 0, offset_z: 0, delta_offset_x: 1, delta_offset_z: 1, delay: 1 } },
  });
  world.step();
  assert.equal(world.bullets[0].position.x, 10, 'bullet advanced');
  assert.equal(world.weapons[0].timeElapsed, TICK_SECONDS, 'weapon clock advanced');
});

test('spawnWeapon drives a space-laser (type 28) through alert->attack handoff to cull', () => {
  const world = new World();
  const w = world.spawnWeapon({
    type: 28,
    hostPos: { x: 3, y: 4 },
    bulletTemplate: {
      cld_box: [6, 99, 2],
      hit_type: { interval: 0.1 },
      extra_param: { aim_time: 0.07, attack_time: 0.07 },   // ~3 ticks each
    },
    beamCount: 1,
  });
  assert.ok(w, 'spawn succeeds');
  assert.equal(world.weapons.length, 1);
  assert.equal(w.getColumns()[0].stage, 'alert', 'starts aiming');

  // aim_time 0.07: alert survives ticks 1,2 then hands off to attack on tick 3.
  world.step(); world.step();
  assert.equal(w.getColumns()[0].stage, 'alert', 'still aiming through the alert window');
  world.step();
  assert.equal(w.getColumns()[0].stage, 'attack', 'handed off to the attack column');

  // attack_time 0.07: a few more ticks, then EnterCoolDown -> finished -> culled.
  let guard = 0;
  while (world.weapons.length > 0 && guard < 50) { world.step(); guard++; }
  assert.equal(world.weapons.length, 0, 'space-laser culled after its attack window');
});
