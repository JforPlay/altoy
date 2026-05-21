/**
 * sim.engine.bullet.js
 * Low-level bullet engine: coordinate transforms, bullet DOM creation,
 * per-frame physics dispatch, and rendering for all bullet types.
 * Part of the simulators shared engine (common → bullet → bullet.factory + aircraft + oceanbg).
 *
 * Game constants (from BattleConfig):
 *   bulletSpeedConvert = 0.2  (velocity * 0.2 → game units per frame)
 *   bombDetonateHeight = 1.2  (gravity bullets detonate below this altitude)
 */

import { BehaviorFactory } from './sim.engine.bullet.factory.js';
import { World } from './physics/world.js';
import { drainAccumulator } from './physics/accumulator.js';
import { TICK_SECONDS } from './physics/constants.js';

/**
 * Bullet types routed through the faithful physics core (physics/). Cannon (1)
 * and Stray (8) use CannonBulletUnit; Torpedo (3) uses TorpedoBulletUnit. All
 * three support straight and curving movement (doAccelerate / doTrack /
 * doCircle resolved by InitSpeed — Phase 2c). Airdrop bombs route through a
 * separate predicate (_isAirdropBomb). Every other type still runs the legacy
 * BehaviorFactory path until later phases migrate it.
 */
const MIGRATED_BULLET_TYPES = new Set([1, 8, 3]);

// Bullet sprites are keyed by the game's modle_ID. BULLET_SPRITE_BASE is the
// single asset insertion point — set it once sprites are extracted from client
// AssetBundles and placed (bundled under public/ or on an external host).
// While empty, resolveBulletSprite() returns null and bullets use the CSS
// placeholder rendering.
const BULLET_SPRITE_BASE = '';

function resolveBulletSprite(modleId) {
    if (!BULLET_SPRITE_BASE || !modleId || modleId === 'None') return null;
    return `${BULLET_SPRITE_BASE}/${modleId}.webp`;
}

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
        this.gSpeed = options.gSpeed || 1.5;

        // Game formula: velocity * (60/30 * 0.1) = velocity * 0.2
        this.bulletSpeedConvert = 0.2;
        this.bulletHeight = 1;
        this.gravity = -0.05;
        // Gravity bullets detonate when altitude <= this (BattleConfig.BombDetonateHeight)
        this.bombDetonateHeight = 1.2;

        this.allBarrages = {};
        this.allBullets = {};
        this.activeBullets = new Set();

        // --- Faithful physics-core render path (Phase 2: cannon types 1, 8) ---
        // The pure fixed-timestep core (physics/) runs migrated bullet types
        // through one shared loop; the legacy per-bullet rAF path runs
        // everything else. See dev/active/2026-05-17-weapon-physics-rework.md.
        this.world = new World();
        // ShrapnelBulletUnit.drainEmits returns child specs in GAME coords.
        // createBullet's contract is SCREEN coords; convert once here so the
        // engine's existing dispatch (predicates -> _createWorldBullet ->
        // screenToGame, or legacy path -> screen) keeps its interface.
        this.world.onEmit = (spec) => {
            const screen = this.gameToScreen(spec.startX, spec.startY);
            this.createBullet({
                ...spec,
                startX: screen.x,
                startY: screen.y,
            });
        };
        this._worldViews = new Map();   // BulletUnit -> { element, bulletInfo, baseWidth, baseHeight }
        this._worldLoopId = null;       // rAF id of the shared loop, null when idle
        this._worldAccumulatorMs = 0;   // unspent real time carried between frames
        this._worldLastTime = 0;        // performance.now() of the previous loop frame

        this.frameTime = 1000 / this.targetFps;

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
            transformChain = [], shrapnelCallback, parentBullet = null,
            inheritSpeed = null, airdropData = null, weaponPos = null,
            enemyTarget = null, aimType = null, barrageAngle = null
        } = options;

        if (isNaN(startX) || isNaN(startY) || isNaN(angle)) {
            console.error('Invalid bullet position:', { startX, startY, angle });
            return;
        }

        // Route a migrated-type bullet (cannon / stray / torpedo) — straight OR
        // curving (acceleration / tracker / circle) — to the faithful physics
        // core; anything with gravity / missile / shrapnel / a transform chain
        // / inherited speed stays on the legacy path until later phases.
        if (this._isMigratedMovementBullet(bulletInfo, options)) {
            return this._createWorldBullet(options);
        }

        // Route a qualifying airdrop bomb to the faithful physics core — the
        // fix for the overhead-drop bugs: the bomb now falls from above onto
        // its explode point. Curving airdrop bombs (bullet 170838) are
        // included as of Phase 3c (BombBulletUnit.InitSpeed defers to the
        // base priority chain). An airdrop bomb with shrapnel / a transform
        // chain stays on the legacy path.
        if (this._isAirdropBomb(bulletInfo, options)) {
            return this._createWorldBomb({ ...options, mode: 'airdrop' });
        }

        // Route a type-9 effect bullet to the faithful physics core — fixes
        // the lingering red-dot bug. The shared _createWorldBullet handles
        // DOM and rendering; EffectBulletUnit's hit_type.time cap drives
        // expiry alongside the base range check.
        if (this._isMigratedEffect(bulletInfo, options)) {
            return this._createWorldBullet(options);
        }

        // Route a type-5 SHRAPNEL through the faithful physics core. Children
        // emit via the world's onEmit callback (wired in this task's Step 4),
        // which routes each child through createBullet so they too flow through
        // the strangler — a child of a migrated type goes to the core, a child
        // of an unmigrated type goes to the legacy path.
        if (this._isMigratedShrapnel(bulletInfo, options)) {
            return this._createWorldBullet(options);
        }

        // Route a type-11 GRAVITATION through the faithful physics core (spec §D3).
        // Replaces the legacy GravitationBehavior's invented FALLING/ACTIVE
        // position-lock. The bullet now MOVES under base velocity while the
        // type-11 render branch below preserves the pulsing alert->active visual.
        if (this._isMigratedGravitation(bulletInfo, options)) {
            return this._createWorldBullet(options);
        }

        // Phase 3c: non-airdrop bombs (plain, timeToExplode, curving). Mutually
        // exclusive with _isAirdropBomb on extra_param.airdrop, so insertion
        // order vs the other predicates doesn't affect correctness.
        if (this._isNonAirdropBomb(bulletInfo, options)) {
            return this._createWorldBomb({ ...options, mode: 'non-airdrop' });
        }

        // Create bullet DOM element
        const bulletElement = document.createElement('div');
        bulletElement.className = 'bullet';

        // The equip-skin preview tags its bullets with this synthetic modle_ID;
        // a runtime stylesheet in equip-skin.preview.js keys its sprite styling
        // off the matching class.
        if (bulletInfo.modle_ID === 'esv-skin-bullet') {
            bulletElement.classList.add('esv-skin-bullet');
        }

        // A modle_ID sprite takes precedence; otherwise fall back to the
        // type-based CSS placeholder so a bullet is never invisible.
        const spriteUrl = resolveBulletSprite(bulletInfo.modle_ID);
        if (spriteUrl) {
            bulletElement.classList.add('sprite-bullet');
            bulletElement.style.backgroundImage = `url("${spriteUrl}")`;
        } else {
            const typeClass = BULLET_TYPE_CLASSES[bulletInfo.type];
            if (typeClass) bulletElement.classList.add(typeClass);
        }

        const bulletWidth = bulletInfo.cld_box[0] * this.scale;
        const bulletHeight = bulletInfo.cld_box[1] * this.scale;

        const startGamePos = this.screenToGame(startX, startY);
        const initialPos = this.gameToScreen(startGamePos.x, startGamePos.y);

        // Beam bullets: anchored position with sweep angle
        const isBeam = bulletInfo.type === 10;
        if (isBeam) {
            bulletElement.classList.add('beam-bullet');
            const beamLength = (bulletInfo.range || 50) * this.scale;
            const beamHeight = Math.max(bulletInfo.cld_box?.[1] || 2, 2) * this.scale;
            Object.assign(bulletElement.style, {
                width: `${beamLength}px`,
                height: `${beamHeight}px`,
                left: `${startX}px`,
                top: `${startY - beamHeight / 2}px`,
                transformOrigin: '0% 50%',
                transform: `rotate(${angle}deg)`,
                filter: initialPos.blur > 0 ? `blur(${initialPos.blur}px)` : 'none',
                zIndex: Math.floor(initialPos.depth * 0.1) + 5,
                opacity: 0.85
            });
        } else {
            Object.assign(bulletElement.style, {
                width: `${bulletWidth}px`,
                height: `${bulletHeight}px`,
                left: `${startX - bulletWidth / 2}px`,
                top: `${startY - bulletHeight / 2}px`,
                transform: `rotate(${angle}deg) scale(${initialPos.scale})`,
                filter: initialPos.blur > 0 ? `blur(${initialPos.blur}px)` : 'none',
                zIndex: Math.floor(initialPos.depth * 0.1) + 5,
                opacity: 0.85
            });
        }
        this.container.appendChild(bulletElement);

        // Initialize bullet state
        const effectiveVelocity = bulletInfo.velocity + (bulletInfo.extra_param?.torpedoSpeedExtra || 0);
        let currentVelocity_perFrame = effectiveVelocity * this.bulletSpeedConvert;
        if (inheritSpeed !== null && inheritSpeed !== undefined) {
            currentVelocity_perFrame = inheritSpeed;
        }

        const angleInRadians = angle * Math.PI / 180;

        const bullet = {
            x: startGamePos.x,
            y: startGamePos.y,
            spawnX: startGamePos.x,
            spawnY: startGamePos.y,
            velocity: currentVelocity_perFrame,
            angleRad: angleInRadians,
            velocityX: currentVelocity_perFrame * Math.cos(angleInRadians),
            velocityY: currentVelocity_perFrame * Math.sin(angleInRadians),
            bulletInfo: bulletInfo,
            element: bulletElement,
            aimType: aimType,
            barrageAngle: barrageAngle,
            transformChain: transformChain,
            airdropData: airdropData,
            weaponPos: weaponPos,
            enemyTarget: enemyTarget,
            shouldRemove: false,
            framesLived: 0,
            timeElapsed: 0,
            lastFrameTime: performance.now(),

            // Range with randomization: range_offset * (random - 0.5)
            range: bulletInfo.range + (bulletInfo.range_offset || 0) * (Math.random() - 0.5),

            getBehavior: function (name) {
                return this.behaviors.get(name);
            }
        };

        bullet.behaviors = BehaviorFactory.createBehaviors(bullet, this);
        bullet.behaviors.forEach(behavior => behavior.initialize());
        this.activeBullets.add(bullet);

        // Animation loop
        const animate = () => {
            const now = performance.now();
            const deltaTimeMs = now - bullet.lastFrameTime;
            bullet.lastFrameTime = now;

            const safeDeltaTimeMs = Math.max(deltaTimeMs, 1);

            // gSpeed applied as time-scale multiplier
            const deltaMultiplier = (safeDeltaTimeMs / this.frameTime) * this.gSpeed;
            const deltaTimeSec = safeDeltaTimeMs / 1000;

            bullet.framesLived++;
            // Track game-time (not wall-clock): all behavior timing data is in game-seconds
            bullet.timeElapsed += deltaTimeSec * this.gSpeed;

            const frameData = {
                framesLived: bullet.framesLived,
                timeElapsed: bullet.timeElapsed,
                deltaMultiplier: deltaMultiplier,
                deltaTimeSec: deltaTimeSec,
                velocityX: bullet.velocityX,
                velocityY: bullet.velocityY,
                x: bullet.x,
                y: bullet.y,
                apexReached: false,
                altitude: 0,
                distanceFromSpawn: 0
            };

            // Behavior update order matches game engine priority
            const updateOrder = [
                'gravity',
                'airdrop',
                'missile',
                'beam',
                'spaceLaser',
                'gravitation',
                'scale',
                'transform',
                'tracker',
                'orbit',
                'circle',
                'acceleration',
                'movement'
            ];

            for (const behaviorName of updateOrder) {
                const behavior = bullet.behaviors.get(behaviorName);
                if (!behavior) continue;

                const result = behavior.update(frameData);
                if (result) {
                    Object.assign(frameData, result);
                }
            }

            // Apply final velocity and position
            bullet.velocityX = frameData.velocityX;
            bullet.velocityY = frameData.velocityY;
            bullet.x = frameData.x;
            bullet.y = frameData.y;
            bullet.velocity = Math.sqrt(bullet.velocityX ** 2 + bullet.velocityY ** 2);

            // Straight-line distance from spawn for range checks
            const dx = bullet.x - bullet.spawnX;
            const dy = bullet.y - bullet.spawnY;
            bullet.distanceFromSpawn = Math.sqrt(dx * dx + dy * dy);
            frameData.distanceFromSpawn = bullet.distanceFromSpawn;

            // Shrapnel runs after main loop (emission behavior, not movement)
            const shrapnelBehavior = bullet.behaviors.get('shrapnel');
            if (shrapnelBehavior) {
                const shrapnelResult = shrapnelBehavior.update(frameData);
                if (shrapnelResult) {
                    if (shrapnelResult.x !== undefined) bullet.x = shrapnelResult.x;
                    if (shrapnelResult.y !== undefined) bullet.y = shrapnelResult.y;
                    if (shrapnelResult.velocityX !== undefined) bullet.velocityX = shrapnelResult.velocityX;
                    if (shrapnelResult.velocityY !== undefined) bullet.velocityY = shrapnelResult.velocityY;
                }
            }

            // Render bullet
            const screenPos = this.gameToScreen(bullet.x, bullet.y);
            const scaledWidth = bulletWidth * screenPos.scale;
            const scaledHeight = bulletHeight * screenPos.scale;

            // Altitude visual offset (gravity/missile bullets arc above ground plane)
            const altitudeOffset = (frameData.altitude || 0) * this.scale;

            // Beam rendering: anchored position with sweep angle
            const beamBehavior = bullet.behaviors.get('beam');
            if (beamBehavior && beamBehavior.enabled) {
                const beamScreenPos = this.gameToScreen(bullet.x, bullet.y);
                const angleDeg = beamBehavior.currentAngle * 180 / Math.PI;
                bulletElement.style.left = `${beamScreenPos.x}px`;
                bulletElement.style.top = `${beamScreenPos.y - bulletHeight / 2}px`;
                bulletElement.style.transform = `rotate(${angleDeg}deg)`;

                if (bullet.timeElapsed >= beamBehavior.attackTime) {
                    bullet.shouldRemove = true;
                }
            } else if (bulletInfo.extra_param?.dontRotate !== true) {
                const visualAngle = Math.atan2(bullet.velocityY, bullet.velocityX) * 180 / Math.PI;
                bulletElement.style.transform = `rotate(${visualAngle}deg) scale(${screenPos.scale * (frameData.bulletScale || 1)})`;
            } else {
                bulletElement.style.transform = `scale(${screenPos.scale * (frameData.bulletScale || 1)})`;
            }

            if (this.perspective.enabled) {
                bulletElement.style.filter = screenPos.blur > 0 ? `blur(${screenPos.blur}px)` : 'none';
                bulletElement.style.zIndex = Math.floor(screenPos.depth * 0.1) + 5;
            }

            // Skip normal position update for beam (already handled above)
            if (!(beamBehavior && beamBehavior.enabled)) {
                bulletElement.style.left = `${screenPos.x - scaledWidth / 2}px`;
                bulletElement.style.top = `${screenPos.y - scaledHeight / 2 - altitudeOffset}px`;
            }

            // Gravitation bullet rendering: pulsing area effect
            const gravitationBehavior = bullet.behaviors.get('gravitation');
            if (gravitationBehavior?.enabled && gravitationBehavior.state === 'ACTIVE') {
                const elapsed = bullet.timeElapsed - gravitationBehavior.activeStartTime;
                const alertPhase = elapsed < gravitationBehavior.alertDuration;
                const pulsePhase = (elapsed % gravitationBehavior.hitInterval) / gravitationBehavior.hitInterval;

                bulletElement.classList.add('gravitation-bullet');
                if (!alertPhase) {
                    bulletElement.classList.add('gravitation-active');
                }
                const baseSize = (bulletInfo.cld_box?.[0] || 5) * this.scale * 3;
                const pulseScale = alertPhase ? 0.5 + elapsed / gravitationBehavior.alertDuration * 0.5 : 0.8 + pulsePhase * 0.2;
                const size = baseSize * pulseScale;
                Object.assign(bulletElement.style, {
                    width: `${size}px`,
                    height: `${size}px`,
                    left: `${screenPos.x - size / 2}px`,
                    top: `${screenPos.y - size / 2}px`,
                    borderRadius: '50%'
                });
            }

            // Space Laser rendering: vertical column
            const spaceLaserBehavior = bullet.behaviors.get('spaceLaser');
            if (spaceLaserBehavior?.enabled) {
                bulletElement.classList.add('space-laser-bullet');
                const columnWidth = spaceLaserBehavior.columnWidth * this.scale;
                const containerHeight = this.container.offsetHeight;

                if (spaceLaserBehavior.state === 'PRECAST') {
                    bulletElement.classList.add('space-laser-precast');
                    bulletElement.classList.remove('space-laser-active');
                    Object.assign(bulletElement.style, {
                        width: `${columnWidth * 0.3}px`,
                        height: `${containerHeight}px`,
                        left: `${screenPos.x - columnWidth * 0.15}px`,
                        top: '0px',
                        borderRadius: '0'
                    });
                } else if (spaceLaserBehavior.state === 'ATTACK') {
                    bulletElement.classList.remove('space-laser-precast');
                    bulletElement.classList.add('space-laser-active');
                    Object.assign(bulletElement.style, {
                        width: `${columnWidth}px`,
                        height: `${containerHeight}px`,
                        left: `${screenPos.x - columnWidth / 2}px`,
                        top: '0px',
                        borderRadius: '0'
                    });
                }
            }

            // Gravity bullet shadow when airborne (altitude > 1 screen pixel)
            if (altitudeOffset > 1) {
                if (!bullet._shadowEl) {
                    bullet._shadowEl = document.createElement('div');
                    bullet._shadowEl.className = 'bullet-shadow';
                    this.container.appendChild(bullet._shadowEl);
                }
                const shadowScale = Math.max(0.3, 1 - frameData.altitude * 0.05);
                Object.assign(bullet._shadowEl.style, {
                    left: `${screenPos.x - scaledWidth * shadowScale / 2}px`,
                    top: `${screenPos.y - 1}px`,
                    width: `${scaledWidth * shadowScale}px`,
                    height: `${2}px`,
                    opacity: `${shadowScale * 0.5}`
                });
            }

            // Check expiration
            const isLingering = shrapnelBehavior?.isLingering;
            const hasLingeringCapability = shrapnelBehavior &&
                shrapnelBehavior.rangeReached &&
                !shrapnelBehavior.triggered &&
                shrapnelBehavior.lastTimeSec > 0 &&
                shrapnelBehavior.splitShrapnels.length > 0;

            const gravityBehavior = bullet.behaviors.get('gravity');
            const hasGravity = gravityBehavior?.hasGravity;
            const hasGravitation = bullet.behaviors.get('gravitation')?.enabled;
            const hasSpaceLaser = bullet.behaviors.get('spaceLaser')?.enabled;
            let rangeExpired;

            if (hasGravitation || hasSpaceLaser) {
                // Gravitation/SpaceLaser manage their own lifetime
                rangeExpired = false;
            } else if (hasGravity) {
                // Gravity bullets detonate when altitude falls below -bombDetonateHeight
                rangeExpired = !isLingering && !hasLingeringCapability &&
                    bullet.framesLived > 3 && frameData.altitude <= -this.bombDetonateHeight;
            } else {
                rangeExpired = !isLingering && !hasLingeringCapability &&
                    bullet.distanceFromSpawn >= bullet.range;
            }

            const isOutOfBounds = bullet.framesLived > 3 && (
                (screenPos.x < -scaledWidth && bullet.velocityX <= 0) ||
                (screenPos.x > this.container.offsetWidth + scaledWidth && bullet.velocityX >= 0) ||
                (screenPos.y < -scaledHeight && bullet.velocityY >= 0) ||
                (screenPos.y > this.container.offsetHeight + scaledHeight && bullet.velocityY <= 0)
            );

            const shouldExpire = rangeExpired || isOutOfBounds;

            if (bullet.shouldRemove || shouldExpire) {
                if (shrapnelBehavior && !shrapnelBehavior.triggered &&
                    shrapnelBehavior.splitShrapnels.length > 0) {
                    shrapnelBehavior.triggerSplit(frameData);
                }
                bullet.behaviors.forEach(b => b.destroy());
                bulletElement.remove();
                if (bullet._shadowEl) bullet._shadowEl.remove();
                this.activeBullets.delete(bullet);
                return;
            }

            requestAnimationFrame(animate);
        };

        requestAnimationFrame(animate);
        return bulletElement;
    }

    // ===== Physics-Core Render Path =====

    /**
     * True when a bullet's `acceleration` carries no movement data. The field
     * is present on virtually every bullet — overwhelmingly as an inert empty
     * object `{}` — so a plain `!bulletInfo.acceleration` test is always false
     * and would route nothing. A non-empty `acceleration` (tracker, circle,
     * orbit, or u/v values) drives a curving movement the physics core's plain
     * CannonBulletUnit does not reproduce, so such a bullet stays on the legacy
     * path.
     */
    _hasEmptyAcceleration(bulletInfo) {
        const accel = bulletInfo.acceleration;
        if (!accel) return true;
        return Array.isArray(accel)
            ? accel.length === 0
            : Object.keys(accel).length === 0;
    }

    /**
     * True only for a bullet the physics path provably renders correctly: a
     * migrated type (cannon / stray / torpedo) — straight OR curving — with no
     * gravity, missile, shrapnel, airdrop, transform chain or inherited speed.
     * Acceleration data is now welcome (Phase 2c): the core's InitSpeed
     * priority chain resolves it to doAccelerate / doTrack / doCircle. Anything
     * still excluded has no faithful core path and stays on the legacy path —
     * the conservative test keeps the migration regression-free.
     */
    _isMigratedMovementBullet(bulletInfo, options) {
        return MIGRATED_BULLET_TYPES.has(bulletInfo.type)
            && !bulletInfo.extra_param?.gravity
            && !bulletInfo.extra_param?.missile
            && !bulletInfo.extra_param?.shrapnel
            && options.inheritSpeed == null
            && options.airdropData == null
            && (!options.transformChain || options.transformChain.length === 0);
    }

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
     * True for a type-9 EFFECT bullet routed through the faithful physics
     * core. EffectBulletUnit inherits the base movement and adds a lifetime
     * cap from hit_type.time — fixes the lingering red-dot bug (spec §C8 /
     * bug map row 4). Stays predicate-conservative: a type-9 with inherited
     * speed or a transform chain stays on the legacy path.
     */
    _isMigratedEffect(bulletInfo, options) {
        return bulletInfo.type === 9
            && options.inheritSpeed == null
            && (!options.transformChain || options.transformChain.length === 0);
    }

    /**
     * True for a type-5 SHRAPNEL routed through the faithful physics core
     * (spec §C6 / §C7 / §C8). Predicate-conservative — excludes:
     *   - rangeAA  (AA-adjacent, out of scope per parent spec)
     *   - out_bound === 3 (VISION) — covers the 6 reached VISION shrapnel
     *     including the 2 directHit cases (skill_weapon scan, 2026-05-20)
     *   - inheritSpeed and transform chains (legacy carries these)
     */
    _isMigratedShrapnel(bulletInfo, options) {
        return bulletInfo.type === 5
            && !bulletInfo.extra_param?.rangeAA
            && bulletInfo.out_bound !== 3
            && options.inheritSpeed == null
            && (!options.transformChain || options.transformChain.length === 0);
    }

    /**
     * True for a type-11 GRAVITATION bullet routed through the faithful
     * physics core (spec §D3). Predicate-conservative — excludes:
     *   - inheritSpeed and transform chains (legacy carries these)
     *
     * Acceleration is intentionally NOT excluded: all 3 reached gravitation
     * bullets have empty acceleration anyway, and if data drift introduces a
     * curving gravitation, base BulletUnit's InitSpeed priority chain handles
     * it (HasAcceleration -> doAccelerate).
     */
    _isMigratedGravitation(bulletInfo, options) {
        return bulletInfo.type === 11
            && options.inheritSpeed == null
            && (!options.transformChain || options.transformChain.length === 0);
    }

    /**
     * True for a non-airdrop bomb (type 2/16 without extra_param.airdrop)
     * routed through the faithful physics core. Acceleration is welcome —
     * BombBulletUnit.InitSpeed defers to the base priority chain, so
     * doAccelerate fires for curving bombs (gravity is suppressed for those
     * ticks, matching §B3 mutual exclusivity). Predicate-conservative:
     *   - inheritSpeed and transform chains stay on legacy
     *   - shrapnel and missile flags stay on legacy (orthogonal concerns)
     */
    _isNonAirdropBomb(bulletInfo, options) {
        return (bulletInfo.type === 2 || bulletInfo.type === 16)
            && !bulletInfo.extra_param?.airdrop
            && !bulletInfo.extra_param?.shrapnel
            && !bulletInfo.extra_param?.missile
            && options.inheritSpeed == null
            && (!options.transformChain || options.transformChain.length === 0);
    }

    /**
     * Build the DOM element for a physics-core bullet: the base `bullet`
     * class, the skin modle_ID class, and the bullet-type class so a migrated
     * bullet keeps its type styling. Size and position are set by the caller.
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
     * Spawn a migrated-type bullet (straight or curving) into the physics core
     * and build its DOM element. Mirrors the legacy createBullet element setup,
     * so a migrated bullet is visually identical to a legacy one. Receives
     * screen-space coordinates and converts to game space for the core.
     * Returns the element, or null if the core rejected the spawn (non-finite
     * input).
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
     *   Used by _isNonAirdropBomb hits.
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
            unit = this.world.spawnBomb({
                type: bulletInfo.type,
                airdrop: false,
                velocity: bulletInfo.velocity,
                yAngle: angle,
                range: bulletInfo.range,
                rangeOffset: bulletInfo.range_offset || 0,
                spawnX: startGamePos.x,
                spawnY: startGamePos.y,
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
     * Draw one physics unit to its DOM element. The transform mirrors the
     * legacy path's non-beam render: face the velocity vector unless
     * extra_param.dontRotate. A unit with altitude (a bomb) is lifted up the
     * screen and casts a ground shadow — both inert for a straight bullet,
     * whose altitude never leaves 0. zIndex is fixed at spawn and only
     * refreshed here when perspective is on, matching the legacy path.
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

        // Ground shadow while a bomb is airborne (mirrors the legacy path).
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
     * Render a gravitation (type-11) bullet's pulsing alert -> active ring,
     * porting the legacy block at sim.engine.bullet.js _animate (the
     * "Gravitation bullet rendering: pulsing area effect" comment block).
     *
     * The legacy keyed `elapsed` off `gravitationBehavior.activeStartTime` —
     * the moment the legacy's invented FALLING phase ended. In the migrated
     * model there is no FALLING phase, so `elapsed` is simply the unit's
     * `timeElapsed` (spawn-relative). Alert phase covers
     * `timeElapsed < alert_duration`; active phase comes after.
     *
     * cld_box[0] is the legacy's base size index. The `* 3` multiplier
     * matches the legacy block exactly.
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
     * Off-viewport safety cull, mirroring the legacy isOutOfBounds check: a
     * bullet past an edge and still heading further out. The gate ignores the
     * first few ticks (legacy used framesLived > 3) so a bullet spawned near an
     * edge is not culled instantly; the exact tick is immaterial for a safety
     * net, so a plain time threshold is fine.
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
    }

    /**
     * Start the shared world loop if it is not already running. One rAF loop
     * drives every migrated bullet: it converts elapsed real time (scaled by
     * gSpeed playback speed) into whole 1/30 s ticks, steps the core, renders,
     * and stops itself when no migrated bullets remain — matching the legacy
     * path's on-demand model (no rAF runs while the page is idle).
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
            if (this.world.bullets.length === 0) {
                this._worldLoopId = null;   // idle — stop until the next spawn
                return;
            }
            this._worldLoopId = requestAnimationFrame(loop);
        };
        this._worldLoopId = requestAnimationFrame(loop);
    }

    // ===== Cleanup =====

    clearAllBullets() {
        this.activeBullets.forEach(b => { b.shouldRemove = true; });

        // Faithful-core path: drop every unit, remove its element + shadow,
        // stop the loop.
        this.world.bullets = [];
        for (const view of this._worldViews.values()) {
            view.element.remove();
            if (view.shadowEl) view.shadowEl.remove();
        }
        this._worldViews.clear();
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
