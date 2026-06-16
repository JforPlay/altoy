/**
 * island.resource.render.js
 * Rendering sub-module for the island resource system. Handles all UI output: category filters,
 * recipe lists, recipe detail panels (costs, season points, dependency trees), and the recipe
 * forest modal. State is shared via setup() called from island.resource.engine.js.
 */

import { formatTime, renderStatus, DATA_FOR_TOY_BASE } from '../utils.js';
import { renderSeasonBadge } from './island.season-map.js';
import {
    CONSTANTS, findRecipeById, findRecipeCategoryById,
    buildDownstreamTree, calculateTreeStats,
    calculateCumulativeTime, calculateManualGoldConsumption,
    calculateCumulativeTimeManual
} from './island.resource.tree.js';

'use strict';

export const categoryNames = {
    '1': '재배 (Farming)',
    '2': '채집 (Gathering)',
    '3': '사육 (Husbandry)',
    '4': '요리 (Cooking)',
    '6': '제조 (Manufacturing)',
    '시즌템': '시즌템 (Seasonal Items)'
};

// ===== State Reference (set via setup) =====
let state;

export function setup(stateRef) {
    state = stateRef;
}

// ===== UI Rendering =====

/** Render the category dropdown, search input, and forest button into the filter container. */
export function renderCategoryFilter() {
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

/** Render the recipe card list for the currently selected category, filtered by search query. */
export function renderRecipeList() {
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
        renderStatus(container, '검색 결과가 없습니다', 'empty', { icon: 'search_off' });
        return;
    }

    const html = filteredRecipes.map(recipe => {
        const item = window.IslandEngine.getItemInfo(recipe.item_id);
        const isSelected = state.selectedRecipe?.id === recipe.id;

        return `
            <div class="recipe-card ${isSelected ? 'active' : ''}"
                 data-recipe-id="${recipe.id}">
                                        <div class="recipe-icon">
                                            ${item.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${item.icon.split('/').pop()}.webp" alt="${item.name}">` : '📦'}
                                        </div>                    <div class="recipe-info">
                <div class="recipe-name">${recipe.name || item.name}</div>
                <div class="recipe-meta">
                    <span class="recipe-time">⏱ ${formatTime(recipe.workload)}</span>
                    <span class="recipe-exp">⚡ ${recipe.ship_exp}</span>
                    ${renderSeasonBadge(recipe.item_id)}
                </div>
            </div>
            </div>
        `;
    }).join('');

    container.innerHTML = html;
}

/**
 * Compute all derived data for the recipe detail panel: upstream/downstream links, gold/season-point
 * consumption, cumulative times, and net pt gains for both auto and manual mode (category 1 only).
 */
export function gatherRecipeData(recipe) {
    const item = window.IslandEngine.getItemInfo(recipe.item_id);
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
    const upstreamTree = window.IslandEngine.buildRecipeDependencyTree(
        recipe.id,
        state.recipeIndex,
        state.recipeCategoryIndex,
        state.dependencyGraph,
        state.shopPurchaseData,
        { useManualMode: false }
    );

    // Calculate gold consumption using shared utility
    const goldConsumption = window.IslandEngine.calculateTreeCost(upstreamTree);

    // Calculate season points for ingredients only (new approach)
    const seasonPointsConsumption = window.IslandEngine.calculateTreePoints(upstreamTree);

    // Calculate net gain accumulated from entire tree
    const netGainTotal = window.IslandEngine.calculateTreeNetGain(upstreamTree);

    // Calculate manual gold consumption
    let manualGoldConsumption = { gold: 0, resources: {} };
    let manualSeasonPointsConsumption = 0;
    let manualNetGainTotal = 0;
    let upstreamTreeManual = null;

    // Only calculate manual mode for category 1
    if (isCategory1 && recipe.cost && recipe.cost.length > 0) {
        manualGoldConsumption = calculateManualGoldConsumption(recipe);
        upstreamTreeManual = window.IslandEngine.buildRecipeDependencyTree(
            recipe.id,
            state.recipeIndex,
            state.recipeCategoryIndex,
            state.dependencyGraph,
            state.shopPurchaseData,
            { useManualMode: true }
        );
        manualSeasonPointsConsumption = window.IslandEngine.calculateTreePoints(upstreamTreeManual);
        manualNetGainTotal = window.IslandEngine.calculateTreeNetGain(upstreamTreeManual);
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
    } return {
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

export function renderRecipeHeader(recipe, data) {
    const { item, category } = data;
    const restaurants = window.RestaurantModule ? window.RestaurantModule.getRestaurantsForRecipe(recipe.id) : [];

    return `
        <div class="recipe-detail-header">
            <div class="recipe-icon-large">
                ${item.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${item.icon.split('/').pop()}.webp" alt="${item.name}">` : '📦'}
            </div>
            <div class="recipe-title-section">
                <h3>${recipe.name || item.name}</h3>
                <div class="recipe-meta-badges">
                    <span class="badge recipe-category">${category}</span>
                    <span class="badge badge--neutral stat-badge exp">⚡ ${recipe.ship_exp} EXP</span>
                    <span class="badge badge--neutral stat-badge stamina">🔋 ${recipe.stamina_cost} Stamina</span>
                    <span class="badge badge--neutral stat-badge points">🎯 ${item.pt_num} pt</span>
                    ${renderSeasonBadge(recipe.item_id)}
                </div>
            </div>
            <div class="recipe-header-actions">
                ${restaurants.length > 0 ? `
                    <button class="action-btn" data-action="view-in-restaurant" data-recipe-id="${recipe.id}">
                        <span class="material-symbols-outlined">restaurant</span>
                        레스토랑에서 보기
                    </button>
                ` : ''}
            </div>
        </div>
    `;
}

export function renderRecipeFlow(recipe, data) {
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
                    <span class="flow-stat">⏱ ${formatTime(recipe.workload)}</span>
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

export function renderManualSection(recipe, data) {
    const { isCategory1, isCategory2, isCategory3 } = data;

    if (isCategory1 && recipe.cost?.length) {
        return `
            <div class="manual-drop-section category1-manual">
                <h4 class="manual-drop-title">💎 수동 생산 <span class="manual-time">(${formatTime(recipe.workload * CONSTANTS.MANUAL_TIME_MULTIPLIER)})</span></h4>
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
                            <span class="flow-stat">⏱ ${formatTime(recipe.workload * CONSTANTS.MANUAL_TIME_MULTIPLIER)}</span>
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
                <h4 class="manual-drop-title">💎 수동 사육 <span class="manual-time">(${formatTime(recipe.workload * CONSTANTS.MANUAL_TIME_MULTIPLIER)})</span></h4>
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
                            <span class="flow-stat">⏱ ${formatTime(recipe.workload * CONSTANTS.MANUAL_TIME_MULTIPLIER)}</span>
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
                <h4 class="manual-drop-title">💎 수동 채집 <span class="manual-time">(${formatTime(recipe.workload)})</span></h4>
                ${renderMaterialListVertical(recipe.drop_display)}
            </div>
        `;
    }

    if (!isCategory1 && !isCategory2 && recipe.drop_display?.length) {
        return `
            <div class="manual-drop-section">
                <h4 class="manual-drop-title">💎 수동 채집 <span class="manual-time">(${formatTime(recipe.workload * CONSTANTS.MANUAL_TIME_MULTIPLIER)})</span></h4>
                ${renderMaterialListVertical(recipe.drop_display)}
            </div>
        `;
    }

    return '';
}

export function renderCostSummary(recipe, data) {
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
                                        ${data.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${data.icon.split('/').pop()}.webp" alt="${data.name}">` : '📦'}
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
                            ${data.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${data.icon.split('/').pop()}.webp" alt="${data.name}">` : '📦'}
                        </div>
                        <span class="cost-name">${data.name}</span>
                        <span class="cost-amount">×${data.amount.toLocaleString()}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

export function renderRecipeActions(recipe, data) {
    const { producedByRecipes, usedInRecipes } = data;
    return `
        <div class="recipe-actions">
            <button class="action-btn" data-action="show-upstream" data-recipe-id="${recipe.id}">
                <span class="material-symbols-outlined">arrow_upward</span>
                하위 조합 전체 보기 (${producedByRecipes.length})
            </button>
            <button class="action-btn" data-action="show-downstream" data-recipe-id="${recipe.id}">
                <span class="material-symbols-outlined">arrow_downward</span>
                상위 조합 전체 보기 (${usedInRecipes.length})
            </button>
        </div>
    `;
}

export function renderRecipeDetail(recipe) {
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

export function renderSeasonalItemDetail(recipe, container) {
    const itemId = recipe._seasonalItemId || recipe.item_id;
    const item = window.IslandEngine.getItemInfo(itemId);
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
            const costItem = window.IslandEngine.getItemInfo(requiredItemId);
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
                ${item.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${item.icon.split('/').pop()}.webp" alt="${item.name}">` : '📦'}
            </div>
            <div class="recipe-title-section">
                <h3>${item.name}</h3>
                <div class="recipe-meta-badges">
                    <span class="badge recipe-category">시즌템 (Seasonal)</span>
                    <span class="badge badge--neutral stat-badge rarity-${item.rarity || 1}">★ ${item.rarity || 1}</span>
                    ${renderSeasonBadge(itemId)}
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
        const recipeItem = window.IslandEngine.getItemInfo(originalRecipe.item_id);
        const categoryId = findRecipeCategoryById(recipeId);
        return `
                            <div class="seasonal-recipe-card" data-recipe-id="${recipeId}">
                                <div class="recipe-icon">
                                    ${recipeItem.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${recipeItem.icon.split('/').pop()}.webp" alt="${recipeItem.name}">` : '📦'}
                                </div>
                                <div class="recipe-info">
                                    <div class="recipe-name">${originalRecipe.name || recipeItem.name}</div>
                                    <div class="recipe-meta">
                                        <span>${categoryNames[categoryId] || '알 수 없음'}</span>
                                        <span>⏱ ${formatTime(originalRecipe.workload)}</span>
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

export function renderSeasonalDependencyTree(recipe) {
    const container = document.getElementById('dependency-chain');
    if (!container) return;

    const itemId = recipe._seasonalItemId || recipe.item_id;
    const item = window.IslandEngine.getItemInfo(itemId);

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
        const producerItem = window.IslandEngine.getItemInfo(producerRecipe.item_id);
        const categoryId = findRecipeCategoryById(recipeId);
        return `
                            <div class="tree-node-card upstream" data-recipe-id="${recipeId}">
                                <div class="tree-node-icon">
                                    ${producerItem.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${producerItem.icon.split('/').pop()}.webp" alt="${producerItem.name}">` : '📦'}
                                </div>
                                <div class="tree-node-info">
                                    <div class="tree-node-name">${producerRecipe.name || producerItem.name}</div>
                                    <div class="tree-node-meta">
                                        <span>${categoryNames[categoryId] || '알 수 없음'}</span>
                                        <span>⏱ ${formatTime(producerRecipe.workload)}</span>
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
        const usageItem = window.IslandEngine.getItemInfo(usageRecipe.item_id);
        const categoryId = findRecipeCategoryById(recipeId);
        return `
                            <div class="tree-node-card downstream" data-recipe-id="${recipeId}">
                                <div class="tree-node-icon">
                                    ${usageItem.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${usageItem.icon.split('/').pop()}.webp" alt="${usageItem.name}">` : '📦'}
                                </div>
                                <div class="tree-node-info">
                                    <div class="tree-node-name">${usageRecipe.name || usageItem.name}</div>
                                    <div class="tree-node-meta">
                                        <span>${categoryNames[categoryId] || '알 수 없음'}</span>
                                        <span>⏱ ${formatTime(usageRecipe.workload)}</span>
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
            <div class="page-status page-status-empty">
                <span class="material-symbols-outlined page-status-icon">inventory</span>
                <p class="page-status-msg">이 아이템과 연결된 레시피가 없습니다.</p>
            </div>
        ` : ''}
    `;

    container.innerHTML = html;
}

export function renderMaterialList(materials) {
    if (!materials || materials.length === 0) {
        return '<p class="no-materials">없음</p>';
    }

    return `
        <div class="material-list">
            ${materials.map(([itemId, quantity]) => {
        const item = window.IslandEngine.getItemInfo(itemId);
        return `
                    <div class="material-item rarity-${item.rarity || 1}">
                        <div class="material-icon">
                            ${item.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${item.icon.split('/').pop()}.webp" alt="${item.name}">` : '📦'}
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

export function renderMaterialListVertical(materials) {
    if (!materials || materials.length === 0) {
        return '<p class="no-materials">없음</p>';
    }

    return `
        <div class="material-list-vertical">
            ${materials.map(([itemId, quantity]) => {
        const item = window.IslandEngine.getItemInfo(itemId);
        return `
                    <div class="material-item-vertical rarity-${item.rarity || 1}">
                        <div class="material-top-row">
                            <div class="material-icon">
                                ${item.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${item.icon.split('/').pop()}.webp" alt="${item.name}">` : '📦'}
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
export function renderDependencyTree(recipe) {
    const container = document.getElementById('dependency-chain');
    if (!container) return;

    if (!recipe) {
        renderEmptyChain();
        return;
    }

    // Build trees using shared utility - use manual tree for upstream (shows manual mode for category 1)
    const upstreamTree = window.IslandEngine.buildRecipeDependencyTree(
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

    const item = window.IslandEngine.getItemInfo(recipe.item_id);

    const html = `
        <div class="tree-header">
            <h3>
                <span class="material-symbols-outlined">account_tree</span>
                관련된 제조법들 (수동 생산)
            </h3>
            <div class="tree-stats">
                <span class="badge badge--neutral stat-badge-sm upstream">
                    <span class="material-symbols-outlined">arrow_upward</span>
                    ${upstreamStats.count - 1}
                </span>
                <span class="badge badge--neutral stat-badge-sm downstream">
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
export function renderTreeNodesWithConnectors(nodes, depth, direction) {
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
                            ${item.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${item.icon.split('/').pop()}.webp" alt="${item.name}">` : '📦'}
                        </div>
                        <div class="tree-node-info">
                            <div class="tree-node-name">
                                <span class="badge badge--warning shop-badge">🛒 Shop</span>
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
        const item = window.IslandEngine.getItemInfo(node.recipe.item_id);
        const hasChildren = (node.dependencies?.length || node.usages?.length || 0) > 0;
        const children = node.dependencies || node.usages || [];
        const isManualMode = node.isManualMode || false;
        const workloadTime = isManualMode ? node.recipe.workload * CONSTANTS.MANUAL_TIME_MULTIPLIER : node.recipe.workload;

        return `
            <div class="tree-node depth-${depth} ${isLast ? 'last-child' : ''}" data-direction="${direction}">
                <div class="tree-node-card ${direction} ${isManualMode ? 'manual-mode' : ''}" data-action="select-tree-recipe" data-recipe-id="${node.recipe.id}">
                    <div class="tree-node-icon">
                        ${item.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${item.icon.split('/').pop()}.webp" alt="${item.name}">` : '📦'}
                    </div>
                    <div class="tree-node-info">
                        <div class="tree-node-name">
                            ${isManualMode ? '<span class="manual-badge">💎</span>' : ''}
                            ${node.recipe.name || item.name}
                        </div>
                        ${node.itemInfo ? `<div class="tree-node-via">→ ${node.itemInfo.name}</div>` : ''}
                        <div class="tree-node-meta">
                            <span>⏱ ${formatTime(workloadTime)}</span>
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

export function renderEmptyDetail() {
    const container = document.getElementById('recipe-detail');
    renderStatus(container, '레시피를 선택하여 재료, 생산 시간 및 연관 레시피를 확인하세요.', 'empty', { icon: 'restaurant' });
}

export function renderEmptyChain() {
    const container = document.getElementById('dependency-chain');
    renderStatus(container, '레시피를 선택하면 자동으로 전체 의존성 트리가 표시됩니다.', 'empty', { icon: 'account_tree' });
}

/**
 * Render forest nodes (recursive) for the full forest view
 */
export function renderForestDependencies(nodes, depth = 0) {
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
            const item = node.itemInfo || window.IslandEngine.getItemInfo(node.itemId);
            const costItem = node.shopCost?.itemInfo || window.IslandEngine.getItemInfo(node.shopCost?.itemId);
            return `
                    <div class="forest-tree__node">
                        <div class="forest-tree__content">
                            ${item.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${item.icon.split('/').pop()}.webp" alt="${item.name}" class="forest-tree__icon"/>` : '<span class="forest-tree__icon">•</span>'}
                            <span class="forest-tree__text">${item.name} (×${node.quantity})</span>
                            <span class="forest-tree__cost">— ${costItem?.name || '자원'} ×${node.shopCost?.totalCost?.toFixed?.(1) || '?'}</span>
                        </div>
                    </div>
                `;
        }

        // Raw material / leaf node (no recipe, not a shop purchase)
        if (!node.recipe) {
            const item = node.itemInfo || window.IslandEngine.getItemInfo(node.itemId);
            return `
                    <div class="forest-tree__node">
                        <div class="forest-tree__content">
                            ${item.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${item.icon.split('/').pop()}.webp" alt="${item.name}" class="forest-tree__icon"/>` : '<span class="forest-tree__icon">•</span>'}
                            <span class="forest-tree__text">${item.name} (×${node.quantityNeeded || 1})</span>
                        </div>
                    </div>
                `;
        }

        // Recipe node
        const item = window.IslandEngine.getItemInfo(node.recipe.item_id);
        const chip = `
                    <div class="forest-tree__content" data-action="select-tree-recipe" data-recipe-id="${node.recipe.id}">
                        ${item.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${item.icon.split('/').pop()}.webp" alt="${item.name}" class="forest-tree__icon"/>` : '<span class="forest-tree__icon">•</span>'}
                        <span class="forest-tree__text">${node.recipe.name || item.name}</span>
                        <span class="forest-tree__meta">⏱${formatTime(node.recipe.workload)}</span>
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
export function renderForestTree(recipe, categoryId) {
    const tree = window.IslandEngine.buildRecipeDependencyTree(
        recipe.id,
        state.recipeIndex,
        state.recipeCategoryIndex,
        state.dependencyGraph,
        state.shopPurchaseData,
        { useManualMode: false }
    );

    const stats = calculateTreeStats(tree, 'dependencies');
    const item = window.IslandEngine.getItemInfo(recipe.item_id);

    return `
        <div class="forest-tree-wrapper">
            <details class="forest-tree" open>
                <summary class="forest-root">
                    <div class="forest-root-chip" data-action="select-modal-recipe" data-recipe-id="${recipe.id}">
                        ${item.icon ? `<img src="${DATA_FOR_TOY_BASE}/island/islandprops/${item.icon.split('/').pop()}.webp" alt="${item.name}" />` : '•'}
                        <span class="forest-chip-name">${recipe.name || item.name}</span>
                        <span class="forest-root-meta">
                            ${categoryNames[categoryId] || '카테고리'} · ⏱${formatTime(recipe.workload)} · ⚡${recipe.ship_exp} ·  Dependencies: ${Math.max(stats.count - 1, 0)}
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
