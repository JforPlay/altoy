/**
 * Weapon Simulation Data Loader
 * Handles loading and management of weapon/skill specific data
 */

class WeaponSimData {
    constructor(simEngine) {
        this.simEngine = simEngine;
        this.allWeaponData = {};
        this.allSkillData = {};
        this.skillTemplateData = {};
        this.timeUnitIsFrames = false;
    }

    async loadData() {
        try {
            this.simEngine.logToScreen('Loading weapon simulation data...');
            
            const [weaponResponse, barrageResponse, bulletResponse, skillResponse, skillTemplateResponse] = await Promise.all([
                fetch('data/sim/weapon_property.json'),
                fetch('data/sim/barrage_template.json'),
                fetch('data/sim/bullet_template.json'),
                fetch('data/sim/skill_weapon_data.json'),
                fetch('data/sim/skill_data_template.json')
            ]);

            this.allWeaponData = await weaponResponse.json();
            const allBarrageData = await barrageResponse.json();
            const allBulletData = await bulletResponse.json();
            this.allSkillData = await skillResponse.json();
            this.skillTemplateData = await skillTemplateResponse.json();

            this.simEngine.setData(allBarrageData, allBulletData);
            this.simEngine.logToScreen('Weapon simulation data loaded successfully');
            
            return {
                weapons: this.allWeaponData,
                barrages: allBarrageData,
                bullets: allBulletData,
                skills: this.allSkillData,
                skillTemplates: this.skillTemplateData
            };
        } catch (error) {
            console.error('Error loading weapon simulation data:', error);
            this.simEngine.logToScreen(`Error: ${error.message}`, 'error');
            throw error;
        }
    }

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
                desc_get_add: templateData.desc_get_add
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
}