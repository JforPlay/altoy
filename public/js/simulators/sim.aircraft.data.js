import { fetchJSONWithCache } from '../utils.js';

/**
 * Aircraft Simulation Data Loader
 * Loads equipment data (aircraft types 7,8,9,12,15) for the selector,
 * and resolves aircraft_template → weapon chunks for simulation.
 */

const AIRCRAFT_EQUIP_TYPES = new Set([7, 8, 9, 12, 15]);

export class AircraftSimData {
    constructor(simEngine) {
        this.simEngine = simEngine;
        this.allWeaponData = {};
        this.equipList = [];
        this.equipFullData = {};

        this.chunkIndex = null;
        this.loadedChunks = new Set();
        this._chunkLoadPromises = {};
    }

    async loadData() {
        try {
            this.simEngine.logToScreen('Loading aircraft data...');

            const [equipLite, equipFull, chunkIndex, aircraftData] = await Promise.all([
                fetchJSONWithCache('data/equip/equip_data_lite.json'),
                fetchJSONWithCache('data/equip/equip_data_full.json'),
                fetchJSONWithCache('data/sim/weapon_chunks/chunk_index.json'),
                fetchJSONWithCache('data/sim/aircraft_template.json')
            ]);

            this.equipList = (Array.isArray(equipLite) ? equipLite : Object.values(equipLite))
                .filter(e => AIRCRAFT_EQUIP_TYPES.has(e.type));

            if (typeof equipFull === 'object' && !Array.isArray(equipFull)) {
                this.equipFullData = equipFull;
            } else if (Array.isArray(equipFull)) {
                for (const e of equipFull) this.equipFullData[e.id] = e;
            }

            this.chunkIndex = chunkIndex;
            this.simEngine.allAircraftData = aircraftData;
            this.simEngine.setData({}, {});

            this.simEngine.logToScreen(
                `Aircraft data loaded (${this.equipList.length} aircraft equipment)`
            );

            return { equipList: this.equipList };
        } catch (error) {
            console.error('Error loading aircraft simulation data:', error);
            this.simEngine.logToScreen(`Error: ${error.message}`, 'error');
            throw error;
        }
    }

    /** Deduplicate equipment by name — keep highest rarity (max upgrade tier) per name */
    getDeduplicatedList() {
        const byName = {};
        for (const equip of this.equipList) {
            if (!byName[equip.name] || equip.rarity > byName[equip.name].rarity) {
                byName[equip.name] = equip;
            }
        }
        return Object.values(byName).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    }

    getEquipFull(equipId) {
        return this.equipFullData[String(equipId)] || null;
    }

    getAircraftTemplate(weaponId) {
        return this.simEngine.allAircraftData?.[String(weaponId)] || null;
    }

    getWeaponIdsForLevel(equipId, levelIndex) {
        const full = this.getEquipFull(equipId);
        if (!full?.levels) return [];
        const level = full.levels[levelIndex];
        return level?.weapon_id || [];
    }

    getMaxLevelIndex(equipId) {
        const full = this.getEquipFull(equipId);
        return full?.levels ? full.levels.length - 1 : 0;
    }

    // --- Chunk Loading ---

    async _loadChunk(chunkNum) {
        if (this.loadedChunks.has(chunkNum)) return;
        if (this._chunkLoadPromises[chunkNum]) return this._chunkLoadPromises[chunkNum];

        const paddedNum = String(chunkNum).padStart(3, '0');
        this._chunkLoadPromises[chunkNum] = (async () => {
            try {
                const chunk = await fetchJSONWithCache(
                    `data/sim/weapon_chunks/chunk_${paddedNum}.json`
                );
                Object.assign(this.allWeaponData, chunk.weapons);
                Object.assign(this.simEngine.allBarrageData, chunk.barrages);
                Object.assign(this.simEngine.allBulletData, chunk.bullets);
                if (this.simEngine.bulletEngine) {
                    Object.assign(this.simEngine.bulletEngine.allBarrageData || {}, chunk.barrages);
                    Object.assign(this.simEngine.bulletEngine.allBulletData || {}, chunk.bullets);
                }
                this.loadedChunks.add(chunkNum);
            } finally {
                delete this._chunkLoadPromises[chunkNum];
            }
        })();
        return this._chunkLoadPromises[chunkNum];
    }

    async ensureWeaponLoaded(weaponId) {
        const wId = String(weaponId);
        if (this.allWeaponData[wId]) return true;
        if (!this.chunkIndex) return false;
        const chunkNum = this.chunkIndex.weaponToChunk[wId];
        if (chunkNum === undefined) return false;
        await this._loadChunk(chunkNum);
        return !!this.allWeaponData[wId];
    }

    async ensureAircraftWeaponsLoaded(equipId, levelIndex) {
        const weaponIds = this.getWeaponIdsForLevel(equipId, levelIndex);
        const chunksNeeded = new Set();

        for (const wid of weaponIds) {
            const chunkNum = this.chunkIndex?.weaponToChunk[String(wid)];
            if (chunkNum !== undefined && !this.loadedChunks.has(chunkNum)) {
                chunksNeeded.add(chunkNum);
            }

            const aircraft = this.getAircraftTemplate(wid);
            if (aircraft?.weapon_ID) {
                for (const subWid of aircraft.weapon_ID) {
                    const subChunk = this.chunkIndex?.weaponToChunk[String(subWid)];
                    if (subChunk !== undefined && !this.loadedChunks.has(subChunk)) {
                        chunksNeeded.add(subChunk);
                    }
                }
            }
        }

        if (chunksNeeded.size > 0) {
            this.simEngine.logToScreen(`Loading ${chunksNeeded.size} weapon chunk(s)...`);
            await Promise.all([...chunksNeeded].map(c => this._loadChunk(c)));
        }
    }

    getWeaponById(weaponId) {
        return this.simEngine.resolveWeapon(weaponId, this.allWeaponData);
    }
}
