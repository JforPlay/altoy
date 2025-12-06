/**
 * Island Resource Module
 * Handles recipe browsing, dependency tracking, and chain visualization
 */

window.ResourceModule = (function () {
    'use strict';

    // ============================================
    // CONSTANTS
    // ============================================
    const CONSTANTS = {
        MANUAL_TIME_MULTIPLIER: 0.7,      // 30% time reduction for manual mode
        MAX_TREE_DEPTH: 5,                // Maximum recursion depth for dependency trees
        DECISECONDS_PER_HOUR: 36000,      // Conversion factor: deciseconds to hours
        DECISECONDS_PER_MINUTE: 600,      // Conversion factor: deciseconds to minutes
        DEBOUNCE_DELAY: 300,              // Milliseconds to wait before search
        GOLD_ITEM_ID: 1,                  // Item ID for gold currency
        MAX_CACHE_SIZE: 50                // Maximum number of cached dependency trees (prevents memory leaks)
    };

    // ============================================
    // STATE
    // ============================================
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

    const categoryNames = {
        '1': '재배 (Farming)',
        '2': '채집 (Gathering)',
        '3': '사육 (Husbandry)',
        '4': '요리 (Cooking)',
        '6': '제조 (Manufacturing)',
        '시즌템': '시즌템 (Seasonal Items)'
    };

    // ============================================
    // INITIALIZATION
    // ============================================

    async function init(sharedData) {
        try {
            // Use shared item data instead of loading again
            if (sharedData && sharedData.items) {
                state.items = sharedData.items;
            }

            // Load module-specific data files
            const [recipesData, shopData] = await Promise.all([
                IslandEngine.fetchJSON('data/island/recipes.json'),
                IslandEngine.fetchJSON('data/island/island_shop_goods.json')
            ]);

            state.recipes = recipesData;

            // Process shop data using shared function
            state.shopPurchaseData = IslandEngine.buildShopDataIndex(shopData);

            // Build recipe and category indices using shared function
            const { recipeIndex, recipeCategoryIndex } = IslandEngine.buildRecipeIndices(state.recipes);
            state.recipeIndex = recipeIndex;
            state.recipeCategoryIndex = recipeCategoryIndex;

            // Build dependency graph using shared function
            state.dependencyGraph = IslandEngine.buildDependencyGraph(state.recipes);

            // Build seasonal items category (must be after dependency graph)
            buildSeasonalItemsCategory();

            // Rebuild recipe indices to include seasonal items
            const updatedIndices = IslandEngine.buildRecipeIndices(state.recipes);
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
            IslandEngine.showError('Failed to load resource data');
        }
    }

    // buildShopDataIndex moved to island.engine.js (shared utility)

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
            const itemInfo = IslandEngine.getItemInfo(itemId);

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

    // buildRecipeIndices moved to island.engine.js (shared utility)

    // ============================================
    // CACHE MANAGEMENT (Fixed Memory Leaks)
    // ============================================

    /**
     * Clear all cached dependency trees
     */
    function clearTreeCache() {
        state.treeCache = {};
        console.log('[Resource] Cache cleared');
    }

    /**
     * Add entry to cache with LRU eviction
     * Prevents unbounded memory growth by limiting cache size
     */
    function addToCache(key, value) {
        const cacheKeys = Object.keys(state.treeCache);

        // If cache is full, remove oldest entry (first key)
        if (cacheKeys.length >= CONSTANTS.MAX_CACHE_SIZE) {
            const oldestKey = cacheKeys[0];
            delete state.treeCache[oldestKey];
            console.log(`[Resource] Cache limit reached (${CONSTANTS.MAX_CACHE_SIZE}), evicted oldest entry`);
        }

        state.treeCache[key] = value;
    }

    /**
     * Get entry from cache
     */
    function getFromCache(key) {
        return state.treeCache[key];
    }

    // ============================================
    // DEPENDENCY GRAPH
    // ============================================

    // buildDependencyGraph moved to island.engine.js (shared utility)

    function buildUpstreamTree(recipeId, options = {}) {
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
                    itemInfo: IslandEngine.getItemInfo(itemId),
                    quantity: scaledQuantity,
                    isShopPurchase: true,
                    shopCost: {
                        itemId: requiredItemId,
                        itemInfo: IslandEngine.getItemInfo(requiredItemId),
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
                                itemInfo: IslandEngine.getItemInfo(requiredItemId),
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
                            itemInfo: IslandEngine.getItemInfo(itemId),
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

    function buildDownstreamTree(recipeId, options = {}) {
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
                        itemInfo: IslandEngine.getItemInfo(itemId),
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

    /**
     * Calculate tree statistics (total recipes, max depth)
     */
    function calculateTreeStats(tree, direction = 'dependencies') {
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
    function calculateGoldConsumption(tree, direction = 'dependencies') {
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
    function calculateManualGoldConsumption(recipe) {
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
                    const itemInfo = IslandEngine.getItemInfo(requiredItemId);
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
    function calculateGoldConsumptionWithManual(upstreamTree, useManualForCat1 = true) {
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
                                const itemInfo = IslandEngine.getItemInfo(requiredItemId);
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
    function calculateCumulativeTime(recipeId, upstreamTree) {
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
                    const producerOutputQty = (producerRecipe.commission_product?.[0]?.[1]) || 1;
                    const timePerProducerOutput = producerRecipe.workload / producerOutputQty;

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
    function calculateCumulativeTimeManual(recipe) {
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
    function calculateCumulativeTimeWithManual(recipe, useManualForCat1 = true) {
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

    // ============================================
    // UI RENDERING
    // ============================================

    function renderCategoryFilter() {
        const container = document.getElementById('resource-category-filter');
        if (!container) return;

        const html = `
            <div class="resource-filter-controls">
                <div class="dropdown-container">
                    <select id="recipe-category-select" class="category-select">
                        ${Object.entries(categoryNames).map(([id, name]) => `
                            <option value="${id}" ${id === state.selectedCategory ? 'selected' : ''}>
                                ${name}
                            </option>
                        `).join('')}
                    </select>
                    <span class="material-symbols-outlined dropdown-icon">expand_more</span>
                </div>
                <div class="dropdown-container">
                    <input type="text" 
                           id="recipe-search" 
                           class="search-input" 
                           placeholder="레시피를 검색하세요..."
                           autocomplete="off">
                    <span class="material-symbols-outlined dropdown-icon">search</span>
                </div>
                <div class="filter-action">
                    <button id="recipe-forest-btn" class="ghost-btn tree-btn" type="button">
                        <span class="material-symbols-outlined">account_tree</span>
                        레시피 트리
                    </button>
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    function renderRecipeList() {
        const container = document.getElementById('recipe-list');
        if (!container) return;

        const categoryRecipes = state.recipes[state.selectedCategory] || [];

        // Filter by search query
        const filteredRecipes = state.searchQuery
            ? categoryRecipes.filter(r =>
                r.name?.toLowerCase().includes(state.searchQuery.toLowerCase())
            )
            : categoryRecipes;

        if (filteredRecipes.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-outlined">search_off</span>
                    <p>검색 결과가 없습니다</p>
                </div>
            `;
            return;
        }

        const html = filteredRecipes.map(recipe => {
            const item = IslandEngine.getItemInfo(recipe.item_id);
            const isSelected = state.selectedRecipe?.id === recipe.id;

            return `
                <div class="recipe-card ${isSelected ? 'active' : ''}" 
                     data-recipe-id="${recipe.id}">
                                            <div class="recipe-icon">
                                                ${item.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${item.icon.split('/').pop()}.png" alt="${item.name}">` : '📦'}
                                            </div>                    <div class="recipe-info">
                        <div class="recipe-name">${recipe.name || item.name}</div>
                        <div class="recipe-meta">
                            <span class="recipe-time">⏱ ${IslandEngine.formatTime(recipe.workload)}</span>
                            <span class="recipe-exp">⚡ ${recipe.ship_exp}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
    }

    function gatherRecipeData(recipe) {
        const item = IslandEngine.getItemInfo(recipe.item_id);
        const category = categoryNames[state.selectedCategory];
        const isCategory1 = state.selectedCategory === '1';
        const isCategory2 = state.selectedCategory === '2';
        const isCategory3 = state.selectedCategory === '3';
        const isCategory4 = state.selectedCategory === '4';
        const isCategory6 = state.selectedCategory === '6';
        const showDualCost = isCategory1; // Only category 1 has manual/auto distinction

        // Get upstream/downstream recipes
        const outputs = (recipe.commission_product || []).map(([id]) => id);
        const usedInRecipes = outputs.flatMap(itemId =>
            state.dependencyGraph.usedBy[itemId] || []
        );

        const inputs = (recipe.commission_cost || []).map(([id]) => id);
        const producedByRecipes = inputs.flatMap(itemId =>
            state.dependencyGraph.producedBy[itemId] || []
        );

        // Build upstream tree using shared utility
        const upstreamTree = IslandEngine.buildRecipeDependencyTree(
            recipe.id,
            state.recipeIndex,
            state.recipeCategoryIndex,
            state.dependencyGraph,
            state.shopPurchaseData,
            { useManualMode: false }
        );

        // Calculate gold consumption using shared utility
        const goldConsumption = IslandEngine.calculateTreeCost(upstreamTree);

        // Calculate season points for ingredients only (new approach)
        const seasonPointsConsumption = IslandEngine.calculateTreePoints(upstreamTree);

        // Debug: log tree structure for 우유
        if (recipe.item_id === 2603) {
            console.log('[Resource Engine] 우유 upstreamTree:', upstreamTree);
            console.log('[Resource Engine] 우유 dependencies:', JSON.stringify(upstreamTree.dependencies.map(d => ({
                itemId: d.itemId,
                itemName: d.itemInfo?.name,
                quantityNeeded: d.quantityNeeded,
                hasRecipe: !!d.recipe,
                hasShopPurchaseContext: !!d.shopPurchaseContext,
                shopPurchaseContext: d.shopPurchaseContext
            })), null, 2));
        }

        // Calculate net gain accumulated from entire tree
        const netGainTotal = IslandEngine.calculateTreeNetGain(upstreamTree);

        // Calculate manual gold consumption
        let manualGoldConsumption = { gold: 0, resources: {} };
        let manualSeasonPointsConsumption = 0;
        let manualNetGainTotal = 0;
        let upstreamTreeManual = null;

        // Only calculate manual mode for category 1
        if (isCategory1 && recipe.cost && recipe.cost.length > 0) {
            manualGoldConsumption = calculateManualGoldConsumption(recipe);
            upstreamTreeManual = IslandEngine.buildRecipeDependencyTree(
                recipe.id,
                state.recipeIndex,
                state.recipeCategoryIndex,
                state.dependencyGraph,
                state.shopPurchaseData,
                { useManualMode: true }
            );
            manualSeasonPointsConsumption = IslandEngine.calculateTreePoints(upstreamTreeManual);
            manualNetGainTotal = IslandEngine.calculateTreeNetGain(upstreamTreeManual);
        }

        // Calculate normalized costs with cumulative time
        const outputQuantity = (recipe.commission_product && recipe.commission_product.length > 0)
            ? recipe.commission_product[0][1]
            : 1;

        const cumulativeTimeAuto = calculateCumulativeTime(recipe.id, upstreamTree);
        const cumulativeTimeAutoInHours = cumulativeTimeAuto / CONSTANTS.DECISECONDS_PER_HOUR;
        const costPerItemAuto = goldConsumption.gold > 0 ? goldConsumption.gold / outputQuantity : 0;
        const costPerHourAuto = cumulativeTimeAutoInHours > 0 ? goldConsumption.gold / cumulativeTimeAutoInHours : 0;

        // Calculate manual costs
        let costPerItemManual = 0;
        let costPerHourManual = 0;
        let cumulativeTimeManual = 0;
        let ptPerItemManual = 0;
        let ptPerItemAuto = 0;
        let netGainPerItemManual = 0;
        let netGainPerItemAuto = 0;
        let currentRecipeGainPerItemAuto = 0;
        let currentRecipeGainPerItemManual = 0;
        let currentRecipeGainPerMinAuto = 0;
        let currentRecipeGainPerMinManual = 0;
        let netGainPerMinAuto = 0;
        let netGainPerMinManual = 0;
        
        if (showDualCost && manualGoldConsumption.gold > 0) {
            cumulativeTimeManual = calculateCumulativeTimeManual(recipe);

            const cumulativeTimeManualInHours = cumulativeTimeManual / CONSTANTS.DECISECONDS_PER_HOUR;
            // For category 1, use drop_display quantity for manual calculation
            const manualOutputQuantity = (recipe.drop_display && recipe.drop_display.length > 0)
                ? recipe.drop_display[0][1]
                : outputQuantity;
            costPerItemManual = manualGoldConsumption.gold / manualOutputQuantity;
            costPerHourManual = cumulativeTimeManualInHours > 0 ? manualGoldConsumption.gold / cumulativeTimeManualInHours : 0;
            
            // Calculate per-item season points for both modes
            ptPerItemManual = manualSeasonPointsConsumption / manualOutputQuantity;
            ptPerItemAuto = seasonPointsConsumption / outputQuantity;

            // Calculate current recipe's own net gain (before adding accumulated gains from children)
            currentRecipeGainPerItemAuto = item.pt_num - ptPerItemAuto;
            currentRecipeGainPerItemManual = item.pt_num - ptPerItemManual;

            // Calculate per-item net gain for both modes
            // Net gain = current recipe gain + accumulated gains from lower levels
            const accumulatedGainPerItemAuto = netGainTotal / outputQuantity;
            const accumulatedGainPerItemManual = manualNetGainTotal / manualOutputQuantity;

            netGainPerItemAuto = currentRecipeGainPerItemAuto + accumulatedGainPerItemAuto;
            netGainPerItemManual = currentRecipeGainPerItemManual + accumulatedGainPerItemManual;

            // Calculate per-minute pt gains
            const recipeTimeInMinutesAuto = recipe.workload / CONSTANTS.DECISECONDS_PER_MINUTE;
            const recipeTimeInMinutesManual = (recipe.workload * CONSTANTS.MANUAL_TIME_MULTIPLIER) / CONSTANTS.DECISECONDS_PER_MINUTE;
            const cumulativeTimeAutoInMinutes = cumulativeTimeAuto / CONSTANTS.DECISECONDS_PER_MINUTE;
            const cumulativeTimeManualInMinutes = cumulativeTimeManual / CONSTANTS.DECISECONDS_PER_MINUTE;

            currentRecipeGainPerMinAuto = recipeTimeInMinutesAuto > 0 ? (currentRecipeGainPerItemAuto * outputQuantity) / recipeTimeInMinutesAuto : 0;
            currentRecipeGainPerMinManual = recipeTimeInMinutesManual > 0 ? (currentRecipeGainPerItemManual * manualOutputQuantity) / recipeTimeInMinutesManual : 0;
            netGainPerMinAuto = cumulativeTimeAutoInMinutes > 0 ? (netGainPerItemAuto * outputQuantity) / cumulativeTimeAutoInMinutes : 0;
            netGainPerMinManual = cumulativeTimeManualInMinutes > 0 ? (netGainPerItemManual * manualOutputQuantity) / cumulativeTimeManualInMinutes : 0;
        } else {
            // For non-dual cost modes, calculate net gain per item
            ptPerItemAuto = seasonPointsConsumption / outputQuantity;

            // Calculate current recipe's own net gain
            currentRecipeGainPerItemAuto = item.pt_num - ptPerItemAuto;

            // Net gain = current recipe gain + accumulated gains from lower levels
            const accumulatedGainPerItem = netGainTotal / outputQuantity;
            netGainPerItemAuto = currentRecipeGainPerItemAuto + accumulatedGainPerItem;

            // Calculate per-minute pt gains
            const recipeTimeInMinutesAuto = recipe.workload / CONSTANTS.DECISECONDS_PER_MINUTE;
            const cumulativeTimeAutoInMinutes = cumulativeTimeAuto / CONSTANTS.DECISECONDS_PER_MINUTE;

            currentRecipeGainPerMinAuto = recipeTimeInMinutesAuto > 0 ? (currentRecipeGainPerItemAuto * outputQuantity) / recipeTimeInMinutesAuto : 0;
            netGainPerMinAuto = cumulativeTimeAutoInMinutes > 0 ? (netGainPerItemAuto * outputQuantity) / cumulativeTimeAutoInMinutes : 0;
            
            // Debug logging for 아이스 커피
            if (item.id === 3005) {
                console.log('[Resource Engine] 아이스 커피 calculation:', {
                    itemPtNum: item.pt_num,
                    seasonPointsConsumption,
                    outputQuantity,
                    ptPerItemAuto,
                    currentRecipeGainPerItemAuto,
                    netGainTotal,
                    accumulatedGainPerItem,
                    netGainPerItemAuto
                });
            }
        }        return {
            item,
            category,
            isCategory1,
            isCategory2,
            isCategory3,
            isCategory4,
            isCategory6,
            showDualCost,
            usedInRecipes,
            producedByRecipes,
            goldConsumption,
            manualGoldConsumption,
            seasonPointsConsumption,
            manualSeasonPointsConsumption,
            netGainTotal,
            manualNetGainTotal,
            currentRecipeGainPerItemAuto,
            currentRecipeGainPerItemManual,
            netGainPerItemManual,
            netGainPerItemAuto,
            currentRecipeGainPerMinAuto,
            currentRecipeGainPerMinManual,
            netGainPerMinAuto,
            netGainPerMinManual,
            ptPerItemManual,
            ptPerItemAuto,
            outputQuantity,
            costPerItemAuto,
            costPerHourAuto,
            costPerItemManual,
            costPerHourManual,
            cumulativeTimeAuto,
            cumulativeTimeManual
        };
    }

    function renderRecipeHeader(recipe, data) {
        const { item, category } = data;
        const restaurants = window.RestaurantModule ? window.RestaurantModule.getRestaurantsForRecipe(recipe.id) : [];

        return `
            <div class="recipe-detail-header">
                <div class="recipe-icon-large">
                    ${item.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${item.icon.split('/').pop()}.png" alt="${item.name}">` : '📦'}
                </div>
                <div class="recipe-title-section">
                    <h3>${recipe.name || item.name}</h3>
                    <div class="recipe-meta-badges">
                        <span class="recipe-category">${category}</span>
                        <span class="stat-badge exp">⚡ ${recipe.ship_exp} EXP</span>
                        <span class="stat-badge stamina">🔋 ${recipe.stamina_cost} Stamina</span>
                        <span class="stat-badge points">🎯 ${item.pt_num} pt</span>
                    </div>
                </div>
                <div class="recipe-header-actions">
                    ${restaurants.length > 0 ? `
                        <button class="action-btn" onclick="ResourceModule.viewInRestaurant(${recipe.id})">
                            <span class="material-symbols-outlined">restaurant</span>
                            레스토랑에서 보기
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    function renderRecipeFlow(recipe, data) {
        return `
            <div class="recipe-flow">
                <div class="flow-section input-section">
                    <h4 class="flow-title">📥 요구재료</h4>
                    ${renderMaterialListVertical(recipe.commission_cost)}
                </div>

                <div class="flow-arrow">
                    <div class="arrow-head">
                        <span class="material-symbols-outlined">arrow_forward</span>
                    </div>
                    <div class="flow-stats">
                        <span class="flow-stat">⏱ ${IslandEngine.formatTime(recipe.workload)}</span>
                        <span class="flow-stat">🔄 ×${recipe.production_limit}</span>
                    </div>
                </div>

                <div class="flow-section output-section">
                    <h4 class="flow-title">📤 생산품</h4>
                    ${renderMaterialListVertical(recipe.commission_product)}
                </div>
            </div>
        `;
    }

    function renderManualSection(recipe, data) {
        const { isCategory1, isCategory2, isCategory3 } = data;

        if (isCategory1 && recipe.cost?.length) {
            return `
                <div class="manual-drop-section category1-manual">
                    <h4 class="manual-drop-title">💎 수동 생산 <span class="manual-time">(${IslandEngine.formatTime(recipe.workload * CONSTANTS.MANUAL_TIME_MULTIPLIER)})</span></h4>
                    <div class="recipe-flow manual-flow">
                        <div class="flow-section input-section">
                            <h4 class="flow-title">📥 요구재료 (수동)</h4>
                            ${renderMaterialListVertical(recipe.cost)}
                        </div>

                        <div class="flow-arrow">
                            <div class="arrow-head">
                                <span class="material-symbols-outlined">arrow_forward</span>
                            </div>
                            <div class="flow-stats">
                                <span class="flow-stat">⏱ ${IslandEngine.formatTime(recipe.workload * CONSTANTS.MANUAL_TIME_MULTIPLIER)}</span>
                            </div>
                        </div>

                        <div class="flow-section output-section">
                            <h4 class="flow-title">📤 생산품</h4>
                            ${renderMaterialListVertical(recipe.drop_display || recipe.commission_product)}
                        </div>
                    </div>
                </div>
            `;
        }

        if (isCategory3 && recipe.cost?.length) {
            return `
                <div class="manual-drop-section category3-manual">
                    <h4 class="manual-drop-title">💎 수동 사육 <span class="manual-time">(${IslandEngine.formatTime(recipe.workload * CONSTANTS.MANUAL_TIME_MULTIPLIER)})</span></h4>
                    <div class="recipe-flow manual-flow">
                        <div class="flow-section input-section">
                            <h4 class="flow-title">📥 요구재료 (수동)</h4>
                            ${renderMaterialListVertical(recipe.cost)}
                        </div>

                        <div class="flow-arrow">
                            <div class="arrow-head">
                                <span class="material-symbols-outlined">arrow_forward</span>
                            </div>
                            <div class="flow-stats">
                                <span class="flow-stat">⏱ ${IslandEngine.formatTime(recipe.workload * CONSTANTS.MANUAL_TIME_MULTIPLIER)}</span>
                            </div>
                        </div>

                        <div class="flow-section output-section">
                            <h4 class="flow-title">📤 생산품</h4>
                            ${renderMaterialListVertical(recipe.drop_display || recipe.commission_product)}
                        </div>
                    </div>
                </div>
            `;
        }

        if (isCategory2 && recipe.drop_display?.length) {
            return `
                <div class="manual-drop-section category2-manual">
                    <h4 class="manual-drop-title">💎 수동 채집 <span class="manual-time">(${IslandEngine.formatTime(recipe.workload)})</span></h4>
                    ${renderMaterialListVertical(recipe.drop_display)}
                </div>
            `;
        }

        if (!isCategory1 && !isCategory2 && recipe.drop_display?.length) {
            return `
                <div class="manual-drop-section">
                    <h4 class="manual-drop-title">💎 수동 채집 <span class="manual-time">(${IslandEngine.formatTime(recipe.workload * CONSTANTS.MANUAL_TIME_MULTIPLIER)})</span></h4>
                    ${renderMaterialListVertical(recipe.drop_display)}
                </div>
            `;
        }

        return '';
    }

    function renderCostSummary(recipe, data) {
        const {
            showDualCost,
            isCategory1,
            isCategory2,
            goldConsumption,
            manualGoldConsumption,
            seasonPointsConsumption,
            manualSeasonPointsConsumption,
            currentRecipeGainPerItemAuto,
            currentRecipeGainPerItemManual,
            netGainPerItemManual,
            netGainPerItemAuto,
            currentRecipeGainPerMinAuto,
            currentRecipeGainPerMinManual,
            netGainPerMinAuto,
            netGainPerMinManual,
            ptPerItemManual,
            ptPerItemAuto,
            costPerItemAuto,
            costPerHourAuto,
            costPerItemManual,
            costPerHourManual,
            outputQuantity
        } = data;

        const hasAnyCosts = goldConsumption.gold > 0 ||
            manualGoldConsumption.gold > 0 ||
            Object.keys(goldConsumption.resources).length > 0;
        
        const hasSeasonPoints = seasonPointsConsumption > 0 || 
            manualSeasonPointsConsumption > 0 ||
            netGainPerItemAuto !== 0 ||
            netGainPerItemManual !== 0;

        if (!hasAnyCosts && !hasSeasonPoints) return '';

        // Dual cost mode (category 1 only)
        if (showDualCost) {
            return `
                <div class="cost-summary">
                    <h4 class="cost-summary-title">
                        <span class="material-symbols-outlined">shopping_cart</span>
                        총 구매 비용
                    </h4>
                    <div class="cost-comparison-grid">
                        ${manualGoldConsumption.gold > 0 ? `
                            <div class="cost-column manual-cost">
                                <h5 class="cost-column-title">💎 수동 생산</h5>
                                <div class="cost-items">
                                    <div class="cost-item gold">
                                        <span class="cost-icon">💰</span>
                                        <span class="cost-name">총 생산단가</span>
                                        <span class="cost-amount">×${manualGoldConsumption.gold.toLocaleString()}</span>
                                    </div>
                                    <div class="cost-item normalized">
                                        <span class="cost-icon">📊</span>
                                        <span class="cost-name">개당 생산단가</span>
                                        <span class="cost-amount">${costPerItemManual.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} G/ea</span>
                                    </div>
                                    <div class="cost-item normalized">
                                        <span class="cost-icon">⏱️</span>
                                        <span class="cost-name">시간당 생산단가</span>
                                        <span class="cost-amount">${costPerHourManual.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} G/hr</span>
                                    </div>
                                    ${manualSeasonPointsConsumption > 0 ? `
                                        <div class="cost-item points">
                                            <span class="cost-icon">🎯</span>
                                            <span class="cost-name">재료들의 pt값</span>
                                            <span class="cost-amount">${ptPerItemManual.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt</span>
                                        </div>
                                        <div class="cost-item">
                                            <span class="cost-icon">📈</span>
                                            <span class="cost-name">현재 레시피의 pt이득</span>
                                            <span class="cost-amount">${currentRecipeGainPerItemManual.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt</span>
                                        </div>
                                        <div class="cost-item">
                                            <span class="cost-icon">⚡</span>
                                            <span class="cost-name">현재 레시피 pt이득/분</span>
                                            <span class="cost-amount">${currentRecipeGainPerMinManual.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt/min</span>
                                        </div>
                                    ` : ''}
                                    ${netGainPerItemManual !== 0 ? `
                                        <div class="cost-item net-gain">
                                            <span class="cost-icon">💰</span>
                                            <span class="cost-name">총 순수익pt</span>
                                            <span class="cost-amount ${netGainPerItemManual >= 0 ? 'positive' : 'negative'}">${netGainPerItemManual >= 0 ? '+' : ''}${netGainPerItemManual.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt</span>
                                        </div>
                                        <div class="cost-item net-gain">
                                            <span class="cost-icon">⏱️</span>
                                            <span class="cost-name">총 순수익pt/분</span>
                                            <span class="cost-amount ${netGainPerMinManual >= 0 ? 'positive' : 'negative'}">${netGainPerMinManual >= 0 ? '+' : ''}${netGainPerMinManual.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt/min</span>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        ` : ''}
                        ${goldConsumption.gold > 0 || seasonPointsConsumption > 0 || netGainPerItemAuto !== 0 ? `
                            <div class="cost-column auto-cost">
                                <h5 class="cost-column-title">🤖 자동 위임</h5>
                                <div class="cost-items">
                                    <div class="cost-item gold">
                                        <span class="cost-icon">💰</span>
                                        <span class="cost-name">총 생산단가</span>
                                        <span class="cost-amount">×${goldConsumption.gold.toLocaleString()}</span>
                                    </div>
                                    <div class="cost-item normalized">
                                        <span class="cost-icon">📊</span>
                                        <span class="cost-name">개당 생산단가</span>
                                        <span class="cost-amount">${costPerItemAuto.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} G/ea</span>
                                    </div>
                                    <div class="cost-item normalized">
                                        <span class="cost-icon">⏱️</span>
                                        <span class="cost-name">시간당 생산단가</span>
                                        <span class="cost-amount">${costPerHourAuto.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} G/hr</span>
                                    </div>
                                    ${seasonPointsConsumption > 0 ? `
                                        <div class="cost-item points">
                                            <span class="cost-icon">🎯</span>
                                            <span class="cost-name">재료들의 pt값</span>
                                            <span class="cost-amount">${ptPerItemAuto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt</span>
                                        </div>
                                        <div class="cost-item">
                                            <span class="cost-icon">📈</span>
                                            <span class="cost-name">현재 레시피의 pt이득</span>
                                            <span class="cost-amount">${currentRecipeGainPerItemAuto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt</span>
                                        </div>
                                        <div class="cost-item">
                                            <span class="cost-icon">⚡</span>
                                            <span class="cost-name">현재 레시피 pt이득/분</span>
                                            <span class="cost-amount">${currentRecipeGainPerMinAuto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt/min</span>
                                        </div>
                                    ` : ''}
                                    ${netGainPerItemAuto !== 0 ? `
                                        <div class="cost-item net-gain">
                                            <span class="cost-icon">💰</span>
                                            <span class="cost-name">총 순수익pt</span>
                                            <span class="cost-amount ${netGainPerItemAuto >= 0 ? 'positive' : 'negative'}">${netGainPerItemAuto >= 0 ? '+' : ''}${netGainPerItemAuto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt</span>
                                        </div>
                                        <div class="cost-item net-gain">
                                            <span class="cost-icon">⏱️</span>
                                            <span class="cost-name">총 순수익pt/분</span>
                                            <span class="cost-amount ${netGainPerMinAuto >= 0 ? 'positive' : 'negative'}">${netGainPerMinAuto >= 0 ? '+' : ''}${netGainPerMinAuto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt/min</span>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    ${Object.keys(goldConsumption.resources).length > 0 ? `
                        <div class="resource-costs">
                            <h5 class="resource-costs-title">기타 재료 비용</h5>
                            <div class="cost-items">
                                ${Object.entries(goldConsumption.resources).map(([itemId, data]) => `
                                    <div class="cost-item">
                                        <div class="cost-icon">
                                            ${data.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${data.icon.split('/').pop()}.png" alt="${data.name}">` : '📦'}
                                        </div>
                                        <span class="cost-name">${data.name}</span>
                                        <span class="cost-amount">×${data.amount.toLocaleString()}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        // Simple cost mode (categories 2, 3, 4, 6)
        return `
            <div class="cost-summary">
                <h4 class="cost-summary-title">
                    <span class="material-symbols-outlined">shopping_cart</span>
                    총 구매 비용
                    ${!isCategory2 ? '<span style="font-size: 0.85em; font-weight: normal; opacity: 0.7; margin-left: 0.5rem;">(자동 생산 기준)</span>' : ''}
                </h4>
                <div class="cost-items">
                    ${goldConsumption.gold > 0 ? `
                        <div class="cost-item gold">
                            <span class="cost-icon">💰</span>
                            <span class="cost-name">총 생산단가</span>
                            <span class="cost-amount">×${goldConsumption.gold.toLocaleString()}</span>
                        </div>
                        <div class="cost-item normalized">
                            <span class="cost-icon">📊</span>
                            <span class="cost-name">개당 생산단가 (×${outputQuantity}개 생산)</span>
                            <span class="cost-amount">${costPerItemAuto.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} G/ea</span>
                        </div>
                        <div class="cost-item normalized">
                            <span class="cost-icon">⏱️</span>
                            <span class="cost-name">시간당 생산단가</span>
                            <span class="cost-amount">${costPerHourAuto.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} G/hr</span>
                        </div>
                    ` : ''}
                    ${seasonPointsConsumption > 0 ? `
                        <div class="cost-item points">
                            <span class="cost-icon">🎯</span>
                            <span class="cost-name">재료들의 pt 값 (×1개 생산 기준)</span>
                            <span class="cost-amount">${ptPerItemAuto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt</span>
                        </div>
                        <div class="cost-item">
                            <span class="cost-icon">📈</span>
                            <span class="cost-name">현재 레시피의 pt 이득 (×1개 생산 기준)</span>
                            <span class="cost-amount">${currentRecipeGainPerItemAuto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt</span>
                        </div>
                        <div class="cost-item">
                            <span class="cost-icon">⚡</span>
                            <span class="cost-name">현재 레시피 pt 이득/분</span>
                            <span class="cost-amount">${currentRecipeGainPerMinAuto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt/min</span>
                        </div>
                    ` : ''}
                    ${netGainPerItemAuto !== 0 ? `
                        <div class="cost-item net-gain">
                            <span class="cost-icon">💰</span>
                            <span class="cost-name">총 순수익pt (×1개 생산 기준)</span>
                            <span class="cost-amount ${netGainPerItemAuto >= 0 ? 'positive' : 'negative'}">${netGainPerItemAuto >= 0 ? '+' : ''}${netGainPerItemAuto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt</span>
                        </div>
                        <div class="cost-item net-gain">
                            <span class="cost-icon">⏱️</span>
                            <span class="cost-name">총 순수익pt/분</span>
                            <span class="cost-amount ${netGainPerMinAuto >= 0 ? 'positive' : 'negative'}">${netGainPerMinAuto >= 0 ? '+' : ''}${netGainPerMinAuto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt/min</span>
                        </div>
                    ` : ''}
                    ${Object.entries(goldConsumption.resources).map(([itemId, data]) => `
                        <div class="cost-item">
                            <div class="cost-icon">
                                ${data.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${data.icon.split('/').pop()}.png" alt="${data.name}">` : '📦'}
                            </div>
                            <span class="cost-name">${data.name}</span>
                            <span class="cost-amount">×${data.amount.toLocaleString()}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    function renderRecipeActions(recipe, data) {
        const { producedByRecipes, usedInRecipes } = data;
        return `
            <div class="recipe-actions">
                <button class="action-btn" onclick="ResourceModule.showUpstream(${recipe.id})">
                    <span class="material-symbols-outlined">arrow_upward</span>
                    하위 조합 전체 보기 (${producedByRecipes.length})
                </button>
                <button class="action-btn" onclick="ResourceModule.showDownstream(${recipe.id})">
                    <span class="material-symbols-outlined">arrow_downward</span>
                    상위 조합 전체 보기 (${usedInRecipes.length})
                </button>
            </div>
        `;
    }

    function renderRecipeDetail(recipe) {
        const container = document.getElementById('recipe-detail');
        if (!container) return;

        // Handle seasonal view recipes
        if (recipe._isSeasonalView) {
            // If this is a real recipe (not just a shop/pickup item), show full detail with tree
            if (!recipe.id.toString().startsWith('seasonal_')) {
                // This is a real recipe, render it normally with full dependency tree
                const data = gatherRecipeData(recipe);
                const html = `
                    ${renderRecipeHeader(recipe, data)}
                    ${renderRecipeFlow(recipe, data)}
                    ${renderManualSection(recipe, data)}
                    ${renderCostSummary(recipe, data)}
                    ${renderRecipeActions(recipe, data)}
                `;
                container.innerHTML = html;
                renderDependencyTree(recipe);
            } else {
                // This is a synthetic shop/pickup item
                renderSeasonalItemDetail(recipe, container);
                renderSeasonalDependencyTree(recipe);
            }
            return;
        }

        const data = gatherRecipeData(recipe);

        const html = `
            ${renderRecipeHeader(recipe, data)}
            ${renderRecipeFlow(recipe, data)}
            ${renderManualSection(recipe, data)}
            ${renderCostSummary(recipe, data)}
            ${renderRecipeActions(recipe, data)}
        `;

        container.innerHTML = html;

        // Automatically render dependency tree
        renderDependencyTree(recipe);
    }

    function renderSeasonalItemDetail(recipe, container) {
        const itemId = recipe._seasonalItemId || recipe.item_id;
        const item = IslandEngine.getItemInfo(itemId);
        const isPickup = recipe._isPickup;
        const isShop = recipe._isShop;
        const allRecipeIds = recipe._allRecipes || [];
        const hasRecipes = allRecipeIds.length > 0;

        let sourceInfo = '';
        if (isPickup) {
            sourceInfo = `
                <div class="seasonal-source pickup">
                    <span class="material-symbols-outlined">hiking</span>
                    <span>채집템 (맵에서 채집)</span>
                </div>
            `;
        } else if (isShop) {
            const shopData = state.shopPurchaseData[itemId];
            if (shopData) {
                const [requiredItemId, cost, packSize] = shopData;
                const costItem = IslandEngine.getItemInfo(requiredItemId);
                sourceInfo = `
                    <div class="seasonal-source shop">
                        <span class="material-symbols-outlined">store</span>
                        <span>상점 구매: ${cost} ${costItem.name} (${packSize}개 팩)</span>
                    </div>
                `;
            }
        }

        if (hasRecipes) {
            sourceInfo += `
                <div class="seasonal-source recipe">
                    <span class="material-symbols-outlined">restaurant</span>
                    <span>제작 가능 (${allRecipeIds.length}개 레시피)</span>
                </div>
            `;
        }

        const html = `
            <div class="recipe-detail-header">
                <div class="recipe-icon-large">
                    ${item.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${item.icon.split('/').pop()}.png" alt="${item.name}">` : '📦'}
                </div>
                <div class="recipe-title-section">
                    <h3>${item.name}</h3>
                    <div class="recipe-meta-badges">
                        <span class="recipe-category">시즌템 (Seasonal)</span>
                        <span class="stat-badge rarity-${item.rarity || 1}">★ ${item.rarity || 1}</span>
                    </div>
                    <p class="item-description">${item.desc || '시즌 한정 아이템입니다.'}</p>
                </div>
            </div>

            <div class="seasonal-sources">
                <h4 class="flow-title">📍 획득 방법</h4>
                ${sourceInfo}
            </div>

            ${hasRecipes ? `
                <div class="seasonal-recipes">
                    <h4 class="flow-title">🔨 제작 레시피</h4>
                    <div class="seasonal-recipe-list">
                        ${allRecipeIds.map(recipeId => {
            const originalRecipe = findRecipeById(recipeId);
            if (!originalRecipe) return '';
            const recipeItem = IslandEngine.getItemInfo(originalRecipe.item_id);
            const categoryId = findRecipeCategoryById(recipeId);
            return `
                                <div class="seasonal-recipe-card" data-recipe-id="${recipeId}">
                                    <div class="recipe-icon">
                                        ${recipeItem.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${recipeItem.icon.split('/').pop()}.png" alt="${recipeItem.name}">` : '📦'}
                                    </div>
                                    <div class="recipe-info">
                                        <div class="recipe-name">${originalRecipe.name || recipeItem.name}</div>
                                        <div class="recipe-meta">
                                            <span>${categoryNames[categoryId] || '알 수 없음'}</span>
                                            <span>⏱ ${IslandEngine.formatTime(originalRecipe.workload)}</span>
                                        </div>
                                    </div>
                                    <span class="material-symbols-outlined">arrow_forward</span>
                                </div>
                            `;
        }).join('')}
                    </div>
                </div>
            ` : ''}
        `;

        container.innerHTML = html;
    }

    function renderSeasonalDependencyTree(recipe) {
        const container = document.getElementById('dependency-chain');
        if (!container) return;

        const itemId = recipe._seasonalItemId || recipe.item_id;
        const item = IslandEngine.getItemInfo(itemId);

        // Check what recipes produce this item
        const producedByRecipes = state.dependencyGraph.producedBy[itemId] || [];

        // Check what recipes use this item
        const usedInRecipes = state.dependencyGraph.usedBy[itemId] || [];

        const html = `
            <div class="tree-header">
                <h3>
                    <span class="material-symbols-outlined">account_tree</span>
                    아이템 관계도
                </h3>
            </div>

            ${producedByRecipes.length > 0 ? `
                <div class="tree-section upstream-section">
                    <h4 class="tree-section-title upstream">
                        <span class="material-symbols-outlined">arrow_upward</span>
                        이 아이템을 생산하는 레시피 (${producedByRecipes.length})
                    </h4>
                    <div class="seasonal-usage-list">
                        ${producedByRecipes.map(recipeId => {
            const producerRecipe = findRecipeById(recipeId);
            if (!producerRecipe) return '';
            const producerItem = IslandEngine.getItemInfo(producerRecipe.item_id);
            const categoryId = findRecipeCategoryById(recipeId);
            return `
                                <div class="tree-node-card upstream" data-recipe-id="${recipeId}">
                                    <div class="tree-node-icon">
                                        ${producerItem.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${producerItem.icon.split('/').pop()}.png" alt="${producerItem.name}">` : '📦'}
                                    </div>
                                    <div class="tree-node-info">
                                        <div class="tree-node-name">${producerRecipe.name || producerItem.name}</div>
                                        <div class="tree-node-meta">
                                            <span>${categoryNames[categoryId] || '알 수 없음'}</span>
                                            <span>⏱ ${IslandEngine.formatTime(producerRecipe.workload)}</span>
                                            <span>⚡ ${producerRecipe.ship_exp}</span>
                                        </div>
                                    </div>
                                    <span class="tree-node-arrow material-symbols-outlined">arrow_forward</span>
                                </div>
                            `;
        }).join('')}
                    </div>
                </div>
            ` : ''}

            ${usedInRecipes.length > 0 ? `
                <div class="tree-section downstream-section">
                    <h4 class="tree-section-title downstream">
                        <span class="material-symbols-outlined">arrow_downward</span>
                        이 아이템을 사용하는 레시피 (${usedInRecipes.length})
                    </h4>
                    <div class="seasonal-usage-list">
                        ${usedInRecipes.map(recipeId => {
            const usageRecipe = findRecipeById(recipeId);
            if (!usageRecipe) return '';
            const usageItem = IslandEngine.getItemInfo(usageRecipe.item_id);
            const categoryId = findRecipeCategoryById(recipeId);
            return `
                                <div class="tree-node-card downstream" data-recipe-id="${recipeId}">
                                    <div class="tree-node-icon">
                                        ${usageItem.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${usageItem.icon.split('/').pop()}.png" alt="${usageItem.name}">` : '📦'}
                                    </div>
                                    <div class="tree-node-info">
                                        <div class="tree-node-name">${usageRecipe.name || usageItem.name}</div>
                                        <div class="tree-node-meta">
                                            <span>${categoryNames[categoryId] || '알 수 없음'}</span>
                                            <span>⏱ ${IslandEngine.formatTime(usageRecipe.workload)}</span>
                                            <span>⚡ ${usageRecipe.ship_exp}</span>
                                        </div>
                                    </div>
                                    <span class="tree-node-arrow material-symbols-outlined">arrow_forward</span>
                                </div>
                            `;
        }).join('')}
                    </div>
                </div>
            ` : ''}

            ${producedByRecipes.length === 0 && usedInRecipes.length === 0 ? `
                <div class="empty-state">
                    <span class="material-symbols-outlined">inventory</span>
                    <p>이 아이템과 연결된 레시피가 없습니다.</p>
                </div>
            ` : ''}
        `;

        container.innerHTML = html;
    }

    function renderMaterialList(materials) {
        if (!materials || materials.length === 0) {
            return '<p class="no-materials">없음</p>';
        }

        return `
            <div class="material-list">
                ${materials.map(([itemId, quantity]) => {
            const item = IslandEngine.getItemInfo(itemId);
            return `
                        <div class="material-item rarity-${item.rarity || 1}">
                            <div class="material-icon">
                                ${item.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${item.icon.split('/').pop()}.png" alt="${item.name}">` : '📦'}
                            </div>
                            <div class="material-info">
                                <span class="material-name">${item.name}</span>
                                <span class="material-quantity">×${quantity}</span>
                            </div>
                        </div>
                    `;
        }).join('')}
            </div>
        `;
    }

    function renderMaterialListVertical(materials) {
        if (!materials || materials.length === 0) {
            return '<p class="no-materials">없음</p>';
        }

        return `
            <div class="material-list-vertical">
                ${materials.map(([itemId, quantity]) => {
            const item = IslandEngine.getItemInfo(itemId);
            return `
                        <div class="material-item-vertical rarity-${item.rarity || 1}">
                            <div class="material-top-row">
                                <div class="material-icon">
                                    ${item.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${item.icon.split('/').pop()}.png" alt="${item.name}">` : '📦'}
                                </div>
                                <span class="material-quantity">×${quantity}</span>
                            </div>
                            <div class="material-name">${item.name}</div>
                        </div>
                    `;
        }).join('')}
            </div>
        `;
    }

    /**
     * Render full dependency tree for selected recipe
     * Uses manual mode tree to show category 1 manual requirements
     */
    function renderDependencyTree(recipe) {
        const container = document.getElementById('dependency-chain');
        if (!container) return;

        if (!recipe) {
            renderEmptyChain();
            return;
        }

        // Build trees using shared utility - use manual tree for upstream (shows manual mode for category 1)
        const upstreamTree = IslandEngine.buildRecipeDependencyTree(
            recipe.id,
            state.recipeIndex,
            state.recipeCategoryIndex,
            state.dependencyGraph,
            state.shopPurchaseData,
            { useManualMode: true }
        );
        const downstreamTree = buildDownstreamTree(recipe.id);

        // Calculate stats
        const upstreamStats = calculateTreeStats(upstreamTree, 'dependencies');
        const downstreamStats = calculateTreeStats(downstreamTree, 'usages');

        const item = IslandEngine.getItemInfo(recipe.item_id);

        const html = `
            <div class="tree-header">
                <h3>
                    <span class="material-symbols-outlined">account_tree</span>
                    관련된 제조법들 (수동 생산)
                </h3>
                <div class="tree-stats">
                    <span class="stat-badge-sm upstream">
                        <span class="material-symbols-outlined">arrow_upward</span>
                        ${upstreamStats.count - 1}
                    </span>
                    <span class="stat-badge-sm downstream">
                        <span class="material-symbols-outlined">arrow_downward</span>
                        ${downstreamStats.count - 1}
                    </span>
                </div>
            </div>

            <!-- Upstream (Dependencies) -->
            ${upstreamTree.dependencies.length > 0 ? `
                <div class="tree-section upstream-section">
                    <h4 class="tree-section-title upstream">
                        <span class="material-symbols-outlined">arrow_upward</span>
                        하위 조합 (수동) (${upstreamStats.count - 1})
                    </h4>
                    <div class="tree-nodes-wrapper upstream">
                        ${renderTreeNodesWithConnectors(upstreamTree.dependencies, 0, 'upstream')}
                    </div>
                </div>
            ` : ''}

            <!-- Current Recipe Separator -->
            <div class="current-recipe-separator">
                <span class="material-symbols-outlined">radio_button_checked</span>
                <span class="current-recipe-text">${recipe.name || item.name} 들어가는 곳</span>
            </div>

            <!-- Downstream (Used In) -->
            ${downstreamTree.usages.length > 0 ? `
                <div class="tree-section downstream-section">
                    <h4 class="tree-section-title downstream">
                        <span class="material-symbols-outlined">arrow_downward</span>
                        상위 조합 (${downstreamStats.count - 1})
                    </h4>
                    <div class="tree-nodes-wrapper downstream">
                        ${renderTreeNodesWithConnectors(downstreamTree.usages, 0, 'downstream')}
                    </div>
                </div>
            ` : ''}
        `;

        container.innerHTML = html;
    }

    /**
     * Render tree nodes with L-shaped connectors
     */
    function renderTreeNodesWithConnectors(nodes, depth, direction) {
        if (!nodes || nodes.length === 0) return '';

        return nodes.map((node, index) => {
            const isLast = index === nodes.length - 1;

            // Handle shop purchase nodes
            if (node.isShopPurchase) {
                const item = node.itemInfo;
                const shopCost = node.shopCost;
                const costItem = shopCost.itemInfo;
                const isGoldPurchase = shopCost.itemId === CONSTANTS.GOLD_ITEM_ID;
                const hasPacks = shopCost.packSize > 1;

                return `
                    <div class="tree-node depth-${depth} ${isLast ? 'last-child' : ''} shop-purchase" data-direction="${direction}">
                        <div class="tree-node-card shop ${direction}">
                            <div class="tree-node-icon">
                                ${item.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${item.icon.split('/').pop()}.png" alt="${item.name}">` : '📦'}
                            </div>
                            <div class="tree-node-info">
                                <div class="tree-node-name">
                                    <span class="shop-badge">🛒 Shop</span>
                                    ${item.name} (×${node.quantity})
                                </div>
                                <div class="tree-node-meta shop-cost">
                                    <span class="shop-cost-label">${isGoldPurchase ? '💰' : '📦'}</span>
                                    <span class="shop-cost-value">
                                        ${hasPacks
                        ? `${shopCost.costPerItem.toFixed(1)} ${costItem.name}/ea × ${node.quantity} = ${shopCost.totalCost.toFixed(1)} (${shopCost.packsNeeded} pack${shopCost.packsNeeded > 1 ? 's' : ''})`
                        : `${shopCost.unitCost} ${costItem.name}/ea × ${node.quantity} = ${shopCost.totalCost.toFixed(1)}`
                    }
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }

            // Handle recipe nodes
            const item = IslandEngine.getItemInfo(node.recipe.item_id);
            const hasChildren = (node.dependencies?.length || node.usages?.length || 0) > 0;
            const children = node.dependencies || node.usages || [];
            const isManualMode = node.isManualMode || false;
            const workloadTime = isManualMode ? node.recipe.workload * CONSTANTS.MANUAL_TIME_MULTIPLIER : node.recipe.workload;

            return `
                <div class="tree-node depth-${depth} ${isLast ? 'last-child' : ''}" data-direction="${direction}">
                    <div class="tree-node-card ${direction} ${isManualMode ? 'manual-mode' : ''}" data-recipe-id="${node.recipe.id}" onclick="ResourceModule.selectRecipeFromTree(${node.recipe.id})">
                        <div class="tree-node-icon">
                            ${item.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${item.icon.split('/').pop()}.png" alt="${item.name}">` : '📦'}
                        </div>
                        <div class="tree-node-info">
                            <div class="tree-node-name">
                                ${isManualMode ? '<span class="manual-badge">💎</span>' : ''}
                                ${node.recipe.name || item.name}
                            </div>
                            ${node.itemInfo ? `<div class="tree-node-via">→ ${node.itemInfo.name}</div>` : ''}
                            <div class="tree-node-meta">
                                <span>⏱ ${IslandEngine.formatTime(workloadTime)}</span>
                                <span>⚡ ${node.recipe.ship_exp}</span>
                            </div>
                        </div>
                        <span class="tree-node-arrow material-symbols-outlined">arrow_forward</span>
                    </div>
                    ${hasChildren ? `<div class="tree-node-children">${renderTreeNodesWithConnectors(children, depth + 1, direction)}</div>` : ''}
                </div>
            `;
        }).join('');
    }

    function renderEmptyDetail() {
        const container = document.getElementById('recipe-detail');
        if (!container) return;

        container.innerHTML = `
            <div class="empty-state">
                <span class="material-symbols-outlined">restaurant</span>
                <h3>레시피를 선택하세요</h3>
                <p>레시피를 선택하여 재료, 생산 시간 및 연관 레시피를 확인하세요.</p>
            </div>
        `;
    }

    function renderEmptyChain() {
        const container = document.getElementById('dependency-chain');
        if (!container) return;

        container.innerHTML = `
            <div class="empty-state">
                <span class="material-symbols-outlined">account_tree</span>
                <h3>레시피를 선택하세요</h3>
                <p>레시피를 선택하면 자동으로 전체 의존성 트리가 표시됩니다.</p>
            </div>
        `;
    }

    // ============================================
    // EVENT HANDLERS
    // ============================================

    function setupEventListeners() {
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

        // Seasonal recipe card clicks (delegated from detail panel)
        document.addEventListener('click', (e) => {
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

    // ============================================
    // PUBLIC METHODS - TREE NAVIGATION
    // ============================================

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
                        itemInfo: IslandEngine.getItemInfo(itemId)
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
                                    ${itemInfo.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${itemInfo.icon.split('/').pop()}.png" alt="${itemInfo.name}">` : '📦'}
                                </div>
                                <div class="modal-item-info">
                                    <h4>${itemInfo.name}</h4>
                                    <p>${direction === 'upstream' ? '이 아이템을 생산하는 레시피' : '이 아이템을 사용하는 레시피'} (${groupRecipes.length})</p>
                                </div>
                            </div>
                            <div class="modal-recipe-list">
                                ${groupRecipes.map(recipe => {
                const recipeItem = IslandEngine.getItemInfo(recipe.item_id);
                return `
                                        <div class="modal-recipe-card" data-recipe-id="${recipe.id}">
                                            <div class="modal-recipe-icon">
                                                ${recipeItem.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${recipeItem.icon.split('/').pop()}.png" alt="${recipeItem.name}">` : '📦'}
                                            </div>
                                            <div class="modal-recipe-info">
                                                <div class="modal-recipe-name">${recipe.name || recipeItem.name}</div>
                                                <div class="modal-recipe-meta">
                                                    <span>⏱ ${IslandEngine.formatTime(recipe.workload)}</span>
                                                    <span>⚡ ${recipe.ship_exp}</span>
                                                    <span class="modal-recipe-category">${categoryNames[findRecipeCategoryById(recipe.id)] || '알 수 없음'}</span>
                                                </div>
                                            </div>
                                            <button class="modal-select-btn" onclick="ResourceModule.selectRecipeFromModal(${recipe.id})">
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
                    <span>현재 선택된 레시피: <strong>${sourceRecipe.name || IslandEngine.getItemInfo(sourceRecipe.item_id).name}</strong></span>
                </div>
            `;
        }

        // Show modal
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Render forest nodes (recursive) for the full forest view
     */
    function renderForestDependencies(nodes, depth = 0) {
        if (!nodes || nodes.length === 0) {
            return `
                <div class="forest-tree__group">
                    <div class="forest-tree__node">
                        <div class="forest-tree__content">
                            <span class="forest-tree__text">기본 재료</span>
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="forest-tree__group">
                ${nodes.map((node) => {
            const hasChildren = node.dependencies && node.dependencies.length > 0;

            // Shop purchases become leaves with cost info
            if (node.isShopPurchase) {
                const item = node.itemInfo || IslandEngine.getItemInfo(node.itemId);
                const costItem = node.shopCost?.itemInfo || IslandEngine.getItemInfo(node.shopCost?.itemId);
                return `
                        <div class="forest-tree__node">
                            <div class="forest-tree__content">
                                ${item.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${item.icon.split('/').pop()}.png" alt="${item.name}" class="forest-tree__icon"/>` : '<span class="forest-tree__icon">•</span>'}
                                <span class="forest-tree__text">${item.name} (×${node.quantity})</span>
                                <span class="forest-tree__cost">— ${costItem?.name || '자원'} ×${node.shopCost?.totalCost?.toFixed?.(1) || '?'}</span>
                            </div>
                        </div>
                    `;
            }

            // Recipe node
            const item = IslandEngine.getItemInfo(node.recipe.item_id);
            const chip = `
                        <div class="forest-tree__content" onclick="event.stopPropagation(); ResourceModule.selectRecipeFromTree(${node.recipe.id});">
                            ${item.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${item.icon.split('/').pop()}.png" alt="${item.name}" class="forest-tree__icon"/>` : '<span class="forest-tree__icon">•</span>'}
                            <span class="forest-tree__text">${node.recipe.name || item.name}</span>
                            <span class="forest-tree__meta">⏱${IslandEngine.formatTime(node.recipe.workload)}</span>
                        </div>
                    `;

            return `
                        <div class="forest-tree__node">
                            ${chip}
                            ${hasChildren ? renderForestDependencies(node.dependencies, depth + 1) : ''}
                        </div>
                    `;
        }).join('')}
            </div>
        `;
    }

    /**
     * Render a single tree in the forest (rooted at a recipe)
     */
    function renderForestTree(recipe, categoryId) {
        const tree = IslandEngine.buildRecipeDependencyTree(
            recipe.id,
            state.recipeIndex,
            state.recipeCategoryIndex,
            state.dependencyGraph,
            state.shopPurchaseData,
            { useManualMode: false }
        );

        const stats = calculateTreeStats(tree, 'dependencies');
        const item = IslandEngine.getItemInfo(recipe.item_id);

        return `
            <div class="forest-tree-wrapper">
                <details class="forest-tree" open>
                    <summary class="forest-root">
                        <div class="forest-root-chip" onclick="event.stopPropagation(); ResourceModule.selectRecipeFromModal(${recipe.id});">
                            ${item.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${item.icon.split('/').pop()}.png" alt="${item.name}" />` : '•'}
                            <span class="forest-chip-name">${recipe.name || item.name}</span>
                            <span class="forest-root-meta">
                                ${categoryNames[categoryId] || '카테고리'} · ⏱${IslandEngine.formatTime(recipe.workload)} · ⚡${recipe.ship_exp} ·  Dependencies: ${Math.max(stats.count - 1, 0)}
                            </span>
                        </div>
                    </summary>
                    <div class="forest-tree-body">
                        ${tree && tree.dependencies?.length ? renderForestDependencies(tree.dependencies) : '<ul class="forest-tree-group"><li class="forest-node is-leaf is-last"><span class="forest-node-content">입력 없음</span></li></ul>'}
                    </div>
                </details>
            </div>
        `;
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

        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        const modal = document.getElementById('dependency-modal');
        if (modal) {
            modal.classList.add('hidden');
            document.body.style.overflow = '';
        }
    }

    function selectRecipeFromModal(recipeId) {
        closeModal();
        selectRecipe(recipeId);
    }

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================

    function findRecipeById(id) {
        return state.recipeIndex[id] || null;
    }

    function findRecipeCategoryById(id) {
        return state.recipeCategoryIndex[id] || null;
    }

    // ============================================
    // PUBLIC API
    // ============================================

    return {
        init,
        selectRecipe,
        selectRecipeFromTree,
        viewInRestaurant,
        showUpstream,
        showDownstream,
        closeModal,
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

})();
