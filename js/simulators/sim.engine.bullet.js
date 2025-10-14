// Bullet physics engine for simulating Azur Lane weapon systems
// Refactored with modular behavior system

class BulletEngine {
    constructor(options) {
        this.container = options.container;
        this.gameCoords = options.gameCoords;
        this.targetFps = options.targetFps || 30;
        this.gSpeed = options.gSpeed || 1.5;

        // Config constants from BattleConfig
        this.bulletSpeedConvert = 0.1;
        this.bulletHeight = 1;
        this.heightOffsetRate = 1.5;
        this.gravity = -0.05;

        this.allBarrages = {};
        this.allBullets = {};

        // Perspective settings
        this.perspective = {
            enabled: false,
            minScale: 0.8,
            maxScale: 1.1,
            depthBlur: false
        };

        this.updateScale();
        window.addEventListener('resize', () => this.updateScale());
    }

    setData(allBarrages, allBullets) {
        this.allBarrages = allBarrages;
        this.allBullets = allBullets;
    }

    updateScale() {
        const gameWidth = this.gameCoords.totalArea.maxX - this.gameCoords.totalArea.minX;
        this.scale = this.container.offsetWidth / gameWidth;
    }

    /**
     * Convert game coordinates to screen coordinates
     */
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

    /**
     * Convert screen coordinates back to game coordinates
     */
    screenToGame(screenX, screenY) {
        const gameX = (screenX / this.scale) + this.gameCoords.totalArea.minX;
        const gameY = this.gameCoords.totalArea.maxY - (screenY / this.scale);

        return { x: gameX, y: gameY };
    }

    createBullet(options) {
        const {
            startX, startY, angle, bulletInfo,
            transformChain = [], shrapnelCallback, parentBullet = null,
            inheritSpeed = null, airdropData = null, weaponPos = null,
            enemyTarget = null
        } = options;

        if (isNaN(startX) || isNaN(startY) || isNaN(angle)) {
            console.error('❌ Invalid bullet position:', { startX, startY, angle });
            return;
        }

        // Create bullet DOM element
        const bulletElement = document.createElement('div');
        bulletElement.className = 'bullet';
        if (bulletInfo.modle_ID) bulletElement.classList.add(bulletInfo.modle_ID);

        const bulletWidth = bulletInfo.cld_box[0] * this.scale;
        const bulletHeight = bulletInfo.cld_box[1] * this.scale;

        // Convert positions
        const startGamePos = this.screenToGame(startX, startY);
        const initialPos = this.gameToScreen(startGamePos.x, startGamePos.y);

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
        this.container.appendChild(bulletElement);

        // Initialize bullet state
        let currentVelocity_perFrame = bulletInfo.velocity * this.gSpeed * this.bulletSpeedConvert;
        if (inheritSpeed !== null && inheritSpeed !== undefined) {
            currentVelocity_perFrame = inheritSpeed;
        }

        const angleInRadians = angle * Math.PI / 180;

        const bullet = {
            // Position
            x: startGamePos.x,
            y: startGamePos.y,

            // Velocity
            velocity: currentVelocity_perFrame,
            angleRad: angleInRadians,
            velocityX: currentVelocity_perFrame * Math.cos(angleInRadians),
            velocityY: currentVelocity_perFrame * Math.sin(angleInRadians),

            // References
            bulletInfo: bulletInfo,
            element: bulletElement,
            transformChain: transformChain,
            airdropData: airdropData,
            weaponPos: weaponPos,
            enemyTarget: enemyTarget,

            // State
            shouldRemove: false,
            framesLived: 0,
            distanceTraveled: 0,

            // Lifecycle
            range: bulletInfo.range + (Math.random() * 2 - 1) * (bulletInfo.range_offset || 0),
            lifetime_frames: (() => {
                const baseLifetime = (bulletInfo.range / currentVelocity_perFrame);
                const lingerTime = bulletInfo.extra_param?.lastTime || 0;
                // Total lifetime = time to reach range + lingering time + buffer
                return (baseLifetime + lingerTime + 1) * this.targetFps;
            })(),

            // Helper
            getBehavior: function (name) {
                return this.behaviors.get(name);
            }
        };

        // Create and initialize behaviors
        bullet.behaviors = BehaviorFactory.createBehaviors(bullet, this);
        bullet.behaviors.forEach(behavior => behavior.initialize());

        // Animation loop
        const animate = () => {
            bullet.framesLived++;

            // Frame data passed to all behaviors
            const frameData = {
                framesLived: bullet.framesLived,
                velocityX: bullet.velocityX,
                velocityY: bullet.velocityY,
                x: bullet.x,
                y: bullet.y,
                apexReached: false,
                altitude: 0,
                distanceTraveled: bullet.distanceTraveled  // ADD THIS!
            };

            // Update behaviors in order (priority matters!)
            const updateOrder = [
                'gravity',
                'airdrop',
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

            // Update distance traveled
            const distanceMoved = bullet.velocity;
            bullet.distanceTraveled += distanceMoved;
            frameData.distanceTraveled = bullet.distanceTraveled;

            // Update emission behaviors (shrapnel, transform)
            const shrapnelBehavior = bullet.behaviors.get('shrapnel');
            if (shrapnelBehavior) {
                const shrapnelResult = shrapnelBehavior.update(frameData);
                if (shrapnelResult) {
                    // Apply any position/velocity overrides from lingering
                    if (shrapnelResult.x !== undefined) bullet.x = shrapnelResult.x;
                    if (shrapnelResult.y !== undefined) bullet.y = shrapnelResult.y;
                    if (shrapnelResult.velocityX !== undefined) bullet.velocityX = shrapnelResult.velocityX;
                    if (shrapnelResult.velocityY !== undefined) bullet.velocityY = shrapnelResult.velocityY;
                }
            }

            const transformBehavior = bullet.behaviors.get('transform');
            if (transformBehavior) {
                transformBehavior.update(frameData);
            }

            // === RENDER BULLET ===
            const screenPos = this.gameToScreen(bullet.x, bullet.y);
            const scaledWidth = bulletWidth * screenPos.scale;
            const scaledHeight = bulletHeight * screenPos.scale;

            // Update rotation to match velocity
            if (bulletInfo.extra_param?.dontRotate !== true) {
                const visualAngle = Math.atan2(bullet.velocityY, bullet.velocityX) * 180 / Math.PI;
                bulletElement.style.transform = `rotate(${visualAngle}deg) scale(${screenPos.scale})`;
            } else {
                bulletElement.style.transform = `scale(${screenPos.scale})`;
            }

            // Apply depth effects
            if (this.perspective.enabled) {
                bulletElement.style.filter = screenPos.blur > 0 ? `blur(${screenPos.blur}px)` : 'none';
                bulletElement.style.zIndex = Math.floor(screenPos.depth * 0.1) + 5;
            }

            // Position bullet
            bulletElement.style.left = `${screenPos.x - scaledWidth / 2}px`;
            bulletElement.style.top = `${screenPos.y - scaledHeight / 2}px`;

        // === CHECK EXPIRATION ===
        
        // Check if shrapnel behavior is currently lingering OR has lingering capability
        const isLingering = shrapnelBehavior?.isLingering;
        
        const hasLingeringCapability = shrapnelBehavior && 
            shrapnelBehavior.rangeReached && 
            !shrapnelBehavior.triggered && 
            shrapnelBehavior.lastTimeFrames > 0 &&
            shrapnelBehavior.splitShrapnels.length > 0;
        
        // Don't expire due to lifetime OR range if we're lingering or have lingering capability
        const lifetimeExpired = !isLingering && !hasLingeringCapability &&
            bullet.lifetime_frames > 0 && 
            bullet.framesLived >= bullet.lifetime_frames;
        
        const rangeExpired = !isLingering && !hasLingeringCapability && 
            frameData.distanceTraveled >= bullet.range;

        const isOutOfBounds = bullet.framesLived > 3 && (
            (screenPos.x < -scaledWidth && bullet.velocityX <= 0) ||
            (screenPos.x > this.container.offsetWidth + scaledWidth && bullet.velocityX >= 0) ||
            (screenPos.y < -scaledHeight && bullet.velocityY <= 0) ||
            (screenPos.y > this.container.offsetHeight + scaledHeight && bullet.velocityY >= 0)
        );

        let shouldExpire = false;

        if ((bulletInfo.pierce_count || 0) > 1) {
            if (rangeExpired || isOutOfBounds) {
                shouldExpire = true;
            }
        } else {
            if (lifetimeExpired || rangeExpired || isOutOfBounds) {
                shouldExpire = true;
            }
        }

        if (bullet.shouldRemove || shouldExpire) {
            // Trigger final shrapnel if not already triggered
            if (shrapnelBehavior && !shrapnelBehavior.triggered && 
                shrapnelBehavior.splitShrapnels.length > 0) {
                console.log('🗑️ Expiring bullet, triggering final shrapnel split');
                shrapnelBehavior.triggerSplit(frameData);
            }

            // Cleanup
            bullet.behaviors.forEach(b => b.destroy());
            bulletElement.remove();
            return;
        }

        requestAnimationFrame(animate);
    };

        requestAnimationFrame(animate);
        return bulletElement;
    }
}