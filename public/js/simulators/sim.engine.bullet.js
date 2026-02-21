import { BehaviorFactory } from './sim.engine.bullet.factory.js';

export class BulletEngine {
    constructor(options) {
        this.container = options.container;
        this.gameCoords = options.gameCoords;
        this.targetFps = options.targetFps || 30;
        this.gSpeed = options.gSpeed || 1.5;

        // Config constants from BattleConfig
        this.bulletSpeedConvert = 0.12; // manually changed to make it feel similar to in-game
        this.bulletHeight = 1;
        this.heightOffsetRate = 1.5;
        this.gravity = -0.05;

        this.allBarrages = {};
        this.allBullets = {};

        // NEW: Time tracking for entire engine
        this.frameTime = 1000 / this.targetFps; // Target time per frame in ms
        this.frameTimeSec = 1 / this.targetFps; // Target time per frame in seconds

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

    createBullet(options) {
        const {
            startX, startY, angle, bulletInfo,
            transformChain = [], shrapnelCallback, parentBullet = null,
            inheritSpeed = null, airdropData = null, weaponPos = null,
            enemyTarget = null, aimType = null
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
            x: startGamePos.x,
            y: startGamePos.y,
            velocity: currentVelocity_perFrame,
            angleRad: angleInRadians,
            velocityX: currentVelocity_perFrame * Math.cos(angleInRadians),
            velocityY: currentVelocity_perFrame * Math.sin(angleInRadians),
            bulletInfo: bulletInfo,
            element: bulletElement,
            aimType: aimType,
            transformChain: transformChain,
            airdropData: airdropData,
            weaponPos: weaponPos,
            enemyTarget: enemyTarget,
            shouldRemove: false,
            framesLived: 0,
            distanceTraveled: 0,

            // **NEW: Time tracking**
            timeElapsed: 0, // Total time in seconds
            lastFrameTime: performance.now(), // Timestamp of last frame

            range: bulletInfo.range + (Math.random() * 2 - 1) * (bulletInfo.range_offset || 0),
            // **MODIFIED: Calculate lifetime in seconds instead of frames**
            lifetime_seconds: (() => {
                const baseLifetime = (bulletInfo.range / currentVelocity_perFrame) / this.targetFps;
                const lingerTime = bulletInfo.extra_param?.lastTime || 0;
                return baseLifetime + lingerTime + (1 / this.targetFps);
            })(),

            getBehavior: function (name) {
                return this.behaviors.get(name);
            }
        };

        bullet.behaviors = BehaviorFactory.createBehaviors(bullet, this);
        bullet.behaviors.forEach(behavior => behavior.initialize());

        // Animation loop with delta time
        const animate = () => {
            const now = performance.now();
            const deltaTimeMs = now - bullet.lastFrameTime;
            bullet.lastFrameTime = now;

            // **FIX: Prevent zero/negative delta on first frame or tab switching**
            const safeDeltaTimeMs = Math.max(deltaTimeMs, 1);

            // Calculate delta multiplier (normalizes to target FPS)
            const deltaMultiplier = safeDeltaTimeMs / this.frameTime;
            const deltaTimeSec = safeDeltaTimeMs / 1000;

            // Update counters
            bullet.framesLived++;
            bullet.timeElapsed += deltaTimeSec;

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
                distanceTraveled: bullet.distanceTraveled
            };

            // Update behaviors in order
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

            // Update distance traveled (time-normalized)
            const distanceMoved = bullet.velocity * deltaMultiplier;
            bullet.distanceTraveled += distanceMoved;
            frameData.distanceTraveled = bullet.distanceTraveled;

            // Update emission behaviors
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

            const transformBehavior = bullet.behaviors.get('transform');
            if (transformBehavior) {
                transformBehavior.update(frameData);
            }

            // Render bullet
            const screenPos = this.gameToScreen(bullet.x, bullet.y);
            const scaledWidth = bulletWidth * screenPos.scale;
            const scaledHeight = bulletHeight * screenPos.scale;

            if (bulletInfo.extra_param?.dontRotate !== true) {
                let visualAngle;
                if (bullet.aimType === 1 && bullet.enemyTarget) {
                    const dy = bullet.enemyTarget.y - bullet.y;
                    const dx = bullet.enemyTarget.x - bullet.x;
                    visualAngle = Math.atan2(dy, dx) * 180 / Math.PI;
                } else {
                    visualAngle = Math.atan2(bullet.velocityY, bullet.velocityX) * 180 / Math.PI;
                }
                bulletElement.style.transform = `rotate(${visualAngle}deg) scale(${screenPos.scale})`;
            } else {
                bulletElement.style.transform = `scale(${screenPos.scale})`;
            }

            if (this.perspective.enabled) {
                bulletElement.style.filter = screenPos.blur > 0 ? `blur(${screenPos.blur}px)` : 'none';
                bulletElement.style.zIndex = Math.floor(screenPos.depth * 0.1) + 5;
            }

            bulletElement.style.left = `${screenPos.x - scaledWidth / 2}px`;
            bulletElement.style.top = `${screenPos.y - scaledHeight / 2}px`;

            // Check expiration (TIME-BASED)
            const isLingering = shrapnelBehavior?.isLingering;
            const hasLingeringCapability = shrapnelBehavior &&
                shrapnelBehavior.rangeReached &&
                !shrapnelBehavior.triggered &&
                shrapnelBehavior.lastTimeSec > 0 &&
                shrapnelBehavior.splitShrapnels.length > 0;

            // **MODIFIED: Use time-based expiration**
            const lifetimeExpired = !isLingering && !hasLingeringCapability &&
                bullet.lifetime_seconds > 0 &&
                bullet.timeElapsed >= bullet.lifetime_seconds;

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
                if (rangeExpired || isOutOfBounds) shouldExpire = true;
            } else {
                if (lifetimeExpired || rangeExpired || isOutOfBounds) shouldExpire = true;
            }

            if (bullet.shouldRemove || shouldExpire) {
                if (shrapnelBehavior && !shrapnelBehavior.triggered &&
                    shrapnelBehavior.splitShrapnels.length > 0) {
                    shrapnelBehavior.triggerSplit(frameData);
                }
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