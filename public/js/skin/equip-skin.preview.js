/**
 * Equipment Skin Preview Module
 * Canvas-based firing preview using the existing sim engine
 */
import { SimulationEngine } from '../simulators/sim.engine.common.js';

const GAME_COORDS = {
    totalArea: { minX: -120, minY: 30, maxX: 80, maxY: 85 },
    playerArea: { minX: -120, minY: 30, maxX: 15, maxY: 85 }
};
const TARGET_FPS = 30;
const DEFAULT_SPEED = 1.5;

class EquipSkinPreview {
    constructor(container, dataModule) {
        this.container = container;
        this.data = dataModule;
        this.engine = null;
        this.currentSkin = null;
        this.loopTimer = null;
        this.fireTimers = [];
        this.isLooping = false;
        this.isPaused = false;

        // Dynamic style element for skin sprite overrides
        this._styleEl = document.createElement('style');
        this._styleEl.id = 'esv-skin-style';
        document.head.appendChild(this._styleEl);
    }

    init() {
        this.engine = new SimulationEngine({
            container: this.container,
            gameCoords: GAME_COORDS,
            targetFps: TARGET_FPS,
            gSpeed: DEFAULT_SPEED
        });

        // Register entities
        const vanguard = document.getElementById('vanguard');
        const enemy = document.getElementById('enemy');

        this.engine.registerEntities({
            vanguard: {
                element: vanguard,
                baseWidth: 6.5,
                aspectRatio: 178 / 226,
                gamePos: { x: -36, y: 58 }
            },
            enemy: {
                element: enemy,
                baseWidth: 7.0,
                aspectRatio: 369 / 300
            }
        });

        this.engine.registerEntityState('enemy', {
            getGamePos: () => ({ x: 15, y: 58 })
        });
        this.engine.setEntityState('enemy', 'centered', true);

        const playerArea = document.getElementById('player-area');
        this.engine.updateLayoutAndScale(playerArea);
        // Resize handling done by main controller (debounced)
    }

    /**
     * Set sim data on the engine
     */
    setSimData(barrageData, bulletData) {
        this.engine.setData(barrageData, bulletData);
    }

    /**
     * Apply a skin's sprite as the bullet visual via CSS injection
     */
    applySkinSprite(skin, spriteImg) {
        const bulletName = skin.bullet_name;
        if (!bulletName || !spriteImg) {
            this._styleEl.textContent = '';
            return;
        }

        const spriteUrl = this.data.getSpriteUrl(bulletName);
        // Override all bullets created during this skin's preview
        this._styleEl.textContent = `
            #simulation-container .bullet.esv-skin-bullet {
                background: none !important;
                background-image: url('${spriteUrl}') !important;
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
     * Fire the skin's weapon_ids barrage
     */
    async fireSkin(skin) {
        this.clearAll();
        this.currentSkin = skin;

        // Ensure sim data is loaded
        await this.data.loadSimData();
        this.setSimData(this.data.barrageData, this.data.bulletData);

        // Preload sprite
        const spriteImg = await this.data.preloadSprite(skin.bullet_name);
        this.applySkinSprite(skin, spriteImg);

        // Fire each weapon_id
        const weaponIds = skin.weapon_ids || [];
        for (const weaponId of weaponIds) {
            this._fireWeapon(weaponId, skin);
        }
    }

    /**
     * Fire a single weapon's barrage
     * Uses engine.resolveWeapon() to handle base/child weapon inheritance
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

            // Override bullet modle_ID with skin class for CSS targeting
            const skinBulletInfo = {
                ...bulletInfo,
                modle_ID: 'esv-skin-bullet'
            };

            this._fireBarrage(weapon, barrage, skinBulletInfo, skin);
        }
    }

    /**
     * Fire a barrage pattern with correct coordinate conversion and multi-salvo support.
     * Barrage fields: primal_repeat (bullets per salvo), senior_repeat (number of salvos),
     * offset_x/offset_z (base offsets), delta_offset_x/delta_offset_z (per-bullet increments),
     * angle (spread), delta_angle (per-bullet angle increment), first_delay (seconds),
     * senior_delay (seconds between salvos), delay/delta_delay (per-bullet timing).
     */
    _fireBarrage(weapon, barrage, bulletInfo, skin) {
        const vanguardPos = { x: -36, y: 58 };
        const enemyPos = { x: 15, y: 58 };

        // Base angle toward enemy
        const dx = enemyPos.x - vanguardPos.x;
        const dy = enemyPos.y - vanguardPos.y;
        const baseAngle = Math.atan2(dy, dx) * (180 / Math.PI);

        const bulletCount = barrage.primal_repeat || 1;
        const seniorRepeat = barrage.senior_repeat || 0;
        const totalSalvos = seniorRepeat + 1;
        const spreadAngle = barrage.angle || 0;
        const deltaAngle = barrage.delta_angle || 0;
        const firstDelay = (barrage.first_delay || 0) * 1000;     // seconds -> ms
        const seniorDelay = (barrage.senior_delay || 0) * 1000;   // seconds -> ms
        const bulletDelay = (barrage.delay || 0) * 1000;          // per-bullet delay
        const deltaBulletDelay = (barrage.delta_delay || 0) * 1000;

        for (let salvo = 0; salvo < totalSalvos; salvo++) {
            const salvoDelay = firstDelay + salvo * seniorDelay;

            for (let j = 0; j < bulletCount; j++) {
                // Per-bullet angle: spread evenly + delta_angle per bullet
                let angle;
                if (bulletCount === 1) {
                    angle = baseAngle + deltaAngle * salvo;
                } else {
                    const startAngle = baseAngle - spreadAngle / 2;
                    const angleStep = spreadAngle / (bulletCount - 1);
                    angle = startAngle + angleStep * j + deltaAngle * salvo;
                }

                // Per-bullet position offset (game coords)
                const offsetX = (barrage.offset_x || 0) + j * (barrage.delta_offset_x || 0);
                const offsetZ = (barrage.offset_z || 0) + j * (barrage.delta_offset_z || 0);
                const gameX = vanguardPos.x + offsetX;
                const gameY = vanguardPos.y + offsetZ;

                // Convert game coords to screen coords for createBullet
                const screenPos = this.engine.bulletEngine.gameToScreen(gameX, gameY);

                // Per-bullet timing
                const perBulletDelay = j * (bulletDelay + j * deltaBulletDelay);
                const totalDelay = salvoDelay + perBulletDelay;

                const fireFn = () => {
                    this.engine.bulletEngine.createBullet({
                        startX: screenPos.x,
                        startY: screenPos.y,
                        angle,
                        bulletInfo,
                        enemyTarget: enemyPos
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

    /**
     * Start auto-fire loop (1.5s fire, 3s pause)
     */
    startLoop(skin) {
        this.isLooping = true;
        const cycle = async () => {
            if (!this.isLooping) return;
            await this.fireSkin(skin);
            this.loopTimer = setTimeout(cycle, 3000);
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
        this.fireTimers.forEach(id => clearTimeout(id));
        this.fireTimers = [];
        if (this.engine) {
            this.engine.clearBullets();
        }
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
        this.clearAll();
        if (this._styleEl.parentNode) {
            this._styleEl.parentNode.removeChild(this._styleEl);
        }
    }
}

export { EquipSkinPreview };
