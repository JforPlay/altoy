// tests/damage-engine/constants.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../public/js/engine/damage/constants.js';

test('crit constants match battlestate.lua', () => {
  assert.equal(C.DFT_CRIT_RATE, 0.05);
  assert.equal(C.DFT_CRIT_EFFECT, 1.5);
});

test('reload constants match battleconfig.lua K1/K2/K3', () => {
  assert.equal(C.RELOAD_K1, 6);
  assert.equal(C.RELOAD_K2, 100);
  assert.equal(C.RELOAD_K3, 3.14);
  assert.equal(C.AIR_ASSIST_RELOAD_RATIO, 2.2);
});

test('formula scalars', () => {
  assert.equal(C.AIR_MIT_CONST, 150);   // DRATE[7]
  assert.equal(C.LVL_ADV_CAP, 25);      // DRATE[1]
  assert.equal(C.LVL_ADV_FACTOR, 0.02); // DRATE[2]
  assert.equal(C.RANDOM_DAMAGE_EV, 1);  // (0+2)/2
  assert.equal(C.HIT_FLOOR, 0.1);
  assert.equal(C.PERCENT, 0.01);
  assert.equal(C.RATIO_PERCENT, 0.0001);
});

test('WeaponDamageAttr enum matches battleconst.lua:182 (AIR=4, ANTI_AIR=3)', () => {
  assert.deepEqual(C.WEAPON_ATTR, { CANNON: 1, TORPEDO: 2, ANTI_AIR: 3, AIR: 4, ANTI_SUB: 5 });
  assert.deepEqual(C.ATTR_TO_KEY, { 1: 'cannon', 2: 'torpedo', 4: 'air' });
});
