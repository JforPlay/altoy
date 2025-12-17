/**
 * Island Restaurant Module
 * Manages restaurant menus, profit calculations, and event bonuses
 */

window.RestaurantModule = (function () {
    'use strict';

    // ============================================ 
    // CONSTANTS
    // ============================================ 

    const RANK_COEFFICIENTS = {
        bronze: 0.9,
        silver: 1.0,
        gold: 1.1,
        diamond: 1.15
    };

    const RANK_NAMES = {
        bronze: '브론즈',
        silver: '실버',
        gold: '골드',
        diamond: '다이아몬드'
    };

    const ATTRIBUTE_NAMES = [
        '재배',      // 1
        '채집',      // 2
        '사육',      // 3
        '요리',      // 4
        '경영',      // 5
        '제조'       // 6
    ];

    const ATTRIBUTE_RANK_VALUES = {
        'E': 0.05,
        'D': 0.16,
        'C': 0.30,
        'B': 0.42,
        'A': 0.56,
        'S': 0.72,
        'SS': 0.84,
        'SSS': 1.00
    };

    // Sales calculation coefficients from game data (divided by 100)
    const SALES_COEFFICIENTS = {
        argA: 0.60,
        argB: 2.40,
        argC: 0,
        saleConst: 1.60
    };

    const RANK_ICONS = {
        bronze: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/rank_tong.png',
        silver: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/rank_yin.png',
        gold: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/rank_jin.png',
        diamond: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/rank_zuanshi.png'
    };

    const RANK_COLORS = {
        bronze: '#cd7f32',
        silver: '#c0c0c0',
        gold: '#ffd700',
        diamond: '#b9f2ff'
    };

    const RANK_RANDOM_RANGES = {
        bronze: { min: -1, max: 0 },
        silver: { min: -1, max: 1 },
        gold: { min: -1, max: 2 },
        diamond: { min: -1, max: 2 }
    };

    const RANK_MAX_SALES = {
        bronze: 5,
        silver: 6,
        gold: 6,
        diamond: 6
    };

    const EVENT_BONUSES = {
        manjuu_tour: { name: '단체 관광객 만쥬', bonus: 0.10 },
        health_day: { name: '건강의 날', bonus: 0.20 },
        food_review: { name: '메탈 블러드 사절 방문', bonus: 0.30 }
    };

    const RARITY_BACKGROUNDS = {
        1: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/rarity_gray.png',
        2: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/rarity_blue.png',
        3: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/rarity_purple.png',
        4: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/rarity_orange.png'
    };

    const STORAGE_KEY_RANK = 'island-restaurant-rank';
    const STORAGE_KEY_EVENTS = 'island-restaurant-events';
    const STORAGE_KEY_SHIPGIRL1 = 'island-restaurant-shipgirl1';
    const STORAGE_KEY_SHIPGIRL2 = 'island-restaurant-shipgirl2';
    const STORAGE_KEY_PLANNER_PLAN = 'island-restaurant-planner-plan-v2';
    const STORAGE_KEY_PLANNER_PRESETS = 'island-restaurant-planner-presets-v2';

    const PLANNER_SLOTS_PER_RESTAURANT = 4;
    const PLANNER_PRESET_COUNT = 3;

    // ============================================ 
    // STATE
    // ============================================ 

    const state = {
        restaurants: {},
        items: {},
        recipes: {},
        shopPurchaseData: {},    // { item_id: [required_item_id, cost, pack_size] }
        recipeIndex: {},         // { recipeId: recipe } for O(1) lookup
        recipeCategoryIndex: {}, // { recipeId: categoryId } for O(1) lookup
        dependencyGraph: {
            producedBy: {},      // itemId -> recipe ids that produce it
            usedBy: {}           // itemId -> recipe ids that use it
        },
        selectedRestaurant: null,
        selectedRank: 'silver',
        activeEvents: new Set(),
        menuIndex: {},           // { formulaId: [{ restaurantId, itemId }] }
        highlightFormulaId: null,
        uniqueSubAttributes: [], // [1, 2, 3, 4, 5, 6] - unique sub_attribute IDs from all menus
        shipgirl1Attr: { main: 'E' },  // Main (경영) + dynamic sub-attributes added in init
        shipgirl2Attr: { main: 'E' },  // Only active when rank >= gold

        // Meal Planner State
        plannerPlan: {},      // { [restaurantId]: { globalCount: number, slots: [{ formulaId }] } }
        plannerPresets: {},   // { [restaurantId]: { [presetIndex]: { globalCount, slots: [] } } }
        plannerDirty: true,
        lastPlannerResults: null,
        masterIngredients: {}, // { location: [ { id, name, icon, rarity } ] }
        ui: {
            presetSelections: {} // { restaurantId: selectedPresetIndex (1-5) }
        },
        // Caches
        costCache: {},
        salesCache: {}
    };

    // ============================================ 
    // INITIALIZATION
    // ============================================ 

    async function init(sharedData) {
        try {
            // Use shared item data
            if (sharedData && sharedData.items) {
                state.items = sharedData.items;
            }

            // Load module-specific data
            const [restaurantData, recipesData, shopData] = await Promise.all([
                fetchJSON('data/island/island_manage_restaurant.json'),
                fetchJSON('data/island/recipes.json'),
                fetchJSON('data/island/island_shop_goods.json')
            ]);

            state.restaurants = restaurantData;
            state.recipes = recipesData;

            // Build data structures for tree-based cost calculation
            buildMenuIndex();
            state.shopPurchaseData = IslandEngine.buildShopDataIndex(shopData);
            const { recipeIndex, recipeCategoryIndex } = IslandEngine.buildRecipeIndices(state.recipes);
            state.recipeIndex = recipeIndex;
            state.recipeCategoryIndex = recipeCategoryIndex;
            state.dependencyGraph = IslandEngine.buildDependencyGraph(state.recipes);
            findUniqueSubAttributes();

            // Pre-calculate master ingredient list
            buildMasterIngredientList();

            // Initialize default attribute values for all sub-attributes
            state.uniqueSubAttributes.forEach(attrId => {
                if (!state.shipgirl1Attr[attrId]) state.shipgirl1Attr[attrId] = 'E';
                if (!state.shipgirl2Attr[attrId]) state.shipgirl2Attr[attrId] = 'E';
            });

            // Load saved preferences
            loadPreferences();
            loadPlannerState();

            // Select first restaurant by default
            const restaurantIds = getRestaurantIds();
            const firstRestaurantId = restaurantIds[0];

            if (firstRestaurantId) {
                state.selectedRestaurant = firstRestaurantId;
            }

            // Render UI
            renderRestaurantTabs();
            renderRankSelector();
            renderEventToggles();
            renderShipgirlSelectors();
            renderMenuList();
            setupPlannerUI();
            updatePlannerUI();

            return true;
        } catch (error) {
            console.error('[Restaurant] Initialization failed:', error);
            IslandEngine.showToast('레스토랑 데이터를 불러오는데 실패했습니다.', 'error');
            throw error;
        }
    }

    // ============================================ 
    // DATA STRUCTURE BUILDERS
    // ============================================ 

    function buildMenuIndex() {
        state.menuIndex = {};
        Object.entries(state.restaurants).forEach(([restaurantId, restaurant]) => {
            (restaurant.item_id || []).forEach(([itemId, formulaId]) => {
                if (!state.menuIndex[formulaId]) {
                    state.menuIndex[formulaId] = [];
                }
                state.menuIndex[formulaId].push({
                    restaurantId,
                    restaurantName: restaurant.name,
                    itemId
                });
            });
        });
    }

    function getRestaurantIds() {
        return Object.keys(state.restaurants)
            .filter(id => id !== 'all')
            .sort((a, b) => parseInt(a) - parseInt(b));
    }

    function findUniqueSubAttributes() {
        const subAttributeSet = new Set();

        // Iterate through all restaurants and their menu items
        Object.values(state.restaurants).forEach(restaurant => {
            (restaurant.item_id || []).forEach(([itemId]) => {
                const item = state.items[itemId];
                if (item && item.sub_attribute && item.sub_attribute.length > 0) {
                    const subAttrId = item.sub_attribute[0];
                    if (subAttrId >= 1 && subAttrId <= 6) {
                        subAttributeSet.add(subAttrId);
                    }
                }
            });
        });

        // Convert to sorted array
        state.uniqueSubAttributes = Array.from(subAttributeSet).sort((a, b) => a - b);
    }

    function buildMasterIngredientList() {
        const allIngredients = {}; // Map itemId -> info

        // Iterate all menus in all restaurants
        Object.values(state.restaurants).forEach(restaurant => {
            if (!restaurant.item_id) return;
            restaurant.item_id.forEach(([_, formulaId]) => {
                const tree = IslandEngine.buildRecipeDependencyTree(
                    formulaId,
                    state.recipeIndex,
                    state.recipeCategoryIndex,
                    state.dependencyGraph,
                    state.shopPurchaseData,
                    {
                        useManualMode: false,
                        quantityMultiplier: 1,
                        shouldStopRecursion: (rId, rCat) => rCat === '1' || rCat === '2'
                    }
                );

                if (tree) {
                    aggregateIngredients(tree, allIngredients, true); // true = dry run
                }
            });
        });

        // Group by location
        state.masterIngredients = groupIngredientsByLocation(allIngredients);
    }

    // ============================================ 
    // PREFERENCES
    // ============================================ 

    function loadPreferences() {
        try {
            const savedRank = localStorage.getItem(STORAGE_KEY_RANK);
            if (savedRank && RANK_COEFFICIENTS[savedRank]) {
                state.selectedRank = savedRank;
            }

            const savedEvents = localStorage.getItem(STORAGE_KEY_EVENTS);
            if (savedEvents) {
                state.activeEvents = new Set(JSON.parse(savedEvents));
            }

            const savedShipgirl1 = localStorage.getItem(STORAGE_KEY_SHIPGIRL1);
            if (savedShipgirl1) {
                state.shipgirl1Attr = JSON.parse(savedShipgirl1);
            }

            const savedShipgirl2 = localStorage.getItem(STORAGE_KEY_SHIPGIRL2);
            if (savedShipgirl2) {
                state.shipgirl2Attr = JSON.parse(savedShipgirl2);
            }
        } catch (error) {
            console.error('[Restaurant] Failed to load preferences:', error);
        }
    }

    function savePreferences() {
        try {
            localStorage.setItem(STORAGE_KEY_RANK, state.selectedRank);
            localStorage.setItem(STORAGE_KEY_EVENTS, JSON.stringify(Array.from(state.activeEvents)));
            localStorage.setItem(STORAGE_KEY_SHIPGIRL1, JSON.stringify(state.shipgirl1Attr));
            localStorage.setItem(STORAGE_KEY_SHIPGIRL2, JSON.stringify(state.shipgirl2Attr));
            
            // Clear sales cache as preferences affecting calculation have changed
            state.salesCache = {};
        } catch (error) {
            console.error('[Restaurant] Failed to save preferences:', error);
        }
    }

    // ============================================ 
    // PLANNER STATE HELPERS
    // ============================================ 

    function buildEmptyPlannerEntry() {
        return {
            globalCount: 1,
            slots: Array.from({ length: PLANNER_SLOTS_PER_RESTAURANT }, () => ({ formulaId: '' }))
        };
    }

    function normalizePlannerEntry(entry) {
        const base = buildEmptyPlannerEntry();
        if (!entry) return base;

        const normalized = {
            globalCount: Number.isFinite(entry.globalCount) ? entry.globalCount : base.globalCount,
            slots: Array.from({ length: PLANNER_SLOTS_PER_RESTAURANT }, (_, idx) => {
                const slot = entry.slots && entry.slots[idx] ? entry.slots[idx] : {};
                return {
                    formulaId: slot.formulaId || ''
                };
            })
        };

        return normalized;
    }

    function createDefaultPlannerPlan() {
        const plan = {};
        getRestaurantIds().forEach(id => {
            plan[id] = buildEmptyPlannerEntry();
        });
        return plan;
    }

    function createDefaultPlannerPresets() {
        const presets = {};
        getRestaurantIds().forEach(id => {
            presets[id] = {};
        });
        return presets;
    }

    function loadPlannerState() {
        state.plannerPlan = createDefaultPlannerPlan();
        state.plannerPresets = createDefaultPlannerPresets();

        try {
            const savedPlan = localStorage.getItem(STORAGE_KEY_PLANNER_PLAN);
            if (savedPlan) {
                const parsed = JSON.parse(savedPlan);
                getRestaurantIds().forEach(id => {
                    state.plannerPlan[id] = normalizePlannerEntry(parsed[id]);
                });
            }

            const savedPresets = localStorage.getItem(STORAGE_KEY_PLANNER_PRESETS);
            if (savedPresets) {
                const parsed = JSON.parse(savedPresets);
                getRestaurantIds().forEach(id => {
                    state.plannerPresets[id] = {};
                    if (parsed[id]) {
                        for (let i = 1; i <= PLANNER_PRESET_COUNT; i++) {
                            if (parsed[id][i]) {
                                state.plannerPresets[id][i] = normalizePlannerEntry(parsed[id][i]);
                            }
                        }
                    }
                });
            }
        } catch (error) {
            console.error('[Restaurant] Failed to load planner state:', error);
        }
    }

    function savePlannerPlan() {
        try {
            localStorage.setItem(STORAGE_KEY_PLANNER_PLAN, JSON.stringify(state.plannerPlan));
        } catch (error) {
            console.error('[Restaurant] Failed to save planner plan:', error);
        }
    }

    function savePlannerPresets() {
        try {
            localStorage.setItem(STORAGE_KEY_PLANNER_PRESETS, JSON.stringify(state.plannerPresets));
        } catch (error) {
            console.error('[Restaurant] Failed to save planner presets:', error);
        }
    }

    function getPlannerEntry(restaurantId) {
        if (!state.plannerPlan[restaurantId]) {
            state.plannerPlan[restaurantId] = buildEmptyPlannerEntry();
        }
        return state.plannerPlan[restaurantId];
    }

    // ============================================ 
    // PRICE CALCULATION
    // ============================================ 

    function calculateMenuCost(formulaId) {
        if (!formulaId) {
            return { gold: 0, resources: {} };
        }

        // Check cache
        if (state.costCache[formulaId]) {
            return state.costCache[formulaId];
        }

        const tree = IslandEngine.buildRecipeDependencyTree(
            formulaId,
            state.recipeIndex,
            state.recipeCategoryIndex,
            state.dependencyGraph,
            state.shopPurchaseData,
            { useManualMode: false, quantityMultiplier: 1 }
        );

        if (!tree) {
            return { gold: 0, resources: {} };
        }

        const costs = IslandEngine.calculateTreeCost(tree);
        
        // Save to cache
        state.costCache[formulaId] = costs;
        
        return costs;
    }

    function calculateProfit(itemId, formulaId, rank = 'silver', events = []) {
        const item = state.items[itemId];
        if (!item) return null;

        const baseSellPrice = item.order_price || 0;
        const costData = calculateMenuCost(formulaId);
        const goldCost = costData.gold || 0;

        const rankCoeff = RANK_COEFFICIENTS[rank] || 1.0;

        let eventBonus = 0;
        events.forEach(eventKey => {
            if (EVENT_BONUSES[eventKey]) {
                eventBonus += EVENT_BONUSES[eventKey].bonus;
            }
        });

        const finalSellPrice = baseSellPrice * (1 + eventBonus);
        const profit = finalSellPrice - goldCost;
        const profitMargin = finalSellPrice > 0 ? (profit / finalSellPrice) * 100 : 0;

        const salesCount = calculateSalesCount(itemId, rank, events);

        return {
            itemId,
            itemName: item.name || `Item ${itemId}`,
            baseSellPrice,
            cost: goldCost,
            costBreakdown: costData,
            rankCoeff,
            eventBonus,
            finalSellPrice: Math.round(finalSellPrice),
            profit: Math.round(profit),
            profitMargin: profitMargin.toFixed(1),
            salesCount: salesCount
        };
    }

    function calculateSalesCount(itemId, rank = 'silver', events = []) {
        // Check cache
        const cacheKey = `${itemId}_${rank}`;
        if (state.salesCache[cacheKey]) {
            return state.salesCache[cacheKey];
        }

        const item = state.items[itemId];
        if (!item) return 0;

        const manageInfluence = item.manage_influence || 0;
        const subAttributeId = item.sub_attribute && item.sub_attribute.length > 0 ? item.sub_attribute[0] : 0;
        const subAttributeValue = item.sub_attribute && item.sub_attribute.length > 1 ? item.sub_attribute[1] : 0;

        let eventInfluence = 0;
        events.forEach(eventKey => {
            if (eventKey === 'manjuu_tour') eventInfluence = 0.1;
            else if (eventKey === 'health_day') eventInfluence = 0.2;
            else if (eventKey === 'food_review') eventInfluence = 0.3;
        });

        const rankFactor = RANK_COEFFICIENTS[rank] || 1.0;
        const mainAttrFactor = getMainAttrFactor();
        const subAttrFactor = getSubAttrFactor(subAttributeId);

        const baseCount = Math.floor(
            (manageInfluence / 100 + eventInfluence) *
            (SALES_COEFFICIENTS.argA + mainAttrFactor) *
            (SALES_COEFFICIENTS.argB + subAttrFactor * subAttributeValue / 100) *
            (SALES_COEFFICIENTS.argC + rankFactor) /
            SALES_COEFFICIENTS.saleConst
        );

        const randomRange = RANK_RANDOM_RANGES[rank] || { min: 0, max: 0 };
        const maxSalesCap = RANK_MAX_SALES[rank] || 6;
        const minSales = Math.min(maxSalesCap, Math.max(1, baseCount + randomRange.min));
        const maxSales = Math.min(maxSalesCap, Math.max(1, baseCount + randomRange.max));

        const result = { min: minSales, max: maxSales, base: baseCount };
        
        // Save to cache
        state.salesCache[cacheKey] = result;
        
        return result;
    }

    function getMainAttrFactor() {
        let factor = ATTRIBUTE_RANK_VALUES[state.shipgirl1Attr.main] || 0;
        if (state.selectedRank === 'gold' || state.selectedRank === 'diamond') {
            factor += ATTRIBUTE_RANK_VALUES[state.shipgirl2Attr.main] || 0;
        }
        return factor;
    }

    function getSubAttrFactor(subAttributeId) {
        if (!subAttributeId || subAttributeId < 1 || subAttributeId > 6) return 0;
        if (subAttributeId === 5) return getMainAttrFactor();

        let factor = ATTRIBUTE_RANK_VALUES[state.shipgirl1Attr[subAttributeId]] || 0;
        if (state.selectedRank === 'gold' || state.selectedRank === 'diamond') {
            factor += ATTRIBUTE_RANK_VALUES[state.shipgirl2Attr[subAttributeId]] || 0;
        }
        return factor;
    }

    // ============================================ 
    // CROSS-TABNAVIGATION
    // ============================================ 

    function getRestaurantsForRecipe(formulaId) {
        if (!formulaId) return [];
        return (state.menuIndex[formulaId] || []).map(entry => ({ ...entry }));
    }

    function navigateToMenu(formulaId, restaurantId) {
        const targets = state.menuIndex[formulaId] || [];
        if (!targets.length) return;

        const target = restaurantId
            ? targets.find(t => t.restaurantId === String(restaurantId)) || targets[0]
            : targets[0];

        state.highlightFormulaId = formulaId;
        selectRestaurant(target.restaurantId);
        IslandEngine.activateTab('restaurant');

        setTimeout(() => focusMenuCard(formulaId), 150);
    }

    function viewRecipe(formulaId) {
        if (!window.ResourceModule || !ResourceModule.selectRecipe) return;
        IslandEngine.activateTab('resources');
        ResourceModule.selectRecipe(formulaId);
    }

    function focusMenuCard(formulaId) {
        const card = document.querySelector(`.menu-card[data-formula-id="${formulaId}"]`);
        if (card) {
            card.classList.add('menu-card-highlight');
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => card.classList.remove('menu-card-highlight'), 1200);
        }
    }

    // ============================================ 
    // RESTAURANT TABS
    // ============================================ 

    function renderRestaurantTabs() {
        const container = document.getElementById('restaurant-tabs');
        if (!container) return;

        const restaurants = Object.entries(state.restaurants)
            .filter(([id]) => id !== 'all')
            .sort(([a], [b]) => parseInt(a) - parseInt(b));

        const tabsHtml = restaurants.map(([id, restaurant]) => `
            <button class="restaurant-tab ${state.selectedRestaurant === id ? 'active' : ''}"
                    data-restaurant-id="${id}" onclick="RestaurantModule.selectRestaurant('${id}')">
                <span class="material-symbols-outlined">restaurant</span>
                <span class="restaurant-tab-name">${restaurant.name}</span>
            </button>
        `).join('');

        const plannerTabHtml = `
            <button class="restaurant-tab planner-tab ${state.selectedRestaurant === 'planner' ? 'active' : ''}"
                    data-restaurant-id="planner" onclick="RestaurantModule.selectRestaurant('planner')">
                <span class="material-symbols-outlined">event_note</span>
                <span class="restaurant-tab-name">메뉴 계산기</span>
            </button>
        `;

        container.innerHTML = tabsHtml + plannerTabHtml;
    }

    function selectRestaurant(restaurantId) {
        state.selectedRestaurant = restaurantId;

        // Update Tabs UI
        document.querySelectorAll('.restaurant-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.restaurantId === restaurantId);
        });

        const plannerView = document.getElementById('restaurant-planner-view');
        const menuList = document.getElementById('restaurant-menu-list');
        const menuContainer = document.querySelector('.restaurant-menu-container');
        const controls = document.querySelector('.restaurant-controls');

        // Also hide/show floating bar if it exists (though we deprecate it)
        const floatingBar = document.getElementById('meal-planner-bar');

        if (restaurantId === 'planner') {
            plannerView?.classList.remove('hidden');
            menuList?.classList.add('hidden');
            menuContainer?.classList.add('hidden');
            controls?.classList.add('hidden');
            floatingBar?.classList.add('hidden');

            renderPlannerMainView();
        } else {
            plannerView?.classList.add('hidden');
            menuList?.classList.remove('hidden');
            menuContainer?.classList.remove('hidden');
            controls?.classList.remove('hidden');
            // floatingBar?.classList.remove('hidden'); // Optional: show floating bar? Or rely on Planner tab

            renderMenuList();
            updatePlannerUI();
        }
    }

    // ============================================ 
    // RANK SELECTOR
    // ============================================ 

    function renderRankSelector() {
        const container = document.getElementById('rank-selector');
        if (!container) return;

        const ranks = Object.keys(RANK_COEFFICIENTS);

        const html = `
            <div class="rank-selector-label">
                <span class="material-symbols-outlined">military_tech</span>
                <span>가게 등급</span>
            </div>
            <div class="rank-buttons">
                ${ranks.map(rank => `
                    <button class="rank-btn ${state.selectedRank === rank ? 'active' : ''}"
                            data-rank="${rank}"
                            style="--rank-color: ${RANK_COLORS[rank]}">
                        <img class="rank-icon" src="${RANK_ICONS[rank]}" alt="${RANK_NAMES[rank]}">
                        <span class="rank-name">${RANK_NAMES[rank]}</span>
                        <span class="rank-coeff">×${RANK_COEFFICIENTS[rank]}</span>
                    </button>
                `).join('')}
            </div>
        `;

        container.innerHTML = html;

        container.querySelectorAll('.rank-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                selectRank(btn.dataset.rank);
            });
        });
    }

    function selectRank(rank) {
        state.selectedRank = rank;
        savePreferences();
        document.querySelectorAll('.rank-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.rank === rank);
        });
        renderShipgirlSelectors();
        renderMenuList();
        updatePlannerUI();
    }

    // ============================================ 
    // EVENT TOGGLES
    // ============================================ 

    function renderEventToggles() {
        const container = document.getElementById('event-toggles');
        if (!container) return;

        const html = `
            <div class="event-toggles-label">
                <span class="material-symbols-outlined">celebration</span>
                <span>이벤트 보너스</span>
            </div>
            <div class="event-checkboxes">
                ${Object.entries(EVENT_BONUSES).map(([key, event]) => `
                    <label class="event-checkbox-label">
                        <input type="checkbox"
                               class="event-checkbox"
                               data-event-key="${key}"
                               ${state.activeEvents.has(key) ? 'checked' : ''}>
                        <span class="event-checkbox-custom"></span>
                        <span class="event-name">${event.name}</span>
                        <span class="event-bonus">+${(event.bonus * 100).toFixed(0)}%</span>
                    </label>
                `).join('')}
            </div>
        `;

        container.innerHTML = html;

        container.querySelectorAll('.event-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                toggleEvent(e.target.dataset.eventKey, e.target.checked);
            });
        });
    }

    function toggleEvent(eventKey, enabled) {
        if (enabled) {
            state.activeEvents.add(eventKey);
        } else {
            state.activeEvents.delete(eventKey);
        }
        savePreferences();
        renderMenuList();
        updatePlannerUI();
    }

    // ============================================ 
    // SHIPGIRL SELECTORS
    // ============================================ 

    function renderShipgirlSelectors() {
        renderShipgirlSelector(1, 'shipgirl-1-selector', state.shipgirl1Attr);
        renderShipgirlSelector(2, 'shipgirl-2-selector', state.shipgirl2Attr);
    }

    function renderShipgirlSelector(shipgirlNum, containerId, attrState) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const isShipgirl2 = shipgirlNum === 2;
        const isDisabled = isShipgirl2 && (state.selectedRank !== 'gold' && state.selectedRank !== 'diamond');
        const rankOptions = Object.keys(ATTRIBUTE_RANK_VALUES);

        const subAttributeSelectors = state.uniqueSubAttributes.map(attrId => {
            const attrName = ATTRIBUTE_NAMES[attrId - 1];
            const attrKey = attrId;
            if (attrId === 5) return '';

            return `
                <div class="attribute-selector">
                    <label class="attribute-label">${attrName} (부 속성)</label>
                    <select class="attribute-select sub-attr" data-shipgirl="${shipgirlNum}" data-attr-id="${attrId}" ${isDisabled ? 'disabled' : ''}>
                        ${rankOptions.map(rank => `
                            <option value="${rank}" ${attrState[attrKey] === rank ? 'selected' : ''}>
                                ${rank} (${ATTRIBUTE_RANK_VALUES[rank].toFixed(2)})
                            </option>
                        `).join('')}
                    </select>
                </div>
            `;
        }).join('');

        const html = `
            <div class="shipgirl-selector ${isDisabled ? 'disabled' : ''}">
                <div class="shipgirl-selector-label">
                    <span class="material-symbols-outlined">person</span>
                    <span>판매 함순이 ${shipgirlNum}</span>
                    ${isShipgirl2 ? '<span class="gold-only-badge">골드 이상</span>' : ''}
                </div>
                <div class="shipgirl-attributes">
                    <div class="attribute-selector">
                        <label class="attribute-label">경영 (주 속성)</label>
                        <select class="attribute-select main-attr" data-shipgirl="${shipgirlNum}" ${isDisabled ? 'disabled' : ''}>
                            ${rankOptions.map(rank => `
                                <option value="${rank}" ${attrState.main === rank ? 'selected' : ''}>
                                    ${rank} (${ATTRIBUTE_RANK_VALUES[rank].toFixed(2)})
                                </option>
                            `).join('')}
                        </select>
                    </div>
                    ${subAttributeSelectors}
                </div>
            </div>
        `;

        container.innerHTML = html;

        if (!isDisabled) {
            const mainSelect = container.querySelector('.main-attr');
            mainSelect.addEventListener('change', (e) => {
                updateShipgirlAttribute(shipgirlNum, 'main', e.target.value);
            });

            const subSelects = container.querySelectorAll('.sub-attr');
            subSelects.forEach(select => {
                select.addEventListener('change', (e) => {
                    const attrId = parseInt(e.target.dataset.attrId);
                    updateShipgirlAttribute(shipgirlNum, attrId, e.target.value);
                });
            });
        }
    }

    function updateShipgirlAttribute(shipgirlNum, attrKey, rank) {
        if (shipgirlNum === 1) state.shipgirl1Attr[attrKey] = rank;
        else if (shipgirlNum === 2) state.shipgirl2Attr[attrKey] = rank;
        savePreferences();
        renderMenuList();
        updatePlannerUI();
    }

    // ============================================ 
    // MENU LIST & PLANNER
    // ============================================ 

    function renderMenuList() {
        const container = document.getElementById('restaurant-menu-list');
        if (!container) return;

        const restaurantId = state.selectedRestaurant;
        const restaurant = state.restaurants[restaurantId];
        if (!restaurant) {
            container.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">restaurant_menu</span><h3>레스토랑을 선택하세요</h3></div>`;
            return;
        }

        const menus = restaurant.item_id || [];
        if (menus.length === 0) {
            container.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">no_meals</span><h3>메뉴가 없습니다</h3></div>`;
            return;
        }

        const html = menus.map(([itemId, formulaId]) => {
            return createMenuCard(itemId, formulaId, restaurantId);
        }).join('');

        container.innerHTML = html;

        if (state.highlightFormulaId) {
            focusMenuCard(state.highlightFormulaId);
            state.highlightFormulaId = null;
        }
    }

    function createMenuCard(itemId, formulaId, restaurantId) {
        const activeEvents = Array.from(state.activeEvents);
        const profitData = calculateProfit(itemId, formulaId, state.selectedRank, activeEvents);

        if (!profitData) {
            return `<div class="menu-card error"><p>메뉴 정보를 불러올 수 없습니다 (Item ${itemId})</p></div>`;
        }

        const item = state.items[itemId];
        const recipe = state.recipeIndex[formulaId];
        const profitClass = profitData.profit > 0 ? 'positive' : profitData.profit < 0 ? 'negative' : 'neutral';
        const recipeTime = recipe && recipe.workload ? formatTime(recipe.workload) : '';
        const margin = parseFloat(profitData.profitMargin);
        let marginClass = 'margin-very-low';
        if (margin >= 91) marginClass = 'margin-excellent';
        else if (margin >= 81) marginClass = 'margin-great';
        else if (margin >= 71) marginClass = 'margin-good';
        else if (margin >= 61) marginClass = 'margin-fair';

        const allRankProfits = Object.keys(RANK_COEFFICIENTS).map(rank => {
            const data = calculateProfit(itemId, formulaId, rank, activeEvents);
            return { rank, ...data };
        });

        const rarityBackground = RARITY_BACKGROUNDS[item.rarity] || '';

        // Planner quantity

        return `
            <div class="menu-card" data-item-id="${itemId}" data-formula-id="${formulaId}">
                <!-- Header -->
                <div class="menu-card-header">
                    <div class="restaurant-menu-icon" style="background-image: url('${rarityBackground}')">
                        ${item.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${item.icon.split('/').pop()}.png" alt="${item.name}">` : '<span class="material-symbols-outlined">restaurant_menu</span>'}
                    </div>
                    <div class="menu-info">
                        <h4 class="menu-name">${profitData.itemName}</h4>
                        <div class="menu-meta">
                            <span class="menu-id">ID: ${itemId}</span>
                            <span class="rarity-badge rarity-${item.rarity || 1}">★${item.rarity || 1}</span>
                            ${recipeTime ? `<span class="recipe-time">⏱ ${recipeTime}</span>` : ''}
                        </div>
                    </div>
                </div>

                <!-- Current Profit Summary -->
                <div class="profit-summary">
                    <!-- ... (Same as before) ... -->
                    <div class="profit-row">
                        <span class="profit-label">기본 판매가</span>
                        <span class="profit-value">${profitData.baseSellPrice.toLocaleString()}</span>
                    </div>
                    <div class="profit-row">
                        <span class="profit-label">제작 비용 (골드) <span style="font-size: 0.85em; opacity: 0.7;">(자동 생산)</span></span>
                        <span class="profit-value cost">${profitData.cost.toLocaleString()}</span>
                    </div>
                    ${Object.keys(profitData.costBreakdown.resources || {}).length > 0 ? `
                    <div class="profit-row">
                        <span class="profit-label">추가 재료</span>
                        <span class="profit-value resource-count">${Object.keys(profitData.costBreakdown.resources).length}종</span>
                    </div>
                    ` : ''}
                    <div class="profit-row highlight">
                        <span class="profit-label">최종 판매가</span>
                        <span class="profit-value">${profitData.finalSellPrice.toLocaleString()}</span>
                    </div>
                    <div class="profit-row">
                        <span class="profit-label">판매 횟수</span>
                        <span class="profit-value sales-count">${profitData.salesCount.min === profitData.salesCount.max ? profitData.salesCount.min.toLocaleString() : `${profitData.salesCount.min.toLocaleString()} ~ ${profitData.salesCount.max.toLocaleString()}`}</span>
                    </div>
                    <div class="profit-row profit-${profitClass}">
                        <span class="profit-label">
                            <strong>순이익 (개당)</strong>
                            ${activeEvents.length > 0 ? '<span class="event-active-indicator">🎉</span>' : ''}
                        </span>
                        <span class="profit-value">
                            <strong>${profitData.profit >= 0 ? '+' : ''}${profitData.profit.toLocaleString()}</strong>
                            <small class="${marginClass}">(${profitData.profitMargin}%)</small>
                        </span>
                    </div>
                    <div class="profit-row highlight total-profit">
                        <span class="profit-label"><strong>총 예상수익</strong></span>
                        <span class="profit-value total-value">${profitData.salesCount.min === profitData.salesCount.max ? (profitData.profit * profitData.salesCount.min).toLocaleString() : `${(profitData.profit * profitData.salesCount.min).toLocaleString()}~${(profitData.profit * profitData.salesCount.max).toLocaleString()}`}</span>
                    </div>
                </div>

                ${Object.keys(profitData.costBreakdown.resources || {}).length > 0 ? `
                <!-- Cost Breakdown -->
                <details class="menu-details cost-breakdown-details">
                    <summary>
                        <span class="material-symbols-outlined">account_tree</span>
                        재료 비용 상세
                    </summary>
                    <div class="cost-breakdown-list">
                        ${Object.entries(profitData.costBreakdown.resources).map(([itemId, data]) => `
                            <div class="cost-breakdown-item">
                                <span class="resource-name">${data.name}</span>
                                <span class="resource-amount">${Math.ceil(data.amount).toLocaleString()}</span>
                            </div>
                        `).join('')}
                    </div>
                </details>
                ` : ''}

                <!-- Rank Comparison Table -->
                <details class="menu-details">
                    <summary>
                        <span class="material-symbols-outlined">analytics</span>
                        등급별 수익 비교
                    </summary>
                    <div class="rank-comparison-table">
                        ${allRankProfits.map(data => {
            const isCurrent = data.rank === state.selectedRank;
            const profitClass = data.profit > 0 ? 'positive' : data.profit < 0 ? 'negative' : 'neutral';
            const compMargin = parseFloat(data.profitMargin);
            let compMarginClass = 'margin-very-low';
            if (compMargin >= 91) compMarginClass = 'margin-excellent';
            else if (compMargin >= 81) compMarginClass = 'margin-great';
            else if (compMargin >= 71) compMarginClass = 'margin-good';
            else if (compMargin >= 61) compMarginClass = 'margin-fair';

            return `
                                <div class="rank-comparison-row ${isCurrent ? 'current' : ''}">
                                    <div class="rank-label" style="color: ${RANK_COLORS[data.rank]}">
                                        <span class="material-symbols-outlined">grade</span>
                                        ${RANK_NAMES[data.rank]}
                                        ${isCurrent ? '<span class="current-badge">현재</span>' : ''}
                                    </div>
                                    <div class="rank-sell-price">${data.finalSellPrice.toLocaleString()}</div>
                                    <div class="rank-profit profit-${profitClass}">
                                        ${data.profit >= 0 ? '+' : ''}${data.profit.toLocaleString()}
                                        <small class="${compMarginClass}">(${data.profitMargin}%)</small>
                                    </div>
                                    <div class="rank-sales-count">${data.salesCount.min === data.salesCount.max ? data.salesCount.min.toLocaleString() : `${data.salesCount.min.toLocaleString()}~${data.salesCount.max.toLocaleString()}`}회</div>
                                    <div class="rank-total-profit">${data.salesCount.min === data.salesCount.max ? (data.profit * data.salesCount.min).toLocaleString() : `${(data.profit * data.salesCount.min).toLocaleString()}~${(data.profit * data.salesCount.max).toLocaleString()}`}</div>
                                </div>
                            `;
        }).join('')}
                    </div>
                </details>
                <div class="menu-actions">
                    <button class="menu-action-btn" type="button" onclick="RestaurantModule.viewRecipe(${formulaId})">
                        <span class="material-symbols-outlined">menu_book</span>
                        레시피 보기
                    </button>
                </div>
            </div>
        `;
    }


    // ============================================
    // PLANNER LOGIC
    // ============================================
    /**
     * Planner System Overview:
     * - Each restaurant has 4 menu slots that can be filled with recipes
     * - Each restaurant has a global quantity multiplier (applies to all slots)
     * - Users can save/load up to 5 presets per restaurant
     * - Real-time calculation shows required ingredients as users make selections
     * - Ingredients are grouped by acquisition location for easy reference
     */

    let confirmResolve = null;

    function setupPlannerUI() {
        const openBtn = document.getElementById('planner-open-btn');
        const closeBtn = document.getElementById('planner-modal-close');
        const modal = document.getElementById('planner-modal');

        if (openBtn) openBtn.addEventListener('click', openPlannerModal);
        if (closeBtn) closeBtn.addEventListener('click', closePlannerModal);

        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal || e.target.classList.contains('modal-overlay')) {
                    closePlannerModal();
                }
            });
        }

        setupConfirmModal();
    }

    function setupConfirmModal() {
        const confirmModal = document.getElementById('confirm-modal');
        const confirmClose = document.getElementById('confirm-modal-close');
        const confirmCancel = document.getElementById('confirm-btn-cancel');
        const confirmOk = document.getElementById('confirm-btn-ok');

        if (confirmModal) {
            const closeConfirm = (result) => {
                confirmModal.classList.add('hidden');
                if (confirmResolve) {
                    confirmResolve(result);
                    confirmResolve = null;
                }
            };

            confirmClose?.addEventListener('click', () => closeConfirm(false));
            confirmCancel?.addEventListener('click', () => closeConfirm(false));
            confirmOk?.addEventListener('click', () => closeConfirm(true));

            confirmModal.addEventListener('click', (e) => {
                if (e.target === confirmModal || e.target.classList.contains('modal-overlay')) {
                    closeConfirm(false);
                }
            });
        }
    }

    function openPlannerModal() {
        renderPlannerModal();
        const modal = document.getElementById('planner-modal');
        if (modal) modal.classList.remove('hidden');
    }

    function renderPlannerModal() {
        const content = document.getElementById('planner-modal-content');
        if (!content) return;

        const builderHTML = renderPlannerBuilder();
        const resultsHTML = renderPlannerResultsContent();

        content.innerHTML = `
            <div class="planner-modal-body">
                <div class="planner-builder" id="planner-builder">
                    ${builderHTML}
                </div>
                <div class="planner-results" id="planner-results">
                    ${resultsHTML}
                </div>
            </div>
            <div class="planner-modal-actions">
                <button id="planner-reset-btn" class="planner-btn reset">
                    <span class="material-symbols-outlined">restart_alt</span>
                    초기화
                </button>
                <div class="planner-actions-spacer"></div>
                <button id="planner-calc-btn" class="planner-btn calculate">
                    <span class="material-symbols-outlined">calculate</span>
                    재료 계산
                </button>
            </div>
        `;

        bindPlannerBuilderEvents();

        const resetBtn = document.getElementById('planner-reset-btn');
        const calcBtn = document.getElementById('planner-calc-btn');

        resetBtn?.addEventListener('click', resetPlanner);
        calcBtn?.addEventListener('click', calculateDailyPlan);
    }

    function renderPlannerMainView() {
        const container = document.getElementById('restaurant-planner-view');
        if (!container) return;

        const builderHTML = renderPlannerBuilder();
        const resultsHTML = renderPlannerResultsContent();

        container.innerHTML = `
            <div class="planner-layout-grid">
                <!-- Left: Builder (Restaurant Rows) -->
                <div class="planner-builder-section" id="planner-builder">
                    ${builderHTML}
                    <div class="planner-actions-bar">
                        <button id="planner-reset-btn" class="planner-btn reset">
                            <span class="material-symbols-outlined">restart_alt</span>
                            초기화
                        </button>
                    </div>
                </div>

                <!-- Right: Results (Ingredients) -->
                <div class="planner-results-section" id="planner-results">
                    ${resultsHTML}
                </div>
            </div>
        `;

        bindPlannerBuilderEvents();

        document.getElementById('planner-reset-btn')?.addEventListener('click', resetPlanner);

        // Initial auto-calculation
        calculateDailyPlan(false);
    }

    function refreshPlannerBuilder() {
        const builder = document.getElementById('planner-builder');
        if (!builder) return;
        builder.innerHTML = renderPlannerBuilder();
        bindPlannerBuilderEvents();
    }

    function renderPlannerBuilder() {
        const restaurantIds = getRestaurantIds();
        if (restaurantIds.length === 0) {
            return '<div class="empty-state"><p>레스토랑 데이터가 없습니다.</p></div>';
        }

        return restaurantIds.map(renderPlannerRestaurantCard).join('');
    }

    /**
     * Renders a single restaurant card in the planner view
     * @param {string} restaurantId - The ID of the restaurant to render
     * @returns {string} HTML string for the restaurant card
     */
    function renderPlannerRestaurantCard(restaurantId) {
        const restaurant = state.restaurants[restaurantId];
        const plan = getPlannerEntry(restaurantId);
        const menuOptions = getMenuOptions(restaurantId);
        const menuOptionsMap = new Map(menuOptions.map(opt => [String(opt.formulaId), opt.icon]));

        // Ensure UI state for preset selection (defaults to slot 1)
        if (!state.ui) state.ui = { presetSelections: {} };
        if (!state.ui.presetSelections[restaurantId]) state.ui.presetSelections[restaurantId] = 1;
        const selectedPreset = state.ui.presetSelections[restaurantId];

        const presetVisuals = Array.from({ length: PLANNER_PRESET_COUNT }, (_, idx) => {
            const presetIndex = idx + 1;
            const presetData = state.plannerPresets[restaurantId] && state.plannerPresets[restaurantId][presetIndex];
            const isSelected = presetIndex === selectedPreset;
            const hasData = !!presetData;

            const icons = presetData ? presetData.slots.map(s => {
                if (!s.formulaId) return null;
                return menuOptionsMap.get(String(s.formulaId));
            }).filter(Boolean) : [];

            const iconsHtml = icons.length > 0
                ? `<div class="preset-mini-grid">${icons.slice(0, 4).map(icon => `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${icon}">`).join('')}</div>`
                : `<div class="preset-empty-dash">-</div>`;

            return `
                <div class="preset-visual-slot ${isSelected ? 'selected' : ''} ${hasData ? 'filled' : 'empty'}"
                     onclick="RestaurantModule.selectPresetSlot('${restaurantId}', ${presetIndex})">
                    <div class="preset-slot-num">${presetIndex}</div>
                    ${iconsHtml}
                </div>
            `;
        }).join('');

        const slotsHTML = plan.slots.map((slot, idx) => renderPlannerSlot(restaurantId, idx, slot, menuOptions)).join('');

        return `
            <div class="planner-modern-card">
                <div class="card-header">
                    <div class="header-left">
                        <span class="material-symbols-outlined icon">storefront</span>
                        <span class="restaurant-name">${restaurant ? restaurant.name : `레스토랑 ${restaurantId}`}</span>
                    </div>
                    <div class="header-right">
                        <div class="global-qty-wrapper">
                             <span class="qty-label">생산 수량</span>
                             <div class="qty-control-group">
                                 <button class="qty-btn qty-btn-minus" data-restaurant-id="${restaurantId}" onclick="RestaurantModule.adjustGlobalQty('${restaurantId}', -1)">
                                     <span class="material-symbols-outlined">remove</span>
                                 </button>
                                 <input type="number" class="planner-global-input modern" data-restaurant-id="${restaurantId}" min="0" max="999" value="${plan.globalCount}">
                                 <button class="qty-btn qty-btn-plus" data-restaurant-id="${restaurantId}" onclick="RestaurantModule.adjustGlobalQty('${restaurantId}', 1)">
                                     <span class="material-symbols-outlined">add</span>
                                 </button>
                             </div>
                        </div>
                    </div>
                </div>

                <div class="card-body">
                    <div class="planner-slot-grid horizontal-4 modern">
                        ${slotsHTML}
                    </div>
                </div>

                <div class="card-footer">
                    <div class="preset-control-group">
                         <div class="preset-label-group">
                             <div class="preset-label">프리셋</div>
                             <div class="preset-current-indicator">선택: ${selectedPreset}</div>
                         </div>
                         <div class="planner-preset-visual-row">
                            ${presetVisuals}
                        </div>
                        <div class="planner-preset-actions">
                            <button class="preset-action-btn save" data-action="save" data-restaurant-id="${restaurantId}" title="선택한 슬롯에 저장">
                                <span class="material-symbols-outlined">download</span>
                            </button>
                            <button class="preset-action-btn load" data-action="load" data-restaurant-id="${restaurantId}" title="선택한 슬롯 불러오기">
                                <span class="material-symbols-outlined">upload</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function selectPresetSlot(restaurantId, presetIndex) {
        if (!state.ui) state.ui = { presetSelections: {} };
        state.ui.presetSelections[restaurantId] = presetIndex;
        refreshPlannerBuilder();
    }

    function renderPlannerSlot(restaurantId, slotIndex, slot, menuOptions) {
        const selectedMenu = menuOptions.find(opt => `${opt.formulaId}` === `${slot.formulaId}`);
        const rarityBg = selectedMenu ? RARITY_BACKGROUNDS[selectedMenu.rarity || 1] : '';

        // Custom Slot UI - Click opens modal
        return `
            <div class="planner-slot-custom ${selectedMenu ? 'filled' : 'empty'}"
                 data-restaurant-id="${restaurantId}"
                 data-slot-index="${slotIndex}"
                 onclick="RestaurantModule.openMenuSelectionModal('${restaurantId}')">

                <div class="slot-content">
                    ${selectedMenu ? `
                        <div class="slot-icon" style="background-image: url('${rarityBg}')">
                            <img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${selectedMenu.icon}" alt="${selectedMenu.name}">
                        </div>
                        <div class="slot-name">${selectedMenu.name}</div>
                    ` : `
                        <div class="slot-placeholder">
                            <span class="material-symbols-outlined">add</span>
                            <span>메뉴 선택</span>
                        </div>
                    `}
                </div>
            </div>
        `;
    }

    /**
     * Opens a modal for selecting menus for all slots in a restaurant
     * Shows ingredient preview for each menu
     */
    function openMenuSelectionModal(restaurantId) {
        const restaurant = state.restaurants[restaurantId];
        const plan = getPlannerEntry(restaurantId);
        const menuOptions = getMenuOptions(restaurantId);

        const modalHtml = `
            <div class="menu-selection-modal-overlay" onclick="RestaurantModule.closeMenuSelectionModal()">
                <div class="menu-selection-modal" onclick="event.stopPropagation()">
                    <div class="menu-modal-header">
                        <h3>
                            <span class="material-symbols-outlined">restaurant</span>
                            ${restaurant.name} - 메뉴 선택
                        </h3>
                        <button class="modal-close-btn" onclick="RestaurantModule.closeMenuSelectionModal()">
                            <span class="material-symbols-outlined">close</span>
                        </button>
                    </div>
                    <div class="menu-modal-body">
                        <div class="menu-modal-slots">
                            ${plan.slots.map((slot, idx) => {
            const selected = menuOptions.find(opt => `${opt.formulaId}` === `${slot.formulaId}`);
            return `
                                    <div class="menu-modal-slot ${selected ? 'selected' : ''} ${idx === 0 ? 'active' : ''}"
                                         onclick="RestaurantModule.selectSlotForModal(${idx})">
                                        <div class="slot-number">슬롯 ${idx + 1}</div>
                                        <div class="slot-current">
                                            ${selected ? `
                                                <img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${selected.icon}" alt="${selected.name}">
                                                <span>${selected.name}</span>
                                            ` : '<span class="empty-text">없음</span>'}
                                        </div>
                                    </div>
                                `;
        }).join('')}
                        </div>
                        <div class="menu-modal-current-slot">
                            현재 선택 중: <strong>슬롯 1</strong>
                        </div>
                        <div class="menu-modal-options">
                            <div class="menu-option-item" onclick="RestaurantModule.selectMenusFromModal('${restaurantId}', null)">
                                <div class="menu-option-icon empty-icon">
                                    <span class="material-symbols-outlined">close</span>
                                </div>
                                <div class="menu-option-name">선택 해제</div>
                            </div>
                            ${menuOptions.map(opt => {
            const ingredients = getMenuIngredientPreview(opt.formulaId);
            return `
                                    <div class="menu-option-item" onclick="RestaurantModule.selectMenusFromModal('${restaurantId}', '${opt.formulaId}')">
                                        <div class="menu-option-icon" style="background-image: url('${RARITY_BACKGROUNDS[opt.rarity || 1]}')">
                                            <img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${opt.icon}" alt="${opt.name}">
                                        </div>
                                        <div class="menu-option-details">
                                            <div class="menu-option-name">${opt.name}</div>
                                            ${ingredients.length > 0 ? `
                                                <div class="menu-option-ingredients">
                                                    ${ingredients.slice(0, 6).map(ing => `
                                                        <img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${ing.icon}" alt="${ing.name}" data-name="${ing.name}">
                                                    `).join('')}
                                                    ${ingredients.length > 6 ? `<span class="more-count">+${ingredients.length - 6}</span>` : ''}
                                                </div>
                                            ` : ''}
                                        </div>
                                    </div>
                                `;
        }).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Insert modal into DOM
        const existingModal = document.querySelector('.menu-selection-modal-overlay');
        if (existingModal) existingModal.remove();

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        state.currentMenuModalRestaurant = restaurantId;
        state.currentMenuModalSlot = 0;
    }

    function getMenuIngredientPreview(formulaId) {
        const tree = IslandEngine.buildRecipeDependencyTree(
            formulaId,
            state.recipeIndex,
            state.recipeCategoryIndex,
            state.dependencyGraph,
            state.shopPurchaseData,
            { useManualMode: false, quantityMultiplier: 1, shouldStopRecursion: (rId, rCat) => rCat === '1' || rCat === '2' }
        );

        const ingredients = {};
        if (tree) {
            aggregateIngredients(tree, ingredients, true);
        }

        return Object.values(ingredients).map(ing => ({
            name: ing.name,
            icon: ing.icon ? ing.icon.split('/').pop() + '.png' : ''
        }));
    }

    function selectSlotForModal(slotIndex) {
        state.currentMenuModalSlot = slotIndex;
        // Update UI to show selected slot
        document.querySelectorAll('.menu-modal-slot').forEach((el, idx) => {
            if (idx === slotIndex) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        });

        // Update current slot indicator
        const indicator = document.querySelector('.menu-modal-current-slot strong');
        if (indicator) {
            indicator.textContent = `슬롯 ${slotIndex + 1}`;
        }
    }

    function selectMenusFromModal(restaurantId, formulaId) {
        const slot = state.currentMenuModalSlot !== undefined ? state.currentMenuModalSlot : 0;
        const entry = getPlannerEntry(restaurantId);

        if (formulaId === null) {
            // Clear selection
            entry.slots[slot].formulaId = '';
        } else {
            // Set selection
            entry.slots[slot].formulaId = formulaId;
        }

        state.plannerDirty = true;
        savePlannerPlan();

        // Just refresh the modal content without closing
        refreshModalSlots(restaurantId);

        updatePlannerUI();
        calculateDailyPlan(false);
    }

    function refreshModalSlots(restaurantId) {
        const plan = getPlannerEntry(restaurantId);
        const menuOptions = getMenuOptions(restaurantId);

        document.querySelectorAll('.menu-modal-slot').forEach((slotEl, idx) => {
            const slot = plan.slots[idx];
            const selected = menuOptions.find(opt => `${opt.formulaId}` === `${slot.formulaId}`);
            const slotCurrent = slotEl.querySelector('.slot-current');

            if (selected) {
                slotEl.classList.add('selected');
                slotCurrent.innerHTML = `
                    <img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${selected.icon}" alt="${selected.name}">
                    <span>${selected.name}</span>
                `;
            } else {
                slotEl.classList.remove('selected');
                slotCurrent.innerHTML = '<span class="empty-text">없음</span>';
            }
        });
    }

    function closeMenuSelectionModal() {
        const modal = document.querySelector('.menu-selection-modal-overlay');
        if (modal) modal.remove();
        state.currentMenuModalRestaurant = null;
        state.currentMenuModalSlot = 0;
        refreshPlannerBuilder();
    }

    function getMenuOptions(restaurantId) {
        const restaurant = state.restaurants[restaurantId];
        if (!restaurant) return [];
        return (restaurant.item_id || []).map(([itemId, formulaId]) => {
            const item = state.items[itemId];
            return {
                itemId,
                formulaId,
                name: item ? item.name : `Menu ${itemId}`,
                rarity: item ? item.rarity : 1,
                icon: item && item.icon ? item.icon.split('/').pop() + '.png' : ''
            };
        });
    }

    function adjustGlobalQty(restaurantId, delta) {
        const entry = getPlannerEntry(restaurantId);
        const newValue = Math.max(0, Math.min(999, entry.globalCount + delta));
        entry.globalCount = newValue;

        // Update input value
        const input = document.querySelector(`.planner-global-input[data-restaurant-id="${restaurantId}"]`);
        if (input) input.value = newValue;

        state.plannerDirty = true;
        savePlannerPlan();
        updatePlannerUI();
        calculateDailyPlan(false);
    }

    function bindPlannerBuilderEvents() {
        const container = document.getElementById('planner-builder') || document;

        container.querySelectorAll('.planner-global-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const restaurantId = e.target.dataset.restaurantId;
                const value = Math.max(0, parseInt(e.target.value, 10) || 0);
                const entry = getPlannerEntry(restaurantId);
                entry.globalCount = value;
                state.plannerDirty = true;
                savePlannerPlan();
                updatePlannerUI();
                calculateDailyPlan(false); // Real-time calculation (silent)
            });
        });

        container.querySelectorAll('.preset-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const restaurantId = e.currentTarget.dataset.restaurantId;
                const action = e.currentTarget.dataset.action;
                const presetIndex = (state.ui && state.ui.presetSelections && state.ui.presetSelections[restaurantId]) || 0;
                handlePresetAction(action, restaurantId, presetIndex);
            });
        });
    }

    function handleSlotSelection(restaurantId, slotIndex, formulaId) {
        const entry = getPlannerEntry(restaurantId);
        const slot = entry.slots[slotIndex] || { formulaId: '' };
        slot.formulaId = formulaId;
        entry.slots[slotIndex] = slot;
        state.plannerDirty = true;
        savePlannerPlan();
        updatePlannerUI();
        refreshPlannerBuilder(); // Re-render to show selection
        calculateDailyPlan(false); // Real-time calculation (silent)
    }

    function handleSlotCountChange(restaurantId, slotIndex, qty) {
        // Deprecated/Removed functionality but kept signature if needed or just remove
    }

    function applyGlobalCount(restaurantId) {
        // Deprecated/Removed functionality
    }

    function handlePresetAction(action, restaurantId, presetIndex) {
        const entry = getPlannerEntry(restaurantId);
        if (!state.plannerPresets[restaurantId]) {
            state.plannerPresets[restaurantId] = {};
        }

        if (action === 'save') {
            state.plannerPresets[restaurantId][presetIndex] = clonePlannerEntry(entry);
            savePlannerPresets();
            refreshPlannerBuilder(); // Immediately update UI to show saved preset
            IslandEngine.showToast(`${state.restaurants[restaurantId]?.name || restaurantId}의 프리셋 ${presetIndex}이(가) 저장되었습니다.`, 'success');
        } else if (action === 'load') {
            const preset = state.plannerPresets[restaurantId][presetIndex];
            if (!preset) {
                IslandEngine.showToast('이 슬롯에 저장된 프리셋이 없습니다.', 'info');
                return;
            }
            state.plannerPlan[restaurantId] = clonePlannerEntry(preset);
            state.plannerDirty = true;
            savePlannerPlan();
            refreshPlannerBuilder();
            renderPlannerResultsSection();
            IslandEngine.showToast(`프리셋 ${presetIndex}을(를) 불러왔습니다.`, 'success');
        }

        updatePlannerUI();
    }

    function clonePlannerEntry(entry) {
        return {
            globalCount: entry.globalCount,
            slots: entry.slots.map(slot => ({
                formulaId: slot.formulaId || '',
                count: slot.count || 0
            }))
        };
    }

    async function resetPlanner() {
        const confirmed = await showConfirm('현재 플래너 선택을 모두 초기화할까요?');
        if (!confirmed) return;

        state.plannerPlan = createDefaultPlannerPlan();
        state.lastPlannerResults = null;
        state.plannerDirty = true;
        savePlannerPlan();

        updatePlannerUI();
        renderPlannerResultsSection();
        const modal = document.getElementById('planner-modal');
        if (modal && !modal.classList.contains('hidden')) {
            renderPlannerModal();
        }

        IslandEngine.showToast('플래너가 초기화되었습니다.', 'info');
    }

    function updatePlannerUI() {
        const summaryEl = document.getElementById('planner-selection-summary');
        if (!summaryEl) return;

        let filledSlots = 0;
        let totalQty = 0;

        Object.values(state.plannerPlan).forEach(entry => {
            entry.slots.forEach(slot => {
                if (slot.formulaId) {
                    filledSlots += 1;
                    totalQty += Number(slot.count) || 0;
                }
            });
        });

        if (filledSlots === 0) {
            summaryEl.textContent = '선택된 메뉴 없음';
        } else {
            summaryEl.textContent = `${filledSlots}개 메뉴 선택됨, 총 ${totalQty.toLocaleString()}개 생산`;
        }
    }

    function calculateDailyPlan(arg) {
        const silent = arg === false;
        const selections = getPlannerSelections();
        if (selections.length === 0) {
            if (!silent) IslandEngine.showToast('선택된 메뉴가 없습니다.', 'info');
            return;
        }

        const ingredients = {}; // { itemId: { name, icon, quantity, location } }

        selections.forEach(selection => {
            const qty = Math.max(0, parseInt(selection.qty, 10) || 0);
            if (!selection.formulaId || qty <= 0) return;

            const stopCondition = (recipeId, recipeCategory) => {
                return recipeCategory === '1' || recipeCategory === '2';
            };

            const tree = IslandEngine.buildRecipeDependencyTree(
                selection.formulaId,
                state.recipeIndex,
                state.recipeCategoryIndex,
                state.dependencyGraph,
                state.shopPurchaseData,
                {
                    useManualMode: false,
                    quantityMultiplier: qty,
                    shouldStopRecursion: stopCondition
                }
            );

            if (tree) {
                aggregateIngredients(tree, ingredients);
            }
        });

        const selectionSummary = buildSelectionSummary(selections);
        const groupedIngredients = groupIngredientsByLocation(ingredients);

        state.lastPlannerResults = {
            groupedIngredients,
            selectionSummary
        };
        state.plannerDirty = false;

        renderPlannerResultsSection();
        if (!silent) IslandEngine.showToast('원자재 계산을 완료했습니다.', 'success');
    }

    function getPlannerSelections() {
        const selections = [];
        Object.entries(state.plannerPlan).forEach(([restaurantId, entry]) => {
            const globalQty = parseInt(entry.globalCount, 10) || 0;
            entry.slots.forEach((slot, idx) => {
                if (slot.formulaId && globalQty > 0) {
                    selections.push({
                        restaurantId,
                        slotIndex: idx,
                        formulaId: slot.formulaId,
                        qty: globalQty
                    });
                }
            });
        });
        return selections;
    }

    function buildSelectionSummary(selections) {
        const summary = {};
        selections.forEach(sel => {
            const recipe = state.recipeIndex[sel.formulaId];
            let itemId = null;
            let itemName = `Formula ${sel.formulaId}`;
            let rarity = 1;

            if (recipe && recipe.commission_product && recipe.commission_product.length > 0) {
                itemId = recipe.commission_product[0][0];
                const item = state.items[itemId];
                if (item) {
                    itemName = item.name;
                    rarity = item.rarity;
                }
            }

            if (!summary[sel.restaurantId]) summary[sel.restaurantId] = [];
            summary[sel.restaurantId].push({
                formulaId: sel.formulaId,
                qty: sel.qty,
                itemId,
                itemName,
                rarity
            });
        });
        return summary;
    }

    function aggregateIngredients(node, resultObj) {
        if (node.isStopNode || node.isShopPurchase) {
            const itemId = node.itemId;
            const itemInfo = node.itemInfo || IslandEngine.getItemInfo(itemId) || state.items[itemId] || {};
            const qty = node.quantityNeeded || node.quantity || 0;

            if (!resultObj[itemId]) {
                resultObj[itemId] = {
                    id: itemId,
                    name: itemInfo.name,
                    icon: itemInfo.icon,
                    quantity: 0,
                    rarity: itemInfo.rarity,
                    location: getIngredientLocation(itemId)
                };
            }
            resultObj[itemId].quantity += qty;
            return;
        }

        if (node.dependencies && node.dependencies.length > 0) {
            node.dependencies.forEach(dep => aggregateIngredients(dep, resultObj));
        }
    }

    function getIngredientLocation(itemId) {
        const itemInfo = state.items[itemId];
        if (itemInfo && Array.isArray(itemInfo.jump_page) && itemInfo.jump_page.length > 0) {
            const label = itemInfo.jump_page[0] && itemInfo.jump_page[0][0];
            if (label) return label;
        }
        return '기타';
    }

    function groupIngredientsByLocation(ingredients) {
        const groups = {};
        Object.values(ingredients).forEach(item => {
            const location = item.location || '기타';
            if (!groups[location]) groups[location] = [];
            groups[location].push(item);
        });

        Object.values(groups).forEach(list => {
            list.sort((a, b) => (b.rarity || 0) - (a.rarity || 0));
        });

        return Object.keys(groups).sort().reduce((acc, key) => {
            acc[key] = groups[key];
            return acc;
        }, {});
    }

    function renderPlannerResultsSection() {
        const container = document.getElementById('planner-results');
        if (!container) return;
        container.innerHTML = renderPlannerResultsContent();
    }

    function renderPlannerResultsContent() {
        const masterGroups = state.masterIngredients || {};
        const calculatedGroups = (state.lastPlannerResults && state.lastPlannerResults.groupedIngredients) || {};

        // Build a lookup for calculated quantities
        const calculatedQuantities = {};
        Object.values(calculatedGroups).flat().forEach(item => {
            calculatedQuantities[item.id] = item.quantity;
        });

        const specialBottom = ["한가로운 목장", "지도에서 채집"];
        const locations = Object.keys(masterGroups).sort((a, b) => {
            const indexA = specialBottom.indexOf(a);
            const indexB = specialBottom.indexOf(b);

            if (indexA !== -1 && indexB !== -1) return indexA - indexB; // Both in bottom list
            if (indexA !== -1) return 1; // A is bottom
            if (indexB !== -1) return -1; // B is bottom
            return a.localeCompare(b); // Standard sort
        });

        const groupHtml = locations.length === 0 ? '<div class="planner-empty-state"><p>데이터를 불러오는 중입니다...</p></div>' : locations.map(location => `
            <div class="planner-result-group-card">
                <div class="group-header">
                    <span class="material-symbols-outlined">map</span>
                    <span>${location}</span>
                </div>
                <div class="planner-ingredient-grid compact">
                    ${masterGroups[location].map(item => {
            const qty = calculatedQuantities[item.id] || 0;
            const isActive = qty > 0;
            return `
                        <div class="ingredient-card mini rarity-${item.rarity || 1} ${isActive ? 'active' : ''}" data-name="${item.name}">
                            <div class="ingredient-icon">
                                ${item.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${item.icon.split('/').pop()}.png" alt="${item.name}">` : '<span class="material-symbols-outlined">inventory_2</span>'}
                                ${isActive ? `<span class="ingredient-qty">${Math.ceil(qty).toLocaleString()}</span>` : ''}
                            </div>
                        </div>
                    `;
        }).join('')}
                </div>
            </div>
        `).join('');

        return `
            <h4 class="planner-section-title">필요 원자재</h4>
            ${groupHtml}
        `;
    }

    function renderSelectionSummary(selectionSummary) {
        const restaurantIds = Object.keys(selectionSummary);
        if (restaurantIds.length === 0) {
            return '<div class="planner-empty-state"><p>선택된 메뉴가 없습니다.</p></div>';
        }

        return `
            <div class="planner-meal-summary">
                <h4>선택한 메뉴</h4>
                <div class="planner-meal-list">
                    ${restaurantIds.map(restaurantId => {
            const restaurantName = state.restaurants[restaurantId]?.name || `Restaurant ${restaurantId}`;
            const menus = selectionSummary[restaurantId];
            const itemsHtml = menus.map(menu => `
                            <li class="planner-meal-item">
                                <span class="planner-meal-qty">${menu.qty}x</span>
                                <span class="planner-meal-name rarity-${menu.rarity}">${menu.itemName}</span>
                            </li>
                        `).join('');
            return `
                            <div class="planner-restaurant-group">
                                <div class="planner-restaurant-name">${restaurantName}</div>
                                <ul class="planner-meal-items">
                                    ${itemsHtml}
                                </ul>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;
    }

    function closePlannerModal() {
        const modal = document.getElementById('planner-modal');
        if (modal) modal.classList.add('hidden');
    }

    function showConfirm(message) {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirm-modal');
            const msgEl = document.getElementById('confirm-message');
            if (!modal || !msgEl) {
                resolve(window.confirm(message)); // Fallback
                return;
            }

            msgEl.textContent = message;
            confirmResolve = resolve;
            modal.classList.remove('hidden');
        });
    }
    // ============================================ 
    // PUBLIC API
    // ============================================ 

    return {
        init,
        navigateToMenu,
        getRestaurantsForRecipe,
        viewRecipe,
        openMenuSelectionModal,
        selectMenusFromModal,
        selectSlotForModal,
        closeMenuSelectionModal,
        adjustGlobalQty,
        selectPresetSlot,
        selectRestaurant,
        closePlannerModal, // Export for HTML onClick
        state: () => state // For debugging
    };

})();
