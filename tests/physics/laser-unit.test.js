import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LaserUnit } from '../../public/js/simulators/physics/weapons/laser-unit.js';
import { TICK_SECONDS } from '../../public/js/simulators/physics/constants.js';

// Drive a unit forward like World.step() does, without a World.
function step(unit) {
  unit.timeElapsed += TICK_SECONDS;
  unit.Update();
}

// One beam, first_delay 0 (created immediately), sweeps +5/tick, 4-tick lifetime
// (delay 0.13 ~= 4 ticks at 1/30), no aim.
const BARRAGE_A = {
  angle: 0, delta_angle: 5, first_delay: 0,
  offset_x: 0, offset_z: 0, delta_offset_x: 10, delta_offset_z: 10,
  delay: 0.13, senior_delay: 0, delta_delay: 1,
};
const BULLET_A = { modle_ID: 'beam', extra_param: {} };

function makeLaser(overrides = {}) {
  return new LaserUnit({
    hostPos: { x: 0, y: 0 },
    weaponTemplate: { bullet_ID: [9001], barrage_ID: [8001] },
    bulletTemplates: { 9001: BULLET_A },
    barrageTemplates: { 8001: BARRAGE_A },
    aimPos: null,
    foe: false,
    ...overrides,
  });
}

test('LaserUnit: first_delay==0 beam is created at DoAttack and exposes geometry', () => {
  const laser = makeLaser();
  laser.DoAttack();
  const beams = laser.getBeams();
  assert.equal(beams.length, 1);
  assert.deepEqual(beams[0].position, { x: 0, y: 0 });
  assert.equal(beams[0].angle, 0);
  assert.equal(laser.finished, false);
});

test('LaserUnit: beam sweeps += delta_angle each tick while active', () => {
  const laser = makeLaser();
  laser.DoAttack();
  step(laser);                         // tick 1: aged, swept once
  assert.equal(laser.getBeams()[0].angle, 5);
  step(laser);                         // tick 2: swept again
  assert.equal(laser.getBeams()[0].angle, 10);
});

test('LaserUnit: beam finishes at `delay` lifetime and the weapon enters cooldown', () => {
  const laser = makeLaser();
  laser.DoAttack();
  // delay 0.13 -> active for elapsed < 0.13; ages by 1/30 per tick.
  // ticks: 0.0333, 0.0667, 0.1, 0.1333(>=0.13) -> inactive on tick 4 -> finished.
  let guard = 0;
  while (!laser.finished && guard < 50) { step(laser); guard++; }
  assert.equal(laser.finished, true);
  assert.equal(guard, 4, 'finished on the 4th tick (lifetime 0.13s)');
  assert.equal(laser.getBeams().length, 0, 'no live beams after finish');
});

test('LaserUnit: staggered start — a first_delay > 0 beam is not created until elapsed passes it', () => {
  const laser = makeLaser({
    weaponTemplate: { bullet_ID: [9001], barrage_ID: [8002] },
    barrageTemplates: { 8002: { ...BARRAGE_A, first_delay: 0.05 } },
  });
  laser.DoAttack();
  assert.equal(laser.getBeams().length, 0, 'not created at DoAttack (first_delay 0.05)');
  step(laser);                         // elapsed 0.0333 < 0.05 -> still READY
  assert.equal(laser.getBeams().length, 0);
  step(laser);                         // elapsed 0.0667 > 0.05 -> created this tick
  assert.equal(laser.getBeams().length, 1);
});

test('LaserUnit: aim angle from aimPos rotates the beam (player/friendly atan2)', () => {
  const laser = makeLaser({ aimPos: { x: 0, y: 10 } }); // straight up -> +90 deg
  laser.DoAttack();
  // angle 0 (barrage) + 90 (aim) = 90 on the freshly created beam.
  assert.equal(laser.getBeams()[0].angle, 90);
});

test('LaserUnit: beam re-anchors to a moved host', () => {
  const laser = makeLaser();
  laser.DoAttack();
  laser.updateHostPos({ x: 25, y: -5 });
  step(laser);
  assert.deepEqual(laser.getBeams()[0].position, { x: 25, y: -5 });
});
