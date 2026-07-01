/**
 * Fleet Build Simulator — Main Entry Module
 * Initializes all modules, manages shared state, wires event delegation,
 * and handles save/load/share functionality.
 */

import {
    getUrlParam,
    setUrlParams,
    showToast,
    setupModal,
    openModal,
    closeModal,
    getStorageItem,
    setStorageItem,
    createMaterialIcon,
    renderStatus,
} from '../utils.js';

import {
    setup as setupData,
    loadAllData,
    getShipByGid,
    getEquipById,
    getMaxEnhanceLevel,
} from './fleet-sim.data.js';

import { setup as setupCalc } from './fleet-sim.calc.js';
import { setup as setupUI, renderFleet, toggleStats } from './fleet-sim.ui.js';
import { setup as setupPicker, openShipPicker, openEquipPicker, openSPWeaponPicker, openBossPicker } from './fleet-sim.picker.js';

// ===== Constants =====

const STORAGE_KEY = 'fleetSimSaves';
const MAX_SAVE_SLOTS = 5;

// ===== Shared State =====

const state = {
    // Fleet slots: 0-2 = main (back row), 3-5 = vanguard (front row)
    ships: [null, null, null, null, null, null],

    // Data (populated by data module's loadAllData)
    shipData: [],
    shipByGid: {},
    equipLiteData: [],
    equipById: {},
    equipFullData: null,
    weaponPropertyData: null,
    passiveSkillData: null,
    fleetTechTemplateData: null,
    shipGroupData: null,

    // Mappings
    shipTypeData: {},
    nationalityData: {},
    attrTypeData: {},
    equipTypeData: {},

    // Damage target selection (UI pref; persisted — see _loadDamageTarget)
    damageTarget: _loadDamageTarget(),
};

// ===== Damage Target =====

/**
 * Load the persisted damage target. getStorageItem returns a RAW string and
 * setStorageItem stores AS-IS (no JSON), so we JSON-parse on read and stringify
 * on write. Falls back to defaults if absent or malformed — including the
 * stringified "[object Object]" that an earlier build persisted. Hoisted
 * (function declaration) so the state initializer above can call it.
 */
function _loadDamageTarget() {
    const fallback = { kind: 'preset', presetKey: 'heavy', adapt: 'base', bossId: null, tier: null, overrides: {}, window: 90 };
    const raw = getStorageItem('fleetSimDamageTarget', null);
    if (raw) {
        try {
            const t = JSON.parse(raw);
            if (t && (t.presetKey || t.bossId)) return { ...fallback, ...t, overrides: { ...(t.overrides || {}) } };
        } catch { /* malformed — fall through to defaults */ }
    }
    return fallback;
}

/**
 * Merge a patch into state.damageTarget, persist to localStorage, and re-render.
 * Called from click/input handlers when the user changes target preset/adapt/overrides.
 */
export function setDamageTarget(patch) {
    state.damageTarget = { ...state.damageTarget, ...patch };
    setStorageItem('fleetSimDamageTarget', JSON.stringify(state.damageTarget));
    renderFleet();
}

// ===== Initialization =====

async function init() {
    // 1. Setup all modules with shared state
    setupData(state);
    setupCalc(state);
    setupUI(state);
    setupPicker(state, {
        onShipSelected: handleShipSelected,
        onEquipSelected: handleEquipSelected,
        onSPWeaponSelected: handleSPWeaponSelected,
        onTargetSelected: handleTargetSelected,
    });

    // 2. Load all data
    await loadAllData();

    // 3. Restore from URL if fleet param present
    const fleetParam = getUrlParam('fleet');
    if (fleetParam) {
        restoreFromUrl(fleetParam);
    }

    // 4. Setup event listeners
    setupEventListeners();

    // 5. Setup save/load modal (Modal.astro shell — setupModal defaults
    // cover the .modal-close button and .modal-backdrop clicks)
    setupModal('saveLoadModal', { restoreFocus: true });

    // 6. Initial render
    renderFleet();
}

// ===== Event Listeners =====

function setupEventListeners() {
    const page = document.querySelector('.fleet-sim-page');
    if (!page) return;

    // --- Click delegation ---
    page.addEventListener('click', (e) => {
        const target = e.target;

        // Empty card → open ship picker
        const addBtn = target.closest('.ship-card-add');
        if (addBtn) {
            const slot = _getSlot(addBtn);
            if (slot !== -1) openShipPicker(slot);
            return;
        }

        // data-action based routing
        const actionEl = target.closest('[data-action]');
        if (!actionEl) return;

        const action = actionEl.dataset.action;
        const slot = _getSlot(actionEl);

        switch (action) {
            case 'change-ship': {
                if (slot !== -1) openShipPicker(slot);
                break;
            }
            case 'remove-ship': {
                if (slot !== -1) {
                    state.ships[slot] = null;
                    renderFleet();
                }
                break;
            }
            case 'change-equip': {
                const equipIndex = _getEquipIndex(actionEl);
                if (slot !== -1 && equipIndex !== -1) {
                    openEquipPicker(slot, equipIndex);
                }
                break;
            }
            case 'change-equip-level': {
                const equipIndex = _getEquipIndex(actionEl);
                if (slot !== -1 && equipIndex !== -1) {
                    _showEnhancePopover(actionEl, slot, equipIndex);
                }
                break;
            }
            case 'change-sp-weapon': {
                if (slot !== -1) openSPWeaponPicker(slot);
                break;
            }
            case 'change-sp-level': {
                if (slot !== -1) _showSPLevelPopover(actionEl, slot);
                break;
            }
            case 'step-level': {
                if (slot !== -1) {
                    const dir = parseInt(actionEl.dataset.dir, 10) || 0;
                    _stepLevel(slot, dir, e.shiftKey);
                }
                break;
            }
            case 'edit-level': {
                if (slot !== -1) _inlineEditLevel(actionEl, slot);
                break;
            }
            case 'toggle-stats': {
                if (slot !== -1) toggleStats(slot);
                break;
            }
            case 'dmg-adapt': {
                setDamageTarget({ adapt: actionEl.dataset.adapt });
                break;
            }
            case 'dmg-open-picker': {
                openBossPicker();
                break;
            }
        }
    });

    page.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const target = e.target;
        if (target instanceof HTMLButtonElement || target instanceof HTMLSelectElement || target instanceof HTMLInputElement) return;

        const actionEl = target.closest('[data-action]');
        if (!actionEl) return;

        e.preventDefault();
        actionEl.click();
    });

    // --- Change delegation (affinity select) ---
    page.addEventListener('change', (e) => {
        const target = e.target;
        const actionEl = target.closest('[data-action]');
        if (!actionEl) return;

        const action = actionEl.dataset.action;
        const slot = _getSlot(actionEl);

        if (action === 'change-affinity' && slot !== -1) {
            const slotConfig = state.ships[slot];
            if (slotConfig) {
                slotConfig.affinity = actionEl.value;
                renderFleet();
            }
        }

        // Retrofit toggle (Task 5)
        if (action === 'toggle-retrofit' && slot !== -1) {
            const slotConfig = state.ships[slot];
            if (slotConfig) {
                slotConfig.retrofit = actionEl.checked;
                renderFleet();
            }
        }

        // Damage target: META tier select
        if (action === 'dmg-tier') {
            const tier = Number(actionEl.value);
            if (!Number.isNaN(tier)) setDamageTarget({ tier });
        }
    });

    // --- Input delegation (dmg-edit: editable enemy overrides), debounced ---
    // Each edit triggers a full renderFleet + 4 async damage calcs, so coalesce
    // rapid keystrokes; capture field+value at fire time (element may change).
    let _dmgEditTimer = null;
    page.addEventListener('input', (e) => {
        const actionEl = e.target.closest('[data-action="dmg-edit"]');
        if (!actionEl) return;
        const field = actionEl.dataset.field;
        if (!field) return;
        const raw = actionEl.value.trim();
        clearTimeout(_dmgEditTimer);
        _dmgEditTimer = setTimeout(() => {
            const overrides = { ...state.damageTarget.overrides };
            if (raw === '') {
                delete overrides[field];
            } else {
                overrides[field] = Number(raw);
            }
            setDamageTarget({ overrides });
        }, 250);
    });

    // (Other input delegation removed — replaced by step-level/edit-level actions)

    // --- Drag and drop (Task 6) — event delegation on grid containers ---
    const mainGrid = document.getElementById('main-fleet-grid');
    const vanguardGrid = document.getElementById('vanguard-fleet-grid');

    for (const grid of [mainGrid, vanguardGrid]) {
        if (!grid) continue;

        grid.addEventListener('dragstart', (e) => {
            const card = e.target.closest('.ship-card');
            if (!card || card.classList.contains('ship-card--empty')) { e.preventDefault(); return; }
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.dataset.slot);
        });

        grid.addEventListener('dragend', (e) => {
            const card = e.target.closest('.ship-card');
            if (card) card.classList.remove('dragging');
            grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });

        grid.addEventListener('dragover', (e) => {
            const card = e.target.closest('.ship-card');
            if (!card) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            card.classList.add('drag-over');
        });

        grid.addEventListener('dragleave', (e) => {
            const card = e.target.closest('.ship-card');
            if (card) card.classList.remove('drag-over');
        });

        grid.addEventListener('drop', (e) => {
            e.preventDefault();
            const targetCard = e.target.closest('.ship-card');
            if (!targetCard) return;
            targetCard.classList.remove('drag-over');

            const sourceSlot = parseInt(e.dataTransfer.getData('text/plain'), 10);
            const targetSlot = parseInt(targetCard.dataset.slot, 10);
            if (isNaN(sourceSlot) || isNaN(targetSlot) || sourceSlot === targetSlot) return;

            // Only allow swaps within same row
            const sameRow = (sourceSlot < 3 && targetSlot < 3) || (sourceSlot >= 3 && targetSlot >= 3);
            if (!sameRow) return;

            // Swap ships
            const temp = state.ships[sourceSlot];
            state.ships[sourceSlot] = state.ships[targetSlot];
            state.ships[targetSlot] = temp;
            renderFleet();
        });
    }

    // --- Header buttons ---
    const saveLoadBtn = document.getElementById('save-load-btn');
    if (saveLoadBtn) {
        saveLoadBtn.addEventListener('click', handleOpenSaveLoad);
    }

    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', handleShare);
    }

    // --- Save button inside modal ---
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', handleSave);
    }
}

// ===== Helper: Extract slot/equip index from dataset =====

function _getSlot(el) {
    const slot = el.dataset.slot;
    if (slot == null) return -1;
    const num = parseInt(slot, 10);
    return (isNaN(num) || num < 0 || num > 5) ? -1 : num;
}

function _getEquipIndex(el) {
    const idx = el.dataset.equipIndex;
    if (idx == null) return -1;
    const num = parseInt(idx, 10);
    return (isNaN(num) || num < 0 || num > 4) ? -1 : num;
}

// ===== Ship/Equip Selection Handlers =====

function handleShipSelected(slotIndex, gid) {
    const ship = getShipByGid(gid);
    state.ships[slotIndex] = {
        gid,
        level: 125,
        affinity: 'love',
        equips: new Array(5).fill(null),
        spWeapon: null,
        retrofit: ship?.retrofit ? true : undefined,
    };
    renderFleet();
}

function handleEquipSelected(slotIndex, equipIndex, equipId, level) {
    const slotConfig = state.ships[slotIndex];
    if (!slotConfig) return;
    if (!slotConfig.equips) slotConfig.equips = new Array(5).fill(null);
    slotConfig.equips[equipIndex] = equipId ? { id: equipId, level: _clampLevel(level, 0, 13) } : null;
    renderFleet();
}

function handleSPWeaponSelected(slotIndex, spWeaponId, maxLevel) {
    const slotConfig = state.ships[slotIndex];
    if (!slotConfig) return;
    slotConfig.spWeapon = spWeaponId ? { id: spWeaponId, level: _clampLevel(maxLevel, 0, 10) } : null;
    renderFleet();
}

function handleTargetSelected(sel) {
    if (sel.kind === 'meta') {
        setDamageTarget({ kind: 'meta', bossId: sel.bossId, tier: sel.tier ?? null });
    } else {
        setDamageTarget({ kind: 'preset', presetKey: sel.presetKey });
    }
}

// ===== Level Stepper (Task 3) =====

function _stepLevel(slotIndex, dir, shiftKey) {
    const slotConfig = state.ships[slotIndex];
    if (!slotConfig) return;
    const step = shiftKey ? 10 : 1;
    slotConfig.level = Math.max(1, Math.min(125, (slotConfig.level || 125) + dir * step));
    renderFleet();
}

function _inlineEditLevel(el, slotIndex) {
    const slotConfig = state.ships[slotIndex];
    if (!slotConfig) return;

    const current = slotConfig.level || 125;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'stepper-edit';
    input.value = current;
    input.min = 1;
    input.max = 125;

    const commit = () => {
        const parsed = parseInt(input.value, 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 125) {
            slotConfig.level = parsed;
        }
        renderFleet();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') renderFleet();
    });

    el.replaceWith(input);
    input.select();
}

// ===== Enhance Level Popover (Task 2) =====

let _activePopover = null;

function _closeActivePopover() {
    if (_activePopover) {
        _activePopover.remove();
        _activePopover = null;
    }
}

/**
 * Show a level slider popover anchored to a badge element.
 * Appended to document.body (not inside the card) to avoid overflow:hidden clipping.
 */
function _showLevelPopover(badge, min, max, currentVal, onChange, onCommit) {
    _closeActivePopover();

    const popover = document.createElement('div');
    popover.className = 'enhance-popover';
    popover.innerHTML = `
        <input type="range" min="${min}" max="${max}" value="${currentVal}" />
        <span class="enhance-level-display">+${currentVal}</span>
    `;

    // Position above the badge using fixed positioning
    const rect = badge.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.left = `${rect.right}px`;
    popover.style.top = `${rect.top - 4}px`;
    // Measure popover height before showing to avoid the jump
    popover.style.visibility = 'hidden';
    document.body.appendChild(popover);
    const popoverHeight = popover.offsetHeight;
    popover.style.top = `${rect.top - 4 - popoverHeight}px`;
    popover.style.visibility = '';

    const slider = popover.querySelector('input[type="range"]');
    const display = popover.querySelector('.enhance-level-display');

    // Shared cleanup function to remove both popover and listener
    let _outsideHandler = null;
    const cleanup = () => {
        if (_outsideHandler) {
            document.removeEventListener('pointerdown', _outsideHandler);
            _outsideHandler = null;
        }
        _closeActivePopover();
    };

    slider.addEventListener('input', () => {
        const val = parseInt(slider.value, 10);
        display.textContent = `+${val}`;
        onChange(val);
    });

    slider.addEventListener('change', () => {
        cleanup();
        onCommit();
    });

    _activePopover = popover;

    _outsideHandler = (e) => {
        if (!popover.contains(e.target) && e.target !== badge) {
            cleanup();
            onCommit();
        }
    };
    requestAnimationFrame(() => document.addEventListener('pointerdown', _outsideHandler));

    slider.focus();
}

function _showEnhancePopover(badge, slotIndex, equipIndex) {
    const eq = state.ships[slotIndex]?.equips?.[equipIndex];
    if (!eq) return;

    const equipInfo = getEquipById(eq.id);
    const maxLevel = getMaxEnhanceLevel(equipInfo);

    _showLevelPopover(badge, 0, maxLevel, eq.level || 0,
        (val) => { eq.level = val; badge.textContent = `+${val}`; },
        () => renderFleet()
    );
}

function _showSPLevelPopover(badge, slotIndex) {
    const sp = state.ships[slotIndex]?.spWeapon;
    if (!sp) return;

    _showLevelPopover(badge, 0, 10, sp.level || 0,
        (val) => { sp.level = val; badge.textContent = `+${val}`; },
        () => renderFleet()
    );
}

// ===== Save/Load =====

/**
 * Open the save/load modal and render saved slot list.
 */
function handleOpenSaveLoad() {
    _renderSaveSlotList();
    openModal('saveLoadModal');

    // Focus the name input
    const nameInput = document.getElementById('save-name-input');
    if (nameInput) {
        requestAnimationFrame(() => nameInput.focus());
    }
}

/**
 * Handle save button click: save current fleet to a new slot.
 */
function handleSave() {
    // Check if there's anything to save
    const hasShip = state.ships.some(s => s !== null);
    if (!hasShip) {
        showToast('저장할 편성이 없습니다', 'error');
        return;
    }

    const nameInput = document.getElementById('save-name-input');
    const name = (nameInput?.value || '').trim() || `편성 ${_getNextSlotNumber()}`;

    const saves = _getSaves();

    if (saves.length >= MAX_SAVE_SLOTS) {
        showToast(`최대 ${MAX_SAVE_SLOTS}개까지 저장할 수 있습니다`, 'error');
        return;
    }

    saves.push({
        name,
        timestamp: Date.now(),
        ships: _serializeFleet(),
    });

    setStorageItem(STORAGE_KEY, JSON.stringify(saves));

    // Clear input and re-render list
    if (nameInput) nameInput.value = '';
    _renderSaveSlotList();

    showToast('저장 완료', 'success');
}

/**
 * Load a saved fleet from a slot index.
 */
function _handleLoad(saveIndex) {
    const saves = _getSaves();
    const save = saves[saveIndex];
    if (!save) return;

    _deserializeFleet(save.ships);
    closeModal('saveLoadModal');
    renderFleet();
    showToast('불러오기 완료', 'success');
}

/**
 * Delete a saved slot.
 */
function _handleDelete(saveIndex) {
    const saves = _getSaves();
    if (saveIndex < 0 || saveIndex >= saves.length) return;

    saves.splice(saveIndex, 1);
    setStorageItem(STORAGE_KEY, JSON.stringify(saves));
    _renderSaveSlotList();
    showToast('삭제 완료', 'info');
}

/**
 * Get saved fleet data from localStorage.
 */
function _getSaves() {
    const raw = getStorageItem(STORAGE_KEY, '[]');
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/**
 * Get next slot number for default naming.
 */
function _getNextSlotNumber() {
    const saves = _getSaves();
    return saves.length + 1;
}

/**
 * Serialize current fleet state for saving.
 */
function _serializeFleet() {
    return state.ships.map(s => {
        if (!s) return null;
        const out = {
            gid: s.gid,
            level: s.level,
            affinity: s.affinity,
            equips: (s.equips || []).map(eq => eq ? { id: eq.id, level: eq.level } : null),
        };
        if (s.spWeapon) out.spWeapon = { id: s.spWeapon.id, level: s.spWeapon.level };
        if (s.retrofit !== undefined) out.retrofit = s.retrofit;
        return out;
    });
}

/**
 * Deserialize saved fleet data into state.
 */
function _deserializeFleet(savedShips) {
    if (!Array.isArray(savedShips)) {
        state.ships = [null, null, null, null, null, null];
        return;
    }

    state.ships = savedShips.map(s => {
        if (!s || !s.gid) return null;
        const slot = {
            gid: s.gid,
            level: _clampLevel(s.level, 1, 125, 125),
            affinity: s.affinity || 'love',
            equips: Array.isArray(s.equips)
                ? s.equips.slice(0, 5).map(eq => eq ? { id: eq.id, level: _clampLevel(eq.level, 0, 13, 0) } : null)
                : new Array(5).fill(null),
            spWeapon: s.spWeapon ? { id: s.spWeapon.id, level: _clampLevel(s.spWeapon.level, 0, 10, 0) } : null,
        };
        if (s.retrofit !== undefined) slot.retrofit = s.retrofit;
        return slot;
    });

    // Ensure exactly 6 slots
    while (state.ships.length < 6) state.ships.push(null);
    if (state.ships.length > 6) state.ships.length = 6;
}

function _clampLevel(value, min, max, fallback = max) {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

/**
 * Render the save slot list inside the modal.
 */
function _renderSaveSlotList() {
    const listEl = document.getElementById('save-slot-list');
    if (!listEl) return;

    const saves = _getSaves();

    if (saves.length === 0) {
        _renderSaveEmptyState(listEl);
        return;
    }

    const frag = document.createDocumentFragment();

    for (let i = 0; i < saves.length; i++) {
        const save = saves[i];
        const date = new Date(save.timestamp);
        const dateStr = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;

        // Count occupied ship slots
        const shipCount = Array.isArray(save.ships)
            ? save.ships.filter(s => s !== null).length
            : 0;

        // Ship name summary (first 3 names)
        const shipNames = _getSaveShipNames(save.ships);

        const slot = document.createElement('div');
        slot.className = 'save-slot-item';
        const info = document.createElement('button');
        info.className = 'save-slot-info';
        info.type = 'button';
        info.dataset.saveIndex = String(i);
        info.title = '불러오기';

        const name = document.createElement('div');
        name.className = 'save-slot-name';
        name.textContent = save.name || '';

        const meta = document.createElement('div');
        meta.className = 'save-slot-meta';
        const count = document.createElement('span');
        count.textContent = `${shipCount}척`;
        const separator = document.createElement('span');
        separator.textContent = '·';
        const dateEl = document.createElement('span');
        dateEl.textContent = dateStr;
        meta.append(count, separator, dateEl);

        info.append(name, meta);
        if (shipNames) {
            const ships = document.createElement('div');
            ships.className = 'save-slot-ships';
            ships.textContent = shipNames;
            info.appendChild(ships);
        }

        const actions = document.createElement('div');
        actions.className = 'save-slot-actions';
        actions.append(
            _createSaveActionButton('save-slot-load', i, 'download', '불러오기'),
            _createSaveActionButton('save-slot-delete', i, 'delete', '삭제')
        );

        slot.append(info, actions);

        frag.appendChild(slot);
    }

    listEl.innerHTML = '';
    listEl.appendChild(frag);

    // Attach event listeners to load/delete buttons via delegation
    listEl.onclick = (e) => {
        const loadBtn = e.target.closest('.save-slot-load');
        if (loadBtn) {
            const idx = parseInt(loadBtn.dataset.saveIndex, 10);
            if (!isNaN(idx)) _handleLoad(idx);
            return;
        }

        const deleteBtn = e.target.closest('.save-slot-delete');
        if (deleteBtn) {
            const idx = parseInt(deleteBtn.dataset.saveIndex, 10);
            if (!isNaN(idx)) _handleDelete(idx);
            return;
        }

        // Click on the info area also loads
        const infoArea = e.target.closest('.save-slot-info');
        if (infoArea) {
            const idx = parseInt(infoArea.dataset.saveIndex, 10);
            if (!isNaN(idx)) _handleLoad(idx);
        }
    };
}

/**
 * Build a short ship name summary from saved ship data.
 */
function _getSaveShipNames(savedShips) {
    if (!Array.isArray(savedShips)) return '';

    const names = [];
    for (const s of savedShips) {
        if (!s || !s.gid) continue;
        const ship = getShipByGid(s.gid);
        if (ship) names.push(ship.name);
    }

    if (names.length === 0) return '';
    if (names.length <= 3) return names.join(', ');
    return names.slice(0, 3).join(', ') + ` 외 ${names.length - 3}척`;
}

function _renderSaveEmptyState(listEl) {
    renderStatus(listEl, '저장된 편성이 없습니다.', 'empty', { compact: true });
}

function _createSaveActionButton(className, saveIndex, iconName, label) {
    const button = document.createElement('button');
    const variant = className === 'save-slot-load' ? 'btn-primary' : 'btn-danger';
    button.className = `btn btn-sm ${variant} ${className}`;
    button.type = 'button';
    button.dataset.saveIndex = String(saveIndex);
    button.title = label;
    button.setAttribute('aria-label', label);

    button.appendChild(createMaterialIcon(iconName));

    return button;
}

// ===== URL Sharing =====

function handleShare() {
    const hasShip = state.ships.some(s => s !== null);
    if (!hasShip) {
        showToast('공유할 편성이 없습니다', 'info');
        return;
    }

    const config = {
        s: state.ships.map(s => {
            if (!s) return null;
            const o = {
                g: s.gid,
                l: s.level,
                a: s.affinity,
                e: (s.equips || []).map(eq => eq ? [eq.id, eq.level] : null),
            };
            if (s.spWeapon) o.sp = [s.spWeapon.id, s.spWeapon.level];
            if (s.retrofit !== undefined) o.r = s.retrofit ? 1 : 0;
            return o;
        }),
    };

    const dt = state.damageTarget;
    if (dt) {
        config.t = dt.kind === 'meta'
            ? { k: 'meta', b: dt.bossId, ti: dt.tier }
            : { k: 'preset', p: dt.presetKey, ad: dt.adapt };
        if (dt.overrides && Object.keys(dt.overrides).length) config.t.o = dt.overrides;
        if (dt.window && dt.window !== 90) config.t.w = dt.window;
    }

    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(config))));
    setUrlParams({ fleet: encoded }, { replace: true });

    // Copy URL to clipboard
    navigator.clipboard.writeText(window.location.href).then(() => {
        showToast('URL이 클립보드에 복사되었습니다', 'success');
    }).catch(() => {
        showToast('URL을 주소창에서 복사하세요', 'info');
    });
}

function restoreFromUrl(encoded) {
    try {
        const json = decodeURIComponent(escape(atob(encoded)));
        const config = JSON.parse(json);

        state.ships = (config.s || []).map(s => {
            if (!s) return null;
            const slot = {
                gid: s.g,
                level: _clampLevel(s.l, 1, 125, 125),
                affinity: s.a || 'love',
                equips: (s.e || []).slice(0, 5).map(eq => eq ? { id: eq[0], level: _clampLevel(eq[1], 0, 13, 0) } : null),
                spWeapon: s.sp ? { id: s.sp[0], level: _clampLevel(s.sp[1], 0, 10, 0) } : null,
            };
            if (s.r !== undefined) slot.retrofit = s.r === 1;
            return slot;
        });

        if (config.t) {
            const t = config.t;
            const patch = t.k === 'meta'
                ? { kind: 'meta', bossId: t.b ?? null, tier: t.ti ?? null }
                : { kind: 'preset', presetKey: t.p || 'heavy', adapt: t.ad || 'base' };
            patch.overrides = (t.o && typeof t.o === 'object') ? t.o : {};
            patch.window = t.w || 90;
            setDamageTarget(patch);
        }

        // Ensure exactly 6 slots
        while (state.ships.length < 6) state.ships.push(null);
        if (state.ships.length > 6) state.ships.length = 6;
    } catch (e) {
        console.warn('Failed to restore fleet from URL:', e);
    }
}

// ===== Self-start =====

init().catch(err => {
    console.error('Fleet sim init failed:', err);
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.innerHTML = '';
        const message = document.createElement('p');
        message.style.color = 'var(--danger-color)';
        message.textContent = `로딩 실패: ${err.message}`;
        overlay.appendChild(message);
    }
});
