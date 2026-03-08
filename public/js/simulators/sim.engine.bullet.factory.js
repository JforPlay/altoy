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
    initialize() { }

    update(frameData) {
        const delta = frameData.deltaMultiplier || 1;
        const newX = frameData.x + frameData.velocityX * delta;
        const newY = frameData.y + frameData.velocityY * delta;

        return { x: newX, y: newY };
    }
}

// Game: BattleBulletUnit.AccelerateCheck
//   Velocity += u            (speed magnitude change)
//   Angle += v               (direction rotation, v in DEGREES per frame)
//   Speed.x = Velocity * cos(Angle)
//   Speed.z = Velocity * sin(Angle)
//   if Velocity < 0: Velocity = -Velocity, flip all u signs
class AccelerationBehavior extends BulletBehavior {
    initialize() {
        const bulletInfo = this.bullet.bulletInfo;
        this.currentAccel = 0;
        this.currentAngularVel = 0; // degrees per frame
        this.schedule = [];

        if (Array.isArray(bulletInfo.acceleration)) {
            bulletInfo.acceleration.forEach(event => {
                let uVal = event.u || 0;
                let vVal = event.v || 0;

                // Task 1.13: Apply flip logic - negate v when barrageAngle % 360 is in (0, 180)
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
        for (const event of this.schedule) {
            if (frameData.timeElapsed >= event.time) {
                this.currentAccel = event.u;
                this.currentAngularVel = event.v;
            }
        }

        if (this.currentAccel === 0 && this.currentAngularVel === 0) return;

        const delta = frameData.deltaMultiplier || 1;

        // Derive current speed and angle from velocity components each frame
        // (stays in sync with upstream behaviors that may modify velocity)
        let speed = Math.sqrt(frameData.velocityX ** 2 + frameData.velocityY ** 2);
        let angle = Math.atan2(frameData.velocityY, frameData.velocityX);

        // Game: Velocity += u
        speed += this.currentAccel * delta;

        // Game: if Velocity < 0 → bounce and flip all u signs
        if (speed < 0) {
            speed = -speed;
            this.schedule.forEach(e => e.u *= -1);
            this.currentAccel *= -1;
        }

        // Game: Angle += v (v is in degrees per frame)
        angle += this.currentAngularVel * (Math.PI / 180) * delta;

        // Game: Speed = Velocity * (cos(Angle), sin(Angle))
        return {
            velocityX: speed * Math.cos(angle),
            velocityY: speed * Math.sin(angle)
        };
    }
}

// Task 1.8: Fix Tracker with deadzone + angular speed using rotation matrix
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
        // Store angular speed in radians per frame
        this.angularSpeed = (trackerData.tracker.angular || 3) * Math.PI / 180;
        this.target = this.bullet.enemyTarget;
        this.isTracking = false;
        // Task 1.8: 10-degree deadzone threshold
        this.deadzoneThreshold = Math.cos(10 * Math.PI / 180);
    }

    update(frameData) {
        if (!this.enabled || !this.target) return;

        const dx = this.target.x - frameData.x;
        const dy = this.target.y - frameData.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const inRange = distance <= this.trackRange;

        if (inRange) {
            if (!this.isTracking) {
                this.isTracking = true;
            }

            const speed = Math.sqrt(frameData.velocityX ** 2 + frameData.velocityY ** 2);
            if (speed < 0.0001 || distance < 0.0001) return;

            // Normalize current velocity direction
            const dirX = frameData.velocityX / speed;
            const dirY = frameData.velocityY / speed;

            // Normalize target direction
            const targetDirX = dx / distance;
            const targetDirY = dy / distance;

            // Dot product to check deadzone
            const dot = dirX * targetDirX + dirY * targetDirY;

            // Task 1.8: 10-degree deadzone - don't turn when already aligned
            if (dot >= this.deadzoneThreshold) return;

            // Cross product for turn direction (z component of 2D cross product)
            const cross = dirX * targetDirY - dirY * targetDirX;
            const turnDir = Math.sign(cross);

            // Apply angular speed using rotation matrix
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
            return;
        }
    }
}

// Task 1.6: Fix Orbit Logic - Two-Mode System with distance threshold
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
        // Distance threshold for mode switching
        this.distanceThreshold = 10;
    }

    update(frameData) {
        if (!this.enabled || !this.center) return;

        const dx = this.center.x - frameData.x;
        const dy = this.center.y - frameData.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 0.001) return;

        const speed = Math.sqrt(frameData.velocityX ** 2 + frameData.velocityY ** 2);
        if (speed < 0.0001) return;

        let blendDirX, blendDirY;

        if (distance > this.distanceThreshold) {
            // Far mode: blend toward-center direction with current velocity
            const towardX = dx / distance;
            const towardY = dy / distance;
            const velNormX = frameData.velocityX / speed;
            const velNormY = frameData.velocityY / speed;
            blendDirX = towardX + velNormX;
            blendDirY = towardY + velNormY;
        } else {
            // Close mode: blend perpendicular-to-center with current velocity
            const perpX = -dy / distance;
            const perpY = dx / distance;
            const velNormX = frameData.velocityX / speed;
            const velNormY = frameData.velocityY / speed;
            blendDirX = perpX + velNormX;
            blendDirY = perpY + velNormY;
        }

        // Normalize blended direction
        const blendLen = Math.sqrt(blendDirX * blendDirX + blendDirY * blendDirY);
        if (blendLen < 0.0001) return;

        return {
            velocityX: (blendDirX / blendLen) * speed,
            velocityY: (blendDirY / blendLen) * speed
        };
    }
}

// Task 1.7: Fix Circle - Inverse Flag Oscillation
class CircleBehavior extends BulletBehavior {
    initialize() {
        const circleData = this.bullet.bulletInfo.acceleration?.find(a => a.circle);
        if (!circleData) {
            this.enabled = false;
            return;
        }

        this.enabled = true;
        // Task 1.1: centripetalSpeed uses (1/viewFPS) instead of gSpeed
        this.centripetalSpeed = (circleData.circle.centripetalSpeed || 0) / this.engine.targetFps;
        this.antiClockwise = circleData.circle.antiClockWise || false;
        // Task 1.7: Inverse flag for spiral in/out
        this.inverseFlag = 1;
        // Store converted velocity for rotation angle calculation
        this.convertedVelocity = this.bullet.bulletInfo.velocity * this.engine.bulletSpeedConvert;

        // Center fallback: enemy target position, then bullet spawn position
        if (this.bullet.enemyTarget) {
            this.center = { x: this.bullet.enemyTarget.x, y: this.bullet.enemyTarget.y };
        } else {
            this.center = { x: this.bullet.spawnX, y: this.bullet.spawnY };
        }
        // Override with explicit center if provided
        if (circleData.circle.center) {
            this.center = circleData.circle.center;
        }
    }

    update(frameData) {
        if (!this.enabled || !this.center) return;

        const dx = frameData.x - this.center.x;
        const dy = frameData.y - this.center.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 0.001) return;

        const delta = frameData.deltaMultiplier || 1;

        // Task 1.7: Check inverse flag oscillation
        // If distance would go negative after applying centripetal movement, flip the flag
        if (distance - this.centripetalSpeed * delta * this.inverseFlag < 0) {
            this.inverseFlag *= -1;
        }

        // Use convertedVelocity (not current speed) for rotation angle
        const rotationAngle = (this.convertedVelocity / distance) * (this.antiClockwise ? 1 : -1) * delta;
        const cosA = Math.cos(rotationAngle);
        const sinA = Math.sin(rotationAngle);

        const rotatedVelX = frameData.velocityX * cosA - frameData.velocityY * sinA;
        const rotatedVelY = frameData.velocityX * sinA + frameData.velocityY * cosA;

        // Apply radial component based on centripetal speed and inverseFlag
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

// Task 1.5: Fix Gravity - Initial Vertical Speed
// Game has two paths:
//   BattleBulletUnit (FORWARD/generic): fixed arc, verticalSpeed = -0.5 * gravity * 60 / velocity
//   BattleBombBulletUnit (AIM/targeted): arc tuned to land on enemy,
//     flightTime = distance / velocity, verticalSpeed = (targetAlt - spawnAlt) / t - 0.5 * gravity * t
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
            // Aimed trajectory: vertical speed calculated to land on target
        } else if (hasHorizontalVelocity && convertedVelocity > 0) {
            // Generic formula (BattleBulletUnit): fixed arc
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
     *   verticalSpeed = (explodeY - spawnY) / t - 0.5 * gravity * t
     * In simulator coords: altitude starts at 0, detonation at -bombDetonateHeight
     */
    _tryAimedTrajectory(convertedVelocity) {
        if (convertedVelocity <= 0) return false;

        let horizontalDistance = 0;

        // Case 1: Airdrop bomb — distance from spawn to explode position
        if (this.bullet.airdropData?.explodePos) {
            const dx = this.bullet.airdropData.explodePos.x - this.bullet.x;
            const dy = this.bullet.airdropData.explodePos.y - this.bullet.y;
            horizontalDistance = Math.sqrt(dx * dx + dy * dy);
        }
        // Case 2: aim_type=1 — distance from spawn to enemy
        else if (this.bullet.aimType === 1 && this.bullet.enemyTarget) {
            const dx = this.bullet.enemyTarget.x - this.bullet.spawnX;
            const dy = this.bullet.enemyTarget.y - this.bullet.spawnY;
            horizontalDistance = Math.sqrt(dx * dx + dy * dy);
        }
        // Neither aimed nor airdrop → use generic formula
        else {
            return false;
        }

        if (horizontalDistance < 0.01) return false;

        const flightTime = horizontalDistance / convertedVelocity;
        // Target altitude = -bombDetonateHeight (bullet falls below ground plane to detonate)
        this.verticalSpeed = (-this.engine.bombDetonateHeight) / flightTime - 0.5 * this.gravity * flightTime;
        return true;
    }

    update(frameData) {
        if (!this.hasGravity) return;

        const delta = frameData.deltaMultiplier || 1;
        this.previousVerticalSpeed = this.verticalSpeed;
        this.verticalSpeed += this.gravity * delta;
        this.altitude += this.verticalSpeed * delta;

        return {
            altitude: this.altitude,
            // Task 1.5: Fix apexReached detection
            apexReached: this.previousVerticalSpeed > 0 && this.verticalSpeed <= 0
        };
    }
}

class AirdropBehavior extends BulletBehavior {
    // Airdrop vertical trajectory is now handled by GravityBehavior._tryAimedTrajectory().
    // This behavior is kept as a marker so BehaviorFactory can detect airdrop bullets.
    initialize() { }
    update(frameData) { return null; }
}

// === SPECIAL UNIT BEHAVIORS ===

// Task 2.1: MissileBehavior - Two-phase rise/dive (BattleMissileUnit)
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

        // Target position (enemy or fixed offset from spawn)
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

            // Detonation when altitude drops below ground
            if (this.altitude <= 0 && frameData.timeElapsed > this.launchRiseTime + 0.1) {
                this.bullet.shouldRemove = true;
            }

            return { altitude: this.altitude };
        }

        return null;
    }

    _completeRise(frameData) {
        // Calculate horizontal velocity to reach target in fallTime
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

        // Calculate vertical speed to descend from current altitude in fallTime
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

// Task 2.2: BeamBehavior - Sweeping laser (BattleBeamUnit)
class BeamBehavior extends BulletBehavior {
    initialize() {
        const bulletInfo = this.bullet.bulletInfo;
        if (bulletInfo.type !== 10) {
            this.enabled = false;
            return;
        }

        this.enabled = true;
        this.currentAngle = this.bullet.angleRad;
        // Sweep rate from barrage delta_angle (passed via bulletInfo.beam_delta_angle)
        this.sweepRate = (bulletInfo.beam_delta_angle || 0) * Math.PI / 180;
        this.beamLength = bulletInfo.range || 50;
        this.attackTime = bulletInfo.extra_param?.attack_time || 3;

        // Beam anchors to host position
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

// Gravitation bullet (type 11): persistent area damage, position lock, periodic pulse
class GravitationBehavior extends BulletBehavior {
    initialize() {
        const bulletInfo = this.bullet.bulletInfo;
        if (bulletInfo.type !== 11) {
            this.enabled = false;
            return;
        }

        this.enabled = true;
        this.state = 'FALLING'; // FALLING → ACTIVE → EXPIRED
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

// Scale bullet (type 15): growing collision box with speed reduction
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

            // Speed reduction during growth: 50% of normal speed
            return {
                velocityX: frameData.velocityX * 0.5,
                velocityY: frameData.velocityY * 0.5,
                bulletScale: this.currentScale
            };
        }

        return { bulletScale: this.currentScale };
    }
}

// Space Laser (type 14): column area weapon with precast and attack phases
class SpaceLaserBehavior extends BulletBehavior {
    initialize() {
        const bulletInfo = this.bullet.bulletInfo;
        if (bulletInfo.type !== 14) {
            this.enabled = false;
            return;
        }

        this.enabled = true;
        this.state = 'PRECAST'; // PRECAST → ATTACK → DESTROY
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
        // If already lingering, keep bullet fixed
        if (this.isLingering) {
            const lingeringDuration = frameData.timeElapsed - this.lingeringStartTime;

            if (lingeringDuration < this.lastTimeSec) {
                // Still lingering
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

        // Time-based scheduling for trailing shrapnel
        this.trailingShrapnels.forEach(shrapnel => {
            while (shrapnel.shotsFired < shrapnel.totalShots &&
                frameData.timeElapsed >= shrapnel.nextShotTime) {
                this._emitShrapnel(shrapnel, frameData, shrapnel.shotsFired);

                shrapnel.shotsFired++;
                let interval = shrapnel.currentInterval;
                if (interval <= 0) interval = 1 / this.engine.targetFps; // Minimum one frame
                shrapnel.nextShotTime += interval;
                shrapnel.currentInterval += shrapnel.delta_interval;
            }
        });

        // Task 2.3: Apex-triggered split: gravity bullets split at highest point
        if (!this.triggered && !this.rangeReached && frameData.apexReached) {
            const gravityBehavior = this.bullet.getBehavior('gravity');
            if (gravityBehavior && gravityBehavior.hasGravity && this.splitShrapnels.length > 0) {
                if (this.lastTimeSec > 0) {
                    this._startLingering(frameData);
                    return {
                        velocityX: 0, velocityY: 0,
                        x: frameData.x, y: frameData.y
                    };
                } else {
                    this.triggerSplit(frameData);
                    this.bullet.shouldRemove = true;
                    return;
                }
            }
        }

        // Task 1.2: Check range using distanceFromSpawn
        if (!this.rangeReached && !this.triggered) {
            if (frameData.distanceFromSpawn >= this.originalRange) {
                this.rangeReached = true;

                if (this.lastTimeSec > 0 && this.splitShrapnels.length > 0) {
                    this._startLingering(frameData);
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

        return undefined;
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

// Task 1.12: Fix Transform - Modify existing bullet angle mid-flight with accumulated delays
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

// Task 1.4: Behavior Mutual Exclusivity
// Game assigns exactly ONE primary behavior: accel > tracker > orbit > circle
// Gravity is always separate, movement is always created
// Shrapnel, transform, airdrop are independent
export class BehaviorFactory {
    static createBehaviors(bullet, engine) {
        const behaviors = new Map();
        const bulletInfo = bullet.bulletInfo;

        // Movement is always created
        behaviors.set('movement', new StandardMovementBehavior(bullet, engine));

        if (bulletInfo.acceleration) {
            const accelData = bulletInfo.acceleration;
            const isArray = Array.isArray(accelData);

            // Determine which ONE primary behavior to create based on priority:
            // acceleration > tracker > orbit > circle
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

        // Task 2.2: Beam behavior for bullet type 10
        if (bulletInfo.type === 10) {
            behaviors.set('beam', new BeamBehavior(bullet, engine));
        }

        // Gravitation bullet (type 11): persistent area damage
        if (bulletInfo.type === 11) {
            behaviors.set('gravitation', new GravitationBehavior(bullet, engine));
        }

        // Scale bullet (type 15): growing collision box
        if (bulletInfo.type === 15) {
            behaviors.set('scale', new ScaleBehavior(bullet, engine));
        }

        // Space Laser (type 14): column area weapon
        if (bulletInfo.type === 14) {
            behaviors.set('spaceLaser', new SpaceLaserBehavior(bullet, engine));
        }

        // Task 2.1: Missile behavior (supersedes gravity — manages its own vertical physics)
        if (bulletInfo.extra_param?.missile) {
            behaviors.set('missile', new MissileBehavior(bullet, engine));
        }

        // Gravity is always created if present (separate vertical system)
        // but NOT when missile is active (missile manages its own vertical physics)
        if (bulletInfo.extra_param?.gravity && !bulletInfo.extra_param?.missile) {
            behaviors.set('gravity', new GravityBehavior(bullet, engine));
        }

        // Airdrop is independent
        if (bullet.airdropData) {
            behaviors.set('airdrop', new AirdropBehavior(bullet, engine));
        }

        // Shrapnel is independent
        if (bulletInfo.extra_param?.shrapnel) {
            behaviors.set('shrapnel', new ShrapnelBehavior(bullet, engine));
        }

        // Transform is independent
        if (bullet.transformChain && bullet.transformChain.length > 0) {
            behaviors.set('transform', new TransformBehavior(bullet, engine));
        }

        return behaviors;
    }
}
