import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isWeaponDriverType, createWeaponUnit, buildWeaponDriverOpts,
} from '../../public/js/simulators/physics/weapons/weapon-registry.js';
import { LaserUnit } from '../../public/js/simulators/physics/weapons/laser-unit.js';
import { SpaceLaserUnit } from '../../public/js/simulators/physics/weapons/space-laser-unit.js';

test('isWeaponDriverType: only 24 (BEAM) and 28 (SPACE_LASER)', () => {
  assert.equal(isWeaponDriverType(24), true);
  assert.equal(isWeaponDriverType(28), true);
  assert.equal(isWeaponDriverType(1), false);
  assert.equal(isWeaponDriverType(undefined), false);
});

test('createWeaponUnit: type 24 -> LaserUnit, 28 -> SpaceLaserUnit, else null', () => {
  assert.ok(createWeaponUnit(24, { hostPos: { x: 0, y: 0 }, weaponTemplate: {} }) instanceof LaserUnit);
  assert.ok(createWeaponUnit(28, { hostPos: { x: 0, y: 0 }, bulletTemplate: {} }) instanceof SpaceLaserUnit);
  assert.equal(createWeaponUnit(1, {}), null);
});

test('buildWeaponDriverOpts: maps a weapon + firing context into spawnWeapon opts', () => {
  const weapon = { type: 24, bullet_ID: [9001], barrage_ID: [8001, 8002] };
  const opts = buildWeaponDriverOpts(weapon, {
    hostPos: { x: 1, y: 2 }, enemyPos: { x: 9, y: 9 },
    barrageTemplates: { 8001: { angle: 0 } }, bulletTemplates: { 9001: { cld_box: [1, 2, 3] } },
  });
  assert.equal(opts.type, 24);
  assert.deepEqual(opts.hostPos, { x: 1, y: 2 });
  assert.deepEqual(opts.aimPos, { x: 9, y: 9 });
  assert.equal(opts.foe, false);
  assert.equal(opts.weaponTemplate, weapon);
  assert.equal(opts.beamCount, 2, 'one column per barrage');
  assert.deepEqual(opts.bulletTemplate, { cld_box: [1, 2, 3] }, 'first bullet for the column cylinder');
});
