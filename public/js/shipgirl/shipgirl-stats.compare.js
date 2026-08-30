'use strict';

/**
 * shipgirl-stats.compare.js
 * Floating compare bar and side-by-side comparison modal for ship combat stats
 * and skin counts. Shared state is injected via setup(stateRef).
 */

import { IMG_FALLBACKS, createImgElement, openModal, setupModal, sanitizeClassToken } from '../utils.js';
import {
    ALL_STATS,
    getAttrKoreanName, getShipIconUrl,
} from './shipgirl-stats.data.js';

let state;

export function setup(stateRef) {
    state = stateRef;

    setupModal('compareModal', {
        closeOnEscape: true,
        closeOnBackdrop: true,
        closeButtonSelector: '#compareModalClose, .compare-modal-close',
        restoreFocus: true,
    });
}

// ===== Compare Bar =====

/**
 * Refresh the floating compare bar with the current compareList.
 * Shows/hides the bar and rebuilds ship name + icon entries.
 */
export function updateCompareBar() {
    const bar = document.getElementById('compareBar');
    const itemsEl = document.getElementById('compareBarItems');
    const btn = document.getElementById('compareBtn');
    if (!bar || !itemsEl || !btn) return;

    if (state.compareList.length === 0) {
        bar.classList.remove('is-active');
        return;
    }

    bar.classList.add('is-active');
    btn.disabled = state.compareList.length < 2
        || (state.activeTab === 'skin' && !state.skinDataReady);

    const fragment = document.createDocumentFragment();
    for (const id of state.compareList) {
        const entry = state.shipStatsById.get(id);
        if (!entry) continue;
        const div = document.createElement('div');
        div.className = 'compare-bar-item';
        div.appendChild(createCompareImage(entry.ship, 'compare-bar-item-icon'));

        const name = document.createElement('span');
        name.textContent = entry.displayName;
        div.appendChild(name);

        fragment.appendChild(div);
    }
    itemsEl.replaceChildren(fragment);
}

// ===== Compare Modal =====

/**
 * Open the comparison modal, rendering either combat stats or skin counts
 * depending on the active tab.
 */
export function openCompareModal() {
    if (state.compareList.length < 2) return;
    if (state.activeTab === 'skin' && !state.skinDataReady) return;

    const entries = state.compareList
        .map(id => state.shipStatsById.get(id))
        .filter(Boolean);
    if (entries.length < 2) return;

    const body = document.getElementById('compareModalBody');
    if (!body) return;

    const colClass = `cols-${entries.length}`;
    const title = document.getElementById('compareModalTitleText');
    if (title) {
        title.textContent = state.activeTab === 'ship' ? '함순이 비교' : '스킨 비교';
    }

    if (state.activeTab === 'ship') {
        body.replaceChildren(renderCombatCompare(entries, colClass));
    } else {
        body.replaceChildren(renderSkinCompare(entries, colClass));
    }

    openModal('compareModal');
}

// ===== Combat Compare =====

function renderCombatCompare(entries, colClass) {
    const fragment = document.createDocumentFragment();
    const grid = createCompareGrid(entries, colClass);
    fragment.appendChild(grid);

    for (const stat of ALL_STATS) {
        const values = entries.map(e => e.combat[stat] || 0);
        const maxVal = Math.max(...values);
        const globalMax = getGlobalMax(stat, 'combat');

        const cells = values.map(v => {
            const isBest = v === maxVal && maxVal > 0;
            const cell = document.createElement('div');
            cell.className = 'compare-stat-val';
            if (isBest) cell.classList.add('is-best');
            cell.appendChild(document.createTextNode(v.toLocaleString()));

            const bar = document.createElement('div');
            bar.className = 'compare-stat-bar';

            const fill = document.createElement('div');
            fill.className = 'compare-stat-bar-fill';
            if (isBest) fill.classList.add('is-best');
            fill.style.width = `${globalMax > 0 ? Math.min(100, Math.max(0, v / globalMax * 100)) : 0}%`;

            bar.appendChild(fill);
            cell.appendChild(bar);
            return cell;
        });

        fragment.appendChild(createStatRow(getAttrKoreanName(stat), cells, colClass));
    }

    return fragment;
}

// ===== Skin Compare =====

function renderSkinCompare(entries, colClass) {
    const fragment = document.createDocumentFragment();
    const grid = createCompareGrid(entries, colClass);
    fragment.appendChild(grid);

    const skinKeys = [
        { key: 'total',        label: '총 스킨' },
        { key: 'L2D',          label: 'L2D' },
        { key: 'L2D+',         label: 'L2D+' },
        { key: '듀얼',          label: '듀얼' },
        { key: '쁘띠모션',      label: '쁘띠모션' },
        { key: 'totalGems',    label: '총 다이아' },
        { key: 'latestDate',   label: '최근 스킨' },
        { key: 'daysSinceLast', label: '경과일' },
    ];

    for (const { key, label } of skinKeys) {
        const values = entries.map(e => e.skin[key]);
        const numericValues = values.map(v => (typeof v === 'number' ? v : 0));
        const maxVal = Math.max(...numericValues);

        const cells = values.map((v, i) => {
            const isNumeric = typeof v === 'number';
            const isBest = isNumeric && key !== 'daysSinceLast' && numericValues[i] === maxVal && maxVal > 0;

            let displayVal;
            if (key === 'daysSinceLast') {
                displayVal = v != null ? `${v}일` : '-';
            } else if (key === 'totalGems') {
                displayVal = v > 0 ? v.toLocaleString() : '-';
            } else {
                displayVal = v != null ? v : '-';
            }

            const cell = document.createElement('div');
            cell.className = 'compare-stat-val';
            if (isBest) cell.classList.add('is-best');
            cell.textContent = displayVal;
            return cell;
        });

        fragment.appendChild(createStatRow(label, cells, colClass));
    }

    return fragment;
}

// ===== Helpers =====

function createCompareGrid(entries, colClass) {
    const grid = document.createElement('div');
    grid.className = `compare-grid ${colClass}`;

    for (const entry of entries) {
        const header = document.createElement('div');
        header.className = 'compare-ship-header';
        header.appendChild(createCompareImage(entry.ship));

        const name = document.createElement('div');
        name.className = 'ship-name';
        name.textContent = entry.displayName;
        header.appendChild(name);

        const rarity = document.createElement('span');
        rarity.className = `table-rarity rarity-${sanitizeClassToken(entry.rarity)}`;
        rarity.textContent = entry.rarity;
        header.appendChild(rarity);

        grid.appendChild(header);
    }

    return grid;
}

function createCompareImage(ship, className = '') {
    return createImgElement(getShipIconUrl(ship), ship?.name ?? '', {
        className,
        fallback: IMG_FALLBACKS.DEFAULT,
    });
}

function createStatRow(label, cells, colClass) {
    const row = document.createElement('div');
    row.className = 'compare-stat-row';

    const labelEl = document.createElement('div');
    labelEl.className = 'compare-stat-label';
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const values = document.createElement('div');
    values.className = `compare-stat-values ${colClass}`;
    for (const cell of cells) {
        values.appendChild(cell);
    }
    row.appendChild(values);

    return row;
}

function getGlobalMax(stat, type) {
    let max = 0;
    for (const entry of state.shipStats) {
        // entry.skin stays null until the skin tab loads its data (see
        // shipgirl-stats.data.js ensureSkinData).
        const val = type === 'combat' ? (entry.combat[stat] || 0) : (entry.skin?.[stat] || 0);
        if (val > max) max = val;
    }
    return max;
}
