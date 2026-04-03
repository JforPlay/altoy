// public/js/dorm/dorm.data.js
import { fetchJSON, resolveUrl, createSearchIndex } from '../utils.js';

/** @type {import('./dorm.viewer.js').DormState} */
let state;

// Asset base URL — data_for_toy GitHub repo
const ASSET_BASE = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main';

export function setup(stateRef) {
    state = stateRef;
}

/**
 * Load furniture and theme data.
 * @returns {Promise<boolean>}
 */
export async function loadData() {
    try {
        const data = await fetchJSON(resolveUrl('data/dorm/dorm_furniture_data.json'));
        state.furniture = data.furniture || {};
        state.themes = data.themes || {};
        state.searchIndex = createSearchIndex(Object.values(state.furniture), {
            keys: ['name', 'desc'],
            threshold: 0.3
        });
        return true;
    } catch (err) {
        console.error('[Dorm] Failed to load data:', err);
        return false;
    }
}

/**
 * Get furniture definition by ID.
 * @param {number|string} id
 */
export function getFurniture(id) {
    return state.furniture[id] || null;
}

/**
 * Get theme definition by ID.
 * @param {number|string} id
 */
export function getTheme(id) {
    return state.themes[id] || null;
}

/**
 * Build URL for a furniture icon image.
 * @param {string} iconName — the `icon` field value from furniture data
 */
export function getFurnitureIconUrl(iconName) {
    if (!iconName) return '';
    return `${ASSET_BASE}/furnitureicon/${iconName}.webp`;
}

/**
 * Build URL for a furniture sprite image.
 * @param {string} picture — the `picture` field value from furniture data (e.g., "chuanmo/yuekecheng")
 */
export function getFurnitureSpriteUrl(picture) {
    if (!picture) return '';
    return `${ASSET_BASE}/furnitrues/${picture}.webp`;
}

/**
 * Build URL for a theme icon image.
 * @param {string} iconName — the `icon` field value from theme data
 */
export function getThemeIconUrl(iconName) {
    if (!iconName) return '';
    return `${ASSET_BASE}/furnitureicon/${iconName}.webp`;
}

/**
 * Get all themes sorted by order, plus a synthetic "no theme" group.
 * @returns {Array<{id: number, name: string, furnitureIds: number[]}>}
 */
export function getThemesSorted() {
    const themed = Object.values(state.themes)
        .sort((a, b) => a.order - b.order);

    // Collect furniture IDs that belong to a theme
    const themedIds = new Set();
    for (const theme of themed) {
        for (const fid of theme.furnitureIds) {
            themedIds.add(fid);
        }
    }

    // Build "no theme" group from remaining furniture
    const noThemeIds = Object.keys(state.furniture)
        .map(Number)
        .filter(id => !themedIds.has(id));

    if (noThemeIds.length > 0) {
        themed.push({
            id: 0,
            name: '테마 없음',
            desc: '',
            icon: '',
            comfortable: 0,
            order: 9999,
            furnitureIds: noThemeIds
        });
    }

    return themed;
}

/**
 * Search furniture by name.
 * @param {string} query
 * @returns {Set<number>} matching furniture IDs
 */
export function searchFurniture(query) {
    if (!query || !state.searchIndex) return null; // null = show all
    const results = state.searchIndex.search(query);
    return new Set(results.map(r => r.item.id));
}
