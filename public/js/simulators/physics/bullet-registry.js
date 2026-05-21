/**
 * physics/bullet-registry.js
 * Maps a game bullet `type` to its BulletUnit subclass and constructs it.
 * Mirrors the game's GetFactoryList()[type] dispatch.
 *
 * Harness-only classes (missile, scale) are deliberately NOT registered —
 * the doOrbit precedent. They are 0-reached against current data; their
 * unit tests instantiate them directly. If data drift adds a reached
 * missile or scale bullet, a 3-line follow-up wires it.
 */

import { BulletUnit } from './bullet-unit.js';
import { CannonBulletUnit } from './bullets/cannon.js';
import { TorpedoBulletUnit } from './bullets/torpedo.js';
import { BombBulletUnit } from './bullets/bomb.js';
import { EffectBulletUnit } from './bullets/effect.js';
import { ShrapnelBulletUnit } from './bullets/shrapnel.js';
import { GravitationBulletUnit } from './bullets/gravitation.js';

const BULLET_CLASSES = {
  1: CannonBulletUnit,        // CANNON
  8: CannonBulletUnit,        // STRAY — same straight-line movement
  3: TorpedoBulletUnit,       // TORPEDO
  2: BombBulletUnit,          // BOMB
  16: BombBulletUnit,         // bomb-family (airdrop-dispatched only if flagged; none in current data)
  9: EffectBulletUnit,        // EFFECT — lifetime cap by hit_type.time
  5: ShrapnelBulletUnit,      // SHRAPNEL — fan-fired child bullets from a parent burst
  11: GravitationBulletUnit,  // GRAVITATION — straight movement + hit_type.time cap
  // 13 (MISSILE), 15 (SCALE) deliberately unregistered — harness-only.
};

/** Construct the BulletUnit subclass for `type`, forwarding `opts`. */
export function createBulletUnit(type, opts) {
  const Cls = BULLET_CLASSES[type] ?? BulletUnit;
  return new Cls(opts);
}
