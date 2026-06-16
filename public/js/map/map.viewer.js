/**
 * map.viewer.js
 * Main entry point for the map viewer page.
 * Part of the map module group (viewer + data + detail + grid + compare).
 * Owns shared state and wires all sub-modules (data, grid, detail, compare).
 * Covers: tab switching, sidebar rendering, map selection, node overlay, search modal (ship + blueprint).
 */

import { getUrlParam, setUrlParams, showElement, hideElement, openModal, closeModal, setupModal, resolveUrl, debounce, createMaterialIcon, DATA_FOR_TOY_BASE, RARITY_ORDER, renderStatus } from '../utils.js';

import { setup as setupData, loadLiteData, loadFullData, loadShipInfo, loadWorldTargetData, getWorldTargets, getChapterGroup } from './map.data.js';
import { setup as setupGrid, renderGrid, renderLegend, renderWorldGrid } from './map.grid.js';
import { setup as setupDetail, renderMapInfo, renderStats, renderNodeDetail, renderWorldInfo, renderWorldStats, renderExplorationInfo, renderArchiveStats, renderArchiveInfo } from './map.detail.js';
import { setup as setupCompare, setupCompareModal, enterCompareMode, exitCompareMode, renderCompareModal } from './map.compare.js';

// State
const state = {
    liteData: null,
    fullData: null,
    fullDataPromise: null,
    enemyStats: null,
    enemyStatsPromise: null,
    shipInfo: null,
    currentTab: 'main',
    currentMapId: null,
    compareMode: false,
    compareMapId: null,
    shipInfoPromise: null,
    worldTargetPromise: null,
};

const VALID_TABS = new Set(['main', 'hard', 'event', 'archive', 'world']);

// DOM refs
let mapTabs, mapSidebar, mapCenter, mapContent, mapEmpty, mapLoading;
let mapTitle, mapSubtitle, mapStats, mapGrid, mapLegend, mapInfoGrid;
let nodeOverlay, nodeOverlayTitle, nodeOverlayBody, nodeOverlayClose;
let compareBtn, compareBar, compareCancelBtn;
let mobileMapSelect;
let searchModalBody, searchModalInput;
let mapSelectionToken = 0;

function cacheDom() {
    mapTabs = document.getElementById('mapTabs');
    mapSidebar = document.getElementById('mapSidebar');
    mapCenter = document.getElementById('mapCenter');
    mapContent = document.getElementById('mapContent');
    mapEmpty = document.getElementById('mapEmpty');
    mapLoading = document.getElementById('mapLoading');
    mapTitle = document.getElementById('mapTitle');
    mapSubtitle = document.getElementById('mapSubtitle');
    mapStats = document.getElementById('mapStats');
    mapGrid = document.getElementById('mapGrid');
    mapLegend = document.getElementById('mapLegend');
    mapInfoGrid = document.getElementById('mapInfoGrid');
    nodeOverlay = document.getElementById('nodeOverlay');
    nodeOverlayTitle = document.getElementById('nodeOverlayTitle');
    nodeOverlayBody = document.getElementById('nodeOverlayBody');
    nodeOverlayClose = document.getElementById('nodeOverlayClose');
    compareBtn = document.getElementById('compareBtn');
    compareBar = document.getElementById('compareBar');
    compareCancelBtn = document.getElementById('compareCancelBtn');
    mobileMapSelect = document.getElementById('mobileMapSelect');
    searchModalBody = document.getElementById('searchModalBody');
    searchModalInput = document.getElementById('searchModalInput');
}

function renderMessage(container, message, type = 'empty') {
    renderStatus(container, message, type, { compact: true });
}

function getMapKey(category, item) {
    if (category === 'world') return `w_${item.id}`;
    if (category === 'archive') return `a_${item.id}`;
    return String(item.id);
}

function getMapLabel(item) {
    return item.chapter_name ? `${item.chapter_name} ${item.name}` : item.name;
}

function setTabState(tab) {
    mapTabs.querySelectorAll('.map-tab').forEach(t => {
        const isActive = t.dataset.tab === tab;
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-pressed', String(isActive));
    });
}

function setSidebarActive(mapId) {
    mapSidebar.querySelectorAll('.sidebar-item').forEach(el => {
        const isActive = el.dataset.mapId === mapId;
        el.classList.toggle('active', isActive);
        el.setAttribute('aria-pressed', String(isActive));
    });
}

function setNodeOverlayOpen(isOpen) {
    if (!nodeOverlay) return;
    nodeOverlay.classList.toggle('active', isOpen);
    nodeOverlay.setAttribute('aria-hidden', String(!isOpen));
}

// ===== Sidebar =====

/** Set up a single delegated click handler for accordion headers and sidebar items. */
function setupSidebarListeners() {
    // Single delegated click handler for the entire sidebar
    mapSidebar.addEventListener('click', (e) => {
        // Accordion toggle
        const header = e.target.closest('.sidebar-group-header');
        if (header) {
            const items = header.nextElementSibling;
            const isOpen = !items.classList.contains('collapsed');
            items.classList.toggle('collapsed', isOpen);
            header.classList.toggle('expanded', !isOpen);
            header.setAttribute('aria-expanded', String(!isOpen));
            return;
        }

        // Item click
        const item = e.target.closest('.sidebar-item');
        if (item) {
            const mapId = item.dataset.mapId;
            if (state.compareMode) {
                selectCompareTarget(mapId);
            } else {
                selectMap(mapId);
            }
        }
    });
}

/**
 * Group and render lite entries for a category into the sidebar and mobile select.
 * Groups are accordion-collapsed by default; click delegation is set up once in init.
 */
function renderSidebar(category) {
    if (!state.liteData) return;
    const entries = state.liteData[category] || [];

    // Group entries
    const groups = new Map();
    for (const entry of entries) {
        const group = getChapterGroup(entry, category);
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(entry);
    }

    const sidebarFragment = document.createDocumentFragment();
    const selectFragment = document.createDocumentFragment();
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = '해역을 선택하세요';
    selectFragment.appendChild(placeholderOption);

    for (const [groupName, items] of groups) {
        const groupLabel = category === 'event' || category === 'world' || category === 'archive'
                           ? groupName : `${groupName}장`;
        const group = document.createElement('div');
        group.className = 'sidebar-group';

        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'sidebar-group-header';
        header.dataset.group = groupName;
        header.setAttribute('aria-expanded', 'false');
        const headerText = document.createElement('span');
        headerText.textContent = groupLabel;
        const chevron = createMaterialIcon('expand_more', { className: 'sidebar-chevron' });
        header.append(headerText, chevron);

        const groupItems = document.createElement('div');
        groupItems.className = 'sidebar-group-items collapsed';
        for (const item of items) {
            const label = getMapLabel(item);
            const key = getMapKey(category, item);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'sidebar-item';
            button.dataset.mapId = key;
            button.setAttribute('aria-pressed', String(key === state.currentMapId));
            button.textContent = label;
            groupItems.appendChild(button);
        }

        group.append(header, groupItems);
        sidebarFragment.appendChild(group);

        const optgroup = document.createElement('optgroup');
        optgroup.label = groupLabel;
        for (const item of items) {
            const option = document.createElement('option');
            option.value = getMapKey(category, item);
            option.textContent = getMapLabel(item);
            optgroup.appendChild(option);
        }
        selectFragment.appendChild(optgroup);
    }

    mapSidebar.replaceChildren(sidebarFragment);

    // Note: click delegation for sidebar items and accordion headers
    // is set up once in init() via setupSidebarListeners(), not here.

    // Populate mobile select
    if (mobileMapSelect) {
        mobileMapSelect.replaceChildren(selectFragment);
        mobileMapSelect.value = state.currentMapId || '';
    }
}

// ===== Map Selection =====

/**
 * Select and display a map by ID.
 * Waits for full data if it hasn't loaded yet, then dispatches to the correct
 * render path based on chapter.category (world / archive / standard).
 */
async function selectMap(mapId) {
    const selectionToken = ++mapSelectionToken;
    state.currentMapId = mapId;

    // Update sidebar active state
    setSidebarActive(mapId);

    // Expand parent group if collapsed
    const activeItem = mapSidebar.querySelector(`.sidebar-item[data-map-id="${mapId}"]`);
    if (activeItem) {
        const groupItems = activeItem.closest('.sidebar-group-items');
        if (groupItems && groupItems.classList.contains('collapsed')) {
            groupItems.classList.remove('collapsed');
            const header = groupItems.previousElementSibling;
            if (header) {
                header.classList.add('expanded');
                header.setAttribute('aria-expanded', 'true');
            }
        }
    }

    // Update mobile select
    if (mobileMapSelect) mobileMapSelect.value = mapId;

    // Wait for full data if needed
    if (!state.fullData) {
        hideElement(mapEmpty);
        hideElement(mapContent);
        showElement(mapLoading);
        await state.fullDataPromise;
        if (selectionToken !== mapSelectionToken) return;
        hideElement(mapLoading);
    }

    const chapter = state.fullData?.[mapId];
    if (!chapter) {
        renderStatus(mapEmpty, '해역 데이터를 찾을 수 없습니다.', 'empty');
        showElement(mapEmpty);
        hideElement(mapContent);
        return;
    }

    const needsWorldTargets = chapter.category === 'world' && chapter.randomId && state.worldTargetPromise;
    const needsShipInfo = chapter.category !== 'world' && !state.shipInfo && state.shipInfoPromise;
    if (needsWorldTargets || needsShipInfo) {
        hideElement(mapEmpty);
        hideElement(mapContent);
        showElement(mapLoading);
        await Promise.all([
            needsWorldTargets ? state.worldTargetPromise : null,
            needsShipInfo ? state.shipInfoPromise : null,
        ].filter(Boolean));
        if (selectionToken !== mapSelectionToken) return;
        hideElement(mapLoading);
    }

    hideElement(mapEmpty);
    showElement(mapContent);

    // Header
    mapTitle.textContent = chapter.chapter_name
        ? `${chapter.chapter_name} ${chapter.name}`
        : chapter.name;
    const diffText = chapter.category === 'world'
        ? `대형 작전 · 난이도 ${chapter.difficulty}`
        : `난이도 ${chapter.difficulty}${chapter.unlocklevel ? ` · Lv.${chapter.unlocklevel}+` : ''}`;
    mapSubtitle.textContent = diffText;

    // Render content based on category
    if (chapter.category === 'world') {
        renderWorldGrid(chapter, mapGrid);
        mapLegend.replaceChildren();
        renderWorldStats(chapter, mapStats);
        if (chapter.randomId) {
            // Exploration map — show conditions
            const targets = getWorldTargets(chapter.randomId);
            renderExplorationInfo(chapter, targets, mapInfoGrid);
        } else {
            renderWorldInfo(chapter, mapInfoGrid);
        }
    } else if (chapter.category === 'archive') {
        renderGrid(chapter, mapGrid);
        renderLegend(chapter, mapLegend);
        renderStats(chapter, mapStats);
        renderArchiveInfo(chapter, mapInfoGrid);
    } else {
        renderGrid(chapter, mapGrid);
        renderLegend(chapter, mapLegend);
        renderStats(chapter, mapStats);
        renderMapInfo(chapter, mapInfoGrid);
    }

    // Close node detail overlay
    closeNodeOverlay();

    // URL
    setUrlParams({ map: mapId, tab: state.currentTab }, { replace: true });
}

// ===== Node Overlay =====

/** Open the floating node detail overlay with fleet info for the clicked cell. */
function handleNodeClick(attachType, chapter) {
    renderNodeDetail(attachType, chapter, nodeOverlayBody, nodeOverlayTitle);
    setNodeOverlayOpen(true);
}

function closeNodeOverlay() {
    setNodeOverlayOpen(false);
}

// ===== Compare =====

/** Called when a sidebar item is clicked in compare mode — renders the compare modal. */
function selectCompareTarget(mapId) {
    state.compareMapId = mapId;
    exitCompareMode();
    renderCompareModal(state.currentMapId, mapId);
}

// ===== Tab Switching =====

/**
 * Switch the active category tab, re-render the sidebar, and reset map selection.
 * In compare mode, skips resetting the center panel (keeps first map visible).
 */
function switchTab(tab) {
    const nextTab = VALID_TABS.has(tab) ? tab : 'main';
    state.currentTab = nextTab;

    // Update tab UI
    setTabState(nextTab);

    if (!state.compareMode) {
        state.currentMapId = null;
    }

    renderSidebar(nextTab);

    // In compare mode, keep the center panel showing the first map
    if (!state.compareMode) {
        showElement(mapEmpty);
        hideElement(mapContent);
        hideElement(mapLoading);
        closeNodeOverlay();
        renderStatus(mapEmpty, '좌측에서 해역을 선택하세요', 'empty');
        setUrlParams({ tab: nextTab, map: null, compare: null }, { replace: true });
    }
}

// ===== Search Modal =====

let searchMode = null; // 'ship' or 'blueprint'

/** Open the search modal in ship-drop or blueprint-drop mode. */
function openSearchModal(mode) {
    searchMode = mode;
    const title = document.getElementById('searchModalTitle');
    const icon = document.getElementById('searchModalIcon');
    const input = document.getElementById('searchModalInput');

    if (mode === 'ship') {
        title.textContent = '함순이 드랍 검색';
        if (icon) icon.textContent = 'directions_boat';
        input.placeholder = '함순이 이름으로 검색...';
    } else {
        title.textContent = '설계도 드랍 검색';
        if (icon) icon.textContent = 'description';
        input.placeholder = '설계도 이름으로 검색...';
    }

    input.value = '';
    renderSearchResults('');
    openModal('searchModal', { onOpen: modal => modal.setAttribute('aria-hidden', 'false') });
    setTimeout(() => input.focus(), 100);

    const pending = mode === 'ship' ? state.shipInfoPromise : state.fullDataPromise;
    pending?.then(() => {
        if (searchMode === mode) {
            renderSearchResults(input.value);
        }
    });
}

function renderSearchResults(query) {
    const body = searchModalBody || document.getElementById('searchModalBody');
    if (!body) return;

    if (searchMode === 'ship') {
        renderShipSearchResults(query, body);
    } else {
        renderBlueprintSearchResults(query, body);
    }
}

/**
 * Filter ship_info by name query and render drop location results.
 * Clicking a map tag navigates to that map, switching tab if needed.
 */
function renderShipSearchResults(query, body) {
    if (!state.shipInfo) {
        renderMessage(body, '데이터 로딩 중...', 'loading');
        return;
    }

    const q = query.toLowerCase().trim();
    const results = [];

    for (const [id, ship] of Object.entries(state.shipInfo)) {
        if (!ship.maps || !ship.maps.some(a => a && a.length > 0)) continue;
        if (q && !ship.name.toLowerCase().includes(q)) continue;

        const mapList = [];
        ship.maps.forEach((area, areaIdx) => {
            if (!area) return;
            for (const drop of area) {
                mapList.push({
                    chapter: areaIdx + 1,
                    stage: drop.map,
                    label: `${areaIdx + 1}-${drop.map}`,
                    bossOnly: drop.type === 1,
                });
            }
        });

        if (mapList.length > 0) {
            results.push({ id: parseInt(id), name: ship.name, rarity: ship.rarity, shipyard: ship.shipyard, maps: mapList });
        }
    }

    // Sort by rarity
    results.sort((a, b) => (RARITY_ORDER[a.rarity] ?? 5) - (RARITY_ORDER[b.rarity] ?? 5));

    if (results.length === 0) {
        renderMessage(body, q ? '검색 결과가 없습니다.' : '드랍 데이터가 없습니다.');
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const ship of results) {
        const infoUrl = resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(ship.name)}`);
        const item = document.createElement('div');
        item.className = 'search-result-item';
        const header = document.createElement('div');
        header.className = 'search-result-header';
        const iconSrc = ship.shipyard ? ship.shipyard.replace('shipyard.png', 'icon.png') : '';
        if (iconSrc) {
            const imageLink = document.createElement('a');
            imageLink.href = infoUrl;
            const img = document.createElement('img');
            img.className = 'search-result-portrait';
            img.src = iconSrc;
            img.alt = '';
            img.loading = 'lazy';
            img.setAttribute('data-onfail', 'hide');
            imageLink.appendChild(img);
            header.appendChild(imageLink);
        }
        const textWrap = document.createElement('div');
        const nameLink = document.createElement('a');
        nameLink.href = infoUrl;
        nameLink.className = `search-result-name rarity-text rarity-${ship.rarity}`;
        nameLink.textContent = ship.name;
        const rarity = document.createElement('span');
        rarity.className = 'search-result-rarity';
        rarity.textContent = ship.rarity;
        textWrap.append(nameLink, rarity);
        header.appendChild(textWrap);

        const maps = document.createElement('div');
        maps.className = 'search-result-maps';
        for (const m of ship.maps) {
            const mapButton = document.createElement('button');
            mapButton.type = 'button';
            mapButton.className = 'search-result-map';
            mapButton.dataset.mapId = String(m.chapter * 100 + m.stage);
            mapButton.textContent = m.label;
            if (m.bossOnly) {
                mapButton.append(' ');
                const boss = document.createElement('small');
                boss.textContent = '보스';
                mapButton.appendChild(boss);
            }
            maps.appendChild(mapButton);
        }
        item.append(header, maps);
        fragment.appendChild(item);
    }

    body.replaceChildren(fragment);
}

/**
 * Build a reverse index of blueprint → chapter IDs from item_drops, then render results.
 * Shows only SR (rarity 3) and SSR (rarity 4) sub-items; groups by blueprint across maps.
 */
function renderBlueprintSearchResults(query, body) {
    if (!state.fullData) {
        renderMessage(body, '데이터 로딩 중...', 'loading');
        return;
    }

    const q = query.toLowerCase().trim();

    // Build reverse lookup: blueprint -> maps
    const bpToMaps = {};
    for (const [id, c] of Object.entries(state.fullData)) {
        if (!c.item_drops || !c.chapter_name) continue;
        for (const drop of c.item_drops) {
            if (!drop.sub_items) continue;
            for (const sub of drop.sub_items) {
                if (sub.rarity < 3) continue; // SR (3) and SSR (4) only
                if (q && !sub.name.toLowerCase().includes(q)) continue;
                const key = `${sub.id}_${sub.name}`;
                if (!bpToMaps[key]) {
                    bpToMaps[key] = { ...sub, maps: [] };
                }
                const mapLabel = c.chapter_name;
                const category = c.category;
                // Deduplicate
                if (!bpToMaps[key].maps.some(m => m.id === c.id)) {
                    bpToMaps[key].maps.push({ id: c.id, label: mapLabel, category });
                }
            }
        }
    }

    const results = Object.values(bpToMaps);
    // Sort by rarity desc, then name
    results.sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name));

    if (results.length === 0) {
        renderMessage(body, q ? '검색 결과가 없습니다.' : '설계도 데이터가 없습니다.');
        return;
    }

    const BP_RARITY_MAP = { 5: 'UR', 4: 'SSR', 3: 'SR', 2: 'R' };

    const fragment = document.createDocumentFragment();
    for (const bp of results) {
        const iconUrl = bp.icon ? `${DATA_FOR_TOY_BASE}/${bp.icon.replace(/^Props\//, 'props/').replace(/^Equips\//, 'equips/')}.webp` : '';
        const rarityName = BP_RARITY_MAP[bp.rarity] || 'N';
        const rarityClass = `rarity-text rarity-${rarityName}`;
        const bgClass = `search-bp-rarity-${bp.rarity}`;
        const item = document.createElement('div');
        item.className = 'search-result-item';
        const header = document.createElement('div');
        header.className = 'search-result-header';
        if (iconUrl) {
            const img = document.createElement('img');
            img.className = `search-result-bp-icon ${bgClass}`;
            img.src = iconUrl;
            img.alt = '';
            img.loading = 'lazy';
            img.setAttribute('data-onfail', 'hide');
            header.appendChild(img);
        }
        const name = document.createElement('span');
        name.className = rarityClass;
        name.textContent = bp.name;
        header.appendChild(name);

        const maps = document.createElement('div');
        maps.className = 'search-result-maps';
        for (const m of bp.maps) {
            const fullKey = m.category === 'world' ? `w_${m.id}` : m.category === 'archive' ? `a_${m.id}` : String(m.id);
            const mapButton = document.createElement('button');
            mapButton.type = 'button';
            mapButton.className = 'search-result-map';
            mapButton.dataset.mapId = fullKey;
            mapButton.dataset.category = m.category;
            mapButton.textContent = m.label;
            maps.appendChild(mapButton);
        }
        item.append(header, maps);
        fragment.appendChild(item);
    }

    body.replaceChildren(fragment);
}

function navigateToSearchMap(mapId, category) {
    closeModal('searchModal', { onClose: modal => modal.setAttribute('aria-hidden', 'true') });
    const targetCategory = category || 'main';
    if (state.currentTab !== targetCategory) switchTab(targetCategory);
    selectMap(mapId);
}

// ===== Init =====

/**
 * Initialize the map viewer: cache DOM, wire sub-modules, load lite data, restore URL state.
 * Full data and ship info load in the background; full data is awaited only if a specific map
 * is requested via URL param or when a sidebar item is clicked before it resolves.
 */
async function init() {
    cacheDom();

    // Setup modules
    setupData(state);
    setupGrid(state, handleNodeClick);
    setupDetail(state);
    setupCompare(state);
    setupCompareModal();
    setupSidebarListeners();

    // Load lite data (blocking)
    try {
        showElement(mapLoading);
        await loadLiteData();
    } catch (error) {
        console.error('Failed to load map list:', error);
        hideElement(mapLoading);
        renderStatus(mapEmpty, '해역 목록을 불러오지 못했습니다.', 'error');
        showElement(mapEmpty);
        return;
    } finally {
        hideElement(mapLoading);
    }

    // Capture all URL params before switchTab runs — switchTab wipes map/compare
    // from the URL as part of its normal tab-change behavior, so we must read
    // them upfront or they'll be gone by the time we try to restore state.
    const urlTab = VALID_TABS.has(getUrlParam('tab', 'main')) ? getUrlParam('tab', 'main') : 'main';
    const urlMap = getUrlParam('map');
    const compareParam = getUrlParam('compare');

    switchTab(urlTab);

    // Load full data and ship info in background
    state.fullDataPromise = loadFullData();
    state.shipInfoPromise = loadShipInfo();
    state.worldTargetPromise = loadWorldTargetData();

    // Node overlay close button
    if (nodeOverlayClose) {
        nodeOverlayClose.addEventListener('click', closeNodeOverlay);
    }

    // Close overlay on ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && nodeOverlay && nodeOverlay.classList.contains('active')) {
            closeNodeOverlay();
        }
    });

    // Tab click handlers
    mapTabs.addEventListener('click', (e) => {
        const tab = e.target.closest('.map-tab');
        if (tab) switchTab(tab.dataset.tab);
    });

    // Compare button
    if (compareBtn) {
        compareBtn.addEventListener('click', () => {
            if (!state.currentMapId) return;
            enterCompareMode();
        });
    }

    // Compare cancel
    if (compareCancelBtn) {
        compareCancelBtn.addEventListener('click', exitCompareMode);
    }

    // Mobile select
    if (mobileMapSelect) {
        mobileMapSelect.addEventListener('change', (e) => {
            if (e.target.value) {
                if (state.compareMode) {
                    selectCompareTarget(e.target.value);
                } else {
                    selectMap(e.target.value);
                }
            }
        });
    }

    // Search buttons
    const searchShipBtn = document.getElementById('searchShipBtn');
    const searchBlueprintBtn = document.getElementById('searchBlueprintBtn');
    if (searchShipBtn) searchShipBtn.addEventListener('click', () => openSearchModal('ship'));
    if (searchBlueprintBtn) searchBlueprintBtn.addEventListener('click', () => openSearchModal('blueprint'));

    // Search modal setup
    setupModal('searchModal', {
        closeButtonSelector: '#searchModalClose',
        closeOnEscape: true,
        closeOnBackdrop: true,
        restoreFocus: true,
        setAriaHidden: false,
        onClose: modal => modal.setAttribute('aria-hidden', 'true'),
    });

    const searchInput = searchModalInput || document.getElementById('searchModalInput');
    if (searchInput) {
        searchInput.addEventListener('input', debounce((e) => {
            renderSearchResults(e.target.value);
        }, 200));
    }

    if (searchModalBody) {
        searchModalBody.addEventListener('click', (event) => {
            const mapButton = event.target.closest('.search-result-map');
            if (!mapButton) return;
            navigateToSearchMap(mapButton.dataset.mapId, mapButton.dataset.category);
        });
    }

    // Restore map selection from URL (captured before switchTab wiped the params)
    if (urlMap) {
        // Auto-detect tab from map ID
        await state.fullDataPromise;
        const chapter = state.fullData?.[urlMap];
        if (chapter && chapter.category !== state.currentTab) {
            switchTab(chapter.category);
        }
        await selectMap(urlMap);
    }

    // Restore compare modal from URL
    if (compareParam) {
        const [id1, id2] = compareParam.split(',');
        if (id1 && id2) {
            await state.fullDataPromise;
            renderCompareModal(id1, id2);
        }
    }
}

init();
