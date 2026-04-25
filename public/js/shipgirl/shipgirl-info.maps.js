/**
 * shipgirl-info.maps.js
 * Two map-related modals for the shipgirl info page:
 * 1. Maps modal: shows which stages a specific ship drops from.
 * 2. Map browser modal: reverse lookup — pick a stage, see which ships drop there.
 * Part of the shipgirl-info module group (info + data + detail + maps).
 * State is shared via a ref passed to setup() from shipgirl-info.js.
 */

import { showToast, openModal, closeModal, setupModal } from '../utils.js';

'use strict';

// ===== State Reference =====
let state;

export function setup(stateRef) {
    state = stateRef;
}

// ===== Map Browser State =====
let mapBrowserData = null;
let mapBrowserFilters = createDefaultMapBrowserFilters();

function createDefaultMapBrowserFilters() {
    return {
        area: 'all',
        map: 'all',
        type: 'all',
        rarity: 'all',
        shipType: 'all',
        nationality: 'all',
        search: ''
    };
}

function resetMapBrowserFilters() {
    mapBrowserFilters = createDefaultMapBrowserFilters();
    syncMapBrowserControls();
}

function syncMapBrowserControls() {
    const areaFilter = document.getElementById('mapBrowserAreaFilter');
    const mapFilter = document.getElementById('mapBrowserMapFilter');
    const typeFilter = document.getElementById('mapBrowserTypeFilter');
    const rarityFilter = document.getElementById('mapBrowserRarityFilter');
    const shipTypeFilter = document.getElementById('mapBrowserShipTypeFilter');
    const nationalityFilter = document.getElementById('mapBrowserNationalityFilter');
    const searchInput = document.getElementById('mapBrowserSearchInput');

    if (areaFilter) areaFilter.value = mapBrowserFilters.area;
    updateMapFilter();
    if (mapFilter) mapFilter.value = mapBrowserFilters.map;
    if (typeFilter) typeFilter.value = mapBrowserFilters.type;
    if (rarityFilter) rarityFilter.value = mapBrowserFilters.rarity;
    if (shipTypeFilter) shipTypeFilter.value = mapBrowserFilters.shipType;
    if (nationalityFilter) nationalityFilter.value = mapBrowserFilters.nationality;
    if (searchInput) searchInput.value = mapBrowserFilters.search;
}

// ===== Maps Modal (Ship → Stages) =====

/** Open the maps modal for a ship, ensuring full data is loaded first. */
export async function showMapsModal(shipName) {
    // Ensure full data is loaded
    if (!state.fullShipData) {
        showToast('데이터 로딩 중...', 'info');
        state.fullShipData = await state.fullShipDataPromise;
        if (!state.fullShipData) {
            showToast('전체 데이터를 불러올 수 없습니다.', 'error');
            return;
        }
    }

    const ship = state.fullShipData.find(s => s.name === shipName);
    if (!ship || !ship.maps) {
        showToast('드랍 지역 정보가 없습니다.', 'warning');
        return;
    }

    const modal = document.getElementById('mapsModal');
    const modalTitle = document.getElementById('mapsModalTitle');
    const mapsContent = document.getElementById('mapsContent');

    modalTitle.textContent = `${ship.name} - 드랍 지역`;

    // Render maps
    renderMaps(ship.maps);

    // Show modal
    openModal('mapsModal');
}

function renderMaps(mapsData, searchTerm = '') {
    const mapsContent = document.getElementById('mapsContent');

    // Filter and organize map data
    const mapsByArea = [];
    mapsData.forEach((areaData, areaIndex) => {
        if (areaData && areaData.length > 0) {
            const areaNumber = areaIndex + 1;
            const areaName = `${areaNumber}지`;

            // Filter by search term if provided
            if (searchTerm) {
                const searchLower = searchTerm.toLowerCase();
                const areaMatches = areaName.includes(searchLower) ||
                                   String(areaNumber).includes(searchLower) ||
                                   areaData.some(map => `${areaNumber}-${map.map}`.includes(searchLower));

                if (!areaMatches) return;
            }

            mapsByArea.push({
                area: areaNumber,
                areaName: areaName,
                maps: areaData
            });
        }
    });

    if (mapsByArea.length === 0) {
        mapsContent.innerHTML = `
            <div class="maps-empty">
                ${searchTerm ? '검색 결과가 없습니다.' : '드랍 가능한 지역이 없습니다.'}
            </div>
        `;
        return;
    }

    // Render maps grouped by area
    mapsContent.innerHTML = mapsByArea.map(({ area, areaName, maps }) => `
        <div class="map-area-group">
            <div class="map-area-header">
                <span class="map-area-number">${areaName}</span>
            </div>
            <div class="map-list">
                ${maps.map(mapData => `
                    <div class="map-item ${getMapTypeClass(mapData.type)}">
                        <span class="map-name">${area}-${mapData.map}</span>
                        <span class="map-type-badge">${getMapTypeName(mapData.type)}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

export function getMapTypeClass(type) {
    switch(type) {
        case 0: return 'map-type-normal';
        case 1: return 'map-type-boss';
        default: return 'map-type-unknown';
    }
}

export function getMapTypeName(type) {
    switch(type) {
        case 0: return '일반';
        case 1: return '보스';
        default: return '알 수 없음';
    }
}

function closeMapsModal() {
    closeModal('mapsModal', {
        onClose: () => {
            const searchInput = document.getElementById('mapsSearchInput');
            if (searchInput) searchInput.value = '';
            document.getElementById('clearMapsSearch').style.display = 'none';
        }
    });
}

export function setupMapsModalListeners() {
    const searchInput = document.getElementById('mapsSearchInput');
    const clearSearchBtn = document.getElementById('clearMapsSearch');

    setupModal('mapsModal', {
        closeButtonSelector: '#closeMapsModal',
        closeOnBackdrop: true,
        closeOnEscape: true,
        onClose: () => {
            if (searchInput) searchInput.value = '';
            if (clearSearchBtn) clearSearchBtn.style.display = 'none';
        }
    });

    // Search functionality
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value;
            clearSearchBtn.style.display = searchTerm ? 'block' : 'none';

            // Get current ship's maps data
            const modalTitle = document.getElementById('mapsModalTitle').textContent;
            const shipName = modalTitle.replace(' - 드랍 지역', '');
            const ship = state.fullShipData ? state.fullShipData.find(s => s.name === shipName) : state.shipgirlData.find(s => s.name === shipName);

            if (ship && ship.maps) {
                renderMaps(ship.maps, searchTerm);
            }
        });
    }

    // Clear search button
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearSearchBtn.style.display = 'none';

            // Re-render without filter
            const modalTitle = document.getElementById('mapsModalTitle').textContent;
            const shipName = modalTitle.replace(' - 드랍 지역', '');
            const ship = state.fullShipData ? state.fullShipData.find(s => s.name === shipName) : state.shipgirlData.find(s => s.name === shipName);

            if (ship && ship.maps) {
                renderMaps(ship.maps);
            }
        });
    }
}

// ===== Map Browser Modal (Stage → Ships) =====

/**
 * Open the map browser modal for the reverse lookup.
 * Builds the mapBrowserData index once on first open, then populates filters and renders.
 */
async function openMapBrowserModal() {
    // Ensure full data is loaded
    if (!state.fullShipData) {
        showToast('데이터 로딩 중...', 'info');
        state.fullShipData = await state.fullShipDataPromise;
        if (!state.fullShipData) {
            showToast('전체 데이터를 불러올 수 없습니다.', 'error');
            return;
        }
    }

    // Build map browser data structure
    if (!mapBrowserData) {
        mapBrowserData = buildMapBrowserData();
    }

    // Populate filter dropdowns
    populateMapBrowserFilters();
    syncMapBrowserControls();

    // Render content
    renderMapBrowserContent();

    // Show modal
    openModal('mapBrowserModal');
}

/**
 * Build the area→map→ships index from fullShipData.maps.
 * The result is cached in mapBrowserData and reused on subsequent openings.
 */
function buildMapBrowserData() {
    const mapData = {};

    state.fullShipData.forEach(ship => {
        if (!ship.maps) return;

        ship.maps.forEach((areaData, areaIndex) => {
            if (!areaData || areaData.length === 0) return;

            const areaNumber = areaIndex + 1;
            const areaKey = `area_${areaNumber}`;

            if (!mapData[areaKey]) {
                mapData[areaKey] = {
                    area: areaNumber,
                    areaName: `${areaNumber}지`,
                    maps: {}
                };
            }

            areaData.forEach(mapInfo => {
                const mapKey = `map_${mapInfo.map}`;
                const mapId = `${areaNumber}-${mapInfo.map}`;

                if (!mapData[areaKey].maps[mapKey]) {
                    mapData[areaKey].maps[mapKey] = {
                        mapNumber: mapInfo.map,
                        mapId: mapId,
                        mapName: mapId,
                        type: mapInfo.type,
                        ships: []
                    };
                }

                // Add ship to this map
                mapData[areaKey].maps[mapKey].ships.push({
                    ...ship,
                    dropType: mapInfo.type
                });
            });
        });
    });

    return mapData;
}

function populateMapBrowserFilters() {
    if (!mapBrowserData) return;

    const areaFilter = document.getElementById('mapBrowserAreaFilter');
    const shipTypeFilter = document.getElementById('mapBrowserShipTypeFilter');
    const nationalityFilter = document.getElementById('mapBrowserNationalityFilter');

    // Populate area filter
    const areas = Object.values(mapBrowserData).sort((a, b) => a.area - b.area);
    areaFilter.innerHTML = '<option value="all">모든 지역</option>' +
        areas.map(area => `<option value="${area.area}">${area.areaName}</option>`).join('');

    // Populate ship type filter (use existing shipTypeData)
    const uniqueShipTypes = [...new Set(state.fullShipData.map(ship => String(ship.type)))].sort((a, b) => parseInt(a) - parseInt(b));
    shipTypeFilter.innerHTML = '<option value="all">모든 함종</option>' +
        uniqueShipTypes.map(type => {
            const shipType = state.shipTypeData[type];
            return `<option value="${type}">${shipType ? shipType.type_name : `함종 ${type}`}</option>`;
        }).join('');

    // Populate nationality filter (use existing nationalityData)
    const uniqueNationalities = [...new Set(state.fullShipData.map(ship => String(ship.nationality)))].sort((a, b) => parseInt(a) - parseInt(b));
    nationalityFilter.innerHTML = '<option value="all">모든 진영</option>' +
        uniqueNationalities.map(nationality => {
            const nationalityInfo = state.nationalityData[nationality];
            return `<option value="${nationality}">${nationalityInfo ? nationalityInfo.name : `진영 ${nationality}`}</option>`;
        }).join('');
}

function updateMapFilter() {
    if (!mapBrowserData) return;

    const areaFilter = document.getElementById('mapBrowserAreaFilter');
    const mapFilter = document.getElementById('mapBrowserMapFilter');
    const selectedArea = areaFilter.value;

    if (selectedArea === 'all') {
        mapFilter.innerHTML = '<option value="all">모든 맵</option>';
        mapFilter.disabled = true;
    } else {
        const areaKey = `area_${selectedArea}`;
        const areaMaps = mapBrowserData[areaKey]?.maps || {};
        const maps = Object.values(areaMaps).sort((a, b) => a.mapNumber - b.mapNumber);

        mapFilter.innerHTML = '<option value="all">모든 맵</option>' +
            maps.map(map => `<option value="${map.mapNumber}">${selectedArea}-${map.mapNumber}</option>`).join('');
        mapFilter.disabled = false;
    }

    // Reset map filter selection
    mapBrowserFilters.map = 'all';
}

function applyMapBrowserFilters() {
    renderMapBrowserContent();
}

function renderMapBrowserContent() {
    if (!mapBrowserData) return;

    const content = document.getElementById('mapBrowserContent');
    const { area, map, type, rarity, shipType, nationality, search } = mapBrowserFilters;

    const filteredData = [];

    Object.values(mapBrowserData).forEach(areaData => {
        // Filter by area
        if (area !== 'all' && String(areaData.area) !== area) return;

        Object.values(areaData.maps).forEach(mapData => {
            // Filter by map
            if (map !== 'all' && String(mapData.mapNumber) !== map) return;

            // Filter by type
            if (type !== 'all' && String(mapData.type) !== type) return;

            // Filter ships
            const filteredShips = mapData.ships.filter(ship => {
                if (rarity !== 'all' && ship.rarity !== rarity) return false;
                if (shipType !== 'all' && String(ship.type) !== shipType) return false;
                if (nationality !== 'all' && String(ship.nationality) !== nationality) return false;
                if (search && !ship.name.toLowerCase().includes(search.toLowerCase())) return false;
                return true;
            });

            if (filteredShips.length > 0) {
                filteredData.push({
                    area: areaData.area,
                    areaName: areaData.areaName,
                    mapNumber: mapData.mapNumber,
                    mapId: mapData.mapId,
                    mapName: mapData.mapName,
                    type: mapData.type,
                    ships: filteredShips
                });
            }
        });
    });

    if (filteredData.length === 0) {
        content.innerHTML = '<div class="maps-empty">해당 조건에 맞는 함순이가 없습니다.</div>';
        return;
    }

    // Sort by area and map
    filteredData.sort((a, b) => {
        if (a.area !== b.area) return a.area - b.area;
        return a.mapNumber - b.mapNumber;
    });

    // Sort ships within each map by rarity (high to low)
    const RARITY_ORDER = { 'UR': 0, 'SSR': 1, 'SR': 2, 'R': 3, 'N': 4 };
    filteredData.forEach(data => {
        data.ships.sort((a, b) => (RARITY_ORDER[a.rarity] ?? 5) - (RARITY_ORDER[b.rarity] ?? 5));
    });

    // Render
    content.innerHTML = filteredData.map(data => `
        <div class="map-browser-section">
            <div class="map-browser-header">
                <span class="map-browser-map-name">${data.mapName}</span>
                <span class="map-type-badge ${getMapTypeClass(data.type)}">${getMapTypeName(data.type)}</span>
                <span class="map-browser-count">${data.ships.length}척</span>
            </div>
            <div class="map-browser-ships">
                ${data.ships.map(ship => createMapBrowserShipCard(ship)).join('')}
            </div>
        </div>
    `).join('');

    // Defer click-handler setup so the newly inserted cards are in the DOM
    setTimeout(() => {
        document.querySelectorAll('.map-browser-ship-card').forEach(card => {
            card.addEventListener('click', () => {
                const shipName = card.dataset.shipName;
                closeMapBrowserModal();
                state.navigateToDetail(shipName);
            });
        });
    }, 0);
}

function createMapBrowserShipCard(ship) {
    const nationalityInfo = state.nationalityData[String(ship.nationality)] || {
        name: ship.nationality,
        code: ship.nationality
    };
    return `
        <div class="map-browser-ship-card" data-ship-name="${ship.name}">
            <img src="${ship.shipyard || ''}" alt="${ship.name}" class="map-browser-ship-image"
                 onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect fill=%22%23ddd%22 width=%22100%22 height=%22100%22/%3E%3C/svg%3E'">
            <div class="map-browser-ship-info">
                <div class="map-browser-ship-name">${ship.name}</div>
                <div class="map-browser-ship-meta">
                    <span class="nationality-code" title="${nationalityInfo.name}">${nationalityInfo.code || nationalityInfo.name}</span>
                    <span class="rarity-badge rarity-${ship.rarity}">${ship.rarity}</span>
                </div>
            </div>
        </div>
    `;
}

function closeMapBrowserModal() {
    closeModal('mapBrowserModal', {
        onClose: resetMapBrowserFilters
    });
}

export function setupMapBrowserListeners() {
    const openBtn = document.getElementById('mapBrowserBtn');

    if (openBtn) {
        openBtn.addEventListener('click', openMapBrowserModal);
    }

    setupModal('mapBrowserModal', {
        closeButtonSelector: '#closeMapBrowserModal',
        closeOnBackdrop: true,
        closeOnEscape: true,
        onClose: resetMapBrowserFilters
    });

    // Filter change handlers
    const areaFilter = document.getElementById('mapBrowserAreaFilter');
    const mapFilter = document.getElementById('mapBrowserMapFilter');
    const typeFilter = document.getElementById('mapBrowserTypeFilter');
    const rarityFilter = document.getElementById('mapBrowserRarityFilter');
    const shipTypeFilter = document.getElementById('mapBrowserShipTypeFilter');
    const nationalityFilter = document.getElementById('mapBrowserNationalityFilter');
    const searchInput = document.getElementById('mapBrowserSearchInput');

    if (areaFilter) {
        areaFilter.addEventListener('change', (e) => {
            mapBrowserFilters.area = e.target.value;
            updateMapFilter();
            applyMapBrowserFilters();
        });
    }

    if (mapFilter) {
        mapFilter.addEventListener('change', (e) => {
            mapBrowserFilters.map = e.target.value;
            applyMapBrowserFilters();
        });
    }

    if (typeFilter) {
        typeFilter.addEventListener('change', (e) => {
            mapBrowserFilters.type = e.target.value;
            applyMapBrowserFilters();
        });
    }

    if (rarityFilter) {
        rarityFilter.addEventListener('change', (e) => {
            mapBrowserFilters.rarity = e.target.value;
            applyMapBrowserFilters();
        });
    }

    if (shipTypeFilter) {
        shipTypeFilter.addEventListener('change', (e) => {
            mapBrowserFilters.shipType = e.target.value;
            applyMapBrowserFilters();
        });
    }

    if (nationalityFilter) {
        nationalityFilter.addEventListener('change', (e) => {
            mapBrowserFilters.nationality = e.target.value;
            applyMapBrowserFilters();
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            mapBrowserFilters.search = e.target.value;
            applyMapBrowserFilters();
        });
    }
}
