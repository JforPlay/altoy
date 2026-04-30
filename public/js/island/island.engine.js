/**
 * island.engine.js
 * Core coordinator for the island module. Manages tab-based lazy loading of sub-modules
 * (character, technology, quest, resource, restaurant, season-calc) and provides shared
 * utilities (recipe tree building, dependency graphs, item lookups) used by all sub-engines.
 * Exposes itself as window.IslandEngine for cross-module access.
 */
import { fetchJSON, showToast, setStorageItem, createSearchIndex, ensureFuse } from '../utils.js';

'use strict';

// ===== State =====
const state = {
    activeTab: 'characters',
    modules: {},  // populated only after each module's init() resolves
    sharedData: {
        items: null,  // Shared across all modules
        loaded: false
    }
};

// Memoized in-flight promises so concurrent callers share the same work and
// every awaiter sees init as truly complete (not just "started"). Once a
// promise here resolves, the corresponding module is fully initialized and
// safe to read from.
const moduleLoadPromises = {};
let sharedDataPromise = null;

const TAB_MODULE_MAP = {
    'characters': { key: 'character', module: () => window.CharacterModule },
    'technology': { key: 'technology', module: () => window.TechnologyModule },
    'quests': { key: 'quest', module: () => window.QuestModule },
    'resources': { key: 'resource', module: () => window.ResourceModule },
    'restaurant': { key: 'restaurant', module: () => window.RestaurantModule },
    'season-calc': { key: 'seasonCalc', module: () => window.SeasonCalcModule }
};
const DEFAULT_TAB = 'characters';
const VALID_TAB_NAMES = Object.freeze(Object.keys(TAB_MODULE_MAP));

// ===== Initialization =====

/**
 * Boot the island engine: load shared item data, then wait for tab activation to lazy-load sub-modules.
 */
async function init() {
    console.log('[Island] Initializing core engine...');

    try {
        await loadSharedData();
        // Sub-module initializeSearch() functions are synchronous and call
        // createIslandSearchIndex(...) (ultimately createSearchIndex) directly.
        // Kick off the lazy Fuse load alongside shared data so it's ready by
        // the time any sub-module activates and builds its index.
        ensureFuse();
        console.log('[Island] Core engine initialized (Lazy loading modules)');
    } catch (error) {
        console.error('[Island] Critical initialization failure:', error);
        showToast('페이지를 불러오는데 실패했습니다. 페이지를 새로고침해주세요.', 'error');
    }
}

/**
 * Load island_item_data_template.json once and store in shared state.
 * Concurrent callers share the same in-flight promise.
 */
function loadSharedData() {
    if (sharedDataPromise) return sharedDataPromise;

    sharedDataPromise = (async () => {
        console.log('[Island] Loading shared data...');
        try {
            state.sharedData.items = await fetchJSON('data/island/island_item_data_template.json');
            state.sharedData.loaded = true;
            console.log(`[Island] Loaded shared item data: ${Object.keys(state.sharedData.items).length} items`);
        } catch (error) {
            console.error('[Island] Failed to load shared data:', error);
            sharedDataPromise = null;  // allow retry on transient failures
            throw error;
        }
    })();

    return sharedDataPromise;
}

/**
 * Lazy-load and fully initialize the module for the given tab name.
 *
 * Idempotent: concurrent and repeat callers receive the same promise. The
 * returned promise does NOT resolve until module.init() has completed, so
 * after `await loadModule('foo')` the foo module is guaranteed to be ready
 * for reads. This is the contract that lets dependent modules (e.g.
 * season-calc → resources) just await without defensive re-checks.
 */
function loadModule(tabName) {
    const safeTabName = normalizeTabName(tabName);
    const config = TAB_MODULE_MAP[safeTabName];
    if (!config) return Promise.resolve();

    const { key, module: getModule } = config;

    if (moduleLoadPromises[key]) return moduleLoadPromises[key];

    moduleLoadPromises[key] = (async () => {
        const module = getModule();
        if (!module) {
            console.warn(`[Island] Module for ${safeTabName} not found`);
            return;
        }
        await loadSharedData();
        console.log(`[Island] Initializing ${key} module...`);
        await module.init(state.sharedData);
        // Mark as initialized only AFTER init resolves, so other callers
        // observing state.modules can trust the module is fully ready.
        state.modules[key] = module;
        console.log(`[Island] ${key} module initialized successfully`);
    })().catch(error => {
        console.error(`[Island] Failed to lazy load ${safeTabName}:`, error);
        showError(`${safeTabName} 모듈을 불러오는데 실패했습니다.`);
        delete moduleLoadPromises[key];  // allow retry on transient failures
    });

    return moduleLoadPromises[key];
}

// ===== Tab Management =====

/**
 * Switch active tab and trigger lazy load. Returns the load promise so
 * callers that need to wait for the module to be ready can await it.
 */
function switchTab(tabName) {
    const safeTabName = normalizeTabName(tabName);

    state.activeTab = safeTabName;
    setStorageItem('island-active-tab', safeTabName);
    console.log(`[Island] Switched to tab: ${safeTabName}`);
    return loadModule(safeTabName);
}

/**
 * Programmatically activate a tab (mirrors button click behavior)
 */
function activateTab(tabName) {
    const safeTabName = normalizeTabName(tabName);

    syncTabUi(safeTabName);
    return switchTab(safeTabName);
}

/**
 * Get active tab
 */
function getActiveTab() {
    return state.activeTab;
}

// ===== Utility Functions =====

/** Return the shared data object (items, loaded flag) for sub-modules that need it. */
function getSharedData() {
    return state.sharedData;
}

function normalizeTabName(tabName) {
    const value = String(tabName || '');
    return VALID_TAB_NAMES.includes(value) ? value : DEFAULT_TAB;
}

function syncTabUi(tabName) {
    document.querySelectorAll('.tab-content').forEach(content => {
        const contentId = content.id.replace('tab-', '');
        const isActive = contentId === tabName;
        content.classList.toggle('active', isActive);
        content.setAttribute('aria-hidden', String(!isActive));
        content.hidden = !isActive;
    });

    document.querySelectorAll('.tab-button').forEach(btn => {
        const isActive = btn.dataset.tab === tabName;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
        btn.tabIndex = isActive ? 0 : -1;
    });
}

function showError(message) {
    showToast(message, 'error');
}

function searchCharacters(query) {
    const characterModule = window.CharacterModule;
    if (!state.modules.character || !characterModule?.searchCharacters) {
        return [];
    }
    return characterModule.searchCharacters(query);
}

function renderCharacterList(characters = null) {
    const characterModule = window.CharacterModule;
    if (!state.modules.character || !characterModule?.renderCharacterList) return;
    characterModule.renderCharacterList(characters);
}



/**
 * Get item information from shared data
 * @param {number|string} itemId - The item ID to look up
 * @returns {{name: string, icon: string|null, rarity: number}} Item info
 */
function getItemInfo(itemId) {
    if (!state.sharedData.items) {
        console.warn('[Island] Shared item data not loaded yet');
        return {
            name: `Item ${itemId}`,
            icon: null,
            rarity: 1
        };
    }

    return state.sharedData.items[itemId] || {
        name: `Item ${itemId}`,
        icon: null,
        rarity: 1
    };
}

/**
 * Wrapper around utils.js createSearchIndex with island-module defaults.
 * Sub-modules call this via window.IslandEngine.createSearchIndex.
 */
function createIslandSearchIndex(data, config) {
    return createSearchIndex(data, {
        keys: config.keys || ['searchText'],
        threshold: config.threshold || 0.3,
        ...config
    });
}

// ===== Recipe Tree Utilities (Shared) =====

const GOLD_ITEM_ID = 1;
const MAX_TREE_DEPTH = 5;

/**
 * Build dependency tree for a recipe (upstream dependencies).
 * Used by both resource and restaurant modules.
 * @param {number|string} recipeId - Recipe ID to build tree for
 * @param {Object<string, IslandRecipe>} recipeIndex - Recipe lookup index
 * @param {Object<string, string>} recipeCategoryIndex - Recipe-to-category lookup
 * @param {DependencyGraph} dependencyGraph - Dependency graph
 * @param {Object<number, [number, number, number?]>} shopPurchaseData - Shop purchase data
 * @param {Object} [options] - Tree building options
 * @param {boolean} [options.useManualMode=false] - Use manual mode for category 1
 * @param {number} [options.quantityMultiplier=1] - Quantity scaling factor
 * @param {number} [options.maxDepth=5] - Maximum recursion depth
 * @param {Set} [options.visited] - Visited node tracking set
 * @param {Function} [options.shouldStopRecursion] - Stop condition callback
 * @returns {DependencyTreeNode|null} - Root of the dependency tree
 */
function buildRecipeDependencyTree(recipeId, recipeIndex, recipeCategoryIndex, dependencyGraph, shopPurchaseData, options = {}) {
    const {
        useManualMode = false,
        quantityMultiplier = 1,
        maxDepth = MAX_TREE_DEPTH,
        visited = new Set(),
        shouldStopRecursion = null // Function(recipeId, recipeCategory) -> boolean
    } = options;

    if (visited.has(recipeId) || maxDepth === 0) return null;
    visited.add(recipeId);

    const recipe = recipeIndex[recipeId];
    if (!recipe) return null;

    const recipeCategory = recipeCategoryIndex[recipeId];

    // Check stop condition
    if (shouldStopRecursion && shouldStopRecursion(recipeId, recipeCategory)) {
        return {
            recipe,
            recipeId: recipe.id,
            category: recipeCategory,
            quantityMultiplier: quantityMultiplier,
            dependencies: [], // No dependencies, leaf node
            isStopNode: true
        };
    }

    const isCategory1 = recipeCategory === '1';

    // Determine which input field to use
    const inputField = (useManualMode && isCategory1 && recipe.cost)
        ? 'cost'
        : 'commission_cost';
    const inputs = (recipe[inputField] || []).map(([id, quantity]) => ({ id, quantity }));
    const dependencies = [];

    inputs.forEach(({ id: itemId, quantity }) => {
        const scaledQuantity = quantity * quantityMultiplier;
        const producers = dependencyGraph.producedBy[itemId] || [];
        const shopPurchase = shopPurchaseData[itemId];

        // Priority: Prefer crafting over shop purchase if item can be produced
        if (producers.length > 0) {
            // Item is produced by recipes - recurse into recipe
            producers.forEach(producerId => {
                const childRecipe = recipeIndex[producerId];
                if (!childRecipe) return;

                const childOutput = (childRecipe.commission_product || []).find(([id]) => id === itemId);
                const childOutputQuantity = childOutput ? childOutput[1] : 1;
                const childMultiplier = scaledQuantity / childOutputQuantity;

                const childVisited = new Set(visited);
                const child = buildRecipeDependencyTree(producerId, recipeIndex, recipeCategoryIndex, dependencyGraph, shopPurchaseData, {
                    useManualMode,
                    quantityMultiplier: childMultiplier,
                    maxDepth: maxDepth - 1,
                    visited: childVisited,
                    shouldStopRecursion
                });
                if (child) {
                    dependencies.push({
                        itemId,
                        itemInfo: getItemInfo(itemId),
                        quantityNeeded: scaledQuantity,
                        ...child
                    });
                }
            });
        } else if (shopPurchase) {
            // Item can only be purchased from shop (not craftable)
            const [requiredItemId, unitCost, packSize = 1] = shopPurchase;
            const costPerItem = unitCost / packSize;
            const totalCost = costPerItem * scaledQuantity;
            const packsNeeded = Math.ceil(scaledQuantity / packSize);

            // Check if the required resource can be crafted
            if (requiredItemId !== GOLD_ITEM_ID && dependencyGraph.producedBy[requiredItemId]) {
                // Required resource is craftable - recurse into crafting it
                const childProducers = dependencyGraph.producedBy[requiredItemId];
                childProducers.forEach(producerId => {
                    const childRecipe = recipeIndex[producerId];
                    if (!childRecipe) return;

                    const childOutput = (childRecipe.commission_product || []).find(([id]) => id === requiredItemId);
                    const childOutputQuantity = childOutput ? childOutput[1] : 1;
                    const childMultiplier = totalCost / childOutputQuantity;

                    const childVisited = new Set(visited);
                    const child = buildRecipeDependencyTree(producerId, recipeIndex, recipeCategoryIndex, dependencyGraph, shopPurchaseData, {
                        useManualMode,
                        quantityMultiplier: childMultiplier,
                        maxDepth: maxDepth - 1,
                        visited: childVisited,
                        shouldStopRecursion
                    });
                    if (child) {
                        dependencies.push({
                            itemId: requiredItemId,
                            itemInfo: getItemInfo(requiredItemId),
                            quantityNeeded: totalCost,
                            shopPurchaseContext: {
                                purchasedItemId: itemId,
                                purchasedItemInfo: getItemInfo(itemId),
                                purchasedQuantity: scaledQuantity,
                                packSize: packSize,
                                packsNeeded: packsNeeded
                            },
                            ...child
                        });
                    }
                });
            } else {
                // Required resource is gold or not craftable - add as shop purchase
                dependencies.push({
                    itemId,
                    itemInfo: getItemInfo(itemId),
                    quantity: scaledQuantity,
                    isShopPurchase: true,
                    shopCost: {
                        itemId: requiredItemId,
                        itemInfo: getItemInfo(requiredItemId),
                        unitCost: unitCost,
                        packSize: packSize,
                        costPerItem: costPerItem,
                        packsNeeded: packsNeeded,
                        totalCost: totalCost,
                        quantity: scaledQuantity
                    }
                });
            }
        } else {
            // Raw material / Leaf node
            dependencies.push({
                itemId,
                itemInfo: getItemInfo(itemId),
                quantityNeeded: scaledQuantity,
                isStopNode: true,
                dependencies: []
            });
        }
    });

    return {
        recipe,
        recipeId: recipe.id,
        category: recipeCategory,
        quantityMultiplier: quantityMultiplier,
        dependencies,
        isManualMode: useManualMode && isCategory1 && recipe.cost?.length > 0
    };
}

/**
 * Calculate total gold and resource consumption from a dependency tree
 */
function calculateTreeCost(tree, direction = 'dependencies') {
    if (!tree) return { gold: 0, resources: {} };

    let gold = 0;
    const resources = {};

    const children = tree[direction] || tree.usages || [];
    children.forEach(child => {
        if (child.isShopPurchase && child.shopCost) {
            const { itemId, totalCost, itemInfo } = child.shopCost;

            if (itemId === GOLD_ITEM_ID) {
                gold += totalCost;
            } else {
                if (!resources[itemId]) {
                    resources[itemId] = {
                        name: itemInfo.name,
                        icon: itemInfo.icon,
                        amount: 0
                    };
                }
                resources[itemId].amount += totalCost;
            }
        }

        // Recursively calculate for children
        const childCosts = calculateTreeCost(child, direction);
        gold += childCosts.gold;

        Object.entries(childCosts.resources).forEach(([itemId, data]) => {
            if (!resources[itemId]) {
                resources[itemId] = { ...data };
            } else {
                resources[itemId].amount += data.amount;
            }
        });
    });

    return { gold, resources };
}

/**
 * Calculate ingredient points from a dependency tree (non-recursive for direct ingredients only)
 * Returns only the pt_num of direct ingredients * quantity
 * Does NOT include the recipe output item's pt_num
 */
function calculateTreePoints(tree, direction = 'dependencies') {
    if (!tree) return 0;

    let totalPoints = 0;

    const children = tree[direction] || tree.usages || [];
    children.forEach(child => {
        // For each ingredient, get its pt_num value
        if (child.itemId) {
            const itemInfo = getItemInfo(child.itemId);
            const quantity = child.quantityNeeded || child.quantity || 0;

            // If this crafted item is used for a shop purchase, use the purchased item's pt_num
            if (child.shopPurchaseContext) {
                const shopItem = child.shopPurchaseContext.purchasedItemInfo;
                const shopItemPtNum = shopItem.pt_num || 0;
                const shopItemQuantity = child.shopPurchaseContext.purchasedQuantity;
                // Use the purchased item's pt_num value, not the crafted item's
                totalPoints += shopItemPtNum * shopItemQuantity;
            } else if (itemInfo && itemInfo.pt_num > 0) {
                // Regular case: add this item's own pt_num value * quantity
                totalPoints += itemInfo.pt_num * quantity;
            }
        }
    });

    return totalPoints;
}

/**
 * Calculate accumulated net gain from a dependency tree
 * For each child: adds (child's total net gain per unit) × quantity needed
 * The child's total net gain already includes their descendants
 *
 * Special handling for category 5 (seasonal) recipes:
 * - Category 2 (gathering/pickup) items have net gain = pt_num (no cost)
 * - To avoid double-counting, skip accumulated gain for cat2 items used by cat5 recipes
 */
function calculateTreeNetGain(tree, direction = 'dependencies', parentRecipeCategory = null) {
    if (!tree) return 0;

    let totalAccumulatedGain = 0;

    // Determine current recipe's category
    const currentRecipeCategory = tree.category || parentRecipeCategory;

    const children = tree[direction] || tree.usages || [];
    children.forEach(child => {
        if (child.itemId) {
            const itemInfo = getItemInfo(child.itemId);
            const quantity = child.quantityNeeded || child.quantity || 0;

            if (itemInfo && child.recipe) {
                // Child is crafted - calculate its net gain
                const childRecipe = child.recipe;
                const childRecipeCategory = child.category;
                const childOutput = (childRecipe.commission_product || []).find(([id]) => id === child.itemId);
                const childOutputQuantity = childOutput ? childOutput[1] : 1;
                const childMultiplier = child.quantityMultiplier || 1;

                // Get child's ORIGINAL ingredient pt cost (from the recipe's commission_cost, not scaled)
                const originalIngredients = childRecipe.commission_cost || [];
                let originalIngredientPtCost = 0;
                originalIngredients.forEach(([ingredientId, ingredientQuantity]) => {
                    const ingredientInfo = getItemInfo(ingredientId);
                    if (ingredientInfo && ingredientInfo.pt_num) {
                        originalIngredientPtCost += ingredientInfo.pt_num * ingredientQuantity;
                    }
                });

                // Calculate child's current recipe gain per unit (based on original recipe)
                const childCostPerUnit = originalIngredientPtCost / childOutputQuantity;
                const childCurrentGain = itemInfo.pt_num - childCostPerUnit;

                // Recursively get child's accumulated gains from THEIR children
                const childAccumulatedGain = calculateTreeNetGain(child, direction, childRecipeCategory);

                // Special case: Category 2 pickup items (no ingredients)
                // Category 2 items with no ingredients are pickups (gathered/collected)
                // Their pt_num is already counted in calculateTreePoints as ingredient cost
                // Their "net gain" would be pt_num - 0 = pt_num, which double-counts the points
                // To avoid double-counting, skip the entire contribution from cat2 pickup items
                const isCat2Pickup = childRecipeCategory === '2' && originalIngredientPtCost === 0;

                let contribution = 0;

                if (!isCat2Pickup) {
                    // Child's total net gain per unit = their current gain + their accumulated gain per unit
                    // Account for quantityMultiplier since childAccumulatedGain is already scaled
                    const totalChildOutput = childOutputQuantity * childMultiplier;
                    const accumulatedGainPerUnit = childAccumulatedGain / totalChildOutput;
                    const childTotalNetGainPerUnit = childCurrentGain + accumulatedGainPerUnit;

                    // Calculate contribution from crafting this item
                    contribution = childTotalNetGainPerUnit * quantity;
                }

                // If this crafted item is used for a shop purchase, add the exchange gain
                if (child.shopPurchaseContext) {
                    const shopItem = child.shopPurchaseContext.purchasedItemInfo;
                    const shopItemPtNum = shopItem.pt_num || 0;
                    const craftedItemPtNumCost = itemInfo.pt_num * quantity;
                    const shopItemQuantity = child.shopPurchaseContext.purchasedQuantity;
                    const shopItemTotalPtNum = shopItemPtNum * shopItemQuantity;

                    // Exchange gain: shop item's pt_num value - crafted item's pt_num cost
                    const exchangeGain = shopItemTotalPtNum - craftedItemPtNumCost;
                    contribution += exchangeGain;
                }

                // Add to total
                totalAccumulatedGain += contribution;
            } else if (itemInfo && child.shopPurchaseContext) {
                // Child is shop-purchased item WITHOUT a recipe (shouldn't happen with current logic)
                // The craftable item's net gain should be accumulated
                const childAccumulatedGain = calculateTreeNetGain(child, direction, currentRecipeCategory);
                totalAccumulatedGain += childAccumulatedGain;
            }
        }
    });

    return totalAccumulatedGain;
}

// ===== Shared Data Structure Builders =====

/**
 * Build dependency graph from recipes
 * Used by resource and restaurant modules
 */
function buildDependencyGraph(recipes) {
    const graph = {
        producedBy: {},  // itemId -> recipe ids that produce it
        usedBy: {}       // itemId -> recipe ids that use it
    };

    Object.entries(recipes).forEach(([category, recipeList]) => {
        recipeList.forEach(recipe => {
            // Track what this recipe produces
            (recipe.commission_product || []).forEach(([itemId]) => {
                if (!graph.producedBy[itemId]) {
                    graph.producedBy[itemId] = [];
                }
                graph.producedBy[itemId].push(recipe.id);
            });

            // Track what this recipe uses
            (recipe.commission_cost || []).forEach(([itemId]) => {
                if (!graph.usedBy[itemId]) {
                    graph.usedBy[itemId] = [];
                }
                graph.usedBy[itemId].push(recipe.id);
            });
        });
    });

    return graph;
}

/**
 * Build shop data index from shop goods data
 * Used by resource and restaurant modules
 */
function buildShopDataIndex(shopData) {
    const shopIndex = {};

    Object.entries(shopData).forEach(([shopEntryId, shopItem]) => {
        if (shopItem.items && shopItem.resource_consume) {
            const items = shopItem.items;
            if (items.length > 0) {
                const actualItemId = items[0][1];  // Second element = actual item ID
                const packSize = items[0][2];      // Third element = pack size
                const requiredItemId = shopItem.resource_consume[1];  // Required resource
                const cost = shopItem.resource_consume[2];            // Cost

                // Index by ACTUAL ITEM ID (what recipes use), not shop entry ID
                shopIndex[actualItemId] = [requiredItemId, cost, packSize];
            }
        }
    });

    return shopIndex;
}

/**
 * Build recipe indices for O(1) lookups
 * Used by resource, restaurant, and season-calc modules
 */
function buildRecipeIndices(recipes) {
    const recipeIndex = {};
    const recipeCategoryIndex = {};

    Object.entries(recipes).forEach(([categoryId, recipeList]) => {
        recipeList.forEach(recipe => {
            recipeIndex[recipe.id] = recipe;
            recipeCategoryIndex[recipe.id] = categoryId;
        });
    });

    return { recipeIndex, recipeCategoryIndex };
}

// ===== Public API =====
window.IslandEngine = {
    init,
    switchTab,
    activateTab,
    getActiveTab,
    loadModule,
    getSharedData,
    showError,
    showToast,
    getItemInfo,
    createSearchIndex: createIslandSearchIndex,
    searchCharacters,
    renderCharacterList,
    buildRecipeDependencyTree,
    calculateTreeCost,
    calculateTreePoints,
    calculateTreeNetGain,
    buildDependencyGraph,
    buildShopDataIndex,
    buildRecipeIndices,
    GOLD_ITEM_ID,
    state: () => state
};

export {
    init,
    switchTab,
    activateTab,
    getActiveTab,
    loadModule,
    getSharedData,
    showError,
    getItemInfo,
    createIslandSearchIndex as createSearchIndex,
    searchCharacters,
    renderCharacterList,
    buildRecipeDependencyTree,
    calculateTreeCost,
    calculateTreePoints,
    calculateTreeNetGain,
    buildDependencyGraph,
    buildShopDataIndex,
    buildRecipeIndices,
    GOLD_ITEM_ID
};
