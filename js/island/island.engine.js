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
            restaurant: null
        },
        sharedData: {
            items: null,  // Shared across all modules
            loaded: false
        }
    };

    // ============================================
    // INITIALIZATION
    // ============================================

    async function init() {
        console.log('[Island] Initializing core engine...');

        try {
            // Load shared data first
            await loadSharedData();

            // Initialize all modules with error handling
            const moduleInits = [
                initModule('character', window.CharacterModule),
                initModule('technology', window.TechnologyModule),
                initModule('quest', window.QuestModule),
                initModule('resource', window.ResourceModule),
                initModule('restaurant', window.RestaurantModule)
            ];

            const results = await Promise.allSettled(moduleInits);

            // Log any failures
            results.forEach((result, i) => {
                const moduleNames = ['character', 'technology', 'quest', 'resource', 'restaurant'];
                if (result.status === 'rejected') {
                    console.error(`[Island] ${moduleNames[i]} module failed to initialize:`, result.reason);
                    showError(`${moduleNames[i]} 모듈을 불러오는데 실패했습니다.`);
                }
            });

            console.log('[Island] Core engine initialized');
        } catch (error) {
            console.error('[Island] Critical initialization failure:', error);
            showError('페이지를 불러오는데 실패했습니다. 페이지를 새로고침해주세요.');
        }
    }

    async function loadSharedData() {
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

    async function fetchJSON(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        }
        return response.json();
    }

    function getSharedData() {
        return state.sharedData;
    }

    function showError(message) {
        console.error('[Island]', message);

        // Create or update error toast
        let errorToast = document.getElementById('island-error-toast');
        if (!errorToast) {
            errorToast = document.createElement('div');
            errorToast.id = 'island-error-toast';
            errorToast.className = 'island-error-toast';
            document.body.appendChild(errorToast);
        }

        errorToast.textContent = message;
        errorToast.classList.add('show');

        // Auto-hide after 5 seconds
        setTimeout(() => {
            errorToast.classList.remove('show');
        }, 5000);
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

    function formatTime(deciseconds) {
        if (!deciseconds) return '0s';

        const totalSeconds = deciseconds / 10;
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = Math.floor(totalSeconds % 60);

        const parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

        return parts.join(' ');
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
            visited = new Set()
        } = options;

        if (visited.has(recipeId) || maxDepth === 0) return null;
        visited.add(recipeId);

        const recipe = recipeIndex[recipeId];
        if (!recipe) return null;

        const recipeCategory = recipeCategoryIndex[recipeId];
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

            // DEBUG
            console.log(`[TreeBuild] Processing input item ${itemId}, qty: ${scaledQuantity}, producers: ${producers.length}, shopPurchase: ${!!shopPurchase}`);

            // Priority: Prefer crafting over shop purchase if item can be produced
            if (producers.length > 0) {
                // Item is produced by recipes - recurse into recipe
                console.log(`[TreeBuild] Item ${itemId} can be crafted, recursing into recipe`);
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
                        visited: childVisited
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

                console.log(`[TreeBuild] Item ${itemId} is shop-buyable, requires item ${requiredItemId}, totalCost: ${totalCost}`);

                // Check if the required resource can be crafted
                if (requiredItemId !== GOLD_ITEM_ID && dependencyGraph.producedBy[requiredItemId]) {
                    // Required resource is craftable - recurse into crafting it
                    console.log(`[TreeBuild] Required resource ${requiredItemId} can be crafted, recursing`);
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
                            visited: childVisited
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
                    console.log(`[TreeBuild] Adding shop purchase: item ${itemId} costs ${totalCost} of item ${requiredItemId} (gold=${requiredItemId === GOLD_ITEM_ID})`);
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
                console.log(`[TreeBuild] Item ${itemId} is neither craftable nor shop-buyable - skipping`);
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

                // DEBUG
                console.log(`[TreeCost] Found shop purchase: ${itemInfo.name} (ID: ${itemId}) costs ${totalCost} of item ${itemId}`);

                if (itemId === GOLD_ITEM_ID) {
                    console.log(`[TreeCost] Adding ${totalCost} gold`);
                    gold += totalCost;
                } else {
                    console.log(`[TreeCost] Adding ${totalCost} of resource ${itemInfo.name}`);
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

    // ============================================
    // PUBLIC API
    // ============================================

    return {
        init,
        switchTab,
        activateTab,
        getActiveTab,
        fetchJSON,
        getSharedData,
        showError,
        getItemInfo,
        formatTime,
        createSearchIndex,
        buildRecipeDependencyTree,
        calculateTreeCost,
        GOLD_ITEM_ID,
        state: () => state // For debugging
    };

})();
