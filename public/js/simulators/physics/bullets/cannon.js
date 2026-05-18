/**
 * physics/bullets/cannon.js
 * CannonBulletUnit — bullet types 1 (CANNON) and 8 (STRAY). The game's
 * BattleCannonBulletUnit adds no movement override; it is the plain bullet.
 * This subclass is the anchor for the per-type file pattern the later phases
 * follow (bomb, torpedo, shrapnel, ...).
 */

import { BulletUnit } from '../bullet-unit.js';

export class CannonBulletUnit extends BulletUnit {}
