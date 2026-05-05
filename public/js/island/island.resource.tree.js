/**
 * island.resource.tree.js
 * Tree-building and calculation sub-module for the island resource system.
 * Provides upstream/downstream dependency trees, LRU-cached tree results, gold/resource
 * cost calculations, and cumulative time (including manual-mode propagation for category 1).
 * State is shared via setup() called from island.resource.engine.js.
 */

'use strict';

// ===== Constants =====
export const CONSTANTS = {
    MANUAL_TIME_MULTIPLIER: 0.7,      // 30% time reduction for manual mode
    MAX_TREE_DEPTH: 5,                // Maximum recursion depth for dependency trees
    DECISECONDS_PER_HOUR: 36000,      // Conversion factor: deciseconds to hours
    DECISECONDS_PER_MINUTE: 600,      // Conversion factor: deciseconds to minutes
    DEBOUNCE_DELAY: 300,              // Milliseconds to wait before search
    GOLD_ITEM_ID: 1,                  // Item ID for gold currency
    MAX_CACHE_SIZE: 200               // Bounded memoization for buildUpstreamTree. Sized to cover
                                      // season-calc's full-grid render (~138 unique trees) plus
                                      // headroom for the resource browser, while staying small
                                      // enough that total cache memory is negligible (each tree is
                                      // depth-bounded at MAX_TREE_DEPTH=5).
};

// ===== State Reference (set via setup) =====
let state;

export function setup(stateRef) {
    state = stateRef;
}

// ===== Utility Functions =====

/** O(1) recipe lookup by ID. */
export function findRecipeById(id) {
    return state.recipeIndex[id] || null;
}

/** O(1) category lookup for a recipe ID. */
export function findRecipeCategoryById(id) {
    return state.recipeCategoryIndex[id] || null;
}

// ===== Cache Management =====

/**
 * Clear all cached dependency trees
 */
export function clearTreeCache() {
    state.treeCache = {};
}

/**
 * Add entry to cache with LRU eviction
 * Prevents unbounded memory growth by limiting cache size
 */
function addToCache(key, value) {
    const cacheKeys = Object.keys(state.treeCache);

    // If cache is full, remove oldest entry (first key). Silent — eviction
    // is normal LRU behavior, not an error worth logging per call.
    if (cacheKeys.length >= CONSTANTS.MAX_CACHE_SIZE) {
        delete state.treeCache[cacheKeys[0]];
    }

    state.treeCache[key] = value;
}

/**
 * Get entry from cache
 */
function getFromCache(key) {
    return state.treeCache[key];
}

// ===== Dependency Tree Building =====

/**
 * Build an upstream dependency tree for a recipe (what ingredients are needed to produce it).
 * Supports manual mode (category 1 uses 'cost' field), quantity scaling, and LRU caching for
 * root-level calls. Shop-purchasable items are represented as leaf nodes with cost data.
 */
export function buildUpstreamTree(recipeId, options = {}) {
    const {
        useManualMode = false,
        quantityMultiplier = 1,
        maxDepth = CONSTANTS.MAX_TREE_DEPTH,
        visited = new Set(),
        useCache = true
    } = options;

    // Check cache for root-level calls (quantityMultiplier = 1)
    if (useCache && quantityMultiplier === 1 && visited.size === 0) {
        const cacheKey = `upstream_${recipeId}_${useManualMode}`;
        const cached = getFromCache(cacheKey);
        if (cached) {
            return cached;
        }
    }

    if (visited.has(recipeId) || maxDepth === 0) return null;
    visited.add(recipeId);

    const recipe = findRecipeById(recipeId);
    if (!recipe) return null;

    const recipeCategory = findRecipeCategoryById(recipeId);
    const isCategory1 = recipeCategory === '1';

    // For category 1 with manual mode, use 'cost' field; otherwise use 'commission_cost'
    const inputField = (useManualMode && isCategory1 && recipe.cost?.length > 0)
        ? 'cost'
        : 'commission_cost';
    const inputs = (recipe[inputField] || []).map(([id, quantity]) => ({ id, quantity }));
    const dependencies = [];

    inputs.forEach(({ id: itemId, quantity }) => {
        // Scale quantity by how many times we need to run this recipe
        const scaledQuantity = quantity * quantityMultiplier;

        const producers = state.dependencyGraph.producedBy[itemId] || [];

        // Check if this item can be purchased from shop
        const shopPurchase = state.shopPurchaseData[itemId];

        if (shopPurchase) {
            // Item can be purchased from shop
            const [requiredItemId, unitCost, packSize = 1] = shopPurchase;
            // Calculate cost per item and total cost
            const costPerItem = unitCost / packSize;
            const totalCost = costPerItem * scaledQuantity;
            // Calculate how many packs needed for display (round up)
            const packsNeeded = Math.ceil(scaledQuantity / packSize);

            dependencies.push({
                itemId,
                itemInfo: window.IslandEngine.getItemInfo(itemId),
                quantity: scaledQuantity,
                isShopPurchase: true,
                shopCost: {
                    itemId: requiredItemId,
                    itemInfo: window.IslandEngine.getItemInfo(requiredItemId),
                    unitCost: unitCost,
                    packSize: packSize,
                    costPerItem: costPerItem,
                    packsNeeded: packsNeeded,
                    totalCost: totalCost,
                    quantity: scaledQuantity
                }
            });

            // If the shop purchase requires another item (not gold), recursively build its tree
            if (requiredItemId !== CONSTANTS.GOLD_ITEM_ID && state.dependencyGraph.producedBy[requiredItemId]) {
                const childProducers = state.dependencyGraph.producedBy[requiredItemId];
                childProducers.forEach(producerId => {
                    const childRecipe = findRecipeById(producerId);
                    if (!childRecipe) return;

                    // Calculate how many times we need to run the child recipe
                    // Always use commission_product because commission_cost quantities are designed for commission_product outputs
                    const childOutput = (childRecipe.commission_product || []).find(([id]) => id === requiredItemId);
                    const childOutputQuantity = childOutput ? childOutput[1] : 1;
                    const childMultiplier = scaledQuantity / childOutputQuantity;

                    const childVisited = new Set(visited);
                    const child = buildUpstreamTree(producerId, {
                        useManualMode,
                        quantityMultiplier: childMultiplier,
                        maxDepth: maxDepth - 1,
                        visited: childVisited
                    });
                    if (child) {
                        dependencies.push({
                            itemId: requiredItemId,
                            itemInfo: window.IslandEngine.getItemInfo(requiredItemId),
                            quantityNeeded: scaledQuantity,
                            ...child
                        });
                    }
                });
            }
        } else if (producers.length > 0) {
            // Item is produced by recipes
            producers.forEach(producerId => {
                const childRecipe = findRecipeById(producerId);
                if (!childRecipe) return;

                // Calculate how many times we need to run the child recipe
                // Always use commission_product because commission_cost quantities are designed for commission_product outputs
                const childOutput = (childRecipe.commission_product || []).find(([id]) => id === itemId);
                const childOutputQuantity = childOutput ? childOutput[1] : 1;
                const childMultiplier = scaledQuantity / childOutputQuantity;

                const childVisited = new Set(visited);
                const child = buildUpstreamTree(producerId, {
                    useManualMode,
                    quantityMultiplier: childMultiplier,
                    maxDepth: maxDepth - 1,
                    visited: childVisited
                });
                if (child) {
                    dependencies.push({
                        itemId,
                        itemInfo: window.IslandEngine.getItemInfo(itemId),
                        quantityNeeded: scaledQuantity,
                        ...child
                    });
                }
            });
        }
    });

    const result = {
        recipe,
        recipeId: recipe.id,
        category: recipeCategory,
        quantityMultiplier: quantityMultiplier,
        dependencies,
        isManualMode: useManualMode && isCategory1 && recipe.cost?.length > 0
    };

    // Cache root-level results with size limit
    if (useCache && quantityMultiplier === 1 && visited.size === 1) {
        const cacheKey = `upstream_${recipeId}_${useManualMode}`;
        addToCache(cacheKey, result);
    }

    return result;
}

/**
 * Build a downstream usage tree for a recipe (what recipes consume its outputs).
 * Results are LRU-cached for root-level calls; recursive calls skip the cache to avoid stale data.
 */
export function buildDownstreamTree(recipeId, options = {}) {
    const {
        maxDepth = CONSTANTS.MAX_TREE_DEPTH,
        visited = new Set(),
        useCache = true
    } = options;

    // Check cache for root-level calls
    if (useCache && visited.size === 0) {
        const cacheKey = `downstream_${recipeId}`;
        const cached = getFromCache(cacheKey);
        if (cached) {
            return cached;
        }
    }
    if (visited.has(recipeId) || maxDepth === 0) return null;
    visited.add(recipeId);

    const recipe = findRecipeById(recipeId);
    if (!recipe) return null;

    const outputs = (recipe.commission_product || []).map(([id]) => id);
    const usages = [];

    outputs.forEach(itemId => {
        const consumers = state.dependencyGraph.usedBy[itemId] || [];
        consumers.forEach(consumerId => {
            const childVisited = new Set(visited);
            const child = buildDownstreamTree(consumerId, {
                maxDepth: maxDepth - 1,
                visited: childVisited,
                useCache: false  // Don't cache recursive calls
            });
            if (child) {
                usages.push({
                    itemId,
                    itemInfo: window.IslandEngine.getItemInfo(itemId),
                    ...child
                });
            }
        });
    });

    const result = {
        recipe,
        recipeId: recipe.id,
        category: findRecipeCategoryById(recipe.id),
        usages
    };

    // Cache root-level results with size limit
    if (useCache && visited.size === 1) {
        const cacheKey = `downstream_${recipeId}`;
        addToCache(cacheKey, result);
    }

    return result;
}

// ===== Tree Statistics & Cost Calculations =====

/**
 * Calculate tree statistics (total recipes, max depth)
 */
export function calculateTreeStats(tree, direction = 'dependencies') {
    if (!tree) return { count: 0, depth: 0 };

    let count = 1; // Count current node
    let maxDepth = 0;

    const children = tree[direction] || tree.usages || [];
    children.forEach(child => {
        const childStats = calculateTreeStats(child, direction);
        count += childStats.count;
        maxDepth = Math.max(maxDepth, childStats.depth + 1);
    });

    return { count, depth: maxDepth };
}

/**
 * Calculate total gold consumption from shop purchases in the tree
 */
export function calculateGoldConsumption(tree, direction = 'dependencies') {
    if (!tree) return { gold: 0, resources: {} };

    let gold = 0;
    const resources = {};

    const children = tree[direction] || tree.usages || [];
    children.forEach(child => {
        // Check if this is a shop purchase
        if (child.isShopPurchase && child.shopCost) {
            const { itemId, totalCost, itemInfo } = child.shopCost;

            if (itemId === CONSTANTS.GOLD_ITEM_ID) {
                // Gold purchase
                gold += totalCost;
            } else {
                // Resource purchase
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
        const childCosts = calculateGoldConsumption(child, direction);
        gold += childCosts.gold;

        // Merge resource costs
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
 * Calculate gold consumption for manual mode (category 1)
 * Manual mode uses recipe.cost as input
 */
export function calculateManualGoldConsumption(recipe) {
    let gold = 0;
    const resources = {};

    // For manual mode, we only look at the direct cost
    (recipe.cost || []).forEach(([itemId, quantity]) => {
        const shopPurchase = state.shopPurchaseData[itemId];

        if (shopPurchase) {
            const [requiredItemId, unitCost, packSize = 1] = shopPurchase;
            // Calculate cost per item and total cost
            const costPerItem = unitCost / packSize;
            const totalCost = costPerItem * quantity;

            if (requiredItemId === CONSTANTS.GOLD_ITEM_ID) {
                // Gold purchase
                gold += totalCost;
            } else {
                // Resource purchase
                const itemInfo = window.IslandEngine.getItemInfo(requiredItemId);
                if (!resources[requiredItemId]) {
                    resources[requiredItemId] = {
                        name: itemInfo.name,
                        icon: itemInfo.icon,
                        amount: 0
                    };
                }
                resources[requiredItemId].amount += totalCost;
            }
        }
    });

    return { gold, resources };
}

/**
 * Calculate gold consumption with manual mode propagation
 * For categories 3, 4, 6: if inputs come from category 1, use manual costs
 */
export function calculateGoldConsumptionWithManual(upstreamTree, useManualForCat1 = true) {
    if (!upstreamTree) return { gold: 0, resources: {} };

    let gold = 0;
    const resources = {};

    const dependencies = upstreamTree.dependencies || [];
    dependencies.forEach(dep => {
        // Check if this is a shop purchase
        if (dep.isShopPurchase && dep.shopCost) {
            const { itemId, totalCost, itemInfo } = dep.shopCost;

            if (itemId === CONSTANTS.GOLD_ITEM_ID) {
                // Gold purchase - count it
                gold += totalCost;
            } else {
                // Resource purchase - skip it, the producer recipe will handle the cost calculation
                // The producer recipe is added as a separate dependency in buildUpstreamTree
                return;
            }
        } else if (dep.recipe) {
            // Check if this recipe is from category 1
            const depCategory = findRecipeCategoryById(dep.recipe.id);
            const isCategory1 = depCategory === '1';

            if (isCategory1 && useManualForCat1 && dep.recipe.cost && dep.recipe.cost.length > 0) {
                // Use manual costs for category 1 items
                (dep.recipe.cost || []).forEach(([itemId, quantity]) => {
                    const actualQuantity = quantity * (dep.quantityMultiplier || 1);
                    const shopPurchase = state.shopPurchaseData[itemId];

                    if (shopPurchase) {
                        const [requiredItemId, unitCost, packSize = 1] = shopPurchase;
                        // Calculate cost per item and total cost
                        const costPerItem = unitCost / packSize;
                        const totalCost = costPerItem * actualQuantity;

                        if (requiredItemId === CONSTANTS.GOLD_ITEM_ID) {
                            gold += totalCost;
                        } else {
                            const itemInfo = window.IslandEngine.getItemInfo(requiredItemId);
                            if (!resources[requiredItemId]) {
                                resources[requiredItemId] = {
                                    name: itemInfo.name,
                                    icon: itemInfo.icon,
                                    amount: 0
                                };
                            }
                            resources[requiredItemId].amount += totalCost;
                        }
                    }
                });
            } else {
                // Recursively calculate for non-category-1 items
                const childCosts = calculateGoldConsumptionWithManual(dep, useManualForCat1);
                gold += childCosts.gold;

                // Merge resource costs
                Object.entries(childCosts.resources).forEach(([itemId, data]) => {
                    if (!resources[itemId]) {
                        resources[itemId] = { ...data };
                    } else {
                        resources[itemId].amount += data.amount;
                    }
                });
            }
        }
    });

    return { gold, resources };
}

// ===== Time Calculations =====

/**
 * Calculate cumulative time per unit of output for a recipe
 * This follows the formula: cumulative_time = recipe.workload + sum(input_qty * cumulative_time_per_unit(input))
 *
 * Example: tofu - soy beans - soy bean seeds
 * - Soy bean seeds: base material (0 time)
 * - Soybeans: 9 seeds → 27 soybeans in 1h40m = 100m/27 per soybean
 * - Tofu: 15 soybeans → 1 tofu in 2h
 *   cumulative = 2h + 15 * (100m/27) = 120m + 55.56m = 175.56m per tofu
 */
export function calculateCumulativeTime(recipeId, upstreamTree) {
    const recipe = findRecipeById(recipeId);
    if (!recipe) return recipe?.workload || 0;

    // Start with current recipe's workload (per output quantity)
    const outputQuantity = (recipe.commission_product?.[0]?.[1]) || 1;
    let cumulativeTimePerUnit = recipe.workload / outputQuantity;

    // Add time for each input material
    (recipe.commission_cost || []).forEach(([itemId, inputQuantity]) => {
        // Find recipes that produce this item
        const producers = state.dependencyGraph.producedBy[itemId] || [];

        if (producers.length > 0) {
            // Use the first producer (primary recipe)
            const producerRecipe = findRecipeById(producers[0]);
            if (producerRecipe) {
                // Recursively calculate cumulative time for the producer
                const producerCumulativeTime = calculateCumulativeTimeRecursive(producers[0]);

                // Add time for producing the needed input quantity
                cumulativeTimePerUnit += inputQuantity * producerCumulativeTime;
            }
        }
        // If no producer found, assume it's a base material with 0 time
    });

    return cumulativeTimePerUnit * outputQuantity; // Return total time for this recipe's output
}

/**
 * Helper function to recursively calculate cumulative time per unit
 */
function calculateCumulativeTimeRecursive(recipeId, visited = new Set()) {
    if (visited.has(recipeId)) return 0; // Prevent infinite loops
    visited.add(recipeId);

    const recipe = findRecipeById(recipeId);
    if (!recipe) return 0;

    const outputQuantity = (recipe.commission_product?.[0]?.[1]) || 1;
    let cumulativeTimePerUnit = recipe.workload / outputQuantity;

    // Add time for each input material
    (recipe.commission_cost || []).forEach(([itemId, inputQuantity]) => {
        const producers = state.dependencyGraph.producedBy[itemId] || [];

        if (producers.length > 0 && !visited.has(producers[0])) {
            const producerCumulativeTime = calculateCumulativeTimeRecursive(producers[0], new Set(visited));
            cumulativeTimePerUnit += inputQuantity * producerCumulativeTime;
        }
    });

    return cumulativeTimePerUnit;
}

/**
 * Calculate cumulative time for manual mode (category 1)
 * Manual mode has 30% time reduction for the current recipe
 * Input materials still use auto mode time (they're produced automatically)
 */
export function calculateCumulativeTimeManual(recipe) {
    // For manual mode in category 1, use drop_display quantity
    const outputQuantity = (recipe.drop_display?.[0]?.[1]) || (recipe.commission_product?.[0]?.[1]) || 1;

    // Manual mode: 30% time reduction for the main recipe
    let cumulativeTimePerUnit = (recipe.workload * CONSTANTS.MANUAL_TIME_MULTIPLIER) / outputQuantity;

    // Add time for each input material (using cost, not commission_cost)
    (recipe.cost || []).forEach(([itemId, inputQuantity]) => {
        // Find recipes that produce this item
        const producers = state.dependencyGraph.producedBy[itemId] || [];

        if (producers.length > 0) {
            // Use auto mode cumulative time for producing inputs
            const producerCumulativeTime = calculateCumulativeTimeRecursive(producers[0]);
            cumulativeTimePerUnit += inputQuantity * producerCumulativeTime;
        }
    });

    return cumulativeTimePerUnit * outputQuantity; // Return total time for this recipe's output
}

/**
 * Calculate cumulative time with manual propagation from category 1
 * For categories 3, 4, 6: category 1 dependencies use manual time
 */
export function calculateCumulativeTimeWithManual(recipe, useManualForCat1 = true) {
    const outputQuantity = (recipe.commission_product?.[0]?.[1]) || 1;
    let cumulativeTimePerUnit = recipe.workload / outputQuantity;

    // Add time for each input material
    (recipe.commission_cost || []).forEach(([itemId, inputQuantity]) => {
        const producers = state.dependencyGraph.producedBy[itemId] || [];

        if (producers.length > 0) {
            const producerRecipe = findRecipeById(producers[0]);
            const producerCategory = findRecipeCategoryById(producers[0]);
            const isProducerCat1 = producerCategory === '1';

            if (isProducerCat1 && useManualForCat1 && producerRecipe.cost && producerRecipe.cost.length > 0) {
                // Use manual time for category 1 - use drop_display quantity
                const producerOutputQty = (producerRecipe.drop_display?.[0]?.[1]) || (producerRecipe.commission_product?.[0]?.[1]) || 1;
                let producerTimePerUnit = (producerRecipe.workload * CONSTANTS.MANUAL_TIME_MULTIPLIER) / producerOutputQty;

                // Add time for producer's inputs (auto mode)
                (producerRecipe.cost || []).forEach(([costItemId, costQuantity]) => {
                    const costProducers = state.dependencyGraph.producedBy[costItemId] || [];
                    if (costProducers.length > 0) {
                        const costProducerTime = calculateCumulativeTimeRecursive(costProducers[0]);
                        producerTimePerUnit += costQuantity * costProducerTime;
                    }
                });

                cumulativeTimePerUnit += inputQuantity * producerTimePerUnit;
            } else {
                // Use auto mode cumulative time
                const producerCumulativeTime = calculateCumulativeTimeRecursive(producers[0]);
                cumulativeTimePerUnit += inputQuantity * producerCumulativeTime;
            }
        }
    });

    return cumulativeTimePerUnit * outputQuantity;
}
