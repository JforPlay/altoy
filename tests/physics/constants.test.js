import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../public/js/simulators/physics/constants.js';

test('BULLET_SPEED_CONVERT is the game factor 60/30*0.1 = 0.2', () => {
  assert.equal(C.BULLET_SPEED_CONVERT, 0.2);
});

test('the fixed tick is 1/30 second at 30 fps', () => {
  assert.equal(C.VIEW_FPS, 30);
  assert.equal(C.TICK_SECONDS, 1 / 30);
  assert.equal(C.ACC_INTERVAL, 1 / 30);
});

test('gravity and detonation height match BattleConfig', () => {
  assert.equal(C.GRAVITY, -0.05);
  assert.equal(C.BOMB_DETONATE_HEIGHT, 1.2);
  assert.equal(C.AIRCRAFT_HEIGHT, 10);
});

test('TRACKER_ANGLE is cos(10 degrees)', () => {
  // Pinned to the literal so the test catches a wrong angle — asserting
  // against Math.cos(...) would just restate the implementation.
  assert.equal(C.TRACKER_ANGLE, 0.984807753012208);
});
