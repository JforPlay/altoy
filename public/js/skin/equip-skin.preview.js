/**
 * equip-skin.preview.js
 * Canvas-based preview engine for equipment skins — fires weapon barrages or spawns aircraft
 * using the existing SimulationEngine and AircraftEntity from the simulator module.
 * Part of the equip skin viewer group (equip-skin-viewer.js + equip-skin.data.js + equip-skin.preview.js).
 * Provides loop/pause/speed playback controls on top of the underlying engine.
 */
import { showElement, hideElement } from '../utils.js';
import { SimulationEngine } from '../simulators/sim.engine.common.js';
import { AircraftEntity } from '../simulators/sim.engine.aircraft.js';

// Zoomed-in view centered on vanguard↔enemy area
// Slightly wider for aircraft to have room to fly. 110 units X, ~1.8x zoom vs full sim.
const GAME_COORDS = {
    totalArea: { minX: -65, minY: 38, maxX: 45, maxY: 78 },
    playerArea: { minX: -65, minY: 38, maxX: 15, maxY: 78 }
};
const VANGUARD_POS = { x: -36, y: 58 };
const ENEMY_POS = { x: 15, y: 58 };
const TARGET_FPS = 30;
const DEFAULT_SPEED = 1.5;

/** Aircraft equip_type codes (checked against skin.equip_type array, not skin.type) */
const AIRCRAFT_EQUIP_TYPES = new Set([7, 8, 9, 12, 15]);

function cssUrl(url) {
    return String(url).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]/g, '');
}

class EquipSkinPreview {
    constructor(container, dataModule) {
        this.container = container;
        this.data = dataModule;
        this.engine = null;
        this.currentSkin = null;
        this.loopTimer = null;
        this.fireTimers = [];
        this.activeAircraft = [];
        this.isLooping = false;
        this.isPaused = false;
        this.onError = null;
        this._fireToken = 0;
        this._loadingEl = container.querySelector('#preview-loading');

        // Dynamic style element for skin sprite overrides
        this._styleEl = document.createElement('style');
        this._styleEl.id = 'esv-skin-style';
        document.head.appendChild(this._styleEl);
    }

    /**
     * Create and configure the SimulationEngine: register vanguard/enemy entities,
     * set layout/scale, and wire the pixel area to the DOM container.
     */
    init() {
        this.engine = new SimulationEngine({
            container: this.container,
            gameCoords: GAME_COORDS,
            targetFps: TARGET_FPS,
            gSpeed: DEFAULT_SPEED
        });

        const vanguard = document.getElementById('vanguard');
        const enemy = document.getElementById('enemy');

        this.engine.registerEntities({
            vanguard: {
                element: vanguard,
                baseWidth: 6.5,
                aspectRatio: 178 / 226,
                gamePos: VANGUARD_POS
            },
            enemy: {
                element: enemy,
                baseWidth: 7.0,
                aspectRatio: 369 / 300
            }
        });

        this.engine.registerEntityState('enemy', {
            getGamePos: () => ENEMY_POS
        });
        this.engine.setEntityState('enemy', 'centered', true);

        const playerArea = document.getElementById('player-area');
        this.engine.updateLayoutAndScale(playerArea);
    }

    setSimData(barrageData, bulletData) {
        this.engine.setData(barrageData, bulletData);
    }

    /**
     * Apply a skin's sprite as the bullet visual via CSS injection.
     * Uses the preloaded image dimensions to set a visible display size.
     */
    applySkinSprite(skin, spriteImg) {
        const bulletName = skin.bullet_name;
        if (!bulletName || !spriteImg) {
            this._styleEl.textContent = '';
            return;
        }

        const aspectRatio = spriteImg.width / spriteImg.height;
        const displayHeight = 48; // Large enough to clearly see skin sprite details
        const displayWidth = Math.round(displayHeight * aspectRatio);

        const spriteUrl = this.data.getSpriteUrl(bulletName);
        this._styleEl.textContent = `
            #simulation-container .bullet.esv-skin-bullet {
                width: ${displayWidth}px !important;
                height: ${displayHeight}px !important;
                background: none !important;
                background-image: url('${cssUrl(spriteUrl)}') !important;
                background-size: contain !important;
                background-repeat: no-repeat !important;
                background-position: center !important;
                box-shadow: none !important;
                border-radius: 0 !important;
                opacity: 1 !important;
            }
        `;
    }

    /**
     * Fire the skin's preview — dispatches to bullet or aircraft mode based on skin type
     */
    async fireSkin(skin) {
        const fireToken = ++this._fireToken;
        this.clearAll();
        this.currentSkin = skin;

        // The first fire downloads the simulator data (~32 MiB raw) with nothing
        // on the stage. Only the cold path gets the spinner: once loaded,
        // startLoop re-fires every 3s and a per-cycle flash would strobe.
        if (!this.data.simDataLoaded) showElement(this._loadingEl);
        try {
            await this.data.loadSimData();
            if (fireToken !== this._fireToken) return false;
            this.setSimData(this.data.barrageData, this.data.bulletData);

            const spriteImg = await this.data.preloadSprite(skin.bullet_name);
            if (fireToken !== this._fireToken) return false;

            const isAircraft = (skin.equip_type || []).some(t => AIRCRAFT_EQUIP_TYPES.has(t));
            if (isAircraft) {
                this._fireAircraft(skin, spriteImg);
            } else {
                this.applySkinSprite(skin, spriteImg);
                const weaponIds = skin.weapon_ids || [];
                for (const weaponId of weaponIds) {
                    this._fireWeapon(weaponId, skin);
                }
            }
            return true;
        } catch (error) {
            if (fireToken === this._fireToken) {
                this.clearAll();
            }
            throw error;
        } finally {
            hideElement(this._loadingEl);
        }
    }

    // === AIRCRAFT PREVIEW ===

    /**
     * Spawn aircraft entities that fly across with the skin sprite as their icon.
     * Aircraft skins' weapon_ids are the weapons the aircraft carries —
     * we fire those as sub-weapon barrages when the aircraft reaches firing range.
     */
    _fireAircraft(skin, spriteImg) {
        const spriteUrl = spriteImg ? this.data.getSpriteUrl(skin.bullet_name) : null;
        const count = skin.weapon_ids?.length || 1;
        const subWeaponIds = skin.weapon_ids || [];

        // Inject CSS for aircraft icon using the skin sprite.
        // Skin sprites face RIGHT natively, but AircraftEntity applies scaleX(-1)
        // for direction=1 (assuming icons face left). Counter-flip the icon.
        if (spriteUrl) {
            this._styleEl.textContent = `
                #simulation-container .aircraft-entity.esv-skin-aircraft .aircraft-icon {
                    content: url('${cssUrl(spriteUrl)}');
                    width: 48px !important;
                    height: auto !important;
                    transform: scaleX(-1);
                }
            `;
        } else {
            this._styleEl.textContent = '';
        }

        for (let i = 0; i < Math.max(count, 1); i++) {
            const startY = VANGUARD_POS.y + (i - (count - 1) / 2) * 3;

            // Build a minimal aircraftData for the entity
            const aircraftData = {
                model_ID: skin.bullet_name,
                speed: 40,
                type: skin.type === 7 ? 1 : skin.type === 8 ? 2 : 3,
                spawn_brownian: 0
            };

            const aircraft = new AircraftEntity({
                engine: this.engine,
                aircraftData,
                weaponIds: subWeaponIds,
                startX: VANGUARD_POS.x - 15,
                startY,
                targetX: ENEMY_POS.x,
                targetY: ENEMY_POS.y,
                direction: 1,
                startDelay: i * 200,
                firingRange: 35
            });

            // Override the aircraft icon with the skin sprite
            if (spriteUrl && aircraft.element) {
                const existingImg = aircraft.element.querySelector('.aircraft-icon');
                if (existingImg) {
                    existingImg.src = spriteUrl;
                } else {
                    const img = document.createElement('img');
                    img.src = spriteUrl;
                    img.alt = skin.bullet_name;
                    img.draggable = false;
                    img.className = 'aircraft-icon';
                    aircraft.element.appendChild(img);
                    aircraft.element.classList.add('has-icon');
                }
                aircraft.element.classList.add('esv-skin-aircraft');
            }

            // When aircraft fires, create skin-styled bullets from its sub-weapons.
            // All bullets fire toward the enemy — the engine's GravityBehavior
            // automatically creates the parabolic arc for bombs (type=2).
            aircraft.onFireWeapon = (x, y, weaponId) => {
                this.applySkinSprite(skin, spriteImg);
                const weapon = this.engine.resolveWeapon(weaponId, this.data.weaponData);
                if (!weapon) return;

                const barrageIds = weapon.barrage_ID || [];
                const bulletIds = weapon.bullet_ID || [];
                for (let bi = 0; bi < barrageIds.length; bi++) {
                    const barrage = this.data.barrageData[barrageIds[bi]];
                    const bulletInfo = this.data.bulletData[bulletIds[bi] || bulletIds[0]];
                    if (!barrage || !bulletInfo) continue;

                    const skinBulletInfo = { ...bulletInfo, modle_ID: 'esv-skin-bullet' };
                    // Fire toward enemy — gravity handles the drop arc for bombs
                    this._fireBarrageFrom({ x, y }, barrage, skinBulletInfo);
                }
            };

            this.activeAircraft.push(aircraft);
        }
    }

    // === BULLET PREVIEW ===

    /**
     * Resolve a weapon from its ID and fire all its barrage/bullet pairs from VANGUARD_POS.
     */
    _fireWeapon(weaponId, skin) {
        const weapon = this.engine.resolveWeapon(weaponId, this.data.weaponData);
        if (!weapon) return;

        const barrageIds = weapon.barrage_ID || [];
        const bulletIds = weapon.bullet_ID || [];

        for (let i = 0; i < barrageIds.length; i++) {
            const barrageId = barrageIds[i];
            const bulletId = bulletIds[i] || bulletIds[0];
            const barrage = this.data.barrageData[barrageId];
            const bulletInfo = this.data.bulletData[bulletId];
            if (!barrage || !bulletInfo) continue;

            const skinBulletInfo = { ...bulletInfo, modle_ID: 'esv-skin-bullet' };
            this._fireBarrageFrom(VANGUARD_POS, barrage, skinBulletInfo);
        }
    }

    /**
     * Fire a barrage pattern from a given position.
     * Supports multi-salvo (senior_repeat), per-bullet offsets and timing.
     * @param {number|null} overrideBaseAngle - If set, use this angle instead of aiming at enemy.
     *   Used for aircraft sub-weapons: bombs drop at 90°, torpedoes at ~15°.
     */
    _fireBarrageFrom(origin, barrage, bulletInfo, overrideBaseAngle = null) {
        let baseAngle;
        if (overrideBaseAngle !== null) {
            baseAngle = overrideBaseAngle;
        } else {
            const dx = ENEMY_POS.x - origin.x;
            const dy = ENEMY_POS.y - origin.y;
            baseAngle = Math.atan2(dy, dx) * (180 / Math.PI);
        }

        const bulletCount = barrage.primal_repeat || 1;
        const seniorRepeat = barrage.senior_repeat || 0;
        const totalSalvos = seniorRepeat + 1;
        const spreadAngle = barrage.angle || 0;
        const deltaAngle = barrage.delta_angle || 0;
        const firstDelay = (barrage.first_delay || 0) * 1000;
        const seniorDelay = (barrage.senior_delay || 0) * 1000;
        const bulletDelay = (barrage.delay || 0) * 1000;
        const deltaBulletDelay = (barrage.delta_delay || 0) * 1000;

        for (let salvo = 0; salvo < totalSalvos; salvo++) {
            const salvoDelay = firstDelay + salvo * seniorDelay;

            for (let j = 0; j < bulletCount; j++) {
                let angle;
                if (bulletCount === 1) {
                    angle = baseAngle + deltaAngle * salvo;
                } else {
                    const startAngle = baseAngle - spreadAngle / 2;
                    const angleStep = spreadAngle / (bulletCount - 1);
                    angle = startAngle + angleStep * j + deltaAngle * salvo;
                }

                const offsetX = (barrage.offset_x || 0) + j * (barrage.delta_offset_x || 0);
                const offsetZ = (barrage.offset_z || 0) + j * (barrage.delta_offset_z || 0);
                const gameX = origin.x + offsetX;
                const gameY = origin.y + offsetZ;

                const screenPos = this.engine.bulletEngine.gameToScreen(gameX, gameY);

                const perBulletDelay = j * (bulletDelay + j * deltaBulletDelay);
                const totalDelay = salvoDelay + perBulletDelay;

                const fireFn = () => {
                    this.engine.bulletEngine.createBullet({
                        startX: screenPos.x,
                        startY: screenPos.y,
                        angle,
                        bulletInfo,
                        enemyTarget: ENEMY_POS
                    });
                };

                if (totalDelay > 0) {
                    const timerId = setTimeout(fireFn, totalDelay);
                    this.fireTimers.push(timerId);
                } else {
                    fireFn();
                }
            }
        }
    }

    // === PLAYBACK CONTROLS ===

    startLoop(skin) {
        this.stopLoop();
        this.isLooping = true;
        const cycle = async () => {
            if (!this.isLooping) return;
            try {
                await this.fireSkin(skin);
            } catch (error) {
                this.stopLoop();
                if (typeof this.onError === 'function') {
                    this.onError(error);
                } else {
                    console.error('Equipment skin preview loop failed:', error);
                }
                return;
            }
            if (this.isLooping) {
                this.loopTimer = setTimeout(cycle, 3000);
            }
        };
        cycle();
    }

    stopLoop() {
        this.isLooping = false;
        if (this.loopTimer) {
            clearTimeout(this.loopTimer);
            this.loopTimer = null;
        }
    }

    clearAll() {
        this._styleEl.textContent = '';
        this.fireTimers.forEach(id => clearTimeout(id));
        this.fireTimers = [];
        this.activeAircraft.forEach(a => a.destroy());
        this.activeAircraft = [];
        if (this.engine) {
            this.engine.clearBullets();
        }
    }

    cancelPending() {
        this._fireToken++;
        this.clearAll();
    }

    setSpeed(speed) {
        if (this.engine) {
            this.engine.bulletEngine.gSpeed = speed;
        }
    }

    pause() {
        this.isPaused = true;
        if (this.engine) this.engine.bulletEngine.gSpeed = 0;
    }

    resume(speed) {
        this.isPaused = false;
        if (this.engine) this.engine.bulletEngine.gSpeed = speed;
    }

    destroy() {
        this.stopLoop();
        this.cancelPending();
        if (this._styleEl.parentNode) {
            this._styleEl.parentNode.removeChild(this._styleEl);
        }
    }
}

export { EquipSkinPreview };
