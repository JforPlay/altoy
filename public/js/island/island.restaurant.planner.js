/**
 * Island Restaurant Module - Meal Planner
 * Handles planner UI, presets, menu selection modals, and results rendering
 */

import { showElement, hideElement, getStorageItem, setStorageItem } from '../utils.js';
import {
    aggregateIngredients,
    groupIngredientsByLocation
} from './island.restaurant.calc.js';

'use strict';

// ============================================
// CONSTANTS
// ============================================

const STORAGE_KEY_PLANNER_PLAN = 'island-restaurant-planner-plan-v2';
const STORAGE_KEY_PLANNER_PRESETS = 'island-restaurant-planner-presets-v2';

const PLANNER_SLOTS_PER_RESTAURANT = 4;
const PLANNER_PRESET_COUNT = 5;

const RARITY_BACKGROUNDS = {
    1: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/rarity_gray.png',
    2: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/rarity_blue.png',
    3: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/rarity_purple.png',
    4: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/rarity_orange.png'
};

// ============================================
// STATE REFERENCE (set via setup)
// ============================================
let state;

export function setup(stateRef) {
    state = stateRef;
}

// ============================================
// HELPER: GET RESTAURANT IDS
// ============================================

function getRestaurantIds() {
    return Object.keys(state.restaurants)
        .filter(id => id !== 'all')
        .sort((a, b) => parseInt(a) - parseInt(b));
}

// ============================================
// PLANNER STATE HELPERS
// ============================================

function buildEmptyPlannerEntry() {
    return {
        globalCount: 1,
        slots: Array.from({ length: PLANNER_SLOTS_PER_RESTAURANT }, () => ({ formulaId: '' }))
    };
}

function normalizePlannerEntry(entry) {
    const base = buildEmptyPlannerEntry();
    if (!entry) return base;

    const normalized = {
        globalCount: Number.isFinite(entry.globalCount) ? entry.globalCount : base.globalCount,
        slots: Array.from({ length: PLANNER_SLOTS_PER_RESTAURANT }, (_, idx) => {
            const slot = entry.slots && entry.slots[idx] ? entry.slots[idx] : {};
            return {
                formulaId: slot.formulaId || ''
            };
        })
    };

    return normalized;
}

function createDefaultPlannerPlan() {
    const plan = {};
    getRestaurantIds().forEach(id => {
        plan[id] = buildEmptyPlannerEntry();
    });
    return plan;
}

function createDefaultPlannerPresets() {
    const presets = {};
    getRestaurantIds().forEach(id => {
        presets[id] = {};
    });
    return presets;
}

export function loadPlannerState() {
    state.plannerPlan = createDefaultPlannerPlan();
    state.plannerPresets = createDefaultPlannerPresets();

    try {
        const savedPlan = getStorageItem(STORAGE_KEY_PLANNER_PLAN, null);
        if (savedPlan) {
            const parsed = JSON.parse(savedPlan);
            getRestaurantIds().forEach(id => {
                state.plannerPlan[id] = normalizePlannerEntry(parsed[id]);
            });
        }

        const savedPresets = getStorageItem(STORAGE_KEY_PLANNER_PRESETS, null);
        if (savedPresets) {
            const parsed = JSON.parse(savedPresets);
            getRestaurantIds().forEach(id => {
                state.plannerPresets[id] = {};
                if (parsed[id]) {
                    for (let i = 1; i <= PLANNER_PRESET_COUNT; i++) {
                        if (parsed[id][i]) {
                            state.plannerPresets[id][i] = normalizePlannerEntry(parsed[id][i]);
                        }
                    }
                }
            });
        }
    } catch (error) {
        console.error('[Restaurant] Failed to load planner state:', error);
    }
}

function savePlannerPlan() {
    try {
        setStorageItem(STORAGE_KEY_PLANNER_PLAN, JSON.stringify(state.plannerPlan));
    } catch (error) {
        console.error('[Restaurant] Failed to save planner plan:', error);
    }
}

function savePlannerPresets() {
    try {
        setStorageItem(STORAGE_KEY_PLANNER_PRESETS, JSON.stringify(state.plannerPresets));
    } catch (error) {
        console.error('[Restaurant] Failed to save planner presets:', error);
    }
}

function getPlannerEntry(restaurantId) {
    if (!state.plannerPlan[restaurantId]) {
        state.plannerPlan[restaurantId] = buildEmptyPlannerEntry();
    }
    return state.plannerPlan[restaurantId];
}

// ============================================
// PLANNER LOGIC
// ============================================
/**
 * Planner System Overview:
 * - Each restaurant has 4 menu slots that can be filled with recipes
 * - Each restaurant has a global quantity multiplier (applies to all slots)
 * - Users can save/load up to 5 presets per restaurant
 * - Real-time calculation shows required ingredients as users make selections
 * - Ingredients are grouped by acquisition location for easy reference
 */

let confirmResolve = null;

export function setupPlannerUI() {
    const openBtn = document.getElementById('planner-open-btn');
    const closeBtn = document.getElementById('planner-modal-close');
    const modal = document.getElementById('planner-modal');

    if (openBtn) openBtn.addEventListener('click', openPlannerModal);
    if (closeBtn) closeBtn.addEventListener('click', closePlannerModal);

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.classList.contains('modal-overlay')) {
                closePlannerModal();
            }
        });
    }

    setupConfirmModal();
}

function setupConfirmModal() {
    const confirmModal = document.getElementById('confirm-modal');
    const confirmClose = document.getElementById('confirm-modal-close');
    const confirmCancel = document.getElementById('confirm-btn-cancel');
    const confirmOk = document.getElementById('confirm-btn-ok');

    if (confirmModal) {
        const closeConfirm = (result) => {
            hideElement(confirmModal);
            if (confirmResolve) {
                confirmResolve(result);
                confirmResolve = null;
            }
        };

        confirmClose?.addEventListener('click', () => closeConfirm(false));
        confirmCancel?.addEventListener('click', () => closeConfirm(false));
        confirmOk?.addEventListener('click', () => closeConfirm(true));

        confirmModal.addEventListener('click', (e) => {
            if (e.target === confirmModal || e.target.classList.contains('modal-overlay')) {
                closeConfirm(false);
            }
        });
    }
}

function openPlannerModal() {
    renderPlannerModal();
    showElement('planner-modal');
}

function renderPlannerModal() {
    const content = document.getElementById('planner-modal-content');
    if (!content) return;

    const builderHTML = renderPlannerBuilder();
    const resultsHTML = renderPlannerResultsContent();

    content.innerHTML = `
        <div class="planner-modal-body">
            <div class="planner-builder" id="planner-builder">
                ${builderHTML}
            </div>
            <div class="planner-results" id="planner-results">
                ${resultsHTML}
            </div>
        </div>
        <div class="planner-modal-actions">
            <button id="planner-reset-btn" class="planner-btn reset">
                <span class="material-symbols-outlined">restart_alt</span>
                초기화
            </button>
            <div class="planner-actions-spacer"></div>
            <button id="planner-calc-btn" class="planner-btn calculate">
                <span class="material-symbols-outlined">calculate</span>
                재료 계산
            </button>
        </div>
    `;

    bindPlannerBuilderEvents();

    const resetBtn = document.getElementById('planner-reset-btn');
    const calcBtn = document.getElementById('planner-calc-btn');

    resetBtn?.addEventListener('click', resetPlanner);
    calcBtn?.addEventListener('click', calculateDailyPlan);
}

export function renderPlannerMainView() {
    const container = document.getElementById('restaurant-planner-view');
    if (!container) return;

    const builderHTML = renderPlannerBuilder();
    const resultsHTML = renderPlannerResultsContent();

    container.innerHTML = `
        <div class="planner-layout-grid">
            <!-- Left: Builder (Restaurant Rows) -->
            <div class="planner-builder-section" id="planner-builder">
                ${builderHTML}
                <div class="planner-actions-bar">
                    <button id="planner-reset-btn" class="planner-btn reset">
                        <span class="material-symbols-outlined">restart_alt</span>
                        초기화
                    </button>
                </div>
            </div>

            <!-- Right: Results (Ingredients) -->
            <div class="planner-results-section" id="planner-results">
                ${resultsHTML}
            </div>
        </div>
    `;

    bindPlannerBuilderEvents();

    document.getElementById('planner-reset-btn')?.addEventListener('click', resetPlanner);

    // Initial auto-calculation
    calculateDailyPlan(false);
}

function refreshPlannerBuilder() {
    const builder = document.getElementById('planner-builder');
    if (!builder) return;
    builder.innerHTML = renderPlannerBuilder();
    bindPlannerBuilderEvents();
}

function renderPlannerBuilder() {
    const restaurantIds = getRestaurantIds();
    if (restaurantIds.length === 0) {
        return '<div class="empty-state"><p>레스토랑 데이터가 없습니다.</p></div>';
    }

    return restaurantIds.map(renderPlannerRestaurantCard).join('');
}

/**
 * Renders a single restaurant card in the planner view
 * @param {string} restaurantId - The ID of the restaurant to render
 * @returns {string} HTML string for the restaurant card
 */
function renderPlannerRestaurantCard(restaurantId) {
    const restaurant = state.restaurants[restaurantId];
    const plan = getPlannerEntry(restaurantId);
    const menuOptions = getMenuOptions(restaurantId);
    const menuOptionsMap = new Map(menuOptions.map(opt => [String(opt.formulaId), opt.icon]));

    // Ensure UI state for preset selection (defaults to slot 1)
    if (!state.ui) state.ui = { presetSelections: {} };
    if (!state.ui.presetSelections[restaurantId]) state.ui.presetSelections[restaurantId] = 1;
    const selectedPreset = state.ui.presetSelections[restaurantId];

    const presetVisuals = Array.from({ length: PLANNER_PRESET_COUNT }, (_, idx) => {
        const presetIndex = idx + 1;
        const presetData = state.plannerPresets[restaurantId] && state.plannerPresets[restaurantId][presetIndex];
        const isSelected = presetIndex === selectedPreset;
        const hasData = !!presetData;

        const icons = presetData ? presetData.slots.map(s => {
            if (!s.formulaId) return null;
            return menuOptionsMap.get(String(s.formulaId));
        }).filter(Boolean) : [];

        const iconsHtml = icons.length > 0
            ? `<div class="preset-mini-grid">${icons.slice(0, 4).map(icon => `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/islandprops/${icon}">`).join('')}</div>`
            : `<div class="preset-empty-dash">-</div>`;

        return `
            <div class="preset-visual-slot ${isSelected ? 'selected' : ''} ${hasData ? 'filled' : 'empty'}"
                 onclick="RestaurantModule.selectPresetSlot('${restaurantId}', ${presetIndex})">
                <div class="preset-slot-num">${presetIndex}</div>
                ${iconsHtml}
            </div>
        `;
    }).join('');

    const slotsHTML = plan.slots.map((slot, idx) => renderPlannerSlot(restaurantId, idx, slot, menuOptions)).join('');

    return `
        <div class="planner-modern-card">
            <div class="card-header">
                <div class="header-left">
                    <span class="material-symbols-outlined icon">storefront</span>
                    <span class="restaurant-name">${restaurant ? restaurant.name : `레스토랑 ${restaurantId}`}</span>
                </div>
                <div class="header-right">
                    <div class="global-qty-wrapper">
                         <span class="qty-label">생산 수량</span>
                         <div class="qty-control-group">
                             <button class="qty-btn qty-btn-minus" data-restaurant-id="${restaurantId}" onclick="RestaurantModule.adjustGlobalQty('${restaurantId}', -1)">
                                 <span class="material-symbols-outlined">remove</span>
                             </button>
                             <input type="number" class="planner-global-input modern" data-restaurant-id="${restaurantId}" min="0" max="999" value="${plan.globalCount}">
                             <button class="qty-btn qty-btn-plus" data-restaurant-id="${restaurantId}" onclick="RestaurantModule.adjustGlobalQty('${restaurantId}', 1)">
                                 <span class="material-symbols-outlined">add</span>
                             </button>
                         </div>
                    </div>
                </div>
            </div>

            <div class="card-body">
                <div class="planner-slot-grid horizontal-4 modern">
                    ${slotsHTML}
                </div>
            </div>

            <div class="card-footer">
                <div class="preset-control-group">
                     <div class="preset-label-group">
                         <div class="preset-label">프리셋</div>
                         <div class="preset-current-indicator">선택: ${selectedPreset}</div>
                     </div>
                     <div class="planner-preset-visual-row">
                        ${presetVisuals}
                    </div>
                    <div class="planner-preset-actions">
                        <button class="preset-action-btn save" data-action="save" data-restaurant-id="${restaurantId}" title="선택한 슬롯에 저장">
                            <span class="material-symbols-outlined">download</span>
                        </button>
                        <button class="preset-action-btn load" data-action="load" data-restaurant-id="${restaurantId}" title="선택한 슬롯 불러오기">
                            <span class="material-symbols-outlined">upload</span>
                        </button>
                        <button class="preset-action-btn copy" data-action="copy" data-restaurant-id="${restaurantId}" title="다른 슬롯에서 복사">
                            <span class="material-symbols-outlined">content_copy</span>
                        </button>
                        <button class="preset-action-btn clear" data-action="clear" data-restaurant-id="${restaurantId}" title="선택한 슬롯 비우기">
                            <span class="material-symbols-outlined">delete</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function selectPresetSlot(restaurantId, presetIndex) {
    if (!state.ui) state.ui = { presetSelections: {} };
    state.ui.presetSelections[restaurantId] = presetIndex;
    refreshPlannerBuilder();
}

function renderPlannerSlot(restaurantId, slotIndex, slot, menuOptions) {
    const selectedMenu = menuOptions.find(opt => `${opt.formulaId}` === `${slot.formulaId}`);
    const rarityBg = selectedMenu ? RARITY_BACKGROUNDS[selectedMenu.rarity || 1] : '';

    // Custom Slot UI - Click opens modal with slot index
    return `
        <div class="planner-slot-custom ${selectedMenu ? 'filled' : 'empty'}"
             data-restaurant-id="${restaurantId}"
             data-slot-index="${slotIndex}"
             onclick="RestaurantModule.openMenuSelectionModal('${restaurantId}', ${slotIndex})">

            <div class="slot-content">
                ${selectedMenu ? `
                    <div class="slot-icon" style="background-image: url('${rarityBg}')">
                        <img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/islandprops/${selectedMenu.icon}" alt="${selectedMenu.name}">
                    </div>
                    <div class="slot-name">${selectedMenu.name}</div>
                ` : `
                    <div class="slot-placeholder">
                        <span class="material-symbols-outlined">add</span>
                        <span>메뉴 선택</span>
                    </div>
                `}
            </div>
        </div>
    `;
}

/**
 * Opens a modal for selecting menus for all slots in a restaurant
 * Shows ingredient preview for each menu
 * @param {string} restaurantId - The ID of the restaurant
 * @param {number} initialSlotIndex - The slot index to pre-select (defaults to 0)
 */
export function openMenuSelectionModal(restaurantId, initialSlotIndex = 0) {
    const restaurant = state.restaurants[restaurantId];
    const plan = getPlannerEntry(restaurantId);
    const menuOptions = getMenuOptions(restaurantId);

    const modalHtml = `
        <div class="menu-selection-modal-overlay" onclick="RestaurantModule.closeMenuSelectionModal()">
            <div class="menu-selection-modal" onclick="event.stopPropagation()">
                <div class="menu-modal-header">
                    <h3>
                        <span class="material-symbols-outlined">restaurant</span>
                        ${restaurant.name} - 메뉴 선택
                    </h3>
                    <button class="modal-close-btn" onclick="RestaurantModule.closeMenuSelectionModal()">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div class="menu-modal-body">
                    <div class="menu-modal-slots">
                        ${plan.slots.map((slot, idx) => {
        const selected = menuOptions.find(opt => `${opt.formulaId}` === `${slot.formulaId}`);
        return `
                                <div class="menu-modal-slot ${selected ? 'selected' : ''} ${idx === initialSlotIndex ? 'active' : ''}"
                                     onclick="RestaurantModule.selectSlotForModal(${idx})">
                                    <div class="slot-number">슬롯 ${idx + 1}</div>
                                    <div class="slot-current">
                                        ${selected ? `
                                            <img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/islandprops/${selected.icon}" alt="${selected.name}">
                                            <span>${selected.name}</span>
                                        ` : '<span class="empty-text">없음</span>'}
                                    </div>
                                </div>
                            `;
    }).join('')}
                    </div>
                    <div class="menu-modal-current-slot">
                        현재 선택 중: <strong>슬롯 ${initialSlotIndex + 1}</strong>
                    </div>
                    <div class="menu-modal-options">
                        <div class="menu-option-item" onclick="RestaurantModule.selectMenusFromModal('${restaurantId}', null)">
                            <div class="menu-option-icon empty-icon">
                                <span class="material-symbols-outlined">close</span>
                            </div>
                            <div class="menu-option-name">선택 해제</div>
                        </div>
                        ${menuOptions.map(opt => {
        const ingredients = getMenuIngredientPreview(opt.formulaId);
        return `
                                <div class="menu-option-item" onclick="RestaurantModule.selectMenusFromModal('${restaurantId}', '${opt.formulaId}')">
                                    <div class="menu-option-icon" style="background-image: url('${RARITY_BACKGROUNDS[opt.rarity || 1]}')">
                                        <img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${opt.icon}" alt="${opt.name}">
                                    </div>
                                    <div class="menu-option-details">
                                        <div class="menu-option-name">${opt.name}</div>
                                        ${ingredients.length > 0 ? `
                                            <div class="menu-option-ingredients">
                                                ${ingredients.slice(0, 6).map(ing => `
                                                    <img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/islandprops/${ing.icon}" alt="${ing.name}" data-name="${ing.name}">
                                                `).join('')}
                                                ${ingredients.length > 6 ? `<span class="more-count">+${ingredients.length - 6}</span>` : ''}
                                            </div>
                                        ` : ''}
                                    </div>
                                </div>
                            `;
    }).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;

    // Insert modal into DOM
    const existingModal = document.querySelector('.menu-selection-modal-overlay');
    if (existingModal) existingModal.remove();

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    state.currentMenuModalRestaurant = restaurantId;
    state.currentMenuModalSlot = initialSlotIndex;
}

function getMenuIngredientPreview(formulaId) {
    const tree = window.IslandEngine.buildRecipeDependencyTree(
        formulaId,
        state.recipeIndex,
        state.recipeCategoryIndex,
        state.dependencyGraph,
        state.shopPurchaseData,
        { useManualMode: false, quantityMultiplier: 1, shouldStopRecursion: (rId, rCat) => rCat === '1' || rCat === '2' }
    );

    const ingredients = {};
    if (tree) {
        aggregateIngredients(tree, ingredients, true);
    }

    return Object.values(ingredients).map(ing => ({
        name: ing.name,
        icon: ing.icon ? ing.icon.split('/').pop() + '.png' : ''
    }));
}

export function selectSlotForModal(slotIndex) {
    state.currentMenuModalSlot = slotIndex;
    // Update UI to show selected slot
    document.querySelectorAll('.menu-modal-slot').forEach((el, idx) => {
        if (idx === slotIndex) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });

    // Update current slot indicator
    const indicator = document.querySelector('.menu-modal-current-slot strong');
    if (indicator) {
        indicator.textContent = `슬롯 ${slotIndex + 1}`;
    }
}

export function selectMenusFromModal(restaurantId, formulaId) {
    const slot = state.currentMenuModalSlot !== undefined ? state.currentMenuModalSlot : 0;
    const entry = getPlannerEntry(restaurantId);

    if (formulaId === null) {
        // Clear selection
        entry.slots[slot].formulaId = '';
    } else {
        // Set selection
        entry.slots[slot].formulaId = formulaId;
    }

    state.plannerDirty = true;
    savePlannerPlan();

    // Just refresh the modal content without closing
    refreshModalSlots(restaurantId);

    updatePlannerUI();
    calculateDailyPlan(false);
}

function refreshModalSlots(restaurantId) {
    const plan = getPlannerEntry(restaurantId);
    const menuOptions = getMenuOptions(restaurantId);

    document.querySelectorAll('.menu-modal-slot').forEach((slotEl, idx) => {
        const slot = plan.slots[idx];
        const selected = menuOptions.find(opt => `${opt.formulaId}` === `${slot.formulaId}`);
        const slotCurrent = slotEl.querySelector('.slot-current');

        if (selected) {
            slotEl.classList.add('selected');
            slotCurrent.innerHTML = `
                <img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/islandprops/${selected.icon}" alt="${selected.name}">
                <span>${selected.name}</span>
            `;
        } else {
            slotEl.classList.remove('selected');
            slotCurrent.innerHTML = '<span class="empty-text">없음</span>';
        }
    });
}

export function closeMenuSelectionModal() {
    const modal = document.querySelector('.menu-selection-modal-overlay');
    if (modal) modal.remove();
    state.currentMenuModalRestaurant = null;
    state.currentMenuModalSlot = 0;
    refreshPlannerBuilder();
}

function getMenuOptions(restaurantId) {
    const restaurant = state.restaurants[restaurantId];
    if (!restaurant) return [];
    return (restaurant.item_id || []).map(([itemId, formulaId]) => {
        const item = state.items[itemId];
        return {
            itemId,
            formulaId,
            name: item ? item.name : `Menu ${itemId}`,
            rarity: item ? item.rarity : 1,
            icon: item && item.icon ? item.icon.split('/').pop() + '.png' : ''
        };
    });
}

export function adjustGlobalQty(restaurantId, delta) {
    const entry = getPlannerEntry(restaurantId);
    const newValue = Math.max(0, Math.min(999, entry.globalCount + delta));
    entry.globalCount = newValue;

    // Update input value
    const input = document.querySelector(`.planner-global-input[data-restaurant-id="${restaurantId}"]`);
    if (input) input.value = newValue;

    state.plannerDirty = true;
    savePlannerPlan();
    updatePlannerUI();
    calculateDailyPlan(false);
}

function bindPlannerBuilderEvents() {
    const container = document.getElementById('planner-builder') || document;

    container.querySelectorAll('.planner-global-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const restaurantId = e.target.dataset.restaurantId;
            const value = Math.max(0, parseInt(e.target.value, 10) || 0);
            const entry = getPlannerEntry(restaurantId);
            entry.globalCount = value;
            state.plannerDirty = true;
            savePlannerPlan();
            updatePlannerUI();
            calculateDailyPlan(false); // Real-time calculation (silent)
        });
    });

    container.querySelectorAll('.preset-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const restaurantId = e.currentTarget.dataset.restaurantId;
            const action = e.currentTarget.dataset.action;
            const presetIndex = (state.ui && state.ui.presetSelections && state.ui.presetSelections[restaurantId]) || 0;
            handlePresetAction(action, restaurantId, presetIndex);
        });
    });
}

function handleSlotSelection(restaurantId, slotIndex, formulaId) {
    const entry = getPlannerEntry(restaurantId);
    const slot = entry.slots[slotIndex] || { formulaId: '' };
    slot.formulaId = formulaId;
    entry.slots[slotIndex] = slot;
    state.plannerDirty = true;
    savePlannerPlan();
    updatePlannerUI();
    refreshPlannerBuilder(); // Re-render to show selection
    calculateDailyPlan(false); // Real-time calculation (silent)
}

function handleSlotCountChange(restaurantId, slotIndex, qty) {
    // Deprecated/Removed functionality but kept signature if needed or just remove
}

function applyGlobalCount(restaurantId) {
    // Deprecated/Removed functionality
}

async function handlePresetAction(action, restaurantId, presetIndex) {
    const entry = getPlannerEntry(restaurantId);
    if (!state.plannerPresets[restaurantId]) {
        state.plannerPresets[restaurantId] = {};
    }

    if (action === 'save') {
        state.plannerPresets[restaurantId][presetIndex] = clonePlannerEntry(entry);
        savePlannerPresets();
        refreshPlannerBuilder(); // Immediately update UI to show saved preset
        window.IslandEngine.showToast(`${state.restaurants[restaurantId]?.name || restaurantId}의 프리셋 ${presetIndex}이(가) 저장되었습니다.`, 'success');
    } else if (action === 'load') {
        const preset = state.plannerPresets[restaurantId][presetIndex];
        if (!preset) {
            window.IslandEngine.showToast('이 슬롯에 저장된 프리셋이 없습니다.', 'info');
            return;
        }
        state.plannerPlan[restaurantId] = clonePlannerEntry(preset);
        state.plannerDirty = true;
        savePlannerPlan();
        refreshPlannerBuilder();
        renderPlannerResultsSection();
        window.IslandEngine.showToast(`프리셋 ${presetIndex}을(를) 불러왔습니다.`, 'success');
    } else if (action === 'clear') {
        const confirmed = await showConfirm(`프리셋 ${presetIndex}을(를) 비울까요? 저장된 내용이 삭제됩니다.`);
        if (!confirmed) return;

        delete state.plannerPresets[restaurantId][presetIndex];
        savePlannerPresets();
        refreshPlannerBuilder();
        window.IslandEngine.showToast(`프리셋 ${presetIndex}을(를) 비웠습니다.`, 'info');
    } else if (action === 'copy') {
        openCopyPresetModal(restaurantId, presetIndex);
    }

    updatePlannerUI();
}

/**
 * Opens a modal to select a source preset slot to copy from
 */
function openCopyPresetModal(restaurantId, targetPresetIndex) {
    const restaurant = state.restaurants[restaurantId];
    const menuOptionsMap = new Map(getMenuOptions(restaurantId).map(opt => [String(opt.formulaId), opt.icon]));

    const presetOptions = Array.from({ length: PLANNER_PRESET_COUNT }, (_, idx) => {
        const sourceIndex = idx + 1;
        if (sourceIndex === targetPresetIndex) return null; // Can't copy to itself

        const presetData = state.plannerPresets[restaurantId] && state.plannerPresets[restaurantId][sourceIndex];
        const hasData = !!presetData;

        const icons = presetData ? presetData.slots.map(s => {
            if (!s.formulaId) return null;
            return menuOptionsMap.get(String(s.formulaId));
        }).filter(Boolean) : [];

        const iconsHtml = icons.length > 0
            ? `<div class="preset-mini-grid">${icons.slice(0, 4).map(icon => `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/islandprops/${icon}">`).join('')}</div>`
            : `<div class="preset-empty-dash">-</div>`;

        return `
            <div class="copy-preset-option ${!hasData ? 'disabled' : ''}" ${hasData ? `onclick="RestaurantModule.copyPresetFrom('${restaurantId}', ${sourceIndex}, ${targetPresetIndex})"` : ''}>
                <div class="copy-preset-slot ${hasData ? 'filled' : 'empty'}">
                    <div class="preset-slot-num">${sourceIndex}</div>
                    ${iconsHtml}
                </div>
                <div class="copy-preset-label">슬롯 ${sourceIndex} ${!hasData ? '(비어있음)' : ''}</div>
            </div>
        `;
    }).filter(Boolean).join('');

    const modalHtml = `
        <div class="menu-selection-modal-overlay" onclick="RestaurantModule.closeCopyPresetModal()">
            <div class="menu-selection-modal copy-preset-modal" onclick="event.stopPropagation()">
                <div class="menu-modal-header">
                    <h3>
                        <span class="material-symbols-outlined">content_copy</span>
                        프리셋 복사
                    </h3>
                    <button class="modal-close-btn" onclick="RestaurantModule.closeCopyPresetModal()">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div class="menu-modal-body">
                    <p class="copy-preset-description">${restaurant.name} - 슬롯 ${targetPresetIndex}로 복사할 프리셋을 선택하세요</p>
                    <div class="copy-preset-grid">
                        ${presetOptions}
                    </div>
                </div>
            </div>
        </div>
    `;

    // Insert modal into DOM
    const existingModal = document.querySelector('.menu-selection-modal-overlay');
    if (existingModal) existingModal.remove();

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

/**
 * Copy preset from source slot to target slot
 */
export function copyPresetFrom(restaurantId, sourceIndex, targetIndex) {
    const sourcePreset = state.plannerPresets[restaurantId] && state.plannerPresets[restaurantId][sourceIndex];
    if (!sourcePreset) {
        window.IslandEngine.showToast('소스 프리셋이 없습니다.', 'error');
        return;
    }

    if (!state.plannerPresets[restaurantId]) {
        state.plannerPresets[restaurantId] = {};
    }

    state.plannerPresets[restaurantId][targetIndex] = clonePlannerEntry(sourcePreset);
    savePlannerPresets();
    closeCopyPresetModal();
    refreshPlannerBuilder();
    window.IslandEngine.showToast(`슬롯 ${sourceIndex}에서 슬롯 ${targetIndex}로 복사했습니다.`, 'success');
}

export function closeCopyPresetModal() {
    const modal = document.querySelector('.menu-selection-modal-overlay');
    if (modal) modal.remove();
}

function clonePlannerEntry(entry) {
    return {
        globalCount: entry.globalCount,
        slots: entry.slots.map(slot => ({
            formulaId: slot.formulaId || '',
            count: slot.count || 0
        }))
    };
}

async function resetPlanner() {
    const confirmed = await showConfirm('현재 플래너 선택을 모두 초기화할까요?');
    if (!confirmed) return;

    state.plannerPlan = createDefaultPlannerPlan();
    state.lastPlannerResults = null;
    state.plannerDirty = true;
    savePlannerPlan();

    updatePlannerUI();
    renderPlannerResultsSection();
    const modal = document.getElementById('planner-modal');
    if (modal && !modal.classList.contains('hidden')) {
        renderPlannerModal();
    }

    window.IslandEngine.showToast('플래너가 초기화되었습니다.', 'info');
}

export function updatePlannerUI() {
    const summaryEl = document.getElementById('planner-selection-summary');
    if (!summaryEl) return;

    let filledSlots = 0;
    let totalQty = 0;

    Object.values(state.plannerPlan).forEach(entry => {
        entry.slots.forEach(slot => {
            if (slot.formulaId) {
                filledSlots += 1;
                totalQty += Number(slot.count) || 0;
            }
        });
    });

    if (filledSlots === 0) {
        summaryEl.textContent = '선택된 메뉴 없음';
    } else {
        summaryEl.textContent = `${filledSlots}개 메뉴 선택됨, 총 ${totalQty.toLocaleString()}개 생산`;
    }
}

export function calculateDailyPlan(arg) {
    const silent = arg === false;
    const selections = getPlannerSelections();
    if (selections.length === 0) {
        if (!silent) window.IslandEngine.showToast('선택된 메뉴가 없습니다.', 'info');
        return;
    }

    const ingredients = {}; // { itemId: { name, icon, quantity, location } }

    selections.forEach(selection => {
        const qty = Math.max(0, parseInt(selection.qty, 10) || 0);
        if (!selection.formulaId || qty <= 0) return;

        const stopCondition = (recipeId, recipeCategory) => {
            return recipeCategory === '1' || recipeCategory === '2';
        };

        const tree = window.IslandEngine.buildRecipeDependencyTree(
            selection.formulaId,
            state.recipeIndex,
            state.recipeCategoryIndex,
            state.dependencyGraph,
            state.shopPurchaseData,
            {
                useManualMode: false,
                quantityMultiplier: qty,
                shouldStopRecursion: stopCondition
            }
        );

        if (tree) {
            aggregateIngredients(tree, ingredients);
        }
    });

    const selectionSummary = buildSelectionSummary(selections);
    const groupedIngredients = groupIngredientsByLocation(ingredients);

    state.lastPlannerResults = {
        groupedIngredients,
        selectionSummary
    };
    state.plannerDirty = false;

    renderPlannerResultsSection();
    if (!silent) window.IslandEngine.showToast('원자재 계산을 완료했습니다.', 'success');
}

function getPlannerSelections() {
    const selections = [];
    Object.entries(state.plannerPlan).forEach(([restaurantId, entry]) => {
        const globalQty = parseInt(entry.globalCount, 10) || 0;
        entry.slots.forEach((slot, idx) => {
            if (slot.formulaId && globalQty > 0) {
                selections.push({
                    restaurantId,
                    slotIndex: idx,
                    formulaId: slot.formulaId,
                    qty: globalQty
                });
            }
        });
    });
    return selections;
}

function buildSelectionSummary(selections) {
    const summary = {};
    selections.forEach(sel => {
        const recipe = state.recipeIndex[sel.formulaId];
        let itemId = null;
        let itemName = `Formula ${sel.formulaId}`;
        let rarity = 1;

        if (recipe && recipe.commission_product && recipe.commission_product.length > 0) {
            itemId = recipe.commission_product[0][0];
            const item = state.items[itemId];
            if (item) {
                itemName = item.name;
                rarity = item.rarity;
            }
        }

        if (!summary[sel.restaurantId]) summary[sel.restaurantId] = [];
        summary[sel.restaurantId].push({
            formulaId: sel.formulaId,
            qty: sel.qty,
            itemId,
            itemName,
            rarity
        });
    });
    return summary;
}

function renderPlannerResultsSection() {
    const container = document.getElementById('planner-results');
    if (!container) return;
    container.innerHTML = renderPlannerResultsContent();
}

function renderPlannerResultsContent() {
    const masterGroups = state.masterIngredients || {};
    const calculatedGroups = (state.lastPlannerResults && state.lastPlannerResults.groupedIngredients) || {};

    // Build a lookup for calculated quantities
    const calculatedQuantities = {};
    Object.values(calculatedGroups).flat().forEach(item => {
        calculatedQuantities[item.id] = item.quantity;
    });

    // Define explicit order for raw material locations (with and without spaces to handle variations)
    const locationOrder = ["비옥한 농지", "향기로운 과수원", "초록색 모밭", "한가로운 목장", "지도에서 채집"];
    const locations = Object.keys(masterGroups).sort((a, b) => {
        const indexA = locationOrder.indexOf(a);
        const indexB = locationOrder.indexOf(b);

        // Both in order list: sort by their position
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        // Only A in order list: A comes first
        if (indexA !== -1) return -1;
        // Only B in order list: B comes first
        if (indexB !== -1) return 1;
        // Neither in order list: alphabetical sort
        return a.localeCompare(b);
    });

    const groupHtml = locations.length === 0 ? '<div class="planner-empty-state"><p>데이터를 불러오는 중입니다...</p></div>' : locations.map(location => `
        <div class="planner-result-group-card">
            <div class="group-header">
                <span class="material-symbols-outlined">map</span>
                <span>${location}</span>
            </div>
            <div class="planner-ingredient-grid compact">
                ${masterGroups[location].map(item => {
        const qty = calculatedQuantities[item.id] || 0;
        const isActive = qty > 0;
        return `
                    <div class="ingredient-card mini rarity-${item.rarity || 1} ${isActive ? 'active' : ''}" data-name="${item.name}">
                        <div class="ingredient-icon">
                            ${item.icon ? `<img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/islandprops/${item.icon.split('/').pop()}.png" alt="${item.name}">` : '<span class="material-symbols-outlined">inventory_2</span>'}
                            ${isActive ? `<span class="ingredient-qty">${Math.ceil(qty).toLocaleString()}</span>` : ''}
                        </div>
                    </div>
                `;
    }).join('')}
            </div>
        </div>
    `).join('');

    return `
        <h4 class="planner-section-title">필요 원자재</h4>
        ${groupHtml}
    `;
}

function renderSelectionSummary(selectionSummary) {
    const restaurantIds = Object.keys(selectionSummary);
    if (restaurantIds.length === 0) {
        return '<div class="planner-empty-state"><p>선택된 메뉴가 없습니다.</p></div>';
    }

    return `
        <div class="planner-meal-summary">
            <h4>선택한 메뉴</h4>
            <div class="planner-meal-list">
                ${restaurantIds.map(restaurantId => {
        const restaurantName = state.restaurants[restaurantId]?.name || `Restaurant ${restaurantId}`;
        const menus = selectionSummary[restaurantId];
        const itemsHtml = menus.map(menu => `
                        <li class="planner-meal-item">
                            <span class="planner-meal-qty">${menu.qty}x</span>
                            <span class="planner-meal-name rarity-${menu.rarity}">${menu.itemName}</span>
                        </li>
                    `).join('');
        return `
                        <div class="planner-restaurant-group">
                            <div class="planner-restaurant-name">${restaurantName}</div>
                            <ul class="planner-meal-items">
                                ${itemsHtml}
                            </ul>
                        </div>
                    `;
    }).join('')}
            </div>
        </div>
    `;
}

export function closePlannerModal() {
    hideElement('planner-modal');
}

function showConfirm(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const msgEl = document.getElementById('confirm-message');
        if (!modal || !msgEl) {
            resolve(window.confirm(message)); // Fallback
            return;
        }

        msgEl.textContent = message;
        confirmResolve = resolve;
        showElement(modal);
    });
}
