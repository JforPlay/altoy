/**
 * Equipment Viewer Module - Main Entry Point
 * State management, routing, filters, search, panel/modal control
 */

import {
    createSearchIndex, debounce, getUrlParam, setUrlParams,
    resolveUrl, showToast, openModal, closeModal,
    showElement, hideElement
} from '../utils.js';
import {
    setup as setupData,
    loadLiteData, loadFullData, loadStatisticsData, loadEquipTypeData,
    loadNationalityData, loadShipTypeData, loadEquipCodeData,
    loadWeaponPropertyData, loadBulletTemplateData, loadSkillData, loadWeaponNameData, loadAircraftTemplateData,
    loadUpgradeTemplateData, isInUpgradeTree,
    getEquipIconUrl, getRarityBgUrl, getUniqueTypes, getUniqueNationalities, getUniqueLabels,
    getFullEquipData
} from './equip.data.js';
import {
    setup as setupDetail,
    showDetailView,
    downloadEquipIcon
} from './equip.detail.js';
import {
    setup as setupCompare,
    setupCompareModal,
    renderCompareModal,
    loadCompareFromUrl
} from './equip.compare.js';

// ===== Application State =====
const state = {
    equipData: [],
    fullEquipData: null,
    fullEquipDataPromise: null,
    statisticsData: null,
    equipCodeData: null,
    weaponPropertyData: null,
    bulletTemplateData: null,
    skillData: null,
    filteredData: [],
    currentEquip: null,
    currentLevel: 0,

    // Mapping data
    equipTypeData: {},
    nationalityData: {},
    shipTypeData: {},

    // Filter state
    activeLabels: new Set(),
    activeRarities: new Set(),

    // Compare state
    compareSlots: [null, null],
    compareLevels: [0, 0],
    compareMode: false,
    compareFirstItem: null,
    compareGroupFilter: null,

    // Search
    searchIndex: null,

    // DOM Elements
    elements: {},
};

// ===== DOM Elements =====
const mainView = document.getElementById('mainView');
const equipGrid = document.getElementById('equipGrid');
const searchInput = document.getElementById('searchInput');
const typeFilter = document.getElementById('typeFilter');
const nationalityFilter = document.getElementById('nationalityFilter');
const rarityChips = document.getElementById('rarityChips');
const labelChips = document.getElementById('labelChips');
const loading = document.getElementById('loading');
const totalCount = document.getElementById('totalCount');
const filteredCount = document.getElementById('filteredCount');

// Panel elements
const detailPanel = document.getElementById('detailPanel');
const detailBackdrop = document.getElementById('detailBackdrop');
const detailPanelContent = document.getElementById('detailPanelContent');
const detailPanelClose = document.getElementById('detailPanelClose');
const detailCompareBtn = document.getElementById('detailCompareBtn');
const detailDownloadBtn = document.getElementById('detailDownloadBtn');

// Compare mode elements
const compareModeBar = document.getElementById('compareModeBar');
const compareModeText = document.getElementById('compareModeText');
const compareModeCancel = document.getElementById('compareModeCancel');

state.elements = {
    mainView, equipGrid, searchInput, typeFilter, nationalityFilter,
    rarityChips, labelChips, loading, totalCount, filteredCount,
    detailPanel, detailBackdrop, detailPanelContent,
    compareModeBar, compareModeText
};

// Initialize sub-modules
setupData(state);
setupDetail(state);
setupCompare(state);

// ===== Initialization =====
async function init() {
    try {
        loading.style.display = 'block';

        if ('scrollRestoration' in history) {
            history.scrollRestoration = 'manual';
        }

        await Promise.all([
            loadLiteData(),
            loadEquipTypeData(),
            loadNationalityData(),
            loadShipTypeData(),
            loadEquipCodeData(),
        ]);

        // Start loading full data and reference data in background
        state.fullEquipDataPromise = loadFullData();
        loadStatisticsData();
        loadWeaponPropertyData();
        loadBulletTemplateData();
        loadSkillData();
        loadWeaponNameData();
        loadAircraftTemplateData();
        loadUpgradeTemplateData();

        loading.style.display = 'none';

        // Build search index
        state.searchIndex = createSearchIndex(state.equipData, {
            keys: ['name', 'type_name', 'type_name2', 'nation_name', 'nation_code'],
            threshold: 0.3,
        });

        populateFilters();
        setupEventListeners();
        setupCompareModal();
        handleRoute();
        window.addEventListener('popstate', handleRoute);

    } catch (error) {
        loading.style.display = 'none';
        showToast(error.message || '초기화 오류', 'error');
        console.error('Initialization error:', error);
    }
}

// ===== Populate Filters =====
function populateFilters() {
    const types = getUniqueTypes();
    typeFilter.innerHTML = '<option value="">모든 장비</option>' +
        types.map(t => `<option value="${t.id}">${t.name2 || t.name}</option>`).join('');

    const nations = getUniqueNationalities();
    nationalityFilter.innerHTML = '<option value="">모든 진영</option>' +
        nations.map(n => `<option value="${n.id}">${n.name}</option>`).join('');

    const labels = getUniqueLabels();
    labelChips.innerHTML = labels.map(l =>
        `<button class="label-chip" data-label="${l}">${l}</button>`
    ).join('');

    updateFilterStats();
}

// ===== Event Listeners =====
function setupEventListeners() {
    const debouncedFilter = debounce(filterEquipment, 200);

    searchInput.addEventListener('input', debouncedFilter);
    typeFilter.addEventListener('change', filterEquipment);
    nationalityFilter.addEventListener('change', filterEquipment);

    // Rarity chip toggles
    rarityChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.rarity-chip');
        if (!chip) return;
        const rarity = chip.dataset.rarity;
        if (state.activeRarities.has(rarity)) {
            state.activeRarities.delete(rarity);
            chip.classList.remove('active');
        } else {
            state.activeRarities.add(rarity);
            chip.classList.add('active');
        }
        filterEquipment();
    });

    // Label chip toggles
    labelChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.label-chip');
        if (!chip) return;
        const label = chip.dataset.label;
        if (state.activeLabels.has(label)) {
            state.activeLabels.delete(label);
            chip.classList.remove('active');
        } else {
            state.activeLabels.add(label);
            chip.classList.add('active');
        }
        filterEquipment();
    });

    // Detail panel close
    detailPanelClose.addEventListener('click', closeDetailPanel);
    detailBackdrop.addEventListener('click', closeDetailPanel);

    // Detail panel footer buttons
    detailCompareBtn.addEventListener('click', () => {
        if (state.currentEquip) {
            enterCompareMode(state.currentEquip);
        }
    });

    detailDownloadBtn.addEventListener('click', () => {
        downloadEquipIcon(state.currentEquip);
    });

    // Compare mode cancel
    compareModeCancel.addEventListener('click', exitCompareMode);

    // ESC key for panel
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (state.compareMode) {
                exitCompareMode();
            } else if (detailPanel.classList.contains('open')) {
                closeDetailPanel();
            }
        }
    });
}

// ===== Filtering =====
function filterEquipment() {
    const searchTerm = searchInput.value.trim();
    const selectedType = typeFilter.value;
    const selectedNation = nationalityFilter.value;

    let results = state.equipData;

    if (searchTerm) {
        const searchResults = state.searchIndex.search(searchTerm);
        results = searchResults.map(r => r.item);
    }

    state.filteredData = results.filter(equip => {
        const matchType = !selectedType || String(equip.type) === selectedType;
        const matchNation = !selectedNation || String(equip.nationality) === selectedNation;
        const matchRarity = state.activeRarities.size === 0 || state.activeRarities.has(String(equip.rarity));
        const matchLabels = state.activeLabels.size === 0 ||
            (equip.label && [...state.activeLabels].every(l => equip.label.includes(l)));
        return matchType && matchNation && matchRarity && matchLabels;
    });

    renderEquipGrid();
    updateFilterStats();
}

// ===== Rendering =====
function renderEquipGrid() {
    if (state.filteredData.length === 0) {
        equipGrid.innerHTML = '<div class="empty-state">장비를 찾을 수 없습니다.</div>';
        return;
    }

    // Group by type
    const groups = new Map();
    for (const equip of state.filteredData) {
        const typeName = equip.type_name2 || equip.type_name || `타입 ${equip.type}`;
        if (!groups.has(typeName)) {
            groups.set(typeName, []);
        }
        groups.get(typeName).push(equip);
    }

    const fragment = document.createDocumentFragment();

    for (const [typeName, equips] of groups) {
        const section = document.createElement('div');
        section.className = 'equip-type-section';
        section.innerHTML = `
            <div class="type-section-header">
                <h2>${typeName}</h2>
                <span class="type-section-count">(${equips.length})</span>
            </div>
        `;
        fragment.appendChild(section);

        const grid = document.createElement('div');
        grid.className = 'type-section-grid';

        for (const equip of equips) {
            const card = document.createElement('div');
            card.className = `equip-card rarity-${equip.rarity}`;
            card.dataset.equipId = equip.id;
            if (equip.compare_group != null) {
                card.dataset.compareGroup = equip.compare_group;
            }

            const iconUrl = getEquipIconUrl(equip.icon);
            const bgUrl = getRarityBgUrl(equip.rarity);
            const statsHtml = (equip.max_attrs || []).map(attr =>
                `<span class="equip-stat-item">
                    <span class="equip-stat-name">${attr.name}</span>
                    <span class="equip-stat-value">${attr.value}</span>
                </span>`
            ).join('');

            card.innerHTML = `
                <div class="equip-icon-wrapper">
                    <img class="equip-icon-bg-img" src="${bgUrl}" alt="" loading="lazy">
                    ${iconUrl ? `<img class="equip-icon-img" src="${iconUrl}" alt="${equip.name}" loading="lazy">` : ''}
                </div>
                <div class="equip-card-info">
                    <div class="equip-card-name">${equip.name}</div>
                    <div class="equip-card-meta">
                        <span class="equip-rarity-badge rarity-${equip.rarity}">${equip.rarity_name}</span>
                        ${equip.nation_code ? `<span class="equip-nation-code">${equip.nation_code}</span>` : ''}
                        ${equip.level_count > 1 ? `<span class="equip-type-badge">+${equip.level_count - 1}</span>` : ''}
                    </div>
                    ${statsHtml ? `<div class="equip-card-stats">${statsHtml}</div>` : ''}
                </div>
            `;

            card.addEventListener('click', () => onCardClick(equip.id));
            grid.appendChild(card);
        }

        fragment.appendChild(grid);
    }

    equipGrid.innerHTML = '';
    equipGrid.appendChild(fragment);

    // Apply compare mode visual overlay if active
    if (state.compareMode) {
        applyCompareModeOverlay();
    }
}

function updateFilterStats() {
    if (totalCount) totalCount.textContent = state.equipData.length;
    if (filteredCount) filteredCount.textContent = state.filteredData.length;
}

// ===== Card Click Handler =====
function onCardClick(equipId) {
    if (state.compareMode) {
        selectCompareSecondItem(equipId);
    } else {
        openDetailPanel(equipId);
    }
}

// ===== Detail Panel =====
async function openDetailPanel(equipId) {
    // Load data and render into panel
    const equip = await showDetailView(parseInt(equipId));
    if (!equip) return;

    // Update URL (clear compare param if lingering)
    setUrlParams({ equip: equipId, compare: null }, { replace: true });

    // Update research tree link (hide if equip not in any upgrade tree)
    const researchLink = document.getElementById('detailResearchLink');
    if (researchLink) {
        if (isInUpgradeTree(parseInt(equipId))) {
            researchLink.href = `/altoy/equip/equip-upgrade?equip=${equipId}`;
            researchLink.style.display = '';
        } else {
            researchLink.style.display = 'none';
        }
    }

    // Show panel
    detailPanel.classList.add('open');
    detailBackdrop.classList.add('visible');
    document.body.style.overflow = 'hidden';
}

function closeDetailPanel() {
    detailPanel.classList.remove('open');
    detailBackdrop.classList.remove('visible');
    document.body.style.overflow = '';

    // Clear equip URL param
    setUrlParams({ equip: null }, { replace: true });
}

// ===== Compare Mode =====
function enterCompareMode(firstEquip) {
    state.compareMode = true;
    state.compareFirstItem = firstEquip;
    state.compareGroupFilter = firstEquip.compare_group;

    // Close detail panel
    closeDetailPanel();

    // Show floating bar
    compareModeText.textContent = `"${firstEquip.name}" 과(와) 비교할 장비를 선택하세요`;
    compareModeBar.style.display = 'flex';

    // Apply visual overlay to cards
    applyCompareModeOverlay();
}

function exitCompareMode() {
    state.compareMode = false;
    state.compareFirstItem = null;
    state.compareGroupFilter = null;

    // Hide floating bar
    compareModeBar.style.display = 'none';

    // Remove card overlay classes
    removeCompareModeOverlay();
}

function applyCompareModeOverlay() {
    const cards = equipGrid.querySelectorAll('.equip-card');
    for (const card of cards) {
        const cardGroup = card.dataset.compareGroup;
        const cardId = card.dataset.equipId;

        if (state.compareFirstItem && String(cardId) === String(state.compareFirstItem.id)) {
            card.classList.add('compare-selected');
            card.classList.remove('compare-ineligible');
        } else if (state.compareGroupFilter != null && cardGroup !== String(state.compareGroupFilter)) {
            card.classList.add('compare-ineligible');
            card.classList.remove('compare-selected');
        } else {
            card.classList.remove('compare-ineligible');
            card.classList.remove('compare-selected');
        }
    }
}

function removeCompareModeOverlay() {
    const cards = equipGrid.querySelectorAll('.equip-card');
    for (const card of cards) {
        card.classList.remove('compare-ineligible', 'compare-selected');
    }
}

async function selectCompareSecondItem(equipId) {
    const secondEquip = await getFullEquipData(parseInt(equipId));
    if (!secondEquip) {
        showToast('장비 데이터를 찾을 수 없습니다.', 'error');
        return;
    }

    // Verify same compare_group
    if (secondEquip.compare_group !== state.compareFirstItem.compare_group) {
        showToast('같은 종류의 장비만 비교할 수 있습니다.', 'error');
        return;
    }

    // Don't compare with self
    if (secondEquip.id === state.compareFirstItem.id) {
        showToast('같은 장비끼리는 비교할 수 없습니다.', 'info');
        return;
    }

    const firstEquip = state.compareFirstItem;

    // Exit compare mode first
    exitCompareMode();

    // Update URL and open modal
    setUrlParams({ compare: `${firstEquip.id},${secondEquip.id}`, equip: null }, { replace: true });
    renderCompareModal(firstEquip, secondEquip);
}

// ===== Routing =====
function handleRoute() {
    const equipParam = getUrlParam('equip');
    const compareParam = getUrlParam('compare');

    if (compareParam) {
        loadCompareFromUrl(compareParam);
    } else if (equipParam) {
        openDetailPanel(parseInt(equipParam));
    } else {
        // Close panel and modal if open
        closeDetailPanel();
        closeModal('compareModal');
    }

    // Always show the main view (list)
    mainView.style.display = 'block';
    renderEquipGrid();
    updateFilterStats();
}

// ===== Start Application =====
init();
