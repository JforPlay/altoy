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

        // Create bullet DOM element
        const bulletElement = document.createElement('div');
        bulletElement.className = 'bullet';
        if (bulletInfo.modle_ID) bulletElement.classList.add(bulletInfo.modle_ID);

        const bulletTypeClasses = {
            2: 'bomb-bullet',
            3: 'torpedo-bullet',
            4: 'shrapnel-bullet',
            5: 'missile-bullet',
            14: 'space-laser-bullet',
            15: 'scale-bullet',
        };
        const typeClass = bulletTypeClasses[bulletInfo.type];
        if (typeClass) bulletElement.classList.add(typeClass);

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

    // ===== Cleanup =====

    clearAllBullets() {
        this.activeBullets.forEach(b => { b.shouldRemove = true; });
    }

    destroy() {
        window.removeEventListener('resize', this._resizeHandler);
        this.clearAllBullets();
    }
}
