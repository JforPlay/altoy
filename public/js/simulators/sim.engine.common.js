/**
 * sim.engine.common.js
 * Shared SimulationEngine class used by all three simulators (weapon, aircraft, fleet).
 * Wraps BulletEngine and OceanBackground, manages entities (ship sprites + enemy),
 * and exposes coordinate helpers, barrage transform resolution, and logging.
 */
import { OceanBackground } from './sim.engine.oceanbg.js';
import { BulletEngine } from './sim.engine.bullet.js';

export class SimulationEngine {
    constructor(options) {
        this.container = options.container;
        this.gameCoords = options.gameCoords;
        this.targetFps = options.targetFps || 30;
        // Pure playback multiplier (Phase 5b). `??` not `||` so an explicit 0
        // (pause) is preserved rather than coerced to the default.
        this.gSpeed = options.gSpeed ?? 1.0;

        // Data stores
        this.allBarrageData = {};
        this.allBulletData = {};
        this.allAircraftData = {};
        
        // DOM elements
        this.visualLog = options.visualLog;
        
        // Entity management
        this.entities = {};
        this.entityStates = {};
        
        // Initialize bullet engine
        this.bulletEngine = new BulletEngine({
            container: this.container,
            gameCoords: this.gameCoords,
            targetFps: this.targetFps,
            gSpeed: this.gSpeed
        });
        
        // Initialize ocean background if container exists
        if (this.container) {
            this.oceanBackground = new OceanBackground(this.container, this.gameCoords);
        }
    }

    // ===== Data =====

    setData(barrageData, bulletData) {
        this.allBarrageData = barrageData;
        this.allBulletData = bulletData;
        this.bulletEngine.setData(barrageData, bulletData);
    }

    // ===== Entity Management =====

    /**
     * Register entities for layout management
     * @param {Object} entityConfig - Configuration for entities
     * Example: {
     *   vanguard: { element: domElement, baseWidth: 6.5, aspectRatio: 178/226, gamePos: {x, y} },
     *   enemy: { element: domElement, baseWidth: 7.0, aspectRatio: 369/300, gamePos: {x, y} }
     * }
     */
    registerEntities(entityConfig) {
        this.entities = entityConfig;
    }

    /**
     * Register a dynamic state config for an entity whose position can change (e.g., enemy toggle).
     * stateConfig.getGamePos(state, gameCoords) is called by getEntityGamePos() to resolve position.
     */
    registerEntityState(entityName, stateConfig) {
        if (!this.entityStates[entityName]) {
            this.entityStates[entityName] = { 
                config: stateConfig,
                state: {}
            };
        }
    }

    /**
     * Update entity state value
     */
    setEntityState(entityName, stateKey, value) {
        if (this.entityStates[entityName]) {
            this.entityStates[entityName].state[stateKey] = value;
        }
    }

    /**
     * Get entity state value
     */
    getEntityState(entityName, stateKey) {
        return this.entityStates[entityName]?.state[stateKey];
    }

    /**
     * Get current game position for an entity (accounting for state)
     */
    getEntityGamePos(entityName) {
        const entity = this.entities[entityName];
        if (!entity) return null;

        // If entity has dynamic state, calculate position
        if (this.entityStates[entityName]?.config?.getGamePos) {
            return this.entityStates[entityName].config.getGamePos(
                this.entityStates[entityName].state,
                this.gameCoords
            );
        }

        // Otherwise return static gamePos
        return entity.gamePos;
    }

    /**
     * Update all entity positions and player area
     */
    updateLayoutAndScale(playerAreaElement = null) {
        this.bulletEngine.updateScale();
        
        // Update player area if provided
        if (playerAreaElement && this.gameCoords.playerArea) {
            const { minX, minY, maxX, maxY } = this.gameCoords.playerArea;
            const paScreenPos = this.bulletEngine.gameToScreen(minX, maxY);
            const paWidth = (maxX - minX) * this.bulletEngine.scale;
            const paHeight = (maxY - minY) * this.bulletEngine.scale;
            
            Object.assign(playerAreaElement.style, {
                left: `${paScreenPos.x}px`,
                top: `${paScreenPos.y}px`,
                width: `${paWidth}px`,
                height: `${paHeight}px`
            });
        }

        // Update all registered entities
        for (const [entityName, entity] of Object.entries(this.entities)) {
            if (!entity.element) continue;
            
            const gamePos = this.getEntityGamePos(entityName);
            if (!gamePos) continue;

            const baseWidth = entity.baseWidth || 6.5;
            const aspectRatio = entity.aspectRatio || 1;
            const width = baseWidth * this.bulletEngine.scale;
            const height = width * aspectRatio;
            
            entity.element.style.width = `${width}px`;
            const screenPos = this.bulletEngine.gameToScreen(gamePos.x, gamePos.y);
            Object.assign(entity.element.style, {
                left: `${screenPos.x - width / 2}px`,
                top: `${screenPos.y - height / 2}px`
            });
        }
    }

    /**
     * Get current screen position of entity center (for targeting)
     */
    getEntityScreenCenter(entityName) {
        const entity = this.entities[entityName];
        if (!entity?.element) return null;

        const rect = entity.element.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        
        return {
            x: rect.left - containerRect.left + rect.width / 2,
            y: rect.top - containerRect.top + rect.height / 2
        };
    }

    /**
     * Get entity's game coordinates (for targeting)
     */
    getEntityGameCoords(entityName) {
        const screenCenter = this.getEntityScreenCenter(entityName);
        if (!screenCenter) return null;
        
        return this.bulletEngine.screenToGame(screenCenter.x, screenCenter.y);
    }

    // ===== Utilities =====

    logToScreen(message, type = 'info') {
        if (!this.visualLog) return;
        const p = document.createElement('p');
        p.textContent = message;
        if (type === 'error') p.style.color = '#ff7675';
        else p.style.color = '#55efc4';
        this.visualLog.appendChild(p);
        setTimeout(() => p.style.opacity = '0', 4000);
        setTimeout(() => p.remove(), 5000);
    }

    convertToMs(value, timeUnitIsFrames = false) {
        return timeUnitIsFrames ? value * (1000 / this.targetFps) : value * 1000;
    }

    /**
     * Resolve a weapon by merging it with its base weapon if one is specified.
     * Upgrade-level weapons store only changed fields; non-null barrage_ID/bullet_ID override the base.
     */
    resolveWeapon(weaponId, weaponData) {
        const weapon = weaponData[weaponId];
        if (!weapon) return null;

        if (weapon.base) {
            const baseWeapon = weaponData[weapon.base];
            if (!baseWeapon) return weapon;
            
            // Merge base weapon with current weapon
            const resolvedWeapon = { ...baseWeapon, ...weapon };
            
            // Only override barrage_ID if it exists in the current weapon
            if (weapon.barrage_ID !== undefined && weapon.barrage_ID !== null) {
                resolvedWeapon.barrage_ID = weapon.barrage_ID;
            }
            
            // Only override bullet_ID if it exists in the current weapon
            if (weapon.bullet_ID !== undefined && weapon.bullet_ID !== null) {
                resolvedWeapon.bullet_ID = weapon.bullet_ID;
            }
            
            // Always preserve the weapon's own ID
            resolvedWeapon.id = weapon.id;
            
            return resolvedWeapon;
        }
        
        return weapon;
    }

    /**
     * Walk a barrage's trans_ID chain and build a transform array for mid-flight angle changes.
     * Each entry has a triggerTime (accumulated) and either a target angle or a target position.
     */
    generateTransformBarrages(barrageID, direction, primalIndex) {
        const transformChain = [];
        let currentBarrage = this.allBarrageData[barrageID];

        while (currentBarrage && currentBarrage.trans_ID && currentBarrage.trans_ID !== -1) {
            const transBarrage = this.allBarrageData[currentBarrage.trans_ID];
            if (!transBarrage) break;

            const transformData = {
                barrage: transBarrage,
                transStartDelay: (transBarrage.first_delay || 0) +
                    (transBarrage.delay || 0) * primalIndex +
                    (transBarrage.delta_delay || 0) * primalIndex
            };

            if (transBarrage.offset_prioritise) {
                transformData.transAimPosX = (transBarrage.offset_x || 0) +
                    (transBarrage.delta_offset_x || 0) * primalIndex;
                transformData.transAimPosZ = (transBarrage.offset_z || 0) +
                    (transBarrage.delta_offset_z || 0) * primalIndex;
            } else {
                transformData.transAimAngle = (transBarrage.angle || 0) +
                    (transBarrage.delta_angle || 0) * primalIndex;
                if (direction === -1) {
                    transformData.transAimAngle += 180;
                }
            }

            transformChain.push(transformData);
            currentBarrage = transBarrage;
        }

        return transformChain;
    }

    clearBullets() {
        this.bulletEngine.clearAllBullets();
        document.querySelectorAll('.bullet').forEach(b => b.remove());
    }

    destroy() {
        if (this.bulletEngine) {
            this.bulletEngine.destroy();
        }
        if (this.oceanBackground) {
            this.oceanBackground.destroy();
        }
    }
}