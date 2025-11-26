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

    const EVENT_BONUSES = {
        manjuu_tour: { name: '만쥬 투어 그룹', bonus: 0.10 },
        health_day: { name: '건강의 날', bonus: 0.20 },
        food_review: { name: '요리 리뷰', bonus: 0.30 }
    };

    const RARITY_BACKGROUNDS = {
        1: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/rarity_gray.png',
        2: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/rarity_blue.png',
        3: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/rarity_purple.png',
        4: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/rarity_orange.png'
    };

    const STORAGE_KEY_RANK = 'island-restaurant-rank';
    const STORAGE_KEY_EVENTS = 'island-restaurant-events';

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
        highlightFormulaId: null
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
            const [restaurantData, recipeData, shopData] = await Promise.all([
                IslandEngine.fetchJSON('data/island/island_manage_restaurant.json'),
                IslandEngine.fetchJSON('data/island/recipes.json'),
                IslandEngine.fetchJSON('data/island/island_shop_goods.json')
            ]);

            // Filter out "all" field from restaurant data
            state.restaurants = Object.fromEntries(
                Object.entries(restaurantData).filter(([key]) => key !== 'all')
            );
            
            state.recipes = recipeData;

            // Build data structures for tree-based cost calculation
            buildMenuIndex();
            buildShopDataIndex(shopData);
            buildRecipeIndices();
            buildDependencyGraph();

            // Load saved preferences
            loadPreferences();

            // Select first restaurant by default
            const firstRestaurantId = Object.keys(state.restaurants)[0];
            if (firstRestaurantId) {
                state.selectedRestaurant = firstRestaurantId;
            }

            // Render UI
            renderRestaurantTabs();
            renderRankSelector();
            renderEventToggles();
            renderMenuList();

            return true;
        } catch (error) {
            console.error('[Restaurant] Initialization failed:', error);
            IslandEngine.showError('레스토랑 데이터를 불러오는데 실패했습니다.');
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

    function buildShopDataIndex(shopData) {
        Object.entries(shopData).forEach(([shopEntryId, shopItem]) => {
            if (shopItem.items && shopItem.resource_consume) {
                const items = shopItem.items;
                if (items.length > 0) {
                    const actualItemId = items[0][1];
                    const packSize = items[0][2];
                    const requiredItemId = shopItem.resource_consume[1];
                    const cost = shopItem.resource_consume[2];

                    state.shopPurchaseData[actualItemId] = [requiredItemId, cost, packSize];
                }
            }
        });
    }

    function buildRecipeIndices() {
        state.recipeIndex = {};
        state.recipeCategoryIndex = {};

        Object.entries(state.recipes).forEach(([categoryId, recipes]) => {
            recipes.forEach(recipe => {
                state.recipeIndex[recipe.id] = recipe;
                state.recipeCategoryIndex[recipe.id] = categoryId;
            });
        });
    }

    function buildDependencyGraph() {
        Object.entries(state.recipes).forEach(([category, recipes]) => {
            recipes.forEach(recipe => {
                // Track what this recipe produces
                (recipe.commission_product || []).forEach(([itemId]) => {
                    if (!state.dependencyGraph.producedBy[itemId]) {
                        state.dependencyGraph.producedBy[itemId] = [];
                    }
                    state.dependencyGraph.producedBy[itemId].push(recipe.id);
                });

                // Track what this recipe uses
                (recipe.commission_cost || []).forEach(([itemId]) => {
                    if (!state.dependencyGraph.usedBy[itemId]) {
                        state.dependencyGraph.usedBy[itemId] = [];
                    }
                    state.dependencyGraph.usedBy[itemId].push(recipe.id);
                });
            });
        });
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
        } catch (error) {
            console.error('[Restaurant] Failed to load preferences:', error);
        }
    }

    function savePreferences() {
        try {
            localStorage.setItem(STORAGE_KEY_RANK, state.selectedRank);
            localStorage.setItem(STORAGE_KEY_EVENTS, JSON.stringify(Array.from(state.activeEvents)));
        } catch (error) {
            console.error('[Restaurant] Failed to save preferences:', error);
        }
    }

    // ============================================
    // PRICE CALCULATION
    // ============================================

    /**
     * Calculate the production cost of a menu item using dependency tree
     * Backtracks through recipe dependencies to shop-buyable materials
     */
    function calculateMenuCost(formulaId) {
        if (!formulaId) {
            return { gold: 0, resources: {} };
        }

        // Build dependency tree using shared utility
        const tree = IslandEngine.buildRecipeDependencyTree(
            formulaId,
            state.recipeIndex,
            state.recipeCategoryIndex,
            state.dependencyGraph,
            state.shopPurchaseData,
            { useManualMode: true, quantityMultiplier: 1 }
        );

        if (!tree) {
            return { gold: 0, resources: {} };
        }

        // Calculate total cost from tree
        const costs = IslandEngine.calculateTreeCost(tree);

        return costs;
    }

    /**
     * Calculate profit for a menu item
     */
    function calculateProfit(itemId, formulaId, rank = 'silver', events = []) {
        const item = state.items[itemId];
        if (!item) return null;

        const baseSellPrice = item.order_price || 0;
        const costData = calculateMenuCost(formulaId);
        const goldCost = costData.gold || 0;

        // Apply rank coefficient
        const rankCoeff = RANK_COEFFICIENTS[rank] || 1.0;

        // Calculate total event bonus
        let eventBonus = 0;
        events.forEach(eventKey => {
            if (EVENT_BONUSES[eventKey]) {
                eventBonus += EVENT_BONUSES[eventKey].bonus;
            }
        });

        // Final selling price = base * rank_coeff * (1 + event_bonus)
        const finalSellPrice = baseSellPrice * rankCoeff * (1 + eventBonus);
        const profit = finalSellPrice - goldCost;
        const profitMargin = finalSellPrice > 0 ? (profit / finalSellPrice) * 100 : 0;

        return {
            itemId,
            itemName: item.name || `Item ${itemId}`,
            baseSellPrice,
            cost: goldCost,
            costBreakdown: costData, // Include full breakdown (gold + resources)
            rankCoeff,
            eventBonus,
            finalSellPrice: Math.round(finalSellPrice),
            profit: Math.round(profit),
            profitMargin: profitMargin.toFixed(1)
        };
    }

    // ============================================
    // CROSS-TAB NAVIGATION
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

        // Focus after render
        setTimeout(() => focusMenuCard(formulaId), 150);
    }

    function viewRecipe(formulaId) {
        if (!window.ResourceModule || !ResourceModule.selectRecipe) return;
        IslandEngine.activateTab('resources');
        ResourceModule.selectRecipe(formulaId);
    }

    function focusMenuCard(formulaId) {
        const card = document.querySelector(`.menu-card[data-formula-id=\"${formulaId}\"]`);
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
            .sort(([a], [b]) => parseInt(a) - parseInt(b));

        const html = restaurants.map(([id, restaurant]) => `
            <button class="restaurant-tab ${state.selectedRestaurant === id ? 'active' : ''}"
                    data-restaurant-id="${id}">
                <span class="material-symbols-outlined">restaurant</span>
                <span class="restaurant-tab-name">${restaurant.name}</span>
            </button>
        `).join('');

        container.innerHTML = html;

        // Attach event listeners
        container.querySelectorAll('.restaurant-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                selectRestaurant(tab.dataset.restaurantId);
            });
        });
    }

    function selectRestaurant(restaurantId) {
        state.selectedRestaurant = restaurantId;

        // Update tab states
        document.querySelectorAll('.restaurant-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.restaurantId === restaurantId);
        });

        // Re-render menu list
        renderMenuList();
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

        // Attach event listeners
        container.querySelectorAll('.rank-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                selectRank(btn.dataset.rank);
            });
        });
    }

    function selectRank(rank) {
        state.selectedRank = rank;
        savePreferences();

        // Update button states
        document.querySelectorAll('.rank-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.rank === rank);
        });

        // Recalculate and re-render menu list
        renderMenuList();
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

        // Attach event listeners
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

        // Recalculate and re-render menu list
        renderMenuList();
    }

    // ============================================
    // MENU LIST
    // ============================================

    function renderMenuList() {
        const container = document.getElementById('restaurant-menu-list');
        if (!container) return;

        const restaurant = state.restaurants[state.selectedRestaurant];
        if (!restaurant) {
            container.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-outlined">restaurant_menu</span>
                    <h3>레스토랑을 선택하세요</h3>
                </div>
            `;
            return;
        }

        const menus = restaurant.item_id || [];
        if (menus.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-outlined">no_meals</span>
                    <h3>메뉴가 없습니다</h3>
                </div>
            `;
            return;
        }

        const html = menus.map(([itemId, formulaId]) => {
            return createMenuCard(itemId, formulaId);
        }).join('');

        container.innerHTML = html;

        if (state.highlightFormulaId) {
            focusMenuCard(state.highlightFormulaId);
            state.highlightFormulaId = null;
        }
    }

    function createMenuCard(itemId, formulaId) {
        const activeEvents = Array.from(state.activeEvents);
        const profitData = calculateProfit(itemId, formulaId, state.selectedRank, activeEvents);

        if (!profitData) {
            return `
                <div class="menu-card error">
                    <p>메뉴 정보를 불러올 수 없습니다 (Item ${itemId})</p>
                </div>
            `;
        }

        const item = state.items[itemId];
        const profitClass = profitData.profit > 0 ? 'positive' : profitData.profit < 0 ? 'negative' : 'neutral';
        
        // Determine margin class based on percentage ranges
        const margin = parseFloat(profitData.profitMargin);
        let marginClass = 'margin-very-low';
        if (margin >= 91) marginClass = 'margin-excellent';
        else if (margin >= 81) marginClass = 'margin-great';
        else if (margin >= 71) marginClass = 'margin-good';
        else if (margin >= 61) marginClass = 'margin-fair';

        // Calculate profit for all rank combinations (for comparison)
        const allRankProfits = Object.keys(RANK_COEFFICIENTS).map(rank => {
            const data = calculateProfit(itemId, formulaId, rank, activeEvents);
            return { rank, ...data };
        });

        const rarityBackground = RARITY_BACKGROUNDS[item.rarity] || '';

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
                        </div>
                    </div>
                </div>

                <!-- Current Profit Summary -->
                <div class="profit-summary">
                    <div class="profit-row">
                        <span class="profit-label">기본 판매가</span>
                        <span class="profit-value">${profitData.baseSellPrice.toLocaleString()}</span>
                    </div>
                    <div class="profit-row">
                        <span class="profit-label">제작 비용 (골드)</span>
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
                    <div class="profit-row profit-${profitClass}">
                        <span class="profit-label">
                            <strong>순이익</strong>
                            ${activeEvents.length > 0 ? '<span class="event-active-indicator">🎉</span>' : ''}
                        </span>
                        <span class="profit-value">
                            <strong>${profitData.profit >= 0 ? '+' : ''}${profitData.profit.toLocaleString()}</strong>
                            <small class="${marginClass}">(${profitData.profitMargin}%)</small>
                        </span>
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
                                <span class="resource-amount">${Math.round(data.amount).toLocaleString()}</span>
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
                            
                            // Calculate margin class for comparison table
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
    // PUBLIC API
    // ============================================

    return {
        init,
        navigateToMenu,
        getRestaurantsForRecipe,
        viewRecipe,
        state: () => state // For debugging
    };

})();
