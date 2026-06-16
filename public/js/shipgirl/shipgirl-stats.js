'use strict';

/**
 * shipgirl-stats.js
 * Main entry for the shipgirl stats page. Bootstraps sub-modules, loads data,
 * manages tab switching (ship info / skin info), shared filters (search, rarity,
 * ship type, nationality), threshold filters, and compare mode event wiring.
 */

import { debounce, hideElement, showToast, setupScrollToTop, toggleElement, onThemeChange, renderStatus } from '../utils.js';
import { setup as setupData, loadAllData, PRIMARY_STATS, getSkinTypeList, classifyGimmick, recomputeSkinStats } from './shipgirl-stats.data.js';
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
    // Filter state
    rarityFilter: new Set(),
    gimmickFilter: new Set(),
    skinTypeFilter: '',
    skinFilterPredicate: null,
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
        hideElement(document.getElementById('loading'));
        showPageStatus('데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
    }

    hideElement(document.getElementById('loading'));

    populateFilterDropdowns();
    setupEventListeners();
    setupThresholdFilters();
    applyFilters();
    setupScrollToTop('scroll-to-top');
}

function showPageStatus(message) {
    const status = document.getElementById('statsPageStatus');
    if (!status) return;
    status.hidden = false;
    renderStatus(status, message, 'error');
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

        shipTypeSelect.replaceChildren(createOption('', '모든 함종'));
        for (const entry of typeEntries) {
            shipTypeSelect.appendChild(createOption(entry.id, entry.name));
        }
    }

    // Nationality filter
    const nationalitySelect = document.getElementById('nationalityFilter');
    if (nationalitySelect) {
        const natEntries = Object.entries(state.nationalityData)
            .map(([id, entry]) => ({ id, name: entry.name || '' }))
            .filter(e => e.name)
            .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

        nationalitySelect.replaceChildren(createOption('', '모든 진영'));
        for (const entry of natEntries) {
            nationalitySelect.appendChild(createOption(entry.id, entry.name));
        }
    }

    // Skin type filter
    const skinTypeSelect = document.getElementById('skinTypeFilter');
    if (skinTypeSelect) {
        skinTypeSelect.replaceChildren(createOption('', '모든 스킨 타입'));
        for (const type of getSkinTypeList()) {
            skinTypeSelect.appendChild(createOption(type, type));
        }
    }
}

function createOption(value, label) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = label;
    return option;
}

// ===== Threshold Filters =====

function setupThresholdFilters() {
    // --- Ship stat thresholds ---
    const shipControls = document.getElementById('shipThresholdControls');
    if (shipControls) {
        const fragment = document.createDocumentFragment();
        for (const stat of PRIMARY_STATS) {
            const label = _getAttrLabel(stat);
            fragment.appendChild(createThresholdInput(label, 'stat', stat));
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
            if (!section) return;
            const isOpen = section.classList.toggle('open');
            shipToggle.setAttribute('aria-expanded', String(isOpen));
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
            fragment.appendChild(createThresholdInput(def.label, 'skinStat', def.key));
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
            if (!section) return;
            const isOpen = section.classList.toggle('open');
            skinToggle.setAttribute('aria-expanded', String(isOpen));
        });
    }
}

function createThresholdInput(labelText, dataKey, dataValue) {
    const group = document.createElement('div');
    group.className = 'threshold-group';

    const inputId = `threshold-${dataKey}-${String(dataValue).replace(/[^a-z0-9_-]/gi, '-')}`;

    const label = document.createElement('label');
    label.className = 'threshold-label';
    label.htmlFor = inputId;
    label.textContent = labelText;

    const input = document.createElement('input');
    input.id = inputId;
    input.type = 'number';
    input.className = 'threshold-input';
    input.min = '0';
    input.placeholder = '최솟값';
    input.dataset[dataKey] = dataValue;

    group.appendChild(label);
    group.appendChild(input);
    return group;
}

// ===== Filtering =====

function applyFilters() {
    const searchEl = document.getElementById('searchInput');
    const search = searchEl ? searchEl.value.toLowerCase().trim() : '';

    const shipTypeEl = document.getElementById('shipTypeFilter');
    const shipType = shipTypeEl ? shipTypeEl.value : '';

    const nationalityEl = document.getElementById('nationalityFilter');
    const nationality = nationalityEl ? nationalityEl.value : '';

    // Skin re-aggregation: on the skin tab, rebuild each entry.skin over only
    // the skins matching the gimmick/skin-type filters; on the ship tab, restore
    // the full aggregate so the compare modal stays consistent.
    if (state.activeTab === 'skin') {
        state.skinFilterPredicate = buildSkinPredicate();
    } else {
        state.skinFilterPredicate = null;
    }
    recomputeSkinStats(state.skinFilterPredicate);

    let result = state.shipStats || [];

    // 1. Search
    if (search) {
        result = result.filter(entry => {
            const name = entry.ship && entry.ship.name ? entry.ship.name.toLowerCase() : '';
            return name.includes(search);
        });
    }

    // 2. Rarity (multi-select; empty Set = all rarities)
    if (state.rarityFilter.size > 0) {
        result = result.filter(entry => entry.ship && state.rarityFilter.has(entry.ship.rarity));
    }

    // 3. Ship type
    if (shipType) {
        result = result.filter(entry => entry.ship && String(entry.ship.type) === shipType);
    }

    // 4. Nationality
    if (nationality) {
        result = result.filter(entry => entry.ship && String(entry.ship.nationality) === nationality);
    }

    // 4b. Skin filter — drop shipgirls with no matching skins
    if (state.activeTab === 'skin' && state.skinFilterPredicate) {
        result = result.filter(entry => entry.skin && entry.skin.total > 0);
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
        btn.setAttribute('aria-pressed', String(btn.dataset.tab === tab));
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

    // Skin-only filters are visible on the skin tab only
    document.querySelectorAll('.skin-only-filter').forEach(el => {
        toggleElement(el, tab === 'skin');
    });

    // Summary strip swaps with the active tab
    toggleElement('shipSummaryContent', tab === 'ship');
    toggleElement('skinSummaryContent', tab === 'skin');

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

    // Rarity chips — multi-select chip group
    setupChipGroup('rarityChips', 'rarity', state.rarityFilter, () => {
        state.shipPage = 1;
        state.skinPage = 1;
        applyFilters();
    });

    // Gimmick chips — multi-select chip group (skin tab)
    setupChipGroup('gimmickChips', 'gimmick', state.gimmickFilter, () => {
        state.skinPage = 1;
        applyFilters();
    });

    // Skin type dropdown (skin tab)
    const skinTypeFilter = document.getElementById('skinTypeFilter');
    if (skinTypeFilter) {
        skinTypeFilter.addEventListener('change', () => {
            state.skinTypeFilter = skinTypeFilter.value;
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
            shipExpandCols.setAttribute('aria-pressed', String(state.shipExpanded));
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

    // Chart.js bakes colors in at creation — rebuild the active tab on theme flip
    onThemeChange(() => {
        destroyAllCharts();
        renderActiveTab();
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
 * Wire a multi-select chip group that has one "전체" (all) chip + N category chips.
 *
 * Rules:
 *  - empty selectedSet  → All mode: "전체" is .active, no category chip active.
 *  - 1+ (but not all) category chips → subset mode: "전체" loses .active (still clickable).
 *  - clicking "전체" clears the set (→ All mode).
 *  - clicking a category chip toggles it; if that selects every category, the set
 *    is cleared (collapse to All mode); if it empties the set, that is All mode too.
 *
 * @param {string} containerId  - id of the chip container
 * @param {string} attr         - dataset attribute holding each chip's value ('rarity' | 'gimmick')
 * @param {Set<string>} selectedSet - state Set the group reads/writes
 * @param {Function} onChange   - called after every selection change
 */
function setupChipGroup(containerId, attr, selectedSet, onChange) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const chips = [...container.querySelectorAll('.rarity-chip')];
    const allChip = chips.find(c => !c.dataset[attr]);
    const catChips = chips.filter(c => c.dataset[attr]);

    function render() {
        const allMode = selectedSet.size === 0;
        if (allChip) {
            allChip.classList.toggle('active', allMode);
            allChip.setAttribute('aria-pressed', String(allMode));
        }
        for (const chip of catChips) {
            const on = selectedSet.has(chip.dataset[attr]);
            chip.classList.toggle('active', on);
            chip.setAttribute('aria-pressed', String(on));
        }
    }

    container.addEventListener('click', (e) => {
        const chip = e.target.closest('.rarity-chip');
        if (!chip || !container.contains(chip)) return;

        const value = chip.dataset[attr];
        if (!value) {
            selectedSet.clear();
        } else {
            if (selectedSet.has(value)) selectedSet.delete(value);
            else selectedSet.add(value);
            if (selectedSet.size === catChips.length) selectedSet.clear();
        }
        render();
        onChange();
    });

    render();
}

/**
 * Build a skin predicate from the current gimmick/skin-type filter state.
 * Returns null when no skin filter is active.
 * @returns {?Function} predicate(skin) → boolean
 */
function buildSkinPredicate() {
    const gimmicks = state.gimmickFilter;
    const skinType = state.skinTypeFilter;
    if (gimmicks.size === 0 && !skinType) return null;

    return (skin) => {
        if (skinType && skin['스킨 타입 - 한글'] !== skinType) return false;
        if (gimmicks.size > 0) {
            const labels = classifyGimmick(skin);
            let hit = false;
            for (const label of labels) {
                if (gimmicks.has(label)) { hit = true; break; }
            }
            if (!hit) return false;
        }
        return true;
    };
}

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
