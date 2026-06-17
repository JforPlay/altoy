/**
 * equip.hearing-view.js
 * 청문회 (commentary) render mode for the equipment viewer.
 * Renders the shared, already-filtered equip list (state.filteredData) as
 * enriched cards: icon + name + 별명 + stats + the FIRST 한줄평 (full text), with
 * a "+N 한줄평 더" affordance when an equip has more reviews (all reviews live in
 * the detail panel). Commented-only; SP weapons excluded.
 * Part of the equip viewer module group; shares state via setup(stateRef, ctx).
 */

import { escapeHtml, renderStatus } from '../utils.js';
import { getEquipIconUrl, getRarityBgUrl, getHearingEntry } from './equip.data.js';

let state;
let ctx;

/** Receive shared state + viewer callbacks ({ onCardClick, sortEquips }). */
export function setup(stateRef, context) {
    state = stateRef;
    ctx = context || {};
}

/**
 * Render one 한줄평 string into the inner HTML of a `.hearing-comment` bubble.
 * Each REAL line break (\n) becomes its own `.hearing-line` block, so the
 * inter-line gap (CSS) applies ONLY between actual lines — a long line that
 * soft-wraps to fit the card width stays tight. Each line is escaped.
 * Shared by the card (buildHearingCard) and the detail panel (equip.detail.js).
 */
export function renderHearingComment(text) {
    return String(text || '')
        .split('\n')
        .map(line => `<span class="hearing-line">${escapeHtml(line)}</span>`)
        .join('');
}

/**
 * Render the 청문회 grid into #equipGrid: commented, non-SP entries from
 * state.filteredData, grouped by type, each type group a masonry block.
 * Cards within a group honor the active sort (via ctx.sortEquips) so the sort
 * control behaves identically to 그리드 mode.
 */
export function renderHearingGrid() {
    const grid = state.elements.equipGrid;
    if (!grid) return;
    grid.classList.add('mode-hearing');

    const visible = state.filteredData.filter(e => !e._isSPWeapon && getHearingEntry(e.id));

    if (visible.length === 0) {
        renderStatus(grid, '표시할 한줄평이 없습니다.', 'empty');
        return;
    }

    // Group by type — mirror renderEquipGrid's grouping
    const groups = new Map();
    for (const equip of visible) {
        const typeName = equip.type_name2 || equip.type_name || `타입 ${equip.type}`;
        if (!groups.has(typeName)) groups.set(typeName, []);
        groups.get(typeName).push(equip);
    }

    const fragment = document.createDocumentFragment();
    for (const [typeName, equips] of groups) {
        const section = document.createElement('div');
        section.className = 'equip-type-section';
        section.innerHTML = `
            <div class="type-section-header section-title">
                <h2>${escapeHtml(typeName)}</h2>
                <span class="type-section-count">(${equips.length})</span>
            </div>`;
        fragment.appendChild(section);

        const masonry = document.createElement('div');
        masonry.className = 'card-grid hearing-masonry';
        const sorted = ctx.sortEquips ? ctx.sortEquips(equips) : equips;
        for (const equip of sorted) {
            masonry.appendChild(buildHearingCard(equip));
        }
        fragment.appendChild(masonry);
    }

    grid.innerHTML = '';
    grid.appendChild(fragment);
}

/** Build one enriched 청문회 card element. */
function buildHearingCard(equip) {
    const entry = getHearingEntry(equip.id);
    const iconUrl = getEquipIconUrl(equip.icon);
    const bgUrl = getRarityBgUrl(equip.rarity);
    const reviews = entry.reviews || [];
    const first = reviews[0] || '';
    const moreCount = Math.max(0, reviews.length - 1);

    let statsHtml = (equip.max_attrs || []).map(attr =>
        `<span class="equip-stat-item"><span class="equip-stat-name">${escapeHtml(attr.name)}</span><span class="equip-stat-value">${escapeHtml(String(attr.value))}</span></span>`
    ).join('');
    if (equip._reloadTime != null) {
        statsHtml += `<span class="equip-stat-item equip-stat-reload"><span class="equip-stat-name">사속</span><span class="equip-stat-value">${equip._reloadTime}s</span></span>`;
    }

    const card = document.createElement('div');
    card.className = `hearing-card rarity-${equip.rarity}`;
    card.dataset.equipId = equip.id;
    card.innerHTML = `
        <div class="hearing-card-header">
            <div class="equip-icon-wrapper">
                <img class="equip-icon-bg-img" src="${bgUrl}" alt="" loading="lazy">
                ${iconUrl ? `<img class="equip-icon-img" src="${iconUrl}" alt="${escapeHtml(equip.name)}" loading="lazy">` : ''}
            </div>
            <div class="equip-card-info">
                <div class="hearing-card-name">${escapeHtml(equip.name)}${entry.alias ? `<span class="hearing-alias">${escapeHtml(entry.alias)}</span>` : ''}</div>
                <div class="equip-card-meta">
                    <span class="equip-rarity-badge rarity-${equip.rarity}">${escapeHtml(equip.rarity_name)}</span>
                    ${equip.nation_code ? `<span class="equip-nation-code">${escapeHtml(equip.nation_code)}</span>` : ''}
                </div>
                ${statsHtml ? `<div class="equip-card-stats">${statsHtml}</div>` : ''}
            </div>
        </div>
        <div class="hearing-card-comments">
            ${first ? `<div class="hearing-comment">${renderHearingComment(first)}</div>` : ''}
            ${moreCount > 0 ? `<div class="hearing-more">+${moreCount} 한줄평 더 ▸</div>` : ''}
        </div>`;

    card.addEventListener('click', () => {
        if (ctx.onCardClick) ctx.onCardClick(equip.id);
    });
    return card;
}
