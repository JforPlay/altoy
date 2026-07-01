/**
 * Fleet Build Simulator — Ship & Equipment Picker Module
 * Manages two picker modals: ship selection and equipment selection.
 * Both support fuzzy search (Fuse.js) and filter chips (type, rarity, nationality).
 */

import { createSearchIndex, ensureFuse, debounce, setupModal, openModal, closeModal, IMG_FALLBACKS, RARITY_TIERS_DESC as RARITY_ORDER, renderStatus } from '../utils.js';
import {
    getShipByGid,
    getShipsByPosition,
    getEquipsByAllowedTypes,
    getShipPortraitUrl,
    getEquipIconUrl,
    getRarityBgUrl,
    getGenericSPWeapons,
    getSPWeaponIconUrl,
    getMaxEnhanceLevel,
    getSlotAllowedTypes,
    getEffectiveShipType,
} from './fleet-sim.data.js';
import { getAllMetaBosses } from './fleet-sim.data.js';
import { ARMOR_PRESETS } from '../engine/damage/index.js';

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
let bossFilters = { category: null, query: '' };
let bossSearchIndex = null;
let currentBossList = [];
let bossSearchInput = null;
let bossCategoryChips = null;
let bossGrid = null;

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
    // Picker functions (openShipPicker / openEquipPicker / openSPWeaponPicker) are
    // synchronous event handlers that build a Fuse index per picker open. Kick off
    // the lazy Fuse load now so the indexes are ready by the time a picker opens.
    // If the user opens a picker before Fuse loads, createSearchIndex returns null
    // and the picker's substring filter fallback handles it until next open.
    ensureFuse();
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

    // Determine allowed equip types from ship's equip_X field, honoring the retrofit
    // toggle — retrofits sometimes change a slot's allowed types and/or the ship type
    // (which feeds ship_type_forbidden filtering).
    let filteredEquips = [];
    if (ship) {
        const isRetrofit = slotConfig?.retrofit !== false && !!ship.retrofit;
        const allowedTypes = getSlotAllowedTypes(ship, equipIndex, isRetrofit);
        const effectiveType = getEffectiveShipType(ship, isRetrofit);

        if (allowedTypes.length > 0) {
            filteredEquips = getEquipsByAllowedTypes(allowedTypes, effectiveType);
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
        const isRetrofit = slotConfig?.retrofit !== false && !!ship.retrofit;
        spWeapons = getGenericSPWeapons(getEffectiveShipType(ship, isRetrofit));
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

    // Update modal title (Modal.astro shell renders it as #<id>-title)
    const header = document.getElementById('equipPickerModal-title');
    if (header) header.textContent = '특수 장비 선택';

    _renderEquipGrid();
    openModal('equipPickerModal');

    if (equipSearchInput) {
        requestAnimationFrame(() => equipSearchInput.focus());
    }
}

/**
 * Open the target (boss/preset) picker. Lists the 3 generic armor presets plus
 * all META bosses; selecting one fires callbacks.onTargetSelected.
 */
export function openBossPicker() {
    const presets = Object.entries(ARMOR_PRESETS).map(([key, p]) => ({
        _kind: 'preset', presetKey: key, name: p.name, sub: p.shipClass,
    }));
    const bosses = getAllMetaBosses().map((b) => ({
        _kind: 'meta', bossId: b.id, name: b.name, sub: 'META',
        tier: Array.isArray(b.tiers) && b.tiers.length ? b.tiers[b.tiers.length - 1].tier : null,
    }));
    currentBossList = [...presets, ...bosses];

    bossSearchIndex = currentBossList.length > 0
        ? createSearchIndex(currentBossList, { keys: ['name'], threshold: 0.3 })
        : null;

    bossFilters = { category: null, query: '' };
    if (bossSearchInput) bossSearchInput.value = '';

    _populateBossCategoryChips();
    _renderBossGrid();
    openModal('bossPickerModal');
    if (bossSearchInput) requestAnimationFrame(() => bossSearchInput.focus());
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

    bossSearchInput = document.getElementById('boss-picker-search');
    bossCategoryChips = document.getElementById('boss-category-filters');
    bossGrid = document.getElementById('boss-picker-grid');
}

// ===== Internal: Modal Setup =====

function _setupModals() {
    // Modal.astro shell: setupModal's defaults cover the .modal-close button
    // and .modal-backdrop clicks; ESC/backdrop close default to enabled.
    setupModal('shipPickerModal', { restoreFocus: true });
    setupModal('equipPickerModal', { restoreFocus: true });
    setupModal('bossPickerModal', { restoreFocus: true });
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

    // Boss search (debounced)
    if (bossSearchInput) {
        bossSearchInput.addEventListener('input', debounce(() => {
            bossFilters.query = bossSearchInput.value.trim();
            _renderBossGrid();
        }, 200));
    }

    // Boss category chips (일반 / META)
    if (bossCategoryChips) {
        bossCategoryChips.addEventListener('click', (e) => {
            const chip = e.target.closest('.filter-chip');
            if (!chip) return;
            const val = chip.dataset.category;
            bossFilters.category = bossFilters.category === val ? null : val;
            _updateChipStates(bossCategoryChips, bossFilters.category, 'category');
            _renderBossGrid();
        });
    }

    // Boss grid click → onTargetSelected
    if (bossGrid) {
        bossGrid.addEventListener('click', (e) => {
            const item = e.target.closest('.picker-item');
            if (!item) return;
            const kind = item.dataset.kind;
            if (kind === 'meta') {
                const bossId = Number(item.dataset.bossId);
                const tier = item.dataset.tier ? Number(item.dataset.tier) : null;
                callbacks?.onTargetSelected?.({ kind: 'meta', bossId, tier });
            } else {
                callbacks?.onTargetSelected?.({ kind: 'preset', presetKey: item.dataset.presetKey });
            }
            closeModal('bossPickerModal');
        });
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
                const header = document.getElementById('equipPickerModal-title');
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

            // Restore modal title
            const header = document.getElementById('equipPickerModal-title');
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
        btn.type = 'button';
        btn.setAttribute('aria-pressed', 'false');
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
        btn.type = 'button';
        btn.setAttribute('aria-pressed', 'false');
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
        btn.type = 'button';
        btn.setAttribute('aria-pressed', 'false');
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
        btn.type = 'button';
        btn.setAttribute('aria-pressed', 'false');
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
            chip.setAttribute('aria-pressed', 'true');
        } else {
            chip.classList.remove('active');
            chip.setAttribute('aria-pressed', 'false');
        }
    }
}

// ===== Internal: Ship Grid Rendering =====

function _renderShipGrid() {
    if (!shipGrid) return;

    let ships = currentShipList;

    // Apply search query
    if (shipFilters.query) {
        if (shipSearchIndex) {
            const results = shipSearchIndex.search(shipFilters.query);
            ships = results.map(r => r.item);
        } else {
            ships = _filterByQuery(ships, shipFilters.query);
        }
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
        _renderEmptyState(shipGrid, '검색 결과가 없습니다.');
        return;
    }

    const frag = document.createDocumentFragment();

    for (const ship of ships) {
        const button = document.createElement('button');
        const rarityLower = (ship.rarity || '').toLowerCase();

        button.className = 'picker-item';
        button.type = 'button';
        if (assignedGids.has(ship.gid)) {
            button.classList.add('assigned');
        }

        button.dataset.gid = ship.gid;
        button.dataset.rarity = rarityLower;

        const portraitUrl = getShipPortraitUrl(ship.skin_id);

        const img = document.createElement('img');
        img.className = 'picker-item-icon';
        img.src = portraitUrl;
        img.alt = ship.name || '';
        img.loading = 'lazy';
        img.dataset.fallback = IMG_FALLBACKS.DEFAULT;

        const name = document.createElement('span');
        name.className = 'picker-item-name';
        name.textContent = ship.name || '';

        button.append(img, name);
        frag.appendChild(button);
    }

    shipGrid.innerHTML = '';
    shipGrid.appendChild(frag);
}

// ===== Internal: Equip Grid Rendering =====

function _renderEquipGrid() {
    if (!equipGrid) return;

    let equips = currentEquipList;

    // Apply search query
    if (equipFilters.query) {
        if (equipSearchIndex) {
            const results = equipSearchIndex.search(equipFilters.query);
            equips = results.map(r => r.item);
        } else {
            equips = _filterByQuery(equips, equipFilters.query);
        }
    }

    // Apply rarity filter (stored as lowercase to match CSS data-rarity)
    if (equipFilters.rarity != null) {
        equips = equips.filter(e =>
            e.rarity_name && e.rarity_name.toLowerCase() === equipFilters.rarity
        );
    }

    const hasEquipped = _slotHasEquip(activeSlotIndex, activeEquipIndex);

    // Render
    if (equips.length === 0 && !hasEquipped) {
        _renderEmptyState(equipGrid, '검색 결과가 없습니다.');
        return;
    }

    const frag = document.createDocumentFragment();

    // Unequip option: show when the slot already has equipment
    if (hasEquipped) {
        const unequipDiv = document.createElement('button');
        unequipDiv.className = 'picker-item picker-item-unequip';
        unequipDiv.type = 'button';
        unequipDiv.dataset.unequip = '1';
        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined picker-unequip-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = 'remove_circle_outline';
        const label = document.createElement('span');
        label.className = 'picker-item-name';
        label.textContent = '장착 해제';
        unequipDiv.append(icon, label);
        frag.appendChild(unequipDiv);
    }

    for (const equip of equips) {
        const div = document.createElement('button');
        const rarityLower = (equip.rarity_name || '').toLowerCase();

        div.className = 'picker-item';
        div.type = 'button';
        div.dataset.equipId = equip.id;
        div.dataset.rarity = rarityLower;
        if (equip._isSPWeapon) div.dataset.spWeapon = '1';

        // Max enhance level = level_count - 1 (e.g., 14 levels → +13 max)
        const maxLevel = getMaxEnhanceLevel(equip);
        div.dataset.maxLevel = maxLevel;

        // SP weapons use different icon URL
        if (equip._isSPWeapon) {
            const iconUrl = getSPWeaponIconUrl(equip.icon);
            const spBgUrl = getRarityBgUrl(equip.rarity + 1);
            div.append(_createEquipIcon(spBgUrl, iconUrl, equip.name), _createPickerName(equip.name));
        } else {
            const iconUrl = getEquipIconUrl(equip.icon);
            const bgUrl = getRarityBgUrl(equip.rarity);
            div.append(_createEquipIcon(bgUrl, iconUrl, equip.name), _createPickerName(equip.name));
        }

        frag.appendChild(div);
    }

    equipGrid.innerHTML = '';
    equipGrid.appendChild(frag);
}

// ===== Internal: Boss/Target Grid Rendering =====

/** Populate the boss category chips (only categories present in the list). */
function _populateBossCategoryChips() {
    if (!bossCategoryChips) return;
    const cats = [];
    if (currentBossList.some((x) => x._kind === 'preset')) cats.push(['preset', '일반 프리셋']);
    if (currentBossList.some((x) => x._kind === 'meta')) cats.push(['meta', 'META 보스']);
    const frag = document.createDocumentFragment();
    for (const [val, label] of cats) {
        const btn = document.createElement('button');
        btn.className = 'filter-chip';
        btn.type = 'button';
        btn.setAttribute('aria-pressed', 'false');
        btn.dataset.category = val;
        btn.textContent = label;
        frag.appendChild(btn);
    }
    bossCategoryChips.innerHTML = '';
    bossCategoryChips.appendChild(frag);
}

/** Render the boss/preset picker grid with active search + category filters. */
function _renderBossGrid() {
    if (!bossGrid) return;

    let list = currentBossList;
    if (bossFilters.query) {
        list = bossSearchIndex
            ? bossSearchIndex.search(bossFilters.query).map((r) => r.item)
            : _filterByQuery(list, bossFilters.query);
    }
    if (bossFilters.category) list = list.filter((x) => x._kind === bossFilters.category);

    if (list.length === 0) {
        _renderEmptyState(bossGrid, '검색 결과가 없습니다.');
        return;
    }

    const activeBossId = state.damageTarget?.kind === 'meta' ? state.damageTarget.bossId : null;
    const activePreset = state.damageTarget?.kind !== 'meta' ? state.damageTarget?.presetKey : null;

    const frag = document.createDocumentFragment();
    for (const item of list) {
        const btn = document.createElement('button');
        btn.className = 'picker-item boss-picker-item';
        btn.type = 'button';
        btn.dataset.kind = item._kind;
        if (item._kind === 'meta') {
            btn.dataset.bossId = String(item.bossId);
            if (item.tier != null) btn.dataset.tier = String(item.tier);
            if (item.bossId === activeBossId) btn.classList.add('assigned');
        } else {
            btn.dataset.presetKey = item.presetKey;
            if (item.presetKey === activePreset) btn.classList.add('assigned');
        }
        const name = document.createElement('span');
        name.className = 'picker-item-name';
        name.textContent = item.name;
        const sub = document.createElement('span');
        sub.className = 'boss-picker-sub';
        sub.textContent = item.sub;
        btn.append(name, sub);
        frag.appendChild(btn);
    }
    bossGrid.innerHTML = '';
    bossGrid.appendChild(frag);
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

function _filterByQuery(items, query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter(item => String(item.name || '').toLowerCase().includes(normalized));
}

function _renderEmptyState(container, message) {
    // Picker containers are CSS grids — span all columns so the status stays centered.
    const status = renderStatus(container, message, 'empty', { compact: true });
    if (status) status.style.gridColumn = '1 / -1';
}

function _createPickerName(text) {
    const name = document.createElement('span');
    name.className = 'picker-item-name';
    name.textContent = text || '';
    return name;
}

function _createEquipIcon(bgUrl, iconUrl, altText) {
    const wrapper = document.createElement('div');
    wrapper.className = 'equip-icon-wrapper';

    const bg = document.createElement('img');
    bg.className = 'equip-icon-bg';
    bg.src = bgUrl;
    bg.alt = '';
    bg.loading = 'lazy';
    bg.dataset.fallback = IMG_FALLBACKS.DEFAULT;
    wrapper.appendChild(bg);

    if (iconUrl) {
        const fg = document.createElement('img');
        fg.className = 'equip-icon-fg';
        fg.src = iconUrl;
        fg.alt = altText || '';
        fg.loading = 'lazy';
        fg.dataset.fallback = IMG_FALLBACKS.DEFAULT;
        wrapper.appendChild(fg);
    }

    return wrapper;
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
