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
        plannerState: {} // { [restaurantId]: { [formulaId]: quantity } }
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

            // Initialize default attribute values for all sub-attributes
            state.uniqueSubAttributes.forEach(attrId => {
                if (!state.shipgirl1Attr[attrId]) state.shipgirl1Attr[attrId] = 'E';
                if (!state.shipgirl2Attr[attrId]) state.shipgirl2Attr[attrId] = 'E';
            });

            // Load saved preferences
            loadPreferences();

            // Select first restaurant by default
            const firstRestaurantId = Object.keys(state.restaurants)
                .filter(id => id !== 'all')
                .sort((a, b) => parseInt(a) - parseInt(b))[0];
            
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
        } catch (error) {
            console.error('[Restaurant] Failed to save preferences:', error);
        }
    }

    // ============================================ 
    // PRICE CALCULATION
    // ============================================ 

    function calculateMenuCost(formulaId) {
        if (!formulaId) {
            return { gold: 0, resources: {} };
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

        return { min: minSales, max: maxSales, base: baseCount };
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

        const html = restaurants.map(([id, restaurant]) => `
            <button class="restaurant-tab ${state.selectedRestaurant === id ? 'active' : ''}"
                    data-restaurant-id="${id}">
                <span class="material-symbols-outlined">restaurant</span>
                <span class="restaurant-tab-name">${restaurant.name}</span>
            </button>
        `).join('');

        container.innerHTML = html;

        container.querySelectorAll('.restaurant-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                selectRestaurant(tab.dataset.restaurantId);
            });
        });
    }

    function selectRestaurant(restaurantId) {
        state.selectedRestaurant = restaurantId;
        document.querySelectorAll('.restaurant-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.restaurantId === restaurantId);
        });
        renderMenuList();
        updatePlannerUI(); // Update UI for planner counts
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

        // Add event listeners for planner controls
        container.querySelectorAll('.planner-qty-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const formulaId = btn.dataset.formulaId;
                const restaurantId = btn.dataset.restaurantId;
                const action = btn.dataset.action; // 'increase' or 'decrease'
                updatePlannerQuantity(restaurantId, formulaId, action === 'increase' ? 1 : -1);
            });
        });

        container.querySelectorAll('.planner-qty-input').forEach(input => {
            input.addEventListener('change', (e) => {
                e.stopPropagation();
                const formulaId = input.dataset.formulaId;
                const restaurantId = input.dataset.restaurantId;
                const newValue = parseInt(e.target.value) || 0;
                setPlannerQuantity(restaurantId, formulaId, newValue);
            });
            input.addEventListener('click', (e) => e.stopPropagation());
        });

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
        const plannerQty = (state.plannerState[restaurantId] && state.plannerState[restaurantId][formulaId]) || 0;

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

                <!-- Planner Control -->
                <div class="menu-planner-control">
                    <label>일일 생산량:</label>
                    <div class="planner-qty-control">
                        <button class="planner-qty-btn decrease" data-action="decrease" data-formula-id="${formulaId}" data-restaurant-id="${restaurantId}"><span class="material-symbols-outlined">remove</span></button>
                        <input type="number" class="planner-qty-input" data-formula-id="${formulaId}" data-restaurant-id="${restaurantId}" value="${plannerQty}" min="0" max="999">
                        <button class="planner-qty-btn increase" data-action="increase" data-formula-id="${formulaId}" data-restaurant-id="${restaurantId}"><span class="material-symbols-outlined">add</span></button>
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

    let confirmResolve = null;

    function setupPlannerUI() {
        const resetBtn = document.getElementById('planner-reset-btn');
        const calcBtn = document.getElementById('planner-calc-btn');
        const closeBtn = document.getElementById('planner-modal-close');
        
        if (resetBtn) resetBtn.addEventListener('click', resetPlanner);
        if (calcBtn) calcBtn.addEventListener('click', calculateDailyPlan);
        if (closeBtn) closeBtn.addEventListener('click', closePlannerModal);
        
        // Also close modal when clicking overlay
        const modal = document.getElementById('planner-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal || e.target.classList.contains('modal-overlay')) {
                    closePlannerModal();
                }
            });
        }

        // Confirm Modal Setup
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

    function updatePlannerQuantity(restaurantId, formulaId, delta) {
        if (!state.plannerState[restaurantId]) state.plannerState[restaurantId] = {};
        
        const currentQty = state.plannerState[restaurantId][formulaId] || 0;
        const newQty = Math.max(0, currentQty + delta);
        
        setPlannerQuantity(restaurantId, formulaId, newQty);
    }

    function setPlannerQuantity(restaurantId, formulaId, qty) {
        if (!state.plannerState[restaurantId]) state.plannerState[restaurantId] = {};
        
        if (qty <= 0) {
            delete state.plannerState[restaurantId][formulaId];
            if (Object.keys(state.plannerState[restaurantId]).length === 0) {
                delete state.plannerState[restaurantId];
            }
        } else {
            state.plannerState[restaurantId][formulaId] = qty;
        }
        
        // Update input field if it exists in current view
        const input = document.querySelector(`.planner-qty-input[data-formula-id="${formulaId}"][data-restaurant-id="${restaurantId}"]`);
        if (input) {
            input.value = qty > 0 ? qty : 0;
        }
        
        updatePlannerUI();
    }

    async function resetPlanner() {
        const confirmed = await showConfirm('식단 계획을 모두 초기화하시겠습니까?');
        if (!confirmed) return;
        
        state.plannerState = {};
        
        // Reset all inputs in current view
        document.querySelectorAll('.planner-qty-input').forEach(input => {
            input.value = 0;
        });
        
        updatePlannerUI();
        IslandEngine.showToast('식단 계획이 초기화되었습니다.', 'info');
    }

    function updatePlannerUI() {
        const bar = document.getElementById('meal-planner-bar');
        const countSpan = document.getElementById('planner-count');
        
        if (!bar || !countSpan) return;
        
        let totalItems = 0;
        Object.values(state.plannerState).forEach(restaurantMenus => {
            Object.values(restaurantMenus).forEach(qty => {
                totalItems += qty;
            });
        });
        
        countSpan.textContent = totalItems.toLocaleString();
        
        if (totalItems > 0) {
            bar.classList.remove('hidden');
        } else {
            bar.classList.add('hidden');
        }
    }

    function calculateDailyPlan() {
        const ingredients = {}; // { itemId: { name, icon, quantity, breakdown: [] } }

        // Iterate through all selected items in planner
        Object.entries(state.plannerState).forEach(([restaurantId, menus]) => {
            Object.entries(menus).forEach(([formulaId, qty]) => {
                if (qty <= 0) return;

                // Stop recursion at Category 1 (Farming) or Category 2 (Gathering/Mining)
                // This ensures we list "Corn" instead of "Corn Seeds", or "Iron Ore" instead of digging further
                const stopCondition = (recipeId, recipeCategory) => {
                    return recipeCategory === '1' || recipeCategory === '2'; 
                }; 

                const tree = IslandEngine.buildRecipeDependencyTree(
                    formulaId,
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
        });

        showPlannerResults(ingredients);
        IslandEngine.showToast('원자재 계산이 완료되었습니다!', 'success');
    }

    function aggregateIngredients(node, resultObj) {
        // If it's a stop node (Category 1/2 product) or shop purchase
        if (node.isStopNode || node.isShopPurchase) {
            const itemId = node.itemId;
            const itemInfo = node.itemInfo || IslandEngine.getItemInfo(itemId);
            const qty = node.quantityNeeded || node.quantity || 0;

            if (!resultObj[itemId]) {
                resultObj[itemId] = {
                    id: itemId,
                    name: itemInfo.name,
                    icon: itemInfo.icon,
                    quantity: 0,
                    rarity: itemInfo.rarity
                };
            }
            resultObj[itemId].quantity += qty;
            return;
        }

        // Recurse dependencies
        if (node.dependencies && node.dependencies.length > 0) {
            node.dependencies.forEach(dep => aggregateIngredients(dep, resultObj));
        } else if (node.shopCost) { 
             // Handle shop cost if present (fallback for shop items not caught by isShopPurchase if structure differs)
             // ... existing structure usually sets isShopPurchase=true
        }
    }

    function showPlannerResults(ingredients) {
        const modal = document.getElementById('planner-modal');
        const content = document.getElementById('planner-modal-content');
        if (!modal || !content) return;

        const ingredientList = Object.values(ingredients).sort((a, b) => b.rarity - a.rarity);

        // Generate Meal Summary
        let mealSummaryHTML = '';
        const restaurantIds = Object.keys(state.plannerState);
        
        if (restaurantIds.length > 0) {
            mealSummaryHTML += '<div class="planner-meal-summary">';
            mealSummaryHTML += '<h4>선택된 메뉴</h4>';
            mealSummaryHTML += '<div class="planner-meal-list">';
            
            restaurantIds.forEach(restaurantId => {
                const restaurant = state.restaurants[restaurantId];
                const menus = state.plannerState[restaurantId];
                const restaurantName = restaurant ? restaurant.name : `Restaurant ${restaurantId}`;
                
                mealSummaryHTML += `<div class="planner-restaurant-group">`;
                mealSummaryHTML += `<div class="planner-restaurant-name">${restaurantName}</div>`;
                mealSummaryHTML += `<ul class="planner-meal-items">`;
                
                Object.entries(menus).forEach(([formulaId, qty]) => {
                    if (qty <= 0) return;
                    
                    // Find itemId from menuIndex or iterate restaurant data if needed.
                    // Ideally we should have stored itemId in plannerState, but formulaId is unique enough.
                    // We can look up the recipe to find the output item.
                    const recipe = state.recipeIndex[formulaId];
                    let itemName = `Formula ${formulaId}`;
                    let itemIcon = null;
                    let itemRarity = 1;

                    if (recipe && recipe.commission_product && recipe.commission_product.length > 0) {
                        const itemId = recipe.commission_product[0][0]; // Assuming 1st product is main
                        const item = state.items[itemId];
                        if (item) {
                            itemName = item.name;
                            itemIcon = item.icon;
                            itemRarity = item.rarity;
                        }
                    }

                    mealSummaryHTML += `
                        <li class="planner-meal-item">
                            <span class="planner-meal-qty">${qty}x</span>
                            <span class="planner-meal-name rarity-${itemRarity}">${itemName}</span>
                        </li>
                    `;
                });
                
                mealSummaryHTML += `</ul>`;
                mealSummaryHTML += `</div>`;
            });
            
            mealSummaryHTML += '</div></div>';
        }

        if (ingredientList.length === 0) {
            content.innerHTML = `<div class="empty-state"><p>필요한 재료가 없습니다.</p></div>`;
            IslandEngine.showToast('필요한 재료가 없습니다. 메뉴와 수량을 확인해주세요.', 'info');
        } else {
            const html = `
                ${mealSummaryHTML}
                <h4 class="planner-section-title">필요 원자재</h4>
                <div class="planner-ingredient-grid">
                    ${ingredientList.map(item => `
                        <div class="ingredient-card rarity-${item.rarity || 1}">
                            <div class="ingredient-icon">
                                ${item.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${item.icon.split('/').pop()}.png" alt="${item.name}">` : '<span class="material-symbols-outlined">inventory_2</span>'}
                                <span class="ingredient-qty">${Math.ceil(item.quantity).toLocaleString()}</span>
                            </div>
                            <div class="ingredient-name">${item.name}</div>
                        </div>
                    `).join('')}
                </div>
            `;
            content.innerHTML = html;
        }

        modal.classList.remove('hidden');
    }

    function closePlannerModal() {
        const modal = document.getElementById('planner-modal');
        if (modal) modal.classList.add('hidden');
    }

    // ============================================ 
    // PUBLIC API
    // ============================================ 

    return {
        init,
        navigateToMenu,
        getRestaurantsForRecipe,
        viewRecipe,
        closePlannerModal, // Export for HTML onClick
        state: () => state // For debugging
    };

})();