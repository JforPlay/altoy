/**
 * Shipgirl Info Module - Main Entry Point
 * Keeps state, imports from sub-modules, sets up event listeners, filtering, rendering, and routing
 */

import { createImg, getUrlParam, IMG_FALLBACKS, showToast, resolveUrl, getStorageItem, setStorageItem } from '../utils.js';
import {
    setup as setupData,
    loadData, loadNationalityData, loadAttrTypeData,
    loadShipTypeData, loadSkillIconData, loadSkillDataTemplate
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

// ===== Application State =====
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
    /** @type {Object} */
    skillDataTemplate: {},
    /** @type {string} */
    viewMode: 'grid',

    // Construction-specific filters
    currentConstructionType: 'all',
    currentTimerFilter: 'all',

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
const errorDiv = document.getElementById('error');

// Store DOM elements in state for sub-modules
state.elements = { mainView, detailView, shipgirls, searchInput, rarityFilter, backButton, loading, errorDiv };

// Initialize sub-modules with shared state reference
setupData(state);
setupDetail(state);
setupMaps(state);

// ===== Initialization =====
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
            loadSkillIconData(),
            loadSkillDataTemplate()
        ]);
        loading.style.display = 'none';

        // Populate filter options BEFORE setting up event listeners
        populateFilterOptions();

        // Initialize stats counter
        updateFilterStats();

        handleRoute();
        setupEventListeners();
        window.addEventListener('popstate', handleRoute);
    } catch (error) {
        loading.style.display = 'none';
        showToast(error.message || 'Initialization error', 'error');
        console.error('Initialization error:', error);
    }
}

// ===== Event Listeners =====
function setupEventListeners() {
    searchInput.addEventListener('input', filterShipgirls);
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

// ===== Populate Filter Options =====
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

// ===== Filtering and Rendering =====
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

        // Timer filter
        const matchesTimer = state.currentTimerFilter === 'all' || ship.timer === state.currentTimerFilter;

        return matchesSearch && matchesRarity && matchesShipType && matchesNationality && matchesConstruction && matchesTimer;
    });

    renderShipgirls();
    updateFilterStats();
}

function renderShipgirls() {
    if (state.filteredData.length === 0) {
        shipgirls.innerHTML = '<p style="color: var(--text-primary); text-align: center; grid-column: 1/-1;">함선을 찾을 수 없습니다.</p>';
        return;
    }

    shipgirls.innerHTML = state.filteredData.map(ship => createShipgirlCard(ship)).join('');

    document.querySelectorAll('.shipgirl-card').forEach((card, index) => {
        card.addEventListener('click', () => navigateToDetail(state.filteredData[index].name));
    });
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
    if (ship.medium) {
        constructionBadges += '<span class="construction-badge">중형</span>';
    }
    if (ship.heavy) {
        constructionBadges += '<span class="construction-badge">특형</span>';
    }

    const timerDisplay = ship.timer ? `<span class="timer-badge">${formatTimer(ship.timer)}</span>` : '';
    const compactMaps = getCompactMapDisplay(ship.maps);
    const mapsDisplay = compactMaps ? `<span class="maps-badge" title="드랍 지역: ${compactMaps}"><i class="fas fa-map-marker-alt"></i> ${compactMaps}</span>` : '';

    return `
        <div class="shipgirl-card">
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
    if (ship.medium) {
        constructionBadges += '<span class="construction-badge">중형</span>';
    }
    if (ship.heavy) {
        constructionBadges += '<span class="construction-badge">특형</span>';
    }

    const timerDisplay = ship.timer ? `<span class="timer-badge">${formatTimer(ship.timer)}</span>` : '';
    const compactMaps = getCompactMapDisplay(ship.maps);
    const mapsDisplay = compactMaps ? `<span class="maps-badge" title="드랍 지역: ${compactMaps}"><i class="fas fa-map-marker-alt"></i> ${compactMaps}</span>` : '';

    return `
        <div class="shipgirl-card">
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

// Get compact map display for cards
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

// Format timer for display
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

// Update filter statistics
function updateFilterStats() {
    const totalCount = state.shipgirlData.length;
    const filteredCount = state.filteredData.length;

    // Update stats display if elements exist
    const totalElement = document.getElementById('totalShips');
    const filteredElement = document.getElementById('filteredShips');

    if (totalElement) totalElement.textContent = totalCount;
    if (filteredElement) filteredElement.textContent = filteredCount;
}

// ===== Navigation and Routing =====
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

// Store callbacks on state for sub-modules
state.showMainView = showMainView;
state.navigateToDetail = navigateToDetail;

// ===== Window Globals for inline onclick handlers =====
window.showMapsModal = showMapsModal;

// ===== Start Application =====
// Scroll to top button is handled globally by global.script.js
init().then(() => {
    setupMapsModalListeners();
    setupMapBrowserListeners();
});
