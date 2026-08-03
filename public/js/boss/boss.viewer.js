/**
 * boss.viewer.js
 * Page init for /map/boss-viewer: element collection, data bootstrap, filter
 * chips, grid render, and the ?boss= deep link.
 *
 * The detail drawer lives in boss.detail.js; pure formatting in ../boss-format.js.
 */
import {
    requireElements, loadPageData, renderStatus, escapeHtml, debounce, getUrlParam,
    ensureFuse, createSearchIndex,
} from '../utils.js';
import {
    setup as setupData, loadBossData, getAllIdentities, getIdentity, getPresentSources,
} from './boss.data.js';
import { setup as setupDetail, openBossDetail, closeBossDetail } from './boss.detail.js';
import {
    bossPortraitUrl, bossPortraitFallbackAttr, ARMOR_LABELS, SRC_LABELS, TYPE_LABELS,
} from '../boss-format.js';

const state = {
    data: null,
    list: [],
    filters: { src: null, armor: null, query: '' },
    searchIndex: null,
    selected: null,
};
const els = {};

// ===== Render =====

function renderGrid(list) {
    if (list.length === 0) {
        renderStatus(els.grid, '검색 결과가 없습니다.', 'empty');
        return;
    }
    els.grid.innerHTML = list.map((b) => `
        <button class="boss-card card-hover" type="button" data-icon="${escapeHtml(b.icon)}">
            <img class="boss-card-portrait" src="${escapeHtml(bossPortraitUrl(b))}"
                 alt="" loading="lazy"${bossPortraitFallbackAttr(b, escapeHtml)} data-onfail="hide">
            <span class="boss-card-name">${escapeHtml(b.name)}</span>
            <span class="boss-card-tags">
                <span class="badge badge--neutral">${escapeHtml(TYPE_LABELS[b.type] || '?')}</span>
                <span class="badge badge--neutral">${escapeHtml(ARMOR_LABELS[b.armor] || '')}</span>
            </span>
            <span class="boss-card-count">출현 ${b.app.length}곳</span>
        </button>`).join('');
}

/** An identity matches a source if ANY appearance has it — 즈이카쿠 is both 일반해역 and 하드. */
function applyFilters() {
    let list = getAllIdentities();
    const { src, armor, query } = state.filters;
    if (src) list = list.filter((b) => b.app.some((a) => a.src === src));
    if (armor) list = list.filter((b) => b.armor === armor);
    if (query) {
        const hits = state.searchIndex
            ? state.searchIndex.search(query).map((r) => r.item)
            : getAllIdentities().filter((b) => b.name.includes(query));
        const allowed = new Set(list);
        list = hits.filter((b) => allowed.has(b));
    }
    renderGrid(list);
    els.count.textContent = `${list.length}종`;
}

function renderChips() {
    const present = getPresentSources();
    const srcChips = Object.entries(SRC_LABELS)
        .filter(([src]) => present.has(src))
        .map(([src, label]) =>
            `<button class="chip" type="button" data-filter="src" data-value="${escapeHtml(src)}">${escapeHtml(label)}</button>`)
        .join('');
    const armorChips = Object.entries(ARMOR_LABELS).map(([val, label]) =>
        `<button class="chip" type="button" data-filter="armor" data-value="${escapeHtml(val)}">${escapeHtml(label)}</button>`
    ).join('');
    els.filters.innerHTML =
        `<div class="boss-chip-row">${srcChips}</div><div class="boss-chip-row">${armorChips}</div>`;
}

/** Clicking the active chip clears that filter. */
function onChipClick(e) {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const { filter, value } = chip.dataset;
    const next = filter === 'armor' ? Number(value) : value;
    state.filters[filter] = state.filters[filter] === next ? null : next;
    els.filters.querySelectorAll(`.chip[data-filter="${filter}"]`).forEach((c) => {
        c.classList.toggle('active', state.filters[filter] !== null
            && String(state.filters[filter]) === c.dataset.value);
    });
    applyFilters();
}

// ===== Init =====

document.addEventListener('DOMContentLoaded', async () => {
    els.grid = document.getElementById('bossGrid');
    els.search = document.getElementById('bossSearch');
    els.filters = document.getElementById('bossFilters');
    els.count = document.getElementById('bossCount');
    els.detailPanel = document.getElementById('bossDetailPanel');
    els.detailBackdrop = document.getElementById('bossDetailBackdrop');
    els.detailContent = document.getElementById('bossDetailContent');
    els.detailTitle = document.getElementById('bossDetailTitle');
    els.detailClose = document.getElementById('bossDetailClose');
    if (!requireElements(els, 'BossViewer')) return;

    setupData(state);
    setupDetail(state, els);

    const data = await loadPageData(() => loadBossData(), els.grid, { contextLabel: 'BossViewer' });
    if (data === null) return;

    await ensureFuse();
    state.searchIndex = createSearchIndex(getAllIdentities(), { keys: ['name'], threshold: 0.3 });

    renderChips();
    applyFilters();

    els.filters.addEventListener('click', onChipClick);
    els.search.addEventListener('input', debounce(() => {
        state.filters.query = els.search.value.trim();
        applyFilters();
    }, 250));

    els.grid.addEventListener('click', (e) => {
        const card = e.target.closest('.boss-card');
        if (card) openBossDetail(card.dataset.icon);
    });
    els.detailClose.addEventListener('click', closeBossDetail);
    els.detailBackdrop.addEventListener('click', closeBossDetail);

    // Deep link from map-viewer. Guarded so a stale icon no-ops instead of
    // opening an empty drawer.
    const deepLink = getUrlParam('boss');
    if (deepLink && getIdentity(deepLink)) openBossDetail(deepLink);
});
