/**
 * fleet-sim.tech-ui.js — the 함종 기술 override modal.
 *
 * The grid is derived, not authored: one section per hull type that
 * ship_group_data actually grants a bonus to, one row per stat that type can
 * receive. Adding a hull type or a new tech stat upstream therefore needs no
 * change here.
 *
 * Every cell shows the tracker-derived value as its placeholder and the roster
 * ceiling as its max, so a visitor who never opened the tracker can still read
 * off what "full" would be. A cell only becomes an override once it is typed
 * into — that is what keeps a tracker user from having to re-enter eighty cells
 * to correct one (see fleet-sim.tech.js).
 *
 * DOM only; all arithmetic lives in fleet-sim.tech.js.
 */

import { openModal, setupModal, escapeHtml } from '../utils.js';
import { TECH_STATS } from './fleet-sim.tech.js';

const MODAL_ID = 'techOverrideModal';

let state;
let onChange = () => {};
let deps = {};

/**
 * @param {object} stateRef shared fleet-sim state (reads shipTypeData, techOverride)
 * @param {{caps:Function, derived:Function, onChange:Function}} options
 *   caps()/derived() return { shipType: { stat: value } }; onChange() persists +
 *   re-renders after the override object was mutated in place.
 */
export function setupTechUI(stateRef, options = {}) {
    state = stateRef;
    deps = options;
    onChange = options.onChange || (() => {});
    setupModal(MODAL_ID, { restoreFocus: true });

    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    modal.addEventListener('input', (e) => {
        const input = e.target.closest('input[data-tech-stat]');
        if (input) _writeCell(input);
    });

    modal.addEventListener('click', (e) => {
        const reset = e.target.closest('[data-tech-reset]');
        if (!reset) return;
        const type = reset.dataset.techReset;
        if (type === 'all') state.techOverride = {};
        else delete state.techOverride[type];
        onChange();
        renderTechModal();
    });
}

export function openTechModal() {
    renderTechModal();
    openModal(MODAL_ID);
}

/** Commit one edited cell into state.techOverride (blank ⇒ back to derived). */
function _writeCell(input) {
    const type = input.dataset.techType;
    const stat = input.dataset.techStat;
    const max = Number(input.max) || 0;
    const raw = input.value.trim();

    if (raw === '') {
        if (state.techOverride[type]) {
            delete state.techOverride[type][stat];
            if (!Object.keys(state.techOverride[type]).length) delete state.techOverride[type];
        }
    } else {
        // Clamp here as well as in parseTechOverride: a number input still accepts
        // out-of-range text typed by hand, and the visitor should see it snap.
        const value = Math.max(0, Math.min(max, Math.round(Number(raw) || 0)));
        if (String(value) !== raw) input.value = String(value);
        (state.techOverride[type] || (state.techOverride[type] = {}))[stat] = value;
    }

    input.closest('.tech-cell')?.classList.toggle('is-override', raw !== '');
    onChange();
}

function _typeName(typeId) {
    const info = state.shipTypeData?.[String(typeId)];
    const name = info?.type_name || info?.name;
    return (name || `함종 ${typeId}`).trim();
}

function renderTechModal() {
    const body = document.getElementById('tech-override-body');
    if (!body) return;

    const caps = deps.caps ? deps.caps() : {};
    const derived = deps.derived ? deps.derived() : {};
    const override = state.techOverride || {};

    const sections = Object.keys(caps)
        .map(Number)
        .sort((a, b) => a - b)
        .map((type) => {
            const cap = caps[type] || {};
            const cells = TECH_STATS.filter((s) => cap[s.key]).map((s) => {
                const max = cap[s.key];
                const own = override[type]?.[s.key];
                const auto = derived[type]?.[s.key] || 0;
                return `
                <label class="tech-cell${own == null ? '' : ' is-override'}">
                    <span class="tech-cell-label">${escapeHtml(s.label)}</span>
                    <input type="number" inputmode="numeric" min="0" max="${max}" step="1"
                           value="${own == null ? '' : own}" placeholder="${auto}"
                           data-tech-type="${type}" data-tech-stat="${s.key}"
                           aria-label="${escapeHtml(_typeName(type))} ${escapeHtml(s.label)}" />
                    <span class="tech-cell-max">/ ${max}</span>
                </label>`;
            }).join('');
            if (!cells) return '';
            return `
            <section class="tech-type-block">
                <header class="tech-type-head">
                    <h4>${escapeHtml(_typeName(type))}</h4>
                    <button type="button" class="btn btn-ghost btn-sm" data-tech-reset="${type}">초기화</button>
                </header>
                <div class="tech-cell-grid">${cells}</div>
            </section>`;
        }).join('');

    body.innerHTML = sections || `
        <div class="page-status page-status-empty page-status--compact">
            <span class="material-symbols-outlined page-status-icon">info</span>
            <p class="page-status-msg">함종 기술 데이터를 불러오지 못했습니다</p>
        </div>`;
}
