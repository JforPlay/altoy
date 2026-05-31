/**
 * sim.weapon.data.js
 * Data loader for the weapon simulator page (sim.weapon.main.js).
 * Loads skill and chunk-index data upfront; weapon/barrage/bullet data is loaded
 * on-demand per chunk when a skill is selected (~200–500 KB per chunk vs ~5 MB total).
 * Part of the simulators module group.
 */

import { fetchJSONWithCache } from '../utils.js';

export class WeaponSimData {
    constructor(simEngine) {
        this.simEngine = simEngine;
        this.allWeaponData = {};
        this.allSkillData = {};
        this.skillTemplateData = {};
        this.timeUnitIsFrames = false;

        // Chunk loading state
        this.chunkIndex = null;       // weaponId -> chunk number mapping
        this.loadedChunks = new Set(); // track which chunks are already loaded
        this._chunkLoadPromises = {};  // dedup concurrent loads of same chunk
    }

    async loadData() {
        try {
            this.simEngine.logToScreen('Loading skill data...');

            // Load only skill data and chunk index upfront (much smaller than full data)
            const [skillData, skillTemplateData, chunkIndex, aircraftData] = await Promise.all([
                fetchJSONWithCache('data/sim/skill_weapon_data.json'),
                fetchJSONWithCache('data/sim/skill_data_template.json'),
                fetchJSONWithCache('data/sim/weapon_chunks/chunk_index.json'),
                fetchJSONWithCache('data/sim/aircraft_template.json')
            ]);

            this.allSkillData = skillData;
            this.skillTemplateData = skillTemplateData;
            this.chunkIndex = chunkIndex;
            this.simEngine.allAircraftData = aircraftData;

            // Initialize empty barrage/bullet stores on the engine
            this.simEngine.setData({}, {});

            this.simEngine.logToScreen(`Skill data loaded (${Object.keys(skillData).length} skills, ${chunkIndex.totalWeapons} weapons in ${chunkIndex.chunkCount} chunks)`);

            return {
                weapons: this.allWeaponData,
                barrages: {},
                bullets: {},
                skills: this.allSkillData,
                skillTemplates: this.skillTemplateData
            };
        } catch (error) {
            console.error('Error loading weapon simulation data:', error);
            this.simEngine.logToScreen(`Error: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Load a weapon chunk by chunk number. Merges data into existing stores.
     * Returns immediately if chunk is already loaded. Deduplicates concurrent loads.
     */
    async _loadChunk(chunkNum) {
        if (this.loadedChunks.has(chunkNum)) return;

        // Dedup: if already loading this chunk, wait for that promise
        if (this._chunkLoadPromises[chunkNum]) {
            return this._chunkLoadPromises[chunkNum];
        }

        const paddedNum = String(chunkNum).padStart(3, '0');
        this._chunkLoadPromises[chunkNum] = (async () => {
            try {
                const chunk = await fetchJSONWithCache(`data/sim/weapon_chunks/chunk_${paddedNum}.json`);

                // Merge weapon data
                Object.assign(this.allWeaponData, chunk.weapons);

                // Merge barrage and bullet data into the engine's stores
                Object.assign(this.simEngine.allBarrageData, chunk.barrages);
                Object.assign(this.simEngine.allBulletData, chunk.bullets);

                // Also update bulletEngine's data references if they're separate objects
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

    /**
     * Ensure weapon data is available by loading its chunk if needed.
     * Returns true if the weapon exists after loading.
     */
    async ensureWeaponLoaded(weaponId) {
        const wId = String(weaponId);

        // Already loaded?
        if (this.allWeaponData[wId]) return true;

        // Find which chunk contains this weapon
        if (!this.chunkIndex) return false;
        const chunkNum = this.chunkIndex.weaponToChunk[wId];
        if (chunkNum === undefined) return false;

        await this._loadChunk(chunkNum);
        return !!this.allWeaponData[wId];
    }

    /**
     * Load all weapon chunks referenced by a skill's weapon IDs.
     * Call this before firing a skill to ensure all data is available.
     */
    async ensureSkillWeaponsLoaded(skillId, level = '1') {
        const weaponInfoList = this.getWeaponIdsFromSkill(skillId, level);
        if (weaponInfoList.length === 0) return;

        // Find unique chunks needed
        const chunksNeeded = new Set();
        const addChunk = (weaponId) => {
            const chunkNum = this.chunkIndex?.weaponToChunk[String(weaponId)];
            if (chunkNum !== undefined && !this.loadedChunks.has(chunkNum)) {
                chunksNeeded.add(chunkNum);
            }
        };
        weaponInfoList.forEach(info => {
            addChunk(info.weaponId);
            // An aircraft launcher (weapon_id is an aircraft_template) carries its real
            // payload on sub-weapons; pull those chunks too so both the weapon cards and
            // the spawnAircraft firing path can resolve the bomb/torpedo data.
            const aircraftData = this.simEngine.allAircraftData?.[info.weaponId];
            if (aircraftData?.weapon_ID) aircraftData.weapon_ID.forEach(addChunk);
        });

        // Load all needed chunks in parallel
        if (chunksNeeded.size > 0) {
            this.simEngine.logToScreen(`Loading ${chunksNeeded.size} weapon chunk(s)...`);
            await Promise.all([...chunksNeeded].map(c => this._loadChunk(c)));
        }
    }

    /**
     * Extract weapon IDs from a skill's effect_list at the given level.
     * Falls back through level → '1' → root effect_list to handle different data shapes.
     * Also captures quota and time fields used for barrage count and fire delay.
     */
    getWeaponIdsFromSkill(skillId, level = '1') {
        const weaponInfoList = [];
        const foundWeaponIds = new Set();
        const skill = this.allSkillData[skillId];
        if (!skill) return weaponInfoList;

        let effectList = null;

        if (skill[level]?.effect_list) {
            effectList = skill[level].effect_list;
        } else if (skill['1']?.effect_list) {
            effectList = skill['1'].effect_list;
        } else if (skill.effect_list) {
            effectList = skill.effect_list;
        }

        if (!effectList) return weaponInfoList;

        for (const effect of effectList) {
            if (effect.arg_list && effect.arg_list.weapon_id) {
                const weaponId = effect.arg_list.weapon_id.toString();

                if (!foundWeaponIds.has(weaponId)) {
                    const weaponInfo = { weaponId: weaponId };

                    // Capture quota and time if they exist
                    if (effect.quota !== undefined) {
                        weaponInfo.quota = effect.quota;
                    }
                    if (effect.time !== undefined) {
                        weaponInfo.time = effect.time;
                    }

                    // §E6: carry the Lua emitter class so the firing pipeline can
                    // pick the shotgun (replace-angle) emitter when selected.
                    if (effect.arg_list.emitter !== undefined) {
                        weaponInfo.emitter = effect.arg_list.emitter;
                    }

                    weaponInfoList.push(weaponInfo);
                    foundWeaponIds.add(weaponId);
                }
            }
        }
        return weaponInfoList;
    }

    getSkillById(skillId) {
        const skillData = this.allSkillData[skillId];
        if (!skillData) return null;

        const templateData = this.skillTemplateData[skillId];
        if (templateData) {
            return {
                ...skillData,
                name: templateData.name || skillData.name,
                desc: templateData.desc || skillData.desc,
                desc_get_add: templateData.desc_get_add,
                desc_get: templateData.desc_get
            };
        }

        return skillData;
    }

    getWeaponById(weaponId) {
        return this.simEngine.resolveWeapon(weaponId, this.allWeaponData);
    }

    getAllSkills() {
        return this.allSkillData;
    }

    getAllWeapons() {
        return this.allWeaponData;
    }

    getSkillName(skillId) {
        const templateData = this.skillTemplateData[skillId];
        return templateData?.name || this.allSkillData[skillId]?.name || `Skill ${skillId}`;
    }

    /**
     * Raw skill_data_template entry (name/desc/desc_get/desc_get_add).
     * Unlike getSkillById, this does NOT require the skill to be in
     * skill_weapon_data — cross-fleet trigger skills live only in the template.
     */
    getSkillTemplate(skillId) {
        return this.skillTemplateData[skillId] || null;
    }
}
