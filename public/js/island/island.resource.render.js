/**
 * island.resource.render.js
 * Rendering sub-module for the island resource system. Handles all UI output: the filter row,
 * the recipe list, the detail panel (production rails + cost ledger), the 관련있는 조합식 panel, and the
 * recipe forest modal. State is shared via setup() called from island.resource.engine.js.
 *
 * The visual language is a production ledger: chrome is achromatic, game sprites carry the only
 * colour, and grouping is whitespace plus a hairline rule rather than nested boxes. Colour is
 * reserved for two things — season status in the list, and the sign on 순수익 in the ledger.
 * Design doc: dev/active/2026-08-13-island-resource-redesign-design.md
 */

import { formatTime, renderStatus, escapeHtml, createImg, IMG_FALLBACKS, DATA_FOR_TOY_BASE } from '../utils.js';
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

/** Short category labels for the detail meta line — the parenthetical English
 *  is only useful in the dropdown, where you are choosing between them. */
const categoryShortNames = {
    '1': '재배',
    '2': '채집',
    '3': '사육',
    '4': '요리',
    '6': '제조',
    '시즌템': '시즌템'
};

// ===== State Reference (set via setup) =====
let state;

export function setup(stateRef) {
    state = stateRef;
}

// ===== Shared helpers =====

/** The game's own item-slot frames, which is where island rarity is read from
 *  in-game. Same four tiles the 레스토랑 tab uses (island.restaurant.engine.js).
 *  Island rarity only goes 1–4, so there is no gold tier to map. */
const RARITY_FRAMES = {
    1: `${DATA_FOR_TOY_BASE}/island/rarity_grey.webp`,
    2: `${DATA_FOR_TOY_BASE}/island/rarity_blue.webp`,
    3: `${DATA_FOR_TOY_BASE}/island/rarity_purple.webp`,
    4: `${DATA_FOR_TOY_BASE}/island/rarity_orange.webp`
};

/** Sprite for an island item, in its rarity frame. `className` sizes the frame,
 *  not the `<img>` — the sprite fills whatever box the frame is given. Items
 *  without an icon fall back to the shared placeholder rather than an emoji. */
export function itemImg(item, className = '') {
    const src = item?.icon
        ? `${DATA_FOR_TOY_BASE}/island/islandprops/${item.icon.split('/').pop()}.webp`
        : IMG_FALLBACKS.DEFAULT;
    const frame = RARITY_FRAMES[item?.rarity] || RARITY_FRAMES[1];
    const img = createImg(src, item?.name || '', { fallback: IMG_FALLBACKS.DEFAULT });
    return `<span class="item-frame ${className}" style="background-image:url('${frame}')">${img}</span>`;
}

/**
 * Item quantity for a dependency-tree row. A parent needing one pack of a
 * 9-per-craft ingredient works out to 0.2222222222…, so these are capped at four
 * decimals; trailing zeros are dropped so whole counts still print as `×3`.
 */
function qty(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return value;
    return Number(n.toFixed(4)).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** Number formatter for the cost ledger. */
function num(value, digits = 2) {
    return Number(value).toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
    });
}

/**
 * The detail meta line. Each fact is wrapped so the flex gap falls between
 * facts — bare text nodes become their own anonymous flex items, which would
 * put the same gap inside "80 EXP".
 */
function renderFacts(facts, trailingHtml = '') {
    const parts = facts.map(f => `<span>${f}</span>`);
    if (trailingHtml) parts.push(trailingHtml);
    return parts.join('<span class="sep"></span>');
}

/** Section wrapper: a small uppercase label + a rule, the only grouping device. */
function section(title, bodyHtml, extraClass = '') {
    return `
        <section class="recipe-section ${extraClass}">
            <div class="recipe-section-head"><h4>${title}</h4><span class="rule"></span></div>
            ${bodyHtml}
        </section>
    `;
}

// ===== UI Rendering =====

/**
 * Render the filter controls. The container is `display: contents`, so these two
 * children land directly in the layout grid: the category picker sits in the
 * sidebar column (matching the recipe list's width at every breakpoint, for free)
 * and the rest of the controls sit over the detail column.
 */
export function renderCategoryFilter() {
    const container = document.getElementById('resource-category-filter');
    if (!container) return;

    const pos = state.linksPosition === 'pinned' ? 'pinned' : 'inline';
    const posButton = (value, icon, label, title) => `
        <button type="button"
                class="btn btn-outline btn-sm ${pos === value ? 'is-active' : ''}"
                data-links-position="${value}"
                aria-pressed="${pos === value}"
                title="${title}">
            <span class="material-symbols-outlined">${icon}</span>${label}
        </button>
    `;

    container.innerHTML = `
        <div class="filter-field filter-category">
            <select id="recipe-category-select" class="category-select" aria-label="카테고리">
                ${Object.entries(categoryNames).map(([id, name]) => `
                    <option value="${id}" ${id === state.selectedCategory ? 'selected' : ''}>${escapeHtml(name)}</option>
                `).join('')}
            </select>
            <span class="material-symbols-outlined filter-field-icon">expand_more</span>
        </div>
        <div class="resource-filter-controls">
            <div class="filter-field grow">
                <input type="text"
                       id="recipe-search"
                       class="search-input"
                       placeholder="레시피 검색"
                       autocomplete="off">
                <span class="material-symbols-outlined filter-field-icon">search</span>
            </div>
            <div class="resource-filter-tools">
                <button id="recipe-forest-btn" class="btn btn-outline btn-sm tree-btn" type="button">
                    <span class="material-symbols-outlined">account_tree</span>
                    전체 트리
                </button>
                <div class="btn-group links-position-toggle" id="links-position-toggle" role="group" aria-label="관련있는 조합식 위치">
                    ${posButton('inline', 'view_agenda', '본문', '관련있는 조합식을 본문 아래에 이어서 표시')}
                    ${posButton('pinned', 'view_sidebar', '오른쪽', '관련있는 조합식을 오른쪽 열에 고정')}
                </div>
            </div>
        </div>
    `;
}

/** Render the recipe rows for the currently selected category, filtered by search query. */
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

    container.innerHTML = filteredRecipes.map(recipe => {
        const item = window.IslandEngine.getItemInfo(recipe.item_id);
        const isSelected = state.selectedRecipe?.id === recipe.id;
        const seasonBadge = renderSeasonBadge(recipe.item_id);

        // The name owns its own line: at sidebar width it was competing with two
        // number columns and truncating on anything longer than three syllables.
        return `
            <div class="recipe-card ${isSelected ? 'active' : ''}" data-recipe-id="${recipe.id}">
                ${itemImg(item, 'recipe-icon')}
                <span class="recipe-name">${escapeHtml(recipe.name || item.name)}</span>
                <span class="recipe-meta">
                    ${recipe.workload > 0 ? `
                        <span class="recipe-stat">
                            <span class="material-symbols-outlined">schedule</span>${formatTime(recipe.workload)}
                        </span>
                    ` : ''}
                    ${recipe.stamina_cost > 0 ? `
                        <span class="recipe-stat">
                            <span class="material-symbols-outlined">bolt</span>${recipe.stamina_cost}
                        </span>
                    ` : ''}
                    ${seasonBadge || ''}
                </span>
            </div>
        `;
    }).join('');
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
    const { item } = data;
    const restaurants = window.RestaurantModule ? window.RestaurantModule.getRestaurantsForRecipe(recipe.id) : [];
    const seasonBadge = renderSeasonBadge(recipe.item_id);

    // One meta line replaces five badges that carried four numbers plus the
    // category the dropdown already shows.
    const facts = [
        categoryShortNames[state.selectedCategory],
        Number.isFinite(recipe.ship_exp) ? `<b>${recipe.ship_exp}</b> EXP` : '',
        Number.isFinite(recipe.stamina_cost) ? `<b>${recipe.stamina_cost}</b> 스태미나` : '',
        Number.isFinite(item.pt_num) ? `<b>${item.pt_num}</b> pt` : ''
    ].filter(Boolean);

    return `
        <header class="recipe-detail-header">
            ${itemImg(item, 'recipe-art')}
            <div class="recipe-headline">
                <h3 class="recipe-title">${escapeHtml(recipe.name || item.name)}</h3>
                <p class="recipe-facts">${renderFacts(facts, seasonBadge)}</p>
            </div>
            ${restaurants.length > 0 ? `
                <div class="recipe-header-actions">
                    <button class="action-btn" data-action="view-in-restaurant" data-recipe-id="${recipe.id}">
                        <span class="material-symbols-outlined">restaurant</span>
                        레스토랑에서 보기
                    </button>
                </div>
            ` : ''}
        </header>
    `;
}

/**
 * One side of a rail: the sprites and quantities a recipe consumes or produces.
 * `materials` is the raw `[[itemId, quantity], …]` shape; an empty side (채집
 * recipes consume nothing) holds the column rather than collapsing the grid.
 */
function renderRailNode(materials, isOutput) {
    if (!materials || materials.length === 0) {
        return `<div class="recipe-node is-empty">—</div>`;
    }

    const items = materials.map(([itemId, quantity]) => {
        const item = window.IslandEngine.getItemInfo(itemId);
        return `
            <div class="recipe-node-item">
                ${itemImg(item)}
                <div class="recipe-node-stack">
                    <div class="recipe-node-qty">×${quantity}</div>
                    <div class="recipe-node-name">${escapeHtml(item.name)}</div>
                </div>
            </div>
        `;
    }).join('');

    return `<div class="recipe-node ${isOutput ? 'out' : ''}">${items}</div>`;
}

/** A single input → output rail. `tag` is null when there is no second mode to contrast it with. */
function renderRail(tag, inputs, outputs, time, repeats) {
    return `
        <div class="recipe-rail">
            ${tag ? `<span class="recipe-rail-tag">${tag}</span>` : ''}
            ${renderRailNode(inputs, false)}
            <div class="recipe-wire">
                <span class="recipe-wire-badge">
                    <b>${time}</b>${repeats ? `<span class="dotsep"></span>×${repeats}` : ''}
                </span>
            </div>
            ${renderRailNode(outputs, true)}
        </div>
    `;
}

/**
 * The 생산 section. Both production modes are always visible, stacked, sharing
 * one grid so their columns line up — `.recipe-rails` owns the grid and each
 * rail is `display: contents`. Only 재배 has two modes; every other category
 * renders the single rail it actually has, without a mode tag.
 */
export function renderProductionSection(recipe, data) {
    const { isCategory1, isCategory2, isCategory3 } = data;
    const manualTime = formatTime(recipe.workload * CONSTANTS.MANUAL_TIME_MULTIPLIER);
    const autoRail = {
        tag: '자동 위임',
        inputs: recipe.commission_cost,
        outputs: recipe.commission_product,
        time: formatTime(recipe.workload),
        repeats: recipe.production_limit
    };

    let manualRail = null;
    if ((isCategory1 || isCategory3) && recipe.cost?.length) {
        manualRail = {
            tag: isCategory3 ? '수동 사육' : '수동 생산',
            inputs: recipe.cost,
            outputs: recipe.drop_display || recipe.commission_product,
            time: manualTime,
            repeats: null
        };
    } else if (isCategory2 && recipe.drop_display?.length) {
        manualRail = {
            tag: '수동 채집',
            inputs: null,
            outputs: recipe.drop_display,
            time: formatTime(recipe.workload),
            repeats: null
        };
    } else if (!isCategory1 && !isCategory2 && recipe.drop_display?.length) {
        manualRail = {
            tag: '수동 채집',
            inputs: null,
            outputs: recipe.drop_display,
            time: manualTime,
            repeats: null
        };
    }

    // 채집 has no delegated rail of its own — the manual one is the whole story.
    const rails = isCategory2 && manualRail ? [manualRail] : [autoRail, manualRail].filter(Boolean);
    const isSingle = rails.length === 1;

    const body = `
        <div class="recipe-rails ${isSingle ? 'is-single' : ''}">
            ${rails.map(r => renderRail(isSingle ? null : r.tag, r.inputs, r.outputs, r.time, r.repeats)).join('')}
        </div>
    `;

    return section('생산', body);
}

/**
 * The 비용 section: rows are the metric, columns are the production mode.
 * Only 재배 has two modes to compare; every other category gets one value
 * column. 순수익 moves to the footer, which is where the only coloured figures
 * on this screen live.
 */
export function renderCostSummary(recipe, data) {
    const {
        showDualCost,
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

    // Column order matches the rails above: 수동 first, then 자동.
    const dual = showDualCost && manualGoldConsumption.gold > 0;
    const columns = dual
        ? ['수동 생산', '자동 위임']
        : [isCategory2 ? '채집 기준' : '자동 위임'];

    const pick = (manual, auto) => (dual ? [manual, auto] : [auto]);
    const signed = (value, unit) =>
        `<span class="${value >= 0 ? 'is-positive' : 'is-negative'}">${value >= 0 ? '+' : ''}${num(value)} ${unit}</span>`;

    // 개발 자금 rows are marked so a gold figure is identifiable without reading
    // the unit — every other row on this table is pt or a raw material count.
    const gold = (label) =>
        `<span class="material-symbols-outlined ledger-icon">money_bag</span>${label}`;

    const rows = [];
    if (goldConsumption.gold > 0 || manualGoldConsumption.gold > 0) {
        rows.push([gold('총 생산단가'), pick(
            `${manualGoldConsumption.gold.toLocaleString()} G`,
            `${goldConsumption.gold.toLocaleString()} G`
        )]);
        rows.push([
            gold(dual ? '개당 생산단가' : `개당 생산단가 (×${outputQuantity}개 생산)`),
            pick(`${num(costPerItemManual, 1)} G/ea`, `${num(costPerItemAuto, 1)} G/ea`)
        ]);
        rows.push([gold('시간당 생산단가'), pick(
            `${num(costPerHourManual, 1)} G/hr`,
            `${num(costPerHourAuto, 1)} G/hr`
        )]);
    }

    if (seasonPointsConsumption > 0 || manualSeasonPointsConsumption > 0) {
        rows.push(['재료들의 pt값', pick(`${num(ptPerItemManual)} pt`, `${num(ptPerItemAuto)} pt`)]);
        rows.push(['현재 레시피의 pt이득', pick(
            `${num(currentRecipeGainPerItemManual)} pt`,
            `${num(currentRecipeGainPerItemAuto)} pt`
        )]);
        rows.push(['현재 레시피 pt이득/분', pick(
            `${num(currentRecipeGainPerMinManual)} pt/min`,
            `${num(currentRecipeGainPerMinAuto)} pt/min`
        )]);
    }

    const footRows = [];
    if (netGainPerItemAuto !== 0 || netGainPerItemManual !== 0) {
        footRows.push(['총 순수익 pt', pick(
            signed(netGainPerItemManual, 'pt'),
            signed(netGainPerItemAuto, 'pt')
        )]);
        footRows.push(['총 순수익 pt/분', pick(
            signed(netGainPerMinManual, 'pt/min'),
            signed(netGainPerMinAuto, 'pt/min')
        )]);
    }

    // Extra shop materials the tree consumes, appended to the same table so
    // there is one place to read costs rather than a second bordered block.
    const extras = Object.entries(goldConsumption.resources);
    const extraRows = extras.length > 0
        ? `
            <tr class="ledger-group"><th scope="row" colspan="${columns.length + 1}">기타 재료</th></tr>
            ${extras.map(([, resource]) => `
                <tr>
                    <th scope="row">${escapeHtml(resource.name)}</th>
                    <td class="is-muted" ${columns.length > 1 ? `colspan="${columns.length}"` : ''}>×${resource.amount.toLocaleString()}</td>
                </tr>
            `).join('')}
        `
        : '';

    if (rows.length === 0 && footRows.length === 0 && !extraRows) return '';

    const cells = (values) => values.map(v => `<td>${v}</td>`).join('');

    const body = `
        <div class="recipe-ledger-wrap scroll-styled">
            <table class="recipe-ledger">
                <thead>
                    <tr>
                        <th scope="col">항목</th>
                        ${columns.map(c => `<th scope="col">${c}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(([label, values]) => `
                        <tr><th scope="row">${label}</th>${cells(values)}</tr>
                    `).join('')}
                    ${extraRows}
                </tbody>
                ${footRows.length > 0 ? `
                    <tfoot>
                        ${footRows.map(([label, values]) => `
                            <tr><th scope="row">${label}</th>${cells(values)}</tr>
                        `).join('')}
                    </tfoot>
                ` : ''}
            </table>
        </div>
    `;

    return section('비용', body);
}

export function renderRecipeActions(recipe, data) {
    const { producedByRecipes, usedInRecipes } = data;
    return `
        <div class="recipe-actions">
            <button class="action-btn" type="button" data-action="show-upstream" data-recipe-id="${recipe.id}">
                <span class="material-symbols-outlined">arrow_upward</span>
                하위 조합 전체 보기 <span class="count">${producedByRecipes.length}</span>
            </button>
            <button class="action-btn" type="button" data-action="show-downstream" data-recipe-id="${recipe.id}">
                <span class="material-symbols-outlined">arrow_downward</span>
                상위 조합 전체 보기 <span class="count">${usedInRecipes.length}</span>
            </button>
        </div>
    `;
}

function recipeDetailHtml(recipe) {
    const data = gatherRecipeData(recipe);
    return `
        ${renderRecipeHeader(recipe, data)}
        ${renderProductionSection(recipe, data)}
        ${renderCostSummary(recipe, data)}
        ${renderRecipeActions(recipe, data)}
    `;
}

export function renderRecipeDetail(recipe) {
    const container = document.getElementById('recipe-detail');
    if (!container) return;

    // Synthetic seasonal shop/pickup entries have no recipe of their own.
    if (recipe._isSeasonalView && recipe.id.toString().startsWith('seasonal_')) {
        renderSeasonalItemDetail(recipe, container);
        renderSeasonalDependencyTree(recipe);
        return;
    }

    container.innerHTML = recipeDetailHtml(recipe);
    renderDependencyTree(recipe);
}

/**
 * 시즌템 entries are synthetic: a seasonal item with no recipe of its own, so
 * there are no rails and no ledger — just where it comes from and what makes it.
 */
export function renderSeasonalItemDetail(recipe, container) {
    const itemId = recipe._seasonalItemId || recipe.item_id;
    const item = window.IslandEngine.getItemInfo(itemId);
    const allRecipeIds = recipe._allRecipes || [];
    const seasonBadge = renderSeasonBadge(itemId);

    const sources = [];
    if (recipe._isPickup) {
        sources.push({ icon: 'hiking', text: '채집템 — 맵에서 채집' });
    }
    if (recipe._isShop) {
        const shopData = state.shopPurchaseData[itemId];
        if (shopData) {
            const [requiredItemId, cost, packSize] = shopData;
            const costItem = window.IslandEngine.getItemInfo(requiredItemId);
            sources.push({
                icon: 'store',
                text: `상점 구매 — ${cost} ${costItem.name} (${packSize}개 팩)`
            });
        }
    }
    if (allRecipeIds.length > 0) {
        sources.push({ icon: 'restaurant', text: `제작 가능 — ${allRecipeIds.length}개 레시피` });
    }

    const sourcesHtml = sources.length > 0
        ? sources.map(s => `
            <div class="seasonal-source">
                <span class="material-symbols-outlined">${s.icon}</span>
                <span>${escapeHtml(s.text)}</span>
            </div>
        `).join('')
        : '<p class="chain-empty">획득 방법이 확인되지 않았습니다.</p>';

    const recipeRows = allRecipeIds.map(recipeId => {
        const originalRecipe = findRecipeById(recipeId);
        if (!originalRecipe) return '';
        const recipeItem = window.IslandEngine.getItemInfo(originalRecipe.item_id);
        const categoryId = findRecipeCategoryById(recipeId);
        return chainLink({
            item: recipeItem,
            name: originalRecipe.name || recipeItem.name,
            recipeId,
            chip: categoryShortNames[categoryId] || '',
            right: formatTime(originalRecipe.workload)
        });
    }).join('');

    container.innerHTML = `
        <header class="recipe-detail-header">
            ${itemImg(item, 'recipe-art')}
            <div class="recipe-headline">
                <h3 class="recipe-title">${escapeHtml(item.name)}</h3>
                <p class="recipe-facts">${renderFacts(
                    ['시즌템', Number.isFinite(item.pt_num) ? `<b>${item.pt_num}</b> pt` : ''].filter(Boolean),
                    seasonBadge
                )}</p>
                ${item.desc ? `<p class="item-description">${escapeHtml(item.desc)}</p>` : ''}
            </div>
        </header>
        ${section('획득 방법', sourcesHtml)}
        ${allRecipeIds.length > 0 ? section('제작 레시피', recipeRows) : ''}
    `;
}

// ===== 관련있는 조합식 (dependency chain) =====

/** Panel shell — the same section head in both placements. */
function chainShell(bodyHtml) {
    return `
        <section class="recipe-section chain-section">
            <div class="recipe-section-head"><h4>관련있는 조합식</h4><span class="rule"></span></div>
            ${bodyHtml}
        </section>
    `;
}

function chainGroupHead(icon, label, count) {
    return `
        <div class="chain-group-head">
            <span class="material-symbols-outlined">${icon}</span>
            ${label}
            <span class="count">${count}</span>
        </div>
    `;
}

/**
 * One row in the 관련있는 조합식 panel. `via` is the item that connects this recipe to the
 * selected one and renders as "→ item"; `sub` is free text on the same second
 * line (a shop price). `chip` and `right` carry whatever the row's kind makes
 * useful — a 상점 tag, a category, a production time.
 */
function chainLink({ item, name, recipeId, via, sub, chip, right, nested }) {
    const classes = ['chain-link', nested ? 'is-nested' : ''].filter(Boolean).join(' ');
    const action = recipeId != null
        ? ` data-action="select-tree-recipe" data-recipe-id="${recipeId}"`
        : '';
    const second = via ? `→ ${escapeHtml(via)}` : (sub ? escapeHtml(sub) : '');

    return `
        <div class="${classes}"${action}>
            ${itemImg(item)}
            <span class="chain-link-text">
                <span class="chain-link-name">${escapeHtml(name)}</span>
                ${second ? `<span class="chain-link-to">${second}</span>` : ''}
            </span>
            <span class="chain-link-rt">
                ${chip ? `<span class="chain-chip">${escapeHtml(chip)}</span>` : ''}
                ${right ? `<span>${escapeHtml(right)}</span>` : ''}
            </span>
        </div>
    `;
}

/**
 * Flatten a dependency subtree into rows. Indent is capped at one level: deeper
 * trees would run out of room in the pinned column, and every row already
 * states what it feeds via `→ item`.
 */
export function renderChainLinks(nodes, depth = 0) {
    if (!nodes || nodes.length === 0) return '';

    return nodes.map(node => {
        if (node.isShopPurchase) {
            const shopCost = node.shopCost;
            const costItem = shopCost.itemInfo;
            const perItem = shopCost.packSize > 1 ? shopCost.costPerItem.toFixed(1) : shopCost.unitCost;
            return chainLink({
                item: node.itemInfo,
                name: `${node.itemInfo.name} ×${qty(node.quantity)}`,
                sub: `${perItem} ${costItem.name}/ea → ${shopCost.totalCost.toFixed(1)}`,
                chip: '상점',
                nested: depth > 0
            });
        }

        if (!node.recipe) return '';

        const item = window.IslandEngine.getItemInfo(node.recipe.item_id);
        const children = node.dependencies || node.usages || [];
        const workload = node.isManualMode
            ? node.recipe.workload * CONSTANTS.MANUAL_TIME_MULTIPLIER
            : node.recipe.workload;

        return chainLink({
            item,
            name: node.recipe.name || item.name,
            recipeId: node.recipe.id,
            via: node.itemInfo?.name,
            chip: node.isManualMode ? '수동' : '',
            right: formatTime(workload),
            nested: depth > 0
        }) + renderChainLinks(children, depth + 1);
    }).join('');
}

/**
 * Render the 관련있는 조합식 panel for the selected recipe. Upstream uses the manual-mode
 * tree so category 1's manual requirements show.
 */
export function renderDependencyTree(recipe) {
    const container = document.getElementById('dependency-chain');
    if (!container) return;

    if (!recipe) {
        renderEmptyChain();
        return;
    }

    const upstreamTree = window.IslandEngine.buildRecipeDependencyTree(
        recipe.id,
        state.recipeIndex,
        state.recipeCategoryIndex,
        state.dependencyGraph,
        state.shopPurchaseData,
        { useManualMode: true }
    );
    const downstreamTree = buildDownstreamTree(recipe.id);

    const upstreamCount = Math.max(calculateTreeStats(upstreamTree, 'dependencies').count - 1, 0);
    const downstreamCount = Math.max(calculateTreeStats(downstreamTree, 'usages').count - 1, 0);

    const upstream = upstreamTree.dependencies?.length
        ? chainGroupHead('arrow_upward', '하위 조합 (수동)', upstreamCount) + renderChainLinks(upstreamTree.dependencies)
        : '';
    const downstream = downstreamTree.usages?.length
        ? chainGroupHead('arrow_downward', '상위 조합', downstreamCount) + renderChainLinks(downstreamTree.usages)
        : '';

    const body = upstream || downstream
        ? upstream + downstream
        : '<p class="chain-empty">연결된 레시피가 없습니다.</p>';

    container.innerHTML = chainShell(body);
}

/** 관련있는 조합식 panel for a synthetic 시즌템 entry: which recipes make it, which use it. */
export function renderSeasonalDependencyTree(recipe) {
    const container = document.getElementById('dependency-chain');
    if (!container) return;

    const itemId = recipe._seasonalItemId || recipe.item_id;
    const producedByRecipes = state.dependencyGraph.producedBy[itemId] || [];
    const usedInRecipes = state.dependencyGraph.usedBy[itemId] || [];

    const rows = (recipeIds) => recipeIds.map(recipeId => {
        const related = findRecipeById(recipeId);
        if (!related) return '';
        const relatedItem = window.IslandEngine.getItemInfo(related.item_id);
        const categoryId = findRecipeCategoryById(recipeId);
        return chainLink({
            item: relatedItem,
            name: related.name || relatedItem.name,
            recipeId,
            chip: categoryShortNames[categoryId] || '',
            right: formatTime(related.workload)
        });
    }).join('');

    const produced = producedByRecipes.length
        ? chainGroupHead('arrow_upward', '이 아이템을 생산', producedByRecipes.length) + rows(producedByRecipes)
        : '';
    const used = usedInRecipes.length
        ? chainGroupHead('arrow_downward', '이 아이템을 사용', usedInRecipes.length) + rows(usedInRecipes)
        : '';

    const body = produced || used
        ? produced + used
        : '<p class="chain-empty">이 아이템과 연결된 레시피가 없습니다.</p>';

    container.innerHTML = chainShell(body);
}

export function renderEmptyDetail() {
    const container = document.getElementById('recipe-detail');
    renderStatus(container, '레시피를 선택하여 재료, 생산 시간 및 연관 레시피를 확인하세요.', 'empty', { icon: 'restaurant' });
}

export function renderEmptyChain() {
    const container = document.getElementById('dependency-chain');
    if (!container) return;
    container.innerHTML = chainShell('<p class="chain-empty">레시피를 선택하면 연결된 상위/하위 레시피가 표시됩니다.</p>');
}

// ===== 전체 레시피 트리 (forest modal) =====

/** One forest node: sprite, name, and whatever figure that kind of node carries. */
function forestNode(item, text, trailing, action) {
    return `
        <div class="forest-tree__content"${action || ''}>
            ${itemImg(item, 'forest-tree__icon')}
            <span class="forest-tree__text">${escapeHtml(text)}</span>
            ${trailing || ''}
        </div>
    `;
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
        // Shop purchases become leaves with cost info
        if (node.isShopPurchase) {
            const item = node.itemInfo || window.IslandEngine.getItemInfo(node.itemId);
            const costItem = node.shopCost?.itemInfo || window.IslandEngine.getItemInfo(node.shopCost?.itemId);
            const cost = `<span class="forest-tree__cost">${escapeHtml(costItem?.name || '자원')} ×${node.shopCost?.totalCost?.toFixed?.(1) || '?'}</span>`;
            return `<div class="forest-tree__node">${forestNode(item, `${item.name} ×${qty(node.quantity)}`, cost)}</div>`;
        }

        // Raw material / leaf node (no recipe, not a shop purchase)
        if (!node.recipe) {
            const item = node.itemInfo || window.IslandEngine.getItemInfo(node.itemId);
            return `<div class="forest-tree__node">${forestNode(item, `${item.name} ×${qty(node.quantityNeeded || 1)}`)}</div>`;
        }

        // Recipe node
        const item = window.IslandEngine.getItemInfo(node.recipe.item_id);
        const meta = `<span class="forest-tree__meta">${formatTime(node.recipe.workload)}</span>`;
        const action = ` data-action="select-tree-recipe" data-recipe-id="${node.recipe.id}"`;
        const children = node.dependencies?.length
            ? renderForestDependencies(node.dependencies, depth + 1)
            : '';

        return `
                    <div class="forest-tree__node">
                        ${forestNode(item, node.recipe.name || item.name, meta, action)}
                        ${children}
                    </div>
                `;
    }).join('')}
        </div>
    `;
}

/**
 * Render a single tree in the forest (rooted at a recipe). The category is
 * named by the section this tree sits in, so the root row omits it.
 */
export function renderForestTree(recipe) {
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
                        ${itemImg(item)}
                        <span class="forest-chip-name">${escapeHtml(recipe.name || item.name)}</span>
                        <span class="forest-root-meta">
                            ${formatTime(recipe.workload)} · ${recipe.ship_exp} EXP · 재료 ${Math.max(stats.count - 1, 0)}
                        </span>
                    </div>
                </summary>
                <div class="forest-tree-body">
                    ${tree && tree.dependencies?.length
            ? renderForestDependencies(tree.dependencies)
            : '<div class="forest-tree__group"><div class="forest-tree__node"><div class="forest-tree__content"><span class="forest-tree__text">입력 없음</span></div></div></div>'}
                </div>
            </details>
        </div>
    `;
}
