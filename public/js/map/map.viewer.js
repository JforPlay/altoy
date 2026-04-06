/**
 * map.viewer.js
 * Main entry point for the map viewer page.
 * Part of the map module group (viewer + data + detail + grid + compare).
 * Owns shared state and wires all sub-modules (data, grid, detail, compare).
 * Covers: tab switching, sidebar rendering, map selection, node overlay, search modal (ship + blueprint).
 */

import { getUrlParam, setUrlParams, showElement, hideElement, openModal, closeModal, setupModal, resolveUrl, debounce } from '../utils.js';

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
};

// DOM refs
let mapTabs, mapSidebar, mapCenter, mapContent, mapEmpty, mapLoading;
let mapTitle, mapSubtitle, mapStats, mapGrid, mapLegend, mapInfoGrid;
let nodeOverlay, nodeOverlayTitle, nodeOverlayBody, nodeOverlayClose;
let compareBtn, compareBar, compareCancelBtn;
let mobileMapSelect;

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

    let html = '';
    for (const [groupName, items] of groups) {
        const groupLabel = category === 'event' || category === 'world' || category === 'archive'
                           ? groupName : `${groupName}장`;
        html += `<div class="sidebar-group">`;
        html += `<div class="sidebar-group-header" data-group="${groupName}"><span>${groupLabel}</span><span class="material-symbols-outlined sidebar-chevron">expand_more</span></div>`;
        html += `<div class="sidebar-group-items collapsed">`;
        for (const item of items) {
            const label = item.chapter_name ? `${item.chapter_name} ${item.name}` : item.name;
            const key = category === 'world' ? `w_${item.id}` : category === 'archive' ? `a_${item.id}` : String(item.id);
            html += `<div class="sidebar-item" data-map-id="${key}">${label}</div>`;
        }
        html += `</div></div>`;
    }

    mapSidebar.innerHTML = html;

    // Note: click delegation for sidebar items and accordion headers
    // is set up once in init() via setupSidebarListeners(), not here.

    // Populate mobile select
    if (mobileMapSelect) {
        let options = '<option value="">해역을 선택하세요</option>';
        for (const [groupName, items] of groups) {
            const groupLabel = category === 'event' || category === 'world' || category === 'archive'
                               ? groupName : `${groupName}장`;
            options += `<optgroup label="${groupLabel}">`;
            for (const item of items) {
                const label = item.chapter_name ? `${item.chapter_name} ${item.name}` : item.name;
                const key = category === 'world' ? `w_${item.id}` : category === 'archive' ? `a_${item.id}` : String(item.id);
                options += `<option value="${key}">${label}</option>`;
            }
            options += '</optgroup>';
        }
        mobileMapSelect.innerHTML = options;
    }
}

// ===== Map Selection =====

/**
 * Select and display a map by ID.
 * Waits for full data if it hasn't loaded yet, then dispatches to the correct
 * render path based on chapter.category (world / archive / standard).
 */
async function selectMap(mapId) {
    state.currentMapId = mapId;

    // Update sidebar active state
    mapSidebar.querySelectorAll('.sidebar-item').forEach(el => {
        el.classList.toggle('active', el.dataset.mapId === mapId);
    });

    // Expand parent group if collapsed
    const activeItem = mapSidebar.querySelector(`.sidebar-item[data-map-id="${mapId}"]`);
    if (activeItem) {
        const groupItems = activeItem.closest('.sidebar-group-items');
        if (groupItems && groupItems.classList.contains('collapsed')) {
            groupItems.classList.remove('collapsed');
            const header = groupItems.previousElementSibling;
            if (header) header.classList.add('expanded');
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
        hideElement(mapLoading);
    }

    const chapter = state.fullData?.[mapId];
    if (!chapter) {
        showElement(mapEmpty);
        hideElement(mapContent);
        return;
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
        mapLegend.innerHTML = '';
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
    nodeOverlay.classList.add('active');
}

function closeNodeOverlay() {
    if (nodeOverlay) nodeOverlay.classList.remove('active');
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
    state.currentTab = tab;

    // Update tab UI
    mapTabs.querySelectorAll('.map-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });

    renderSidebar(tab);

    // In compare mode, keep the center panel showing the first map
    if (!state.compareMode) {
        state.currentMapId = null;
        showElement(mapEmpty);
        hideElement(mapContent);
        hideElement(mapLoading);
        closeNodeOverlay();
        setUrlParams({ tab, map: null, compare: null }, { replace: true });
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
    openModal('searchModal');
    setTimeout(() => input.focus(), 100);
}

function renderSearchResults(query) {
    const body = document.getElementById('searchModalBody');
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
        body.innerHTML = '<div class="detail-empty">데이터 로딩 중...</div>';
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
    const RARITY_ORDER = { 'UR': 0, 'SSR': 1, 'SR': 2, 'R': 3, 'N': 4 };
    results.sort((a, b) => (RARITY_ORDER[a.rarity] ?? 5) - (RARITY_ORDER[b.rarity] ?? 5));

    if (results.length === 0) {
        body.innerHTML = `<div class="detail-empty">${q ? '검색 결과가 없습니다.' : '드랍 데이터가 없습니다.'}</div>`;
        return;
    }

    let html = '';
    for (const ship of results) {
        const infoUrl = resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(ship.name)}`);
        html += `<div class="search-result-item">`;
        html += `<div class="search-result-header">`;
        const iconSrc = ship.shipyard ? ship.shipyard.replace('shipyard.png', 'icon.png') : '';
        if (iconSrc) {
            html += `<a href="${infoUrl}"><img class="search-result-portrait" src="${iconSrc}" alt="" loading="lazy" onerror="this.style.display='none'"></a>`;
        }
        html += `<div>`;
        html += `<a href="${infoUrl}" class="search-result-name search-rarity-${ship.rarity}">${ship.name}</a>`;
        html += `<span class="search-result-rarity">${ship.rarity}</span>`;
        html += `</div></div>`;
        html += `<div class="search-result-maps">`;
        for (const m of ship.maps) {
            html += `<span class="search-result-map" data-map-id="${m.chapter * 100 + m.stage}">${m.label}${m.bossOnly ? ' <small>보스</small>' : ''}</span>`;
        }
        html += `</div></div>`;
    }

    body.innerHTML = html;

    // Click map tags to navigate
    body.querySelectorAll('.search-result-map').forEach(el => {
        el.addEventListener('click', () => {
            const mapId = el.dataset.mapId;
            closeModal('searchModal');
            if (state.currentTab !== 'main') switchTab('main');
            selectMap(mapId);
        });
    });
}

/**
 * Build a reverse index of blueprint → chapter IDs from item_drops, then render results.
 * Shows only SR (rarity 3) and SSR (rarity 4) sub-items; groups by blueprint across maps.
 */
function renderBlueprintSearchResults(query, body) {
    if (!state.fullData) {
        body.innerHTML = '<div class="detail-empty">데이터 로딩 중...</div>';
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
        body.innerHTML = `<div class="detail-empty">${q ? '검색 결과가 없습니다.' : '설계도 데이터가 없습니다.'}</div>`;
        return;
    }

    const DATA_FOR_TOY_BASE = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main';

    const BP_RARITY_MAP = { 5: 'UR', 4: 'SSR', 3: 'SR', 2: 'R' };

    let html = '';
    for (const bp of results) {
        const iconUrl = bp.icon ? `${DATA_FOR_TOY_BASE}/${bp.icon.replace(/^Props\//, 'props/').replace(/^Equips\//, 'equips/')}.webp` : '';
        const rarityName = BP_RARITY_MAP[bp.rarity] || 'N';
        const rarityClass = `search-rarity-${rarityName}`;
        const bgClass = `search-bp-rarity-${bp.rarity}`;
        html += `<div class="search-result-item">`;
        html += `<div class="search-result-header">`;
        if (iconUrl) html += `<img class="search-result-bp-icon ${bgClass}" src="${iconUrl}" alt="" loading="lazy" onerror="this.style.display='none'">`;
        html += `<span class="${rarityClass}">${bp.name}</span>`;
        html += `</div>`;
        html += `<div class="search-result-maps">`;
        for (const m of bp.maps) {
            const fullKey = m.category === 'world' ? `w_${m.id}` : String(m.id);
            html += `<span class="search-result-map" data-map-id="${fullKey}" data-category="${m.category}">${m.label}</span>`;
        }
        html += `</div></div>`;
    }

    body.innerHTML = html;

    // Click map tags to navigate
    body.querySelectorAll('.search-result-map').forEach(el => {
        el.addEventListener('click', () => {
            const mapId = el.dataset.mapId;
            const category = el.dataset.category;
            closeModal('searchModal');
            if (state.currentTab !== category) switchTab(category);
            selectMap(mapId);
        });
    });
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
    await loadLiteData();

    // Determine initial tab from URL or default
    const urlTab = getUrlParam('tab', 'main');
    switchTab(urlTab);

    // Load full data and ship info in background
    state.fullDataPromise = loadFullData();
    loadShipInfo();
    loadWorldTargetData();

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
    });

    const searchInput = document.getElementById('searchModalInput');
    if (searchInput) {
        searchInput.addEventListener('input', debounce((e) => {
            renderSearchResults(e.target.value);
        }, 200));
    }

    // Handle URL params on load
    const urlMap = getUrlParam('map');
    if (urlMap) {
        // Auto-detect tab from map ID
        await state.fullDataPromise;
        const chapter = state.fullData?.[urlMap];
        if (chapter && chapter.category !== state.currentTab) {
            switchTab(chapter.category);
        }
        selectMap(urlMap);
    }

    // Handle compare URL
    const compareParam = getUrlParam('compare');
    if (compareParam) {
        const [id1, id2] = compareParam.split(',');
        if (id1 && id2) {
            await state.fullDataPromise;
            renderCompareModal(id1, id2);
        }
    }
}

init();
