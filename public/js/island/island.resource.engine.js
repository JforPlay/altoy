/**
 * island.resource.engine.js
 * Resource sub-engine for the island module. Manages recipe browsing, dependency tree
 * visualization, and cross-tab navigation (resource ↔ restaurant). Delegates tree building
 * to island.resource.tree.js and rendering to island.resource.render.js.
 * Registers as window.ResourceModule.
 */

import { fetchJSON, formatTime, openModal, closeModal, setupModal, DATA_FOR_TOY_BASE } from '../utils.js';
import {
    CONSTANTS,
    setup as setupTree,
    findRecipeById, findRecipeCategoryById,
    clearTreeCache, buildUpstreamTree, buildDownstreamTree,
    calculateTreeStats, calculateCumulativeTime
} from './island.resource.tree.js';
import {
    categoryNames,
    setup as setupRender,
    renderCategoryFilter, renderRecipeList, renderRecipeDetail,
    renderEmptyDetail, renderEmptyChain,
    renderForestTree, renderForestDependencies
} from './island.resource.render.js';

'use strict';

// ===== State =====
const state = {
    recipes: {},           // { "1": [...], "2": [...], ... }
    items: {},             // { "2000": { name, icon, ... }, ... }
    shopPurchaseData: {},  // { item_id: [required_item_id, cost, pack_size] }
    recipeIndex: {},       // { recipeId: recipe } for O(1) lookup
    recipeCategoryIndex: {}, // { recipeId: categoryId } for O(1) lookup
    dependencyGraph: {
        producedBy: {},    // itemId -> recipe ids that produce it
        usedBy: {}         // itemId -> recipe ids that use it
    },
    selectedRecipe: null,
    selectedCategory: '1',
    searchQuery: '',
    treeCache: {}          // Cache for dependency trees
};

// Initialize sub-modules with shared state reference
setupTree(state);
setupRender(state);

// ===== Initialization =====

/**
 * Load recipe and shop data, build all lookup indices and dependency graph, then render the UI.
 * Reuses sharedData.items from island.engine.js to avoid re-fetching the item template.
 */
async function init(sharedData) {
    try {
        // Use shared item data instead of loading again
        if (sharedData && sharedData.items) {
            state.items = sharedData.items;
        }

        // Load module-specific data
        const [recipesData, shopData] = await Promise.all([
            fetchJSON('data/island/recipes.json'),
            fetchJSON('data/island/island_shop_goods.json')
        ]);

        // normalizeArrayFields() repairs recipe array fields (commission_cost,
        // cost, drop_display, …) the Lua→JSON pipeline emits as `{}` for empty
        // values, which would crash buildDependencyGraph and the cost renderers.
        state.recipes = window.IslandEngine.normalizeArrayFields(recipesData);

        // Process shop data using shared function
        state.shopPurchaseData = window.IslandEngine.buildShopDataIndex(shopData);

        // Build recipe and category indices using shared function
        const { recipeIndex, recipeCategoryIndex } = window.IslandEngine.buildRecipeIndices(state.recipes);
        state.recipeIndex = recipeIndex;
        state.recipeCategoryIndex = recipeCategoryIndex;

        // Build dependency graph using shared function
        state.dependencyGraph = window.IslandEngine.buildDependencyGraph(state.recipes);

        // Build seasonal items category (must be after dependency graph)
        buildSeasonalItemsCategory();

        // Rebuild recipe indices to include seasonal items
        const updatedIndices = window.IslandEngine.buildRecipeIndices(state.recipes);
        state.recipeIndex = updatedIndices.recipeIndex;
        state.recipeCategoryIndex = updatedIndices.recipeCategoryIndex;

        // Render UI
        renderCategoryFilter();
        renderRecipeList();
        renderEmptyDetail();
        renderEmptyChain();

        // Setup event listeners
        setupEventListeners();
    } catch (error) {
        console.error('[Resource] Initialization failed:', error);
        window.IslandEngine.showError('Failed to load resource data');
    }
}

/**
 * Build a synthetic '시즌템' recipe category from items in the 4000–4999 ID range.
 * Items produced by real recipes link to them; pickup/shop items get a synthetic stub recipe.
 * Must run after the dependency graph is built.
 */
function buildSeasonalItemsCategory() {
    // Filter items with IDs 4000-4999 from item data
    const seasonalItems = Object.entries(state.items)
        .filter(([id]) => {
            const itemId = parseInt(id);
            return itemId >= 4000 && itemId <= 4999;
        })
        .map(([id, itemData]) => parseInt(id));

    // Build synthetic recipes for seasonal items
    const seasonalRecipes = [];

    seasonalItems.forEach(itemId => {
        const itemInfo = window.IslandEngine.getItemInfo(itemId);

        // Check if this item is produced by any recipe
        const producingRecipes = state.dependencyGraph.producedBy[itemId] || [];

        // Check if this item can be purchased from shop
        const isInShop = state.shopPurchaseData[itemId] !== undefined;

        // If not in shop and not produced by recipes, it's a pickup item
        const isPickup = !isInShop && producingRecipes.length === 0;

        // If there are producing recipes, use the first one as the main recipe
        if (producingRecipes.length > 0) {
            const mainRecipe = state.recipeIndex[producingRecipes[0]];
            if (mainRecipe) {
                // Use the actual recipe but mark it as seasonal
                const seasonalRecipe = {
                    ...mainRecipe,
                    _isSeasonalView: true,
                    _seasonalItemId: itemId,
                    _allRecipes: producingRecipes,
                    _isPickup: false,
                    _isShop: isInShop
                };
                seasonalRecipes.push(seasonalRecipe);
                return;
            }
        }

        // Create a synthetic recipe entry for display (pickup or shop items)
        const syntheticRecipe = {
            id: `seasonal_${itemId}`,
            name: itemInfo.name,
            item_id: itemId,
            workload: 0,
            ship_exp: 0,
            stamina_cost: 0,
            commission_cost: [],
            commission_product: [[itemId, 1]],
            production_limit: 0,
            _isSeasonalView: true,
            _seasonalItemId: itemId,
            _isPickup: isPickup,
            _isShop: isInShop,
            _allRecipes: []
        };

        seasonalRecipes.push(syntheticRecipe);
    });

    // Add seasonal category to recipes
    state.recipes['시즌템'] = seasonalRecipes;
}

// ===== Event Handlers =====

function setupEventListeners() {
    // Recipe-dependency modal close button + backdrop + ESC
    setupModal('dependency-modal', { closeButtonSelector: '.modal-close-btn', restoreFocus: true });

    // Category select
    const categorySelect = document.getElementById('recipe-category-select');
    categorySelect?.addEventListener('change', (e) => {
        state.selectedCategory = e.target.value;
        state.selectedRecipe = null;
        clearTreeCache();  // Clear cache when switching categories
        renderRecipeList();
        renderEmptyDetail();
    });

    // Full recipe forest view
    const forestButton = document.getElementById('recipe-forest-btn');
    forestButton?.addEventListener('click', showRecipeForest);

    // Search with debouncing
    const searchInput = document.getElementById('recipe-search');
    let searchTimeout;
    searchInput?.addEventListener('input', (e) => {
        const query = e.target.value;

        // Debounce search
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            state.searchQuery = query;
            renderRecipeList();
        }, CONSTANTS.DEBOUNCE_DELAY);
    });

    // Recipe selection (delegated)
    const recipeList = document.getElementById('recipe-list');
    recipeList?.addEventListener('click', (e) => {
        const card = e.target.closest('.recipe-card');
        if (!card) return;

        const recipeId = card.dataset.recipeId;
        // Try to find recipe by string ID first (for seasonal synthetic recipes)
        let recipe = state.recipeIndex[recipeId];
        // If not found, try parsing as integer (for normal numeric IDs)
        if (!recipe) {
            recipe = findRecipeById(parseInt(recipeId));
        }
        // If still not found, search in seasonal category
        if (!recipe && state.selectedCategory === '시즌템') {
            recipe = state.recipes['시즌템']?.find(r => r.id === recipeId);
        }
        if (recipe) {
            state.selectedRecipe = recipe;
            renderRecipeList();
            renderRecipeDetail(recipe);
        }
    });

    // Resource module clicks. Single delegated listener at document level so
    // anything rendered into the recipe detail/tree/forest panels routes here
    // without each render function having to wire its own listeners.
    document.addEventListener('click', (e) => {
        const actionEl = e.target.closest('[data-action]');
        if (actionEl) {
            const action = actionEl.dataset.action;
            const recipeId = parseInt(actionEl.dataset.recipeId, 10);
            // The forest-root chip lives inside `<summary>`, whose default click
            // toggles the parent `<details>`. Cancel that so the chip click only
            // selects the recipe.
            if (actionEl.classList.contains('forest-root-chip')) e.preventDefault();

            if (Number.isFinite(recipeId)) {
                switch (action) {
                    case 'view-in-restaurant':   viewInRestaurant(recipeId);   return;
                    case 'show-upstream':        showUpstream(recipeId);       return;
                    case 'show-downstream':      showDownstream(recipeId);     return;
                    case 'select-tree-recipe':   selectRecipeFromTree(recipeId); return;
                    case 'select-modal-recipe':  selectRecipeFromModal(recipeId); return;
                }
            }
        }

        const seasonalCard = e.target.closest('.seasonal-recipe-card');
        if (seasonalCard && seasonalCard.dataset.recipeId) {
            const recipeId = parseInt(seasonalCard.dataset.recipeId);
            const recipe = findRecipeById(recipeId);
            if (recipe) {
                const category = findRecipeCategoryById(recipeId);
                if (category && category !== state.selectedCategory) {
                    state.selectedCategory = category;
                    const categorySelect = document.getElementById('recipe-category-select');
                    if (categorySelect) {
                        categorySelect.value = category;
                    }
                    renderRecipeList();
                }
                state.selectedRecipe = recipe;
                renderRecipeList();
                renderRecipeDetail(recipe);
            }
        }

        // Handle clicks on usage list items
        const usageCard = e.target.closest('.seasonal-usage-list .tree-node-card');
        if (usageCard && usageCard.dataset.recipeId) {
            const recipeId = parseInt(usageCard.dataset.recipeId);
            const recipe = findRecipeById(recipeId);
            if (recipe) {
                const category = findRecipeCategoryById(recipeId);
                if (category && category !== state.selectedCategory) {
                    state.selectedCategory = category;
                    const categorySelect = document.getElementById('recipe-category-select');
                    if (categorySelect) {
                        categorySelect.value = category;
                    }
                    renderRecipeList();
                }
                state.selectedRecipe = recipe;
                renderRecipeList();
                renderRecipeDetail(recipe);
            }
        }
    });
}

// ===== Tree Navigation =====

/**
 * Select a recipe by ID, switching to its category if needed, and scroll it into view.
 * Accepts numeric IDs, string IDs (for seasonal synthetic recipes), or seasonal category entries.
 */
function selectRecipe(recipeId) {
    // Try to find recipe by ID (string or number)
    let recipe = state.recipeIndex[recipeId];
    if (!recipe && typeof recipeId === 'number') {
        recipe = findRecipeById(recipeId);
    }
    // Search in seasonal category if not found
    if (!recipe) {
        recipe = state.recipes['시즌템']?.find(r => r.id === recipeId);
    }
    if (!recipe) return;

    const category = findRecipeCategoryById(recipeId) || (recipe._isSeasonalView ? '시즌템' : null);

    // Switch to the correct category if needed
    if (category && category !== state.selectedCategory) {
        state.selectedCategory = category;
        const categorySelect = document.getElementById('recipe-category-select');
        if (categorySelect) {
            categorySelect.value = category;
        }
        renderRecipeList();
    }

    // Select the recipe
    state.selectedRecipe = recipe;
    renderRecipeList();
    renderRecipeDetail(recipe);

    // Scroll to the recipe card
    setTimeout(() => {
        const recipeCard = document.querySelector(`.recipe-card[data-recipe-id="${recipeId}"]`);
        if (recipeCard) {
            recipeCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 100);
}

/** Called from tree node clicks — delegates to selectRecipe. */
function selectRecipeFromTree(recipeId) {
    selectRecipe(recipeId);
}

function viewInRestaurant(recipeId) {
    if (!window.RestaurantModule || !window.RestaurantModule.navigateToMenu) return;

    const restaurants = window.RestaurantModule.getRestaurantsForRecipe(recipeId);
    if (restaurants.length > 0) {
        window.RestaurantModule.navigateToMenu(recipeId);
    }
}

/**
 * Collect related recipes for the dependency modal.
 * direction='upstream' finds recipes that produce the inputs; 'downstream' finds recipes that use the outputs.
 */
function showRelatedRecipes(recipeId, direction) {
    const recipe = findRecipeById(recipeId);
    if (!recipe) return;

    const isUpstream = direction === 'upstream';
    const items = isUpstream
        ? (recipe.commission_cost || []).map(([id]) => id)
        : (recipe.commission_product || []).map(([id]) => id);

    const relatedRecipes = [];

    items.forEach(itemId => {
        const relatedIds = isUpstream
            ? state.dependencyGraph.producedBy[itemId] || []
            : state.dependencyGraph.usedBy[itemId] || [];

        relatedIds.forEach(relatedId => {
            const relatedRecipe = findRecipeById(relatedId);
            if (relatedRecipe && !relatedRecipes.find(r => r.id === relatedId)) {
                relatedRecipes.push({
                    recipe: relatedRecipe,
                    itemId: itemId,
                    itemInfo: window.IslandEngine.getItemInfo(itemId)
                });
            }
        });
    });

    const title = isUpstream
        ? `필요한 재료를 생산하는 레시피 (${relatedRecipes.length})`
        : `이 레시피의 생산물을 사용하는 레시피 (${relatedRecipes.length})`;

    showDependencyModal(title, relatedRecipes, direction, recipe);
}

function showUpstream(recipeId) {
    showRelatedRecipes(recipeId, 'upstream');
}

function showDownstream(recipeId) {
    showRelatedRecipes(recipeId, 'downstream');
}

function showDependencyModal(title, recipes, direction, sourceRecipe) {
    const modal = document.getElementById('dependency-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalContent = document.getElementById('modal-content');

    if (!modal || !modalTitle || !modalContent) return;

    modalTitle.textContent = title;

    if (recipes.length === 0) {
        modalContent.innerHTML = `
            <div class="modal-empty-state">
                <span class="material-symbols-outlined">search_off</span>
                <p>${direction === 'upstream' ? '이 레시피는 재료가 필요 없거나, 재료를 생산하는 레시피가 없습니다.' : '이 레시피의 생산물을 사용하는 레시피가 없습니다.'}</p>
            </div>
        `;
    } else {
        // Group recipes by item
        const groupedByItem = {};
        recipes.forEach(({ recipe, itemId, itemInfo }) => {
            if (!groupedByItem[itemId]) {
                groupedByItem[itemId] = {
                    itemInfo,
                    recipes: []
                };
            }
            groupedByItem[itemId].recipes.push(recipe);
        });

        modalContent.innerHTML = `
            <div class="modal-recipe-groups">
                ${Object.entries(groupedByItem).map(([itemId, { itemInfo, recipes: groupRecipes }]) => `
                    <div class="modal-recipe-group">
                        <div class="modal-item-header">
                            <div class="modal-item-icon">
                                ${itemInfo.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${itemInfo.icon.split('/').pop()}.webp" alt="${itemInfo.name}">` : '📦'}
                            </div>
                            <div class="modal-item-info">
                                <h4>${itemInfo.name}</h4>
                                <p>${direction === 'upstream' ? '이 아이템을 생산하는 레시피' : '이 아이템을 사용하는 레시피'} (${groupRecipes.length})</p>
                            </div>
                        </div>
                        <div class="modal-recipe-list">
                            ${groupRecipes.map(recipe => {
            const recipeItem = window.IslandEngine.getItemInfo(recipe.item_id);
            return `
                                    <div class="modal-recipe-card" data-recipe-id="${recipe.id}">
                                        <div class="modal-recipe-icon">
                                            ${recipeItem.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${recipeItem.icon.split('/').pop()}.webp" alt="${recipeItem.name}">` : '📦'}
                                        </div>
                                        <div class="modal-recipe-info">
                                            <div class="modal-recipe-name">${recipe.name || recipeItem.name}</div>
                                            <div class="modal-recipe-meta">
                                                <span>⏱ ${formatTime(recipe.workload)}</span>
                                                <span>⚡ ${recipe.ship_exp}</span>
                                                <span class="modal-recipe-category">${categoryNames[findRecipeCategoryById(recipe.id)] || '알 수 없음'}</span>
                                            </div>
                                        </div>
                                        <button class="modal-select-btn" data-action="select-modal-recipe" data-recipe-id="${recipe.id}">
                                            <span class="material-symbols-outlined">arrow_forward</span>
                                        </button>
                                    </div>
                                `;
        }).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="modal-source-info">
                <span class="material-symbols-outlined">info</span>
                <span>현재 선택된 레시피: <strong>${sourceRecipe.name || window.IslandEngine.getItemInfo(sourceRecipe.item_id).name}</strong></span>
            </div>
        `;
    }

    // Show modal
    openModal('dependency-modal');
}

/**
 * Show a full recipe forest (all categories) without needing a selected recipe
 * Each recipe becomes a root; dependencies expand to show all upstream inputs.
 */
function showRecipeForest() {
    const modal = document.getElementById('dependency-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalContent = document.getElementById('modal-content');
    if (!modal || !modalTitle || !modalContent) return;

    modalTitle.textContent = '전체 레시피 트리';

    const categorySections = Object.entries(state.recipes).map(([categoryId, recipes]) => `
        <details class="forest-category" data-category="${categoryId}" open>
            <summary class="forest-category-header">
                <span class="material-symbols-outlined">widgets</span>
                ${categoryNames[categoryId] || '카테고리'}
                <span class="forest-category-count">(${recipes.length} recipes)</span>
            </summary>
            <div class="forest-category-body">
                ${recipes.map(recipe => renderForestTree(recipe, categoryId)).join('')}
            </div>
        </details>
    `).join('');

    modalContent.innerHTML = `
        <div class="forest-container">
            ${categorySections}
        </div>
    `;

    openModal('dependency-modal');
}

function closeDependencyModal() {
    closeModal('dependency-modal');
}

function selectRecipeFromModal(recipeId) {
    closeDependencyModal();
    selectRecipe(recipeId);
}

// ===== Public API =====

window.ResourceModule = {
    init,
    selectRecipe,
    selectRecipeFromTree,
    viewInRestaurant,
    showUpstream,
    showDownstream,
    closeModal: closeDependencyModal,
    selectRecipeFromModal,
    // Exposed for Season Calculator
    getRecipeById: findRecipeById,
    getRecipeCategoryById: findRecipeCategoryById,
    buildUpstreamTree,
    calculateCumulativeTime,
    getDependencyGraph: () => state.dependencyGraph,
    getRecipes: () => state.recipes,
    getRecipeIndex: () => state.recipeIndex
};

export {
    init,
    selectRecipe,
    selectRecipeFromTree,
    viewInRestaurant,
    showUpstream,
    showDownstream,
    closeDependencyModal as closeModal,
    selectRecipeFromModal,
    findRecipeById as getRecipeById,
    findRecipeCategoryById as getRecipeCategoryById,
    buildUpstreamTree,
    calculateCumulativeTime,
};
