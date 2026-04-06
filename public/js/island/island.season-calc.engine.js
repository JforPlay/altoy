/**
 * island.season-calc.engine.js
 * Season calculator sub-engine for the island module. Displays season pass reward tiers,
 * lets users enter item quantities to tally points, and computes per-item net pt gain
 * and pt-per-minute using the resource module's dependency trees. Registers as window.SeasonCalcModule.
 */

import { fetchJSON, getStorageItem, setStorageItem } from '../utils.js';

'use strict';

// ===== State =====
const state = {
    items: {},              // All items from template
    ptItems: [],            // Items with pt_num > 0
    userQuantities: {},     // User input quantities { itemId: quantity }
    ownedPoints: 0,         // User's already owned season points
    sortBy: 'pt_desc',      // pt_desc, pt_asc, gain_desc, gain_asc, gain_per_min_desc, gain_per_min_asc, name_asc, name_desc
    seasonData: null,       // Season pass data from island_season.json
    seasonPassCollapsed: true, // Track if season pass is collapsed
    recipeIndex: null       // Recipe index for calculations
};

// ===== Initialization =====

/**
 * Load season pass and item data, restore saved quantities and owned points, then render the UI.
 * Ensures the resource module is loaded first so recipe indices are available for gain calculations.
 */
async function init(sharedData) {
    try {
        console.log('[SeasonCalc] Initializing...');

        // Use shared item data
        if (sharedData && sharedData.items) {
            state.items = sharedData.items;
        }

        // Ensure ResourceModule is loaded for recipe calculations
        if (window.IslandEngine && window.IslandEngine.loadModule) {
            try {
                await window.IslandEngine.loadModule('resources');
            } catch (e) {
                console.warn('[SeasonCalc] Failed to load resources module:', e);
            }
        }

        // Note: We don't get recipeIndex here because ResourceModule might not be initialized yet
        // It will be loaded lazily in renderItemGrid() when needed

        // Filter items with pt_num > 0
        state.ptItems = Object.values(state.items)
            .filter(item => item.pt_num > 0)
            .sort((a, b) => b.pt_num - a.pt_num); // Default: highest pt first

        console.log(`[SeasonCalc] Found ${state.ptItems.length} items with season points`);

        // Load season pass data
        await loadSeasonData();

        // Load saved quantities and owned points from localStorage
        loadUserQuantities();
        loadOwnedPoints();
        loadSeasonPassCollapseState();

        // Render UI
        renderControls();
        renderSeasonPass();
        renderItemGrid();
        renderTotalDisplay();

        // Setup event listeners
        setupEventListeners();

        console.log('[SeasonCalc] Initialization complete');
    } catch (error) {
        console.error('[SeasonCalc] Initialization failed:', error);
        window.IslandEngine.showError('Failed to load season calculator data');
    }
}

// ===== Data Management =====

async function loadSeasonData() {
    try {
        // Load module-specific data
        const rawData = await fetchJSON('data/island/island_season.json');

        // The JSON structure has keys like "1", "2" and an "all" array.
        // We want the latest season or specific season.
        let seasonId = 1;
        if (rawData.all && Array.isArray(rawData.all) && rawData.all.length > 0) {
            seasonId = rawData.all[rawData.all.length - 1];
        }

        state.seasonData = rawData[seasonId];

        if (!state.seasonData) {
            throw new Error(`Season data for ID ${seasonId} not found`);
        }

        console.log(`[Island Season] Loaded season data for season ${seasonId}`);
    } catch (e) {
        console.warn('[SeasonCalc] Could not load season data:', e);
        state.seasonData = null;
    }
}

function loadUserQuantities() {
    try {
        const saved = getStorageItem('island-season-quantities', null);
        if (saved) {
            state.userQuantities = JSON.parse(saved);
        }
    } catch (e) {
        console.warn('[SeasonCalc] Could not load saved quantities:', e);
        state.userQuantities = {};
    }
}

function loadOwnedPoints() {
    try {
        const saved = getStorageItem('island-season-owned-points', null);
        if (saved) {
            state.ownedPoints = parseInt(saved) || 0;
        }
    } catch (e) {
        console.warn('[SeasonCalc] Could not load owned points:', e);
        state.ownedPoints = 0;
    }
}

function loadSeasonPassCollapseState() {
    try {
        const saved = getStorageItem('island-season-pass-collapsed', null);
        if (saved) {
            state.seasonPassCollapsed = saved === 'true';
        }
    } catch (e) {
        console.warn('[SeasonCalc] Could not load collapse state:', e);
        state.seasonPassCollapsed = true;
    }
}

function saveUserQuantities() {
    try {
        setStorageItem('island-season-quantities', JSON.stringify(state.userQuantities));
    } catch (e) {
        console.warn('[SeasonCalc] Could not save quantities:', e);
    }
}

function saveOwnedPoints() {
    try {
        setStorageItem('island-season-owned-points', state.ownedPoints.toString());
    } catch (e) {
        console.warn('[SeasonCalc] Could not save owned points:', e);
    }
}

function saveSeasonPassCollapseState() {
    try {
        setStorageItem('island-season-pass-collapsed', state.seasonPassCollapsed.toString());
    } catch (e) {
        console.warn('[SeasonCalc] Could not save collapse state:', e);
    }
}

function toggleSeasonPassCollapse() {
    state.seasonPassCollapsed = !state.seasonPassCollapsed;
    saveSeasonPassCollapseState();
    renderSeasonPass();
}

function updateOwnedPoints(points) {
    state.ownedPoints = parseInt(points) || 0;
    saveOwnedPoints();
    renderTotalDisplay();
    renderSeasonPass();
}

function updateQuantity(itemId, quantity) {
    const numQuantity = parseInt(quantity) || 0;
    if (numQuantity > 0) {
        state.userQuantities[itemId] = numQuantity;
    } else {
        delete state.userQuantities[itemId];
    }
    saveUserQuantities();
    renderTotalDisplay();
}

function clearAllQuantities() {
    if (confirm('모든 수량을 초기화하시겠습니까?')) {
        state.userQuantities = {};
        saveUserQuantities();
        renderItemGrid();
        renderTotalDisplay();
    }
}

function setSortOrder(sortBy) {
    state.sortBy = sortBy;
    renderItemGrid();
}

// ===== Calculations =====

function calculateMaterialPoints() {
    let total = 0;
    for (const [itemId, quantity] of Object.entries(state.userQuantities)) {
        const item = state.items[itemId];
        if (item && item.pt_num > 0) {
            total += item.pt_num * quantity;
        }
    }
    return total;
}

function calculateTotalPoints() {
    return state.ownedPoints + calculateMaterialPoints();
}

function calculateItemPoints(itemId) {
    const item = state.items[itemId];
    const quantity = state.userQuantities[itemId] || 0;
    return item && item.pt_num > 0 ? item.pt_num * quantity : 0;
}

function hasRecipeForItem(itemId) {
    // Check if this item has a recipe that produces it
    if (!window.ResourceModule) return false;
    const dependencyGraph = window.ResourceModule.getDependencyGraph();
    const producerRecipeIds = dependencyGraph.producedBy[itemId] || [];
    return producerRecipeIds.length > 0;
}

// ===== Rendering =====

function formatSeasonTime() {
    if (!state.seasonData || !state.seasonData.time) return '';

    const [[startYear, startMonth, startDay], [startHour, startMin, startSec]] = state.seasonData.time[0];
    const [[endYear, endMonth, endDay], [endHour, endMin, endSec]] = state.seasonData.time[1];

    return `
        <div class="season-time">
            <span class="material-symbols-outlined">schedule</span>
            ${startYear}.${String(startMonth).padStart(2, '0')}.${String(startDay).padStart(2, '0')} ~
            ${endYear}.${String(endMonth).padStart(2, '0')}.${String(endDay).padStart(2, '0')}
        </div>
    `;
}

function renderControls() {
    const container = document.getElementById('season-calc-controls');
    if (!container) return;

    container.innerHTML = `
        <div class="calc-controls-row">
            <div class="calc-owned-points-group">
                <label for="calc-owned-points">보유 포인트:</label>
                <input type="number"
                       id="calc-owned-points"
                       class="calc-owned-points-input"
                       value="${state.ownedPoints}"
                       placeholder="0"
                       min="0">
            </div>
            <div class="calc-sort-group">
                <label for="calc-sort">정렬:</label>
                <select id="calc-sort" class="calc-sort-select">
                    <option value="pt_desc" ${state.sortBy === 'pt_desc' ? 'selected' : ''}>포인트 높은순</option>
                    <option value="pt_asc" ${state.sortBy === 'pt_asc' ? 'selected' : ''}>포인트 낮은순</option>
                    <option value="gain_desc" ${state.sortBy === 'gain_desc' ? 'selected' : ''}>순이익 높은순</option>
                    <option value="gain_asc" ${state.sortBy === 'gain_asc' ? 'selected' : ''}>순이익 낮은순</option>
                    <option value="gain_per_min_desc" ${state.sortBy === 'gain_per_min_desc' ? 'selected' : ''}>순이익/분 높은순</option>
                    <option value="gain_per_min_asc" ${state.sortBy === 'gain_per_min_asc' ? 'selected' : ''}>순이익/분 낮은순</option>
                    <option value="name_asc" ${state.sortBy === 'name_asc' ? 'selected' : ''}>이름순 (ㄱ-ㅎ)</option>
                    <option value="name_desc" ${state.sortBy === 'name_desc' ? 'selected' : ''}>이름순 (ㅎ-ㄱ)</option>
                </select>
            </div>
            <div class="calc-actions">
                <button class="calc-clear-btn" id="calc-clear-all">
                    <span class="material-symbols-outlined">delete_sweep</span>
                    전체 초기화
                </button>
            </div>
        </div>
    `;
}

function renderSeasonPass() {
    const container = document.getElementById('season-calc-pass');
    if (!container) return;

    if (!state.seasonData) {
        container.innerHTML = `
            <div class="season-pass-unavailable">
                <span class="material-symbols-outlined">error</span>
                <p>시즌 패스 데이터를 불러올 수 없습니다</p>
            </div>
        `;
        return;
    }

    const totalPoints = calculateTotalPoints();
    const targets = state.seasonData.target;
    const rewards = state.seasonData.ptaward_display;
    // High value indices are 1-based in the data, convert to 0-based for array access
    const highValueIndices = new Set((state.seasonData.ptaward_highvalue || []).map(i => i - 1));

    // Build reward tiers
    const tiers = targets.map((targetPt, index) => {
        const reward = rewards[index];
        if (!reward) return null;

        // First element determines type: 41 = item, 45 = furniture
        // Second element is the item/furniture ID, third is quantity
        const [typeId, itemId, quantity] = reward;
        const isFurniture = typeId === 45;

        const itemInfo = window.IslandEngine.getItemInfo(itemId);
        const isUnlocked = totalPoints >= targetPt;
        const isHighValue = highValueIndices.has(index);

        return {
            index,
            targetPt,
            itemId,
            itemInfo,
            quantity,
            isUnlocked,
            isHighValue,
            isFurniture
        };
    }).filter(tier => tier !== null);

    const tiersHtml = tiers.map(tier => {
        // Determine icon source based on type
        let iconSrc = '';
        if (tier.isFurniture) {
            // Furniture uses furniture_{id}.png
            iconSrc = `https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/islandfurnitureicon/furniture_${tier.itemId}.webp`;
        } else if (tier.itemInfo.icon) {
            // Regular items use their icon path
            iconSrc = `https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/islandprops/${tier.itemInfo.icon.split('/').pop()}.webp`;
        }

        return `
        <div class="season-tier ${tier.isUnlocked ? 'unlocked' : ''} ${tier.isHighValue ? 'high-value' : ''}">
            <div class="season-tier-header">
                <div class="season-tier-number">${tier.index + 1}</div>
                ${tier.isHighValue ? '<div class="season-tier-badge"><span class="material-symbols-outlined">stars</span></div>' : ''}
            </div>
            <div class="season-tier-reward">
                <div class="season-tier-icon">
                    ${iconSrc ? `
                        <img src="${iconSrc}"
                             alt="${tier.itemInfo.name}"
                             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    ` : ''}
                    <div class="season-tier-icon-fallback" style="display: ${iconSrc ? 'none' : 'flex'}">
                        <span class="material-symbols-outlined">${tier.isFurniture ? 'chair' : 'redeem'}</span>
                    </div>
                </div>
                <div class="season-tier-quantity">× ${tier.quantity}</div>
            </div>
            <div class="season-tier-name">${tier.itemInfo.name || `아이템 ${tier.itemId}`}</div>
            <div class="season-tier-target">${tier.targetPt.toLocaleString()} pt</div>
            ${tier.isUnlocked ? '<div class="season-tier-check"><span class="material-symbols-outlined">check_circle</span></div>' : ''}
        </div>
    `;
    }).join('');

    container.innerHTML = `
        <div class="season-pass-container ${state.seasonPassCollapsed ? 'collapsed' : ''}">
            <div class="season-pass-header">
                <div class="season-pass-title">
                    <h2>
                        <span class="material-symbols-outlined">celebration</span>
                        아일랜드 개발 시즌 I - 개막!
                    </h2>
                    ${formatSeasonTime()}
                </div>
                <button class="season-pass-toggle" onclick="SeasonCalcModule.toggleSeasonPassCollapse()" title="${state.seasonPassCollapsed ? '보상 펼치기' : '보상 접기'}">
                    <span class="material-symbols-outlined">${state.seasonPassCollapsed ? 'expand_more' : 'expand_less'}</span>
                    ${state.seasonPassCollapsed ? '보상 펼치기' : '보상 접기'}
                </button>
                <div class="season-pass-progress-bar">
                    <div class="season-pass-progress-fill" style="width: ${Math.min((totalPoints / targets[targets.length - 1]) * 100, 100)}%"></div>
                    <div class="season-pass-progress-text">${totalPoints.toLocaleString()} / ${targets[targets.length - 1].toLocaleString()} pt</div>
                </div>
            </div>
            <div class="season-pass-tiers">
                ${tiersHtml}
            </div>
        </div>
    `;
}

/**
 * Render the item grid sorted by the current sort order.
 * Pre-calculates net pt gain and pt/min for each item using the resource module's dependency trees;
 * lazily loads the recipe index from ResourceModule if not yet available.
 */
function renderItemGrid() {
    const container = document.getElementById('season-calc-grid');
    if (!container) return;

    // Lazily load recipe index from ResourceModule when first rendering
    if (!state.recipeIndex && window.ResourceModule) {
        state.recipeIndex = window.ResourceModule.getRecipeIndex();
        if (state.recipeIndex) {
            console.log('[SeasonCalc] Loaded recipe index:', Object.keys(state.recipeIndex).length, 'recipes');
        } else {
            console.warn('[SeasonCalc] Recipe index is still null after trying to load from ResourceModule');
        }
    }

    // Check if recipe index is actually populated (not just an empty object)
    if (!state.recipeIndex || Object.keys(state.recipeIndex).length === 0) {
        console.warn('[SeasonCalc] Recipe index is empty, ResourceModule may not be initialized yet. Showing items without net gain calculations.');
    }

    // Pre-calculate net gains for all items to enable sorting
    const itemsWithGains = state.ptItems.map(item => {
        let netPtGain = 0;
        let netPtGainPerMin = 0;
        let hasRecipe = false;

        // Check if we have all required data
        if (window.ResourceModule && state.recipeIndex) {
            try {
                const dependencyGraph = window.ResourceModule.getDependencyGraph();
                if (!dependencyGraph || !dependencyGraph.producedBy) {
                    return { ...item, _netPtGain: 0, _netPtGainPerMin: 0, _hasRecipe: false };
                }

                const producerRecipeIds = dependencyGraph.producedBy[item.id] || [];

                if (producerRecipeIds.length > 0) {
                    hasRecipe = true;
                    const recipeId = producerRecipeIds[0];
                    const upstreamTree = window.ResourceModule.buildUpstreamTree(recipeId, { useManualMode: false });
                    const recipe = state.recipeIndex[recipeId];

                    if (upstreamTree && recipe) {
                        const outputQuantity = (recipe.commission_product && recipe.commission_product.length > 0)
                            ? recipe.commission_product[0][1]
                            : 1;

                        // Calculate net gain per item
                        const accumulatedGain = window.IslandEngine.calculateTreeNetGain(upstreamTree, 'dependencies');
                        const ingredientPtCost = window.IslandEngine.calculateTreePoints(upstreamTree, 'dependencies');
                        const currentGain = item.pt_num * outputQuantity - ingredientPtCost;
                        const totalGain = accumulatedGain + currentGain;
                        netPtGain = totalGain / outputQuantity;

                        // Calculate net gain per minute
                        const cumulativeTime = window.ResourceModule.calculateCumulativeTime(recipeId, upstreamTree);
                        const cumulativeTimeInMinutes = cumulativeTime / 600; // DECISECONDS_PER_MINUTE = 600
                        netPtGainPerMin = cumulativeTimeInMinutes > 0 ? totalGain / cumulativeTimeInMinutes : 0;
                    }
                }
            } catch (error) {
                // Silent fail for pre-calculation
                console.warn(`[SeasonCalc] Error calculating gains for item ${item.id}:`, error);
            }
        }

        return { ...item, _netPtGain: netPtGain, _netPtGainPerMin: netPtGainPerMin, _hasRecipe: hasRecipe };
    });

    // Sort items based on current sort order
    const sortedItems = [...itemsWithGains].sort((a, b) => {
        switch (state.sortBy) {
            case 'pt_asc':
                return a.pt_num - b.pt_num;
            case 'pt_desc':
                return b.pt_num - a.pt_num;
            case 'gain_desc':
                return (b._netPtGain || 0) - (a._netPtGain || 0);
            case 'gain_asc':
                return (a._netPtGain || 0) - (b._netPtGain || 0);
            case 'gain_per_min_desc':
                return (b._netPtGainPerMin || 0) - (a._netPtGainPerMin || 0);
            case 'gain_per_min_asc':
                return (a._netPtGainPerMin || 0) - (b._netPtGainPerMin || 0);
            case 'name_asc':
                return a.name.localeCompare(b.name, 'ko');
            case 'name_desc':
                return b.name.localeCompare(a.name, 'ko');
            default:
                return b.pt_num - a.pt_num;
        }
    });

    const itemCards = sortedItems.map(item => {
        const quantity = state.userQuantities[item.id] || 0;
        const points = calculateItemPoints(item.id);

        // Reuse pre-calculated values
        const netPtGain = item._netPtGain || 0;
        const netPtGainPerMin = item._netPtGainPerMin || 0;
        const hasRecipe = item._hasRecipe || false;

        const iconSrc = item.icon
            ? `https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/islandprops/${item.icon.split('/').pop()}.webp`
            : '';

        return `
            <div class="calc-item-card ${quantity > 0 ? 'has-quantity' : ''}" data-item-id="${item.id}">
                <div class="calc-item-header">
                    <div class="calc-item-icon">
                        ${iconSrc ? `
                            <img src="${iconSrc}"
                                 alt="${item.name}"
                                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                        ` : ''}
                        <div class="calc-item-icon-fallback" style="display: ${iconSrc ? 'none' : 'flex'}">
                            <span class="material-symbols-outlined">inventory_2</span>
                        </div>
                    </div>
                    <div class="calc-item-info">
                        <div class="calc-item-name">${item.name || `가구 ${item.id}`}</div>
                        <div class="calc-item-pt">
                            <span class="material-symbols-outlined">grade</span>
                            ${item.pt_num} pt
                        </div>
                        ${hasRecipe ? `
                            <div class="calc-item-net-gain">
                                <span class="calc-net-gain-label">총 순수익:</span>
                                <span class="calc-net-gain-value ${netPtGain >= 0 ? 'positive' : 'negative'}">
                                    ${netPtGain >= 0 ? '+' : ''}${netPtGain.toFixed(2)} pt
                                </span>
                            </div>
                            <div class="calc-item-net-gain">
                                <span class="calc-net-gain-label">순수익/분:</span>
                                <span class="calc-net-gain-value ${netPtGainPerMin >= 0 ? 'positive' : 'negative'}">
                                    ${netPtGainPerMin >= 0 ? '+' : ''}${netPtGainPerMin.toFixed(2)} pt/min
                                </span>
                            </div>
                        ` : ''}
                    </div>
                </div>
                <div class="calc-item-actions-row">
                    <button class="calc-view-recipe-btn" data-item-id="${item.id}" title="자원 탭에서 보기">
                        <span class="material-symbols-outlined">open_in_new</span>
                        레시피
                    </button>
                </div>
                <div class="calc-item-input-row">
                    <input type="number"
                           class="calc-quantity-input"
                           value="${quantity || ''}"
                           placeholder="0"
                           min="0"
                           data-item-id="${item.id}">
                    <div class="calc-item-total">
                        ${points > 0 ? `<strong>${points.toLocaleString()}</strong> pt` : '0 pt'}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = itemCards || `
        <div class="calc-empty-state">
            <span class="material-symbols-outlined">inventory_2</span>
            <p>포인트 아이템을 찾을 수 없습니다</p>
        </div>
    `;
}

function renderTotalDisplay() {
    const container = document.getElementById('season-calc-total');
    if (!container) return;

    const materialPoints = calculateMaterialPoints();
    const totalPoints = calculateTotalPoints();
    const itemCount = Object.keys(state.userQuantities).length;

    container.innerHTML = `
        <div class="calc-total-card">
            <div class="calc-total-icon">
                <span class="material-symbols-outlined">emoji_events</span>
            </div>
            <div class="calc-total-content">
                <div class="calc-total-label">총 시즌 포인트</div>
                <div class="calc-total-value">${totalPoints.toLocaleString()}</div>
                <div class="calc-total-breakdown">
                    <span>보유: ${state.ownedPoints.toLocaleString()} pt</span>
                    <span>+</span>
                    <span>재료: ${materialPoints.toLocaleString()} pt</span>
                </div>
                <div class="calc-total-meta">${itemCount}개 아이템</div>
            </div>
        </div>
    `;
}

// ===== Event Listeners =====

function setupEventListeners() {
    const container = document.getElementById('tab-season-calc');
    if (!container) return;

    // Input change handlers
    container.addEventListener('input', (e) => {
        if (e.target.classList.contains('calc-quantity-input')) {
            const itemId = e.target.dataset.itemId;
            const quantity = e.target.value;
            updateQuantity(itemId, quantity);
            // Re-render the grid to update expanded sections
            renderItemGrid();
        } else if (e.target.id === 'calc-owned-points') {
            updateOwnedPoints(e.target.value);
        }
    });

    // Click handlers
    container.addEventListener('click', (e) => {
        // View recipe button
        const viewRecipeBtn = e.target.closest('.calc-view-recipe-btn');
        if (viewRecipeBtn) {
            const itemId = viewRecipeBtn.dataset.itemId;
            viewItemInResources(itemId);
            return;
        }

        // Clear all button
        if (e.target.closest('#calc-clear-all')) {
            clearAllQuantities();
        }
    });

    // Sort order change
    container.addEventListener('change', (e) => {
        if (e.target.id === 'calc-sort') {
            setSortOrder(e.target.value);
        }
    });
}

// ===== Navigation =====

function viewItemInResources(itemId) {
    // Find recipe that produces this item
    const dependencyGraph = window.ResourceModule.getDependencyGraph();
    const producerRecipeIds = dependencyGraph.producedBy[itemId] || [];

    if (producerRecipeIds.length === 0) {
        alert('이 아이템은 레시피가 없습니다.');
        return;
    }

    // Switch to resources tab
    const resourcesTabBtn = document.querySelector('.tab-button[data-tab="resources"]');
    if (resourcesTabBtn) {
        resourcesTabBtn.click();
    }

    // Select the recipe after a short delay to ensure tab is loaded
    setTimeout(() => {
        window.ResourceModule.selectRecipe(producerRecipeIds[0]);
    }, 100);
}

// ===== Public API =====

/**
 * Called by island.script.js when the season-calc tab is activated.
 * Refreshes the recipe index (ResourceModule may have loaded after SeasonCalc) and re-renders the grid.
 */
function onTabActivated() {
    // Always try to reload recipe index when tab becomes active
    // This ensures we have the latest data even if ResourceModule loaded after SeasonCalc
    if (window.ResourceModule) {
        const newRecipeIndex = window.ResourceModule.getRecipeIndex();
        if (newRecipeIndex && Object.keys(newRecipeIndex).length > 0) {
            state.recipeIndex = newRecipeIndex;
            console.log('[SeasonCalc] onTabActivated - Refreshed recipe index:', Object.keys(state.recipeIndex).length, 'recipes');
        }
    }

    // Re-render the grid to ensure recipe data is loaded and calculations are up to date
    renderItemGrid();
}

// Backwards compatibility
window.SeasonCalcModule = {
    init,
    calculateTotalPoints,
    clearAllQuantities,
    toggleSeasonPassCollapse,
    onTabActivated
};

export { init, calculateTotalPoints, clearAllQuantities, toggleSeasonPassCollapse, onTabActivated };
