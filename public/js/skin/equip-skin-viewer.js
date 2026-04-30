/**
 * equip-skin-viewer.js
 * Main controller for the equipment skin viewer page.
 * Part of the equip skin viewer group (equip-skin-viewer.js + equip-skin.data.js + equip-skin.preview.js).
 * Manages theme sidebar, skin grid, info bar, playback controls, and URL state.
 */
import {
    debounce, getUrlParam, setUrlParams,
    showElement, hideElement, showToast, createSearchIndex, ensureFuse,
    createImgElement, IMG_FALLBACKS, setupFpsDisplay
} from '../utils.js';
import { EquipSkinData } from './equip-skin.data.js';
import { EquipSkinPreview } from './equip-skin.preview.js';

document.addEventListener('DOMContentLoaded', async () => {
    // --- Data ---
    const data = new EquipSkinData();

    // --- DOM ---
    const themeSearch = document.getElementById('theme-search');
    const themeList = document.getElementById('theme-list');
    const themeTotalCount = document.getElementById('theme-total-count');
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
    const playerArea = document.getElementById('player-area');
    const speedButtons = Array.from(document.querySelectorAll('.speed-btn'));

    // --- State ---
    let activeThemeId = null;
    let activeSkinId = null;
    let currentSpeed = 1.5;
    let themeSearchIndex = null;
    let selectSkinToken = 0;

    // --- Init Preview ---
    const preview = new EquipSkinPreview(simContainer, data);
    preview.onError = (error) => {
        console.error('Equipment skin preview failed:', error);
        updateLoopButton(false);
        showToast('미리보기 재생 실패', 'error');
    };

    // --- Load Data ---
    themeList.setAttribute('aria-busy', 'true');
    skinGridContainer.setAttribute('aria-busy', 'true');
    try {
        await data.loadData();
    } catch (e) {
        showToast('데이터 로드 실패', 'error');
        console.error('Failed to load skin data:', e);
        renderPlaceholder(skinGridContainer, '데이터를 불러오지 못했습니다. 잠시 후 다시 시도하세요.');
        preview.destroy();
        return;
    } finally {
        themeList.setAttribute('aria-busy', 'false');
        skinGridContainer.setAttribute('aria-busy', 'false');
    }

    // Load sim data in background
    data.loadSimData().catch(e => {
        console.error('Failed to load sim data:', e);
    });

    // --- Init Engine ---
    preview.init();

    // --- Theme Search Index ---
    await ensureFuse();
    themeSearchIndex = createSearchIndex(
        data.themeList.map(t => ({ id: t.id, name: t.name })),
        { keys: ['name'], threshold: 0.4 }
    );

    // --- Render Helpers ---
    function renderPlaceholder(container, message) {
        const card = document.createElement('div');
        card.className = 'card placeholder-card';
        const text = document.createElement('p');
        text.textContent = message;
        card.appendChild(text);
        container.replaceChildren(card);
    }

    function renderEmpty(container, message) {
        const empty = document.createElement('div');
        empty.className = 'esv-empty-state';
        empty.textContent = message;
        container.replaceChildren(empty);
    }

    function setPressed(button, isPressed) {
        button.classList.toggle('active', isPressed);
        button.setAttribute('aria-pressed', String(isPressed));
    }

    function updateLoopButton(isLooping = preview.isLooping) {
        setPressed(loopButton, isLooping);
    }

    function updatePauseButton() {
        const icon = pauseButton.querySelector('.material-symbols-outlined');
        setPressed(pauseButton, preview.isPaused);
        pauseButton.setAttribute('aria-label', preview.isPaused ? '재생' : '일시정지');
        if (icon) {
            icon.textContent = preview.isPaused ? 'play_arrow' : 'pause';
        }
    }

    function updateSpeedButtons() {
        for (const button of speedButtons) {
            const isActive = Number(button.dataset.speed) === currentSpeed;
            setPressed(button, isActive);
        }
    }

    function updateThemeActiveState() {
        themeList.querySelectorAll('.esv-theme-item').forEach(el => {
            const isActive = Number(el.dataset.themeId) === activeThemeId;
            setPressed(el, isActive);
        });
    }

    function updateSkinActiveState() {
        skinGridContainer.querySelectorAll('.esv-skin-card').forEach(el => {
            const isActive = Number(el.dataset.skinId) === activeSkinId;
            setPressed(el, isActive);
        });
    }

    function renderThemeList(themes) {
        if (!themes.length) {
            renderEmpty(themeList, '검색 결과가 없습니다.');
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const theme of themes) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'esv-theme-item';
            button.dataset.themeId = theme.id;
            button.setAttribute('aria-pressed', String(theme.id === activeThemeId));

            const name = document.createElement('span');
            name.className = 'theme-name';
            name.textContent = theme.name;

            const count = document.createElement('span');
            count.className = 'theme-count';
            count.textContent = String(theme.ids ? theme.ids.length : 0);

            button.append(name, count);
            fragment.appendChild(button);
        }
        themeList.replaceChildren(fragment);
        updateThemeActiveState();
    }

    renderThemeList(data.themeList);
    if (themeTotalCount) {
        themeTotalCount.textContent = `${data.themeList.length}개`;
    }
    updateLoopButton();
    updatePauseButton();
    updateSpeedButtons();

    // --- Theme Search / Selection ---
    themeSearch.addEventListener('input', debounce(() => {
        const query = themeSearch.value.trim();
        if (!query) {
            renderThemeList(data.themeList);
            return;
        }
        const filtered = themeSearchIndex
            ? themeSearchIndex.search(query).map(r => data.getTheme(r.item.id)).filter(Boolean)
            : data.themeList.filter(theme => theme.name.toLowerCase().includes(query.toLowerCase()));
        renderThemeList(filtered);
    }, 200));

    themeList.addEventListener('click', (event) => {
        const item = event.target.closest('.esv-theme-item');
        if (!item) return;
        selectTheme(Number(item.dataset.themeId));
    });

    /**
     * Select a theme: update sidebar state, render its skin grid, hide skin info, update URL.
     */
    function selectTheme(themeId, options = {}) {
        const { updateUrl = true, clearPreview = true } = options;
        const theme = data.getTheme(themeId);
        if (!theme) return false;

        activeThemeId = themeId;
        activeSkinId = null;
        selectSkinToken++;

        updateThemeActiveState();
        const skins = data.getSkinsForTheme(themeId);
        renderSkinGrid(skins);
        hideElement(skinInfo);

        if (clearPreview) {
            preview.stopLoop();
            preview.cancelPending();
            updateLoopButton(false);
        }

        if (updateUrl) {
            setUrlParams({ theme: themeId, skin: null }, { replace: true });
        }

        return true;
    }

    // --- Render Skin Grid ---
    function renderSkinGrid(skins) {
        if (!skins.length) {
            renderPlaceholder(skinGridContainer, '이 테마에 스킨이 없습니다.');
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'esv-skin-grid';

        const fragment = document.createDocumentFragment();
        for (const skin of skins) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'esv-skin-card';
            card.dataset.skinId = skin.id;
            card.dataset.rarity = skin.rarity || 3;
            card.setAttribute('aria-label', `${skin.name} 미리보기`);
            card.setAttribute('aria-pressed', String(skin.id === activeSkinId));

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
            fragment.appendChild(card);
        }
        grid.appendChild(fragment);
        skinGridContainer.replaceChildren(grid);
        updateSkinActiveState();
    }

    skinGridContainer.addEventListener('click', (event) => {
        const card = event.target.closest('.esv-skin-card');
        if (!card) return;
        selectSkin(Number(card.dataset.skinId));
    });

    async function fireSelectedSkin(skin) {
        try {
            await preview.fireSkin(skin);
        } catch (error) {
            console.error('Failed to fire equipment skin preview:', error);
            showToast('미리보기 재생 실패', 'error');
        }
    }

    /**
     * Select a skin: update grid active state, populate info bar, auto-fire preview, update URL.
     */
    async function selectSkin(skinId, options = {}) {
        const { updateUrl = true, autoFire = true } = options;
        const skin = data.getSkin(skinId);
        if (!skin) return false;

        if (activeThemeId !== skin.themeid) {
            selectTheme(skin.themeid, { updateUrl: false, clearPreview: false });
        }

        activeSkinId = skin.id;
        const currentToken = ++selectSkinToken;
        const wasLooping = preview.isLooping;
        if (wasLooping) {
            preview.stopLoop();
        }

        updateSkinActiveState();
        skinName.textContent = skin.name;
        skinDesc.textContent = skin.desc || '';
        skinIcon.setAttribute('data-fallback', IMG_FALLBACKS.DEFAULT);
        skinIcon.src = data.getEquipIconUrl(skin.icon);
        skinIcon.alt = skin.name;

        const types = skin.equip_type || [];
        skinTypeChips.replaceChildren(...types.map(typeCode => {
            const chip = document.createElement('span');
            chip.className = 'esv-type-chip';
            chip.textContent = data.getEquipTypeName(typeCode);
            return chip;
        }));

        if (skin.bullet_name) {
            skinSpritePreview.setAttribute('data-onfail', 'hide');
            skinSpritePreview.src = data.getSpriteUrl(skin.bullet_name);
            skinSpritePreview.alt = skin.bullet_name;
            skinSpritePreview.style.display = '';
            showElement(skinSpritePreview);
        } else {
            skinSpritePreview.removeAttribute('data-onfail');
            skinSpritePreview.removeAttribute('src');
            skinSpritePreview.alt = '';
            hideElement(skinSpritePreview);
        }

        showElement(skinInfo);

        if (updateUrl) {
            setUrlParams({ theme: activeThemeId, skin: skin.id }, { replace: true });
        }

        if (wasLooping) {
            preview.startLoop(skin);
            updateLoopButton(true);
        } else if (autoFire) {
            await fireSelectedSkin(skin);
        }

        return currentToken === selectSkinToken;
    }

    // --- Playback Controls ---
    fireButton.addEventListener('click', async () => {
        if (!activeSkinId) {
            showToast('스킨을 선택하세요', 'info');
            return;
        }
        const skin = data.getSkin(activeSkinId);
        if (skin) await fireSelectedSkin(skin);
    });

    loopButton.addEventListener('click', () => {
        if (!activeSkinId) {
            showToast('스킨을 선택하세요', 'info');
            return;
        }
        if (preview.isLooping) {
            preview.stopLoop();
            updateLoopButton(false);
        } else {
            const skin = data.getSkin(activeSkinId);
            if (skin) {
                preview.startLoop(skin);
                updateLoopButton(true);
            }
        }
    });

    pauseButton.addEventListener('click', () => {
        if (preview.isPaused) {
            preview.resume(currentSpeed);
        } else {
            preview.pause();
        }
        updatePauseButton();
    });

    // Speed controls
    speedButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            currentSpeed = parseFloat(btn.dataset.speed);
            updateSpeedButtons();
            if (!preview.isPaused) {
                preview.setSpeed(currentSpeed);
            }
        });
    });

    // --- URL Parameter Restore ---
    async function restoreUrlState() {
        const urlTheme = Number(getUrlParam('theme'));
        const urlSkin = Number(getUrlParam('skin'));
        const skin = data.getSkin(urlSkin);
        if (skin) {
            // Skip if the URL already matches current state (e.g. popstate to same entry) — avoids restarting the preview animation.
            if (skin.id === activeSkinId) return;
            await selectSkin(urlSkin, { updateUrl: false });
            return;
        }

        if (data.getTheme(urlTheme)) {
            if (urlTheme === activeThemeId) return;
            selectTheme(urlTheme, { updateUrl: false });
            return;
        }

        if (getUrlParam('theme') || getUrlParam('skin')) {
            setUrlParams({ theme: null, skin: null }, { replace: true });
        }
    }

    await restoreUrlState();
    window.addEventListener('popstate', restoreUrlState);

    // --- Resize ---
    window.addEventListener('resize', debounce(() => {
        preview.engine?.updateLayoutAndScale(playerArea);
    }, 150));

    // --- FPS Display ---
    setupFpsDisplay(document.getElementById('fps-display'));
});
