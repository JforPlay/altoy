/**
 * dorm.data.js
 * Data loading and lookup helpers for the dorm furniture simulator.
 * Part of the dorm module group (viewer + data + grid + panel).
 * State is shared via a ref passed to setup() from dorm.viewer.js.
 */
import { fetchJSON, resolveUrl, createSearchIndex, ensureFuse, DATA_FOR_TOY_BASE } from '../utils.js';

/** @type {import('./dorm.viewer.js').DormState} */
let state;

const ASSET_BASE = DATA_FOR_TOY_BASE;

/** Receive the shared state reference from dorm.viewer.js. */
export function setup(stateRef) {
    state = stateRef;
}

/**
 * Load furniture and theme data.
 * Throws on fetch/shape failure — loadPageData in dorm.viewer.js owns the error/retry UI.
 * @returns {Promise<boolean>}
 */
export async function loadData() {
    const data = await fetchJSON(resolveUrl('data/dorm/dorm_furniture_data.json'));
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid dorm furniture data');
    }

    state.furniture = data.furniture && typeof data.furniture === 'object' ? data.furniture : {};
    state.themes = data.themes && typeof data.themes === 'object' ? data.themes : {};
    await ensureFuse();
    state.searchIndex = createSearchIndex(Object.values(state.furniture), {
        keys: ['name', 'desc'],
        threshold: 0.3
    });
    return true;
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
    return `${ASSET_BASE}/furnitureicon/${encodeAssetPath(iconName)}.webp`;
}

/**
 * Build URL for a furniture sprite image.
 * @param {string} picture — the `picture` field value from furniture data (e.g., "chuanmo/yuekecheng")
 */
export function getFurnitureSpriteUrl(picture) {
    if (!picture) return '';
    return `${ASSET_BASE}/furnitrues/${encodeAssetPath(picture)}.webp`;
}

/**
 * Build URL for a theme icon image.
 * @param {string} iconName — the `icon` field value from theme data
 */
export function getThemeIconUrl(iconName) {
    if (!iconName) return '';
    return `${ASSET_BASE}/furnitureicon/${encodeAssetPath(iconName)}.webp`;
}

function encodeAssetPath(path) {
    return String(path)
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/');
}

/**
 * Get all themes sorted by order, plus a synthetic "no theme" group.
 * @returns {Array<{id: number, name: string, furnitureIds: number[]}>}
 */
export function getThemesSorted() {
    const themed = Object.values(state.themes)
        .map(theme => ({
            ...theme,
            furnitureIds: Array.isArray(theme.furnitureIds) ? theme.furnitureIds : []
        }))
        .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));

    // Collect furniture IDs that belong to a theme
    const themedIds = new Set();
    for (const theme of themed) {
        for (const fid of theme.furnitureIds) {
            themedIds.add(Number(fid));
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
    const trimmed = query.trim();
    if (!trimmed) return null; // null = show all

    if (state.searchIndex) {
        const results = state.searchIndex.search(trimmed);
        return new Set(results.map(r => r.item.id));
    }

    const normalizedQuery = normalizeSearchText(trimmed);
    const matches = Object.values(state.furniture)
        .filter(item => {
            const haystack = normalizeSearchText(`${item.name || ''} ${item.desc || ''} ${item.typeName || ''}`);
            return haystack.includes(normalizedQuery);
        })
        .map(item => item.id);
    return new Set(matches);
}

function normalizeSearchText(value) {
    return String(value).toLocaleLowerCase();
}
