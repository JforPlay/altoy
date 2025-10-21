// Build Simulator Script
(function() {
    'use strict';

    // State Management
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

    // Despair Pool Pickup Rates
    const DESPAIR_PICKUP_RATES = {
        UR: 2.0,
        SSR: 2.0,
        SR: 2.5
    };

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

    // Calculate full probabilities with N as leftover
    const POOL_PROBABILITIES = {};
    Object.keys(POOL_PROBABILITIES_BASE).forEach(poolId => {
        const baseProbs = POOL_PROBABILITIES_BASE[poolId];
        const total = Object.values(baseProbs).reduce((sum, val) => sum + val, 0);
        const nProb = Math.max(0, 100 - total); // Ensure non-negative

        POOL_PROBABILITIES[poolId] = {
            ...baseProbs,
            N: nProb
        };
    });

    // Initialize
    async function init() {
        await loadData();
        setupEventListeners();
        updateProbabilityChart();
        updateShipSelect();
        renderShipGrid();
        loadSavedStats();
    }

    // Load Data
    async function loadData() {
        try {
            // Load base pools
            const response = await fetch('data/ship_build_sim_data.json');
            const data = await response.json();
            state.poolData = JSON.parse(JSON.stringify(data));
            state.originalPoolData = JSON.parse(JSON.stringify(data));

            // Load pickup pools
            const pickupResponse = await fetch('data/ship_build_sim_pickup_data.json');
            state.pickupData = await pickupResponse.json();

            // Initialize custom ships
            state.customShips = { '1': [], '2': [], '3': [], 'pickup': [] };

            // Initialize despair pools (empty until user selects ships)
            state.poolData['despair-1'] = {};
            state.poolData['despair-2'] = {};
            state.poolData['despair-3'] = {};
            state.originalPoolData['despair-1'] = {};
            state.originalPoolData['despair-2'] = {};
            state.originalPoolData['despair-3'] = {};

            // Build pickup pool
            buildPickupPool();

            console.log('Build data loaded successfully');
        } catch (error) {
            console.error('Failed to load build data:', error);
        }
    }

    // Build pickup pool from base pool + pickup ships
    function buildPickupPool() {
        if (!state.pickupData) return;

        // Get the first pickup pool (currently only one in the data)
        const pickupPoolKeys = Object.keys(state.pickupData);
        if (pickupPoolKeys.length === 0) return;

        const basePoolId = pickupPoolKeys[0]; // "3" for Heavy
        const pickupShips = state.pickupData[basePoolId];

        // Start with base pool
        state.poolData['pickup'] = JSON.parse(JSON.stringify(state.originalPoolData[basePoolId]));
        state.originalPoolData['pickup'] = JSON.parse(JSON.stringify(state.originalPoolData[basePoolId]));

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
            const totalPickupRate = rarityPickupShips.reduce((sum, ship) => sum + ship.pickup, 0);
            const baseRarityProb = POOL_PROBABILITIES[basePoolId][rarity];

            if (rarity === 'UR') {
                // UR: Pickup UR gets all the UR chance, remove all other URs
                const existingURs = Object.keys(state.poolData['pickup']).filter(id => {
                    const ship = state.poolData['pickup'][id];
                    return ship.rarity === 'UR';
                });

                // Remove all existing URs from pool
                existingURs.forEach(id => {
                    delete state.poolData['pickup'][id];
                });

                // Add pickup UR with full UR probability
                rarityPickupShips.forEach(ship => {
                    const shipId = ship.name; // Use name as ID for pickup ships
                    state.poolData['pickup'][shipId] = {
                        name: ship.name,
                        rarity: ship.rarity,
                        icon: ship.icon,
                        isPickup: true,
                        pickupRate: ship.pickup
                    };
                });
            } else {
                // SSR/SR: Add pickup ships with exact probability
                // Remaining ships in that rarity share the reduced pool
                rarityPickupShips.forEach(ship => {
                    const shipId = ship.name;
                    state.poolData['pickup'][shipId] = {
                        name: ship.name,
                        rarity: ship.rarity,
                        icon: ship.icon,
                        isPickup: true,
                        pickupRate: ship.pickup
                    };
                });
            }
        });
    }

    // Despair Pool Functions
    function openDespairModal(basePool, despairPoolId) {
        state.modalState.basePool = basePool;
        state.modalState.selectedShips = state.despairSelections[despairPoolId] || [];
        state.modalState.currentRarityTab = 'UR';

        // Show modal
        document.getElementById('despair-modal').style.display = 'flex';

        // Reset rarity tabs
        document.querySelectorAll('.rarity-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.rarity === 'UR');
        });

        // Render ship grid
        renderModalShipGrid();
        updateModalSelectionStatus();
    }

    function closeDespairModal() {
        document.getElementById('despair-modal').style.display = 'none';
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
            grid.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">로딩 중...</p>';
            return;
        }

        // Get ships of current rarity from base pool
        const ships = Object.entries(state.originalPoolData[basePool])
            .filter(([id, ship]) => ship.rarity === currentRarity)
            .map(([id, ship]) => ({ id, ...ship }));

        if (ships.length === 0) {
            grid.innerHTML = `<p style="text-align: center; color: var(--text-secondary);">${currentRarity} 함선이 없습니다.</p>`;
            return;
        }

        grid.innerHTML = '';
        ships.forEach(ship => {
            const isSelected = state.modalState.selectedShips.some(s => s.id === ship.id);

            const card = document.createElement('div');
            card.className = `modal-ship-card ${ship.rarity.toLowerCase()}`;
            if (isSelected) card.classList.add('selected');

            card.innerHTML = `
                <img src="${ship.icon}" alt="${ship.name}" class="modal-ship-icon" onerror="this.src='assets/img/default-ship.png'">
                <div class="modal-ship-name">${ship.name}</div>
                <div class="modal-ship-rarity ${ship.rarity.toLowerCase()}">${ship.rarity}</div>
                ${isSelected ? '<div class="selected-check"><span class="material-symbols-outlined">check_circle</span></div>' : ''}
            `;

            card.addEventListener('click', () => toggleShipSelection(ship));
            grid.appendChild(card);
        });
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
                alert('최대 2척까지만 선택할 수 있습니다.');
                return;
            }

            // Max 1 UR
            if (ship.rarity === 'UR' && urCount >= 1) {
                alert('UR은 최대 1척까지만 선택할 수 있습니다.');
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
            btn.classList.toggle('active', btn.dataset.pool === despairPoolId);
        });

        updateProbabilityChart();
        updateShipSelect();
        renderShipGrid();
        renderAddedShips();
    }

    function buildDespairPool(despairPoolId, basePoolId, selectedShips) {
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

    // Event Listeners
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
        document.getElementById('ship-select').addEventListener('change', updateShipProbability);

        // Filters
        document.querySelectorAll('.rarity-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                state.filters.rarity = btn.dataset.rarity;
                document.querySelectorAll('.rarity-filter').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderShipGrid();
            });
        });

        document.getElementById('ship-search').addEventListener('input', (e) => {
            state.filters.search = e.target.value.toLowerCase();
            renderShipGrid();
        });

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
            poolContent.classList.toggle('collapsed');
            poolCollapseBtn.classList.toggle('collapsed');
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
                const select = document.getElementById('ship-select');
                if (select.value) {
                    updateShipProbability();
                }
            }, 250);
        });

        // Redraw graph on theme change
        const observer = new MutationObserver(() => {
            const canvas = document.getElementById('probability-graph');
            if (canvas && canvas.dataset.shipName) {
                renderGraph(canvas, null);
            }
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
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
                document.querySelectorAll('.rarity-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderModalShipGrid();
            });
        });

        // Close modal when clicking overlay
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeDespairModal();
            }
        });
    }

    // Pool Selection
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
            btn.classList.toggle('active', btn.dataset.pool === poolId);
        });

        updateProbabilityChart();
        updateShipSelect();
        renderShipGrid();
        renderAddedShips();
    }

    // Get effective probabilities for current pool (considering despair pool pickups)
    function getEffectiveProbabilities(poolId) {
        const baseProbs = POOL_PROBABILITIES[poolId];

        // For despair pools, calculate actual probabilities based on selected ships
        if (poolId.startsWith('despair-') && state.despairSelections[poolId]) {
            const selectedShips = state.despairSelections[poolId];
            const hasUR = selectedShips.some(s => s.rarity === 'UR');
            const effectiveProbs = { ...baseProbs };

            // If UR is selected, its probability becomes 2%
            if (hasUR) {
                const urIncrease = DESPAIR_PICKUP_RATES.UR - baseProbs.UR;
                effectiveProbs.UR = DESPAIR_PICKUP_RATES.UR;
                // Reduce N by the UR increase to maintain 100% total
                effectiveProbs.N = Math.max(0, baseProbs.N - urIncrease);
            }

            return effectiveProbs;
        }

        return baseProbs;
    }

    // Update Probability Chart
    function updateProbabilityChart() {
        const probs = getEffectiveProbabilities(state.currentPool);
        const stackedBar = document.getElementById('stacked-probability-bar');
        const legend = document.getElementById('probability-legend');

        // Clear existing content
        stackedBar.innerHTML = '';
        legend.innerHTML = '';

        // Render stacked bar segments
        const rarityOrder = ['UR', 'SSR', 'SR', 'R', 'N'];
        rarityOrder.forEach(rarity => {
            const percentage = probs[rarity];

            if (percentage > 0) {
                // Create segment
                const segment = document.createElement('div');
                segment.className = `stacked-segment ${rarity.toLowerCase()}`;
                segment.style.width = `${percentage}%`;
                segment.innerHTML = `
                    <span class="segment-label">${rarity}</span>
                    <span class="segment-value">${percentage}%</span>
                `;
                stackedBar.appendChild(segment);

                // Create legend item
                const legendItem = document.createElement('div');
                legendItem.className = 'legend-item-compact';
                legendItem.innerHTML = `
                    <div class="legend-color ${rarity.toLowerCase()}"></div>
                    <span class="legend-text">${rarity}</span>
                    <span class="legend-percent">${percentage}%</span>
                `;
                legend.appendChild(legendItem);
            }
        });
    }

    // Update Ship Select Dropdown
    function updateShipSelect() {
        const select = document.getElementById('ship-select');
        const ships = state.poolData[state.currentPool] || {};

        select.innerHTML = '<option value="">함선을 선택하세요</option>';

        // Group ships by rarity
        const groupedShips = {};
        Object.entries(ships).forEach(([id, ship]) => {
            if (!groupedShips[ship.rarity]) {
                groupedShips[ship.rarity] = [];
            }
            groupedShips[ship.rarity].push({ id, ...ship });
        });

        // Add options by rarity order
        const rarityOrder = ['UR', 'SSR', 'SR', 'R', 'N'];
        rarityOrder.forEach(rarity => {
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
        const select = document.getElementById('ship-select');
        const shipId = select.value;

        if (!shipId) {
            document.getElementById('single-prob').textContent = '-';
            document.getElementById('ten-prob').textContent = '-';
            document.getElementById('hundred-prob').textContent = '-';
            document.getElementById('graph-container').style.display = 'none';
            return;
        }

        const ship = state.poolData[state.currentPool][shipId];
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

            // Remaining probability is distributed among non-pickup ships
            const regularShipsCount = sameRarityShips.filter(s => !s.isPickup && !s.isCustom).length;
            const remainingProb = rarityProb * 100 - pickupTotal;

            if (regularShipsCount > 0) {
                singleProb = remainingProb / regularShipsCount;
            } else {
                singleProb = 0;
            }
        }

        // Probability of getting at least 1 in n tries: 1 - (1-p)^n
        const tenProb = (1 - Math.pow(1 - (singleProb / 100), 10)) * 100;
        const hundredProb = (1 - Math.pow(1 - (singleProb / 100), 100)) * 100;

        document.getElementById('single-prob').textContent = `${singleProb.toFixed(4)}%`;
        document.getElementById('ten-prob').textContent = `${tenProb.toFixed(2)}%`;
        document.getElementById('hundred-prob').textContent = `${hundredProb.toFixed(2)}%`;

        // Show and draw graph
        document.getElementById('graph-container').style.display = 'block';
        drawProbabilityGraph(singleProb / 100, ship.name);
    }

    // Draw Probability Graph
    function drawProbabilityGraph(probability, shipName) {
        const canvas = document.getElementById('probability-graph');
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
        const ctx = canvas.getContext('2d');

        // Get stored data
        const dataPoints = JSON.parse(canvas.dataset.dataPoints);
        const maxBuilds = parseInt(canvas.dataset.maxBuilds);
        const padding = JSON.parse(canvas.dataset.padding);
        const width = parseFloat(canvas.dataset.width);
        const height = parseFloat(canvas.dataset.height);
        const shipName = canvas.dataset.shipName;

        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Get theme colors
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#f8f9fa' : '#212529';
        const gridColor = isDark ? '#495057' : '#dee2e6';
        const gridColorLight = isDark ? '#3d3d3d' : '#f1f3f5';
        const lineColor = '#667eea';
        const highlightColor = '#ff6b6b';

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
        ctx.fillText(xLabel, padding.left + chartWidth / 2 - xLabelWidth / 2, height - 20);

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
        gradient.addColorStop(0, 'rgba(102, 126, 234, 0.3)');
        gradient.addColorStop(1, 'rgba(102, 126, 234, 0.05)');
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
        // Remove existing listeners by cloning
        const newCanvas = canvas.cloneNode(true);
        canvas.parentNode.replaceChild(newCanvas, canvas);
        canvas = newCanvas;

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
                tooltip.innerHTML = `
                    <div class="tooltip-ship">${shipName}</div>
                    <div class="tooltip-builds">건조 횟수: <strong>${dataPoint.x}회</strong></div>
                    <div class="tooltip-prob">획득 확률: <strong>${dataPoint.y.toFixed(2)}%</strong></div>
                `;

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
    }

    // Load Ship Database (lazy)
    async function loadShipDatabase() {
        if (state.shipDatabase) return;

        const searchInput = document.getElementById('ship-search-input');
        searchInput.placeholder = '데이터 로딩 중...';
        searchInput.disabled = true;

        try {
            const response = await fetch('data/ship_info_data.json');
            const fullData = await response.json();

            // Extract only what we need
            state.shipDatabase = fullData
                .filter(ship => ship.name && ship.sid && ship.rarity)
                .map(ship => ({
                    sid: ship.sid.toString(),
                    name: ship.name,
                    rarity: ship.rarity,
                    icon: ship.shipyard || `https://raw.githubusercontent.com/Fernando2603/AzurLane/main/images/skin/${ship.sid}/icon.png`
                }));

            console.log(`Loaded ${state.shipDatabase.length} ships from database`);
            searchInput.placeholder = '함선 이름 검색...';
            searchInput.disabled = false;
        } catch (error) {
            console.error('Failed to load ship database:', error);
            searchInput.placeholder = '로딩 실패';
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
            dropdown.innerHTML = '<div class="ship-option" style="pointer-events: none; color: var(--text-secondary);">검색 결과 없음</div>';
            dropdown.style.display = 'block';
            return;
        }

        dropdown.innerHTML = filtered.map(ship => `
            <div class="ship-option" data-sid="${ship.sid}">
                <img src="${ship.icon}" alt="${ship.name}" class="ship-option-icon" loading="lazy">
                <div class="ship-option-info">
                    <div class="ship-option-name">${ship.name}</div>
                    <div class="ship-option-id">ID: ${ship.sid}</div>
                </div>
                <span class="ship-option-rarity ${ship.rarity.toLowerCase()}">${ship.rarity}</span>
            </div>
        `).join('');

        // Add click handlers
        dropdown.querySelectorAll('.ship-option').forEach(option => {
            option.addEventListener('click', () => {
                const sid = option.dataset.sid;
                const ship = state.shipDatabase.find(s => s.sid === sid);
                selectShipFromDropdown(ship);
            });
        });

        dropdown.style.display = 'block';
    }

    // Select ship from dropdown
    function selectShipFromDropdown(ship) {
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
            alert('픽업 확률을 0 초과 100 이하의 값으로 입력해주세요.');
            return;
        }

        const ship = state.selectedShip;
        const poolId = state.currentPool;

        // Check if ship already exists in pool
        const existsInOriginal = state.originalPoolData[poolId][ship.sid];
        const existsInCustom = state.customShips[poolId].find(s => s.ship.sid === ship.sid);

        if (existsInOriginal || existsInCustom) {
            alert('이 함선은 이미 현재 풀에 존재합니다.');
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
        updateShipSelect();
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
        state.poolData[poolId] = JSON.parse(JSON.stringify(state.originalPoolData[poolId]));

        // Get custom ships for this pool
        const customShips = state.customShips[poolId];
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
            const baseRarityProb = POOL_PROBABILITIES[poolId][rarity];

            if (totalPickupRate >= baseRarityProb) {
                alert(`경고: ${rarity} 등급의 픽업 확률 합계(${totalPickupRate}%)가 해당 등급 전체 확률(${baseRarityProb}%)을 초과합니다. 다른 함선의 확률이 0이 됩니다.`);
            }

            // Calculate remaining probability for existing ships
            const remainingProb = Math.max(0, baseRarityProb - totalPickupRate);

            // Count existing ships of this rarity in original pool
            const existingShips = Object.values(state.originalPoolData[poolId])
                .filter(s => s.rarity === rarity);

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
        const customShips = state.customShips[state.currentPool];

        if (customShips.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = customShips.map((item, index) => `
            <div class="added-ship-tag pickup">
                <img src="${item.ship.icon}" alt="${item.ship.name}" class="added-ship-tag-icon">
                <div class="added-ship-tag-info">
                    <div class="added-ship-tag-name">${item.ship.name}</div>
                    <div class="added-ship-tag-rate">픽업: ${item.pickupRate}%</div>
                </div>
                <button class="added-ship-tag-remove" data-index="${index}">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
        `).join('');

        // Add remove handlers
        container.querySelectorAll('.added-ship-tag-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                removeCustomShip(index);
            });
        });
    }

    // Remove custom ship
    function removeCustomShip(index) {
        state.customShips[state.currentPool].splice(index, 1);
        recalculatePoolProbabilities();
        renderAddedShips();
        updateShipSelect();
        renderShipGrid();
    }

    // Reset pool to original
    function resetPool() {
        if (!confirm('현재 풀을 초기 상태로 되돌리시겠습니까? 추가한 모든 픽업 함선이 제거됩니다.')) {
            return;
        }

        state.customShips[state.currentPool] = [];
        state.poolData[state.currentPool] = JSON.parse(JSON.stringify(state.originalPoolData[state.currentPool]));

        renderAddedShips();
        updateShipSelect();
        renderShipGrid();
        updateProbabilityChart();
    }

    // Perform Build
    function performBuild(count) {
        const resultsContainer = document.getElementById('build-results');

        // Remove placeholder
        const placeholder = resultsContainer.querySelector('.placeholder');
        if (placeholder) {
            placeholder.remove();
        }

        // Clear previous results
        resultsContainer.innerHTML = '';

        // Calculate resource costs
        const cost = BUILD_COSTS[state.currentPool];
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

        saveStats();
    }

    // Roll Ship based on probabilities
    function rollShip() {
        const probs = getEffectiveProbabilities(state.currentPool);
        const ships = state.poolData[state.currentPool];

        // Determine rarity
        const rand = Math.random() * 100;
        let cumulative = 0;
        let selectedRarity = 'N';

        const rarityOrder = ['UR', 'SSR', 'SR', 'R', 'N'];
        for (const rarity of rarityOrder) {
            cumulative += probs[rarity];
            if (rand <= cumulative) {
                selectedRarity = rarity;
                break;
            }
        }

        // Get all ships of selected rarity
        const rarityShips = Object.entries(ships).filter(([id, ship]) => ship.rarity === selectedRarity);

        // Check if there are pickup ships in this rarity
        const pickupShips = rarityShips.filter(([id, ship]) => ship.isPickup && ship.pickupRate);
        const customShips = rarityShips.filter(([id, ship]) => ship.isCustom && ship.pickupRate);
        const regularShips = rarityShips.filter(([id, ship]) => !ship.isPickup && !ship.isCustom);

        // Handle pickup pool (UR limited banner) OR despair pool
        if ((state.currentPool === 'pickup' || state.currentPool.startsWith('despair-')) && pickupShips.length > 0) {
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
        card.className = `ship-card ${ship.rarity.toLowerCase()} ${isPickupOrCustom ? 'custom-ship' : ''}`;

        const pickupBadge = (ship.isPickup || ship.isCustom) && ship.pickupRate
            ? `<div class="pickup-badge">픽업 ${ship.pickupRate}%</div>`
            : '';

        card.innerHTML = `
            ${pickupBadge}
            <img src="${ship.icon}" alt="${ship.name}" class="ship-card-icon" loading="lazy">
            <div class="ship-card-name">${ship.name}</div>
            <div class="ship-card-rarity ${ship.rarity.toLowerCase()}">${ship.rarity}</div>
        `;

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
        resultsContainer.innerHTML = '<div class="placeholder">건조 버튼을 눌러 시작하세요</div>';

        saveStats();
    }

    // Render Ship Grid
    function renderShipGrid() {
        const grid = document.getElementById('ship-grid');
        const ships = state.poolData[state.currentPool] || {};

        grid.innerHTML = '';

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
        const rarityOrder = { UR: 0, SSR: 1, SR: 2, R: 3, N: 4 };
        filteredShips.sort((a, b) => {
            const rarityDiff = rarityOrder[a[1].rarity] - rarityOrder[b[1].rarity];
            if (rarityDiff !== 0) return rarityDiff;
            return a[1].name.localeCompare(b[1].name);
        });

        // Render ships
        filteredShips.forEach(([id, ship]) => {
            renderShipCard({ id, ...ship }, grid);
        });

        // Update count
        document.getElementById('ship-count').textContent = filteredShips.length;
    }

    // Save Statistics to LocalStorage
    function saveStats() {
        try {
            localStorage.setItem('buildSimulatorStats', JSON.stringify(state.buildStats));
        } catch (error) {
            console.error('Failed to save stats:', error);
        }
    }

    // Load Statistics from LocalStorage
    function loadSavedStats() {
        try {
            const saved = localStorage.getItem('buildSimulatorStats');
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
