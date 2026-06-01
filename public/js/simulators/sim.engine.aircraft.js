/**
 * sim.engine.aircraft.js
 * Aircraft entity for the simulation engine (sim.engine.common.js).
 * Carrier-based planes: spawn at carrier, rise to altitude, fly forward, fire weapons at enemy.
 * Used by both sim.weapon.main.js (skill-triggered aircraft) and sim.aircraft.main.js.
 *
 * State machine: CREATE (rising) → ATTACK (flying + firing) → DESTROY (cleanup)
 *
 * Game constants (BattleConfig / BattleAircraftUnit):
 *   AircraftHeight = 10, HEIGHT = AircraftHeight + 5 = 15
 *   AircraftSpeedConvertConst = 0.01
 *   spawn_brownian: depth-axis random wander (0=no, 1=yes, -1=fixed)
 */

import { DATA_FOR_TOY_BASE } from '../utils.js';

export class AircraftEntity {
    constructor(options) {
        this.engine = options.engine;
        this.aircraftData = options.aircraftData;
        this.weaponIds = options.weaponIds || [];
        this.startX = options.startX;
        this.startY = options.startY;
        this.targetX = options.targetX;
        this.direction = options.direction ?? 1;

        this.x = this.startX;
        this.y = this.startY;
        this.targetY = options.targetY ?? this.startY;
        this.altitude = 0;
        this.targetAltitude = 15; // HEIGHT = AircraftHeight + 5
        this.firingRange = options.firingRange || 30;
        this.weaponRanges = options.weaponRanges || null; // Per-weapon range array from weapon_property.range

        this.speed = (this.aircraftData.speed || 50) * 0.01; // AircraftSpeedConvertConst
        this.brownianAmplitude = this.aircraftData.spawn_brownian || 0;
        this.brownianPhase = Math.random() * Math.PI * 2;

        this.state = 'CREATE';
        this.createDuration = 0.5; // seconds to reach altitude
        this.timeElapsed = 0;
        this.lastFrameTime = 0;
        this._rafId = null;

        this.element = null;
        this.shouldRemove = false;
        this.weaponsFiredSet = new Set(); // Track which weapons have fired (by index)
        this.onFireWeapon = null; // Called per weapon: (x, y, weaponId, weaponIndex)

        this._createElement();

        const startDelay = options.startDelay || 0;
        if (startDelay > 0) {
            this.element.style.display = 'none';
            this._delayTimer = setTimeout(() => {
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

        const modelId = this.aircraftData.model_ID;
        if (modelId) {
            const img = document.createElement('img');
            img.src = `${DATA_FOR_TOY_BASE}/aircrafticon/${modelId}.webp`;
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
                this._rafId = null;
                return;
            }

            const now = performance.now();
            const deltaMs = Math.max(now - this.lastFrameTime, 1);
            this.lastFrameTime = now;
            const delta = (deltaMs / (1000 / this.engine.targetFps)) * (this.engine.bulletEngine?.gSpeed ?? this.engine.gSpeed);
            this.timeElapsed += deltaMs / 1000;

            this._update(delta);
            this._render();

            this._rafId = requestAnimationFrame(animate);
        };
        this._rafId = requestAnimationFrame(animate);
    }

    _update(delta) {
        switch (this.state) {
            case 'CREATE': {
                const progress = Math.min(this.timeElapsed / this.createDuration, 1);
                this.altitude = this.targetAltitude * progress;
                if (progress >= 1) {
                    this.state = 'ATTACK';
                }
                break;
            }
            case 'ATTACK': {
                this.x += this.speed * this.direction * delta;

                // Brownian depth-axis wander (game: spawn_brownian == 1)
                if (this.brownianAmplitude > 0) {
                    this.brownianPhase += 0.05 * delta;
                    this.y += Math.sin(this.brownianPhase) * this.brownianAmplitude * 0.01 * delta;
                }

                // Slow descent during ATTACK, clamped to targetAltitude
                this.altitude = Math.max(this.targetAltitude, this.altitude - 0.04 * delta);

                // Fire each weapon independently when aircraft enters that weapon's range
                if (this.weaponsFiredSet.size < this.weaponIds.length) {
                    const dx = this.targetX - this.x;
                    const dy = (this.targetY || this.y) - this.y;
                    const distToTarget = Math.sqrt(dx * dx + dy * dy);

                    for (let wi = 0; wi < this.weaponIds.length; wi++) {
                        if (this.weaponsFiredSet.has(wi)) continue;
                        const weaponRange = this.weaponRanges?.[wi] ?? this.firingRange;
                        if (distToTarget < weaponRange) {
                            this.weaponsFiredSet.add(wi);
                            if (this.onFireWeapon) {
                                this.onFireWeapon(this.x, this.y, this.weaponIds[wi], wi);
                            }
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

        // During CREATE, visual size scales from 0.1 → 1.0
        const sizeScale = this.state === 'CREATE'
            ? Math.max(0.1, this.altitude / this.targetAltitude)
            : 1;

        const altitudeOffset = this.altitude * scale;
        const baseSize = this.element.classList.contains('has-icon') ? 40 : 20;
        const size = baseSize * sizeScale;

        // Icons face LEFT natively; direction=1 (flies RIGHT) needs horizontal flip
        const flipX = this.direction > 0 ? ' scaleX(-1)' : '';

        Object.assign(this.element.style, {
            left: `${screenPos.x - size / 2}px`,
            top: `${screenPos.y - size / 2 - altitudeOffset}px`,
            transform: `scale(${sizeScale})${flipX}`
        });
    }

    /** Immediately stop the aircraft: cancel animation frame, clear start timer, remove DOM element. */
    destroy() {
        this.shouldRemove = true;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        if (this._delayTimer) {
            clearTimeout(this._delayTimer);
            this._delayTimer = null;
        }
        if (this.element) {
            this.element.remove();
            this.element = null;
        }
    }
}
