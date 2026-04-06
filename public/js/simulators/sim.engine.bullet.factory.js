/**
 * sim.engine.bullet.factory.js
 * Bullet behavior system for the shared simulation engine.
 * Each behavior class modifies bullet state per frame via update(frameData).
 * BehaviorFactory.createBehaviors() is called by sim.engine.bullet.js for each new bullet.
 *
 * Return conventions from update():
 *   - null: no changes to apply
 *   - { velocityX, velocityY }: override velocity
 *   - { x, y, velocityX, velocityY }: override position + velocity (position-locking behaviors)
 *   - { altitude, apexReached }: vertical state (gravity)
 *   - { bulletScale }: visual scale (scale behavior)
 *
 * Primary behavior mutual exclusivity (game assigns exactly one):
 *   acceleration > tracker > orbit > circle
 * Independent behaviors: gravity, missile, beam, gravitation, scale, spaceLaser, shrapnel, transform
 */

class BulletBehavior {
    constructor(bullet, engine) {
        this.bullet = bullet;
        this.engine = engine;
    }

    initialize() { }
    update(frameData) { return null; }
    destroy() { }
}

// === MOVEMENT BEHAVIORS ===

class StandardMovementBehavior extends BulletBehavior {
    initialize() { }

    update(frameData) {
        const delta = frameData.deltaMultiplier || 1;
        return {
            x: frameData.x + frameData.velocityX * delta,
            y: frameData.y + frameData.velocityY * delta
        };
    }
}

/**
 * Game: BattleBulletUnit.AccelerateCheck
 *   Velocity += u            (speed magnitude change per frame)
 *   Angle += v               (direction rotation, v in DEGREES per frame)
 *   Speed = Velocity * (cos(Angle), sin(Angle))
 *   if Velocity < 0: Velocity = -Velocity, flip all u signs
 *
 * Flip logic: when event.flip is set, negate v if barrageAngle is in (0°, 180°)
 * to mirror patterns symmetrically.
 */
class AccelerationBehavior extends BulletBehavior {
    initialize() {
        const bulletInfo = this.bullet.bulletInfo;
        this.currentAccel = 0;
        this.currentAngularVel = 0;
        this.schedule = [];
        // Game quantizes acceleration to ACC_INTERVAL = 1/30 second steps
        this.accInterval = 1 / this.engine.targetFps;
        this.accumulatedTime = 0;

        if (Array.isArray(bulletInfo.acceleration)) {
            bulletInfo.acceleration.forEach(event => {
                let uVal = event.u || 0;
                let vVal = event.v || 0;

                // Flip v for symmetric patterns based on barrage angle
                if (event.flip && this.bullet.barrageAngle !== null && this.bullet.barrageAngle !== undefined) {
                    const normalizedAngle = ((this.bullet.barrageAngle % 360) + 360) % 360;
                    if (normalizedAngle > 0 && normalizedAngle < 180) {
                        vVal = -vVal;
                    }
                }

                this.schedule.push({
                    time: event.t,
                    u: uVal,
                    v: vVal,
                    flip: event.flip || false
                });
            });
            this.schedule.sort((a, b) => a.time - b.time);

            if (this.schedule.length > 0) {
                this.currentAccel = this.schedule[0].u;
                this.currentAngularVel = this.schedule[0].v;
            }
        }
    }

    update(frameData) {
        // Apply all events whose time has elapsed
        for (const event of this.schedule) {
            if (frameData.timeElapsed >= event.time) {
                this.currentAccel = event.u;
                this.currentAngularVel = event.v;
            }
        }

        if (this.currentAccel === 0 && this.currentAngularVel === 0) return null;

        // Quantized: accumulate game-time, apply in discrete 1/30-sec intervals
        this.accumulatedTime += frameData.deltaTimeSec * this.engine.gSpeed;
        const intervalCount = Math.floor(this.accumulatedTime / this.accInterval);
        if (intervalCount <= 0) return null;
        this.accumulatedTime -= intervalCount * this.accInterval;

        // Derive speed/angle from velocity each frame (stays in sync with upstream behaviors)
        let speed = Math.sqrt(frameData.velocityX ** 2 + frameData.velocityY ** 2);
        let angle = Math.atan2(frameData.velocityY, frameData.velocityX);

        speed += this.currentAccel * intervalCount;

        // Bounce: if speed goes negative, invert and flip all u signs
        if (speed < 0) {
            speed = -speed;
            this.schedule.forEach(e => e.u *= -1);
            this.currentAccel *= -1;
        }

        angle += this.currentAngularVel * (Math.PI / 180) * intervalCount;

        return {
            velocityX: speed * Math.cos(angle),
            velocityY: speed * Math.sin(angle)
        };
    }
}

/**
 * Homing tracker with deadzone and angular speed.
 * Only turns when target is within tracking range and outside 10° deadzone.
 * Uses rotation matrix for smooth turning.
 */
class TrackerBehavior extends BulletBehavior {
    initialize() {
        const bulletInfo = this.bullet.bulletInfo;

        let trackerData = null;

        if (Array.isArray(bulletInfo.acceleration)) {
            trackerData = bulletInfo.acceleration.find(a => a.tracker);
        } else if (bulletInfo.acceleration && bulletInfo.acceleration.tracker) {
            trackerData = bulletInfo.acceleration;
        }

        if (!trackerData || !trackerData.tracker) {
            this.enabled = false;
            return;
        }

        if (!this.bullet.enemyTarget) {
            this.enabled = false;
            return;
        }

        this.enabled = true;
        this.trackRange = trackerData.tracker.range || 50;
        this.angularSpeed = (trackerData.tracker.angular || 3) * Math.PI / 180;
        this.target = this.bullet.enemyTarget;
        this.isTracking = false;
        this.deadzoneThreshold = Math.cos(10 * Math.PI / 180); // 10° deadzone
    }

    update(frameData) {
        if (!this.enabled || !this.target) return null;

        const dx = this.target.x - frameData.x;
        const dy = this.target.y - frameData.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const inRange = distance <= this.trackRange;

        if (inRange) {
            if (!this.isTracking) {
                this.isTracking = true;
            }

            const speed = Math.sqrt(frameData.velocityX ** 2 + frameData.velocityY ** 2);
            if (speed < 0.0001 || distance < 0.0001) return null;

            const dirX = frameData.velocityX / speed;
            const dirY = frameData.velocityY / speed;

            const targetDirX = dx / distance;
            const targetDirY = dy / distance;

            const dot = dirX * targetDirX + dirY * targetDirY;

            // Within deadzone — already aligned, don't turn
            if (dot >= this.deadzoneThreshold) return null;

            // Cross product determines turn direction
            const cross = dirX * targetDirY - dirY * targetDirX;
            const turnDir = Math.sign(cross);

            const delta = frameData.deltaMultiplier || 1;
            const turnAngle = turnDir * this.angularSpeed * delta;
            const cosA = Math.cos(turnAngle);
            const sinA = Math.sin(turnAngle);

            return {
                velocityX: frameData.velocityX * cosA - frameData.velocityY * sinA,
                velocityY: frameData.velocityX * sinA + frameData.velocityY * cosA
            };
        } else {
            if (this.isTracking) {
                this.isTracking = false;
            }
            return null;
        }
    }
}

/**
 * Two-mode orbit: far from center → blend toward center, close → blend perpendicular.
 * Distance threshold switches between modes.
 */
class OrbitBehavior extends BulletBehavior {
    initialize() {
        const orbitData = this.bullet.bulletInfo.acceleration?.find(a => a.orbit);
        if (!orbitData || !this.bullet.weaponPos) {
            this.enabled = false;
            return;
        }

        this.enabled = true;
        this.center = this.engine.screenToGame(
            this.bullet.weaponPos.x,
            this.bullet.weaponPos.y
        );
        this.distanceThreshold = 10;
    }

    update(frameData) {
        if (!this.enabled || !this.center) return null;

        const dx = this.center.x - frameData.x;
        const dy = this.center.y - frameData.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 0.001) return null;

        const speed = Math.sqrt(frameData.velocityX ** 2 + frameData.velocityY ** 2);
        if (speed < 0.0001) return null;

        let blendDirX, blendDirY;

        if (distance > this.distanceThreshold) {
            // Far: blend toward-center with current velocity
            const towardX = dx / distance;
            const towardY = dy / distance;
            const velNormX = frameData.velocityX / speed;
            const velNormY = frameData.velocityY / speed;
            blendDirX = towardX + velNormX;
            blendDirY = towardY + velNormY;
        } else {
            // Close: blend perpendicular-to-center with current velocity
            const perpX = -dy / distance;
            const perpY = dx / distance;
            const velNormX = frameData.velocityX / speed;
            const velNormY = frameData.velocityY / speed;
            blendDirX = perpX + velNormX;
            blendDirY = perpY + velNormY;
        }

        const blendLen = Math.sqrt(blendDirX * blendDirX + blendDirY * blendDirY);
        if (blendLen < 0.0001) return null;

        return {
            velocityX: (blendDirX / blendLen) * speed,
            velocityY: (blendDirY / blendLen) * speed
        };
    }
}

/**
 * Circular motion with centripetal speed and inverse flag oscillation.
 * Uses convertedVelocity (not current speed) for rotation angle.
 * Inverse flag flips when distance would go negative.
 */
class CircleBehavior extends BulletBehavior {
    initialize() {
        const circleData = this.bullet.bulletInfo.acceleration?.find(a => a.circle);
        if (!circleData) {
            this.enabled = false;
            return;
        }

        this.enabled = true;
        // centripetalSpeed uses (1/viewFPS) instead of gSpeed
        this.centripetalSpeed = (circleData.circle.centripetalSpeed || 0) / this.engine.targetFps;
        this.antiClockwise = circleData.circle.antiClockWise || false;
        this.inverseFlag = 1;
        this.convertedVelocity = this.bullet.bulletInfo.velocity * this.engine.bulletSpeedConvert;

        // Center: enemy target > bullet spawn > explicit override
        if (this.bullet.enemyTarget) {
            this.center = { x: this.bullet.enemyTarget.x, y: this.bullet.enemyTarget.y };
        } else {
            this.center = { x: this.bullet.spawnX, y: this.bullet.spawnY };
        }
        if (circleData.circle.center) {
            this.center = circleData.circle.center;
        }
    }

    update(frameData) {
        if (!this.enabled || !this.center) return null;

        const dx = frameData.x - this.center.x;
        const dy = frameData.y - this.center.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 0.001) return null;

        const delta = frameData.deltaMultiplier || 1;

        // Flip inverse flag if distance would go negative
        if (distance - this.centripetalSpeed * delta * this.inverseFlag < 0) {
            this.inverseFlag *= -1;
        }

        const rotationAngle = (this.convertedVelocity / distance) * (this.antiClockwise ? 1 : -1) * delta;
        const cosA = Math.cos(rotationAngle);
        const sinA = Math.sin(rotationAngle);

        const rotatedVelX = frameData.velocityX * cosA - frameData.velocityY * sinA;
        const rotatedVelY = frameData.velocityX * sinA + frameData.velocityY * cosA;

        let finalVelX = rotatedVelX;
        let finalVelY = rotatedVelY;

        if (this.centripetalSpeed > 0) {
            const radialX = (dx / distance) * this.centripetalSpeed * this.inverseFlag * delta;
            const radialY = (dy / distance) * this.centripetalSpeed * this.inverseFlag * delta;
            finalVelX += radialX;
            finalVelY += radialY;
        }

        return { velocityX: finalVelX, velocityY: finalVelY };
    }
}

// === VERTICAL BEHAVIORS ===

/**
 * Gravity: parabolic arc with two trajectory calculation paths.
 *   Generic (BattleBulletUnit): fixed arc, verticalSpeed = -0.5 * gravity * 60 / velocity
 *   Aimed (BattleBombBulletUnit): tuned to land on target,
 *     flightTime = distance / velocity, verticalSpeed = targetAlt/t - 0.5*gravity*t
 */
class GravityBehavior extends BulletBehavior {
    initialize() {
        const bulletInfo = this.bullet.bulletInfo;
        this.hasGravity = bulletInfo.extra_param?.gravity && bulletInfo.extra_param.gravity !== 0;
        if (!this.hasGravity) return;

        this.gravity = bulletInfo.extra_param.gravity;
        this.previousVerticalSpeed = 0;
        this.altitude = 0;

        const convertedVelocity = bulletInfo.velocity * this.engine.bulletSpeedConvert;
        const hasHorizontalVelocity = Math.abs(Math.cos(this.bullet.angleRad)) > 0.001;

        if (this._tryAimedTrajectory(convertedVelocity)) {
            // Aimed trajectory set by _tryAimedTrajectory
        } else if (hasHorizontalVelocity && convertedVelocity > 0) {
            this.verticalSpeed = -0.5 * this.gravity * 60 / convertedVelocity;
        } else {
            this.verticalSpeed = 0;
        }

        this.previousVerticalSpeed = this.verticalSpeed;
    }

    /**
     * Calculate aimed vertical speed so the parabolic arc lands on target.
     * Game: BattleBombBulletUnit.SetExplodePosition
     *   flightTime = horizontalDistance / convertedVelocity
     *   verticalSpeed = (explodeAlt - spawnAlt) / t - 0.5 * gravity * t
     * Altitude starts at 0; detonation triggers at -bombDetonateHeight.
     */
    _tryAimedTrajectory(convertedVelocity) {
        if (convertedVelocity <= 0) return false;

        let horizontalDistance = 0;

        if (this.bullet.airdropData?.explodePos) {
            // Airdrop bomb: distance from spawn to explode position
            const dx = this.bullet.airdropData.explodePos.x - this.bullet.x;
            const dy = this.bullet.airdropData.explodePos.y - this.bullet.y;
            horizontalDistance = Math.sqrt(dx * dx + dy * dy);
        } else if (this.bullet.aimType === 1 && this.bullet.enemyTarget) {
            // aim_type=1: distance from spawn to enemy
            const dx = this.bullet.enemyTarget.x - this.bullet.spawnX;
            const dy = this.bullet.enemyTarget.y - this.bullet.spawnY;
            horizontalDistance = Math.sqrt(dx * dx + dy * dy);
        } else {
            return false;
        }

        if (horizontalDistance < 0.01) return false;

        const flightTime = horizontalDistance / convertedVelocity;
        this.verticalSpeed = (-this.engine.bombDetonateHeight) / flightTime - 0.5 * this.gravity * flightTime;
        return true;
    }

    update(frameData) {
        if (!this.hasGravity) return null;

        const delta = frameData.deltaMultiplier || 1;
        this.previousVerticalSpeed = this.verticalSpeed;
        this.verticalSpeed += this.gravity * delta;
        this.altitude += this.verticalSpeed * delta;

        return {
            altitude: this.altitude,
            apexReached: this.previousVerticalSpeed > 0 && this.verticalSpeed <= 0
        };
    }
}

/**
 * Marker behavior for airdrop bullets. Actual trajectory is handled by
 * GravityBehavior._tryAimedTrajectory(). Kept so BehaviorFactory can detect airdrop bullets.
 */
class AirdropBehavior extends BulletBehavior {
    initialize() { }
    update(frameData) { return null; }
}

// === SPECIAL UNIT BEHAVIORS ===

/**
 * Missile: two-phase vertical trajectory (BattleMissileUnit).
 * LAUNCH: rises with gravity until launchRiseTime elapsed.
 * ATTACK: dives toward target with calculated velocity to arrive in fallTime.
 */
class MissileBehavior extends BulletBehavior {
    initialize() {
        const bulletInfo = this.bullet.bulletInfo;
        const missileData = bulletInfo.extra_param?.missile;
        if (!missileData) {
            this.enabled = false;
            return;
        }

        this.enabled = true;
        this.state = 'LAUNCH';
        this.launchVrtSpeed = missileData.launchVrtSpeed || 5;
        this.launchRiseTime = missileData.launchRiseTime || 0.5;
        this.fallTime = missileData.fallTime || 1.0;
        this.gravity = bulletInfo.extra_param.gravity || -0.05;

        this.explodePos = this.bullet.enemyTarget
            ? { x: this.bullet.enemyTarget.x, y: this.bullet.enemyTarget.y }
            : { x: this.bullet.spawnX + 30, y: this.bullet.spawnY };

        this.verticalSpeed = this.launchVrtSpeed;
        this.altitude = 0;
    }

    update(frameData) {
        if (!this.enabled) return null;

        const delta = frameData.deltaMultiplier || 1;

        if (this.state === 'LAUNCH') {
            this.verticalSpeed += this.gravity * delta;
            this.altitude += this.verticalSpeed * delta;

            if (frameData.timeElapsed >= this.launchRiseTime) {
                this.state = 'ATTACK';
                return this._completeRise(frameData);
            }

            return { altitude: this.altitude };
        }

        if (this.state === 'ATTACK') {
            this.verticalSpeed += this.gravity * delta;
            this.altitude += this.verticalSpeed * delta;

            if (this.altitude <= 0 && frameData.timeElapsed > this.launchRiseTime + 0.1) {
                this.bullet.shouldRemove = true;
            }

            return { altitude: this.altitude };
        }

        return null;
    }

    /**
     * Transition from LAUNCH to ATTACK: calculate dive velocity toward target.
     * Speed = distance / (fallTime * targetFps) — in game-units-per-frame.
     */
    _completeRise(frameData) {
        const dx = this.explodePos.x - frameData.x;
        const dy = this.explodePos.y - frameData.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        let newVelX = frameData.velocityX;
        let newVelY = frameData.velocityY;

        if (this.fallTime > 0 && distance > 0.01) {
            const speed = distance / (this.fallTime * this.engine.targetFps);
            newVelX = (dx / distance) * speed;
            newVelY = (dy / distance) * speed;
        }

        const fallFrames = this.fallTime * this.engine.targetFps;
        if (fallFrames > 0) {
            this.verticalSpeed = -(this.altitude / fallFrames) - 0.5 * this.gravity * fallFrames;
        }

        return {
            velocityX: newVelX,
            velocityY: newVelY,
            altitude: this.altitude
        };
    }
}

/**
 * Beam: sweeping laser anchored to host position (BattleBeamUnit).
 * Sweeps at rate derived from barrage delta_angle. Expires after attackTime.
 */
class BeamBehavior extends BulletBehavior {
    initialize() {
        const bulletInfo = this.bullet.bulletInfo;
        if (bulletInfo.type !== 10) {
            this.enabled = false;
            return;
        }

        this.enabled = true;
        this.currentAngle = this.bullet.angleRad;
        this.sweepRate = (bulletInfo.beam_delta_angle || 0) * Math.PI / 180;
        this.beamLength = bulletInfo.range || 50;
        this.attackTime = bulletInfo.extra_param?.attack_time || 3;

        this.hostPos = this.bullet.weaponPos
            ? this.engine.screenToGame(this.bullet.weaponPos.x, this.bullet.weaponPos.y)
            : { x: this.bullet.spawnX, y: this.bullet.spawnY };
    }

    update(frameData) {
        if (!this.enabled) return null;

        const delta = frameData.deltaMultiplier || 1;
        this.currentAngle += this.sweepRate * delta;

        return {
            x: this.hostPos.x,
            y: this.hostPos.y,
            velocityX: 0,
            velocityY: 0
        };
    }
}

/**
 * Gravitation (type 11): persistent area damage with position lock.
 * FALLING → ACTIVE (alert phase + pulse phase) → EXPIRED
 */
class GravitationBehavior extends BulletBehavior {
    initialize() {
        const bulletInfo = this.bullet.bulletInfo;
        if (bulletInfo.type !== 11) {
            this.enabled = false;
            return;
        }

        this.enabled = true;
        this.state = 'FALLING';
        this.hitInterval = bulletInfo.hit_type?.interval || 0.2;
        this.alertDuration = bulletInfo.extra_param?.alert_duration || 0.5;
        this.pierceCount = bulletInfo.pierce_count || 5;
        this.currentPierce = this.pierceCount;
        this.totalDuration = this.alertDuration + this.hitInterval * this.pierceCount;
        this.activeStartTime = 0;
        this.pulseCount = 0;
        this.lockedPos = null;
    }

    update(frameData) {
        if (!this.enabled) return null;

        if (this.state === 'FALLING') {
            const gravityBehavior = this.bullet.getBehavior('gravity');
            const altitude = frameData.altitude || 0;

            if ((gravityBehavior?.hasGravity && altitude <= -this.engine.bombDetonateHeight) ||
                (!gravityBehavior?.hasGravity && frameData.distanceFromSpawn >= this.bullet.range)) {
                this.state = 'ACTIVE';
                this.activeStartTime = frameData.timeElapsed;
                this.lockedPos = { x: frameData.x, y: frameData.y };
                return {
                    x: this.lockedPos.x,
                    y: this.lockedPos.y,
                    velocityX: 0,
                    velocityY: 0
                };
            }
            return null;
        }

        if (this.state === 'ACTIVE') {
            const elapsed = frameData.timeElapsed - this.activeStartTime;

            if (elapsed >= this.alertDuration) {
                const pulseTime = elapsed - this.alertDuration;
                const expectedPulses = Math.floor(pulseTime / this.hitInterval) + 1;
                if (expectedPulses > this.pulseCount) {
                    this.pulseCount = expectedPulses;
                    this.currentPierce--;
                }
            }

            if (this.currentPierce <= 0 || elapsed >= this.totalDuration) {
                this.state = 'EXPIRED';
                this.bullet.shouldRemove = true;
                return null;
            }

            return {
                x: this.lockedPos.x,
                y: this.lockedPos.y,
                velocityX: 0,
                velocityY: 0
            };
        }

        return null;
    }
}

/**
 * Scale (type 15): growing collision box with speed reduction during growth.
 */
class ScaleBehavior extends BulletBehavior {
    initialize() {
        const bulletInfo = this.bullet.bulletInfo;
        if (bulletInfo.type !== 15) {
            this.enabled = false;
            return;
        }

        this.enabled = true;
        this.scaleSpeed = bulletInfo.extra_param?.scaleSpeed || 0.05;
        this.cldMax = bulletInfo.extra_param?.cldMax || [20, 20];
        this.currentScale = 1.0;
        this.isGrowing = true;

        const baseW = bulletInfo.cld_box?.[0] || 1;
        const baseH = bulletInfo.cld_box?.[1] || 1;
        this.maxScaleX = (this.cldMax[0] || baseW) / baseW;
        this.maxScaleY = (this.cldMax[1] || baseH) / baseH;
        this.maxScale = Math.max(this.maxScaleX, this.maxScaleY);
    }

    update(frameData) {
        if (!this.enabled) return null;

        const delta = frameData.deltaMultiplier || 1;

        if (this.isGrowing) {
            this.currentScale += this.scaleSpeed * delta;
            if (this.currentScale >= this.maxScale) {
                this.currentScale = this.maxScale;
                this.isGrowing = false;
            }

            // 50% speed during growth phase
            return {
                velocityX: frameData.velocityX * 0.5,
                velocityY: frameData.velocityY * 0.5,
                bulletScale: this.currentScale
            };
        }

        return { bulletScale: this.currentScale };
    }
}

/**
 * Space Laser (type 14): vertical column area weapon.
 * PRECAST (narrow indicator) → ATTACK (full width) → DESTROY
 */
class SpaceLaserBehavior extends BulletBehavior {
    initialize() {
        const bulletInfo = this.bullet.bulletInfo;
        if (bulletInfo.type !== 14) {
            this.enabled = false;
            return;
        }

        this.enabled = true;
        this.state = 'PRECAST';
        this.attackTime = bulletInfo.extra_param?.attack_time || 3;
        this.hitInterval = bulletInfo.hit_type?.interval || 0.5;
        this.precastTime = bulletInfo.extra_param?.precast_time || 0.5;
        this.attackStartTime = 0;
        this.columnWidth = bulletInfo.cld_box?.[0] || 5;
        this.columnHeight = bulletInfo.cld_box?.[1] || 50;
        this.lockedX = this.bullet.x;
    }

    update(frameData) {
        if (!this.enabled) return null;

        if (this.state === 'PRECAST') {
            if (frameData.timeElapsed >= this.precastTime) {
                this.state = 'ATTACK';
                this.attackStartTime = frameData.timeElapsed;
            }
            return {
                x: this.lockedX,
                y: frameData.y,
                velocityX: 0,
                velocityY: 0
            };
        }

        if (this.state === 'ATTACK') {
            const attackElapsed = frameData.timeElapsed - this.attackStartTime;
            if (attackElapsed >= this.attackTime) {
                this.state = 'DESTROY';
                this.bullet.shouldRemove = true;
                return null;
            }
            return {
                x: this.lockedX,
                y: frameData.y,
                velocityX: 0,
                velocityY: 0
            };
        }

        return null;
    }
}

// === EMISSION BEHAVIORS ===

/**
 * Shrapnel: child bullet emission system with multi-phase state machine.
 * - trailingShrapnels: fire during flight on a timer (initialSplit=true)
 * - splitShrapnels: fire at range/apex/destruction (initialSplit=false)
 * Split sequence: SPIN (decel+rotate) → LINGER (pause) → SPLIT (emit children)
 * - spinDuration > 0: decelerate and rotate before splitting
 * - lastTimeSec > 0: linger in place before splitting
 * - shift_split_delay: stagger child group emissions
 */
class ShrapnelBehavior extends BulletBehavior {
    initialize() {
        const bulletInfo = this.bullet.bulletInfo;
        this.hasShrapnel = bulletInfo.extra_param?.shrapnel;
        if (!this.hasShrapnel) return;

        this.triggered = false;
        this.fragile = bulletInfo.extra_param?.fragile;
        this.childEmitters = [];

        this.lastTimeSec = bulletInfo.extra_param?.lastTime || 0;
        this.lingeringStartTime = -1;
        this.isLingering = false;
        this.lingerPosition = null;
        this.rangeReached = false;

        // SPIN phase: decelerate + rotate before splitting
        this.isSpinning = false;
        this.spinStartTime = -1;
        this.spinDuration = bulletInfo.extra_param?.spinDuration || bulletInfo.extra_param?.spinTime || 0;
        this.spinSpeed = (bulletInfo.extra_param?.spinSpeed || 360) * Math.PI / 180;

        this.originalRange = bulletInfo.range || 50;

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
                    nextShotTime: (barrage.first_delay || 0),
                    currentInterval: (barrage.delay || 0),
                    delta_interval: (barrage.delta_delay || 0)
                });
            } else {
                this.splitShrapnels.push({ shrapnelInfo, barrage, bullet });
            }
        }
    }

    update(frameData) {
        // SPIN phase: decelerate + rotate before split/linger
        if (this.isSpinning) {
            const spinElapsed = frameData.timeElapsed - this.spinStartTime;

            if (spinElapsed >= this.spinDuration) {
                this.isSpinning = false;
                return this._afterSpin(frameData);
            }

            // Decelerate toward zero while rotating
            const decelFactor = Math.max(0.01, 1 - spinElapsed / this.spinDuration);
            const spinRotation = this.spinSpeed * frameData.deltaTimeSec * this.engine.gSpeed;
            const angle = Math.atan2(frameData.velocityY, frameData.velocityX) + spinRotation;
            const speed = Math.sqrt(frameData.velocityX ** 2 + frameData.velocityY ** 2) * decelFactor;

            return {
                velocityX: speed * Math.cos(angle),
                velocityY: speed * Math.sin(angle)
            };
        }

        // Lingering: keep bullet fixed until lastTimeSec elapses, then split
        if (this.isLingering) {
            const lingeringDuration = frameData.timeElapsed - this.lingeringStartTime;

            if (lingeringDuration < this.lastTimeSec) {
                return {
                    velocityX: 0,
                    velocityY: 0,
                    x: this.lingerPosition.x,
                    y: this.lingerPosition.y
                };
            } else {
                this.triggerSplit(frameData);
                this.bullet.shouldRemove = true;
                return null;
            }
        }

        // Time-based trailing shrapnel emission
        this.trailingShrapnels.forEach(shrapnel => {
            while (shrapnel.shotsFired < shrapnel.totalShots &&
                frameData.timeElapsed >= shrapnel.nextShotTime) {
                this._emitShrapnel(shrapnel, frameData, shrapnel.shotsFired);

                shrapnel.shotsFired++;
                let interval = shrapnel.currentInterval;
                if (interval <= 0) interval = 1 / this.engine.targetFps;
                shrapnel.nextShotTime += interval;
                shrapnel.currentInterval += shrapnel.delta_interval;
            }
        });

        // Apex-triggered split: gravity bullets split at highest point
        if (!this.triggered && !this.rangeReached && frameData.apexReached) {
            const gravityBehavior = this.bullet.getBehavior('gravity');
            if (gravityBehavior && gravityBehavior.hasGravity && this.splitShrapnels.length > 0) {
                return this._startSplitSequence(frameData);
            }
        }

        // Range-triggered split
        if (!this.rangeReached && !this.triggered) {
            if (frameData.distanceFromSpawn >= this.originalRange) {
                this.rangeReached = true;
                return this._startSplitSequence(frameData);
            }
        }

        return null;
    }

    /**
     * Split sequence priority: SPIN → LINGER → SPLIT
     * Enters the first applicable phase.
     */
    _startSplitSequence(frameData) {
        if (this.spinDuration > 0 && this.splitShrapnels.length > 0) {
            this._startSpinning(frameData);
            // Keep current velocity — SPIN phase will decelerate
            return {};
        }
        return this._afterSpin(frameData);
    }

    _startSpinning(frameData) {
        this.isSpinning = true;
        this.spinStartTime = frameData.timeElapsed;

        if (this.bullet.element) {
            this.bullet.element.style.filter = 'brightness(1.3) drop-shadow(0 0 8px rgba(255,200,100,0.7))';
        }
    }

    /**
     * Called after SPIN completes (or immediately if no SPIN).
     * Enters LINGER or triggers SPLIT directly.
     */
    _afterSpin(frameData) {
        if (this.lastTimeSec > 0 && this.splitShrapnels.length > 0) {
            this._startLingering(frameData);
            return {
                velocityX: 0, velocityY: 0,
                x: frameData.x, y: frameData.y
            };
        } else {
            this.triggerSplit(frameData);
            this.bullet.shouldRemove = true;
            return null;
        }
    }

    _startLingering(frameData) {
        this.isLingering = true;
        this.lingeringStartTime = frameData.timeElapsed;
        this.lingerPosition = { x: frameData.x, y: frameData.y };

        if (this.bullet.element) {
            this.bullet.element.style.opacity = '0.7';
            this.bullet.element.style.filter = 'brightness(1.5) drop-shadow(0 0 10px rgba(255,200,100,0.9))';
        }
    }

    triggerSplit(frameData) {
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

        this.splitShrapnels.forEach(({ shrapnelInfo, barrage, bullet }, groupIndex) => {
            const shiftDelay = shrapnelInfo.shift_split_delay || shrapnelInfo.shiftSplitDelay || 0;
            const delay = shiftDelay * groupIndex;

            const emitGroup = () => {
                const primalRepeatCount = (barrage.primal_repeat || 0) + 1;
                for (let i = 0; i < primalRepeatCount; i++) {
                    this._emitShrapnel({ shrapnelInfo, barrage, bullet }, frameData, i);
                }
            };

            if (delay > 0) {
                setTimeout(emitGroup, delay * 1000);
            } else {
                emitGroup();
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

        let baseAngle = 0;
        if (shrapnelInfo.reaim) {
            if (this.bullet.enemyTarget) {
                const finalX = this.lingerPosition ? this.lingerPosition.x : frameData.x;
                const finalY = this.lingerPosition ? this.lingerPosition.y : frameData.y;
                const dx = this.bullet.enemyTarget.x - finalX;
                const dy = this.bullet.enemyTarget.y - finalY;
                baseAngle = Math.atan2(dy, dx) * 180 / Math.PI;
            }
        } else if (shrapnelInfo.inheritAngle) {
            baseAngle = Math.atan2(frameData.velocityY, frameData.velocityX) * 180 / Math.PI;
        } else {
            baseAngle = 0;
        }

        const finalAngle = baseAngle + (barrage.angle || 0) + bulletAngleModifier + (shrapnelInfo.rotateOffset || 0);

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

/**
 * Transform: modify bullet angle mid-flight at scheduled times.
 * Each transform in the chain fires once when its accumulated delay elapses.
 * Can aim at a fixed angle or toward a position (offset_prioritise).
 */
class TransformBehavior extends BulletBehavior {
    initialize() {
        this.transforms = [];

        if (!this.bullet.transformChain || this.bullet.transformChain.length === 0) return;

        // Accumulate delays: each transform's trigger time includes all previous delays
        let accumulatedDelay = 0;
        this.bullet.transformChain.forEach(transformData => {
            accumulatedDelay += transformData.transStartDelay;
            this.transforms.push({
                triggerTime: accumulatedDelay,
                data: transformData,
                triggered: false
            });
        });
        this.transforms.sort((a, b) => a.triggerTime - b.triggerTime);
    }

    update(frameData) {
        for (const transform of this.transforms) {
            if (!transform.triggered && frameData.timeElapsed >= transform.triggerTime) {
                transform.triggered = true;
                return this._applyTransform(transform.data, frameData);
            }
        }
        return null;
    }

    _applyTransform(transformData, frameData) {
        let newAngle;
        if (transformData.transAimAngle !== undefined) {
            newAngle = transformData.transAimAngle;
        } else if (transformData.transAimPosX !== undefined) {
            const dx = transformData.transAimPosX - frameData.x;
            const dy = (transformData.transAimPosZ || 0) - frameData.y;
            newAngle = Math.atan2(dy, dx) * 180 / Math.PI;
        } else {
            return null;
        }

        const speed = Math.sqrt(frameData.velocityX ** 2 + frameData.velocityY ** 2);
        if (speed < 0.0001) return null;

        const angleRad = newAngle * Math.PI / 180;
        this.bullet.angleRad = angleRad;

        return {
            velocityX: speed * Math.cos(angleRad),
            velocityY: speed * Math.sin(angleRad)
        };
    }
}

// === BEHAVIOR FACTORY ===

/**
 * Behavior mutual exclusivity (game rule):
 *   Primary: acceleration > tracker > orbit > circle (exactly ONE)
 *   Gravity is always separate (independent vertical system)
 *   Movement is always created
 *   Shrapnel, transform, airdrop are independent
 */
export class BehaviorFactory {
    static createBehaviors(bullet, engine) {
        const behaviors = new Map();
        const bulletInfo = bullet.bulletInfo;

        behaviors.set('movement', new StandardMovementBehavior(bullet, engine));

        if (bulletInfo.acceleration) {
            const accelData = bulletInfo.acceleration;
            const isArray = Array.isArray(accelData);

            // Determine which ONE primary behavior to create (priority order)
            let primaryBehaviorSet = false;

            if (isArray) {
                if (!primaryBehaviorSet && accelData.some(a => a.u || a.v)) {
                    behaviors.set('acceleration', new AccelerationBehavior(bullet, engine));
                    primaryBehaviorSet = true;
                }
                if (!primaryBehaviorSet && accelData.some(a => a.tracker)) {
                    behaviors.set('tracker', new TrackerBehavior(bullet, engine));
                    primaryBehaviorSet = true;
                }
                if (!primaryBehaviorSet && accelData.some(a => a.orbit)) {
                    behaviors.set('orbit', new OrbitBehavior(bullet, engine));
                    primaryBehaviorSet = true;
                }
                if (!primaryBehaviorSet && accelData.some(a => a.circle)) {
                    behaviors.set('circle', new CircleBehavior(bullet, engine));
                    primaryBehaviorSet = true;
                }
            } else {
                if (!primaryBehaviorSet && (accelData.u !== undefined || accelData.v !== undefined)) {
                    behaviors.set('acceleration', new AccelerationBehavior(bullet, engine));
                    primaryBehaviorSet = true;
                }
                if (!primaryBehaviorSet && accelData.tracker) {
                    behaviors.set('tracker', new TrackerBehavior(bullet, engine));
                    primaryBehaviorSet = true;
                }
                if (!primaryBehaviorSet && accelData.orbit) {
                    behaviors.set('orbit', new OrbitBehavior(bullet, engine));
                    primaryBehaviorSet = true;
                }
                if (!primaryBehaviorSet && accelData.circle) {
                    behaviors.set('circle', new CircleBehavior(bullet, engine));
                    primaryBehaviorSet = true;
                }
            }
        }

        // Beam (type 10)
        if (bulletInfo.type === 10) {
            behaviors.set('beam', new BeamBehavior(bullet, engine));
        }

        // Gravitation (type 11): persistent area damage
        if (bulletInfo.type === 11) {
            behaviors.set('gravitation', new GravitationBehavior(bullet, engine));
        }

        // Scale (type 15): growing collision box
        if (bulletInfo.type === 15) {
            behaviors.set('scale', new ScaleBehavior(bullet, engine));
        }

        // Space Laser (type 14)
        if (bulletInfo.type === 14) {
            behaviors.set('spaceLaser', new SpaceLaserBehavior(bullet, engine));
        }

        // Missile (supersedes gravity — manages its own vertical physics)
        if (bulletInfo.extra_param?.missile) {
            behaviors.set('missile', new MissileBehavior(bullet, engine));
        }

        // Gravity (independent vertical system, but NOT when missile is active)
        if (bulletInfo.extra_param?.gravity && !bulletInfo.extra_param?.missile) {
            behaviors.set('gravity', new GravityBehavior(bullet, engine));
        }

        // Airdrop (independent marker)
        if (bullet.airdropData) {
            behaviors.set('airdrop', new AirdropBehavior(bullet, engine));
        }

        // Shrapnel (independent emission)
        if (bulletInfo.extra_param?.shrapnel) {
            behaviors.set('shrapnel', new ShrapnelBehavior(bullet, engine));
        }

        // Transform (independent mid-flight angle change)
        if (bullet.transformChain && bullet.transformChain.length > 0) {
            behaviors.set('transform', new TransformBehavior(bullet, engine));
        }

        return behaviors;
    }
}
