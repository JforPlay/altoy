/**
 * shipgirl-info.data.js
 * Data loading and skill/attribute utility functions for the shipgirl info page.
 * Part of the shipgirl-info module group (info + data + detail + maps).
 * State is shared via a ref passed to setup() from shipgirl-info.js.
 */

import { fetchJSON, fetchJSONWithCache } from '../utils.js';

'use strict';

// ============================================
// STATE REFERENCE (set via setup)
// ============================================
let state;
let skillIconDataPromise = null;
let skillDataTemplatePromise = null;

export function setup(stateRef) {
    state = stateRef;
}

// ===== Data Loading =====
/**
 * Load lite data synchronously for fast initial render, then start background load of full data.
 * Full data is needed only when opening a detail view.
 */
export async function loadData() {
    state.shipgirlData = await fetchJSON('data/ship_info_lite.json');
    state.filteredData = [...state.shipgirlData];

    // Start loading full data in background
    state.fullShipDataPromise = loadFullData();
}

export async function loadFullData() {
    try {
        console.log("Starting background load of full ship data...");
        state.fullShipData = await fetchJSONWithCache('data/ship_info_data.json');
        // Pre-compute the retrofittable-ship lookup once. Used by the listing's
        // "개조" filter; building it here means filterShipgirls stays a hot loop
        // over a Set instead of re-scanning fullShipData on every keystroke.
        state.retrofitGidSet = new Set(
            state.fullShipData
                .filter(s => s?.retrofit?.id)
                .map(s => s.gid)
        );
        console.log("Full ship data loaded successfully.");
        return state.fullShipData;
    } catch (error) {
        console.warn("Background loading of full data failed:", error);
    }
    return null;
}

export async function loadNationalityData() {
    state.nationalityData = await fetchJSON('data/mapping/nationality_mapping.json');
}

export async function loadAttrTypeData() {
    state.attrTypeData = await fetchJSON('data/mapping/attr_type_mapping.json');
}

export async function loadShipTypeData() {
    state.shipTypeData = await fetchJSON('data/mapping/ship_type_mapping.json');
}

/** Load skill icon mapping; falls back to Fernando2603/AzurLane remote if local file is missing. */
export async function loadSkillIconData() {
    if (skillIconDataPromise) return skillIconDataPromise;

    skillIconDataPromise = doLoadSkillIconData();
    return skillIconDataPromise;
}

async function doLoadSkillIconData() {
    try {
        state.skillIconData = await fetchJSON('data/skill_icon_mapping.json');
        console.log('Loaded local skill icon data:', Object.keys(state.skillIconData).length, 'icons');
        return;
    } catch (error) {
        console.warn('Local skill icon data not found, fetching from remote...');
    }

    try {
        state.skillIconData = await fetchJSON('https://raw.githubusercontent.com/Fernando2603/AzurLane/refs/heads/main/skill_icon.json');
        console.log('Loaded remote skill icon data:', Object.keys(state.skillIconData).length, 'icons');
    } catch (error) {
        console.error('Failed to fetch skill icon data from remote:', error);
    }
}

/**
 * Load skill_data_template; falls back to AzurLaneData KR remote if local copy is missing.
 * Normalizes both array and object formats to a keyed object { id: skill }.
 */
export async function loadSkillDataTemplate() {
    if (skillDataTemplatePromise) return skillDataTemplatePromise;

    skillDataTemplatePromise = doLoadSkillDataTemplate();
    return skillDataTemplatePromise;
}

async function doLoadSkillDataTemplate() {
    try {
        const data = await fetchJSON('data/sim/skill_data_template.json');

        if (Array.isArray(data)) {
            state.skillDataTemplate = Object.fromEntries(
                data.map(skill => [skill.id, skill])
            );
        } else if (typeof data === 'object') {
            state.skillDataTemplate = data;
        } else {
            throw new Error('Invalid skill data format');
        }

        console.log('Loaded local skill data template:', Object.keys(state.skillDataTemplate).length, 'skills');
        return;
    } catch (error) {
        console.warn('Local skill data not found, fetching from remote...', error);
    }

    try {
        const data = await fetchJSON('https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/skill_data_template.json');

        if (Array.isArray(data)) {
            state.skillDataTemplate = Object.fromEntries(
                data.map(skill => [skill.id, skill])
            );
        } else if (typeof data === 'object') {
            state.skillDataTemplate = data;
        } else {
            throw new Error('Invalid skill data format from remote');
        }

        console.log('Loaded remote skill data template:', Object.keys(state.skillDataTemplate).length, 'skills');
    } catch (error) {
        console.error('Failed to fetch skill data template from remote:', error);
    }
}

// ===== Skill Helper Functions =====

export function getSkillIconUrl(skillId) {
    return state.skillIconData[String(skillId)] || null;
}

/**
 * Replace $1, $2, ... placeholders in a skill description with values from descGetAdd.
 * Array values are joined with '/' (e.g. [10, 20] → "10/20").
 */
export function processSkillDescription(desc, descGetAdd) {
    if (!desc) return '설명 없음';
    if (!descGetAdd || descGetAdd.length === 0) return desc;

    let processed = desc;
    descGetAdd.forEach((params, index) => {
        const placeholder = `$${index + 1}`;
        const value = Array.isArray(params) ? params.join('/') : params;
        processed = processed.replace(new RegExp(`\\${placeholder}`, 'g'), value);
    });

    return processed;
}

/** Resolve a skill ID to { name, description, iconUrl }. Returns a safe fallback if not found. */
export function getSkillInfo(skillId) {
    const skill = state.skillDataTemplate[String(skillId)];

    if (!skill) {
        console.warn('Skill not found:', skillId);
        return {
            name: `스킬 ${skillId}`,
            description: '정보 없음',
            iconUrl: getSkillIconUrl(skillId)
        };
    }

    return {
        name: skill.name || `스킬 ${skillId}`,
        description: processSkillDescription(skill.desc, skill.desc_get_add),
        iconUrl: getSkillIconUrl(skillId)
    };
}

// ===== Attribute & Ship Type Helpers =====

/** Look up the Korean display name for an attribute by its English key (name or name2). */
export function getAttrKoreanName(attrName) {
    if (!attrName) return '';
    const lowerAttrName = attrName.toLowerCase();

    // Try to find by 'name' first, then by 'name2'
    const attr = Object.values(state.attrTypeData).find(a =>
        a.name === lowerAttrName || a.name2 === lowerAttrName
    );

    return attr ? attr.condition : attrName;
}

export function getShipType(type) {
    const shipType = state.shipTypeData[String(type)];
    if (shipType) {
        return `
            ${shipType.icon ? `<img src="${shipType.icon}" alt="${shipType.type_name}" style="height: 20px; vertical-align: middle; margin-right: 5px;">` : ''}
            ${shipType.type_name}
        `;
    }
    return `함종 ${type}`;
}

export function createAttrMapping() {
    const mapping = {};
    Object.values(state.attrTypeData).forEach(attr => {
        mapping[attr.name] = attr;
        // Also map name2 if it exists
        if (attr.name2) {
            mapping[attr.name2] = attr;
        }
    });
    return mapping;
}
