/**
 * Island Restaurant Module - Calculations
 * Handles profit calculations, sales count, cost calculations, and ingredient aggregation
 */

'use strict';

// ============================================
// CONSTANTS
// ============================================

export const RANK_COEFFICIENTS = {
    bronze: 0.9,
    silver: 1.0,
    gold: 1.1,
    diamond: 1.15
};

export const RANK_NAMES = {
    bronze: '브론즈',
    silver: '실버',
    gold: '골드',
    diamond: '다이아몬드'
};

export const ATTRIBUTE_NAMES = [
    '재배',      // 1
    '채집',      // 2
    '사육',      // 3
    '요리',      // 4
    '경영',      // 5
    '제조'       // 6
];

export const ATTRIBUTE_RANK_VALUES = {
    'E': 0.05,
    'D': 0.16,
    'C': 0.30,
    'B': 0.42,
    'A': 0.56,
    'S': 0.72,
    'SS': 0.84,
    'SSS': 1.00
};

// Sales calculation coefficients from game data (divided by 100)
export const SALES_COEFFICIENTS = {
    argA: 0.60,
    argB: 2.40,
    argC: 0,
    saleConst: 1.60
};

export const RANK_RANDOM_RANGES = {
    bronze: { min: -1, max: 0 },
    silver: { min: -1, max: 1 },
    gold: { min: -1, max: 2 },
    diamond: { min: -1, max: 2 }
};

export const RANK_MAX_SALES = {
    bronze: 5,
    silver: 6,
    gold: 6,
    diamond: 6
};

export const EVENT_BONUSES = {
    manjuu_tour: { name: '단체 관광객 만쥬', bonus: 0.10 },
    health_day: { name: '건강의 날', bonus: 0.20 },
    food_review: { name: '메탈 블러드 사절 방문', bonus: 0.30 }
};

// ============================================
// STATE REFERENCE (set via setup)
// ============================================
let state;

export function setup(stateRef) {
    state = stateRef;
}

// ============================================
// PRICE CALCULATION
// ============================================

export function calculateMenuCost(formulaId) {
    if (!formulaId) {
        return { gold: 0, resources: {} };
    }

    // Check cache
    if (state.costCache[formulaId]) {
        return state.costCache[formulaId];
    }

    const tree = window.IslandEngine.buildRecipeDependencyTree(
        formulaId,
        state.recipeIndex,
        state.recipeCategoryIndex,
        state.dependencyGraph,
        state.shopPurchaseData,
        { useManualMode: false, quantityMultiplier: 1 }
    );

    if (!tree) {
        return { gold: 0, resources: {} };
    }

    const costs = window.IslandEngine.calculateTreeCost(tree);

    // Save to cache
    state.costCache[formulaId] = costs;

    return costs;
}

export function calculateProfit(itemId, formulaId, rank = 'silver', events = []) {
    const item = state.items[itemId];
    if (!item) return null;

    const baseSellPrice = item.order_price || 0;
    const costData = calculateMenuCost(formulaId);
    const goldCost = costData.gold || 0;

    const rankCoeff = RANK_COEFFICIENTS[rank] || 1.0;

    let eventBonus = 0;
    events.forEach(eventKey => {
        if (EVENT_BONUSES[eventKey]) {
            eventBonus += EVENT_BONUSES[eventKey].bonus;
        }
    });

    const finalSellPrice = baseSellPrice * (1 + eventBonus);
    const profit = finalSellPrice - goldCost;
    const profitMargin = finalSellPrice > 0 ? (profit / finalSellPrice) * 100 : 0;

    const salesCount = calculateSalesCount(itemId, rank, events);

    return {
        itemId,
        itemName: item.name || `Item ${itemId}`,
        baseSellPrice,
        cost: goldCost,
        costBreakdown: costData,
        rankCoeff,
        eventBonus,
        finalSellPrice: Math.round(finalSellPrice),
        profit: Math.round(profit),
        profitMargin: profitMargin.toFixed(1),
        salesCount: salesCount
    };
}

export function calculateSalesCount(itemId, rank = 'silver', events = []) {
    // Check cache
    const cacheKey = `${itemId}_${rank}`;
    if (state.salesCache[cacheKey]) {
        return state.salesCache[cacheKey];
    }

    const item = state.items[itemId];
    if (!item) return 0;

    const manageInfluence = item.manage_influence || 0;
    const subAttributeId = item.sub_attribute && item.sub_attribute.length > 0 ? item.sub_attribute[0] : 0;
    const subAttributeValue = item.sub_attribute && item.sub_attribute.length > 1 ? item.sub_attribute[1] : 0;

    let eventInfluence = 0;
    events.forEach(eventKey => {
        if (eventKey === 'manjuu_tour') eventInfluence = 0.1;
        else if (eventKey === 'health_day') eventInfluence = 0.2;
        else if (eventKey === 'food_review') eventInfluence = 0.3;
    });

    const rankFactor = RANK_COEFFICIENTS[rank] || 1.0;
    const mainAttrFactor = getMainAttrFactor();
    const subAttrFactor = getSubAttrFactor(subAttributeId);

    const baseCount = Math.floor(
        (manageInfluence / 100 + eventInfluence) *
        (SALES_COEFFICIENTS.argA + mainAttrFactor) *
        (SALES_COEFFICIENTS.argB + subAttrFactor * subAttributeValue / 100) *
        (SALES_COEFFICIENTS.argC + rankFactor) /
        SALES_COEFFICIENTS.saleConst
    );

    const randomRange = RANK_RANDOM_RANGES[rank] || { min: 0, max: 0 };
    const maxSalesCap = RANK_MAX_SALES[rank] || 6;
    const minSales = Math.min(maxSalesCap, Math.max(1, baseCount + randomRange.min));
    const maxSales = Math.min(maxSalesCap, Math.max(1, baseCount + randomRange.max));

    const result = { min: minSales, max: maxSales, base: baseCount };

    // Save to cache
    state.salesCache[cacheKey] = result;

    return result;
}

function getMainAttrFactor() {
    let factor = ATTRIBUTE_RANK_VALUES[state.shipgirl1Attr.main] || 0;
    if (state.selectedRank === 'gold' || state.selectedRank === 'diamond') {
        factor += ATTRIBUTE_RANK_VALUES[state.shipgirl2Attr.main] || 0;
    }
    return factor;
}

function getSubAttrFactor(subAttributeId) {
    if (!subAttributeId || subAttributeId < 1 || subAttributeId > 6) return 0;
    if (subAttributeId === 5) return getMainAttrFactor();

    let factor = ATTRIBUTE_RANK_VALUES[state.shipgirl1Attr[subAttributeId]] || 0;
    if (state.selectedRank === 'gold' || state.selectedRank === 'diamond') {
        factor += ATTRIBUTE_RANK_VALUES[state.shipgirl2Attr[subAttributeId]] || 0;
    }
    return factor;
}

// ============================================
// INGREDIENT AGGREGATION
// ============================================

export function aggregateIngredients(node, resultObj) {
    if (node.isStopNode || node.isShopPurchase) {
        const itemId = node.itemId;
        const itemInfo = node.itemInfo || window.IslandEngine.getItemInfo(itemId) || state.items[itemId] || {};
        const qty = node.quantityNeeded || node.quantity || 0;

        if (!resultObj[itemId]) {
            resultObj[itemId] = {
                id: itemId,
                name: itemInfo.name,
                icon: itemInfo.icon,
                quantity: 0,
                rarity: itemInfo.rarity,
                location: getIngredientLocation(itemId)
            };
        }
        resultObj[itemId].quantity += qty;
        return;
    }

    if (node.dependencies && node.dependencies.length > 0) {
        node.dependencies.forEach(dep => aggregateIngredients(dep, resultObj));
    }
}

export function getIngredientLocation(itemId) {
    const itemInfo = state.items[itemId];
    if (itemInfo && Array.isArray(itemInfo.jump_page) && itemInfo.jump_page.length > 0) {
        const label = itemInfo.jump_page[0] && itemInfo.jump_page[0][0];
        if (label) return label;
    }
    return '기타';
}

export function groupIngredientsByLocation(ingredients) {
    const groups = {};
    Object.values(ingredients).forEach(item => {
        const location = item.location || '기타';
        if (!groups[location]) groups[location] = [];
        groups[location].push(item);
    });

    Object.values(groups).forEach(list => {
        list.sort((a, b) => (parseInt(a.id) || 0) - (parseInt(b.id) || 0));
    });

    return Object.keys(groups).sort().reduce((acc, key) => {
        acc[key] = groups[key];
        return acc;
    }, {});
}
