/**
 * sim.engine.bullet.js
 * Low-level bullet engine: coordinate transforms, bullet DOM creation,
 * per-frame physics dispatch, and rendering for all bullet types.
 * Part of the simulators shared engine (common → bullet + aircraft + oceanbg).
 *
 * The physics core (physics/) is the sole bullet pipeline; BattleConfig game
 * constants (bullet-speed convert, bomb-detonate height, …) live in
 * physics/constants.js.
 */

import { World } from './physics/world.js';
import { drainAccumulator } from './physics/accumulator.js';
import { TICK_SECONDS, AIRCRAFT_HEIGHT } from './physics/constants.js';

// Bullet type → CSS placeholder class. Keys are game BattleConst.BulletType.
const BULLET_TYPE_CLASSES = {
    2: 'bomb-bullet',        // BOMB
    3: 'torpedo-bullet',     // TORPEDO
    5: 'shrapnel-bullet',    // SHRAPNEL
    9: 'effect-bullet',      // EFFECT
    13: 'missile-bullet',    // MISSILE
    14: 'space-laser-bullet',// SPACE_LASER
    15: 'scale-bullet',      // SCALE
};

export class BulletEngine {
    constructor(options) {
        this.container = options.container;
        this.gameCoords = options.gameCoords;
        this.targetFps = options.targetFps || 30;
        // Pure playback-speed multiplier: 1.0 = real game time. Only use is
        // scaling real elapsed ms in the world-loop accumulator. Use ?? so
        // an explicit 0 (pause) is preserved rather than coerced to the default.
        this.gSpeed = options.gSpeed ?? 1.0;

        this.allBarrages = {};
        this.allBullets = {};

        // --- Physics core (the sole bullet pipeline as of Phase 5b) ---
        // The pure fixed-timestep core (physics/) runs EVERY bullet through one
        // shared 30 fps loop (world.step). The legacy per-bullet rAF path was
        // deleted in Phase 5b. See dev/active/2026-05-17-weapon-physics-rework.md.
        this.world = new World();
        // ShrapnelBulletUnit.drainEmits returns child specs in GAME coords.
        // createBullet's contract is SCREEN coords; convert once here so the
        // engine's dispatch (_createWorldBullet/_createWorldBomb -> screenToGame)
        // receives screen coordinates as expected.
        this.world.onEmit = (spec) => {
            const screen = this.gameToScreen(spec.startX, spec.startY);
            this.createBullet({
                ...spec,
                startX: screen.x,
                startY: screen.y,
            });
        };
        this._worldViews = new Map();   // BulletUnit -> { element, bulletInfo, baseWidth, baseHeight }
        // Weapon-driver (beam type 24 / space-laser type 28) DOM views:
        // unit -> { beamEls: Map<i, el>, columnEls: Map<i, el> }.
        this._worldWeaponViews = new Map();
        this._worldLoopId = null;       // rAF id of the shared loop, null when idle
        this._worldAccumulatorMs = 0;   // unspent real time carried between frames
        this._worldLastTime = 0;        // performance.now() of the previous loop frame

        this.perspective = {
            enabled: false,
            minScale: 0.8,
            maxScale: 1.1,
            depthBlur: false
        };

        this.updateScale();
        this._resizeHandler = () => this.updateScale();
        window.addEventListener('resize', this._resizeHandler);
    }

    // ===== Data =====

    setData(allBarrages, allBullets) {
        this.allBarrages = allBarrages;
        this.allBullets = allBullets;
    }

    // ===== Coordinate Transforms =====

    updateScale() {
        const gameWidth = this.gameCoords.totalArea.maxX - this.gameCoords.totalArea.minX;
        this.scale = this.container.offsetWidth / gameWidth;
    }

    gameToScreen(gameX, gameY) {
        const screenX = (gameX - this.gameCoords.totalArea.minX) * this.scale;
        const screenY = (this.gameCoords.totalArea.maxY - gameY) * this.scale;

        let depthScale = 1.0;
        let blur = 0;

        if (this.perspective.enabled) {
            const relativeY = gameY - this.gameCoords.totalArea.minY;
            const maxDepth = this.gameCoords.totalArea.maxY - this.gameCoords.totalArea.minY;
            const depthFactor = Math.max(0, Math.min(1, relativeY / maxDepth));

            depthScale = this.perspective.minScale +
                (this.perspective.maxScale - this.perspective.minScale) * depthFactor;

            if (this.perspective.depthBlur) {
                blur = (1 - depthFactor) * 1.5;
            }
        }

        return {
            x: screenX,
            y: screenY,
            scale: depthScale,
            depth: gameY,
            blur: blur
        };
    }

    screenToGame(screenX, screenY) {
        const gameX = (screenX / this.scale) + this.gameCoords.totalArea.minX;
        const gameY = this.gameCoords.totalArea.maxY - (screenY / this.scale);

        return { x: gameX, y: gameY };
    }

    // ===== Bullet Creation & Animation =====

    createBullet(options) {
        const {
            startX, startY, angle, bulletInfo,
            transformChain = [], parentBullet = null,
            inheritSpeed = null, airdropData = null,
            enemyTarget = null, barrageAngle = null
        } = options;

        if (isNaN(startX) || isNaN(startY) || isNaN(angle)) {
            console.error('Invalid bullet position:', { startX, startY, angle });
            return;
        }

        // Phase 5b: the physics core is the only bullet pipeline. Bombs (type
        // 2/16) need the parabolic spawn solve, so they route to _createWorldBomb;
        // everything else — straight/curving movers, effect, shrapnel, gravitation,
        // and the synthetic esv-skin preview bullet — routes to _createWorldBullet,
        // whose base BulletUnit handles any unregistered type as a straight bullet.
        if (this._isAirdropBomb(bulletInfo, options)) {
            return this._createWorldBomb({ ...options, mode: 'airdrop' });
        }
        if (bulletInfo.type === 2 || bulletInfo.type === 16) {
            // Every type-2/16 bomb takes the bomb path — never the straight
            // catch-all. This also catches an airdrop bomb that failed
            // _isAirdropBomb's shrapnel/missile/inheritSpeed/transformChain
            // exclusions; verified 0-reached (Phase 5a audit: 0 reached bombs
            // carry shrapnel or missile), so the non-airdrop route is safe here.
            return this._createWorldBomb({ ...options, mode: 'non-airdrop' });
        }
        return this._createWorldBullet(options);
    }

    // ===== Physics-Core Render Path =====

    /**
     * True only for an airdrop bomb the physics path provably renders
     * correctly: a bomb type (2 / 16) flagged extra_param.airdrop, carrying
     * the firing pipeline's airdropData (the explode point), with no shrapnel,
     * missile, transform chain or inherited speed.
     *
     * Phase 3c relaxed the _hasEmptyAcceleration gate: curving airdrop bombs
     * (1 reached, bullet 170838) now ride the base priority chain via
     * BombBulletUnit.InitSpeed deferring to super.
     */
    _isAirdropBomb(bulletInfo, options) {
        return (bulletInfo.type === 2 || bulletInfo.type === 16)
            && bulletInfo.extra_param?.airdrop
            && options.airdropData != null
            && !bulletInfo.extra_param?.shrapnel
            && !bulletInfo.extra_param?.missile
            && options.inheritSpeed == null
            && (!options.transformChain || options.transformChain.length === 0);
    }

    /**
     * Build the DOM element for a physics-core bullet: the base `bullet`
     * class, the skin modle_ID class, and the bullet-type class so a bullet
     * keeps its type styling. Size and position are set by the caller.
     */
    _createBulletElement(bulletInfo) {
        const element = document.createElement('div');
        element.className = 'bullet';
        if (bulletInfo.modle_ID) element.classList.add(bulletInfo.modle_ID);
        const typeClass = BULLET_TYPE_CLASSES[bulletInfo.type];
        if (typeClass) element.classList.add(typeClass);
        return element;
    }

    /**
     * Spawn a bullet (straight or curving) into the physics core and build its
     * DOM element. Receives screen-space coordinates and converts to game space
     * for the core. Returns the element, or null if the core rejected the spawn
     * (non-finite input).
     */
    _createWorldBullet(options) {
        const { startX, startY, angle, bulletInfo, barrageAngle, enemyTarget } = options;
        const startGamePos = this.screenToGame(startX, startY);

        const unit = this.world.spawnBullet({
            type: bulletInfo.type,
            velocity: bulletInfo.velocity,
            yAngle: angle,
            range: bulletInfo.range,
            rangeOffset: bulletInfo.range_offset || 0,
            spawnX: startGamePos.x,
            spawnY: startGamePos.y,
            // Shrapnel children carry the parent's burst altitude (set by
            // ShrapnelBulletUnit._emitChild). Without it a gravity child spawns at
            // altitude 0 and the base `altitude <= BOMB_DETONATE_HEIGHT` expiry
            // culls it on tick 1 — the Kirishima 11270 fragment-vanish regression.
            // Top-level bullets pass no spawnAltitude → 0, unchanged.
            spawnAltitude: options.spawnAltitude ?? 0,
            // Curving-movement data (Phase 2c). `acceleration` drives the core's
            // InitSpeed priority chain; `barrageAngle` resolves the per-record
            // `flip`; `target` (enemyTarget — already game coords) is the
            // homing / circle-centre target. A plain bullet has empty
            // acceleration and ignores all three.
            acceleration: bulletInfo.acceleration,
            barrageAngle: barrageAngle,
            target: enemyTarget,
            // Phase 3a additions — subclasses pick what they need; base ignores.
            // gravity comes from extra_param for shrapnel parents (e.g. bullet
            // 19920 carries `-0.05`). Undefined for cannon / torpedo / effect
            // → BulletUnit defaults to 0, no change.
            gravity: bulletInfo.extra_param?.gravity,
            extraParam: bulletInfo.extra_param,
            hitTypeTime: bulletInfo.hit_type?.time,
            explodePos: options.explodePos ?? options.airdropData?.explodePos,
            bulletTemplates: this.allBullets,
            barrages: this.allBarrages,                  // NEW for shrapnel
            parentBullet: options.parentBullet,
        });
        if (!unit) return null;

        const element = this._createBulletElement(bulletInfo);
        const baseWidth = bulletInfo.cld_box[0] * this.scale;
        const baseHeight = bulletInfo.cld_box[1] * this.scale;
        const spawnScreen = this.gameToScreen(startGamePos.x, startGamePos.y);
        Object.assign(element.style, {
            width: `${baseWidth}px`,
            height: `${baseHeight}px`,
            opacity: 0.85,
            zIndex: Math.floor(spawnScreen.depth * 0.1) + 5,
        });
        this.container.appendChild(element);

        this._worldViews.set(unit, { element, bulletInfo, baseWidth, baseHeight });
        this._renderWorldBullet(unit);
        this._ensureWorldLoop();
        return element;
    }

    /**
     * Spawn a bomb into the physics core and build its DOM element. Two modes
     * differ only in how the spawn point is derived; everything from spawnBomb
     * onward (validation, FixRange, InitSpeed) is in BombBulletUnit /
     * world.spawnBomb. The DOM tail is identical for both modes.
     *
     * - 'airdrop' (default for back-compat): airdropData.explodePos drives
     *   SetSpawnPosition. Used by _isAirdropBomb hits.
     * - 'non-airdrop': passes spawnX/spawnY/yAngle through like
     *   _createWorldBullet, plus enemyTarget as the (nullable) explodePos.
     *   Acceleration + barrageAngle + target flow through for curving bombs.
     *   Used by the Phase 5b non-airdrop bomb route.
     *
     * Returns the element, or null if the core rejected the spawn (non-finite
     * input).
     */
    _createWorldBomb(options) {
        const { mode, bulletInfo } = options;
        const ep = bulletInfo.extra_param || {};

        let unit;
        if (mode === 'non-airdrop') {
            const { startX, startY, angle, barrageAngle, enemyTarget } = options;
            const startGamePos = this.screenToGame(startX, startY);
            // spawnAltitude approximates the host weapon's deck altitude. Base
            // BulletUnit defaults to 0, but the absolute-altitude detonation
            // (`altitude <= BOMB_DETONATE_HEIGHT`) trips on tick 1 from altitude
            // 0, so non-airdrop bombs need runway. ep.offsetY (set on some bomb
            // templates as a host-altitude hint) wins; otherwise AIRCRAFT_HEIGHT
            // is the same convention airdrop bombs use.
            unit = this.world.spawnBomb({
                type: bulletInfo.type,
                airdrop: false,
                velocity: bulletInfo.velocity,
                yAngle: angle,
                range: bulletInfo.range,
                rangeOffset: bulletInfo.range_offset || 0,
                spawnX: startGamePos.x,
                spawnY: startGamePos.y,
                spawnAltitude: ep.offsetY ?? AIRCRAFT_HEIGHT,
                gravity: ep.gravity,
                launchVrtSpeed: ep.launchVrtSpeed,
                explodeTime: ep.timeToExplode,
                explodePos: enemyTarget || null,
                acceleration: bulletInfo.acceleration,
                barrageAngle: barrageAngle,
                target: enemyTarget,
            });
        } else {
            // Airdrop path. The acceleration / barrageAngle / target fields
            // are new to this path in Phase 3c — needed for curving airdrop
            // bomb 170838. Plain airdrops have empty acceleration and ignore
            // them via the base priority chain's fallback to doNothing.
            const { airdropData } = options;
            unit = this.world.spawnBomb({
                type: bulletInfo.type,
                velocity: bulletInfo.velocity,
                range: bulletInfo.range,
                rangeOffset: bulletInfo.range_offset || 0,
                gravity: ep.gravity,             // undefined -> BombBulletUnit uses GRAVITY
                offsetY: ep.offsetY,             // undefined -> BombBulletUnit uses AIRCRAFT_HEIGHT
                dropOffset: ep.dropOffset,
                launchVrtSpeed: ep.launchVrtSpeed,
                explodeTime: ep.timeToExplode,
                explodePos: airdropData.explodePos,
                direction: airdropData.direction,
                acceleration: bulletInfo.acceleration,
                barrageAngle: options.barrageAngle,
                target: options.enemyTarget,
            });
        }
        if (!unit) return null;

        const element = this._createBulletElement(bulletInfo);
        const baseWidth = bulletInfo.cld_box[0] * this.scale;
        const baseHeight = bulletInfo.cld_box[1] * this.scale;
        const spawnScreen = this.gameToScreen(unit.position.x, unit.position.y);
        Object.assign(element.style, {
            width: `${baseWidth}px`,
            height: `${baseHeight}px`,
            opacity: 0.85,
            zIndex: Math.floor(spawnScreen.depth * 0.1) + 5,
        });
        this.container.appendChild(element);

        this._worldViews.set(unit, { element, bulletInfo, baseWidth, baseHeight, shadowEl: null });
        this._renderWorldBullet(unit);
        this._ensureWorldLoop();
        return element;
    }

    /**
     * Spawn a weapon-driver (beam type 24 / space-laser type 28) into the physics
     * core and start the shared world loop so it ticks. Registers a view entry so
     * _renderWeaponDrivers draws the driver's geometry each frame (beam lines /
     * space-laser columns). Both types are 0-reached in current data, so this
     * renders nothing in normal use — it completes the deferred Phase 4b renderer.
     * Returns the unit, or null if the core rejected it (unresolved type /
     * non-finite host).
     */
    spawnWeaponDriver(opts) {
        const unit = this.world.spawnWeapon(opts);
        if (!unit) return null;
        this._worldWeaponViews.set(unit, { beamEls: new Map(), columnEls: new Map() });
        this._ensureWorldLoop();
        return unit;
    }

    /**
     * Render every live weapon-driver (beam type 24 / space-laser type 28) from
     * its geometry getters, and cull drivers that have left world.weapons (i.e.
     * finished). Beams: one rotated line per getBeams() entry. Space-laser:
     * one column per getColumns() entry, styled by stage (alert/attack).
     */
    _renderWeaponDrivers() {
        const world = this.world;
        if (!world) return;
        const live = new Set(world.weapons);

        // Cull drivers no longer live.
        for (const [unit, view] of this._worldWeaponViews) {
            if (!live.has(unit)) {
                for (const el of view.beamEls.values()) el.remove();
                for (const el of view.columnEls.values()) el.remove();
                this._worldWeaponViews.delete(unit);
            }
        }

        for (const unit of world.weapons) {
            let view = this._worldWeaponViews.get(unit);
            if (!view) { view = { beamEls: new Map(), columnEls: new Map() }; this._worldWeaponViews.set(unit, view); }

            if (typeof unit.getBeams === 'function') {
                this._renderBeams(unit, view);
            } else if (typeof unit.getColumns === 'function') {
                this._renderColumns(unit, view);
            }
        }
    }

    /** Draw/refresh one line per live beam; remove stale ones. */
    _renderBeams(unit, view) {
        const beams = unit.getBeams();
        const seen = new Set();
        beams.forEach((b, i) => {
            seen.add(i);
            let el = view.beamEls.get(i);
            if (!el) { el = document.createElement('div'); el.className = 'beam-segment'; this.container.appendChild(el); view.beamEls.set(i, el); }
            const s = this.gameToScreen(b.position.x, b.position.y);
            const lengthPx = Math.abs(b.dims.dx) * this.scale * s.scale;
            const widthPx = Math.max(2, Math.abs(b.dims.dy) * this.scale * s.scale);
            el.style.left = `${s.x}px`;
            el.style.top = `${s.y - widthPx / 2}px`;
            el.style.width = `${lengthPx}px`;
            el.style.height = `${widthPx}px`;
            el.style.transform = `rotate(${b.angle}deg)`;
            el.style.transformOrigin = '0 50%';
        });
        for (const [i, el] of view.beamEls) { if (!seen.has(i)) { el.remove(); view.beamEls.delete(i); } }
    }

    /** Draw/refresh one column per live space-laser column; remove stale ones. */
    _renderColumns(unit, view) {
        const cols = unit.getColumns();
        const seen = new Set();
        cols.forEach((c, i) => {
            seen.add(i);
            let el = view.columnEls.get(i);
            if (!el) { el = document.createElement('div'); el.className = 'space-laser-column'; this.container.appendChild(el); view.columnEls.set(i, el); }
            el.classList.toggle('is-alert', c.stage === 'alert');
            el.classList.toggle('is-attack', c.stage === 'attack');
            const s = this.gameToScreen(c.position.x, c.position.y);
            const rPx = Math.max(4, c.cylinder.radius * this.scale * s.scale);
            const tPx = Math.max(4, c.cylinder.thickness * this.scale * s.scale);
            el.style.left = `${s.x - rPx}px`;
            el.style.top = `${s.y - tPx / 2}px`;
            el.style.width = `${rPx * 2}px`;
            el.style.height = `${tPx}px`;
        });
        for (const [i, el] of view.columnEls) { if (!seen.has(i)) { el.remove(); view.columnEls.delete(i); } }
    }

    /**
     * Draw one physics unit to its DOM element. The transform faces the
     * velocity vector unless extra_param.dontRotate. A unit with altitude
     * (a bomb) is lifted up the screen and casts a ground shadow — both
     * inert for a straight bullet, whose altitude never leaves 0. zIndex is
     * fixed at spawn and only refreshed here when perspective is on.
     */
    _renderWorldBullet(unit) {
        const view = this._worldViews.get(unit);
        if (!view) return;

        const screenPos = this.gameToScreen(unit.position.x, unit.position.y);

        // Type-11 gravitation owns the element's geometry via the pulse helper —
        // size, position and borderRadius are all set there. Skip the default
        // rotate/scale render below.
        if (view.bulletInfo.type === 11) {
            this._renderGravitationPulse(unit, view, screenPos);
            return;
        }

        const w = view.baseWidth * screenPos.scale;
        const h = view.baseHeight * screenPos.scale;
        const altitudeOffset = unit.altitude * this.scale;

        view.element.style.left = `${screenPos.x - w / 2}px`;
        view.element.style.top = `${screenPos.y - h / 2 - altitudeOffset}px`;

        if (view.bulletInfo.extra_param?.dontRotate === true) {
            view.element.style.transform = `scale(${screenPos.scale})`;
        } else {
            const visualAngle = Math.atan2(unit.speed.y, unit.speed.x) * 180 / Math.PI;
            view.element.style.transform = `rotate(${visualAngle}deg) scale(${screenPos.scale})`;
        }

        if (this.perspective.enabled) {
            view.element.style.filter = screenPos.blur > 0 ? `blur(${screenPos.blur}px)` : 'none';
            view.element.style.zIndex = Math.floor(screenPos.depth * 0.1) + 5;
        }

        // Ground shadow while a bomb is airborne.
        if (altitudeOffset > 1) {
            if (!view.shadowEl) {
                view.shadowEl = document.createElement('div');
                view.shadowEl.className = 'bullet-shadow';
                this.container.appendChild(view.shadowEl);
            }
            const shadowScale = Math.max(0.3, 1 - unit.altitude * 0.05);
            Object.assign(view.shadowEl.style, {
                left: `${screenPos.x - (w * shadowScale) / 2}px`,
                top: `${screenPos.y - 1}px`,
                width: `${w * shadowScale}px`,
                height: '2px',
                opacity: `${shadowScale * 0.5}`,
            });
        }
    }

    /**
     * Render a gravitation (type-11) bullet's pulsing alert -> active ring.
     * Ported from the deleted _animate "Gravitation bullet rendering" block.
     *
     * The deleted path keyed `elapsed` off `gravitationBehavior.activeStartTime`
     * — the moment its invented FALLING phase ended. There is no FALLING phase
     * in the physics core, so `elapsed` is simply the unit's `timeElapsed`
     * (spawn-relative). Alert phase covers `timeElapsed < alert_duration`;
     * active phase comes after.
     *
     * cld_box[0] is the original size index; the `* 3` multiplier is unchanged.
     */
    _renderGravitationPulse(unit, view, screenPos) {
        const { bulletInfo } = view;
        const alertDuration = bulletInfo.extra_param?.alert_duration ?? 0.1;
        const hitInterval = bulletInfo.hit_type?.interval ?? 0.2;
        const elapsed = unit.timeElapsed;
        const inAlert = elapsed < alertDuration;

        view.element.classList.add('gravitation-bullet');
        if (!inAlert) {
            view.element.classList.add('gravitation-active');
        }

        const baseSize = (bulletInfo.cld_box?.[0] ?? 5) * this.scale * 3;
        const pulsePhase = (elapsed % hitInterval) / hitInterval;
        // Alert phase: scale draws INWARD (1.0 -> 0.6) — visually a vortex
        // gathering / pulling in. The legacy did 0.5 -> 1.0 (outward grow);
        // we reverse direction to match the in-game whirlpool's "drawing
        // things toward the center" feel.
        const pulseScale = inAlert
            ? 1.0 - (elapsed / alertDuration) * 0.4
            : 0.8 + pulsePhase * 0.2;
        const size = baseSize * pulseScale;

        Object.assign(view.element.style, {
            width: `${size}px`,
            height: `${size}px`,
            left: `${screenPos.x - size / 2}px`,
            top: `${screenPos.y - size / 2}px`,
            borderRadius: '50%',
        });
    }

    /**
     * Off-viewport safety cull: a bullet past an edge and still heading further
     * out. The gate ignores the first few ticks (matching the deleted path's
     * framesLived > 3 threshold) so a bullet spawned near an edge is not culled
     * instantly; a plain time threshold is fine for a safety net.
     */
    _isUnitOffScreen(unit, view) {
        if (unit.timeElapsed < 4 * TICK_SECONDS) return false;
        const screenPos = this.gameToScreen(unit.position.x, unit.position.y);
        const w = view.baseWidth * screenPos.scale;
        const h = view.baseHeight * screenPos.scale;
        return (screenPos.x < -w && unit.speed.x <= 0)
            || (screenPos.x > this.container.offsetWidth + w && unit.speed.x >= 0)
            || (screenPos.y < -h && unit.speed.y >= 0)
            || (screenPos.y > this.container.offsetHeight + h && unit.speed.y <= 0);
    }

    /**
     * Render every live physics unit and reap finished ones. A unit the core
     * has culled (reachDestFlag) has its element removed; a unit that has left
     * the viewport is flagged so the core culls it on the next step.
     */
    _renderWorld() {
        for (const [unit, view] of this._worldViews) {
            if (unit.reachDestFlag) {
                view.element.remove();
                if (view.shadowEl) view.shadowEl.remove();
                this._worldViews.delete(unit);
                continue;
            }
            this._renderWorldBullet(unit);
            if (this._isUnitOffScreen(unit, view)) {
                unit.reachDestFlag = true;   // world.step() culls it next tick
            }
        }
        this._renderWeaponDrivers();
    }

    /**
     * Start the shared world loop if it is not already running. One rAF loop
     * drives every live bullet: it converts elapsed real time (scaled by
     * gSpeed playback speed) into whole 1/30 s ticks, steps the core, renders,
     * and stops itself when no live bullets remain (no rAF runs while idle).
     */
    _ensureWorldLoop() {
        if (this._worldLoopId !== null) return;
        this._worldLastTime = performance.now();
        this._worldAccumulatorMs = 0;

        const loop = () => {
            const now = performance.now();
            const realMs = Math.max(now - this._worldLastTime, 0);
            this._worldLastTime = now;

            this._worldAccumulatorMs += realMs * this.gSpeed;
            const { ticks, remainder } = drainAccumulator(this._worldAccumulatorMs);
            this._worldAccumulatorMs = remainder;
            for (let i = 0; i < ticks; i++) this.world.step();

            this._renderWorld();

            // Invariant: _renderWorld (just above) drains every culled unit
            // from _worldViews each frame, so when world.bullets is empty the
            // view map is empty too — the loop can safely stop.
            // A weapon-driver (no view) ticks via world.step() with no bullets
            // present, so keep the loop alive while either list is non-empty.
            if (this.world.bullets.length === 0 && this.world.weapons.length === 0) {
                this._worldLoopId = null;   // idle — stop until the next spawn
                return;
            }
            this._worldLoopId = requestAnimationFrame(loop);
        };
        this._worldLoopId = requestAnimationFrame(loop);
    }

    // ===== Cleanup =====

    clearAllBullets() {
        // Drop every unit, remove its element + shadow, stop the loop.
        this.world.bullets = [];
        this.world.weapons = [];
        for (const view of this._worldViews.values()) {
            view.element.remove();
            if (view.shadowEl) view.shadowEl.remove();
        }
        this._worldViews.clear();
        // Weapon-driver views aren't culled by the loop once it stops, so drop
        // their beam/column elements here too (else orphan DOM survives a clear).
        for (const view of this._worldWeaponViews.values()) {
            for (const el of view.beamEls.values()) el.remove();
            for (const el of view.columnEls.values()) el.remove();
        }
        this._worldWeaponViews.clear();
        if (this._worldLoopId !== null) {
            cancelAnimationFrame(this._worldLoopId);
            this._worldLoopId = null;
        }
    }

    destroy() {
        window.removeEventListener('resize', this._resizeHandler);
        this.clearAllBullets();
    }
}
