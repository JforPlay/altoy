/**
 * island.season-calc.engine.js
 * Season calculator sub-engine for the island module. Displays season pass reward tiers,
 * lets users enter item quantities to tally points, and computes per-item net pt gain
 * and pt-per-minute using the resource module's dependency trees. Registers as window.SeasonCalcModule.
 */

import { fetchJSON, getStorageItem, setStorageItem, renderStatus, DATA_FOR_TOY_BASE } from '../utils.js';
import { renderSeasonBadge, findCurrentSeasonId, getSeasonThematicName } from './island.season-map.js';

'use strict';

// ===== State =====
const state = {
    items: {},              // All items from template
    ptItems: [],            // Items with pt_num > 0
    userQuantities: {},     // User input quantities { itemId: quantity }
    ownedPoints: 0,         // User's already owned season points
    sortBy: 'pt_desc',      // pt_desc, pt_asc, gain_desc, gain_asc, gain_per_min_desc, gain_per_min_asc, name_asc, name_desc
    seasonData: null,       // Season pass data from island_season.json
    currentSeasonId: null,  // Numeric id of the season backing state.seasonData
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
        if (sharedData && sharedData.items) {
            state.items = sharedData.items;
        }

        // loadModule resolves only after ResourceModule.init() completes, so
        // getRecipeIndex() is guaranteed populated here. No fallback needed.
        await window.IslandEngine.loadModule('resources');
        state.recipeIndex = window.ResourceModule.getRecipeIndex();

        state.ptItems = Object.values(state.items)
            .filter(item => item.pt_num > 0)
            .sort((a, b) => b.pt_num - a.pt_num);

        await loadSeasonData();

        loadUserQuantities();
        loadOwnedPoints();
        loadSeasonPassCollapseState();

        renderControls();
        renderSeasonPass();
        renderItemGrid();
        renderTotalDisplay();

        setupEventListeners();
    } catch (error) {
        console.error('[SeasonCalc] Initialization failed:', error);
        window.IslandEngine.showError('Failed to load season calculator data');
    }
}

// ===== Data Management =====

async function loadSeasonData() {
    try {
        const rawData = await fetchJSON('data/island/island_season.json');

        // Pick the season whose KST time window contains now (canonical, matches
        // the badge module). island_season.json has no `all` index, so fall back
        // to the highest numeric key only when no season is currently live.
        const nowMs = Date.now();
        let seasonId = findCurrentSeasonId(rawData, nowMs);
        if (seasonId === null) {
            const numericKeys = Object.keys(rawData)
                .filter(k => /^\d+$/.test(k))
                .map(Number)
                .sort((a, b) => b - a);
            seasonId = numericKeys[0] ?? null;
        }

        state.currentSeasonId = seasonId;
        state.seasonData = seasonId !== null ? rawData[String(seasonId)] : null;

        if (!state.seasonData) {
            throw new Error('No season data resolved');
        }
    } catch (e) {
        console.warn('[SeasonCalc] Could not load season data:', e);
        state.seasonData = null;
        state.currentSeasonId = null;
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

    const [[startYear, startMonth, startDay], [startHour]] = state.seasonData.time[0];
    const [[endYear, endMonth, endDay], [endHour]] = state.seasonData.time[1];

    // KR maintenance gap convention in island_season.json:
    //   hour <  12 → window begins right after maintenance ("점검 후")
    //   hour >= 12 → window ends right before maintenance  ("점검 전")
    const startSuffix = startHour < 12 ? ' 점검 후' : ' 점검 전';
    const endSuffix = endHour < 12 ? ' 점검 후' : ' 점검 전';

    return `
        <div class="season-time">
            <span class="material-symbols-outlined">schedule</span>
            ${startYear}.${String(startMonth).padStart(2, '0')}.${String(startDay).padStart(2, '0')}${startSuffix} ~
            ${endYear}.${String(endMonth).padStart(2, '0')}.${String(endDay).padStart(2, '0')}${endSuffix}
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
                <button class="btn btn-danger calc-clear-btn" id="calc-clear-all">
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
        renderStatus(container, '시즌 패스 데이터를 불러올 수 없습니다', 'error');
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
            iconSrc = `${DATA_FOR_TOY_BASE}/island/islandfurnitureicon/furniture_${tier.itemId}.webp`;
        } else if (tier.itemInfo.icon) {
            // Regular items use their icon path
            iconSrc = `${DATA_FOR_TOY_BASE}/island/islandprops/${tier.itemInfo.icon.split('/').pop()}.webp`;
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
                             data-onfail="swap-fallback">
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

    // Generic data name (e.g. "개발 시즌Ⅲ") + thematic in-game subtitle when
    // we have one for this season id (override table in island.season-map.js).
    const seasonName = state.seasonData.name || '개발 시즌';
    const thematicName = state.currentSeasonId !== null
        ? getSeasonThematicName(state.currentSeasonId)
        : null;
    const headerTitle = thematicName
        ? `아일랜드 ${seasonName} - ${thematicName}`
        : `아일랜드 ${seasonName}`;

    container.innerHTML = `
        <div class="season-pass-container ${state.seasonPassCollapsed ? 'collapsed' : ''}">
            <div class="season-pass-header">
                <div class="season-pass-title">
                    <h2>
                        <span class="material-symbols-outlined">celebration</span>
                        ${headerTitle}
                    </h2>
                    ${formatSeasonTime()}
                </div>
                <button class="season-pass-toggle" data-action="toggle-season-pass" title="${state.seasonPassCollapsed ? '보상 펼치기' : '보상 접기'}">
                    <span class="material-symbols-outlined">${state.seasonPassCollapsed ? 'expand_more' : 'expand_less'}</span>
                    ${state.seasonPassCollapsed ? '보상 펼치기' : '보상 접기'}
                </button>
                <div class="season-pass-progress-bar">
                    <div class="season-pass-progress-fill" style="width: ${Math.min((totalPoints / targets[targets.length - 1]) * 100, 100)}%"></div>
                    <div class="season-pass-progress-text">${totalPoints.toLocaleString()} / ${targets[targets.length - 1].toLocaleString()} pt</div>
                </div>
            </div>
            <div class="season-pass-tiers card-grid">
                ${tiersHtml}
            </div>
        </div>
    `;
}

/**
 * Render the item grid sorted by the current sort order.
 * Pre-calculates net pt gain and pt/min for each item using the resource
 * module's dependency trees. state.recipeIndex is populated during init().
 */
function renderItemGrid() {
    const container = document.getElementById('season-calc-grid');
    if (!container) return;

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
            ? `${DATA_FOR_TOY_BASE}/island/islandprops/${item.icon.split('/').pop()}.webp`
            : '';

        return `
            <div class="calc-item-card ${quantity > 0 ? 'has-quantity' : ''}" data-item-id="${item.id}">
                <div class="calc-item-header">
                    <div class="calc-item-icon">
                        ${iconSrc ? `
                            <img src="${iconSrc}"
                                 alt="${item.name}"
                                 data-onfail="swap-fallback">
                        ` : ''}
                        <div class="calc-item-icon-fallback" style="display: ${iconSrc ? 'none' : 'flex'}">
                            <span class="material-symbols-outlined">inventory_2</span>
                        </div>
                    </div>
                    <div class="calc-item-info">
                        <div class="calc-item-name">${item.name || `가구 ${item.id}`}</div>
                        ${renderSeasonBadge(item.id)}
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
                    <button class="btn btn-secondary calc-view-recipe-btn" data-item-id="${item.id}" title="자원 탭에서 보기">
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

    if (itemCards) {
        container.innerHTML = itemCards;
    } else {
        renderStatus(container, '포인트 아이템을 찾을 수 없습니다', 'empty', { icon: 'inventory_2' });
    }
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

        // Season pass collapse toggle
        if (e.target.closest('[data-action="toggle-season-pass"]')) {
            toggleSeasonPassCollapse();
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

async function viewItemInResources(itemId) {
    // Find recipe that produces this item
    const dependencyGraph = window.ResourceModule.getDependencyGraph();
    const producerRecipeIds = dependencyGraph.producedBy[itemId] || [];

    if (producerRecipeIds.length === 0) {
        alert('이 아이템은 레시피가 없습니다.');
        return;
    }

    await window.IslandEngine.activateTab('resources');
    window.ResourceModule.selectRecipe(producerRecipeIds[0]);
}

// ===== Public API =====

window.SeasonCalcModule = {
    init,
    calculateTotalPoints,
    clearAllQuantities,
    toggleSeasonPassCollapse
};

export { init, calculateTotalPoints, clearAllQuantities, toggleSeasonPassCollapse };
