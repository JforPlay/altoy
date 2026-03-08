/**
 * Aircraft Entity System
 * Represents carrier-based planes that spawn, rise to altitude,
 * fly across the screen, and fire their carried weapons at the enemy.
 *
 * Game: BattleAircraftUnit state machine
 *   CREATE (rising to HEIGHT) → ATTACK (flying forward, weapons fire) → DESTROY (off screen/dead)
 *
 * Game constants:
 *   AircraftHeight = 10 (BattleConfig)
 *   HEIGHT = AircraftHeight + 5 = 15 (BattleAircraftUnit)
 *   AircraftSpeedConvertConst = 0.01 (BattleConfig)
 *
 * Game behavior:
 *   - Aircraft spawns at carrier position (MAIN_UNIT_POS + remote bone offset)
 *   - During CREATE: rises to HEIGHT, visual size scales from small → full (position.y / HEIGHT)
 *   - During ATTACK: flies forward at velocity, weapons fire continuously (own reload)
 *   - If position.y < HEIGHT: force y-speed upward = max(0.4, 1 - speed.y / AircraftHeight)
 *   - spawn_brownian: Z-axis random wander (0=no, 1=yes, -1=fixed)
 */

export class AircraftEntity {
    constructor(options) {
        this.engine = options.engine;              // SimulationEngine reference
        this.aircraftData = options.aircraftData;  // from aircraft_template
        this.weaponIds = options.weaponIds || [];
        this.startX = options.startX;
        this.startY = options.startY;
        this.targetX = options.targetX;
        this.direction = options.direction ?? 1;

        this.x = this.startX;
        this.y = this.startY;
        this.targetY = options.targetY || this.startY;
        this.altitude = 0;
        // Game: HEIGHT = AircraftHeight + 5 = 15
        this.targetAltitude = 15;
        // Game: weapons fire when enemy enters weapon's max range (FilterRange check).
        // Default ~30 game units — typical aircraft weapon range.
        this.firingRange = options.firingRange || 30;

        // Game: AircraftSpeedConvertConst = 0.01
        this.speed = (this.aircraftData.speed || 50) * 0.01;
        this.brownianAmplitude = this.aircraftData.spawn_brownian || 0;
        this.brownianPhase = Math.random() * Math.PI * 2;

        this.state = 'CREATE';
        this.createDuration = 0.5; // seconds to reach altitude
        this.timeElapsed = 0;
        this.lastFrameTime = 0; // Set when animation starts

        this.element = null;
        this.shouldRemove = false;
        this.weaponsFired = false;
        this.onFireWeapons = null; // callback set by caller

        this._createElement();

        // Support delayed start for staggered spawns
        const startDelay = options.startDelay || 0;
        if (startDelay > 0) {
            this.element.style.display = 'none';
            setTimeout(() => {
                if (!this.shouldRemove) {
                    this.element.style.display = '';
                    this._startAnimation();
                }
            }, startDelay);
        } else {
            this._startAnimation();
        }
    }

    _createElement() {
        this.element = document.createElement('div');
        this.element.className = 'aircraft-entity';

        // Use actual aircraft icon if model_ID is available
        const modelId = this.aircraftData.model_ID;
        if (modelId) {
            const img = document.createElement('img');
            img.src = `https://raw.githubusercontent.com/JforPlay/data_for_toy/main/aircrafticon/${modelId}.webp`;
            img.alt = modelId;
            img.draggable = false;
            img.className = 'aircraft-icon';
            this.element.appendChild(img);
            this.element.classList.add('has-icon');
        }

        const screenPos = this.engine.bulletEngine.gameToScreen(this.x, this.y);
        Object.assign(this.element.style, {
            position: 'absolute',
            left: `${screenPos.x - 10}px`,
            top: `${screenPos.y - 10}px`,
            zIndex: '20'
        });

        this.engine.container.appendChild(this.element);
    }

    _startAnimation() {
        this.lastFrameTime = performance.now();
        const animate = () => {
            if (this.shouldRemove) {
                if (this.element) {
                    this.element.remove();
                    this.element = null;
                }
                return;
            }

            const now = performance.now();
            const deltaMs = Math.max(now - this.lastFrameTime, 1);
            this.lastFrameTime = now;
            const delta = (deltaMs / (1000 / this.engine.targetFps)) * this.engine.gSpeed;
            this.timeElapsed += deltaMs / 1000;

            this._update(delta);
            this._render();

            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    _update(delta) {
        switch (this.state) {
            case 'CREATE': {
                // Game: during CREATE, aircraft rises to HEIGHT
                // Visual size = clamp(position.y / HEIGHT, 0.1, scale)
                const progress = Math.min(this.timeElapsed / this.createDuration, 1);
                this.altitude = this.targetAltitude * progress;
                if (progress >= 1) {
                    this.state = 'ATTACK';
                }
                break;
            }
            case 'ATTACK': {
                this.x += this.speed * this.direction * delta;

                // Brownian Z-motion (game: spawn_brownian == 1)
                if (this.brownianAmplitude > 0) {
                    this.brownianPhase += 0.05 * delta;
                    this.y += Math.sin(this.brownianPhase) * this.brownianAmplitude * 0.01 * delta;
                }

                // Game: during ATTACK, aircraft slowly descends (-0.04/frame)
                // but never below HEIGHT
                this.altitude = Math.max(this.targetAltitude, this.altitude - 0.04 * delta);

                // Game: weapons fire via range check (FilterRange/IsOutOfRange)
                // Each weapon checks distance from aircraft to target every frame.
                // Fire when aircraft is within weapon range of the enemy.
                if (!this.weaponsFired) {
                    const dx = this.targetX - this.x;
                    const dy = (this.targetY || this.y) - this.y;
                    const distToTarget = Math.sqrt(dx * dx + dy * dy);
                    if (distToTarget < this.firingRange) {
                        this.weaponsFired = true;
                        if (this.onFireWeapons) {
                            this.onFireWeapons(this.x, this.y, this.weaponIds);
                        }
                    }
                }

                // Out of bounds check
                const screenPos = this.engine.bulletEngine.gameToScreen(this.x, this.y);
                const containerWidth = this.engine.container.offsetWidth;
                if (screenPos.x < -50 || screenPos.x > containerWidth + 50) {
                    this.state = 'DESTROY';
                }
                break;
            }
            case 'DESTROY':
                this.shouldRemove = true;
                break;
        }
    }

    _render() {
        if (!this.element) return;
        const screenPos = this.engine.bulletEngine.gameToScreen(this.x, this.y);
        const scale = this.engine.bulletEngine.scale;

        // Game: visual size during CREATE = clamp(position.y / HEIGHT, 0.1, 1)
        const sizeScale = this.state === 'CREATE'
            ? Math.max(0.1, this.altitude / this.targetAltitude)
            : 1;

        // Altitude visual offset — same approach as gravity bullets
        // altitude in game units, multiplied by pixel scale
        const altitudeOffset = this.altitude * scale;
        const baseSize = this.element.classList.contains('has-icon') ? 40 : 20;
        const size = baseSize * sizeScale;

        // Icons face LEFT natively. direction=1 (friendly, flies RIGHT) needs scaleX(-1).
        // direction=-1 (enemy, flies LEFT) matches icon orientation — no flip.
        const flipX = this.direction > 0 ? ' scaleX(-1)' : '';

        Object.assign(this.element.style, {
            left: `${screenPos.x - size / 2}px`,
            top: `${screenPos.y - size / 2 - altitudeOffset}px`,
            transform: `scale(${sizeScale})${flipX}`
        });
    }

    destroy() {
        this.shouldRemove = true;
        if (this.element) {
            this.element.remove();
            this.element = null;
        }
    }
}
