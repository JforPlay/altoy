/**
 * Fleet Build Simulator — Ship & Equipment Picker Module
 * Manages two picker modals: ship selection and equipment selection.
 * Both support fuzzy search (Fuse.js) and filter chips (type, rarity, nationality).
 */

import { createSearchIndex, debounce, setupModal, openModal, closeModal } from '../utils.js';
import {
    getShipByGid,
    getShipsByPosition,
    getEquipsByAllowedTypes,
    getShipPortraitUrl,
    getEquipIconUrl,
    getRarityBgUrl,
    getGenericSPWeapons,
    getSPWeaponIconUrl,
} from './fleet-sim.data.js';

// ===== State =====
let state;
let callbacks;

// ===== Active Picker Context =====
let activeSlotIndex = -1;
let activeEquipIndex = -1;

// ===== Search Indexes =====
let shipSearchIndex = null;
let equipSearchIndex = null;

// ===== Current Data Lists =====
let currentShipList = [];
let currentEquipList = [];

// ===== Active Filters =====
let shipFilters = { type: null, rarity: null, nation: null, query: '' };
let equipFilters = { rarity: null, query: '' };

// ===== DOM Cache =====
let shipSearchInput = null;
let shipTypeChips = null;
let shipRarityChips = null;
let shipNationChips = null;
let shipGrid = null;
let equipSearchInput = null;
let equipRarityChips = null;
let equipGrid = null;

// ===== Constants =====
const RARITY_ORDER = ['UR', 'SSR', 'SR', 'R', 'N'];

const RARITY_DISPLAY = {
    UR: 'UR',
    SSR: 'SSR',
    SR: 'SR',
    R: 'R',
    N: 'N',
};

// ===== Setup =====

/**
 * Initialize the picker module.
 * @param {object} stateRef - Shared state reference
 * @param {object} cbs - Callbacks: { onShipSelected, onEquipSelected }
 */
export function setup(stateRef, cbs) {
    state = stateRef;
    callbacks = cbs;
    _cacheDOM();
    _setupModals();
    _setupEventListeners();
}

// ===== Public API =====

/**
 * Open the ship picker for a given fleet slot.
 * Slots 0-2 = 후열 (back row), slots 3-5 = 전열 (front row).
 * @param {number} slotIndex - Fleet slot index (0-5)
 */
export function openShipPicker(slotIndex) {
    activeSlotIndex = slotIndex;

    // Determine position based on slot index
    const position = slotIndex < 3 ? '후열' : '전열';

    // Get filtered ship list for this position
    currentShipList = getShipsByPosition(position);

    // Create search index
    shipSearchIndex = currentShipList.length > 0
        ? createSearchIndex(currentShipList, { keys: ['name'], threshold: 0.3 })
        : null;

    // Reset filters
    shipFilters = { type: null, rarity: null, nation: null, query: '' };

    // Populate filter chips
    _populateShipTypeChips(currentShipList);
    _populateShipRarityChips(currentShipList);
    _populateShipNationChips(currentShipList);

    // Clear search input
    if (shipSearchInput) shipSearchInput.value = '';

    // Render grid and open modal
    _renderShipGrid();
    openModal('shipPickerModal');

    // Focus search input after modal opens
    if (shipSearchInput) {
        requestAnimationFrame(() => shipSearchInput.focus());
    }
}

/**
 * Open the equipment picker for a given fleet slot and equipment index.
 * @param {number} slotIndex - Fleet slot index (0-5)
 * @param {number} equipIndex - Equipment slot index within the ship (0-4)
 */
export function openEquipPicker(slotIndex, equipIndex) {
    activeSlotIndex = slotIndex;
    activeEquipIndex = equipIndex;

    // Get the ship at this slot
    const slotConfig = state.ships[slotIndex];
    const ship = slotConfig && slotConfig.gid ? getShipByGid(slotConfig.gid) : null;

    // Determine allowed equip types from ship's equip_X field
    let filteredEquips = [];
    if (ship) {
        const slotKey = `equip_${equipIndex + 1}`;
        const allowedTypes = ship[slotKey];

        if (allowedTypes && Array.isArray(allowedTypes) && allowedTypes.length > 0) {
            filteredEquips = getEquipsByAllowedTypes(allowedTypes, ship.type);
        } else {
            // Fallback: show all equips (equip_X field not yet available)
            filteredEquips = state.equipLiteData || [];
        }
    } else {
        // No ship in slot — show all equips
        filteredEquips = state.equipLiteData || [];
    }

    currentEquipList = filteredEquips;

    // Create search index
    equipSearchIndex = currentEquipList.length > 0
        ? createSearchIndex(currentEquipList, { keys: ['name'], threshold: 0.3 })
        : null;

    // Reset filters
    equipFilters = { rarity: null, query: '' };

    // Populate rarity chips
    _populateEquipRarityChips(currentEquipList);

    // Clear search input
    if (equipSearchInput) equipSearchInput.value = '';

    // Render grid and open modal
    _renderEquipGrid();
    openModal('equipPickerModal');

    // Focus search input after modal opens
    if (equipSearchInput) {
        requestAnimationFrame(() => equipSearchInput.focus());
    }
}

/**
 * Open the SP weapon picker for a given fleet slot.
 * Reuses the equip picker modal with SP weapon data.
 * @param {number} slotIndex - Fleet slot index (0-5)
 */
export function openSPWeaponPicker(slotIndex) {
    activeSlotIndex = slotIndex;
    activeEquipIndex = -1; // Flag: SP weapon mode

    const slotConfig = state.ships[slotIndex];
    const ship = slotConfig && slotConfig.gid ? getShipByGid(slotConfig.gid) : null;

    let spWeapons = [];
    if (ship) {
        spWeapons = getGenericSPWeapons(ship.type);
    }

    // Map SP weapons to equip-like objects for grid rendering
    currentEquipList = spWeapons.map(w => ({
        id: w.id,
        name: w.name,
        rarity: w.rarity,
        rarity_name: SP_RARITY_REVERSE[w.rarity] || '',
        icon: w.icon,
        level_count: w.levels ? w.levels.length : 11,
        _isSPWeapon: true,
    }));

    equipSearchIndex = currentEquipList.length > 0
        ? createSearchIndex(currentEquipList, { keys: ['name'], threshold: 0.3 })
        : null;

    equipFilters = { rarity: null, query: '' };
    _populateEquipRarityChips(currentEquipList);

    if (equipSearchInput) equipSearchInput.value = '';

    // Update modal header
    const header = document.querySelector('#equipPickerModal .modal-header h3');
    if (header) header.textContent = '특수 장비 선택';

    _renderEquipGrid();
    openModal('equipPickerModal');

    if (equipSearchInput) {
        requestAnimationFrame(() => equipSearchInput.focus());
    }
}

/** Reverse rarity map for SP weapons (shifted by 1 vs regular equip: 2=R, 3=SR, 4=SSR) */
const SP_RARITY_REVERSE = { 2: 'R', 3: 'SR', 4: 'SSR', 5: 'UR' };

// ===== Internal: DOM Cache =====

function _cacheDOM() {
    shipSearchInput = document.getElementById('ship-picker-search');
    shipTypeChips = document.getElementById('ship-type-filters');
    shipRarityChips = document.getElementById('ship-rarity-filters');
    shipNationChips = document.getElementById('ship-nation-filters');
    shipGrid = document.getElementById('ship-picker-grid');

    equipSearchInput = document.getElementById('equip-picker-search');
    equipRarityChips = document.getElementById('equip-rarity-filters');
    equipGrid = document.getElementById('equip-picker-grid');
}

// ===== Internal: Modal Setup =====

function _setupModals() {
    setupModal('shipPickerModal', {
        closeOnEscape: true,
        closeOnBackdrop: true,
        closeButtonSelector: '.modal-close-btn',
    });

    setupModal('equipPickerModal', {
        closeOnEscape: true,
        closeOnBackdrop: true,
        closeButtonSelector: '.modal-close-btn',
    });

    // Handle backdrop clicks explicitly (modal-backdrop is a child div,
    // so setupModal's e.target === modal check may not fire)
    const shipBackdrop = document.querySelector('#shipPickerModal .modal-backdrop');
    if (shipBackdrop) {
        shipBackdrop.addEventListener('click', () => closeModal('shipPickerModal'));
    }

    const equipBackdrop = document.querySelector('#equipPickerModal .modal-backdrop');
    if (equipBackdrop) {
        equipBackdrop.addEventListener('click', () => closeModal('equipPickerModal'));
    }
}

// ===== Internal: Event Listeners =====

function _setupEventListeners() {
    // Ship search input (debounced)
    if (shipSearchInput) {
        shipSearchInput.addEventListener('input', debounce(() => {
            shipFilters.query = shipSearchInput.value.trim();
            _renderShipGrid();
        }, 200));
    }

    // Equip search input (debounced)
    if (equipSearchInput) {
        equipSearchInput.addEventListener('input', debounce(() => {
            equipFilters.query = equipSearchInput.value.trim();
            _renderEquipGrid();
        }, 200));
    }

    // Ship type chip clicks (event delegation)
    if (shipTypeChips) {
        shipTypeChips.addEventListener('click', (e) => {
            const chip = e.target.closest('.filter-chip');
            if (!chip) return;

            const typeValue = chip.dataset.type;

            // Toggle: click same chip to deselect
            if (shipFilters.type === typeValue) {
                shipFilters.type = null;
            } else {
                shipFilters.type = typeValue;
            }

            _updateChipStates(shipTypeChips, shipFilters.type, 'type');
            _renderShipGrid();
        });
    }

    // Ship rarity chip clicks (event delegation)
    if (shipRarityChips) {
        shipRarityChips.addEventListener('click', (e) => {
            const chip = e.target.closest('.filter-chip');
            if (!chip) return;

            const rarityValue = chip.dataset.rarity;

            if (shipFilters.rarity === rarityValue) {
                shipFilters.rarity = null;
            } else {
                shipFilters.rarity = rarityValue;
            }

            _updateChipStates(shipRarityChips, shipFilters.rarity, 'rarity');
            _renderShipGrid();
        });
    }

    // Ship nationality chip clicks (event delegation)
    if (shipNationChips) {
        shipNationChips.addEventListener('click', (e) => {
            const chip = e.target.closest('.filter-chip');
            if (!chip) return;

            const nationValue = chip.dataset.nation;

            if (shipFilters.nation === nationValue) {
                shipFilters.nation = null;
            } else {
                shipFilters.nation = nationValue;
            }

            _updateChipStates(shipNationChips, shipFilters.nation, 'nation');
            _renderShipGrid();
        });
    }

    // Equip rarity chip clicks (event delegation)
    if (equipRarityChips) {
        equipRarityChips.addEventListener('click', (e) => {
            const chip = e.target.closest('.filter-chip');
            if (!chip) return;

            const rarityValue = chip.dataset.rarity;

            if (equipFilters.rarity === rarityValue) {
                equipFilters.rarity = null;
            } else {
                equipFilters.rarity = rarityValue;
            }

            _updateChipStates(equipRarityChips, equipFilters.rarity, 'rarity');
            _renderEquipGrid();
        });
    }

    // Ship grid item click (event delegation)
    if (shipGrid) {
        shipGrid.addEventListener('click', (e) => {
            const item = e.target.closest('.picker-item');
            if (!item) return;

            const gid = Number(item.dataset.gid);
            if (isNaN(gid)) return;

            if (callbacks && callbacks.onShipSelected) {
                callbacks.onShipSelected(activeSlotIndex, gid);
            }

            closeModal('shipPickerModal');
        });
    }

    // Equip grid item click (event delegation)
    if (equipGrid) {
        equipGrid.addEventListener('click', (e) => {
            const item = e.target.closest('.picker-item');
            if (!item) return;

            // Unequip action
            if (item.dataset.unequip === '1') {
                if (activeEquipIndex === -1) {
                    // SP weapon unequip
                    if (callbacks && callbacks.onSPWeaponSelected) {
                        callbacks.onSPWeaponSelected(activeSlotIndex, null, 0);
                    }
                } else {
                    if (callbacks && callbacks.onEquipSelected) {
                        callbacks.onEquipSelected(activeSlotIndex, activeEquipIndex, null, 0);
                    }
                }
                closeModal('equipPickerModal');
                const header = document.querySelector('#equipPickerModal .modal-header h3');
                if (header) header.textContent = '장비 선택';
                return;
            }

            const equipId = Number(item.dataset.equipId);
            if (isNaN(equipId)) return;

            const maxLevel = Number(item.dataset.maxLevel) || 0;

            // SP weapon selection
            if (item.dataset.spWeapon === '1') {
                if (callbacks && callbacks.onSPWeaponSelected) {
                    callbacks.onSPWeaponSelected(activeSlotIndex, equipId, maxLevel);
                }
            } else {
                if (callbacks && callbacks.onEquipSelected) {
                    callbacks.onEquipSelected(activeSlotIndex, activeEquipIndex, equipId, maxLevel);
                }
            }

            closeModal('equipPickerModal');

            // Restore modal header
            const header = document.querySelector('#equipPickerModal .modal-header h3');
            if (header) header.textContent = '장비 선택';
        });
    }
}

// ===== Internal: Filter Chip Population =====

/**
 * Populate ship type filter chips based on unique types in the filtered list.
 */
function _populateShipTypeChips(ships) {
    if (!shipTypeChips) return;

    // Collect unique ship types present in the list
    const typeSet = new Set();
    for (const ship of ships) {
        if (ship.type != null) typeSet.add(ship.type);
    }

    // Build chips sorted by type ID
    const sortedTypes = [...typeSet].sort((a, b) => a - b);
    const frag = document.createDocumentFragment();

    for (const typeId of sortedTypes) {
        const typeName = _getShipTypeName(typeId);
        if (!typeName) continue;

        const btn = document.createElement('button');
        btn.className = 'filter-chip';
        btn.dataset.type = String(typeId);
        btn.textContent = typeName;
        frag.appendChild(btn);
    }

    shipTypeChips.innerHTML = '';
    shipTypeChips.appendChild(frag);
}

/**
 * Populate ship rarity filter chips based on unique rarities in the list.
 */
function _populateShipRarityChips(ships) {
    if (!shipRarityChips) return;

    // Collect unique rarities present
    const raritySet = new Set();
    for (const ship of ships) {
        if (ship.rarity) raritySet.add(ship.rarity.toUpperCase());
    }

    const frag = document.createDocumentFragment();

    for (const rarity of RARITY_ORDER) {
        if (!raritySet.has(rarity)) continue;

        const btn = document.createElement('button');
        btn.className = 'filter-chip';
        // Use lowercase for CSS matching (.filter-chip[data-rarity="ssr"].active)
        btn.dataset.rarity = rarity.toLowerCase();
        btn.textContent = RARITY_DISPLAY[rarity] || rarity;
        frag.appendChild(btn);
    }

    shipRarityChips.innerHTML = '';
    shipRarityChips.appendChild(frag);
}

/**
 * Populate ship nationality filter chips based on unique nationalities in the list.
 */
function _populateShipNationChips(ships) {
    if (!shipNationChips) return;

    // Collect unique nationality IDs
    const nationSet = new Set();
    for (const ship of ships) {
        if (ship.nationality != null) nationSet.add(ship.nationality);
    }

    // Build chips sorted by nationality ID, using nationalityData for display names
    const sortedNations = [...nationSet].sort((a, b) => a - b);
    const frag = document.createDocumentFragment();

    for (const natId of sortedNations) {
        const natName = _getNationalityName(natId);
        if (!natName) continue;

        const btn = document.createElement('button');
        btn.className = 'filter-chip';
        btn.dataset.nation = String(natId);
        btn.textContent = natName;
        frag.appendChild(btn);
    }

    shipNationChips.innerHTML = '';
    shipNationChips.appendChild(frag);
}

/**
 * Populate equip rarity filter chips based on unique rarities in the list.
 */
function _populateEquipRarityChips(equips) {
    if (!equipRarityChips) return;

    const raritySet = new Set();
    for (const equip of equips) {
        if (equip.rarity_name) raritySet.add(equip.rarity_name.toUpperCase());
    }

    const frag = document.createDocumentFragment();

    for (const rarity of RARITY_ORDER) {
        if (!raritySet.has(rarity)) continue;

        const btn = document.createElement('button');
        btn.className = 'filter-chip';
        // Use lowercase for CSS matching (.filter-chip[data-rarity="ssr"].active)
        btn.dataset.rarity = rarity.toLowerCase();
        btn.textContent = RARITY_DISPLAY[rarity] || rarity;
        frag.appendChild(btn);
    }

    equipRarityChips.innerHTML = '';
    equipRarityChips.appendChild(frag);
}

// ===== Internal: Chip State Update =====

/**
 * Update active state on filter chips in a container.
 * @param {HTMLElement} container - Chip container
 * @param {string|null} activeValue - Currently active value (null = none)
 * @param {string} dataAttr - The data attribute name to match (e.g. 'type', 'rarity', 'nation')
 */
function _updateChipStates(container, activeValue, dataAttr) {
    if (!container) return;

    const chips = container.querySelectorAll('.filter-chip');
    for (const chip of chips) {
        if (activeValue != null && chip.dataset[dataAttr] === activeValue) {
            chip.classList.add('active');
        } else {
            chip.classList.remove('active');
        }
    }
}

// ===== Internal: Ship Grid Rendering =====

function _renderShipGrid() {
    if (!shipGrid) return;

    let ships = currentShipList;

    // Apply search query
    if (shipFilters.query && shipSearchIndex) {
        const results = shipSearchIndex.search(shipFilters.query);
        ships = results.map(r => r.item);
    }

    // Apply type filter
    if (shipFilters.type != null) {
        const typeNum = Number(shipFilters.type);
        ships = ships.filter(s => s.type === typeNum);
    }

    // Apply rarity filter (stored as lowercase to match CSS data-rarity)
    if (shipFilters.rarity != null) {
        ships = ships.filter(s =>
            s.rarity && s.rarity.toLowerCase() === shipFilters.rarity
        );
    }

    // Apply nationality filter
    if (shipFilters.nation != null) {
        const natNum = Number(shipFilters.nation);
        ships = ships.filter(s => s.nationality === natNum);
    }

    // Build set of already-assigned ship gids for marking
    const assignedGids = new Set();
    if (state.ships) {
        for (const slot of state.ships) {
            if (slot && slot.gid != null) assignedGids.add(slot.gid);
        }
    }

    // Render
    if (ships.length === 0) {
        shipGrid.innerHTML = '<div class="picker-empty">검색 결과가 없습니다.</div>';
        return;
    }

    const frag = document.createDocumentFragment();

    for (const ship of ships) {
        const div = document.createElement('div');
        const rarityLower = (ship.rarity || '').toLowerCase();

        div.className = 'picker-item';
        if (assignedGids.has(ship.gid)) {
            div.classList.add('assigned');
        }

        div.dataset.gid = ship.gid;
        div.dataset.rarity = rarityLower;

        const portraitUrl = getShipPortraitUrl(ship.skin_id);

        div.innerHTML = `
            <img class="picker-item-icon" src="${portraitUrl}" alt="${ship.name}" loading="lazy" />
            <span class="picker-item-name">${ship.name}</span>
        `;

        frag.appendChild(div);
    }

    shipGrid.innerHTML = '';
    shipGrid.appendChild(frag);
}

// ===== Internal: Equip Grid Rendering =====

function _renderEquipGrid() {
    if (!equipGrid) return;

    let equips = currentEquipList;

    // Apply search query
    if (equipFilters.query && equipSearchIndex) {
        const results = equipSearchIndex.search(equipFilters.query);
        equips = results.map(r => r.item);
    }

    // Apply rarity filter (stored as lowercase to match CSS data-rarity)
    if (equipFilters.rarity != null) {
        equips = equips.filter(e =>
            e.rarity_name && e.rarity_name.toLowerCase() === equipFilters.rarity
        );
    }

    // Render
    if (equips.length === 0) {
        equipGrid.innerHTML = '<div class="picker-empty">검색 결과가 없습니다.</div>';
        return;
    }

    const frag = document.createDocumentFragment();

    // Unequip option: show when the slot already has equipment
    const hasEquipped = _slotHasEquip(activeSlotIndex, activeEquipIndex);
    if (hasEquipped) {
        const unequipDiv = document.createElement('div');
        unequipDiv.className = 'picker-item picker-item-unequip';
        unequipDiv.dataset.unequip = '1';
        unequipDiv.innerHTML = `
            <span class="material-symbols-outlined picker-unequip-icon">remove_circle_outline</span>
            <span class="picker-item-name">장착 해제</span>
        `;
        frag.appendChild(unequipDiv);
    }

    for (const equip of equips) {
        const div = document.createElement('div');
        const rarityLower = (equip.rarity_name || '').toLowerCase();

        div.className = 'picker-item';
        div.dataset.equipId = equip.id;
        div.dataset.rarity = rarityLower;
        if (equip._isSPWeapon) div.dataset.spWeapon = '1';

        // Max enhance level = level_count - 1 (e.g., 14 levels → +13 max)
        const maxLevel = equip.level_count ? equip.level_count - 1 : 0;
        div.dataset.maxLevel = maxLevel;

        // SP weapons use different icon URL
        if (equip._isSPWeapon) {
            const iconUrl = getSPWeaponIconUrl(equip.icon);
            const spBgUrl = getRarityBgUrl(equip.rarity + 1);
            div.innerHTML = `
                <div class="equip-icon-wrapper">
                    <img class="equip-icon-bg" src="${spBgUrl}" alt="" loading="lazy" />
                    ${iconUrl ? `<img class="equip-icon-fg" src="${iconUrl}" alt="${equip.name}" loading="lazy" />` : ''}
                </div>
                <span class="picker-item-name">${equip.name}</span>
            `;
        } else {
            const iconUrl = getEquipIconUrl(equip.icon);
            const bgUrl = getRarityBgUrl(equip.rarity);
            div.innerHTML = `
                <div class="equip-icon-wrapper">
                    <img class="equip-icon-bg" src="${bgUrl}" alt="" loading="lazy" />
                    ${iconUrl ? `<img class="equip-icon-fg" src="${iconUrl}" alt="${equip.name}" loading="lazy" />` : ''}
                </div>
                <span class="picker-item-name">${equip.name}</span>
            `;
        }

        frag.appendChild(div);
    }

    equipGrid.innerHTML = '';
    equipGrid.appendChild(frag);
}

// ===== Internal: Helpers =====

/**
 * Get ship type display name from type ID.
 */
function _getShipTypeName(typeId) {
    if (!state.shipTypeData) return '';
    const typeInfo = state.shipTypeData[String(typeId)];
    return typeInfo ? typeInfo.type_name : '';
}

/**
 * Get nationality display name from nationality ID.
 */
function _getNationalityName(natId) {
    if (!state.nationalityData) return '';
    const natInfo = state.nationalityData[String(natId)];
    return natInfo ? natInfo.name : '';
}

/**
 * Check if a given slot already has equipment equipped.
 * For SP weapons (activeEquipIndex === -1), checks spWeapon.
 * For regular equips, checks equips[equipIndex].
 */
function _slotHasEquip(slotIndex, equipIndex) {
    const slotConfig = state.ships[slotIndex];
    if (!slotConfig) return false;

    if (equipIndex === -1) {
        // SP weapon mode
        return !!(slotConfig.spWeapon && slotConfig.spWeapon.id);
    }
    return !!(slotConfig.equips && slotConfig.equips[equipIndex] && slotConfig.equips[equipIndex].id);
}
