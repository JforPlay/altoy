/**
 * island.restaurant.engine.js
 * Restaurant sub-engine for the island module. Manages restaurant tabs, rank/event/shipgirl selectors,
 * menu list rendering, preferences persistence, and cross-tab navigation with the resource module.
 * Delegates calculations to island.restaurant.calc.js and planner UI to island.restaurant.planner.js.
 * Registers as window.RestaurantModule.
 */

import { fetchJSON, showElement, hideElement, formatTime, getStorageItem, setStorageItem, renderStatus, DATA_FOR_TOY_BASE, dataForToyUrl } from '../utils.js';
import {
    RANK_COEFFICIENTS, RANK_NAMES, ATTRIBUTE_NAMES, ATTRIBUTE_RANK_VALUES,
    EVENT_BONUSES,
    setup as setupCalc,
    calculateProfit,
    aggregateIngredients, groupIngredientsByLocation
} from './island.restaurant.calc.js';
import {
    setup as setupPlanner,
    loadPlannerState,
    setupPlannerUI, renderPlannerMainView, updatePlannerUI,
    calculateDailyPlan,
    openMenuSelectionModal, selectMenusFromModal, selectSlotForModal,
    closeMenuSelectionModal, adjustGlobalQty, selectPresetSlot,
    closePlannerModal, copyPresetFrom, closeCopyPresetModal,
    RARITY_BACKGROUNDS
} from './island.restaurant.planner.js';

'use strict';

// ===== Constants (engine-only) =====

const RANK_ICONS = {
    bronze: dataForToyUrl('island/islandrestaurant/rank_tong.webp'),
    silver: dataForToyUrl('island/islandrestaurant/rank_yin.webp'),
    gold: dataForToyUrl('island/islandrestaurant/rank_jin.webp'),
    diamond: dataForToyUrl('island/islandrestaurant/rank_zuanshi.webp')
};

const RANK_COLORS = {
    bronze: '#cd7f32',
    silver: '#c0c0c0',
    gold: '#ffd700',
    diamond: '#b9f2ff'
};

const STORAGE_KEY_RANK = 'island-restaurant-rank';
const STORAGE_KEY_EVENTS = 'island-restaurant-events';
const STORAGE_KEY_SHIPGIRL1 = 'island-restaurant-shipgirl1';
const STORAGE_KEY_SHIPGIRL2 = 'island-restaurant-shipgirl2';

// ===== State =====

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

// Initialize sub-modules with shared state reference
setupCalc(state);
setupPlanner(state);

// ===== Initialization =====

/**
 * Load restaurant, recipe, and shop data; build all indices; initialize UI and planner.
 * Preferences (rank, events, shipgirl attributes) are restored from localStorage.
 */
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
        // normalizeArrayFields() repairs recipe array fields the Lua→JSON
        // pipeline emits as `{}` for empty values (see resource engine).
        state.recipes = window.IslandEngine.normalizeArrayFields(recipesData);

        // Build data structures for tree-based cost calculation
        buildMenuIndex();
        state.shopPurchaseData = window.IslandEngine.buildShopDataIndex(shopData);
        const { recipeIndex, recipeCategoryIndex } = window.IslandEngine.buildRecipeIndices(state.recipes);
        state.recipeIndex = recipeIndex;
        state.recipeCategoryIndex = recipeCategoryIndex;
        state.dependencyGraph = window.IslandEngine.buildDependencyGraph(state.recipes);
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
        bindMenuListEvents();
        renderMenuList();
        setupPlannerUI();
        updatePlannerUI();

        return true;
    } catch (error) {
        console.error('[Restaurant] Initialization failed:', error);
        window.IslandEngine.showToast('레스토랑 데이터를 불러오는데 실패했습니다.', 'error');
        throw error;
    }
}

// ===== Data Structure Builders =====

/** Build a reverse index from formulaId → [{restaurantId, restaurantName, itemId}] for cross-tab navigation. */
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

/**
 * Pre-calculate the master ingredient list across all menus for the planner's ingredient summary.
 * Uses category 1 and 2 as stop nodes to avoid expanding raw material chains.
 */
function buildMasterIngredientList() {
    const allIngredients = {}; // Map itemId -> info

    // Iterate all menus in all restaurants
    Object.values(state.restaurants).forEach(restaurant => {
        if (!restaurant.item_id) return;
        restaurant.item_id.forEach(([_, formulaId]) => {
            const tree = window.IslandEngine.buildRecipeDependencyTree(
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

// ===== Preferences =====

function loadPreferences() {
    try {
        const savedRank = getStorageItem(STORAGE_KEY_RANK, null);
        if (savedRank && RANK_COEFFICIENTS[savedRank]) {
            state.selectedRank = savedRank;
        }

        const savedEvents = getStorageItem(STORAGE_KEY_EVENTS, null);
        if (savedEvents) {
            state.activeEvents = new Set(JSON.parse(savedEvents));
        }

        const savedShipgirl1 = getStorageItem(STORAGE_KEY_SHIPGIRL1, null);
        if (savedShipgirl1) {
            state.shipgirl1Attr = JSON.parse(savedShipgirl1);
        }

        const savedShipgirl2 = getStorageItem(STORAGE_KEY_SHIPGIRL2, null);
        if (savedShipgirl2) {
            state.shipgirl2Attr = JSON.parse(savedShipgirl2);
        }
    } catch (error) {
        console.error('[Restaurant] Failed to load preferences:', error);
    }
}

function savePreferences() {
    try {
        setStorageItem(STORAGE_KEY_RANK, state.selectedRank);
        setStorageItem(STORAGE_KEY_EVENTS, JSON.stringify(Array.from(state.activeEvents)));
        setStorageItem(STORAGE_KEY_SHIPGIRL1, JSON.stringify(state.shipgirl1Attr));
        setStorageItem(STORAGE_KEY_SHIPGIRL2, JSON.stringify(state.shipgirl2Attr));

        // Clear sales cache as preferences affecting calculation have changed
        state.salesCache = {};
    } catch (error) {
        console.error('[Restaurant] Failed to save preferences:', error);
    }
}

// ===== Cross-Tab Navigation =====

function getRestaurantsForRecipe(formulaId) {
    if (!formulaId) return [];
    return (state.menuIndex[formulaId] || []).map(entry => ({ ...entry }));
}

/**
 * Switch to the restaurant tab and highlight a specific menu card.
 * Called from the resource module when the user clicks "view in restaurant".
 */
function navigateToMenu(formulaId, restaurantId) {
    const targets = state.menuIndex[formulaId] || [];
    if (!targets.length) return;

    const target = restaurantId
        ? targets.find(t => t.restaurantId === String(restaurantId)) || targets[0]
        : targets[0];

    state.highlightFormulaId = formulaId;
    selectRestaurant(target.restaurantId);
    window.IslandEngine.activateTab('restaurant');

    setTimeout(() => focusMenuCard(formulaId), 150);
}

async function viewRecipe(formulaId) {
    if (!window.IslandEngine?.activateTab) return;

    await window.IslandEngine.activateTab('resources');
    window.ResourceModule?.selectRecipe?.(formulaId);
}

function focusMenuCard(formulaId) {
    const card = document.querySelector(`.menu-card[data-formula-id="${formulaId}"]`);
    if (card) {
        card.classList.add('menu-card-highlight');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => card.classList.remove('menu-card-highlight'), 1200);
    }
}

// ===== Restaurant Tabs =====

function renderRestaurantTabs() {
    const container = document.getElementById('restaurant-tabs');
    if (!container) return;

    const restaurants = Object.entries(state.restaurants)
        .filter(([id]) => id !== 'all')
        .sort(([a], [b]) => parseInt(a) - parseInt(b));

    const tabsHtml = restaurants.map(([id, restaurant]) => `
        <button class="restaurant-tab ${state.selectedRestaurant === id ? 'active' : ''}"
                data-restaurant-id="${id}">
            <span class="material-symbols-outlined">restaurant</span>
            <span class="restaurant-tab-name">${restaurant.name}</span>
        </button>
    `).join('');

    const plannerTabHtml = `
        <button class="restaurant-tab planner-tab ${state.selectedRestaurant === 'planner' ? 'active' : ''}"
                data-restaurant-id="planner">
            <span class="material-symbols-outlined">event_note</span>
            <span class="restaurant-tab-name">메뉴 계산기</span>
        </button>
    `;

    container.innerHTML = tabsHtml + plannerTabHtml;

    container.querySelectorAll('.restaurant-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            selectRestaurant(btn.dataset.restaurantId);
        });
    });
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
        showElement(plannerView);
        hideElement(menuList);
        hideElement(menuContainer);
        hideElement(controls);
        hideElement(floatingBar);

        renderPlannerMainView();
    } else {
        hideElement(plannerView);
        showElement(menuList);
        showElement(menuContainer);
        showElement(controls);
        // showElement(floatingBar); // Optional: show floating bar? Or rely on Planner tab

        renderMenuList();
        updatePlannerUI();
    }
}

// ===== Rank Selector =====

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

// ===== Event Toggles =====

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

// ===== Shipgirl Attribute Selectors =====

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
                ${isShipgirl2 ? '<span class="badge gold-only-badge">골드 이상</span>' : ''}
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

// ===== Menu List =====

// Wire delegated click on the static `#restaurant-menu-list` container.
// Called once from init — innerHTML is rebuilt each render but the container
// itself persists, so this listener survives.
function bindMenuListEvents() {
    const container = document.getElementById('restaurant-menu-list');
    if (!container) return;
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.view-recipe-btn');
        if (btn) {
            const formulaId = parseInt(btn.dataset.formulaId, 10);
            if (Number.isFinite(formulaId)) viewRecipe(formulaId);
        }
    });
}

function renderMenuList() {
    const container = document.getElementById('restaurant-menu-list');
    if (!container) return;

    const restaurantId = state.selectedRestaurant;
    const restaurant = state.restaurants[restaurantId];
    if (!restaurant) {
        renderStatus(container, '레스토랑을 선택하세요', 'empty', { icon: 'restaurant_menu' });
        return;
    }

    const menus = restaurant.item_id || [];
    if (menus.length === 0) {
        renderStatus(container, '메뉴가 없습니다', 'empty', { icon: 'no_meals' });
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
                    ${item.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${item.icon.split('/').pop()}.webp" alt="${item.name}">` : '<span class="material-symbols-outlined">restaurant_menu</span>'}
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
                                    ${isCurrent ? '<span class="badge badge--success">현재</span>' : ''}
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
                <button class="btn btn-secondary view-recipe-btn" type="button" data-formula-id="${formulaId}">
                    <span class="material-symbols-outlined">menu_book</span>
                    레시피 보기
                </button>
            </div>
        </div>
    `;
}

// ===== Public API =====

window.RestaurantModule = {
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
    closePlannerModal,
    copyPresetFrom,
    closeCopyPresetModal,
    state: () => state
};

export {
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
    closePlannerModal,
    copyPresetFrom,
    closeCopyPresetModal
};
