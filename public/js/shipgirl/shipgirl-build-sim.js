/**
 * shipgirl-build-sim.js
 * Construction gacha simulator: standard pools (light/medium/heavy), limited pickup banners,
 * and despair pools (custom 2-ship selections). Draws a canvas probability curve per ship.
 * Build stats (total pulls, rarity counts, resources spent) are persisted to localStorage.
 */

import { fetchJSON, fetchJSONWithCache, resolveUrl, getStorageItem, setStorageItem, createImgElement, createMaterialIcon, debounce, showToast, openModal, closeModal, DATA_FOR_TOY_BASE, RARITY_ORDER, RARITY_TIERS_DESC, sanitizeClassToken, onThemeChange, renderStatus } from '../utils.js';
import { buildPoolProbabilities, applyDespairUrPickup, regularShipSingleProb, cumulativeChance, formatPercent } from './build-sim.probability.js';
(function () {
    'use strict';

    // ===== State =====
    const state = {
        currentPool: 'pickup',
        poolData: {},
        originalPoolData: {}, // Store original for reset
        pickupData: null, // Loaded pickup pools
        shipDatabase: null, // Lazy loaded
        customShips: {}, // Added ships per pool: { '1': [{ship, pickupRate}], ... }
        selectedShip: null, // Currently selected ship in dropdown
        despairSelections: {}, // Selected ships for despair pools: { 'despair-1': [ship1, ship2], ... }
        modalState: {
            basePool: null,
            selectedShips: [],
            currentRarityTab: 'UR'
        },
        buildStats: {
            total: 0,
            UR: 0,
            SSR: 0,
            SR: 0,
            R: 0,
            N: 0,
            cubes: 0,
            money: 0
        },
        filters: {
            rarity: 'all',
            search: ''
        }
    };

    // ===== Constants =====

    // Despair Pool Pickup Rates
    const DESPAIR_PICKUP_RATES = {
        UR: 2.0,
        SSR: 2.0,
        SR: 2.5
    };

    const DEFAULT_SHIP_ICON = resolveUrl('assets/img/default-ship.webp');

    // Build Costs (per build)
    const BUILD_COSTS = {
        '1': { cubes: 1, money: 600 },           // Light
        '2': { cubes: 2, money: 1500 },          // Medium
        '3': { cubes: 2, money: 1500 },          // Heavy
        'pickup': { cubes: 2, money: 1500 },     // UR Limited
        'despair-1': { cubes: 1, money: 600 },   // Despair Light
        'despair-2': { cubes: 2, money: 1500 },  // Despair Medium
        'despair-3': { cubes: 2, money: 1500 }   // Despair Heavy
    };

    // Pool Probabilities (N is calculated as leftover)
    const POOL_PROBABILITIES_BASE = {
        '1': { // Light
            UR: 0,
            SSR: 7,
            SR: 12,
            R: 26
        },
        '2': { // Medium
            UR: 1.2,
            SSR: 7,
            SR: 12,
            R: 51
        },
        '3': { // Heavy
            UR: 1.2,
            SSR: 7,
            SR: 12,
            R: 51
        },
        'pickup': { // UR Limited Banner (will be calculated dynamically)
            UR: 1.2,
            SSR: 7,
            SR: 12,
            R: 51
        },
        'despair-1': { // Despair pools use same as their base
            UR: 0,
            SSR: 7,
            SR: 12,
            R: 26
        },
        'despair-2': {
            UR: 1.2,
            SSR: 7,
            SR: 12,
            R: 51
        },
        'despair-3': {
            UR: 1.2,
            SSR: 7,
            SR: 12,
            R: 51
        }
    };

    // N probability is derived as the remainder so all rarities always sum to 100%.
    const POOL_PROBABILITIES = buildPoolProbabilities(POOL_PROBABILITIES_BASE);

    // ===== Pool Probability & Cost Helpers =====

    /**
     * Return the probability table for a pool ID.
     * For named pickup pools (e.g. 'pickup-4'), falls back to the base pool's table.
     */
    function getPoolProbability(poolId) {
        // Check if already calculated
        if (POOL_PROBABILITIES[poolId]) {
            return POOL_PROBABILITIES[poolId];
        }

        // For pickup pools, get base pool probabilities
        if (poolId?.startsWith('pickup-')) {
            const pickupConfig = state.pickupData?.[poolId];
            if (pickupConfig) {
                const basePoolId = pickupConfig.basePool;
                return POOL_PROBABILITIES[basePoolId];
            }
        }

        // Default fallback
        return POOL_PROBABILITIES['3'];
    }

    // Get build cost dynamically (supports pickup pools)
    function getBuildCost(poolId) {
        // Check if already defined
        if (BUILD_COSTS[poolId]) {
            return BUILD_COSTS[poolId];
        }

        // For pickup pools, get base pool costs
        if (poolId?.startsWith('pickup-')) {
            const pickupConfig = state.pickupData?.[poolId];
            if (pickupConfig) {
                const basePoolId = pickupConfig.basePool;
                return BUILD_COSTS[basePoolId];
            }
        }

        // Default fallback to heavy
        return BUILD_COSTS['3'];
    }

    function showPageStatus(message) {
        const status = document.getElementById('build-sim-status');
        if (!status) return;
        status.textContent = message;
        status.hidden = false;
    }

    // Render a canonical status into a CSS-grid container, spanning all columns
    // so it stays centered (the grid otherwise places it in the first track).
    function renderGridStatus(container, message, type = 'empty') {
        const status = renderStatus(container, message, type, { compact: true });
        if (status) status.style.gridColumn = '1 / -1';
        return status;
    }

    // ===== Initialization =====

    // Cached DOM references for frequently-accessed elements
    let shipSelectEl = null;
    let probabilityGraphEl = null;

    async function init() {
        try {
            await loadData();
        } catch (error) {
            console.error('Failed to initialize build simulator:', error);
            showPageStatus('건조 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
            return;
        }

        renderPoolButtons(); // Render dynamic pool buttons after data is loaded

        // Cache frequently-accessed DOM elements
        shipSelectEl = document.getElementById('ship-select');
        probabilityGraphEl = document.getElementById('probability-graph');

        setupEventListeners();

        // Set default pool - use the first pickup pool if available
        const firstPickupPool = Object.keys(state.pickupData || {})[0] || 'pickup-4';
        state.currentPool = firstPickupPool;

        updateProbabilityChart();
        updateShipSelect();
        renderShipGrid();
        loadSavedStats();
    }

    // ===== Data Loading =====

    async function loadData() {
        // Load base pools
        const data = await fetchJSON('data/shipgirl/ship_build_sim_data.json');
        state.poolData = JSON.parse(JSON.stringify(data));
        state.originalPoolData = JSON.parse(JSON.stringify(data));

        // Load limited build shipgirls data
        const limitedBuildData = await fetchJSON('data/shipgirl/limited_build_shipgirls.json');
        state.pickupData = parsePickupDataFromLimitedBuilds(limitedBuildData);

        // Initialize custom ships for all pools including pickup and despair pools.
        state.customShips = { '1': [], '2': [], '3': [], 'despair-1': [], 'despair-2': [], 'despair-3': [] };
        Object.keys(state.pickupData).forEach(poolId => {
            state.customShips[poolId] = [];
        });

        // Initialize despair pools (empty until user selects ships)
        state.poolData['despair-1'] = {};
        state.poolData['despair-2'] = {};
        state.poolData['despair-3'] = {};
        state.originalPoolData['despair-1'] = {};
        state.originalPoolData['despair-2'] = {};
        state.originalPoolData['despair-3'] = {};

        // Build all pickup pools
        buildAllPickupPools();
    }

    // ===== Pool Construction =====

    /**
     * Convert the raw limited_build_shipgirls.json banner list into the internal pickupData map.
     * Each banner becomes a 'pickup-{buildId}' pool entry with per-ship pickup rates.
     */
    function parsePickupDataFromLimitedBuilds(limitedBuildData) {
        const pickupData = {};

        if (!limitedBuildData.banners) return pickupData;

        limitedBuildData.banners.forEach(banner => {
            const buildId = banner.build_id;
            const bannerType = banner.banner_type;
            const shipgirls = banner.shipgirls;

            // Use banner_type directly as the base pool
            const basePool = String(bannerType);

            // Parse shipgirls and extract pickup rates from rate_tip if needed
            const ships = {};
            Object.entries(shipgirls).forEach(([shipId, shipData]) => {
                // For now, use standard pickup rates based on rarity
                // UR: 1.2%, SSR: 2.0%, SR: 2.5%
                let pickupRate;
                if (shipData.rarity === 'UR') {
                    pickupRate = 1.2;
                } else if (shipData.rarity === 'SSR') {
                    pickupRate = 2.0;
                } else if (shipData.rarity === 'SR') {
                    pickupRate = 2.5;
                } else {
                    pickupRate = 2.0; // default
                }

                ships[shipData.name] = {
                    name: shipData.name,
                    rarity: shipData.rarity,
                    icon: shipData.icon,
                    pickupRate: pickupRate,
                    shipId: shipId
                };
            });

            if (Object.keys(ships).length > 0) {
                pickupData[`pickup-${buildId}`] = {
                    basePool: basePool,
                    poolId: buildId,
                    buildName: banner.build_name,
                    ships: ships
                };
            }
        });

        return pickupData;
    }

    // Build all pickup pools from parsed data
    function buildAllPickupPools() {
        if (!state.pickupData) return;

        Object.entries(state.pickupData).forEach(([pickupPoolId, poolConfig]) => {
            buildPickupPool(pickupPoolId, poolConfig.basePool, poolConfig.ships);
        });
    }

    /**
     * Merge a base pool with pickup ships:
     * URs replace all base URs; SSR/SR pickups mark existing ships or add them fresh.
     */
    function buildPickupPool(pickupPoolId, basePoolId, pickupShips) {
        if (!state.originalPoolData[basePoolId]) return;

        // Start with base pool
        state.poolData[pickupPoolId] = JSON.parse(JSON.stringify(state.originalPoolData[basePoolId]));
        state.originalPoolData[pickupPoolId] = JSON.parse(JSON.stringify(state.originalPoolData[basePoolId]));

        // Group pickup ships by rarity
        const pickupByRarity = {};
        Object.values(pickupShips).forEach(ship => {
            if (!pickupByRarity[ship.rarity]) {
                pickupByRarity[ship.rarity] = [];
            }
            pickupByRarity[ship.rarity].push(ship);
        });

        // Calculate probabilities
        Object.keys(pickupByRarity).forEach(rarity => {
            const rarityPickupShips = pickupByRarity[rarity];

            if (rarity === 'UR') {
                // UR: Pickup UR gets all the UR chance, remove all other URs
                const existingURs = Object.keys(state.poolData[pickupPoolId]).filter(id => {
                    const ship = state.poolData[pickupPoolId][id];
                    return ship.rarity === 'UR';
                });

                // Remove all existing URs from pool
                existingURs.forEach(id => {
                    delete state.poolData[pickupPoolId][id];
                });

                // Add pickup UR with full UR probability
                rarityPickupShips.forEach(ship => {
                    // Use shipId from the data if available, otherwise find by name
                    const shipId = ship.shipId || ship.name;
                    
                    state.poolData[pickupPoolId][shipId] = {
                        name: ship.name,
                        rarity: ship.rarity,
                        icon: ship.icon || DEFAULT_SHIP_ICON,
                        isPickup: true,
                        pickupRate: ship.pickupRate
                    };
                });
            } else {
                // SSR/SR: Add pickup ships with exact probability or mark existing as pickup
                rarityPickupShips.forEach(ship => {
                    // Try to find existing ship by name first
                    const foundShip = findShipInPoolByName(basePoolId, ship.name);
                    
                    if (foundShip) {
                        // Mark existing ship as pickup
                        state.poolData[pickupPoolId][foundShip.id].isPickup = true;
                        state.poolData[pickupPoolId][foundShip.id].pickupRate = ship.pickupRate;
                        // Update icon if provided in pickup data
                        if (ship.icon) {
                            state.poolData[pickupPoolId][foundShip.id].icon = ship.icon;
                        }
                    } else {
                        // Add new ship with provided data
                        const shipId = ship.shipId || ship.name;
                        state.poolData[pickupPoolId][shipId] = {
                            name: ship.name,
                            rarity: ship.rarity,
                            icon: ship.icon || DEFAULT_SHIP_ICON,
                            isPickup: true,
                            pickupRate: ship.pickupRate
                        };
                    }
                });
            }
        });
    }

    // Find ship in pool data by name
    function findShipInPoolByName(poolId, shipName) {
        if (!state.originalPoolData[poolId]) return null;
        
        for (const [id, ship] of Object.entries(state.originalPoolData[poolId])) {
            if (ship.name === shipName) {
                return { id, ...ship };
            }
        }
        return null;
    }

    // Render pool buttons dynamically
    function renderPoolButtons() {
        const poolSelector = document.querySelector('.pool-selector');
        poolSelector.replaceChildren();

        // Row 1: limited pickup banners first, then the standard pools.
        const primaryGroup = document.createElement('div');
        primaryGroup.className = 'pool-group';

        // Row 2: despair pools, kept on their own separate row.
        const despairGroup = document.createElement('div');
        despairGroup.className = 'pool-group';

        // Pickup pool buttons (dynamically from data) — shown first
        if (state.pickupData) {
            Object.entries(state.pickupData).forEach(([pickupPoolId, poolConfig]) => {
                const poolIdNumber = poolConfig.poolId;
                const btn = createPoolButton(pickupPoolId, '⭐', `한정 건조 #${poolIdNumber}`, false);
                primaryGroup.appendChild(btn);
            });
        }

        // Static pool buttons (standard) — after the pickup banners
        const staticPools = [
            { pool: '1', icon: '💧', name: '소형함 건조' },
            { pool: '2', icon: '⚓', name: '중형함 건조' },
            { pool: '3', icon: '🔱', name: '특형함 건조' }
        ];

        staticPools.forEach(({ pool, icon, name }) => {
            const btn = createPoolButton(pool, icon, name, false);
            primaryGroup.appendChild(btn);
        });

        // Despair pool buttons
        const despairPools = [
            { pool: 'despair-1', basePool: '1', icon: '⚡', name: '절망 건조 - 소형함' },
            { pool: 'despair-2', basePool: '2', icon: '⚡', name: '절망 건조 - 중형함' },
            { pool: 'despair-3', basePool: '3', icon: '⚡', name: '절망 건조 - 특형함' }
        ];

        despairPools.forEach(({ pool, basePool, icon, name }) => {
            const btn = createPoolButton(pool, icon, name, false, basePool);
            despairGroup.appendChild(btn);
        });

        // Append groups: primary row (limited + standard), then despair row
        poolSelector.appendChild(primaryGroup);
        poolSelector.appendChild(despairGroup);

        // Activate first pickup pool by default
        const firstPickupPool = Object.keys(state.pickupData || {})[0];
        if (firstPickupPool) {
            const firstBtn = poolSelector.querySelector(`[data-pool="${firstPickupPool}"]`);
            if (firstBtn) {
                firstBtn.classList.add('is-active');
                firstBtn.setAttribute('aria-pressed', 'true');
            }
        }
    }

    // Create a pool button element
    function createPoolButton(pool, icon, name, isPickup = false, basePool = null) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary pool-btn';
        btn.dataset.pool = pool;
        btn.setAttribute('aria-pressed', 'false');
        
        if (isPickup) btn.dataset.isPickup = 'true';
        if (basePool) btn.dataset.basePool = basePool;

        const iconEl = document.createElement('span');
        iconEl.className = 'pool-icon';
        iconEl.textContent = icon;

        const nameEl = document.createElement('span');
        nameEl.className = 'pool-name';
        nameEl.textContent = name;

        btn.append(iconEl, nameEl);

        return btn;
    }

    // ===== Despair Pool =====

    function openDespairModal(basePool, despairPoolId) {
        state.modalState.basePool = basePool;
        state.modalState.selectedShips = state.despairSelections[despairPoolId] || [];
        state.modalState.currentRarityTab = 'UR';

        // Show modal (openModal handles display + reference-counted body lock)
        openModal('despair-modal');

        // Reset rarity tabs
        document.querySelectorAll('.rarity-tab').forEach(tab => {
            const isActive = tab.dataset.rarity === 'UR';
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-pressed', String(isActive));
        });

        // Render ship grid
        renderModalShipGrid();
        updateModalSelectionStatus();
    }

    function closeDespairModal() {
        closeModal('despair-modal');
        state.modalState = {
            basePool: null,
            selectedShips: [],
            currentRarityTab: 'UR'
        };
    }

    function renderModalShipGrid() {
        const grid = document.getElementById('modal-ship-grid');
        const basePool = state.modalState.basePool;
        const currentRarity = state.modalState.currentRarityTab;

        if (!basePool || !state.originalPoolData[basePool]) {
            renderGridStatus(grid, '로딩 중...', 'loading');
            return;
        }

        // Get ships of current rarity from base pool
        const ships = Object.entries(state.originalPoolData[basePool])
            .filter(([id, ship]) => ship.rarity === currentRarity)
            .map(([id, ship]) => ({ id, ...ship }));

        if (ships.length === 0) {
            renderGridStatus(grid, `${currentRarity} 함순이가 없습니다.`);
            return;
        }

        const fragment = document.createDocumentFragment();
        ships.forEach(ship => {
            const isSelected = state.modalState.selectedShips.some(s => s.id === ship.id);

            const card = document.createElement('div');
            card.className = `modal-ship-card ${sanitizeClassToken(ship.rarity).toLowerCase()}`;
            if (isSelected) card.classList.add('selected');
            card.tabIndex = 0;
            card.setAttribute('role', 'button');
            card.setAttribute('aria-pressed', String(isSelected));

            const img = createImgElement(ship.icon || DEFAULT_SHIP_ICON, ship.name, {
                className: 'modal-ship-icon',
                fallback: DEFAULT_SHIP_ICON,
            });

            const name = document.createElement('div');
            name.className = 'modal-ship-name';
            name.textContent = ship.name;

            const rarity = document.createElement('div');
            rarity.className = `modal-ship-rarity ${sanitizeClassToken(ship.rarity).toLowerCase()}`;
            rarity.textContent = ship.rarity;

            card.append(img, name, rarity);

            if (isSelected) {
                const selected = document.createElement('div');
                selected.className = 'selected-check';
                selected.appendChild(createMaterialIcon('check_circle'));
                card.appendChild(selected);
            }

            card.addEventListener('click', () => toggleShipSelection(ship));
            card.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleShipSelection(ship);
                }
            });
            fragment.appendChild(card);
        });
        grid.replaceChildren(fragment);
    }

    function toggleShipSelection(ship) {
        const selectedShips = state.modalState.selectedShips;
        const index = selectedShips.findIndex(s => s.id === ship.id);

        if (index !== -1) {
            // Deselect
            selectedShips.splice(index, 1);
        } else {
            // Check constraints
            const urCount = selectedShips.filter(s => s.rarity === 'UR').length;
            const totalCount = selectedShips.length;

            // Max 2 ships total
            if (totalCount >= 2) {
                showToast('최대 2척까지만 선택할 수 있습니다.', 'info');
                return;
            }

            // Max 1 UR
            if (ship.rarity === 'UR' && urCount >= 1) {
                showToast('UR은 최대 1척까지만 선택할 수 있습니다.', 'info');
                return;
            }

            // Add ship
            selectedShips.push(ship);
        }

        renderModalShipGrid();
        updateModalSelectionStatus();
    }

    function updateModalSelectionStatus() {
        const selectedShips = state.modalState.selectedShips;
        const urCount = selectedShips.filter(s => s.rarity === 'UR').length;
        const totalCount = selectedShips.length;

        document.getElementById('selected-count').textContent = totalCount;
        document.getElementById('selected-ur-count').textContent = urCount;

        // Enable confirm button only if exactly 2 ships selected
        const confirmBtn = document.getElementById('modal-confirm');
        confirmBtn.disabled = totalCount !== 2;
    }

    function confirmDespairSelection() {
        const selectedShips = state.modalState.selectedShips;
        if (selectedShips.length !== 2) return;

        const despairPoolId = `despair-${state.modalState.basePool}`;

        // Save selection
        state.despairSelections[despairPoolId] = [...selectedShips];

        // Build despair pool
        buildDespairPool(despairPoolId, state.modalState.basePool, selectedShips);

        // Close modal and switch to despair pool
        closeDespairModal();
        state.currentPool = despairPoolId;

        // Update UI
        document.querySelectorAll('.pool-btn').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.pool === despairPoolId);
            btn.setAttribute('aria-pressed', String(btn.dataset.pool === despairPoolId));
        });

        updateProbabilityChart();
        updateShipSelect();
        updateShipProbability();
        renderShipGrid();
        renderAddedShips();
    }

    function buildDespairPool(despairPoolId, basePoolId, selectedShips) {
        if (!state.originalPoolData[basePoolId]) return;

        // Start with base pool
        state.poolData[despairPoolId] = JSON.parse(JSON.stringify(state.originalPoolData[basePoolId]));
        state.originalPoolData[despairPoolId] = JSON.parse(JSON.stringify(state.originalPoolData[basePoolId]));

        // Mark selected ships as pickup
        const hasUR = selectedShips.some(s => s.rarity === 'UR');

        selectedShips.forEach(ship => {
            const pickupRate = DESPAIR_PICKUP_RATES[ship.rarity];

            if (state.poolData[despairPoolId][ship.id]) {
                state.poolData[despairPoolId][ship.id].isPickup = true;
                state.poolData[despairPoolId][ship.id].pickupRate = pickupRate;
            }
        });

        // If UR is selected, remove all other URs
        if (hasUR) {
            const selectedURId = selectedShips.find(s => s.rarity === 'UR').id;
            Object.keys(state.poolData[despairPoolId]).forEach(id => {
                const ship = state.poolData[despairPoolId][id];
                if (ship.rarity === 'UR' && id !== selectedURId) {
                    delete state.poolData[despairPoolId][id];
                }
            });
        }
    }

    // ===== Event Listeners =====

    function setupEventListeners() {
        // Pool selection
        document.querySelectorAll('.pool-btn').forEach(btn => {
            btn.addEventListener('click', () => selectPool(btn.dataset.pool));
        });

        // Build buttons
        document.getElementById('build-one').addEventListener('click', () => performBuild(1));
        document.getElementById('build-ten').addEventListener('click', () => performBuild(10));
        document.getElementById('reset-stats').addEventListener('click', resetStats);

        // Ship select for probability
        shipSelectEl.addEventListener('change', updateShipProbability);

        // Filters
        document.querySelectorAll('.rarity-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                state.filters.rarity = btn.dataset.rarity;
                document.querySelectorAll('.rarity-filter').forEach(b => {
                    b.classList.remove('active');
                    b.setAttribute('aria-pressed', 'false');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-pressed', 'true');
                renderShipGrid();
            });
        });

        document.getElementById('ship-search').addEventListener('input', debounce((e) => {
            state.filters.search = e.target.value.toLowerCase();
            renderShipGrid();
        }, 150));

        // Ship adder controls
        const searchInput = document.getElementById('ship-search-input');
        const dropdown = document.getElementById('ship-dropdown');
        const addBtn = document.getElementById('add-ship-btn');
        const resetBtn = document.getElementById('reset-pool-btn');

        searchInput.addEventListener('focus', () => {
            if (!state.shipDatabase) {
                loadShipDatabase();
            }
        });

        searchInput.addEventListener('input', (e) => {
            filterShipDropdown(e.target.value);
        });

        searchInput.addEventListener('blur', () => {
            // Delay to allow click on dropdown
            setTimeout(() => dropdown.style.display = 'none', 200);
        });

        addBtn.addEventListener('click', addCustomShip);
        resetBtn.addEventListener('click', resetPool);

        // Pool section collapse
        const poolCollapseBtn = document.getElementById('pool-collapse-btn');
        const poolContent = document.getElementById('pool-content');
        const poolSectionHeader = document.getElementById('pool-section-header');

        poolSectionHeader.addEventListener('click', () => {
            const isCollapsed = poolContent.classList.toggle('collapsed');
            poolCollapseBtn.classList.toggle('collapsed', isCollapsed);
            poolCollapseBtn.setAttribute('aria-expanded', String(!isCollapsed));
            poolCollapseBtn.setAttribute('aria-label', isCollapsed ? '건조 목록 펼치기' : '건조 목록 접기');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });

        // Redraw graph on window resize
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (shipSelectEl.value) {
                    updateShipProbability();
                }
            }, 250);
        });

        // Graph colors are baked in at draw time — redraw on theme flip
        onThemeChange(() => {
            if (probabilityGraphEl && probabilityGraphEl.dataset.shipName) {
                renderGraph(probabilityGraphEl, null);
            }
        });

        // Despair Pool Modal
        const modal = document.getElementById('despair-modal');
        const modalClose = document.getElementById('modal-close');
        const modalCancel = document.getElementById('modal-cancel');
        const modalConfirm = document.getElementById('modal-confirm');

        modalClose.addEventListener('click', closeDespairModal);
        modalCancel.addEventListener('click', closeDespairModal);
        modalConfirm.addEventListener('click', confirmDespairSelection);

        // Rarity tabs in modal
        document.querySelectorAll('.rarity-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                state.modalState.currentRarityTab = tab.dataset.rarity;
                document.querySelectorAll('.rarity-tab').forEach(t => {
                    t.classList.remove('active');
                    t.setAttribute('aria-pressed', 'false');
                });
                tab.classList.add('active');
                tab.setAttribute('aria-pressed', 'true');
                renderModalShipGrid();
            });
        });

        // Close modal when clicking overlay
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeDespairModal();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.style.display !== 'none') {
                closeDespairModal();
            }
        });
    }

    // ===== Pool Selection & Probability Display =====

    function selectPool(poolId) {
        // If it's a despair pool, check if ships are selected
        if (poolId.startsWith('despair-')) {
            const hasSelection = state.despairSelections[poolId] &&
                state.despairSelections[poolId].length === 2;

            if (!hasSelection) {
                // Open modal for ship selection
                const basePool = poolId.split('-')[1]; // Extract '1', '2', or '3'
                openDespairModal(basePool, poolId);
                return;
            }
        }

        state.currentPool = poolId;

        // Update button states
        document.querySelectorAll('.pool-btn').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.pool === poolId);
            btn.setAttribute('aria-pressed', String(btn.dataset.pool === poolId));
        });

        updateProbabilityChart();
        updateShipSelect();
        updateShipProbability();
        renderShipGrid();
        renderAddedShips();
    }

    // Get effective probabilities for current pool (considering despair pool pickups)
    function getEffectiveProbabilities(poolId) {
        const baseProbs = getPoolProbability(poolId);

        // For despair pools, a hand-picked UR rises to the pickup rate (N absorbs the diff).
        if (poolId.startsWith('despair-') && state.despairSelections[poolId]) {
            const hasUR = state.despairSelections[poolId].some(s => s.rarity === 'UR');
            return applyDespairUrPickup(baseProbs, DESPAIR_PICKUP_RATES, hasUR);
        }

        return baseProbs;
    }

    // Update Probability Chart
    function updateProbabilityChart() {
        const probs = getEffectiveProbabilities(state.currentPool);
        const stackedBar = document.getElementById('stacked-probability-bar');
        const legend = document.getElementById('probability-legend');

        // Clear existing content
        stackedBar.replaceChildren();
        legend.replaceChildren();

        // Render stacked bar segments
        RARITY_TIERS_DESC.forEach(rarity => {
            const percentage = probs[rarity];

            if (percentage > 0) {
                const display = `${formatPercent(percentage)}%`;

                // Create segment — keep raw width for sub-pixel accuracy across segments
                const segment = document.createElement('div');
                segment.className = `stacked-segment ${rarity.toLowerCase()}`;
                segment.style.width = `${percentage}%`;
                const segmentLabel = document.createElement('span');
                segmentLabel.className = 'segment-label';
                segmentLabel.textContent = rarity;

                const segmentValue = document.createElement('span');
                segmentValue.className = 'segment-value';
                segmentValue.textContent = display;

                segment.append(segmentLabel, segmentValue);
                stackedBar.appendChild(segment);

                // Create legend item
                const legendItem = document.createElement('div');
                legendItem.className = 'legend-item-compact';
                const color = document.createElement('div');
                color.className = `legend-color ${rarity.toLowerCase()}`;

                const text = document.createElement('span');
                text.className = 'legend-text';
                text.textContent = rarity;

                const percent = document.createElement('span');
                percent.className = 'legend-percent';
                percent.textContent = display;

                legendItem.append(color, text, percent);
                legend.appendChild(legendItem);
            }
        });
    }

    // Update Ship Select Dropdown
    function updateShipSelect() {
        const select = shipSelectEl;
        const ships = state.poolData[state.currentPool] || {};

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '함순이를 선택하세요';
        select.replaceChildren(placeholder);

        // Group ships by rarity
        const groupedShips = {};
        Object.entries(ships).forEach(([id, ship]) => {
            if (!groupedShips[ship.rarity]) {
                groupedShips[ship.rarity] = [];
            }
            groupedShips[ship.rarity].push({ id, ...ship });
        });

        // Add options by rarity order
        RARITY_TIERS_DESC.forEach(rarity => {
            if (groupedShips[rarity]) {
                const optgroup = document.createElement('optgroup');
                optgroup.label = rarity;

                // Sort: pickup/custom ships first, then by name
                groupedShips[rarity]
                    .sort((a, b) => {
                        const aIsPickup = a.isPickup || a.isCustom;
                        const bIsPickup = b.isPickup || b.isCustom;

                        // Pickup ships first
                        if (aIsPickup && !bIsPickup) return -1;
                        if (!aIsPickup && bIsPickup) return 1;

                        // Then alphabetically
                        return a.name.localeCompare(b.name);
                    })
                    .forEach(ship => {
                        const option = document.createElement('option');
                        option.value = ship.id;
                        const pickupLabel = (ship.isPickup || ship.isCustom) ? ' ⭐' : '';
                        option.textContent = `${ship.name}${pickupLabel} (${ship.rarity})`;
                        optgroup.appendChild(option);
                    });

                select.appendChild(optgroup);
            }
        });
    }

    // Update Ship Probability
    function updateShipProbability() {
        const select = shipSelectEl;
        const shipId = select.value;

        if (!shipId) {
            document.getElementById('single-prob').textContent = '-';
            document.getElementById('ten-prob').textContent = '-';
            document.getElementById('hundred-prob').textContent = '-';
            document.getElementById('graph-container').style.display = 'none';
            return;
        }

        const ship = state.poolData[state.currentPool]?.[shipId];
        if (!ship) {
            select.value = '';
            updateShipProbability();
            return;
        }
        const rarityProb = getEffectiveProbabilities(state.currentPool)[ship.rarity] / 100;

        // Check if this ship is a pickup ship
        let singleProb;
        if (ship.isPickup && ship.pickupRate) {
            // Pickup ship has exact probability
            singleProb = ship.pickupRate;
        } else if (ship.isCustom && ship.pickupRate) {
            // Custom pickup ship has exact probability
            singleProb = ship.pickupRate;
        } else {
            // Count ships of same rarity
            const ships = state.poolData[state.currentPool];
            const sameRarityShips = Object.values(ships).filter(s => s.rarity === ship.rarity);

            // Calculate pickup rate total for this rarity
            const pickupTotal = sameRarityShips
                .filter(s => (s.isPickup || s.isCustom) && s.pickupRate)
                .reduce((sum, s) => sum + s.pickupRate, 0);

            // Remaining probability is distributed evenly among non-pickup ships
            const regularShipsCount = sameRarityShips.filter(s => !s.isPickup && !s.isCustom).length;
            singleProb = regularShipSingleProb(rarityProb * 100, pickupTotal, regularShipsCount);
        }

        // Probability of getting at least 1 in n tries: 1 - (1-p)^n
        const tenProb = cumulativeChance(singleProb, 10);
        const hundredProb = cumulativeChance(singleProb, 100);

        document.getElementById('single-prob').textContent = `${singleProb.toFixed(4)}%`;
        document.getElementById('ten-prob').textContent = `${tenProb.toFixed(2)}%`;
        document.getElementById('hundred-prob').textContent = `${hundredProb.toFixed(2)}%`;

        // Show and draw graph
        document.getElementById('graph-container').style.display = 'block';
        drawProbabilityGraph(singleProb / 100, ship.name);
    }

    // ===== Probability Graph =====

    /**
     * Set up cumulative probability data for the canvas chart (0–400 builds).
     * Stores metadata as data-* attributes so renderGraph() can be called on resize/theme change.
     */
    function drawProbabilityGraph(probability, shipName) {
        const canvas = probabilityGraphEl;
        const ctx = canvas.getContext('2d');

        // Set canvas size for high DPI
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;

        // Define chart area
        const padding = { top: 40, right: 40, bottom: 60, left: 60 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        // Calculate data points (0 to 400 builds)
        const maxBuilds = 400;
        const dataPoints = [];
        for (let n = 0; n <= maxBuilds; n++) {
            const cumulativeProb = (1 - Math.pow(1 - probability, n)) * 100;
            dataPoints.push({ x: n, y: cumulativeProb });
        }

        // Store data for interaction
        canvas.dataset.probability = probability;
        canvas.dataset.shipName = shipName;
        canvas.dataset.dataPoints = JSON.stringify(dataPoints);
        canvas.dataset.maxBuilds = maxBuilds;
        canvas.dataset.padding = JSON.stringify(padding);
        canvas.dataset.width = width;
        canvas.dataset.height = height;

        // Draw the graph
        renderGraph(canvas, null);

        // Setup interaction handlers
        setupGraphInteraction(canvas);
    }

    // Render the graph (can be called with optional highlight point)
    function renderGraph(canvas, highlightPoint) {
        if (!canvas?.dataset?.dataPoints) return;

        const ctx = canvas.getContext('2d');

        // Get stored data
        const dataPoints = JSON.parse(canvas.dataset.dataPoints);
        const maxBuilds = parseInt(canvas.dataset.maxBuilds);
        const padding = JSON.parse(canvas.dataset.padding);
        const width = parseFloat(canvas.dataset.width);
        const height = parseFloat(canvas.dataset.height);
        const shipName = canvas.dataset.shipName;

        // Ensure canvas bitmap size matches stored dimensions
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        // Use current rect dimensions for rendering
        const currentWidth = rect.width;
        const currentHeight = rect.height;

        const chartWidth = currentWidth - padding.left - padding.right;
        const chartHeight = currentHeight - padding.top - padding.bottom;

        // Clear canvas
        ctx.clearRect(0, 0, currentWidth, currentHeight);

        // Pull the palette from theme.css (resolved via getComputedStyle) so the
        // canvas tracks light/dark and the global tokens like the rest of the page.
        const isDark = document.body.classList.contains('dark-mode');
        const css = getComputedStyle(document.body);
        const readVar = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
        const textColor = readVar('--text-primary', '#2a2a2a');
        const gridColor = readVar('--border-color', '#d4d4d4');
        const gridColorLight = isDark
            ? readVar('--highlight-soft', 'rgba(255, 255, 255, 0.1)')
            : readVar('--overlay-light', 'rgba(0, 0, 0, 0.1)');
        const lineColor = readVar('--accent-blue', '#0071eb');
        const highlightColor = readVar('--rarity-ur', '#e91e8c');

        // Draw minor grid lines (every 10%)
        ctx.strokeStyle = gridColorLight;
        ctx.lineWidth = 0.5;
        for (let i = 1; i < 10; i++) {
            if (i % 2 === 0) continue; // Skip major grid lines
            const y = padding.top + chartHeight - (i * chartHeight / 10);
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();
        }

        // Draw minor grid lines (every 25 builds)
        for (let i = 1; i < 16; i++) {
            if (i % 2 === 0) continue; // Skip major grid lines
            const x = padding.left + (i * chartWidth / 16);
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, padding.top + chartHeight);
            ctx.stroke();
        }

        // Draw major grid and axes
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = textColor;

        // Y-axis grid lines (0% to 100%, every 20%)
        for (let i = 0; i <= 5; i++) {
            const y = padding.top + chartHeight - (i * chartHeight / 5);

            // Grid line
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();

            // Label
            const label = `${i * 20}%`;
            ctx.fillText(label, padding.left - 40, y + 4);
        }

        // X-axis grid lines (every 50 builds)
        for (let i = 0; i <= 8; i++) {
            const x = padding.left + (i * chartWidth / 8);

            // Grid line
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, padding.top + chartHeight);
            ctx.stroke();

            // Label
            const label = `${i * 50}`;
            const textWidth = ctx.measureText(label).width;
            ctx.fillText(label, x - textWidth / 2, padding.top + chartHeight + 20);
        }

        // Draw axes
        ctx.strokeStyle = textColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top);
        ctx.lineTo(padding.left, padding.top + chartHeight);
        ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
        ctx.stroke();

        // Axis labels
        ctx.fillStyle = textColor;
        ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

        // X-axis label
        const xLabel = '건조 횟수';
        const xLabelWidth = ctx.measureText(xLabel).width;
        ctx.fillText(xLabel, padding.left + chartWidth / 2 - xLabelWidth / 2, currentHeight - 20);

        // Y-axis label
        ctx.save();
        ctx.translate(20, padding.top + chartHeight / 2);
        ctx.rotate(-Math.PI / 2);
        const yLabel = '획득 확률 (%)';
        const yLabelWidth = ctx.measureText(yLabel).width;
        ctx.fillText(yLabel, -yLabelWidth / 2, 0);
        ctx.restore();

        // Draw probability curve
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 3;
        ctx.beginPath();

        dataPoints.forEach((point, index) => {
            const x = padding.left + (point.x / maxBuilds) * chartWidth;
            const y = padding.top + chartHeight - (point.y / 100) * chartHeight;

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();

        // Add gradient fill under the curve
        ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
        ctx.lineTo(padding.left, padding.top + chartHeight);
        ctx.closePath();

        const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
        gradient.addColorStop(0, readVar('--primary-alpha-30', 'rgba(0, 113, 235, 0.3)'));
        gradient.addColorStop(1, readVar('--primary-alpha-10', 'rgba(0, 113, 235, 0.1)'));
        ctx.fillStyle = gradient;
        ctx.fill();

        // Draw notable points (50%, 75%, 90%)
        const notableProbs = [50, 75, 90];
        ctx.fillStyle = lineColor;
        ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

        notableProbs.forEach(targetProb => {
            // Find the build count for this probability
            const point = dataPoints.find(p => p.y >= targetProb);
            if (point) {
                const x = padding.left + (point.x / maxBuilds) * chartWidth;
                const y = padding.top + chartHeight - (point.y / 100) * chartHeight;

                // Draw point
                ctx.beginPath();
                ctx.arc(x, y, 5, 0, Math.PI * 2);
                ctx.fill();

                // Draw label
                ctx.fillStyle = textColor;
                ctx.fillText(`${targetProb}% (${point.x}회)`, x + 10, y - 5);
                ctx.fillStyle = lineColor;
            }
        });

        // Title
        ctx.fillStyle = textColor;
        ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const title = `${shipName} 획득 확률`;
        const titleWidth = ctx.measureText(title).width;
        ctx.fillText(title, padding.left + chartWidth / 2 - titleWidth / 2, 25);

        // Draw highlight if provided
        if (highlightPoint) {
            const x = padding.left + (highlightPoint.x / maxBuilds) * chartWidth;
            const y = padding.top + chartHeight - (highlightPoint.y / 100) * chartHeight;

            // Draw crosshair lines
            ctx.strokeStyle = highlightColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);

            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, padding.top + chartHeight);
            ctx.stroke();

            ctx.setLineDash([]);

            // Draw highlight point
            ctx.fillStyle = highlightColor;
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // Setup Graph Interaction (Tooltip on hover/touch)
    function setupGraphInteraction(canvas) {
        if (!canvas?.parentNode) return;

        // Remove existing listeners by cloning
        const newCanvas = canvas.cloneNode(true);
        canvas.parentNode.replaceChild(newCanvas, canvas);
        canvas = newCanvas;
        probabilityGraphEl = newCanvas;

        // Create tooltip element if it doesn't exist
        let tooltip = document.getElementById('graph-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'graph-tooltip';
            tooltip.className = 'graph-tooltip';
            document.body.appendChild(tooltip);
        }

        const showTooltip = (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Get stored data
            const dataPoints = JSON.parse(canvas.dataset.dataPoints);
            const maxBuilds = parseInt(canvas.dataset.maxBuilds);
            const padding = JSON.parse(canvas.dataset.padding);
            const width = parseFloat(canvas.dataset.width);
            const height = parseFloat(canvas.dataset.height);
            const shipName = canvas.dataset.shipName;

            const chartWidth = width - padding.left - padding.right;
            const chartHeight = height - padding.top - padding.bottom;

            // Check if mouse is within chart area
            if (x < padding.left || x > padding.left + chartWidth ||
                y < padding.top || y > padding.top + chartHeight) {
                tooltip.style.display = 'none';
                renderGraph(canvas, null);
                return;
            }

            // Calculate build number from x position
            const buildNumber = Math.round(((x - padding.left) / chartWidth) * maxBuilds);
            const dataPoint = dataPoints[buildNumber];

            if (dataPoint) {
                // Show tooltip
                tooltip.style.display = 'block';
                tooltip.replaceChildren(
                    createTooltipLine('tooltip-ship', shipName),
                    createTooltipLine('tooltip-builds', '건조 횟수: ', `${dataPoint.x}회`),
                    createTooltipLine('tooltip-prob', '획득 확률: ', `${dataPoint.y.toFixed(2)}%`)
                );

                // Position tooltip
                const tooltipRect = tooltip.getBoundingClientRect();
                let tooltipX = e.clientX + 15;
                let tooltipY = e.clientY - tooltipRect.height / 2;

                // Keep tooltip in viewport
                if (tooltipX + tooltipRect.width > window.innerWidth) {
                    tooltipX = e.clientX - tooltipRect.width - 15;
                }
                if (tooltipY < 0) {
                    tooltipY = 5;
                }
                if (tooltipY + tooltipRect.height > window.innerHeight) {
                    tooltipY = window.innerHeight - tooltipRect.height - 5;
                }

                tooltip.style.left = `${tooltipX}px`;
                tooltip.style.top = `${tooltipY}px`;

                // Redraw canvas with highlight
                renderGraph(canvas, dataPoint);
            }
        };

        const hideTooltip = () => {
            tooltip.style.display = 'none';
            renderGraph(canvas, null);
        };

        // Mouse events
        canvas.addEventListener('mousemove', showTooltip);
        canvas.addEventListener('mouseleave', hideTooltip);

        // Touch events
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            showTooltip(e.touches[0]);
        });
        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            showTooltip(e.touches[0]);
        });
        canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            hideTooltip();
        });

        // Set cursor
        canvas.style.cursor = 'crosshair';

        // Render the graph initially (after canvas was cloned)
        renderGraph(canvas, null);
    }

    function createTooltipLine(className, label, value = '') {
        const line = document.createElement('div');
        line.className = className;

        if (!value) {
            line.textContent = label;
            return line;
        }

        line.appendChild(document.createTextNode(label));
        const strong = document.createElement('strong');
        strong.textContent = value;
        line.appendChild(strong);
        return line;
    }

    // ===== Ship Database & Custom Pool =====

    async function loadShipDatabase() {
        if (state.shipDatabase) return;

        const searchInput = document.getElementById('ship-search-input');
        searchInput.placeholder = '데이터 로딩 중...';
        searchInput.disabled = true;

        try {
            const fullData = await fetchJSONWithCache('data/ship_info_data.json');

            // Extract only what we need
            state.shipDatabase = fullData
                .filter(ship => ship.name && ship.sid && ship.rarity)
                .map(ship => ({
                    sid: ship.sid.toString(),
                    name: ship.name,
                    rarity: ship.rarity,
                    icon: ship.shipyard || `${DATA_FOR_TOY_BASE}/skin_icon/${ship.sid}.webp`
                }));

            console.log(`Loaded ${state.shipDatabase.length} ships from database`);
            searchInput.placeholder = '함순이 이름 검색...';
            searchInput.disabled = false;
        } catch (error) {
            console.error('Failed to load ship database:', error);
            searchInput.placeholder = '로딩 실패';
            searchInput.disabled = false;
        }
    }

    // Filter and show dropdown
    function filterShipDropdown(query) {
        const dropdown = document.getElementById('ship-dropdown');

        if (!state.shipDatabase || !query.trim()) {
            dropdown.style.display = 'none';
            return;
        }

        const normalizedQuery = query.toLowerCase().trim();
        const filtered = state.shipDatabase
            .filter(ship => ship.name.toLowerCase().includes(normalizedQuery))
            .slice(0, 50); // Limit to 50 results

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ship-option ship-option-empty';
            empty.setAttribute('role', 'status');
            empty.textContent = '검색 결과 없음';
            dropdown.replaceChildren(empty);
            dropdown.style.display = 'block';
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const ship of filtered) {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'ship-option';
            option.dataset.sid = ship.sid;

            const img = createImgElement(ship.icon || DEFAULT_SHIP_ICON, ship.name, {
                className: 'ship-option-icon',
                fallback: DEFAULT_SHIP_ICON,
            });

            const info = document.createElement('div');
            info.className = 'ship-option-info';

            const name = document.createElement('div');
            name.className = 'ship-option-name';
            name.textContent = ship.name;

            const id = document.createElement('div');
            id.className = 'ship-option-id';
            id.textContent = `ID: ${ship.sid}`;

            info.append(name, id);

            const rarity = document.createElement('span');
            rarity.className = `ship-option-rarity ${sanitizeClassToken(ship.rarity).toLowerCase()}`;
            rarity.textContent = ship.rarity;

            option.append(img, info, rarity);
            option.addEventListener('click', () => selectShipFromDropdown(ship));
            fragment.appendChild(option);
        }

        dropdown.replaceChildren(fragment);
        dropdown.style.display = 'block';
    }

    // Select ship from dropdown
    function selectShipFromDropdown(ship) {
        if (!ship) return;

        state.selectedShip = ship;
        const searchInput = document.getElementById('ship-search-input');
        searchInput.value = ship.name;
        document.getElementById('ship-dropdown').style.display = 'none';
        document.getElementById('add-ship-btn').disabled = false;
    }

    // Add custom ship to current pool
    function addCustomShip() {
        if (!state.selectedShip) return;

        const pickupRate = parseFloat(document.getElementById('pickup-rate').value);
        if (isNaN(pickupRate) || pickupRate <= 0 || pickupRate > 100) {
            showToast('픽업 확률을 0 초과 100 이하의 값으로 입력해주세요.', 'error');
            return;
        }

        const ship = state.selectedShip;
        const poolId = state.currentPool;
        if (!state.customShips[poolId]) {
            state.customShips[poolId] = [];
        }

        // Check if ship already exists in pool
        const existsInOriginal = state.originalPoolData[poolId]?.[ship.sid];
        const existsInCustom = state.customShips[poolId].find(s => s.ship.sid === ship.sid);

        if (existsInOriginal || existsInCustom) {
            showToast('이 함순이는 이미 현재 풀에 존재합니다.', 'info');
            return;
        }

        // Add to custom ships
        state.customShips[poolId].push({
            ship: ship,
            pickupRate: pickupRate
        });

        // Recalculate pool with pickup rates
        recalculatePoolProbabilities();

        // Update UI
        renderAddedShips();
        updateProbabilityChart();
        updateShipSelect();
        updateShipProbability();
        renderShipGrid();

        // Reset search
        document.getElementById('ship-search-input').value = '';
        document.getElementById('add-ship-btn').disabled = true;
        state.selectedShip = null;
    }

    // Recalculate pool probabilities with pickup rates
    function recalculatePoolProbabilities() {
        const poolId = state.currentPool;

        // Start with original pool
        state.poolData[poolId] = JSON.parse(JSON.stringify(state.originalPoolData[poolId] || {}));

        // Get custom ships for this pool
        const customShips = state.customShips[poolId] || [];
        if (customShips.length === 0) return;

        // Group custom ships by rarity
        const customByRarity = {};
        customShips.forEach(({ ship, pickupRate }) => {
            if (!customByRarity[ship.rarity]) {
                customByRarity[ship.rarity] = [];
            }
            customByRarity[ship.rarity].push({ ship, pickupRate });
        });

        // For each rarity with custom ships
        Object.keys(customByRarity).forEach(rarity => {
            const rarityCustomShips = customByRarity[rarity];
            const totalPickupRate = rarityCustomShips.reduce((sum, s) => sum + s.pickupRate, 0);

            // Get base rarity probability
            const baseRarityProb = getPoolProbability(poolId)[rarity];

            if (totalPickupRate >= baseRarityProb) {
                showToast(`${rarity} 등급의 픽업 확률 합계(${totalPickupRate}%)가 해당 등급 전체 확률(${baseRarityProb}%)을 초과합니다. 다른 함순이의 확률이 0이 됩니다.`, 'error', 5000);
            }

            // Add custom ships to pool
            rarityCustomShips.forEach(({ ship, pickupRate }) => {
                state.poolData[poolId][ship.sid] = {
                    name: ship.name,
                    rarity: ship.rarity,
                    icon: ship.icon,
                    isCustom: true,
                    pickupRate: pickupRate
                };
            });
        });
    }

    // Render added ships tags
    function renderAddedShips() {
        const container = document.getElementById('added-ships-list');
        const customShips = state.customShips[state.currentPool] || [];

        if (customShips.length === 0) {
            container.replaceChildren();
            return;
        }

        const fragment = document.createDocumentFragment();
        customShips.forEach((item, index) => {
            const tag = document.createElement('div');
            tag.className = 'added-ship-tag pickup';

            const img = createImgElement(item.ship.icon || DEFAULT_SHIP_ICON, item.ship.name, {
                className: 'added-ship-tag-icon',
                fallback: DEFAULT_SHIP_ICON,
            });

            const info = document.createElement('div');
            info.className = 'added-ship-tag-info';

            const name = document.createElement('div');
            name.className = 'added-ship-tag-name';
            name.textContent = item.ship.name;

            const rate = document.createElement('div');
            rate.className = 'added-ship-tag-rate';
            rate.textContent = `픽업: ${item.pickupRate}%`;

            info.append(name, rate);

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'added-ship-tag-remove';
            remove.dataset.index = String(index);
            remove.setAttribute('aria-label', `${item.ship.name} 제거`);

            remove.appendChild(createMaterialIcon('close'));
            remove.addEventListener('click', () => removeCustomShip(index));

            tag.append(img, info, remove);
            fragment.appendChild(tag);
        });

        container.replaceChildren(fragment);
    }

    // Remove custom ship
    function removeCustomShip(index) {
        if (!state.customShips[state.currentPool]) return;
        state.customShips[state.currentPool].splice(index, 1);
        recalculatePoolProbabilities();
        renderAddedShips();
        updateProbabilityChart();
        updateShipSelect();
        updateShipProbability();
        renderShipGrid();
    }

    // Reset pool to original
    function resetPool() {
        if (!confirm('현재 풀을 초기 상태로 되돌리시겠습니까? 추가한 모든 픽업 함순이가 제거됩니다.')) {
            return;
        }

        state.customShips[state.currentPool] = [];
        state.poolData[state.currentPool] = JSON.parse(JSON.stringify(state.originalPoolData[state.currentPool] || {}));

        renderAddedShips();
        updateShipSelect();
        updateShipProbability();
        renderShipGrid();
        updateProbabilityChart();
    }

    // ===== Build Simulation =====

    function performBuild(count) {
        const resultsContainer = document.getElementById('build-results');

        // Remove placeholder
        const placeholder = resultsContainer.querySelector('.placeholder');
        if (placeholder) {
            placeholder.remove();
        }

        // Clear previous results
        resultsContainer.replaceChildren();

        // Calculate resource costs
        const cost = getBuildCost(state.currentPool);
        const totalCubes = cost.cubes * count;
        const totalMoney = cost.money * count;

        // Update resource stats
        state.buildStats.cubes += totalCubes;
        state.buildStats.money += totalMoney;

        const results = [];
        for (let i = 0; i < count; i++) {
            const ship = rollShip();
            results.push(ship);
        }

        // Animate results appearing
        results.forEach((ship, index) => {
            setTimeout(() => {
                renderShipCard(ship, resultsContainer);
                updateBuildStats(ship.rarity);
            }, index * 100);
        });

    }

    /**
     * Roll one ship result from the current pool.
     * First determines rarity from cumulative probabilities, then selects a ship within that rarity,
     * respecting pickup/custom ship rates before distributing the remainder uniformly.
     */
    function rollShip() {
        const probs = getEffectiveProbabilities(state.currentPool);
        const ships = state.poolData[state.currentPool];

        // Determine rarity
        const rand = Math.random() * 100;
        let cumulative = 0;
        let selectedRarity = 'N';

        for (const rarity of RARITY_TIERS_DESC) {
            cumulative += probs[rarity];
            if (rand <= cumulative) {
                selectedRarity = rarity;
                break;
            }
        }

        // Get all ships of selected rarity
        const rarityShips = Object.entries(ships).filter(([id, ship]) => ship.rarity === selectedRarity);
        if (rarityShips.length === 0) {
            const fallback = Object.entries(ships)[0];
            return fallback ? { id: fallback[0], ...fallback[1] } : {
                id: 'unknown',
                name: '알 수 없음',
                rarity: 'N',
                icon: DEFAULT_SHIP_ICON
            };
        }

        // Check if there are pickup ships in this rarity
        const pickupShips = rarityShips.filter(([id, ship]) => ship.isPickup && ship.pickupRate);
        const customShips = rarityShips.filter(([id, ship]) => ship.isCustom && ship.pickupRate);
        const regularShips = rarityShips.filter(([id, ship]) => !ship.isPickup && !ship.isCustom);

        // Handle pickup pool (UR limited banner) OR despair pool
        if ((state.currentPool === 'pickup' || state.currentPool.startsWith('pickup-') || state.currentPool.startsWith('despair-')) && pickupShips.length > 0) {
            if (selectedRarity === 'UR') {
                // UR: Only pickup UR exists (all others removed)
                const [id, ship] = pickupShips[0];
                return { id, ...ship };
            } else {
                // SSR/SR: Roll for pickup first, then regular
                const totalPickupRate = pickupShips.reduce((sum, [id, ship]) => sum + ship.pickupRate, 0);
                const baseRarityProb = probs[selectedRarity];
                const rarityRand = Math.random() * baseRarityProb;
                let rarityCumulative = 0;

                // Check pickup ships first
                for (const [id, ship] of pickupShips) {
                    rarityCumulative += ship.pickupRate;
                    if (rarityRand <= rarityCumulative) {
                        return { id, ...ship };
                    }
                }

                // Not pickup, select from regular ships (reduced pool)
                if (regularShips.length > 0) {
                    const randomIndex = Math.floor(Math.random() * regularShips.length);
                    const [id, ship] = regularShips[randomIndex];
                    return { id, ...ship };
                }
            }
        }

        // Handle custom ships (manually added)
        if (customShips.length > 0) {
            const totalPickupRate = customShips.reduce((sum, [id, ship]) => sum + ship.pickupRate, 0);
            const baseRarityProb = probs[selectedRarity];
            const rarityRand = Math.random() * baseRarityProb;
            let rarityCumulative = 0;

            // Check pickup ships first
            for (const [id, ship] of customShips) {
                rarityCumulative += ship.pickupRate;
                if (rarityRand <= rarityCumulative) {
                    return { id, ...ship };
                }
            }

            // If not pickup, select from regular ships
            if (regularShips.length > 0) {
                const randomIndex = Math.floor(Math.random() * regularShips.length);
                const [id, ship] = regularShips[randomIndex];
                return { id, ...ship };
            }
        }

        // No pickup ships, use uniform distribution
        const randomIndex = Math.floor(Math.random() * rarityShips.length);
        const [id, ship] = rarityShips[randomIndex];

        return { id, ...ship };
    }

    // Render Ship Card
    function renderShipCard(ship, container) {
        const card = document.createElement('div');
        const isPickupOrCustom = ship.isPickup || ship.isCustom;
        card.className = `ship-card ${sanitizeClassToken(ship.rarity).toLowerCase()} ${isPickupOrCustom ? 'custom-ship' : ''}`;

        if ((ship.isPickup || ship.isCustom) && ship.pickupRate) {
            const pickupBadge = document.createElement('div');
            pickupBadge.className = 'pickup-badge badge badge--warning';
            pickupBadge.textContent = `픽업 ${ship.pickupRate}%`;
            card.appendChild(pickupBadge);
        }

        const img = createImgElement(ship.icon || DEFAULT_SHIP_ICON, ship.name, {
            className: 'ship-card-icon',
            fallback: DEFAULT_SHIP_ICON,
        });

        const name = document.createElement('div');
        name.className = 'ship-card-name';
        name.textContent = ship.name;

        const rarity = document.createElement('div');
        rarity.className = `ship-card-rarity ${sanitizeClassToken(ship.rarity).toLowerCase()}`;
        rarity.textContent = ship.rarity;

        card.append(img, name, rarity);

        container.appendChild(card);
    }

    // Update Build Statistics
    function updateBuildStats(rarity) {
        state.buildStats.total++;
        state.buildStats[rarity]++;

        document.getElementById('stat-total').textContent = state.buildStats.total;
        document.getElementById('stat-ur').textContent = state.buildStats.UR;
        document.getElementById('stat-ssr').textContent = state.buildStats.SSR;
        document.getElementById('stat-sr').textContent = state.buildStats.SR;
        document.getElementById('stat-r').textContent = state.buildStats.R;
        document.getElementById('stat-n').textContent = state.buildStats.N;
        document.getElementById('stat-cubes').textContent = state.buildStats.cubes.toLocaleString();
        document.getElementById('stat-money').textContent = state.buildStats.money.toLocaleString();
        saveStats();
    }

    // Reset Statistics
    function resetStats() {
        if (!confirm('건조 통계를 초기화하시겠습니까?')) {
            return;
        }

        state.buildStats = {
            total: 0,
            UR: 0,
            SSR: 0,
            SR: 0,
            R: 0,
            N: 0,
            cubes: 0,
            money: 0
        };

        document.getElementById('stat-total').textContent = '0';
        document.getElementById('stat-ur').textContent = '0';
        document.getElementById('stat-ssr').textContent = '0';
        document.getElementById('stat-sr').textContent = '0';
        document.getElementById('stat-r').textContent = '0';
        document.getElementById('stat-n').textContent = '0';
        document.getElementById('stat-cubes').textContent = '0';
        document.getElementById('stat-money').textContent = '0';

        const resultsContainer = document.getElementById('build-results');
        const placeholder = document.createElement('div');
        placeholder.className = 'placeholder';
        placeholder.textContent = '건조 버튼을 눌러 시작하세요';
        resultsContainer.replaceChildren(placeholder);

        saveStats();
    }

    // ===== Ship Grid & Stats Display =====

    function renderShipGrid() {
        const grid = document.getElementById('ship-grid');
        const ships = state.poolData[state.currentPool] || {};

        grid.replaceChildren();

        let filteredShips = Object.entries(ships);

        // Apply rarity filter
        if (state.filters.rarity !== 'all') {
            filteredShips = filteredShips.filter(([id, ship]) => ship.rarity === state.filters.rarity);
        }

        // Apply search filter
        if (state.filters.search) {
            filteredShips = filteredShips.filter(([id, ship]) =>
                ship.name.toLowerCase().includes(state.filters.search)
            );
        }

        // Sort by rarity then name
        filteredShips.sort((a, b) => {
            const rarityDiff = RARITY_ORDER[a[1].rarity] - RARITY_ORDER[b[1].rarity];
            if (rarityDiff !== 0) return rarityDiff;
            return a[1].name.localeCompare(b[1].name);
        });

        // Render ships
        if (filteredShips.length === 0) {
            renderGridStatus(grid, '조건에 맞는 함순이가 없습니다.');
        } else {
            filteredShips.forEach(([id, ship]) => {
                renderShipCard({ id, ...ship }, grid);
            });
        }

        // Update count
        document.getElementById('ship-count').textContent = filteredShips.length;
    }

    // Save Statistics to LocalStorage
    function saveStats() {
        try {
            setStorageItem('buildSimulatorStats', JSON.stringify(state.buildStats));
        } catch (error) {
            console.error('Failed to save stats:', error);
        }
    }

    // Load Statistics from LocalStorage
    function loadSavedStats() {
        try {
            const saved = getStorageItem('buildSimulatorStats', null);
            if (saved) {
                const savedStats = JSON.parse(saved);

                // Merge with defaults to handle new fields
                state.buildStats = {
                    total: 0,
                    UR: 0,
                    SSR: 0,
                    SR: 0,
                    R: 0,
                    N: 0,
                    cubes: 0,
                    money: 0,
                    ...savedStats
                };

                document.getElementById('stat-total').textContent = state.buildStats.total;
                document.getElementById('stat-ur').textContent = state.buildStats.UR;
                document.getElementById('stat-ssr').textContent = state.buildStats.SSR;
                document.getElementById('stat-sr').textContent = state.buildStats.SR;
                document.getElementById('stat-r').textContent = state.buildStats.R;
                document.getElementById('stat-n').textContent = state.buildStats.N;
                document.getElementById('stat-cubes').textContent = state.buildStats.cubes.toLocaleString();
                document.getElementById('stat-money').textContent = state.buildStats.money.toLocaleString();
            }
        } catch (error) {
            console.error('Failed to load stats:', error);
        }
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
