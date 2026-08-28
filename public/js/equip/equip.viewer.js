/**
 * equip.viewer.js
 * Main entry point for the equipment viewer: state management, URL routing,
 * filters/search, detail panel, and compare mode orchestration.
 * Part of the equip module group (viewer + data + detail + compare).
 * Shares state with submodules via a ref object passed to each setup() function.
 */

import {
    createSearchIndex, ensureFuse, debounce, getUrlParam, setUrlParams,
    resolveUrl, showToast, closeModal, lockBodyScroll, unlockBodyScroll, loadPageData,
    showElement, hideElement, renderStatus, escapeHtml
} from '../utils.js';
import {
    setup as setupData,
    loadLiteData, isInUpgradeTree,
    getEquipIconUrl, getRarityBgUrl, getSPWeaponIconUrl, getUniqueTypes, getUniqueNationalities, getUniqueLabels,
    getFullEquipData, loadSPWeaponData, normalizeSPWeapons,
    ensureCompareData,
    loadHearingData, getHearingEntry
} from './equip.data.js';
import {
    setup as setupDetail,
    showDetailView, showSPWeaponDetail,
    downloadEquipIcon
} from './equip.detail.js';
import {
    setup as setupCompare,
    setupCompareModal,
    renderCompareModal,
    loadCompareFromUrl
} from './equip.compare.js';
import {
    setup as setupHearingView,
    renderHearingGrid
} from './equip.hearing-view.js';

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
    // Commentary (장비 청문회)
    hearing: {},
    // ?view= overrides this in handleRoute. The choice is intentionally NOT persisted
    // (no localStorage) — a fresh window opens on the 청문회 default unless the URL says so.
    viewMode: 'hearing',
    filteredData: [],
    currentEquip: null,
    currentLevel: 0,

    // Filter state
    activeLabels: new Set(),
    activeRarities: new Set(),

    // Compare state (multi-select)
    compareMode: false,         // select mode active
    compareGroupFilter: null,   // compare_group locked by the first selected card
    compareSelection: [],       // selected equip IDs in click order (→ row order)
    compareItems: [],           // [{ equip (full), level }] resolved for the open modal
    compareColumns: [],         // frozen stat-column defs for the open modal (equip.compare.js)

    // Search
    searchIndex: null,

    // Sort
    sortStat: '',
    sortDirection: 'desc',

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
const labelFilterToggle = document.getElementById('labelFilterToggle');
const labelFilterCount = document.getElementById('labelFilterCount');
const sortStat = document.getElementById('sortStat');
const sortDirection = document.getElementById('sortDirection');
const loading = document.getElementById('loading');
const totalCount = document.getElementById('totalCount');
const filteredCount = document.getElementById('filteredCount');
const viewToggle = document.getElementById('viewToggle');
const hearingNote = document.getElementById('hearingNote');

// Credits popover (출처 · 특별 감사) — hover is CSS-only; these drive tap/keyboard
const creditsInfo = document.getElementById('creditsInfo');
const creditsTrigger = document.getElementById('creditsTrigger');
const creditsBubble = document.getElementById('creditsBubble');

// Panel elements
const detailPanel = document.getElementById('detailPanel');
const detailBackdrop = document.getElementById('detailBackdrop');
const detailPanelContent = document.getElementById('detailPanelContent');
const detailPanelClose = document.getElementById('detailPanelClose');
const detailDownloadBtn = document.getElementById('detailDownloadBtn');

// Compare mode elements
const compareToggleBtn = document.getElementById('compareToggleBtn');
const compareModeBar = document.getElementById('compareModeBar');
const compareModeText = document.getElementById('compareModeText');
const compareModeGo = document.getElementById('compareModeGo');
const compareModeCancel = document.getElementById('compareModeCancel');

state.elements = { equipGrid };

// Initialize sub-modules
setupData(state);
setupDetail(state);
setupCompare(state);
setupHearingView(state, { sortEquips: sortEquipsInGroup });

// ===== Initialization =====

/**
 * Bootstrap the viewer: load list/hearing data, then wire filters, listeners,
 * compare modal, and URL routing. Detail/compare-only datasets are lazy-loaded.
 */
async function init() {
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }

    const loaded = await loadPageData(
        () => Promise.all([loadLiteData(), loadSPWeaponData(), loadHearingData()]),
        loading,
        { contextLabel: 'Equip viewer' },
    );
    if (!loaded) return;

    // SP weapons use a different data source but appear as regular cards in the grid
    const spWeapons = normalizeSPWeapons();
    if (spWeapons.length > 0) {
        state.equipData.push(...spWeapons);
        state.filteredData = [...state.equipData];
    }

    // Fold 별명 + 한줄평 into the search index so nicknames AND comment text match
    for (const e of state.equipData) {
        const h = getHearingEntry(e.id);
        e._alias = h?.alias || '';
        e._reviews = (h?.reviews || []).join(' ');
    }

    await ensureFuse();
    state.searchIndex = createSearchIndex(state.equipData, {
        // weighted so name/별명 stay primary; 한줄평 text is a secondary match source
        keys: [
            { name: 'name', weight: 3 },
            { name: '_alias', weight: 2 },
            { name: 'type_name', weight: 1 },
            { name: 'type_name2', weight: 1 },
            { name: 'nation_name', weight: 1 },
            { name: 'nation_code', weight: 1 },
            { name: '_reviews', weight: 0.5 },
        ],
        threshold: 0.3,
    });

    populateFilters();
    setupEventListeners();
    setupCompareModal();
    handleRoute();
    window.addEventListener('popstate', handleRoute);
}

// ===== Populate Filters =====

/**
 * Build the type/nationality dropdowns and label chip buttons
 * from the loaded mapping data, then refresh filter stats.
 */
function populateFilters() {
    const types = getUniqueTypes();
    typeFilter.innerHTML = '<option value="">모든 장비</option>' +
        types.map(t => `<option value="${t.id}">${escapeHtml(t.name2 || t.name)}</option>`).join('');

    const nations = getUniqueNationalities();
    nationalityFilter.innerHTML = '<option value="">모든 진영</option>' +
        nations.map(n => `<option value="${n.id}">${escapeHtml(n.name)}</option>`).join('');

    const labels = getUniqueLabels();
    labelChips.innerHTML = labels.map(l =>
        `<button class="chip" data-label="${escapeHtml(l)}">${escapeHtml(l)}</button>`
    ).join('');

    updateFilterStats();
}

// ===== Event Listeners =====

/**
 * Wire all user interactions: search (debounced), filter dropdowns,
 * rarity/label chip toggles, detail panel open/close, compare mode
 * controls, and ESC key handling.
 */
function setupEventListeners() {
    const debouncedFilter = debounce(filterEquipment, 200);

    searchInput.addEventListener('input', debouncedFilter);
    typeFilter.addEventListener('change', filterEquipment);
    nationalityFilter.addEventListener('change', filterEquipment);
    equipGrid.addEventListener('click', handleEquipGridClick);

    // Rarity chip toggles
    rarityChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip[data-rarity]');
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
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const label = chip.dataset.label;
        if (state.activeLabels.has(label)) {
            state.activeLabels.delete(label);
            chip.classList.remove('active');
        } else {
            state.activeLabels.add(label);
            chip.classList.add('active');
        }
        updateLabelFilterCount();
        filterEquipment();
    });

    // Tag-filter collapse toggle (folds the chip tray; badge keeps active count visible)
    if (labelFilterToggle) {
        labelFilterToggle.addEventListener('click', () => {
            const wrap = labelFilterToggle.closest('.label-filter');
            if (!wrap) return;
            const open = wrap.classList.toggle('open');
            labelFilterToggle.setAttribute('aria-expanded', String(open));
        });
    }

    // Sort controls
    sortStat.addEventListener('change', () => {
        state.sortStat = sortStat.value;
        renderCurrentView();
    });
    sortDirection.addEventListener('click', () => {
        state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
        sortDirection.textContent = state.sortDirection === 'desc' ? '내림차순' : '오름차순';
        if (state.sortStat) renderCurrentView();
    });

    // Detail panel close
    detailPanelClose.addEventListener('click', closeDetailPanel);
    detailBackdrop.addEventListener('click', closeDetailPanel);

    // Detail panel footer buttons
    detailDownloadBtn.addEventListener('click', () => {
        downloadEquipIcon(state.currentEquip);
    });

    // Compare: toolbar toggle enters/exits select-mode; floating-bar buttons open/cancel
    if (compareToggleBtn) compareToggleBtn.addEventListener('click', toggleCompareMode);
    if (compareModeGo) compareModeGo.addEventListener('click', openCompareFromSelection);
    compareModeCancel.addEventListener('click', exitCompareMode);

    // ESC key for panel
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (creditsBubble && creditsBubble.classList.contains('open')) {
                creditsBubble.classList.remove('open');
                creditsTrigger.setAttribute('aria-expanded', 'false');
            } else if (state.compareMode) {
                exitCompareMode();
            } else if (detailPanel.classList.contains('open')) {
                closeDetailPanel();
            }
        }
    });

    // View-mode toggle
    if (viewToggle) {
        viewToggle.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-view]');
            if (!btn) return;
            const mode = btn.dataset.view;
            if (mode !== state.viewMode) setViewMode(mode);
        });
    }

    // Credits popover: tap/click (touch + keyboard Enter/Space) toggles it;
    // desktop hover is handled in CSS. Click-outside closes it.
    if (creditsTrigger && creditsBubble && creditsInfo) {
        creditsTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = creditsBubble.classList.toggle('open');
            creditsTrigger.setAttribute('aria-expanded', String(open));
        });
        document.addEventListener('click', (e) => {
            if (creditsBubble.classList.contains('open') && !creditsInfo.contains(e.target)) {
                creditsBubble.classList.remove('open');
                creditsTrigger.setAttribute('aria-expanded', 'false');
            }
        });
    }
}

function handleEquipGridClick(e) {
    const card = e.target.closest('.equip-card, .hearing-card');
    if (!card || !equipGrid.contains(card)) return;

    if (card.dataset.spWeapon === '1') {
        if (state.compareMode) {
            showToast('특수 장비는 비교할 수 없습니다.', 'info');
        } else {
            openSPWeaponDetail(card.dataset.spId);
        }
        return;
    }

    onCardClick(card.dataset.equipId);
}

// ===== Filtering =====

/**
 * Apply all active filters (search, type, nationality, rarity, labels)
 * to the full equipment list and re-render the grid.
 * Search uses Fuse.js first, then the remaining filters narrow results.
 */
function filterEquipment() {
    const searchTerm = searchInput.value.trim();
    const selectedType = typeFilter.value;
    const selectedNation = nationalityFilter.value;

    let results = state.equipData;

    if (searchTerm) {
        results = searchEquipment(searchTerm);
    }

    state.filteredData = results.filter(equip => {
        const matchType = !selectedType || String(equip.type) === selectedType;
        const matchNation = !selectedNation || String(equip.nationality) === selectedNation;
        const matchRarity = state.activeRarities.size === 0 || state.activeRarities.has(String(equip.rarity));
        const matchLabels = state.activeLabels.size === 0 ||
            (equip.label && [...state.activeLabels].every(l => equip.label.includes(l)));
        return matchType && matchNation && matchRarity && matchLabels;
    });

    renderCurrentView();
    updateFilterStats();
}

/** Search with Fuse when available, otherwise use a simple case-insensitive fallback. */
function searchEquipment(searchTerm) {
    if (state.searchIndex) {
        return state.searchIndex.search(searchTerm).map(r => r.item);
    }

    const needle = searchTerm.toLowerCase();
    return state.equipData.filter(equip => [
        equip.name,
        equip.type_name,
        equip.type_name2,
        equip.nation_name,
        equip.nation_code,
        equip._alias,
        equip._reviews,
    ].some(value => String(value || '').toLowerCase().includes(needle)));
}

// ===== View Mode (그리드 / 청문회) =====

/** Dispatch to the active renderer. */
function renderCurrentView() {
    updateHearingNote();
    if (state.viewMode === 'hearing') renderHearingGrid();
    else renderEquipGrid();
}

/** The 청문회 guidance note is only relevant in 자세히 mode — hide it in 그리드. */
function updateHearingNote() {
    if (!hearingNote) return;
    if (state.viewMode === 'hearing') showElement(hearingNote);
    else hideElement(hearingNote);
}

/** Reflect state.viewMode on the toggle buttons. */
function updateViewToggleUI() {
    if (!viewToggle) return;
    for (const btn of viewToggle.querySelectorAll('[data-view]')) {
        const active = btn.dataset.view === state.viewMode;
        btn.classList.toggle('is-active', active);   // canonical .btn-group active member (button.css)
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    }
}

/** Switch mode from a user toggle: sync URL + re-render. View choice is NOT
 *  persisted across sessions (no localStorage) — only reflected in the URL. */
function setViewMode(mode) {
    if (mode !== 'grid' && mode !== 'hearing') return;
    state.viewMode = mode;
    setUrlParams({ view: mode === 'grid' ? 'grid' : null }, { replace: true });
    updateViewToggleUI();
    renderCurrentView();
    updateFilterStats();
}

// ===== Rendering =====

/**
 * Sort equips within a type group based on the active sort stat.
 * For stat sorts: sorts by matching max_attrs value.
 * For reload sort: equips with reload come first (sorted), rest keep default order.
 */
function sortEquipsInGroup(equips) {
    if (!state.sortStat) return equips;

    const isReload = state.sortStat === '_reload';
    const mult = state.sortDirection === 'desc' ? -1 : 1;

    if (isReload) {
        // Partition: equips with reload first (sorted), rest keep original order
        const withReload = [];
        const withoutReload = [];
        for (const e of equips) {
            if (e.reload_time != null) withReload.push(e);
            else withoutReload.push(e);
        }
        withReload.sort((a, b) => mult * (a.reload_time - b.reload_time));
        return [...withReload, ...withoutReload];
    }

    // Stat sort: partition by whether equip has the stat
    const statKey = state.sortStat;
    const getStatValue = (e) => {
        const attr = (e.max_attrs || []).find(a => a.key === statKey);
        return attr ? Number(attr.value) : null;
    };

    const withStat = [];
    const withoutStat = [];
    for (const e of equips) {
        if (getStatValue(e) != null) withStat.push(e);
        else withoutStat.push(e);
    }
    withStat.sort((a, b) => mult * (getStatValue(a) - getStatValue(b)));
    return [...withStat, ...withoutStat];
}

/**
 * Render the filtered equipment list, grouped by equipment type.
 * Each group gets a section header with count, and cards within
 * are built with icon, rarity badge, stats, and click handlers.
 */
function renderEquipGrid() {
    equipGrid.classList.remove('mode-hearing');
    if (state.filteredData.length === 0) {
        renderStatus(equipGrid, '장비를 찾을 수 없습니다.', 'empty');
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
            <div class="type-section-header section-title">
                <h2>${escapeHtml(typeName)}</h2>
                <span class="type-section-count">(${equips.length})</span>
            </div>
        `;
        fragment.appendChild(section);

        // Sort within group if a sort stat is selected
        const sorted = sortEquipsInGroup(equips);

        const grid = document.createElement('div');
        grid.className = 'type-section-grid';

        for (const equip of sorted) {
            const card = document.createElement('div');
            card.className = `equip-card rarity-${equip.rarity}`;
            card.dataset.equipId = equip.id;
            if (equip._isSPWeapon) {
                card.dataset.spWeapon = '1';
                card.dataset.spId = equip._spId;
            }
            if (equip.compare_group != null) {
                card.dataset.compareGroup = equip.compare_group;
            }

            const hasHearing = !!getHearingEntry(equip.id);
            const iconUrl = equip._isSPWeapon ? getSPWeaponIconUrl(equip.icon) : getEquipIconUrl(equip.icon);
            const bgUrl = getRarityBgUrl(equip.rarity);

            let statsHtml = (equip.max_attrs || []).map(attr =>
                `<span class="equip-stat-item">
                    <span class="equip-stat-name">${escapeHtml(attr.name)}</span>
                    <span class="equip-stat-value">${attr.value}</span>
                </span>`
            ).join('');
            if (equip.reload_time != null) {
                statsHtml += `<span class="equip-stat-item equip-stat-reload">
                    <span class="equip-stat-name">사속</span>
                    <span class="equip-stat-value">${equip.reload_time}s</span>
                </span>`;
            }

            card.innerHTML = `
                <div class="equip-icon-wrapper">
                    <img class="equip-icon-bg-img" src="${escapeHtml(bgUrl)}" alt="" loading="lazy">
                    ${iconUrl ? `<img class="equip-icon-img" src="${escapeHtml(iconUrl)}" alt="${escapeHtml(equip.name)}" loading="lazy">` : ''}
                </div>
                <div class="equip-card-info">
                    <div class="equip-card-name">${escapeHtml(equip.name)}</div>
                    <div class="equip-card-meta">
                        <span class="equip-rarity-badge rarity-${equip.rarity}">${escapeHtml(equip.rarity_name)}</span>
                        ${equip.nation_code ? `<span class="equip-nation-code">${escapeHtml(equip.nation_code)}</span>` : ''}
                        ${equip.level_count > 1 ? `<span class="badge badge--neutral">+${equip.level_count - 1}</span>` : ''}
                    </div>
                    ${statsHtml ? `<div class="equip-card-stats">${statsHtml}</div>` : ''}
                </div>
                ${hasHearing ? '<span class="equip-hearing-dot material-symbols-outlined" title="한줄평 있음">chat_bubble</span>' : ''}
            `;

            grid.appendChild(card);
        }

        fragment.appendChild(grid);
    }

    equipGrid.innerHTML = '';
    equipGrid.appendChild(fragment);

    if (state.compareMode) {
        applyCompareModeOverlay();
    }
}

/** Reflect the active-label count on the (possibly collapsed) tag-filter toggle badge. */
function updateLabelFilterCount() {
    if (!labelFilterCount) return;
    const n = state.activeLabels.size;
    labelFilterCount.textContent = n;
    labelFilterCount.hidden = n === 0;
}

function updateFilterStats() {
    if (totalCount) totalCount.textContent = state.equipData.length;
    if (!filteredCount) return;
    if (state.viewMode === 'hearing') {
        filteredCount.textContent = state.filteredData
            .filter(e => !e._isSPWeapon && getHearingEntry(e.id)).length;
    } else {
        filteredCount.textContent = state.filteredData.length;
    }
}

// ===== Card Click Handler =====

/** Route card clicks: in compare mode toggles selection, otherwise opens detail. */
function onCardClick(equipId) {
    if (state.compareMode) {
        toggleCompareSelection(equipId);
    } else {
        openDetailPanel(equipId);
    }
}

// ===== Detail Panel =====

// Panel openers — one for standard equipment, one for SP weapons (different data shape)

/**
 * Open the detail panel for a standard equipment item.
 * Delegates rendering to equip.detail.js, updates the URL,
 * and conditionally shows the research tree link.
 */
async function openDetailPanel(equipId) {
    const equip = await showDetailView(parseInt(equipId));
    if (!equip) return;

    // Clear any lingering compare param so back-navigation works correctly
    setUrlParams({ equip: equipId, compare: null }, { replace: true });

    const researchLink = document.getElementById('detailResearchLink');
    if (researchLink) {
        if (isInUpgradeTree(parseInt(equipId))) {
            researchLink.href = resolveUrl(`equip/equip-upgrade?equip=${equipId}`);
            researchLink.style.display = '';
        } else {
            researchLink.style.display = 'none';
        }
    }

    detailPanel.classList.add('open');
    detailBackdrop.classList.add('visible');
    lockBodyScroll();
}

/** Open the detail panel for an SP (special) weapon; equip.detail.js renders it. */
async function openSPWeaponDetail(spId) {
    if (!await showSPWeaponDetail(spId)) return;

    detailPanel.classList.add('open');
    detailBackdrop.classList.add('visible');
    lockBodyScroll();
}

function closeDetailPanel() {
    detailPanel.classList.remove('open');
    detailBackdrop.classList.remove('visible');
    unlockBodyScroll();
    setUrlParams({ equip: null }, { replace: true });
}

// ===== Compare Mode (multi-select) =====

// Select-mode lifecycle — the toolbar 비교 toggle enters/exits; the user clicks cards in
// one compare_group to build a set, then the floating bar opens the N-column modal.

/** Toggle select-mode from the toolbar 비교 button. */
function toggleCompareMode() {
    if (state.compareMode) exitCompareMode();
    else enterCompareMode();
}

/**
 * Enter compare select-mode: reset the selection, switch to the icon grid
 * (where cards are picked), show the floating bar, and clear any overlay.
 */
function enterCompareMode() {
    state.compareMode = true;
    state.compareGroupFilter = null;
    state.compareSelection = [];

    closeDetailPanel();

    // Selection happens on the icon grid → ensure 그리드 (setViewMode re-renders + applies overlay).
    if (state.viewMode !== 'grid') setViewMode('grid');
    else applyCompareModeOverlay();

    if (compareToggleBtn) {
        compareToggleBtn.classList.add('is-active');
        compareToggleBtn.setAttribute('aria-pressed', 'true');
    }
    updateCompareBar();
    compareModeBar.style.display = 'flex';
}

function exitCompareMode() {
    state.compareMode = false;
    state.compareGroupFilter = null;
    state.compareSelection = [];
    if (compareToggleBtn) {
        compareToggleBtn.classList.remove('is-active');
        compareToggleBtn.setAttribute('aria-pressed', 'false');
    }
    compareModeBar.style.display = 'none';
    removeCompareModeOverlay();
}

/**
 * Toggle one card into/out of the comparison set. The first pick locks the
 * compare_group; later picks must match it. Deselecting the last card unlocks it.
 */
function toggleCompareSelection(equipId) {
    const id = parseInt(equipId);
    const equip = state.equipData.find(e => e.id === id);
    if (!equip) return;

    if (equip.compare_group == null) {
        showToast('이 장비는 비교할 수 없습니다.', 'info');
        return;
    }

    const idx = state.compareSelection.indexOf(id);
    if (idx !== -1) {
        state.compareSelection.splice(idx, 1);
        if (state.compareSelection.length === 0) state.compareGroupFilter = null;
    } else {
        if (state.compareGroupFilter == null) {
            state.compareGroupFilter = equip.compare_group;
        } else if (equip.compare_group !== state.compareGroupFilter) {
            showToast('같은 종류의 장비만 함께 비교할 수 있습니다.', 'error');
            return;
        }
        state.compareSelection.push(id);
    }

    applyCompareModeOverlay();
    updateCompareBar();
}

/** Update the floating bar's text and enable the 비교하기 button once ≥2 are picked. */
function updateCompareBar() {
    const n = state.compareSelection.length;
    if (compareModeText) {
        compareModeText.textContent = n === 0
            ? '비교할 장비를 선택하세요 (같은 분류끼리)'
            : `${n}개 선택됨`;
    }
    if (compareModeGo) {
        compareModeGo.disabled = n < 2;
        compareModeGo.textContent = n >= 2 ? `비교하기 (${n})` : '비교하기';
    }
}

// Overlay helpers — mark selected cards and dim cards outside the locked compare_group.

function applyCompareModeOverlay() {
    const selected = new Set(state.compareSelection.map(String));
    const cards = equipGrid.querySelectorAll('.equip-card');
    for (const card of cards) {
        const cardGroup = card.dataset.compareGroup;
        const isSelected = selected.has(String(card.dataset.equipId));
        const ineligible = state.compareGroupFilter != null
            && cardGroup !== String(state.compareGroupFilter);
        card.classList.toggle('compare-selected', isSelected);
        card.classList.toggle('compare-ineligible', ineligible && !isSelected);
    }
}

function removeCompareModeOverlay() {
    const cards = equipGrid.querySelectorAll('.equip-card');
    for (const card of cards) {
        card.classList.remove('compare-ineligible', 'compare-selected');
    }
}

/**
 * Open the compare modal from the current selection: fetch full data for each
 * picked equip, exit select-mode, sync the URL, and render the N-column table.
 */
async function openCompareFromSelection() {
    if (state.compareSelection.length < 2) return;
    await ensureCompareData();
    const ids = [...state.compareSelection];
    const equips = await Promise.all(ids.map(id => getFullEquipData(id)));
    const items = equips.filter(Boolean).map(equip => ({ equip })); // level ⇒ max (renderCompareModal default)
    if (items.length < 2) {
        showToast('장비 데이터를 불러오지 못했습니다.', 'error');
        return;
    }

    exitCompareMode();
    setUrlParams({ compare: items.map(it => it.equip.id).join(','), equip: null }, { replace: true });
    renderCompareModal(items);
}

// ===== Routing =====

/**
 * Read URL params and open the appropriate view: compare modal (?compare=),
 * detail panel (?equip=), or just the list. Also handles popstate for
 * browser back/forward navigation.
 */
function handleRoute() {
    const viewParam = getUrlParam('view');
    if (viewParam === 'hearing' || viewParam === 'grid') state.viewMode = viewParam;
    updateViewToggleUI();

    const equipParam = getUrlParam('equip');
    const compareParam = getUrlParam('compare');

    if (compareParam) {
        loadCompareFromUrl(compareParam);
    } else if (equipParam) {
        openDetailPanel(parseInt(equipParam));
    } else {
        closeDetailPanel();
        closeModal('compareModal');
    }

    mainView.style.display = 'block';
    renderCurrentView();
    updateFilterStats();
}

// ===== Start Application =====
init();
