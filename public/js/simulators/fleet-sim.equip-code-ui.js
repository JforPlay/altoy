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
} from './fleet-sim.data.js';
import { encodeEquipCode, decodeEquipCode } from '../equip/equip-code.js';

let state = null;
let callbacks = null;
let activeSlot = -1;

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

    const maps = getEquipCodeMaps();
    const exportInput = document.getElementById('equip-code-export');
    const copyBtn = document.getElementById('equip-code-copy');
    const code = maps ? encodeEquipCode(_buildEntries(slotConfig, ship), maps) : null;
    if (exportInput) exportInput.value = code || '';
    if (copyBtn) copyBtn.disabled = !code;

    const importInput = document.getElementById('equip-code-import');
    if (importInput) importInput.value = '';
    _renderNotices([]);
    _hideGidActions();

    openModal('equipCodeModal');
    if (code && exportInput) requestAnimationFrame(() => exportInput.select());
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
    // 가져오기 wiring lands in Task 8 (_handleApplyClick).
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

// Task 8 fills these in:
function _handleApplyClick() {}
function _applyPending(_switchShip) {}
