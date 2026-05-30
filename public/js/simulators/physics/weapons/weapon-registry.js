/**
 * physics/weapons/weapon-registry.js
 * Maps a weapon EquipmentType to its weapon-driver class and constructs it —
 * the weapon-side analogue of bullet-registry.js. Also builds the spawnWeapon
 * opts from a weapon template + firing context (kept pure so the controller's
 * routing is node:test-able).
 *
 * EquipmentType 24 = BEAM (LaserUnit), 28 = SPACE_LASER (SpaceLaserUnit). These
 * are WEAPON types, distinct from BulletType (beam bullets are type-2 bombs;
 * space-laser bullets are type-14).
 *
 * HARNESS-ONLY: both are 0-reached against current data. The registry exists so
 * the firing pipeline can route additively; if data drift adds a reached one,
 * no further wiring is needed.
 */
import { LaserUnit } from './laser-unit.js';
import { SpaceLaserUnit } from './space-laser-unit.js';

const WEAPON_CLASSES = {
  24: LaserUnit,        // BEAM
  28: SpaceLaserUnit,   // SPACE_LASER
};

/** True if `type` is a weapon-driver EquipmentType (24 or 28). */
export function isWeaponDriverType(type) {
  return Object.prototype.hasOwnProperty.call(WEAPON_CLASSES, type);
}

/** Construct the weapon-driver for `type`, forwarding `opts`. Null if unknown. */
export function createWeaponUnit(type, opts) {
  const Cls = WEAPON_CLASSES[type];
  return Cls ? new Cls(opts) : null;
}

/**
 * Build world.spawnWeapon opts from a resolved weapon template + firing context.
 * ctx: { hostPos, enemyPos, barrageTemplates, bulletTemplates, foe? }.
 */
export function buildWeaponDriverOpts(weapon, ctx) {
  const bulletTemplates = ctx.bulletTemplates || {};
  return {
    type: weapon.type,
    hostPos: ctx.hostPos,
    aimPos: ctx.enemyPos ?? null,
    foe: !!ctx.foe,
    weaponTemplate: weapon,
    barrageTemplates: ctx.barrageTemplates || {},
    bulletTemplates,
    bulletTemplate: bulletTemplates[weapon.bullet_ID?.[0]],   // for the column cylinder
    beamCount: weapon.barrage_ID?.length ?? 1,
  };
}
