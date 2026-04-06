'use strict';

/**
 * shipgirl-stats.js
 * Main entry for the shipgirl stats page. Bootstraps sub-modules, loads data,
 * manages tab switching (ship info / skin info), shared filters (search, rarity,
 * ship type, nationality), threshold filters, and compare mode event wiring.
 */

import { debounce, showElement, hideElement, toggleElement, showToast, setupScrollToTop } from '../utils.js';
import { setup as setupData, loadAllData, PRIMARY_STATS, SKIN_TAG_KEYS, getNationalityName, getShipTypeName } from './shipgirl-stats.data.js';
import { setup as setupDashboard, renderShipDashboard, renderSkinDashboard, renderTopStatChart, destroyAllCharts } from './shipgirl-stats.dashboard.js';
import { setup as setupTable, renderShipTable, renderSkinTable } from './shipgirl-stats.table.js';
import { setup as setupCompare, updateCompareBar, openCompareModal } from './shipgirl-stats.compare.js';

// ===== State =====

const state = {
    // Raw data (populated by data module)
    shipInfoData: [], skinSubsetData: [], skinReleaseDates: {},
    nationalityData: {}, shipTypeData: {}, attrTypeData: {},
    // Computed (populated by data module)
    shipStats: [], skinByShip: new Map(),
    shipStatsByName: new Map(), shipStatsById: new Map(),
    // Filtered view
    filteredShipStats: null,
    // UI state
    activeTab: 'ship',
    compareList: [],
    // Sort/page state (populated by table module)
    shipSort: null, skinSort: null,
    shipPage: 1, skinPage: 1, shipExpanded: false,
    // Threshold filters
    shipThresholds: {}, skinThresholds: {},
};

// ===== Init =====

async function init() {
    // Wire up all sub-modules with shared state
    setupData(state);
    setupDashboard(state);
    setupTable(state);
    setupCompare(state);

    try {
        await loadAllData();
    } catch (err) {
        console.error('Failed to load stats data:', err);
        showToast('데이터를 불러오지 못했습니다.', 'error');
    }

    hideElement(document.getElementById('loading'));

    populateFilterDropdowns();
    setupEventListeners();
    setupThresholdFilters();
    applyFilters();
    setupScrollToTop('scroll-to-top');
}

// ===== Filter Dropdowns =====

function populateFilterDropdowns() {
    // Ship type filter
    const shipTypeSelect = document.getElementById('shipTypeFilter');
    if (shipTypeSelect) {
        const typeEntries = Object.entries(state.shipTypeData)
            .map(([id, entry]) => ({ id, name: entry.type_name || String(id) }))
            .filter(e => e.name)
            .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

        const opts = typeEntries
            .map(e => `<option value="${e.id}">${e.name}</option>`)
            .join('');
        shipTypeSelect.innerHTML = '<option value="">모든 함종</option>' + opts;
    }

    // Nationality filter
    const nationalitySelect = document.getElementById('nationalityFilter');
    if (nationalitySelect) {
        const natEntries = Object.entries(state.nationalityData)
            .map(([id, entry]) => ({ id, name: entry.name || '' }))
            .filter(e => e.name)
            .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

        const opts = natEntries
            .map(e => `<option value="${e.id}">${e.name}</option>`)
            .join('');
        nationalitySelect.innerHTML = '<option value="">모든 진영</option>' + opts;
    }
}

// ===== Threshold Filters =====

function setupThresholdFilters() {
    // --- Ship stat thresholds ---
    const shipControls = document.getElementById('shipThresholdControls');
    if (shipControls) {
        const fragment = document.createDocumentFragment();
        for (const stat of PRIMARY_STATS) {
            const label = _getAttrLabel(stat);
            const group = document.createElement('div');
            group.className = 'threshold-group';
            group.innerHTML = `
                <label class="threshold-label">${label}</label>
                <input type="number" class="threshold-input" data-stat="${stat}" min="0" placeholder="최솟값">
            `;
            fragment.appendChild(group);
        }
        shipControls.appendChild(fragment);

        shipControls.addEventListener('input', debounce(() => {
            state.shipThresholds = {};
            shipControls.querySelectorAll('.threshold-input[data-stat]').forEach(input => {
                const val = parseFloat(input.value);
                if (!isNaN(val) && val > 0) {
                    state.shipThresholds[input.dataset.stat] = val;
                }
            });
            applyFilters();
        }, 300));
    }

    // Ship threshold toggle
    const shipToggle = document.getElementById('shipThresholdToggle');
    if (shipToggle) {
        shipToggle.addEventListener('click', () => {
            const section = shipToggle.closest('.threshold-section');
            if (section) section.classList.toggle('open');
        });
    }

    // --- Skin stat thresholds ---
    const skinControls = document.getElementById('skinThresholdControls');
    if (skinControls) {
        const skinThresholdDefs = [
            { key: 'total',        label: '총 스킨' },
            { key: 'L2D',          label: 'L2D' },
            { key: 'L2D+',         label: 'L2D+' },
            { key: '듀얼',          label: '듀얼' },
            { key: 'daysSinceLast', label: '경과일' },
        ];

        const fragment = document.createDocumentFragment();
        for (const def of skinThresholdDefs) {
            const group = document.createElement('div');
            group.className = 'threshold-group';
            group.innerHTML = `
                <label class="threshold-label">${def.label}</label>
                <input type="number" class="threshold-input" data-skin-stat="${def.key}" min="0" placeholder="최솟값">
            `;
            fragment.appendChild(group);
        }
        skinControls.appendChild(fragment);

        skinControls.addEventListener('input', debounce(() => {
            state.skinThresholds = {};
            skinControls.querySelectorAll('.threshold-input[data-skin-stat]').forEach(input => {
                const val = parseFloat(input.value);
                if (!isNaN(val) && val > 0) {
                    state.skinThresholds[input.dataset.skinStat] = val;
                }
            });
            applyFilters();
        }, 300));
    }

    // Skin threshold toggle
    const skinToggle = document.getElementById('skinThresholdToggle');
    if (skinToggle) {
        skinToggle.addEventListener('click', () => {
            const section = skinToggle.closest('.threshold-section');
            if (section) section.classList.toggle('open');
        });
    }
}

// ===== Filtering =====

function applyFilters() {
    const searchEl = document.getElementById('searchInput');
    const search = searchEl ? searchEl.value.toLowerCase().trim() : '';

    const activeChip = document.querySelector('#rarityChips .rarity-chip.active');
    const rarity = activeChip ? activeChip.dataset.rarity : '';

    const shipTypeEl = document.getElementById('shipTypeFilter');
    const shipType = shipTypeEl ? shipTypeEl.value : '';

    const nationalityEl = document.getElementById('nationalityFilter');
    const nationality = nationalityEl ? nationalityEl.value : '';

    let result = state.shipStats || [];

    // 1. Search
    if (search) {
        result = result.filter(entry => {
            const name = entry.ship && entry.ship.name ? entry.ship.name.toLowerCase() : '';
            return name.includes(search);
        });
    }

    // 2. Rarity
    if (rarity) {
        result = result.filter(entry => entry.ship && entry.ship.rarity === rarity);
    }

    // 3. Ship type
    if (shipType) {
        result = result.filter(entry => entry.ship && String(entry.ship.type) === shipType);
    }

    // 4. Nationality
    if (nationality) {
        result = result.filter(entry => entry.ship && String(entry.ship.nationality) === nationality);
    }

    // 5. Ship stat thresholds (only when ship tab is active)
    if (state.activeTab === 'ship' && Object.keys(state.shipThresholds).length > 0) {
        result = result.filter(entry => {
            for (const [stat, minVal] of Object.entries(state.shipThresholds)) {
                const val = entry.combat ? (entry.combat[stat] || 0) : 0;
                if (val < minVal) return false;
            }
            return true;
        });
    }

    // 6. Skin thresholds (only when skin tab is active)
    if (state.activeTab === 'skin' && Object.keys(state.skinThresholds).length > 0) {
        result = result.filter(entry => {
            for (const [key, minVal] of Object.entries(state.skinThresholds)) {
                const val = entry.skin ? (entry.skin[key] ?? 0) : 0;
                if (val < minVal) return false;
            }
            return true;
        });
    }

    state.filteredShipStats = result;
    renderActiveTab();
}

const debouncedApplyFilters = debounce(() => {
    state.shipPage = 1;
    state.skinPage = 1;
    applyFilters();
}, 300);

// ===== Tab Switching =====

function switchTab(tab) {
    state.activeTab = tab;

    // Update toggle button active states
    document.querySelectorAll('.tab-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Slide the indicator
    const indicator = document.querySelector('.tab-toggle-indicator');
    if (indicator) {
        indicator.classList.toggle('right', tab === 'skin');
    }

    // Show/hide tab content panels
    const shipTab = document.getElementById('shipTab');
    const skinTab = document.getElementById('skinTab');
    if (shipTab) shipTab.classList.toggle('active', tab === 'ship');
    if (skinTab) skinTab.classList.toggle('active', tab === 'skin');

    applyFilters();
}

// ===== Render Dispatch =====

function renderActiveTab() {
    if (state.activeTab === 'ship') {
        renderShipDashboard();
        renderShipTable();
    } else {
        renderSkinDashboard();
        renderSkinTable();
    }
}

// ===== Event Listeners =====

function setupEventListeners() {
    // Tab toggle buttons
    document.querySelectorAll('.tab-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Search input
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debouncedApplyFilters);
    }

    // Rarity chips — delegated on container
    const rarityChips = document.getElementById('rarityChips');
    if (rarityChips) {
        rarityChips.addEventListener('click', e => {
            const chip = e.target.closest('.rarity-chip');
            if (!chip) return;
            rarityChips.querySelectorAll('.rarity-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            state.shipPage = 1;
            state.skinPage = 1;
            applyFilters();
        });
    }

    // Ship type and nationality dropdowns
    const shipTypeFilter = document.getElementById('shipTypeFilter');
    if (shipTypeFilter) {
        shipTypeFilter.addEventListener('change', () => {
            state.shipPage = 1;
            state.skinPage = 1;
            applyFilters();
        });
    }

    const nationalityFilter = document.getElementById('nationalityFilter');
    if (nationalityFilter) {
        nationalityFilter.addEventListener('change', () => {
            state.shipPage = 1;
            state.skinPage = 1;
            applyFilters();
        });
    }

    // Expand columns button
    const shipExpandCols = document.getElementById('shipExpandCols');
    if (shipExpandCols) {
        shipExpandCols.addEventListener('click', () => {
            state.shipExpanded = !state.shipExpanded;
            shipExpandCols.classList.toggle('active', state.shipExpanded);
            renderShipTable();
        });
    }

    // Top stat selector
    const topStatSelector = document.getElementById('topStatSelector');
    if (topStatSelector) {
        topStatSelector.addEventListener('change', () => renderTopStatChart());
    }

    // Compare checkboxes — delegated on table bodies
    _setupCompareCheckboxes('shipTableBody');
    _setupCompareCheckboxes('skinTableBody');

    // Compare action buttons
    const compareBtn = document.getElementById('compareBtn');
    if (compareBtn) {
        compareBtn.addEventListener('click', () => openCompareModal());
    }

    const compareClearBtn = document.getElementById('compareClearBtn');
    if (compareClearBtn) {
        compareClearBtn.addEventListener('click', () => {
            state.compareList = [];
            updateCompareBar();
            // Uncheck all visible compare checkboxes
            document.querySelectorAll('.compare-check').forEach(cb => {
                cb.checked = false;
            });
        });
    }

    // Theme change detection via MutationObserver
    const observer = new MutationObserver(mutations => {
        const relevant = mutations.some(m =>
            m.type === 'attributes' &&
            m.attributeName === 'class' &&
            (m.oldValue || '').includes('dark-mode') !== document.body.classList.contains('dark-mode')
        );
        if (relevant) {
            destroyAllCharts();
            renderActiveTab();
        }
    });
    observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
        attributeOldValue: true,
    });
}

/**
 * Attach a delegated compare-check listener on a table body.
 * Max 3 entries allowed; shows a toast if at limit.
 * @param {string} tbodyId
 */
function _setupCompareCheckboxes(tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    tbody.addEventListener('change', e => {
        const cb = e.target.closest('.compare-check');
        if (!cb) return;

        const shipId = cb.dataset.ship;
        if (!shipId) return;

        if (cb.checked) {
            if (state.compareList.length >= 3) {
                cb.checked = false;
                showToast('최대 3개까지 비교할 수 있습니다.', 'info');
                return;
            }
            if (!state.compareList.includes(shipId)) {
                state.compareList.push(shipId);
            }
        } else {
            state.compareList = state.compareList.filter(id => id !== shipId);
        }

        updateCompareBar();
    });
}

// ===== Internal Helpers =====

/**
 * Get the Korean display label for a stat key from attrTypeData.
 * Falls back to the raw stat key if not found.
 * @param {string} stat
 * @returns {string}
 */
function _getAttrLabel(stat) {
    if (!state.attrTypeData) return stat;
    const lower = stat.toLowerCase();
    const entry = Object.values(state.attrTypeData).find(
        a => a.name === lower || a.name2 === lower
    );
    return entry ? entry.condition : stat;
}

// ===== Bootstrap =====

init();
