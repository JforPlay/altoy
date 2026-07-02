/**
 * fleet-sim.equip-code-ui.js — 장비 코드 modal (내보내기/가져오기).
 * Owns the equipCodeModal DOM; codec logic lives in equip/equip-code.js and
 * the import policy in fleet-sim.code-apply.js (both pure). Wired from
 * main.js via setup(state, callbacks) like the picker module.
 */
import { setupModal, openModal, showToast, showElement, hideElement, toggleElement } from '../utils.js';
import {
    getShipByGid,
    getDedicatedSPWeapon,
    getEquipCodeMaps,
    getEquipById,
    getMaxEnhanceLevel,
    getSlotAllowedTypes,
    getEffectiveShipType,
    getEquipsByAllowedTypes,
    getSPWeaponById,
    getShipsByPosition,
    getGenericSPWeapons,
} from './fleet-sim.data.js';
import { encodeEquipCode, decodeEquipCode } from '../equip/equip-code.js';
import { planImport } from './fleet-sim.code-apply.js';

let state = null;
let callbacks = null;
let activeSlot = -1;
let pending = null;

export function setup(stateRef, cbs) {
    state = stateRef;
    callbacks = cbs;
    setupModal('equipCodeModal', { restoreFocus: true });
    _wireEvents();
}

/** Open the modal for a filled fleet slot: builds the export code eagerly. */
export function openEquipCodeModal(slotIndex) {
    const slotConfig = state.ships[slotIndex];
    if (!slotConfig) return;
    activeSlot = slotIndex;

    const ship = getShipByGid(slotConfig.gid);
    const title = document.getElementById('equipCodeModal-title');
    if (title) title.textContent = ship ? `장비 코드 — ${ship.name}` : '장비 코드';

    _refreshExport(slotConfig, ship);

    const importInput = document.getElementById('equip-code-import');
    if (importInput) importInput.value = '';
    _renderNotices([]);
    _hideGidActions();
    pending = null;

    openModal('equipCodeModal');
    const exportInput = document.getElementById('equip-code-export');
    const code = exportInput ? exportInput.value : '';
    if (code && exportInput) requestAnimationFrame(() => exportInput.select());
}

/** Rebuild the export input + copy state for a slot (no notices/pending reset). */
function _refreshExport(slotConfig, ship) {
    const maps = getEquipCodeMaps();
    const exportInput = document.getElementById('equip-code-export');
    const copyBtn = document.getElementById('equip-code-copy');
    const code = maps ? encodeEquipCode(_buildEntries(slotConfig, ship), maps) : null;
    if (exportInput) exportInput.value = code || '';
    if (copyBtn) copyBtn.disabled = !code;
}

/** Current slot config → codec entries. Dedicated augments encode at max level
 *  (that is what the sim models); generic SP uses the selected level. */
function _buildEntries(slotConfig, ship) {
    const equips = (slotConfig.equips || [])
        .slice(0, 5)
        .map(eq => (eq && eq.id) ? { baseId: Number(eq.id), level: eq.level || 0 } : null);
    while (equips.length < 5) equips.push(null);

    let sp = null;
    const dedicated = ship ? getDedicatedSPWeapon(ship.gid) : null;
    if (dedicated) {
        const levelCount = Array.isArray(dedicated.levels) ? dedicated.levels.length : 1;
        sp = { baseId: Number(dedicated.id), level: levelCount - 1 };
    } else if (slotConfig.spWeapon && slotConfig.spWeapon.id) {
        sp = { baseId: Number(slotConfig.spWeapon.id), level: slotConfig.spWeapon.level || 0 };
    }
    return { equips, sp };
}

function _wireEvents() {
    const copyBtn = document.getElementById('equip-code-copy');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const exportInput = document.getElementById('equip-code-export');
            const code = exportInput ? exportInput.value : '';
            if (!code) { showToast('내보낼 장비가 없습니다', 'info'); return; }
            navigator.clipboard.writeText(code).then(() => {
                showToast('장비 코드가 클립보드에 복사되었습니다', 'success');
            }).catch(() => {
                if (exportInput) exportInput.select();
                showToast('복사 실패 — 코드를 직접 선택해 복사하세요', 'info');
            });
        });
    }
    // 가져오기: decode → planImport → apply/gid-choice (see _handleApplyClick).
    const applyBtn = document.getElementById('equip-code-apply');
    if (applyBtn) applyBtn.addEventListener('click', _handleApplyClick);
    const switchBtn = document.getElementById('equip-code-apply-switch');
    if (switchBtn) switchBtn.addEventListener('click', () => _applyPending(true));
    const onlyBtn = document.getElementById('equip-code-apply-only');
    if (onlyBtn) onlyBtn.addEventListener('click', () => _applyPending(false));
}

/** Render import warnings — textContent only (pasted codes are untrusted). */
function _renderNotices(items) {
    const list = document.getElementById('equip-code-notices');
    if (!list) return;
    list.innerHTML = '';
    for (const text of items) {
        const li = document.createElement('li');
        li.textContent = text;
        list.appendChild(li);
    }
}

function _hideGidActions() {
    hideElement('equip-code-gid-actions'); // hub rule: never classList.add('hidden')
}

/** Build the injected-predicate ctx for planImport from the live slot. */
function _buildCtx(slotConfig, ship) {
    const isRetrofit = slotConfig.retrofit !== false && !!ship?.retrofit;
    const effectiveType = ship ? getEffectiveShipType(ship, isRetrofit) : null;
    // allowed SP types for this ship type = types of its generic SP list
    const allowedSPTypes = new Set(
        ship ? getGenericSPWeapons(effectiveType).map(w => w.type) : []
    );
    return {
        shipGid: ship ? ship.gid : null,
        hasDedicatedSP: !!(ship && getDedicatedSPWeapon(ship.gid)),
        isEquipAllowed(baseId, slotIndex) {
            if (!ship) return false;
            const allowed = getSlotAllowedTypes(ship, slotIndex, isRetrofit);
            if (!allowed.length) return false;
            // reuses the picker's own filter (type + ship_type_forbidden)
            return getEquipsByAllowedTypes(allowed, effectiveType)
                .some(e => e.id === baseId);
        },
        maxEnhance(baseId) {
            return getMaxEnhanceLevel(getEquipById(baseId));
        },
        spInfo(baseId) {
            const w = getSPWeaponById(baseId);
            return w ? { unique: w.unique, type: w.type } : null;
        },
        allowedSPTypes,
    };
}

function _handleApplyClick() {
    pending = null;
    _hideGidActions();

    const importInput = document.getElementById('equip-code-import');
    const text = importInput ? importInput.value : '';
    const maps = getEquipCodeMaps();
    if (!maps) { showToast('데이터 로딩 후 다시 시도하세요', 'error'); return; }

    const decoded = decodeEquipCode(text, maps);
    const fatal = decoded.errors.some(e => e.kind === 'empty' || e.kind === 'format');
    if (fatal) {
        const empty = decoded.errors.some(e => e.kind === 'empty');
        showToast(empty ? '코드를 입력하세요' : '잘못된 코드 형식입니다', 'error');
        _renderNotices([]);
        return;
    }

    const slotConfig = state.ships[activeSlot];
    if (!slotConfig) return;
    const ship = getShipByGid(slotConfig.gid);
    const plan = planImport(decoded, _buildCtx(slotConfig, ship));

    if (plan.gidMismatch) {
        // Full game code for a different 함순이 — let the user choose.
        pending = { decoded, plan };
        const msgEl = document.getElementById('equip-code-gid-msg');
        const other = getShipByGid(decoded.gid);
        if (msgEl) {
            msgEl.textContent = other
                ? `이 코드는 다른 함순이(${other.name})의 코드입니다.`
                : '이 코드는 다른 함순이의 코드입니다.';
        }
        showElement('equip-code-gid-actions');
        // hide the switch option when the ship is unknown or on the wrong row
        const row = activeSlot < 3 ? '후열' : '전열';
        const canSwitch = !!other && getShipsByPosition(row).some(s => s.gid === decoded.gid);
        toggleElement('equip-code-apply-switch', canSwitch);
        return;
    }

    _applyPlan(plan);
}

/** gid-mismatch resolution buttons. switchShip=true → change 함순이 first. */
function _applyPending(switchShip) {
    if (!pending) return;
    const { decoded } = pending;
    _hideGidActions();
    if (switchShip) {
        callbacks.onShipSelected(activeSlot, decoded.gid);
        // re-plan against the NEW ship (slot config was replaced)
        const slotConfig = state.ships[activeSlot];
        const ship = getShipByGid(slotConfig.gid);
        _applyPlan(planImport(decoded, _buildCtx(slotConfig, ship)));
    } else {
        _applyPlan(pending.plan);
    }
    pending = null;
}

function _applyPlan(plan) {
    const slotConfig = state.ships[activeSlot];
    if (!slotConfig) return;
    if (!plan.apply.length && !plan.sp) {
        _renderNotices(plan.notices);
        showToast('적용할 수 있는 장비가 없습니다', 'error');
        return;
    }
    if (!slotConfig.equips) slotConfig.equips = new Array(5).fill(null);
    for (const item of plan.apply) {
        slotConfig.equips[item.slot] = { id: item.baseId, level: item.level };
    }
    if (plan.sp) {
        slotConfig.spWeapon = { id: plan.sp.baseId, level: Math.max(0, Math.min(plan.sp.level, 10)) };
    }
    // refresh the export string to reflect the newly applied loadout, and clear
    // the import input so the modal doesn't invite double-applying — do this
    // BEFORE painting notices so a plain openEquipCodeModal() refresh (which
    // resets notices) can't wipe the per-slot notices we're about to render.
    const slotCfg = state.ships[activeSlot];
    _refreshExport(slotCfg, slotCfg ? getShipByGid(slotCfg.gid) : null);
    const importInput = document.getElementById('equip-code-import');
    if (importInput) importInput.value = '';
    _renderNotices(plan.notices);
    callbacks.onApplied();
    showToast(`장비 ${plan.apply.length}개 적용 완료`, 'success');
}
