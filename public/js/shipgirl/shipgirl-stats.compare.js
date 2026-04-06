'use strict';

/**
 * shipgirl-stats.compare.js
 * Floating compare bar and side-by-side comparison modal for ship combat stats
 * and skin counts. Shared state is injected via setup(stateRef).
 */

import { IMG_FALLBACKS, openModal, closeModal, setupModal } from '../utils.js';
import {
    PRIMARY_STATS, SECONDARY_STATS, ALL_STATS, SKIN_TAG_KEYS,
    getAttrKoreanName, getNationalityName, getShipTypeName, getShipIconUrl,
} from './shipgirl-stats.data.js';

let state;

export function setup(stateRef) {
    state = stateRef;

    setupModal('compareModal', {
        closeOnEscape: true,
        closeOnBackdrop: true,
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
    btn.disabled = state.compareList.length < 2;

    const fragment = document.createDocumentFragment();
    for (const id of state.compareList) {
        const entry = state.shipStatsById.get(id);
        if (!entry) continue;
        const name = entry.ship.name;
        const div = document.createElement('div');
        div.className = 'compare-bar-item';
        div.innerHTML = `
            <img src="${getShipIconUrl(entry.ship)}" alt="${name}" onerror="this.src='${IMG_FALLBACKS.DEFAULT}'">
            <span>${name}</span>
        `;
        fragment.appendChild(div);
    }
    itemsEl.innerHTML = '';
    itemsEl.appendChild(fragment);
}

// ===== Compare Modal =====

/**
 * Open the comparison modal, rendering either combat stats or skin counts
 * depending on the active tab.
 */
export function openCompareModal() {
    if (state.compareList.length < 2) return;

    const entries = state.compareList
        .map(id => state.shipStatsById.get(id))
        .filter(Boolean);

    const body = document.getElementById('compareModalBody');
    if (!body) return;

    const colClass = `cols-${entries.length}`;

    if (state.activeTab === 'ship') {
        body.innerHTML = renderCombatCompare(entries, colClass);
    } else {
        body.innerHTML = renderSkinCompare(entries, colClass);
    }

    openModal('compareModal');
}

// ===== Combat Compare =====

function renderCombatCompare(entries, colClass) {
    const headers = entries.map(e => `
        <div class="compare-ship-header">
            <img src="${getShipIconUrl(e.ship)}" alt="${e.ship.name}" onerror="this.src='${IMG_FALLBACKS.DEFAULT}'">
            <div class="ship-name">${e.ship.name}</div>
            <span class="table-rarity rarity-${e.ship.rarity}">${e.ship.rarity}</span>
        </div>
    `).join('');

    const statRows = ALL_STATS.map(stat => {
        const values = entries.map(e => e.combat[stat] || 0);
        const maxVal = Math.max(...values);
        const globalMax = getGlobalMax(stat, 'combat');

        const valueCells = values.map(v => `
            <div class="compare-stat-val ${v === maxVal && maxVal > 0 ? 'is-best' : ''}">
                ${v.toLocaleString()}
                <div class="compare-stat-bar">
                    <div class="compare-stat-bar-fill ${v === maxVal && maxVal > 0 ? 'is-best' : ''}" style="width:${globalMax > 0 ? (v / globalMax * 100) : 0}%"></div>
                </div>
            </div>
        `).join('');

        return `
            <div class="compare-stat-row">
                <div class="compare-stat-label">${getAttrKoreanName(stat)}</div>
                <div class="compare-stat-values ${colClass}">${valueCells}</div>
            </div>
        `;
    }).join('');

    return `
        <div class="compare-grid ${colClass}">${headers}</div>
        ${statRows}
    `;
}

// ===== Skin Compare =====

function renderSkinCompare(entries, colClass) {
    const headers = entries.map(e => `
        <div class="compare-ship-header">
            <img src="${getShipIconUrl(e.ship)}" alt="${e.ship.name}" onerror="this.src='${IMG_FALLBACKS.DEFAULT}'">
            <div class="ship-name">${e.ship.name}</div>
            <span class="table-rarity rarity-${e.ship.rarity}">${e.ship.rarity}</span>
        </div>
    `).join('');

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

    const skinRows = skinKeys.map(({ key, label }) => {
        const values = entries.map(e => e.skin[key]);
        const numericValues = values.map(v => (typeof v === 'number' ? v : 0));
        const maxVal = Math.max(...numericValues);

        const valueCells = values.map((v, i) => {
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

            return `<div class="compare-stat-val ${isBest ? 'is-best' : ''}">${displayVal}</div>`;
        }).join('');

        return `
            <div class="compare-stat-row">
                <div class="compare-stat-label">${label}</div>
                <div class="compare-stat-values ${colClass}">${valueCells}</div>
            </div>
        `;
    }).join('');

    return `
        <div class="compare-grid ${colClass}">${headers}</div>
        ${skinRows}
    `;
}

// ===== Helpers =====

function getGlobalMax(stat, type) {
    let max = 0;
    for (const entry of state.shipStats) {
        const val = type === 'combat' ? (entry.combat[stat] || 0) : (entry.skin[stat] || 0);
        if (val > max) max = val;
    }
    return max;
}
