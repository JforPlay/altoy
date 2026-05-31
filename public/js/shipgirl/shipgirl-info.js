/**
 * shipgirl-info.js
 * Main entry point for the shipgirl info page.
 * Owns shared state, wires sub-modules (data, detail, maps), handles filtering/rendering/routing,
 * and sets up keyboard/swipe/touch navigation between ship detail views.
 */

import { createImg, getUrlParam, IMG_FALLBACKS, showToast, resolveUrl, getStorageItem, setStorageItem, setupModal, debounce } from '../utils.js';
import {
    setup as setupData,
    loadData, loadNationalityData, loadAttrTypeData,
    loadShipTypeData, loadEquipTypeData, loadSkillIconData, loadSkillToIconId, loadSkillDataTemplate
} from './shipgirl-info.data.js';
import {
    setup as setupDetail,
    showDetailView
} from './shipgirl-info.detail.js';
import {
    setup as setupMaps,
    showMapsModal,
    setupMapsModalListeners, setupMapBrowserListeners
} from './shipgirl-info.maps.js';
import { setup as setupSkillSearch } from './shipgirl-info.skill-search.js';
import { setup as setupRetrofit } from './shipgirl-info.retrofit.js';

// ===== State =====
const state = {
    /** @type {ShipDataLite[]} */
    shipgirlData: [],
    /** @type {ShipData[]|null} */
    fullShipData: null,
    /** @type {Promise<ShipData[]>|null} */
    fullShipDataPromise: null,
    /** @type {ShipDataLite[]} */
    filteredData: [],
    /** @type {ShipData|null} */
    currentShip: null,
    /** @type {number} */
    currentLevel: 100,
    /** @type {string} */
    currentLimitBreak: '',
    /** @type {string} */
    currentFavorability: 'love',
    /** @type {string} */
    currentEnhancement: 'complete',
    /** @type {Object<string, string>} */
    nationalityData: {},
    /** @type {Object<string, string>} */
    attrTypeData: {},
    /** @type {Object<string, string>} */
    shipTypeData: {},
    /** @type {Object<string, string>} */
    skillIconData: {},
    /** @type {Object<string, number>} */
    skillToIconId: {},
    /** @type {Object} */
    skillDataTemplate: {},
    /** @type {string} */
    viewMode: 'grid',

    // Construction-specific filters
    currentConstructionType: 'all',

    // Retrofit filter: 'all' (default) or 'yes' (only retrofittable). Backed by
    // retrofitGidSet, which is populated from fullShipData once it finishes its
    // background load.
    currentRetrofitFilter: 'all',
    /** @type {Set<number>|null} */
    retrofitGidSet: null,

    // DOM Elements (set during init)
    elements: {},

    // Callbacks for sub-modules
    showMainView: null,
    navigateToDetail: null
};

// ===== DOM Elements =====
const mainView = document.getElementById('mainView');
const detailView = document.getElementById('detailView');
const shipgirls = document.getElementById('shipgirls');
const searchInput = document.getElementById('searchInput');
const rarityFilter = document.getElementById('rarityFilter');
const backButton = document.getElementById('backButton');
const loading = document.getElementById('loading');

// Store DOM elements in state for sub-modules
state.elements = { mainView, detailView, shipgirls, searchInput, rarityFilter, backButton, loading };

// Initialize sub-modules with shared state reference
setupData(state);
setupDetail(state);
setupMaps(state);
setupSkillSearch(state);
setupRetrofit(state);

// ===== Initialization =====

/**
 * Bootstrap the page: load all data in parallel, populate filters, handle initial URL route,
 * and set up all event listeners including popstate for browser navigation.
 */
async function init() {
    try {
        loading.style.display = 'block';

        // Prevent browser from restoring scroll position
        if ('scrollRestoration' in history) {
            history.scrollRestoration = 'manual';
        }

        await Promise.all([
            loadData(),
            loadNationalityData(),
            loadAttrTypeData(),
            loadShipTypeData(),
            loadEquipTypeData()
        ]);
        loading.style.display = 'none';

        // Populate filter options BEFORE setting up event listeners
        populateFilterOptions();

        // Initialize stats counter
        updateFilterStats();

        handleRoute();
        setupEventListeners();
        window.addEventListener('popstate', handleRoute);

        // Warm skill assets after first render. Detail/skill search also await these
        // explicitly, so this improves repeat interactions without delaying the grid.
        const loadSkillAssets = () => Promise.all([loadSkillIconData(), loadSkillToIconId(), loadSkillDataTemplate()]);
        if ('requestIdleCallback' in window) {
            requestIdleCallback(loadSkillAssets, { timeout: 3000 });
        } else {
            setTimeout(loadSkillAssets, 0);
        }
    } catch (error) {
        loading.style.display = 'none';
        showToast(error.message || 'Initialization error', 'error');
        console.error('Initialization error:', error);
    }
}

// ===== Event Listeners =====
function setupEventListeners() {
    searchInput.addEventListener('input', debounce(filterShipgirls, 120));
    rarityFilter.addEventListener('change', filterShipgirls);
    document.getElementById('shipTypeFilter').addEventListener('change', filterShipgirls);
    document.getElementById('nationalityFilter').addEventListener('change', filterShipgirls);

    // Construction filter
    const constructionFilter = document.getElementById('constructionFilter');
    if (constructionFilter) {
        constructionFilter.addEventListener('change', (e) => {
            state.currentConstructionType = e.target.value;
            filterShipgirls();
        });
    }

    // Retrofit filter — boolean toggle. Depends on fullShipData (lazy-loaded);
    // if pressed before that arrives, briefly disable the button until
    // retrofitGidSet is built so the filter actually has data to work with.
    const retrofitFilter = document.getElementById('retrofitFilter');
    if (retrofitFilter) {
        retrofitFilter.addEventListener('click', async () => {
            const next = retrofitFilter.getAttribute('aria-pressed') !== 'true';
            retrofitFilter.setAttribute('aria-pressed', String(next));
            state.currentRetrofitFilter = next ? 'yes' : 'all';
            if (next && !state.retrofitGidSet && state.fullShipDataPromise) {
                retrofitFilter.disabled = true;
                try { await state.fullShipDataPromise; } finally { retrofitFilter.disabled = false; }
            }
            filterShipgirls();
        });
    }

    shipgirls.addEventListener('click', (e) => {
        const card = e.target.closest('.shipgirl-card');
        if (!card || !shipgirls.contains(card)) return;
        const shipName = card.dataset.shipName;
        if (shipName) navigateToDetail(shipName);
    });

    // Info popup is handled globally by global.script.js

    backButton.addEventListener('click', () => history.back());

    const homeButton = document.getElementById('homeButton');
    if (homeButton) {
        homeButton.addEventListener('click', () => {
            // Update the URL to the main page and re-run the router
            history.pushState(null, '', resolveUrl('shipgirl/shipgirl-info/'));
            handleRoute();
        });
    }

    setupModal('skillSearchModal', {
        closeButtonSelector: '#closeSkillSearchModal',
        closeOnEscape: true,
        closeOnBackdrop: true,
        restoreFocus: true
    });

    // Prev/Next navigation buttons
    const prevShipBtn = document.getElementById('prevShipBtn');
    const nextShipBtn = document.getElementById('nextShipBtn');
    if (prevShipBtn) prevShipBtn.addEventListener('click', () => navigatePrevNext(-1));
    if (nextShipBtn) nextShipBtn.addEventListener('click', () => navigatePrevNext(1));

    // Keyboard navigation (arrows) in detail view
    document.addEventListener('keydown', (e) => {
        if (detailView.style.display === 'none') return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); navigatePrevNext(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); navigatePrevNext(1); }
    });

    // Swipe gesture in detail view
    let touchStartX = 0;
    let touchStartY = 0;
    detailView.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].clientX;
        touchStartY = e.changedTouches[0].clientY;
    }, { passive: true });
    detailView.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            dx > 0 ? navigatePrevNext(-1) : navigatePrevNext(1);
        }
    }, { passive: true });

    const gridViewBtn = document.getElementById('gridViewBtn');
    const listViewBtn = document.getElementById('listViewBtn');

    if (gridViewBtn && listViewBtn) {
        gridViewBtn.addEventListener('click', () => {
            state.viewMode = 'grid';
            shipgirls.className = 'shipgirl-grid';
            gridViewBtn.classList.add('active');
            listViewBtn.classList.remove('active');
            setStorageItem('shipgirl-view-mode', 'grid');
            renderShipgirls(); // Re-render with grid layout
        });

        listViewBtn.addEventListener('click', () => {
            state.viewMode = 'list';
            shipgirls.className = 'shipgirl-grid list-view';
            listViewBtn.classList.add('active');
            gridViewBtn.classList.remove('active');
            setStorageItem('shipgirl-view-mode', 'list');
            renderShipgirls(); // Re-render with list layout
        });

        const savedView = getStorageItem('shipgirl-view-mode', 'grid');
        if (savedView === 'list') {
            listViewBtn.click();
        }
    }
}

// ===== Filtering & Rendering =====
function populateFilterOptions() {
    // Populate ship type filter
    const shipTypeFilter = document.getElementById('shipTypeFilter');
    const uniqueShipTypes = [...new Set(state.shipgirlData.map(ship => String(ship.type)))].sort((a, b) => parseInt(a) - parseInt(b));

    shipTypeFilter.innerHTML = '<option value="">모든 함종</option>' +
        uniqueShipTypes.map(type => {
            const shipType = state.shipTypeData[type];
            return `<option value="${type}">${shipType ? shipType.type_name : `함종 ${type}`}</option>`;
        }).join('');

    // Populate nationality filter
    const nationalityFilter = document.getElementById('nationalityFilter');
    const uniqueNationalities = [...new Set(state.shipgirlData.map(ship => String(ship.nationality)))].sort((a, b) => parseInt(a) - parseInt(b));

    nationalityFilter.innerHTML = '<option value="">모든 진영</option>' +
        uniqueNationalities.map(nationality => {
            const nationalityInfo = state.nationalityData[nationality];
            return `<option value="${nationality}">${nationalityInfo ? nationalityInfo.name : `진영 ${nationality}`}</option>`;
        }).join('');
}

function filterShipgirls() {
    const searchTerm = searchInput.value.toLowerCase();
    const selectedRarity = rarityFilter.value;
    const selectedShipType = document.getElementById('shipTypeFilter').value;
    const selectedNationality = document.getElementById('nationalityFilter').value;

    state.filteredData = state.shipgirlData.filter(ship => {
        // Add safety checks for undefined values
        const matchesSearch = !searchTerm || (ship.name && ship.name.toLowerCase().includes(searchTerm));
        const matchesRarity = !selectedRarity || ship.rarity === selectedRarity;
        const matchesShipType = !selectedShipType || String(ship.type) === selectedShipType;
        const matchesNationality = !selectedNationality || String(ship.nationality) === selectedNationality;

        // Construction type filter
        const matchesConstruction = state.currentConstructionType === 'all' || ship[state.currentConstructionType] === true;

        // Retrofit filter — if the lookup Set isn't built yet (full data still
        // loading), don't hide anything; the change-handler awaits before applying.
        let matchesRetrofit = true;
        if (state.currentRetrofitFilter !== 'all' && state.retrofitGidSet) {
            const has = state.retrofitGidSet.has(ship.gid);
            matchesRetrofit = state.currentRetrofitFilter === 'yes' ? has : !has;
        }

        return matchesSearch && matchesRarity && matchesShipType && matchesNationality && matchesConstruction && matchesRetrofit;
    });

    renderShipgirls();
    updateFilterStats();
}

function renderShipgirls() {
    if (state.filteredData.length === 0) {
        shipgirls.innerHTML = '<p style="color: var(--text-primary); text-align: center; grid-column: 1/-1;">함순이를 찾을 수 없습니다.</p>';
        return;
    }

    shipgirls.innerHTML = state.filteredData.map(ship => createShipgirlCard(ship)).join('');
}

function escapeAttr(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

function createShipgirlCard(ship) {
    if (state.viewMode === 'list') {
        return createListCard(ship);
    } else {
        return createGridCard(ship);
    }
}

function createGridCard(ship) {
    const nationalityInfo = state.nationalityData[String(ship.nationality)] || {
        name: ship.nationality,
        code: ship.nationality,
        image: ''
    };
    const shipTypeInfo = state.shipTypeData[String(ship.type)] || {
        type_name: `함종 ${ship.type}`,
        icon: ''
    };

    const hasValidIcon = shipTypeInfo.icon && shipTypeInfo.icon !== 'undefined';

    // Construction badges for overlay
    let constructionBadges = '';
    if (ship.limited) {
        constructionBadges += '<span class="construction-badge limited-badge">★ 한정</span>';
    }
    if (ship.light) {
        constructionBadges += '<span class="construction-badge">소형</span>';
    }
    if (ship.heavy) {
        constructionBadges += '<span class="construction-badge">중형</span>';
    }
    if (ship.special) {
        constructionBadges += '<span class="construction-badge">특형</span>';
    }

    const timerDisplay = ship.timer ? `<span class="timer-badge">${formatTimer(ship.timer)}</span>` : '';
    const compactMaps = getCompactMapDisplay(ship.maps);
    const mapsDisplay = compactMaps ? `<span class="maps-badge" title="드랍 지역: ${compactMaps}"><i class="fas fa-map-marker-alt"></i> ${compactMaps}</span>` : '';

    return `
        <div class="shipgirl-card" data-ship-name="${escapeAttr(ship.name)}">
            ${createImg(ship.shipyard || '', ship.name || '알 수 없음', { className: 'shipgirl-image', fallback: IMG_FALLBACKS.CARD })}
            ${constructionBadges ? `<div class="construction-badges-overlay">${constructionBadges}</div>` : ''}
            <div class="shipgirl-info">
                <div class="shipgirl-name">${ship.name || '이름 없음'}</div>
                <div class="shipgirl-meta">
                    <span class="nationality-code" title="${nationalityInfo.name}">${nationalityInfo.code || nationalityInfo.name}</span>
                    ${hasValidIcon ?
            `<img src="${shipTypeInfo.icon}" alt="${shipTypeInfo.type_name}" class="ship-type-icon" title="${shipTypeInfo.type_name}">` :
            `<span class="ship-type-text">${shipTypeInfo.type_name}</span>`
        }
                    <span class="rarity-badge rarity-${ship.rarity}">${ship.rarity}</span>
                </div>
                ${timerDisplay}
                ${mapsDisplay}
            </div>
        </div>
    `;
}

function createListCard(ship) {
    const nationalityInfo = state.nationalityData[String(ship.nationality)] || {
        name: ship.nationality,
        code: ship.nationality,
        image: ''
    };
    const shipTypeInfo = state.shipTypeData[String(ship.type)] || {
        type_name: `함종 ${ship.type}`,
        icon: ''
    };

    const hasValidIcon = shipTypeInfo.icon && shipTypeInfo.icon !== 'undefined';

    // Construction badges for inline display
    let constructionBadges = '';
    if (ship.limited) {
        constructionBadges += '<span class="construction-badge limited-badge">★ 한정</span>';
    }
    if (ship.light) {
        constructionBadges += '<span class="construction-badge">소형</span>';
    }
    if (ship.heavy) {
        constructionBadges += '<span class="construction-badge">중형</span>';
    }
    if (ship.special) {
        constructionBadges += '<span class="construction-badge">특형</span>';
    }

    const timerDisplay = ship.timer ? `<span class="timer-badge">${formatTimer(ship.timer)}</span>` : '';
    const compactMaps = getCompactMapDisplay(ship.maps);
    const mapsDisplay = compactMaps ? `<span class="maps-badge" title="드랍 지역: ${compactMaps}"><i class="fas fa-map-marker-alt"></i> ${compactMaps}</span>` : '';

    return `
        <div class="shipgirl-card" data-ship-name="${escapeAttr(ship.name)}">
            ${createImg(ship.shipyard || '', ship.name || '알 수 없음', { className: 'shipgirl-image', fallback: IMG_FALLBACKS.CARD })}
            <div class="shipgirl-info">
                <div class="left-info">
                    <div class="shipgirl-name">${ship.name || '이름 없음'}</div>
                    ${constructionBadges}
                    ${timerDisplay}
                    ${mapsDisplay}
                </div>
                <div class="shipgirl-meta">
                    <span class="nationality-code" title="${nationalityInfo.name}">${nationalityInfo.code || nationalityInfo.name}</span>
                    ${hasValidIcon ?
            `<img src="${shipTypeInfo.icon}" alt="${shipTypeInfo.type_name}" class="ship-type-icon" title="${shipTypeInfo.type_name}">` :
            `<span class="ship-type-text">${shipTypeInfo.type_name}</span>`
        }
                    <span class="rarity-badge rarity-${ship.rarity}">${ship.rarity}</span>
                </div>
            </div>
        </div>
    `;
}

/** Summarize a ship's drop areas as a compact string (e.g. "1지, 3지, 5지 외 2개"). */
function getCompactMapDisplay(maps) {
    if (!maps || maps.length === 0) return '';

    const mapAreas = [];
    maps.forEach((areaData, areaIndex) => {
        if (areaData && areaData.length > 0) {
            const areaNumber = areaIndex + 1;
            mapAreas.push(`${areaNumber}지`);
        }
    });

    if (mapAreas.length === 0) return '';

    // Show up to 3 areas, then add "외 N개"
    const displayAreas = mapAreas.slice(0, 3);
    const remaining = mapAreas.length - 3;

    let display = displayAreas.join(', ');
    if (remaining > 0) {
        display += ` 외 ${remaining}개`;
    }

    return display;
}

// ===== Navigation =====

/** Convert a raw "HH:MM:SS" timer string to a Korean human-readable format. */
function formatTimer(timer) {
    if (!timer || timer === '건조시간 없음') return timer;
    const parts = timer.split(':');
    const hours = parseInt(parts[0]);
    const minutes = parseInt(parts[1]);
    const seconds = parts[2] ? parseInt(parts[2]) : 0;

    if (hours === 0 && seconds === 0) {
        return `${minutes}분`;
    } else if (hours === 0) {
        return `${minutes}분 ${seconds}초`;
    } else if (seconds === 0) {
        return `${hours}시간 ${minutes}분`;
    }
    return `${hours}시간 ${minutes}분 ${seconds}초`;
}

function updateFilterStats() {
    const totalCount = state.shipgirlData.length;
    const filteredCount = state.filteredData.length;

    // Update stats display if elements exist
    const totalElement = document.getElementById('totalShips');
    const filteredElement = document.getElementById('filteredShips');

    if (totalElement) totalElement.textContent = totalCount;
    if (filteredElement) filteredElement.textContent = filteredCount;
}

// ===== Navigation & Routing =====


function navigateToDetail(shipName) {
    history.pushState({ shipName }, '', resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(shipName)}`));
    handleRoute();
}

function handleRoute() {
    const shipName = getUrlParam('ship');

    if (shipName) {
        showDetailView(shipName);
    } else {
        showMainView();
    }

    // Reset scroll position to top
    window.scrollTo(0, 0);
}

function showMainView() {
    mainView.style.display = 'block';
    detailView.style.display = 'none';

    // Only populate filters if they haven't been populated yet
    if (document.getElementById('shipTypeFilter').options.length === 1) {
        populateFilterOptions();
    }

    renderShipgirls();
    updateFilterStats();

    // Reset scroll position to top
    window.scrollTo(0, 0);
}

function navigatePrevNext(direction) {
    const currentName = state.currentShip?.name;
    if (!currentName) return;

    const index = state.filteredData.findIndex(s => s.name === currentName);
    if (index === -1) return;

    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= state.filteredData.length) return;

    navigateToDetail(state.filteredData[newIndex].name);
}

function updateNavButtons() {
    const prevBtn = document.getElementById('prevShipBtn');
    const nextBtn = document.getElementById('nextShipBtn');
    const counter = document.getElementById('detailNavCounter');
    if (!prevBtn || !nextBtn) return;

    const index = state.filteredData.findIndex(s => s.name === state.currentShip?.name);

    if (index === -1) {
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        if (counter) counter.textContent = '';
        return;
    }

    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === state.filteredData.length - 1;
    if (counter) counter.textContent = `${index + 1} / ${state.filteredData.length}`;
}

// Store callbacks on state for sub-modules
state.showMainView = showMainView;
state.navigateToDetail = navigateToDetail;
state.navigatePrevNext = navigatePrevNext;
state.updateNavButtons = updateNavButtons;

// ===== Window Globals for inline onclick handlers =====
window.showMapsModal = showMapsModal;

// ===== Start Application =====
// Scroll to top button is handled globally by global.script.js
init().then(() => {
    setupMapsModalListeners();
    setupMapBrowserListeners();
});
