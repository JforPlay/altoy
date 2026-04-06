/**
 * equip-skin-viewer.js
 * Main controller for the equipment skin viewer page.
 * Part of the equip skin viewer group (equip-skin-viewer.js + equip-skin.data.js + equip-skin.preview.js).
 * Manages theme sidebar, skin grid, info bar, playback controls, and URL state.
 */
import {
    debounce, getUrlParam, setUrlParams, resolveUrl,
    showElement, hideElement, showToast, createSearchIndex,
    createImgElement, IMG_FALLBACKS
} from '../utils.js';
import { EquipSkinData, EQUIP_TYPE_NAMES } from './equip-skin.data.js';
import { EquipSkinPreview } from './equip-skin.preview.js';

document.addEventListener('DOMContentLoaded', async () => {
    // --- Data ---
    const data = new EquipSkinData();

    // --- DOM ---
    const themeSearch = document.getElementById('theme-search');
    const themeList = document.getElementById('theme-list');
    const skinGridContainer = document.getElementById('skin-grid-container');
    const skinInfo = document.getElementById('skin-info');
    const skinIcon = document.getElementById('skin-icon');
    const skinName = document.getElementById('skin-name');
    const skinDesc = document.getElementById('skin-desc');
    const skinTypeChips = document.getElementById('skin-type-chips');
    const skinSpritePreview = document.getElementById('skin-sprite-preview');
    const fireButton = document.getElementById('fire-button');
    const loopButton = document.getElementById('loop-button');
    const pauseButton = document.getElementById('pause-button');
    const simContainer = document.getElementById('simulation-container');

    // --- State ---
    let activeThemeId = null;
    let activeSkinId = null;
    let currentSpeed = 1.5;
    let themeSearchIndex = null;

    // --- Init Preview ---
    const preview = new EquipSkinPreview(simContainer, data);

    // --- Load Data ---
    try {
        await data.loadData();
    } catch (e) {
        showToast('데이터 로드 실패', 'error');
        console.error('Failed to load skin data:', e);
        return;
    }

    // Load sim data in background
    data.loadSimData().catch(e => {
        console.error('Failed to load sim data:', e);
    });

    // --- Init Engine ---
    preview.init();

    // --- Theme Search Index ---
    themeSearchIndex = createSearchIndex(
        data.themeList.map(t => ({ id: t.id, name: t.name })),
        { keys: ['name'], threshold: 0.4 }
    );

    // --- Render Theme Sidebar ---
    /**
     * Build and mount the theme sidebar from a list of theme objects.
     * Marks the currently active theme with the 'active' class.
     */
    function renderThemeList(themes) {
        const fragment = document.createDocumentFragment();
        for (const theme of themes) {
            const div = document.createElement('div');
            div.className = 'esv-theme-item';
            if (theme.id === activeThemeId) div.classList.add('active');
            div.dataset.themeId = theme.id;
            div.innerHTML = `
                <span class="theme-name">${theme.name}</span>
                <span class="theme-count">${theme.ids ? theme.ids.length : 0}</span>
            `;
            div.addEventListener('click', () => selectTheme(theme.id));
            fragment.appendChild(div);
        }
        themeList.innerHTML = '';
        themeList.appendChild(fragment);
    }

    renderThemeList(data.themeList);

    // --- Theme Search ---
    themeSearch.addEventListener('input', debounce(() => {
        const query = themeSearch.value.trim();
        if (!query) {
            renderThemeList(data.themeList);
            return;
        }
        const results = themeSearchIndex.search(query);
        const filtered = results.map(r => data.getTheme(r.item.id));
        renderThemeList(filtered);
    }, 200));

    // --- Select Theme ---
    /**
     * Select a theme: update sidebar state, render its skin grid, hide skin info, update URL.
     */
    function selectTheme(themeId) {
        activeThemeId = themeId;
        activeSkinId = null;

        // Update sidebar active state
        themeList.querySelectorAll('.esv-theme-item').forEach(el => {
            el.classList.toggle('active', Number(el.dataset.themeId) === themeId);
        });

        // Render skin grid
        const skins = data.getSkinsForTheme(themeId);
        renderSkinGrid(skins);

        // Hide skin info
        hideElement(skinInfo);

        // Update URL
        setUrlParams({ theme: themeId, skin: null }, { replace: true });
    }

    // --- Render Skin Grid ---
    function renderSkinGrid(skins) {
        if (!skins.length) {
            skinGridContainer.innerHTML = '<div class="card placeholder-card"><p>이 테마에 스킨이 없습니다.</p></div>';
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'esv-skin-grid';

        const fragment = document.createDocumentFragment();
        for (const skin of skins) {
            const card = document.createElement('div');
            card.className = 'esv-skin-card';
            card.dataset.skinId = skin.id;
            card.dataset.rarity = skin.rarity || 3;
            if (skin.id === activeSkinId) card.classList.add('active');

            const iconUrl = data.getEquipIconUrl(skin.icon);
            const img = createImgElement(iconUrl, skin.name, {
                className: 'esv-skin-card-img',
                fallback: IMG_FALLBACKS.DEFAULT
            });
            card.appendChild(img);
            const nameSpan = document.createElement('span');
            nameSpan.className = 'esv-skin-card-name';
            nameSpan.textContent = skin.name;
            card.appendChild(nameSpan);
            card.addEventListener('click', () => selectSkin(skin.id));
            fragment.appendChild(card);
        }
        grid.appendChild(fragment);
        skinGridContainer.innerHTML = '';
        skinGridContainer.appendChild(grid);
    }

    // --- Select Skin ---
    /**
     * Select a skin: update grid active state, populate info bar, auto-fire preview, update URL.
     */
    async function selectSkin(skinId) {
        activeSkinId = skinId;
        const skin = data.getSkin(skinId);
        if (!skin) return;

        // Update grid active state
        skinGridContainer.querySelectorAll('.esv-skin-card').forEach(el => {
            el.classList.toggle('active', Number(el.dataset.skinId) === skinId);
        });

        // Update info bar
        skinName.textContent = skin.name;
        skinDesc.textContent = skin.desc || '';
        skinIcon.src = data.getEquipIconUrl(skin.icon);
        skinIcon.alt = skin.name;

        // Type chips
        const types = skin.equip_type || [];
        skinTypeChips.innerHTML = types
            .map(t => `<span class="esv-type-chip">${data.getEquipTypeName(t)}</span>`)
            .join('');

        // Sprite preview
        if (skin.bullet_name) {
            skinSpritePreview.src = data.getSpriteUrl(skin.bullet_name);
            skinSpritePreview.alt = skin.bullet_name;
            showElement(skinSpritePreview);
        } else {
            hideElement(skinSpritePreview);
        }

        showElement(skinInfo);

        // Update URL
        setUrlParams({ theme: activeThemeId, skin: skinId }, { replace: true });

        // Auto-fire preview
        await preview.fireSkin(skin);
    }

    // --- Playback Controls ---
    fireButton.addEventListener('click', async () => {
        if (!activeSkinId) {
            showToast('스킨을 선택하세요', 'info');
            return;
        }
        const skin = data.getSkin(activeSkinId);
        if (skin) await preview.fireSkin(skin);
    });

    loopButton.addEventListener('click', () => {
        if (!activeSkinId) {
            showToast('스킨을 선택하세요', 'info');
            return;
        }
        if (preview.isLooping) {
            preview.stopLoop();
            loopButton.classList.remove('active');
        } else {
            const skin = data.getSkin(activeSkinId);
            if (skin) {
                preview.startLoop(skin);
                loopButton.classList.add('active');
            }
        }
    });

    pauseButton.addEventListener('click', () => {
        const icon = pauseButton.querySelector('.material-symbols-outlined');
        if (preview.isPaused) {
            preview.resume(currentSpeed);
            icon.textContent = 'pause';
        } else {
            preview.pause();
            icon.textContent = 'play_arrow';
        }
    });

    // Speed controls
    document.querySelectorAll('.speed-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSpeed = parseFloat(btn.dataset.speed);
            if (!preview.isPaused) {
                preview.setSpeed(currentSpeed);
            }
        });
    });

    // --- URL Parameter Restore ---
    const urlTheme = getUrlParam('theme');
    const urlSkin = getUrlParam('skin');

    if (urlSkin) {
        const skin = data.getSkin(urlSkin);
        if (skin) {
            selectTheme(skin.themeid);
            await selectSkin(Number(urlSkin));
        }
    } else if (urlTheme) {
        selectTheme(Number(urlTheme));
    }

    // --- Resize ---
    window.addEventListener('resize', debounce(() => {
        const playerArea = document.getElementById('player-area');
        preview.engine?.updateLayoutAndScale(playerArea);
    }, 150));
});
