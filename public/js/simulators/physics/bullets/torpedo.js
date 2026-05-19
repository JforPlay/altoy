/**
 * physics/bullets/torpedo.js
 * TorpedoBulletUnit — bullet type 3.
 *
 * The game's BattleTorpedoBulletUnit overrides only calcSpeed
 * (battletorpedobulletunit.lua:12-16):
 *   convertedVelocity = ConvertBulletSpeed(
 *       max(0, velocity + torpedoSpeedExtra) * (1 + bulletSpeedRatio))
 * `torpedoSpeedExtra` and `bulletSpeedRatio` are ship buff attributes. The
 * simulator has no buff model, so both take their identity values (+0, x1),
 * leaving max(0, velocity) * 0.2. Bullet-template `velocity` is never negative,
 * so this is numerically identical to the base BulletUnit.calcSpeed — no
 * override is carried (cf. CannonBulletUnit). The calcSpeed override is the
 * documented extension point if a buff model is ever added.
 *
 * Torpedo dive/surface state (OXY_STATE / diveFilter) has no concept in a
 * surface-only viewer and is intentionally not modelled.
 */

import { BulletUnit } from '../bullet-unit.js';

export class TorpedoBulletUnit extends BulletUnit {}
