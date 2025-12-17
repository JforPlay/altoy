/**
 * Island Core Engine
 * Handles shared functionality and module coordination
 */

window.IslandEngine = (function () {
    'use strict';

    // ============================================
    // STATE
    // ============================================
    const state = {
        activeTab: 'characters',
        modules: {
            character: null,
            technology: null,
            quest: null,
            resource: null,
            restaurant: null,
            seasonCalc: null
        },
        sharedData: {
            items: null,  // Shared across all modules
            loaded: false
        }
    };

    const TAB_MODULE_MAP = {
        'characters': { key: 'character', module: () => window.CharacterModule },
        'technology': { key: 'technology', module: () => window.TechnologyModule },
        'quests': { key: 'quest', module: () => window.QuestModule },
        'resources': { key: 'resource', module: () => window.ResourceModule },
        'restaurant': { key: 'restaurant', module: () => window.RestaurantModule },
        'season-calc': { key: 'seasonCalc', module: () => window.SeasonCalcModule }
    };

    // ============================================
    // INITIALIZATION
    // ============================================

    async function init() {
        console.log('[Island] Initializing core engine...');

        try {
            // Load shared data first
            await loadSharedData();
            console.log('[Island] Core engine initialized (Lazy loading modules)');
        } catch (error) {
            console.error('[Island] Critical initialization failure:', error);
            showToast('페이지를 불러오는데 실패했습니다. 페이지를 새로고침해주세요.', 'error');
        }
    }

    async function loadSharedData() {
        if (state.sharedData.loaded) return;

        console.log('[Island] Loading shared data...');

        try {
            // Load island_item_data_template.json once for all modules
            state.sharedData.items = await fetchJSON('data/island/island_item_data_template.json');
            state.sharedData.loaded = true;

            console.log(`[Island] Loaded shared item data: ${Object.keys(state.sharedData.items).length} items`);
        } catch (error) {
            console.error('[Island] Failed to load shared data:', error);
            throw error;
        }
    }

    async function loadModule(tabName) {
        const config = TAB_MODULE_MAP[tabName];
        if (!config) return;

        const { key, module: getModule } = config;
        
        // Return if already initialized
        if (state.modules[key]) return;

        const module = getModule();
        if (!module) {
            console.warn(`[Island] Module for ${tabName} not found`);
            return;
        }

        try {
            // Ensure shared data is loaded
            await loadSharedData();
            await initModule(key, module);
        } catch (error) {
            console.error(`[Island] Failed to lazy load ${tabName}:`, error);
            showToast(`${tabName} 모듈을 불러오는데 실패했습니다.`, 'error');
        }
    }

    async function initModule(name, module) {
        if (!module) {
            console.warn(`[Island] ${name} module not found`);
            return;
        }

        console.log(`[Island] Initializing ${name} module...`);
        state.modules[name] = module;

        // Pass shared data to module
        await module.init(state.sharedData);

        console.log(`[Island] ${name} module initialized successfully`);
    }

    // ============================================
    // TAB MANAGEMENT
    // ============================================

    /**
     * Switch active tab
     */
    function switchTab(tabName) {
        state.activeTab = tabName;
        console.log(`[Island] Switched to tab: ${tabName}`);
        
        // Lazy load the module for this tab
        loadModule(tabName);
    }

    /**
     * Programmatically activate a tab (mirrors button click behavior)
     */
    function activateTab(tabName) {
        // Persist selection for consistency with manual clicks
        try {
            localStorage.setItem('island-active-tab', tabName);
        } catch (e) {
            console.warn('[Island] Could not persist tab state:', e);
        }

        const tabButton = document.querySelector(`.tab-button[data-tab="${tabName}"]`);
        if (tabButton) {
            tabButton.click();
        } else {
            // Fallback: toggle classes directly if button not found
            document.querySelectorAll('.tab-content').forEach(content => {
                const contentId = content.id.replace('tab-', '');
                content.classList.toggle('active', contentId === tabName);
            });
            document.querySelectorAll('.tab-button').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tab === tabName);
            });
        }

        switchTab(tabName);
    }

    /**
     * Get active tab
     */
    function getActiveTab() {
        return state.activeTab;
    }

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================

    function getSharedData() {
        return state.sharedData;
    }



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

    function createSearchIndex(data, config) {
        if (!window.Fuse) {
            console.error('[Island] Fuse.js not loaded');
            return null;
        }

        return new Fuse(data, {
            keys: config.keys || ['searchText'],
            threshold: config.threshold || 0.3,
            includeScore: config.includeScore !== undefined ? config.includeScore : true,
            ...config
        });
    }

    // ============================================
    // RECIPE TREE UTILITIES (Shared)
    // ============================================

    const GOLD_ITEM_ID = 1;
    const MAX_TREE_DEPTH = 5;

    /**
     * Build dependency tree for a recipe (upstream dependencies)
     * Used by both resource and restaurant modules
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

    // ============================================
    // SHARED DATA STRUCTURE BUILDERS
    // ============================================

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

    // ============================================
    // PUBLIC API
    // ============================================

    return {
        init,
        switchTab,
        activateTab,
        getActiveTab,
        loadModule, // Added for explicit lazy loading
        getSharedData, // No fetchJSON here, using global
        showToast,
        getItemInfo,
        createSearchIndex, // formatTime removed, using global
        buildRecipeDependencyTree,
        calculateTreeCost,
        calculateTreePoints,
        calculateTreeNetGain,
        buildDependencyGraph,
        buildShopDataIndex,
        buildRecipeIndices,
        GOLD_ITEM_ID,
        state: () => state // For debugging
    };

})();
