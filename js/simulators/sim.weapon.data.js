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
                fetch('data/weapon_property.json'),
                fetch('data/barrage_template.json'),
                fetch('data/bullet_template.json'),
                fetch('data/skill_weapon_data.json'),
                fetch('data/skill_data_template.json')
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
        const weaponIds = [];
        const skill = this.allSkillData[skillId];
        if (!skill) return weaponIds;
        
        // Get effect_list with fallback logic
        let effectList = null;
        
        // Try requested level first
        if (skill[level]?.effect_list) {
            effectList = skill[level].effect_list;
        }
        // Fallback to level 1
        else if (skill['1']?.effect_list) {
            effectList = skill['1'].effect_list;
        }
        // Fallback to direct effect_list (legacy format)
        else if (skill.effect_list) {
            effectList = skill.effect_list;
        }
        
        if (!effectList) return weaponIds;
        
        for (const effect of effectList) {
            if (effect.arg_list && effect.arg_list.weapon_id) {
                const weaponId = effect.arg_list.weapon_id.toString();
                if (!weaponIds.includes(weaponId)) weaponIds.push(weaponId);
            }
        }
        return weaponIds;
    }

    getSkillById(skillId) {
        const skillData = this.allSkillData[skillId];
        if (!skillData) return null;

        // Merge with template data if available
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