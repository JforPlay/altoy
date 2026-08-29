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
    syncedStorage,
    IMG_FALLBACKS,
    createImgElement,
    showElement,
} from '../utils.js';
import {
    MAX_SAVE_SLOTS, MAX_FLEETS, SAVES_VERSION, parseSaves, migrateSaves,
    serializeFleet, deserializeFleet, clampLevel,
    encodeFleetConfig, decodeFleetConfig, presetCode,
} from './fleet-sim.saves.js';

import {
    setup as setupData,
    loadAllData,
    getShipByGid,
    getEquipById,
    getMaxEnhanceLevel,
    getMetaBoss,
    getShipPortraitUrl,
    getDedicatedSPWeapon,
    getSPWeaponById,
} from './fleet-sim.data.js';

import { setup as setupCalc, getShipTypeTechCaps } from './fleet-sim.calc.js';
import { TECH_OVERRIDE_VERSION, parseTechOverride, shipTypeTechFromProgress } from './fleet-sim.tech.js';
import { setupTechUI, openTechModal } from './fleet-sim.tech-ui.js';
import { setup as setupUI, renderFleet, toggleStats, clearDamageCache } from './fleet-sim.ui.js';
import { setup as setupPicker, openShipPicker, openEquipPicker, openSPWeaponPicker, openBossPicker } from './fleet-sim.picker.js';
import { setup as setupEquipCodeUI, openEquipCodeModal } from './fleet-sim.equip-code-ui.js';

// ===== Constants =====

const STORAGE_KEY = 'fleetSimSaves';

/**
 * Saves store: {v:1, d: Save[]} envelope; legacy bare arrays migrate on read.
 * onRemoteChange keeps the save list live when another tab writes saves.
 */
const savesStore = syncedStorage(STORAGE_KEY, {
    version: SAVES_VERSION,
    parse: parseSaves,
    migrate: migrateSaves,
    onRemoteChange: () => {
        const modal = document.getElementById('saveLoadModal');
        // .active is openModal's own open marker; reading style.display would
        // couple this to the fact that it shows modals with an inline style.
        if (modal && modal.classList.contains('active')) _renderSaveSlotList();
    },
});

/**
 * Hand-set 함종 기술 cells. Cross-tab because a visitor correcting their tech in
 * one tab expects the other tab's cards to follow, exactly like fleetSimSaves.
 * Not in SYNCED_KEYS: it is per-device calibration of an account-wide number the
 * tracker already syncs, so pushing it to Drive would fight the derived value.
 */
const techStore = syncedStorage('fleetSimTechOverride', {
    version: TECH_OVERRIDE_VERSION,
    parse: parseTechOverride,
    onRemoteChange: (next) => {
        state.techOverride = next;
        renderFleet();
    },
});

// ===== Shared State =====

const state = {
    // Up to MAX_FLEETS independent fleets, one visible at a time (they fight in
    // sequence in game, so there is no combined figure to show). Every consumer
    // keeps reading `state.ships`; the getter points it at the active fleet.
    // Fleet slots: 0-2 = main (back row), 3-5 = vanguard (front row)
    fleets: [new Array(6).fill(null)],
    activeFleet: 0,
    get ships() { return this.fleets[this.activeFleet]; },
    set ships(v) { this.fleets[this.activeFleet] = v; },

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
    // Curated boss presets (src/data/fleet_sim_presets.json) — [] when absent
    presets: [],
    // Hand-set 함종 기술 cells, { shipType: { statKey: value } }. Empty = fully
    // tracker-derived; see fleet-sim.tech.js for why it merges per cell.
    techOverride: {},

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
    const fallback = { kind: 'preset', presetKey: 'heavy', adapt: 'base', difficulty: 'hard', bossId: null, tier: null, overrides: {}, window: 90 };
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
    _applyDamageTarget(patch);
    renderFleet();
}

/** Merge + persist WITHOUT rendering, for callers that render immediately
 *  afterwards anyway (URL restore at boot, preset load). renderFleet fans out
 *  into four async damage sims, so doing it twice is not free. */
function _applyDamageTarget(patch) {
    state.damageTarget = { ...state.damageTarget, ...patch };
    setStorageItem('fleetSimDamageTarget', JSON.stringify(state.damageTarget));
}

// ===== View Mode =====

/** UI-only preference — plain storage, not a syncedStorage key.
 *  Shaped like shipgirl-tracker's VIEW_CYCLE: each entry belongs to the view you
 *  are IN and carries the affordance for what clicking DOES, so the button
 *  advertises the destination rather than the current state. */
const VIEW_KEY = 'fleetSimView';
const VIEW_TOGGLE = {
    default: { next: 'compact', icon: 'view_list',   label: '간략 보기' },
    compact: { next: 'default', icon: 'view_agenda', label: '기본 보기' },
};

function _applyView(view) {
    const mode = VIEW_TOGGLE[view] ? view : 'default';
    const grid = document.querySelector('.fleet-grid');
    if (grid) grid.dataset.view = mode;

    const icon = document.getElementById('view-toggle-icon');
    const label = document.getElementById('view-toggle-label');
    if (icon) icon.textContent = VIEW_TOGGLE[mode].icon;
    if (label) label.textContent = VIEW_TOGGLE[mode].label;
    // The button's label names the destination view (house convention — see
    // shipgirl-tracker), so it needs no aria-pressed: an action-named button
    // has no "pressed" state to report, and pairing one with a destination
    // label would announce the wrong thing ("기본 보기, pressed" while in
    // compact view).

    setStorageItem(VIEW_KEY, mode);
}

// ===== Fleet Tabs =====

const _fleetChromeBtn = (action, icon, label, disabled) =>
    `<button type="button" class="btn btn-secondary btn-sm btn-icon" data-action="${action}"`
    + ` title="${label}" aria-label="${label}"${disabled ? ' disabled' : ''}>`
    + `<span class="material-symbols-outlined">${icon}</span></button>`;

/** Repaint the fleet tab strip. Only the fleet index is interpolated, and it is
 *  an array position — no user data reaches this innerHTML. */
function _renderFleetTabs() {
    const el = document.getElementById('fleet-tabs');
    if (!el) return;
    const tabs = state.fleets.map((_, i) => {
        const active = i === state.activeFleet;
        return `<button type="button" class="btn btn-secondary btn-sm${active ? ' is-active' : ''}"`
            + ` data-action="switch-fleet" data-fleet="${i}" aria-pressed="${active}">${i + 1}함대</button>`;
    }).join('');
    el.innerHTML = `<div class="btn-group">${tabs}</div>`
        + _fleetChromeBtn('add-fleet', 'add', '함대 추가', state.fleets.length >= MAX_FLEETS)
        + _fleetChromeBtn('remove-fleet', 'close', '함대 삭제', state.fleets.length <= 1);
}

function _switchFleet(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.fleets.length) return;
    if (index === state.activeFleet) return;
    state.activeFleet = index;
    clearDamageCache();
    _renderFleetTabs();
    renderFleet();
}

function _addFleet() {
    if (state.fleets.length >= MAX_FLEETS) return;
    state.fleets.push(new Array(6).fill(null));
    _switchFleet(state.fleets.length - 1);
}

/** Removes the ACTIVE fleet and falls back to the previous index. A populated
 *  fleet is real user work with no undo, so it confirms first. */
function _removeFleet() {
    if (state.fleets.length <= 1) return;
    const index = state.activeFleet;
    if (state.fleets[index].some(Boolean) && !confirm(`${index + 1}함대를 삭제할까요?`)) return;
    state.fleets.splice(index, 1);
    state.activeFleet = Math.max(0, index - 1);
    clearDamageCache();
    _renderFleetTabs();
    renderFleet();
}

// ===== Initialization =====

async function init() {
    // 0. Apply the stored view before first paint (no default-view flash)
    _applyView(getStorageItem(VIEW_KEY, 'default'));

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
    setupEquipCodeUI(state, {
        onApplied: () => renderFleet(),
        onShipSelected: handleShipSelected,
    });

    // 2. Load all data
    await loadAllData();
    // Overrides clamp against the roster ceiling, which needs ship_group_data —
    // so they load after, never in the module-scope store construction.
    state.techOverride = techStore.load();

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
    setupModal('presetModal', { restoreFocus: true });
    setupTechUI(state, {
        caps: getShipTypeTechCaps,
        derived: () => shipTypeTechFromProgress(state.shipGroupData, _trackerProgress()),
        onChange: () => { techStore.save(state.techOverride); renderFleet(); },
    });

    // 6. Curated presets are optional content — the button stays hidden until
    // the file actually carries one, so an empty file ships no dead UI.
    if (state.presets.length) showElement('preset-btn');

    // 7. Initial render
    _renderFleetTabs();
    renderFleet();
}

/** The tracker's raw progress map — the modal shows what it derives as placeholders. */
function _trackerProgress() {
    const raw = getStorageItem('shipgirlTrackerProgress', null);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
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
            case 'open-tech': {
                openTechModal();
                break;
            }
            case 'switch-fleet': {
                _switchFleet(parseInt(actionEl.dataset.fleet, 10));
                break;
            }
            case 'add-fleet': {
                _addFleet();
                break;
            }
            case 'remove-fleet': {
                _removeFleet();
                break;
            }
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
            case 'equip-code': {
                if (slot !== -1 && state.ships[slot]) openEquipCodeModal(slot);
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
            case 'dmg-difficulty': {
                setDamageTarget({ difficulty: actionEl.dataset.difficulty });
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
    let _dmgWindowTimer = null;
    page.addEventListener('input', (e) => {
        const winEl = e.target.closest('[data-action="dmg-window"]');
        if (winEl) {
            const raw = winEl.value.trim();
            clearTimeout(_dmgWindowTimer);
            _dmgWindowTimer = setTimeout(() => {
                const n = Number(raw);
                if (Number.isFinite(n) && n >= 10 && n <= 600) {
                    setDamageTarget({ window: Math.round(n) });
                }
            }, 300);
            return;
        }

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
    const viewToggle = document.getElementById('view-toggle-btn');
    if (viewToggle) {
        viewToggle.addEventListener('click', () => {
            const current = document.querySelector('.fleet-grid')?.dataset.view;
            _applyView((VIEW_TOGGLE[current] || VIEW_TOGGLE.default).next);
        });
    }

    const presetBtn = document.getElementById('preset-btn');
    if (presetBtn) {
        presetBtn.addEventListener('click', handleOpenPresets);
    }

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
        spWeapon: _defaultSPWeapon(ship),
        retrofit: ship?.retrofit ? true : undefined,
    };
    renderFleet();
}

/**
 * A 전용 특수 장비 is real slot state, not a display-only fallback: one code path
 * then serves every SP slot, and the level is selectable. Max level reproduces
 * the old fallback's numbers exactly, so no displayed stat moves.
 */
function _defaultSPWeapon(ship) {
    if (!ship?.sp_weapon) return null;
    const dedicated = getDedicatedSPWeapon(ship.gid);
    if (!dedicated) return null;
    return { id: Number(dedicated.id), level: _spMaxLevel(dedicated.id) };
}

/** SP weapons run to levels.length - 1 (+10, except 슈퍼 레인보우 망치 1호 at +0). */
function _spMaxLevel(spWeaponId) {
    const w = getSPWeaponById(spWeaponId);
    return Math.max(0, (w?.levels?.length || 11) - 1);
}

/**
 * Fill in the 전용 장비 for slots hydrated from a save or share URL written
 * before it became real state — those carry no sp field at all, and without
 * this an old save silently loses the weapon's stats.
 *
 * Both formats now always write the field, so `undefined` means "legacy, fill
 * it in" while an explicit `null` means the user removed the weapon and it must
 * stay removed.
 */
function _fillDedicatedSP(ships) {
    for (const slot of ships) {
        if (!slot || slot.spWeapon !== undefined) continue;
        slot.spWeapon = _defaultSPWeapon(getShipByGid(slot.gid));
    }
    return ships;
}

function handleEquipSelected(slotIndex, equipIndex, equipId, level) {
    const slotConfig = state.ships[slotIndex];
    if (!slotConfig) return;
    if (!slotConfig.equips) slotConfig.equips = new Array(5).fill(null);
    slotConfig.equips[equipIndex] = equipId ? { id: equipId, level: clampLevel(level, 0, 13) } : null;
    renderFleet();
}

function handleSPWeaponSelected(slotIndex, spWeaponId, maxLevel) {
    const slotConfig = state.ships[slotIndex];
    if (!slotConfig) return;
    slotConfig.spWeapon = spWeaponId
        ? { id: spWeaponId, level: clampLevel(maxLevel, 0, _spMaxLevel(spWeaponId)) }
        : null;
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

    // Derived, not hardcoded: 슈퍼 레인보우 망치 1호 has one level, and offering
    // +0..+10 there is a lie calc.js silently clamps back to index 0.
    _showLevelPopover(badge, 0, _spMaxLevel(sp.id), sp.level || 0,
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
    // Check if there's anything to save (in ANY fleet, not just the visible one)
    if (!_hasAnyShip()) {
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

    saves.push(_fleetRecord(name));
    savesStore.save(saves);

    // Clear input and re-render list
    if (nameInput) nameInput.value = '';
    _renderSaveSlotList();

    showToast('저장 완료', 'success');
}

/**
 * A save record snapshotting the CURRENT state under `name`.
 * `ships` always holds fleet 1 verbatim: it keeps parseSaves' Array.isArray
 * filter true and every existing reader working, so a stale cached build loads
 * fleet 1 rather than nothing.
 */
function _fleetRecord(name) {
    const record = {
        name,
        timestamp: Date.now(),
        ships: serializeFleet(state.fleets[0]),
    };
    if (state.fleets.length > 1) record.fleets = state.fleets.map(serializeFleet);
    // Boss metadata is display-only (portrait/tier on the save row) — loading
    // a save never restores the damage target (user decision, spec §2.4).
    const dt = state.damageTarget;
    if (dt && dt.kind === 'meta' && dt.bossId != null) {
        record.target = { bossId: dt.bossId, tier: dt.tier ?? null };
    }
    return record;
}

/**
 * Load a saved fleet from a slot index.
 */
function _handleLoad(saveIndex) {
    const saves = _getSaves();
    const save = saves[saveIndex];
    if (!save) return;

    state.fleets = _saveFleets(save).slice(0, MAX_FLEETS)
        .map(f => _fillDedicatedSP(deserializeFleet(f)));
    state.activeFleet = 0;
    clearDamageCache();
    closeModal('saveLoadModal');
    _renderFleetTabs();
    renderFleet();
    showToast('불러오기 완료', 'success');
}

/**
 * Rename a saved slot in place. prompt() is the platform's own single-field
 * dialog — an inline editor would be a second focus/commit/escape implementation.
 */
function _handleRename(saveIndex) {
    const saves = _getSaves();
    const save = saves[saveIndex];
    if (!save) return;

    const next = (prompt('편성 이름', save.name || '') || '').trim();
    if (!next || next === save.name) return;

    // maxlength on the save input is 30; prompt() enforces nothing.
    save.name = next.slice(0, 30);
    savesStore.save(saves);
    _renderSaveSlotList();
    showToast('이름을 변경했습니다', 'success');
}

/**
 * Overwrite a saved slot with the fleets currently on screen, keeping its name
 * and position. The record is REPLACED, not merged: a merge would leave a stale
 * `fleets` or `target` behind when the new state no longer has one.
 * Destructive with no undo, so it confirms first.
 */
function _handleOverwrite(saveIndex) {
    const saves = _getSaves();
    const save = saves[saveIndex];
    if (!save) return;
    if (!_hasAnyShip()) {
        showToast('저장할 편성이 없습니다', 'error');
        return;
    }
    if (!confirm(`'${save.name}'을(를) 현재 편성으로 덮어쓸까요?`)) return;

    saves[saveIndex] = _fleetRecord(save.name);
    savesStore.save(saves);
    _renderSaveSlotList();
    showToast('덮어쓰기 완료', 'success');
}

/**
 * Delete a saved slot.
 */
function _handleDelete(saveIndex) {
    const saves = _getSaves();
    if (saveIndex < 0 || saveIndex >= saves.length) return;

    saves.splice(saveIndex, 1);
    savesStore.save(saves);
    _renderSaveSlotList();
    showToast('삭제 완료', 'info');
}

/**
 * Get saved fleet data from localStorage.
 */
function _getSaves() {
    return savesStore.load();
}

/** A save's fleets, oldest single-fleet shape included. */
function _saveFleets(save) {
    return Array.isArray(save.fleets) && save.fleets.length ? save.fleets : [save.ships];
}

function _hasAnyShip() {
    return state.fleets.some(f => f.some(Boolean));
}

/**
 * Get next slot number for default naming.
 */
function _getNextSlotNumber() {
    const saves = _getSaves();
    return saves.length + 1;
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

        // Count occupied ship slots across every fleet the save carries
        const fleets = _saveFleets(save);
        const shipCount = fleets.reduce(
            (n, f) => n + (Array.isArray(f) ? f.filter(s => s !== null).length : 0), 0);

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
        if (fleets.length > 1) {
            const fleetCount = document.createElement('span');
            fleetCount.textContent = `· ${fleets.length}함대`;
            meta.appendChild(fleetCount);
        }

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
            _rowActionButton('save-slot-load', i, 'download', '불러오기'),
            _rowActionButton('save-slot-overwrite', i, 'save_as', '현재 편성으로 덮어쓰기', 'btn-secondary'),
            _rowActionButton('save-slot-rename', i, 'edit', '이름 변경', 'btn-secondary'),
            _rowActionButton('save-slot-delete', i, 'delete', '삭제', 'btn-danger')
        );

        const bossBadge = _bossBadge(save.target);
        if (bossBadge) slot.append(info, bossBadge, actions);
        else slot.append(info, actions);

        frag.appendChild(slot);
    }

    listEl.innerHTML = '';
    listEl.appendChild(frag);

    // Every actionable node in a row carries data-save-index, so one lookup
    // covers all four buttons plus the info area (which also loads).
    listEl.onclick = (e) => {
        const el = e.target.closest('[data-save-index]');
        if (!el) return;
        const idx = parseInt(el.dataset.saveIndex, 10);
        if (isNaN(idx)) return;

        if (el.classList.contains('save-slot-delete')) _handleDelete(idx);
        else if (el.classList.contains('save-slot-rename')) _handleRename(idx);
        else if (el.classList.contains('save-slot-overwrite')) _handleOverwrite(idx);
        else _handleLoad(idx);
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

/**
 * One row action button. `datasetKey` names the index attribute the row's own
 * delegate reads — save rows and preset rows share the markup but not the list.
 */
function _rowActionButton(className, index, iconName, label, variant = 'btn-primary', datasetKey = 'saveIndex') {
    const button = document.createElement('button');
    button.className = `btn btn-sm ${variant} ${className}`;
    button.type = 'button';
    button.dataset[datasetKey] = String(index);
    button.title = label;
    button.setAttribute('aria-label', label);

    button.appendChild(createMaterialIcon(iconName));

    return button;
}

/**
 * Boss metadata badge (portrait + tier), or null when there is nothing to show.
 * `bossId` == the playable META ship's gid, so the portrait rides the existing
 * ship-portrait pipeline. Shared by save rows and preset rows; the guard is
 * portrait-or-tier because boss-or-bossShip could emit a childless 0x0 div.
 */
function _bossBadge(target) {
    if (!target || target.bossId == null) return null;

    const boss = getMetaBoss(target.bossId);
    const bossShip = getShipByGid(target.bossId);
    const portraitUrl = bossShip && bossShip.skin_id ? getShipPortraitUrl(bossShip.skin_id) : '';
    const hasTier = target.tier != null;
    if (!portraitUrl && !hasTier) return null;

    const badge = document.createElement('div');
    badge.className = 'save-slot-boss';
    badge.title = (boss && boss.name) || (bossShip && bossShip.name) || '';
    if (portraitUrl) {
        badge.appendChild(createImgElement(portraitUrl, badge.title, {
            className: 'save-slot-boss-portrait',
            fallback: IMG_FALLBACKS.DEFAULT,
        }));
    }
    if (hasTier) {
        const tierChip = document.createElement('span');
        tierChip.className = 'save-slot-boss-tier';
        tierChip.textContent = `T${target.tier}`;
        badge.appendChild(tierChip);
    }
    return badge;
}

// ===== Curated Presets (추천 편성) =====

/**
 * Open the curated preset modal. The list is rebuilt per open — it is a handful
 * of rows and the decode is what makes them, so caching it buys nothing.
 */
function handleOpenPresets() {
    _renderPresetList();
    openModal('presetModal');
}

/**
 * Render the curated preset rows. A preset is a fleet you load, so it reuses the
 * save row's shape minus the destructive actions. Names and notes come from a
 * committed file and every node is built with textContent — no innerHTML.
 */
function _renderPresetList() {
    const listEl = document.getElementById('preset-list');
    if (!listEl) return;

    const frag = document.createDocumentFragment();
    let rendered = 0;

    state.presets.forEach((preset, i) => {
        const config = decodeFleetConfig(presetCode(preset.code), _spMaxLevel);
        // A code that no longer decodes is authoring damage, not user input:
        // drop the row rather than offering a 불러오기 that clears the fleet.
        if (!config || !config.fleets.some(f => f.some(Boolean))) return;
        rendered++;

        const fleets = config.fleets;
        const shipCount = fleets.reduce((n, f) => n + f.filter(Boolean).length, 0);

        const item = document.createElement('div');
        item.className = 'save-slot-item';

        const info = document.createElement('button');
        info.className = 'save-slot-info';
        info.type = 'button';
        info.dataset.presetIndex = String(i);
        info.title = '불러오기';

        const name = document.createElement('div');
        name.className = 'save-slot-name';
        name.textContent = preset.name || preset.id || '';

        const meta = document.createElement('div');
        meta.className = 'save-slot-meta';
        meta.textContent = fleets.length > 1
            ? `${shipCount}척 · ${fleets.length}함대`
            : `${shipCount}척`;

        info.append(name, meta);

        const shipNames = _getSaveShipNames(fleets[0]);
        if (shipNames) {
            const ships = document.createElement('div');
            ships.className = 'save-slot-ships';
            ships.textContent = shipNames;
            info.appendChild(ships);
        }
        if (preset.note) {
            const note = document.createElement('div');
            note.className = 'preset-note';
            note.textContent = preset.note;
            info.appendChild(note);
        }

        const actions = document.createElement('div');
        actions.className = 'save-slot-actions';
        actions.appendChild(
            _rowActionButton('preset-load', i, 'download', '불러오기', 'btn-primary', 'presetIndex')
        );

        const bossBadge = _bossBadge(preset);
        if (bossBadge) item.append(info, bossBadge, actions);
        else item.append(info, actions);

        frag.appendChild(item);
    });

    if (!rendered) {
        renderStatus(listEl, '추천 편성이 없습니다.', 'empty', { compact: true });
        return;
    }

    listEl.innerHTML = '';
    listEl.appendChild(frag);

    listEl.onclick = (e) => {
        const el = e.target.closest('[data-preset-index]');
        if (!el) return;
        const idx = parseInt(el.dataset.presetIndex, 10);
        if (!isNaN(idx)) _handlePresetLoad(idx);
    };
}

/**
 * Load a curated preset. Its `code` IS a 공유 payload, so this is the share
 * restore path verbatim — the author's damage target included, which is the
 * whole point of a per-boss build.
 */
function _handlePresetLoad(index) {
    const preset = state.presets[index];
    if (!preset) return;

    clearDamageCache();
    restoreFromUrl(presetCode(preset.code));
    closeModal('presetModal');
    _renderFleetTabs();
    renderFleet();
    showToast('불러오기 완료', 'success');
}

// ===== URL Sharing =====

function handleShare() {
    if (!_hasAnyShip()) {
        showToast('공유할 편성이 없습니다', 'info');
        return;
    }

    setUrlParams({ fleet: encodeFleetConfig(state) }, { replace: true });

    // Copy URL to clipboard
    navigator.clipboard.writeText(window.location.href).then(() => {
        showToast('URL이 클립보드에 복사되었습니다', 'success');
    }).catch(() => {
        showToast('URL을 주소창에서 복사하세요', 'info');
    });
}

/** DOM half of the share codec: decodeFleetConfig does the parsing, hardening
 *  and clamping; this applies the result to state and the damage target. */
function restoreFromUrl(encoded) {
    const config = decodeFleetConfig(encoded, _spMaxLevel);
    if (!config) {
        console.warn('Failed to restore fleet from URL');
        return;
    }
    state.fleets = config.fleets.map(_fillDedicatedSP);
    state.activeFleet = config.activeFleet;
    if (config.target) _applyDamageTarget(config.target);
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
