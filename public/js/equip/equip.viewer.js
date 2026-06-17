/**
 * equip.viewer.js
 * Main entry point for the equipment viewer: state management, URL routing,
 * filters/search, detail panel, and compare mode orchestration.
 * Part of the equip module group (viewer + data + detail + compare).
 * Shares state with submodules via a ref object passed to each setup() function.
 */

import {
    createSearchIndex, ensureFuse, debounce, getUrlParam, setUrlParams,
    resolveUrl, showToast, closeModal, lockBodyScroll, unlockBodyScroll,
    showElement, hideElement, renderStatus
} from '../utils.js';
import {
    setup as setupData,
    loadLiteData, loadFullData, loadStatisticsData, loadEquipTypeData,
    loadNationalityData, loadShipTypeData, loadEquipCodeData,
    loadWeaponPropertyData, loadBulletTemplateData, loadSkillData, loadWeaponNameData, loadAircraftTemplateData,
    loadBarrageTemplateData,
    loadUpgradeTemplateData, isInUpgradeTree,
    getEquipIconUrl, getRarityBgUrl, getSPWeaponIconUrl, getUniqueTypes, getUniqueNationalities, getUniqueLabels,
    getFullEquipData, getSkillData, loadSPWeaponData, normalizeSPWeapons, getSPWeaponRawData,
    enrichEquipDataWithReload, SP_RARITY_NAMES,
    loadHearingData, getHearingEntry
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
    viewMode: 'grid',   // 'grid' | 'hearing'
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
setupHearingView(state, { onCardClick, sortEquips: sortEquipsInGroup });

// ===== Initialization =====

/**
 * Bootstrap the viewer: load blocking data (lite + mappings + SP weapons),
 * kick off background loads (full data, weapon/bullet/skill refs), then
 * wire up filters, event listeners, compare modal, and URL routing.
 */
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
            loadSPWeaponData(),
            loadHearingData(),
        ]);

        // SP weapons use a different data source but appear as regular cards in the grid
        const spWeapons = normalizeSPWeapons();
        if (spWeapons.length > 0) {
            state.equipData.push(...spWeapons);
            state.filteredData = [...state.equipData];
        }

        // Non-blocking: detail/compare views need these but the list renders without them
        state.fullEquipDataPromise = loadFullData();
        loadStatisticsData();
        const wpPromise = loadWeaponPropertyData();
        loadBulletTemplateData();
        loadBarrageTemplateData();
        loadSkillData();
        loadWeaponNameData();
        loadAircraftTemplateData();
        loadUpgradeTemplateData();

        // Enrich lite entries with reload time once both full data and weapon_property are ready
        Promise.all([state.fullEquipDataPromise, wpPromise]).then(() => {
            enrichEquipDataWithReload();
            renderCurrentView();
        });

        loading.style.display = 'none';

        // Fold 별명 + 한줄평 into the search index so nicknames AND comment text match
        for (const e of state.equipData) {
            const h = getHearingEntry(e.id);
            e._alias = h?.alias || '';
            e._reviews = (h?.reviews || []).join(' ');
        }

        state.viewMode = resolveInitialViewMode();
        updateViewToggleUI();

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

    } catch (error) {
        loading.style.display = 'none';
        showToast(error.message || '초기화 오류', 'error');
        console.error('Initialization error:', error);
    }
}

// ===== Populate Filters =====

/**
 * Build the type/nationality dropdowns and label chip buttons
 * from the loaded mapping data, then refresh filter stats.
 */
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

/**
 * Resolve the initial mode: ?view= URL param → 'hearing' (default).
 * View choice is intentionally NOT persisted (no localStorage) — each fresh
 * window opens on the 청문회 default unless an explicit ?view= says otherwise.
 */
function resolveInitialViewMode() {
    const urlView = getUrlParam('view');
    if (urlView === 'hearing' || urlView === 'grid') return urlView;
    return 'hearing';
}

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
            if (e._reloadTime != null) withReload.push(e);
            else withoutReload.push(e);
        }
        withReload.sort((a, b) => mult * (a._reloadTime - b._reloadTime));
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
                <h2>${typeName}</h2>
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
            if (equip._isSPWeapon) card.dataset.spWeapon = '1';
            if (equip.compare_group != null) {
                card.dataset.compareGroup = equip.compare_group;
            }

            const hasHearing = !!getHearingEntry(equip.id);
            const iconUrl = equip._isSPWeapon ? getSPWeaponIconUrl(equip.icon) : getEquipIconUrl(equip.icon);
            const bgUrl = getRarityBgUrl(equip.rarity);

            let statsHtml = (equip.max_attrs || []).map(attr =>
                `<span class="equip-stat-item">
                    <span class="equip-stat-name">${attr.name}</span>
                    <span class="equip-stat-value">${attr.value}</span>
                </span>`
            ).join('');
            if (equip._reloadTime != null) {
                statsHtml += `<span class="equip-stat-item equip-stat-reload">
                    <span class="equip-stat-name">사속</span>
                    <span class="equip-stat-value">${equip._reloadTime}s</span>
                </span>`;
            }

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
                        ${equip.level_count > 1 ? `<span class="badge badge--neutral">+${equip.level_count - 1}</span>` : ''}
                    </div>
                    ${statsHtml ? `<div class="equip-card-stats">${statsHtml}</div>` : ''}
                </div>
                ${hasHearing ? '<span class="equip-hearing-dot material-symbols-outlined" title="한줄평 있음">chat_bubble</span>' : ''}
            `;

            card.addEventListener('click', () => {
                if (equip._isSPWeapon) {
                    openSPWeaponDetail(equip._spId);
                } else {
                    onCardClick(equip.id);
                }
            });
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

/** Route card clicks: in compare mode selects the second item, otherwise opens detail. */
function onCardClick(equipId) {
    if (state.compareMode) {
        selectCompareSecondItem(equipId);
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

/**
 * Open the detail panel for an SP (special) weapon.
 * Renders entirely in this function since SP weapons have a different
 * data shape (attr pairs, level progression, skill upgrades) than
 * standard equipment handled by equip.detail.js.
 */
function openSPWeaponDetail(spId) {
    const spWeapon = getSPWeaponRawData(spId);
    if (!spWeapon) return;

    const panelContent = document.getElementById('detailPanelContent');
    if (!panelContent) return;

    const SP_ATTR_NAMES = {
        cannon: '포격', torpedo: '뇌장', antiaircraft: '대공', air: '항공',
        reload: '장전', hit: '명중', dodge: '기동', durability: '내구',
        speed: '속력', luck: '행운', antisub: '대잠',
    };

    const iconUrl = getSPWeaponIconUrl(spWeapon.icon);
    const maxLvl = spWeapon.levels ? spWeapon.levels[spWeapon.levels.length - 1] : null;
    const attr1Name = SP_ATTR_NAMES[spWeapon.attr_1] || spWeapon.attr_1;
    const attr2Name = SP_ATTR_NAMES[spWeapon.attr_2] || spWeapon.attr_2;
    const rarityName = SP_RARITY_NAMES[spWeapon.rarity] || '';
    const uniqueLabel = spWeapon.unique ? '전용' : '범용';

    let levelsHTML = '';
    if (spWeapon.levels && spWeapon.levels.length > 1) {
        const rows = spWeapon.levels.map((lvl, i) =>
            `<tr><td>+${i}</td><td>${lvl.v1}</td><td>${lvl.v2}</td></tr>`
        ).join('');
        levelsHTML = `
            <div class="stats-section">
                <div class="stats-section-title section-title section-title--sm">
                    <span class="material-symbols-outlined">upgrade</span>
                    강화 단계
                </div>
                <table class="stats-table">
                    <thead><tr><th>단계</th><th>${attr1Name}</th><th>${attr2Name}</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }

    // Only unique (전용) SP weapons have skill upgrades
    let skillHTML = '';
    if (spWeapon.skill_upgrade && spWeapon.skill_upgrade.length > 0) {
        const skillRows = [];
        for (const [origId, upgId] of spWeapon.skill_upgrade) {
            if (origId && origId !== 0) {
                const origSkill = getSkillData(origId);
                const upgSkill = getSkillData(upgId);
                if (origSkill || upgSkill) {
                    skillRows.push(`<tr><th>${origSkill?.name || `스킬 ${origId}`}</th><td>→ ${upgSkill?.name || `스킬 ${upgId}`}</td></tr>`);
                }
            } else if (upgId) {
                const skill = getSkillData(upgId);
                if (skill) {
                    const desc = skill.desc ? `<div class="sp-skill-desc">${skill.desc}</div>` : '';
                    skillRows.push(`<tr><th>${skill.name}</th><td>추가 스킬${desc ? '' : ''}</td></tr>`);
                    if (desc) skillRows.push(`<tr><td colspan="2" style="font-size:0.8rem;color:var(--text-secondary);padding:4px 8px;">${skill.desc}</td></tr>`);
                }
            }
        }
        if (skillRows.length > 0) {
            skillHTML = `
                <div class="stats-section">
                    <div class="stats-section-title section-title section-title--sm">
                        <span class="material-symbols-outlined">auto_awesome</span>
                        스킬
                    </div>
                    <table class="stats-table"><tbody>${skillRows.join('')}</tbody></table>
                </div>`;
        }
    }

    const detailBgUrl = getRarityBgUrl(SP_RARITY_TO_EQUIP_CLASS[spWeapon.rarity] || 3);

    let html = `
        <div class="panel-detail-top">
            <div class="panel-detail-icon-wrapper">
                <canvas id="detailIconCanvas" width="256" height="256" style="display:none"></canvas>
                <img class="equip-icon-bg-img" src="${detailBgUrl}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:8px;">
                ${iconUrl ? `<img src="${iconUrl}" alt="${spWeapon.name}" style="position:absolute;top:8%;left:8%;width:84%;height:84%;object-fit:contain;">` : ''}
            </div>
            <div class="panel-detail-name">${spWeapon.name}</div>
            <div class="panel-detail-meta">
                <span class="badge badge--neutral">특수 장비</span>
                <span class="equip-rarity-badge rarity-${SP_RARITY_TO_EQUIP_CLASS[spWeapon.rarity] || ''}">${rarityName}</span>
                <span class="badge badge--neutral">${uniqueLabel}</span>
            </div>
        </div>
        <div class="stats-section">
            <div class="stats-section-title section-title section-title--sm">
                <span class="material-symbols-outlined">bar_chart</span>
                스탯 (최대 강화)
            </div>
            <table class="stats-table">
                <tbody>
                    <tr><th>${attr1Name}</th><td>${maxLvl ? maxLvl.v1 : '-'}</td></tr>
                    <tr><th>${attr2Name}</th><td>${maxLvl ? maxLvl.v2 : '-'}</td></tr>
                </tbody>
            </table>
        </div>
        ${skillHTML}
        ${levelsHTML}
    `;

    panelContent.innerHTML = html;

    // SP weapons don't participate in the upgrade tree system
    const researchLink = document.getElementById('detailResearchLink');
    if (researchLink) researchLink.style.display = 'none';

    detailPanel.classList.add('open');
    detailBackdrop.classList.add('visible');
    lockBodyScroll();
}

/** SP rarity (2=R, 3=SR, 4=SSR) mapped to equip CSS rarity class (3, 4, 5) */
const SP_RARITY_TO_EQUIP_CLASS = { 2: 3, 3: 4, 4: 5 };

function closeDetailPanel() {
    detailPanel.classList.remove('open');
    detailBackdrop.classList.remove('visible');
    unlockBodyScroll();
    setUrlParams({ equip: null }, { replace: true });
}

// ===== Compare Mode =====

// Mode lifecycle — enter/exit toggle the floating bar and card overlays

/**
 * Enter compare mode after the user clicks "Compare" in the detail panel.
 * Closes the panel, shows the floating instruction bar, and dims cards
 * that don't share the same compare_group as the first item.
 */
function enterCompareMode(firstEquip) {
    state.compareMode = true;
    state.compareFirstItem = firstEquip;
    state.compareGroupFilter = firstEquip.compare_group;

    closeDetailPanel();

    // Compare picks the second card from the icon grid; ensure we're in 그리드.
    if (state.viewMode !== 'grid') {
        state.viewMode = 'grid';
        updateViewToggleUI();
        setUrlParams({ view: 'grid' }, { replace: true });
        renderEquipGrid();
        updateFilterStats();
    }

    compareModeText.textContent = `"${firstEquip.name}" 과(와) 비교할 장비를 선택하세요`;
    compareModeBar.style.display = 'flex';

    applyCompareModeOverlay();
}

function exitCompareMode() {
    state.compareMode = false;
    state.compareFirstItem = null;
    state.compareGroupFilter = null;
    compareModeBar.style.display = 'none';
    removeCompareModeOverlay();
}

// Overlay helpers — mark cards as selected, eligible, or ineligible for comparison

/**
 * Apply visual classes to all cards: highlight the first-selected card,
 * dim cards outside its compare_group so only valid targets stand out.
 */
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

/**
 * Complete the comparison by loading the second item's full data,
 * validating it belongs to the same compare_group, then opening
 * the side-by-side compare modal.
 */
async function selectCompareSecondItem(equipId) {
    const secondEquip = await getFullEquipData(parseInt(equipId));
    if (!secondEquip) {
        showToast('장비 데이터를 찾을 수 없습니다.', 'error');
        return;
    }

    if (secondEquip.compare_group !== state.compareFirstItem.compare_group) {
        showToast('같은 종류의 장비만 비교할 수 있습니다.', 'error');
        return;
    }

    if (secondEquip.id === state.compareFirstItem.id) {
        showToast('같은 장비끼리는 비교할 수 없습니다.', 'info');
        return;
    }

    const firstEquip = state.compareFirstItem;

    exitCompareMode();
    setUrlParams({ compare: `${firstEquip.id},${secondEquip.id}`, equip: null }, { replace: true });
    renderCompareModal(firstEquip, secondEquip);
}

// ===== Routing =====

/**
 * Read URL params and open the appropriate view: compare modal (?compare=),
 * detail panel (?equip=), or just the list. Also handles popstate for
 * browser back/forward navigation.
 */
function handleRoute() {
    const viewParam = getUrlParam('view');
    if (viewParam === 'hearing' || viewParam === 'grid') {
        state.viewMode = viewParam;
        updateViewToggleUI();
    }

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
