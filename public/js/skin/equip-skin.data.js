/**
 * equip-skin.data.js
 * Data loading and asset URL helpers for the equipment skin viewer.
 * Part of the equip skin viewer group (equip-skin-viewer.js + equip-skin.data.js + equip-skin.preview.js).
 * Loads equip skin/theme JSON on init; sim data (weapon/barrage/bullet) deferred to first preview fire.
 */
import { fetchJSON, fetchJSONWithCache, resolveUrl } from '../utils.js';

/** Equipment type display names */
const EQUIP_TYPE_NAMES = {
    1: '구축함포', 2: '경순함포', 3: '중순함포', 4: '전함포',
    5: '어뢰', 6: '대공포', 7: '전투기', 8: '뇌격기', 9: '폭격기',
    10: '설비', 11: '대구경포', 12: '수상기', 13: '잠수어뢰', 15: '대잠기',
};

/** Rarity display */
const RARITY_STARS = { 2: '★★', 3: '★★★', 4: '★★★★', 5: '★★★★★', 6: '★★★★★★' };

/** External asset base URLs */
const EQUIP_ICON_BASE = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/equips/';
const SKIN_SPRITE_BASE = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/equip_skin_sprites/';

class EquipSkinData {
    constructor() {
        this.skins = {};
        this.themes = {};
        this.themeList = [];

        // Sim data (loaded on demand)
        this.weaponData = {};
        this.barrageData = {};
        this.bulletData = {};
        this.simDataLoaded = false;

        // Sprite image cache
        this._spriteCache = {};
    }

    /**
     * Load skin and theme JSON in parallel; populate themeList sorted by id.
     */
    async loadData() {
        const [skins, themes] = await Promise.all([
            fetchJSON(resolveUrl('data/equip/equip_skin_template.json')),
            fetchJSON(resolveUrl('data/equip/equip_skin_theme_template.json')),
        ]);

        this.skins = skins;
        this.themes = themes;

        // Build sorted theme list (exclude 'all' key)
        this.themeList = Object.values(themes)
            .filter(t => t && t.id)
            .sort((a, b) => a.id - b.id);

        return { skins, themes };
    }

    /**
     * Lazy-load sim data (weapon/barrage/bullet) for the preview engine.
     * Called on first fire; no-ops on subsequent calls.
     */
    async loadSimData() {
        if (this.simDataLoaded) return;

        const [weaponData, barrageData, bulletData] = await Promise.all([
            fetchJSONWithCache(resolveUrl('data/sim/weapon_property.json'), { maxAge: 86400000 }),
            fetchJSONWithCache(resolveUrl('data/sim/barrage_template.json'), { maxAge: 86400000 }),
            fetchJSONWithCache(resolveUrl('data/sim/bullet_template.json'), { maxAge: 86400000 }),
        ]);

        this.weaponData = weaponData;
        this.barrageData = barrageData;
        this.bulletData = bulletData;
        this.simDataLoaded = true;
    }

    getSkin(skinId) {
        return this.skins[String(skinId)];
    }

    getTheme(themeId) {
        return this.themes[String(themeId)];
    }

    getSkinsForTheme(themeId) {
        const theme = this.getTheme(themeId);
        if (!theme || !theme.ids) return [];
        return theme.ids
            .map(id => this.getSkin(id))
            .filter(Boolean);
    }

    getEquipTypeName(typeCode) {
        return EQUIP_TYPE_NAMES[typeCode] || `타입${typeCode}`;
    }

    getRarityStars(rarity) {
        return RARITY_STARS[rarity] || '';
    }

    getEquipIconUrl(iconId) {
        return `${EQUIP_ICON_BASE}${iconId}.webp`;
    }

    getSpriteUrl(bulletName) {
        return `${SKIN_SPRITE_BASE}${bulletName}.webp`;
    }

    /**
     * Preload a sprite image and cache it
     * @returns {Promise<HTMLImageElement|null>}
     */
    async preloadSprite(bulletName) {
        if (this._spriteCache[bulletName]) return this._spriteCache[bulletName];
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                this._spriteCache[bulletName] = img;
                resolve(img);
            };
            img.onerror = () => resolve(null);
            img.src = this.getSpriteUrl(bulletName);
        });
    }

    // Weapon resolution uses SimulationEngine.resolveWeapon() — no duplication here
}

export { EquipSkinData, EQUIP_TYPE_NAMES };
