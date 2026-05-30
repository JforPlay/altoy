/**
 * physics/weapons/weapon-unit.js
 * WeaponUnit — minimal base for the long-lived weapon drivers (laser,
 * space-laser). Unlike a BulletUnit (fire-and-forget), a weapon unit lives
 * across many ticks, re-anchors to a live host each tick, owns sub-units, and
 * signals completion via `finished` so World.step() can cull it.
 *
 * Scope: this base models only the POST-FIRE lifecycle (DoAttack -> run ->
 * EnterCoolDown). Reload / tracking / target-selection / precast — the front
 * half of BattleWeaponUnit (battleweaponunit.lua) — are owned by the sim firing
 * pipeline (sim.weapon.controller.js), which constructs + spawns this unit at
 * fire time. That mirrors how world.spawnBullet is called only once the
 * controller has already decided to fire.
 *
 * Pure-functional contract (like the rest of physics/): no DOM, no wall-clock,
 * never mutate an input. The host position is an INPUT — the driver writes
 * `hostPos` each tick via updateHostPos(); the unit never reaches out to read it.
 */
export class WeaponUnit {
  constructor(opts = {}) {
    this.timeElapsed = 0;                            // seconds; World.step adds TICK_SECONDS
    this.finished = false;                           // true after EnterCoolDown -> World culls
    const h = opts.hostPos;
    this.hostPos = (h && Number.isFinite(h.x) && Number.isFinite(h.y))
      ? { x: h.x, y: h.y }
      : { x: 0, y: 0 };                              // game plane (x, y <- Lua z)
  }

  /** Re-anchor to the live host. Driver calls this each tick before step(). */
  updateHostPos(pos) {
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      this.hostPos = { x: pos.x, y: pos.y };
    }
  }

  /** Begin the attack. Subclasses override; base is a no-op hook. */
  DoAttack() {}

  /** Advance one tick. Subclasses override; base is a no-op hook. */
  Update() {}

  /** Mark the weapon done; World.step() culls finished units. */
  EnterCoolDown() {
    this.finished = true;
  }
}
