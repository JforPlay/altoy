/**
 * Bullet Behavior System
 * Modular components for different bullet types
 */

class BulletBehavior {
    constructor(bullet, engine) {
        this.bullet = bullet;
        this.engine = engine;
    }

    initialize() { }
    update(frameData) { }
    destroy() { }
}

// === MOVEMENT BEHAVIORS ===

class StandardMovementBehavior extends BulletBehavior {
    initialize() {
        // No need to store velocity here
    }

    update(frameData) {
        // Update position based on current velocity in frameData
        const newX = frameData.x + frameData.velocityX;
        const newY = frameData.y + frameData.velocityY;

        return {
            x: newX,
            y: newY,
            // velocityX: frameData.velocityX,
            // velocityY: frameData.velocityY
        };
    }
}

class AccelerationBehavior extends BulletBehavior {
    initialize() {
        const bulletInfo = this.bullet.bulletInfo;
        this.currentAccel = 0;
        this.currentCrossAccel = 0;
        this.schedule = [];

        if (Array.isArray(bulletInfo.acceleration)) {
            bulletInfo.acceleration.forEach(event => {
                this.schedule.push({
                    frame: event.t * this.engine.targetFps,
                    u: (event.u || 0) * this.engine.gSpeed,
                    v: (event.v || 0) * this.engine.gSpeed,
                    flip: event.flip || false
                });
            });
            this.schedule.sort((a, b) => a.frame - b.frame);

            if (this.schedule.length > 0) {
                this.currentAccel = this.schedule[0].u;
                this.currentCrossAccel = this.schedule[0].v;
            }
        }
    }

    update(frameData) {
        // Update schedule
        for (const event of this.schedule) {
            if (frameData.framesLived >= event.frame) {
                this.currentAccel = event.u;
                this.currentCrossAccel = event.v;
            }
        }

        if (this.currentAccel === 0 && this.currentCrossAccel === 0) return;

        const speed = Math.sqrt(
            frameData.velocityX ** 2 + frameData.velocityY ** 2
        );

        if (this.currentAccel < 0 && speed + this.currentAccel < 0) {
            this.schedule.forEach(e => e.u *= -1);
            this.currentAccel *= -1;
        }

        let normalX = 0, normalY = 0;
        if (speed > 0) {
            normalX = frameData.velocityX / speed;
            normalY = frameData.velocityY / speed;
        }

        const crossX = -normalY;
        const crossY = normalX;

        const newVelX = frameData.velocityX + normalX * this.currentAccel + crossX * this.currentCrossAccel;
        const newVelY = frameData.velocityY + normalY * this.currentAccel + crossY * this.currentCrossAccel;

        return { velocityX: newVelX, velocityY: newVelY };
    }
}

class TrackerBehavior extends BulletBehavior {
    initialize() {
        const bulletInfo = this.bullet.bulletInfo;

        // Handle both array and object format for acceleration
        let trackerData = null;

        if (Array.isArray(bulletInfo.acceleration)) {
            trackerData = bulletInfo.acceleration.find(a => a.tracker);
        } else if (bulletInfo.acceleration && bulletInfo.acceleration.tracker) {
            trackerData = bulletInfo.acceleration;
        }

        if (!trackerData || !trackerData.tracker) {
            // console.warn('⚠️ No tracker data found');
            this.enabled = false;
            return;
        }

        if (!this.bullet.enemyTarget) {
            // console.warn('⚠️ No enemy target set for tracker bullet');
            this.enabled = false;
            return;
        }

        this.enabled = true;
        this.trackRange = trackerData.tracker.range || 50;
        this.angularSpeed = (trackerData.tracker.angular || 3) * Math.PI / 180;
        this.target = this.bullet.enemyTarget;
        this.isTracking = false; // Start as not tracking
    }

    update(frameData) {
        if (!this.enabled || !this.target) return;

        const dx = this.target.x - frameData.x;
        const dy = this.target.y - frameData.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Check if we're in range
        const inRange = distance <= this.trackRange;

        if (inRange) {
            if (!this.isTracking) {
                // debug log when tracking starts
                // console.log('🎯 Tracker ACTIVATED! Bullet entered range:', distance.toFixed(2));
                this.isTracking = true;
            }

            // Calculate tracking
            const targetAngle = Math.atan2(dy, dx);
            const currentAngle = Math.atan2(frameData.velocityY, frameData.velocityX);

            let angleDiff = targetAngle - currentAngle;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

            const turnAmount = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), this.angularSpeed);
            const newAngle = currentAngle + turnAmount;
            const speed = Math.sqrt(frameData.velocityX ** 2 + frameData.velocityY ** 2);

            return {
                velocityX: speed * Math.cos(newAngle),
                velocityY: speed * Math.sin(newAngle)
            };
        } else {
            // Out of range - continue straight
            if (this.isTracking) {
                console.log('⚠️ Tracker lost target (out of range):', distance.toFixed(2));
                this.isTracking = false;
            }
            // Return nothing = keep current velocity (continue straight)
            return;
        }
    }
}

class OrbitBehavior extends BulletBehavior {
    initialize() {
        const orbitData = this.bullet.bulletInfo.acceleration?.find(a => a.orbit);
        if (!orbitData || !this.bullet.weaponPos) return;

        this.center = this.engine.bulletEngine.screenToGame(
            this.bullet.weaponPos.x,
            this.bullet.weaponPos.y
        );
    }

    update(frameData) {
        if (!this.center) return;

        const dx = this.bullet.x - this.center.x;
        const dy = this.bullet.y - this.center.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 0.1) return;

        const tangentX = -dy / distance;
        const tangentY = dx / distance;
        const speed = Math.sqrt(frameData.velocityX ** 2 + frameData.velocityY ** 2);

        return {
            velocityX: tangentX * speed,
            velocityY: tangentY * speed
        };
    }
}

class CircleBehavior extends BulletBehavior {
    initialize() {
        const circleData = this.bullet.bulletInfo.acceleration?.find(a => a.circle);
        if (!circleData) return;

        this.center = circleData.circle.center || { x: this.bullet.x, y: this.bullet.y };
        this.centripetalSpeed = (circleData.circle.centripetalSpeed || 0) * this.engine.gSpeed;
        this.antiClockwise = circleData.circle.antiClockWise || false;
    }

    update(frameData) {
        if (!this.center) return;

        const dx = this.bullet.x - this.center.x;
        const dy = this.bullet.y - this.center.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 0.1) return;

        const speed = Math.sqrt(frameData.velocityX ** 2 + frameData.velocityY ** 2);
        const rotationAngle = (speed / distance) * (this.antiClockwise ? 1 : -1);
        const cos_a = Math.cos(rotationAngle);
        const sin_a = Math.sin(rotationAngle);

        return {
            velocityX: frameData.velocityX * cos_a - frameData.velocityY * sin_a,
            velocityY: frameData.velocityX * sin_a + frameData.velocityY * cos_a
        };
    }
}

// === VERTICAL BEHAVIORS ===

class GravityBehavior extends BulletBehavior {
    initialize() {
        const bulletInfo = this.bullet.bulletInfo;
        this.hasGravity = bulletInfo.extra_param?.gravity && bulletInfo.extra_param.gravity !== 0;
        if (!this.hasGravity) return;

        this.gravity = bulletInfo.extra_param.gravity * this.engine.gSpeed;
        this.verticalSpeed = 0;
        this.previousVerticalSpeed = 0;
        this.altitude = 0;
    }

    update(frameData) {
        if (!this.hasGravity) return;

        this.previousVerticalSpeed = this.verticalSpeed;
        this.verticalSpeed += this.gravity;
        this.altitude += this.verticalSpeed;

        return {
            altitude: this.altitude,
            apexReached: this.verticalSpeed !== 0 && this.previousVerticalSpeed * this.verticalSpeed < 0
        };
    }
}

class AirdropBehavior extends BulletBehavior {
    initialize() {
        if (!this.bullet.airdropData) return;

        const horizontalDistance = Math.abs(this.bullet.airdropData.explodePos.x - this.bullet.x);
        const verticalDistance = this.bullet.airdropData.explodePos.y - 0;
        const timeToTarget = horizontalDistance / this.bullet.velocity;

        // Get gravity from GravityBehavior if it exists
        const gravityBehavior = this.bullet.getBehavior('gravity');
        const gravity = gravityBehavior ? gravityBehavior.gravity : 0;

        this.verticalSpeed = (verticalDistance - 0.5 * gravity * timeToTarget ** 2) / timeToTarget;
    }

    update(frameData) {
        if (!this.bullet.airdropData) return;
        return { verticalSpeed: this.verticalSpeed };
    }
}

// === EMISSION BEHAVIORS ===

class ShrapnelBehavior extends BulletBehavior {
    initialize() {
        const bulletInfo = this.bullet.bulletInfo;
        this.hasShrapnel = bulletInfo.extra_param?.shrapnel;
        if (!this.hasShrapnel) return;

        this.triggered = false;
        this.fragile = bulletInfo.extra_param?.fragile;
        this.childEmitters = [];

        // Lingering effect setup
        this.lastTime = bulletInfo.extra_param?.lastTime || 0;
        this.lastTimeFrames = this.lastTime * this.engine.targetFps;
        this.lingeringStartFrame = -1;
        this.isLingering = false;
        this.lingerPosition = null;
        this.rangeReached = false;

        // Store the original range
        this.originalRange = bulletInfo.range || 50;

        // Separate trailing and split shrapnel
        this.trailingShrapnels = [];
        this.splitShrapnels = [];

        for (const key in bulletInfo.extra_param.shrapnel) {
            const shrapnelInfo = bulletInfo.extra_param.shrapnel[key];
            if (!shrapnelInfo || shrapnelInfo === '' || key === 'FXID') continue;

            const barrage = this.engine.allBarrages[shrapnelInfo.barrage_ID];
            const bullet = this.engine.allBullets[shrapnelInfo.bullet_ID];
            if (!barrage || !bullet) continue;

            if (shrapnelInfo.initialSplit) {
                this.trailingShrapnels.push({
                    shrapnelInfo,
                    barrage,
                    bullet,
                    shotsFired: 0,
                    totalShots: (barrage.primal_repeat || 0) + 1,
                    nextShotTime: (barrage.first_delay || 0) * this.engine.targetFps,
                    currentInterval: (barrage.delay || 0) * this.engine.targetFps,
                    delta_interval: (barrage.delta_delay || 0) * this.engine.targetFps
                });
            } else {
                this.splitShrapnels.push({ shrapnelInfo, barrage, bullet });
            }
        }

        // Debug shrapnel setup
        // console.log('🎯 Shrapnel initialized:', {
        //     bulletId: bulletInfo.id,
        //     hasLastTime: this.lastTime > 0,
        //     lastTime: this.lastTime + 's',
        //     lastTimeFrames: this.lastTimeFrames,
        //     originalRange: this.originalRange,
        //     splitCount: this.splitShrapnels.length,
        //     trailingCount: this.trailingShrapnels.length
        // });
    }

    update(frameData) {
        // DEBUG: Log every frame to see what's happening
        // if (frameData.framesLived % 5 === 0) {
        //     console.log('📊 Shrapnel update:', {
        //         frame: frameData.framesLived,
        //         distanceTraveled: frameData.distanceTraveled?.toFixed(2),
        //         originalRange: this.originalRange,
        //         rangeReached: this.rangeReached,
        //         isLingering: this.isLingering,
        //         triggered: this.triggered
        //     });
        // }

        // If already lingering, keep bullet fixed at linger position
        if (this.isLingering) {
            const lingeringDuration = frameData.framesLived - this.lingeringStartFrame;

            if (lingeringDuration < this.lastTimeFrames) {
                // Still lingering - keep bullet stationary
                return {
                    velocityX: 0,
                    velocityY: 0,
                    x: this.lingerPosition.x,
                    y: this.lingerPosition.y
                };
            } else {
                this.triggerSplit(frameData);
                this.bullet.shouldRemove = true;
                return;
            }
        }

        // Handle trailing shrapnel (only when not lingering)
        this.trailingShrapnels.forEach(shrapnel => {
            while (shrapnel.shotsFired < shrapnel.totalShots &&
                frameData.framesLived >= shrapnel.nextShotTime) {
                this._emitShrapnel(shrapnel, frameData, shrapnel.shotsFired);

                shrapnel.shotsFired++;
                let interval = shrapnel.currentInterval;
                if (interval <= 0) interval = 1;
                shrapnel.nextShotTime += interval;
                shrapnel.currentInterval += shrapnel.delta_interval;
            }
        });

        // Check if bullet reached its range limit
        if (!this.rangeReached && !this.triggered) {
            if (frameData.distanceTraveled >= this.originalRange) {      
                this.rangeReached = true;

                // If we have lastTime, start lingering at this position
                if (this.lastTimeFrames > 0 && this.splitShrapnels.length > 0) {
                    this._startLingering(frameData);
                    // Return fixed position to stop movement
                    return {
                        velocityX: 0,
                        velocityY: 0,
                        x: frameData.x,
                        y: frameData.y
                    };
                } else {
                    this.triggerSplit(frameData);
                    this.bullet.shouldRemove = true;
                    return;
                }
            }
        }

        // Normal bullet movement continues
        return undefined;
    }

    _startLingering(frameData) {
        // console.log('🕐 Starting lingering effect:', {
        //     frame: frameData.framesLived,
        //     duration: this.lastTimeFrames + ' frames',
        //     willSplitAt: frameData.framesLived + this.lastTimeFrames,
        //     position: { x: frameData.x.toFixed(2), y: frameData.y.toFixed(2) }
        // });

        this.isLingering = true;
        this.lingeringStartFrame = frameData.framesLived;
        this.lingerPosition = { x: frameData.x, y: frameData.y };

        // Add visual effect to lingering bullet
        if (this.bullet.element) {
            this.bullet.element.style.opacity = '0.7';
            this.bullet.element.style.filter = 'brightness(1.5) drop-shadow(0 0 10px rgba(255,200,100,0.9))';
        }
    }

    triggerSplit(frameData) {
        // // DEBUG: Add stack trace to see WHO is calling this
        // console.log('💥 Triggering shrapnel split at:', {
        //     frame: frameData.framesLived,
        //     position: this.lingerPosition || { x: frameData.x.toFixed(2), y: frameData.y.toFixed(2) },
        //     wasLingering: this.isLingering,
        //     stack: new Error().stack
        // });

        // Reset lingering visual effects
        if (this.bullet.element) {
            this.bullet.element.style.opacity = '0';
            this.bullet.element.style.filter = 'none';
        }

        if (this.fragile === 1) {
            this.triggered = true;
            return;
        } else if (this.fragile === 2) {
            this.bullet.shouldRemove = true;
            return;
        }

        this.triggered = true;

        this.splitShrapnels.forEach(({ shrapnelInfo, barrage, bullet }) => {
            const primalRepeatCount = (barrage.primal_repeat || 0) + 1;
            for (let i = 0; i < primalRepeatCount; i++) {
                this._emitShrapnel({ shrapnelInfo, barrage, bullet }, frameData, i);
            }
        });
    }

    _emitShrapnel(shrapnel, frameData, index) {
        const { shrapnelInfo, barrage, bullet } = shrapnel;

        let bulletAngleModifier;
        const primalRepeatCount = (barrage.primal_repeat || 0) + 1;

        if (barrage.random_angle) {
            const maxSpread = (barrage.delta_angle || 0) * primalRepeatCount / 2;
            bulletAngleModifier = (Math.random() - 0.5) * 2 * maxSpread;
        } else {
            bulletAngleModifier = index * (barrage.delta_angle || 0);
        }

        // Determine base angle based on reaim setting
        let baseAngle = 0;
        if (shrapnelInfo.reaim) {
            // reaim = true: aim towards enemy
            if (this.bullet.enemyTarget) {
                const finalX = this.lingerPosition ? this.lingerPosition.x : frameData.x;
                const finalY = this.lingerPosition ? this.lingerPosition.y : frameData.y;
                const dx = this.bullet.enemyTarget.x - finalX;
                const dy = this.bullet.enemyTarget.y - finalY;
                baseAngle = Math.atan2(dy, dx) * 180 / Math.PI;
            }
        } else if (shrapnelInfo.inheritAngle) {
            // inheritAngle = true: inherit parent's direction
            baseAngle = Math.atan2(frameData.velocityY, frameData.velocityX) * 180 / Math.PI;
        } else {
            // nothing, then shoot forward (0°)
            baseAngle = 0;
        }

        const finalAngle = baseAngle + (barrage.angle || 0) + bulletAngleModifier + (shrapnelInfo.rotateOffset || 0);

        // Use linger position if available, otherwise current position
        const finalX = this.lingerPosition ? this.lingerPosition.x : frameData.x;
        const finalY = this.lingerPosition ? this.lingerPosition.y : frameData.y;

        const screenPos = this.engine.gameToScreen(finalX, finalY);

        this.engine.createBullet({
            startX: screenPos.x,
            startY: screenPos.y,
            angle: finalAngle,
            bulletInfo: bullet,
            transformChain: [],
            parentBullet: this.bullet.element,
            inheritSpeed: shrapnelInfo.inheritSpeed ? this.bullet.velocity : null,
            enemyTarget: this.bullet.enemyTarget
        });
    }

    destroy() {
        this.childEmitters.forEach(child => {
            if (child && child.remove) child.remove();
        });
    }
}

class TransformBehavior extends BulletBehavior {
    initialize() {
        this.timers = [];

        if (!this.bullet.transformChain || this.bullet.transformChain.length === 0) return;

        this.bullet.transformChain.forEach(transformData => {
            this.timers.push({
                triggerFrame: transformData.transStartDelay * this.engine.targetFps,
                data: transformData,
                triggered: false
            });
        });
        this.timers.sort((a, b) => a.triggerFrame - b.triggerFrame);
    }

    update(frameData) {
        this.timers.forEach(timer => {
            if (!timer.triggered && frameData.framesLived >= timer.triggerFrame) {
                timer.triggered = true;
                this._executeTransform(timer.data, frameData);
            }
        });
    }

    _executeTransform(transformData, frameData) {
        // Transform logic (simplified - expand as needed)
        const transBarrage = transformData.barrage;
        const transBullet = this.bullet.bulletInfo; // or from barrage.bullet_ID

        const primalRepeatCount = (transBarrage.primal_repeat || 0) + 1;
        for (let i = 0; i < primalRepeatCount; i++) {
            const finalAngle = transformData.transAimAngle || 0;
            const screenPos = this.engine.bulletEngine.gameToScreen(this.bullet.x, this.bullet.y);

            this.engine.bulletEngine.createBullet({
                startX: screenPos.x,
                startY: screenPos.y,
                angle: finalAngle,
                bulletInfo: transBullet,
                transformChain: [],
                parentBullet: this.bullet.element,
                enemyTarget: this.bullet.enemyTarget
            });
        }
    }
}

// === BEHAVIOR FACTORY ===

class BehaviorFactory {
    static createBehaviors(bullet, engine) {
        const behaviors = new Map();
        const bulletInfo = bullet.bulletInfo;

        // Always add standard movement
        behaviors.set('movement', new StandardMovementBehavior(bullet, engine));

        // Add behaviors based on bullet properties
        if (bulletInfo.acceleration) {
            // Handle both array and object formats
            const accelData = bulletInfo.acceleration;
            const isArray = Array.isArray(accelData);

            // Check for standard u/v acceleration
            if (isArray) {
                if (accelData.some(a => a.u || a.v)) {
                    behaviors.set('acceleration', new AccelerationBehavior(bullet, engine));
                }
                if (accelData.some(a => a.tracker)) {
                    behaviors.set('tracker', new TrackerBehavior(bullet, engine));
                }
                if (accelData.some(a => a.orbit)) {
                    behaviors.set('orbit', new OrbitBehavior(bullet, engine));
                }
                if (accelData.some(a => a.circle)) {
                    behaviors.set('circle', new CircleBehavior(bullet, engine));
                }
            } else {
                // Object format (like your bullet 79552)
                if (accelData.u !== undefined || accelData.v !== undefined) {
                    behaviors.set('acceleration', new AccelerationBehavior(bullet, engine));
                }
                if (accelData.tracker) {
                    behaviors.set('tracker', new TrackerBehavior(bullet, engine));
                }
                if (accelData.orbit) {
                    behaviors.set('orbit', new OrbitBehavior(bullet, engine));
                }
                if (accelData.circle) {
                    behaviors.set('circle', new CircleBehavior(bullet, engine));
                }
            }
        }

        if (bulletInfo.extra_param?.gravity) {
            behaviors.set('gravity', new GravityBehavior(bullet, engine));
        }

        if (bullet.airdropData) {
            behaviors.set('airdrop', new AirdropBehavior(bullet, engine));
        }

        if (bulletInfo.extra_param?.shrapnel) {
            behaviors.set('shrapnel', new ShrapnelBehavior(bullet, engine));
        }

        if (bullet.transformChain && bullet.transformChain.length > 0) {
            behaviors.set('transform', new TransformBehavior(bullet, engine));
        }

        return behaviors;
    }
}