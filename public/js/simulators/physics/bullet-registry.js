/**
 * physics/bullet-registry.js
 * Maps a game bullet `type` to its BulletUnit subclass and constructs it.
 * Mirrors the game's GetFactoryList()[type] dispatch. Later phases register
 * bomb (2), torpedo (3), shrapnel (5), missile (13), scale (15), etc.
 */

import { BulletUnit } from './bullet-unit.js';
import { CannonBulletUnit } from './bullets/cannon.js';
import { TorpedoBulletUnit } from './bullets/torpedo.js';
import { BombBulletUnit } from './bullets/bomb.js';

const BULLET_CLASSES = {
  1: CannonBulletUnit,   // CANNON
  8: CannonBulletUnit,   // STRAY — same straight-line movement
  3: TorpedoBulletUnit,  // TORPEDO
  2: BombBulletUnit,     // BOMB
  16: BombBulletUnit,    // bomb-family (non-airdrop; registered, not dispatched here)
};

/** Construct the BulletUnit subclass for `type`, forwarding `opts`. */
export function createBulletUnit(type, opts) {
  const Cls = BULLET_CLASSES[type] ?? BulletUnit;
  return new Cls(opts);
}
