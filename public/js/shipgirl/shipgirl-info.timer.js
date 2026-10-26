/**
 * shipgirl-info.timer.js
 * 건조 시간표 popup: every construction timer as a row of shipyard-art cards, with a
 * digit-prefix search, pool / 등급 / 진영 / 함종 filters and a 30-minute distribution chart.
 * Reads only the lite ship list already loaded at boot. Part of the shipgirl-info module
 * group; state is shared via a ref passed to setup().
 */

import { setupModal, openModal, closeModal, createImg, IMG_FALLBACKS, escapeHtml, debounce } from '../utils.js';

'use strict';

// ============================================
// PURE HELPERS (node-tested)
// ============================================

export const POOLS = [
    { key: 'light', label: '소형' },
    { key: 'heavy', label: '중형' },
    { key: 'special', label: '특형' },
    { key: 'limited', label: '한정' },
];

/** Ships with a timer and at least one pool flag. μ장비 / META / collab entries are kept. */
export function timerShips(ships) {
    return ships.filter(s => s.timer != null && POOLS.some(p => s[p.key] === true));
}

/** pool 'all' = any pool flag (already guaranteed by timerShips). */
export function filterTimerShips(ships, { pool = 'all', rarity = '', nationality = '', type = '' } = {}) {
    return ships.filter(s =>
        (pool === 'all' || s[pool] === true)
        && (!rarity || s.rarity === rarity)
        && (!nationality || String(s.nationality) === nationality)
        && (!type || String(s.type) === type));
}

/** Digit-prefix match on HHMMSS; a query with no digits matches everything. */
export function matchesTimerQuery(timer, query) {
    const digits = String(query).replace(/\D/g, '');
    return timer.replace(/\D/g, '').startsWith(digits);
}

/** Groups ascending by timer ("HH:MM:SS" sorts as text); ships keep their input order. */
export function groupByTimer(ships) {
    const byTimer = new Map();
    for (const s of ships) {
        if (!byTimer.has(s.timer)) byTimer.set(s.timer, []);
        byTimer.get(s.timer).push(s);
    }
    return [...byTimer.keys()].sort().map(timer => ({ timer, ships: byTimer.get(timer) }));
}

/** 30-minute bucket index. */
export function timerBucket(timer) {
    const [h, m] = timer.split(':').map(Number);
    return Math.floor((h * 60 + m) / 30);
}

export function bucketCounts(ships, size) {
    const counts = new Array(size).fill(0);
    for (const s of ships) counts[timerBucket(s.timer)]++;
    return counts;
}

/** Non-zero pools in POOLS order; a ship in two pools counts in both. */
export function poolBreakdown(ships) {
    return POOLS
        .map(({ key, label }) => ({ key, label, count: ships.filter(s => s[key] === true).length }))
        .filter(p => p.count > 0);
}

/** groups come sorted ascending, so keeping the first strict maximum makes the earliest win a tie. */
export function summarize(groups) {
    let top = null;
    for (const g of groups) {
        if (!top || g.ships.length > top.count) top = { timer: g.timer, count: g.ships.length };
    }
    return { count: groups.reduce((n, g) => n + g.ships.length, 0), timers: groups.length, top };
}

// ============================================
// POPUP
// ============================================

const MODAL_ID = 'buildTimerModal';

let state;               // shared state ref from shipgirl-info.js
let included = null;     // timerShips(state.shipgirlData), built on first open
let size = 0;            // bar count: highest bucket over all included ships + 1
let els = null;
const controls = { pool: 'all', rarity: '', nationality: '', type: '' };
let activeBucket = null; // chart bar filter; the search and a bar never apply together

export function setup(stateRef) {
    state = stateRef;
    // A manual close (X / ESC / backdrop) clears the flag so a later back doesn't reopen it.
    setupModal(MODAL_ID, {
        closeOnEscape: true, closeOnBackdrop: true, restoreFocus: true,
        onClose: () => history.replaceState({ ...history.state, timerOpen: false }, ''),
    });
    document.getElementById('buildTimerBtn')?.addEventListener('click', openTimer);
}

/** Detail route (e.g. Forward after a restore): close without onClose, so the flag survives. */
export function hideTimer() {
    closeModal(MODAL_ID, { restoreFocus: false });
}

/** Back from a candidate's detail view lands on the main view; reopen the popup it came from. */
export function restoreTimerFromHistory() {
    if (!history.state?.timerOpen) return;
    openTimer();
    const dialog = document.querySelector(`#${MODAL_ID} .c-modal-dialog`);
    if (dialog) dialog.scrollTop = history.state.timerScroll ?? 0;
}

function openTimer() {
    if (!included) {
        if (!state.shipgirlData?.length) return; // catalog still loading
        build();
    }
    openModal(MODAL_ID, { restoreFocus: true });
    render();
}

function build() {
    included = timerShips(state.shipgirlData);
    size = included.reduce((max, s) => Math.max(max, timerBucket(s.timer)), -1) + 1;
    const $ = (id) => document.getElementById(id);
    els = {
        search: $('btSearch'), summary: $('btSummary'), chart: $('btChart'), rows: $('btRows'),
        pools: document.querySelector(`#${MODAL_ID} .bt-pools`),
        rarity: $('btRarity'), nationality: $('btNationality'), type: $('btType'),
    };
    fillOptions(els.nationality, 'nationality', id => state.nationalityData[id]?.name ?? `진영 ${id}`);
    fillOptions(els.type, 'type', id => state.shipTypeData[id]?.type_name ?? `함종 ${id}`);

    els.search.addEventListener('input', debounce(() => { activeBucket = null; render(); }, 120));
    els.pools.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-pool]');
        if (!btn) return;
        controls.pool = btn.dataset.pool;
        for (const b of els.pools.querySelectorAll('[data-pool]')) {
            b.classList.toggle('is-active', b === btn);
            b.setAttribute('aria-pressed', String(b === btn));
        }
        render();
    });
    for (const key of ['rarity', 'nationality', 'type']) {
        els[key].addEventListener('change', () => { controls[key] = els[key].value; render(); });
    }
    els.chart.addEventListener('click', (e) => {
        const bar = e.target.closest('.bt-bar');
        if (!bar || bar.disabled) return;
        const bucket = Number(bar.dataset.bucket);
        activeBucket = activeBucket === bucket ? null : bucket;
        els.search.value = '';
        render();
        els.chart.querySelector(`.bt-bar[data-bucket="${bucket}"]`).focus(); // render() replaced the bar
    });
    els.rows.addEventListener('click', (e) => {
        const card = e.target.closest('.shipgirl-card');
        if (!card) return;
        // Stamp the main-view entry so back from the detail view reopens the popup.
        const dialog = card.closest('.c-modal-dialog');
        history.replaceState({ ...history.state, timerOpen: true, timerScroll: dialog?.scrollTop ?? 0 }, '');
        closeModal(MODAL_ID, { restoreFocus: false });
        state.navigateToDetail(card.dataset.shipName, Number(card.dataset.gid));
    });
}

/** Same option building as the main rail's populateFilterOptions, over the included ships. */
function fillOptions(select, key, label) {
    const ids = [...new Set(included.map(s => String(s[key])))].sort((a, b) => a - b);
    select.insertAdjacentHTML('beforeend',
        ids.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(label(id))}</option>`).join(''));
}

function render() {
    const query = els.search.value;
    const base = filterTimerShips(included, controls);
    const shown = base.filter(s => matchesTimerQuery(s.timer, query)
        && (activeBucket == null || timerBucket(s.timer) === activeBucket));
    const groups = groupByTimer(shown);
    // Highlight search hits only while the search has digits; otherwise every bar would "match".
    const hits = /\d/.test(query) ? new Set(shown.map(s => timerBucket(s.timer))) : new Set();

    renderChart(bucketCounts(base, size), hits);
    const { count, timers, top } = summarize(groups);
    els.summary.innerHTML = `<b>${count}</b>명 · <b>${timers}</b>개 건조 시간`
        + (top ? ` · 최다 <b class="bt-mono">${escapeHtml(top.timer)}</b> (${top.count}명)` : '');
    els.rows.innerHTML = groups.length
        ? groups.map(rowHtml).join('')
        : '<p class="bt-empty">조건에 맞는 함순이가 없습니다.</p>';
}

function renderChart(counts, hits) {
    const max = Math.max(1, ...counts);
    const clock = (minutes) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
    // The pressed bar stays enabled when a filter empties it, so it can still be unpressed.
    const bars = counts.map((count, i) => `
        <button type="button" class="bt-bar${hits.has(i) || i === activeBucket ? ' is-hit' : ''}" data-bucket="${i}"
            aria-pressed="${i === activeBucket}"
            aria-label="${clock(i * 30)}–${clock(i * 30 + 30)} ${count}명"${count || i === activeBucket ? '' : ' disabled'}>
            <span class="bt-bar-count">${count || ''}</span>
            <span class="bt-bar-fill" style="--h: ${count / max}"></span>
        </button>`).join('');
    const axis = counts.map((_, i) => `<span>${i % 2 ? '' : `${i / 2}h`}</span>`).join('');
    els.chart.innerHTML = `<div class="bt-bars">${bars}</div><div class="bt-axis" aria-hidden="true">${axis}</div>`;
}

function rowHtml({ timer, ships }) {
    const breakdown = poolBreakdown(ships).map(p => `${p.label} ${p.count}`).join(' · ');
    return `
        <div class="bt-row" data-bucket="${timerBucket(timer)}">
            <div class="bt-label">
                <span class="bt-time bt-mono">${escapeHtml(timer)}</span>
                <span class="bt-count">${ships.length}명</span>
                <span class="bt-breakdown">${breakdown}</span>
            </div>
            <div class="bt-cards">${ships.map(cardHtml).join('')}</div>
        </div>`;
}

/** The main grid card's markup (createGridCard), name only — no 함종·진영 / 드랍 rows. */
function cardHtml(ship) {
    let badges = ship.limited ? '<span class="badge gbadge limited">★ 한정</span>' : '';
    for (const { key, label } of POOLS) {
        if (key !== 'limited' && ship[key]) badges += `<span class="badge gbadge">${label}</span>`;
    }
    return `
        <div class="shipgirl-card ${String(ship.rarity || '').toLowerCase()}" data-ship-name="${escapeHtml(ship.name)}" data-gid="${Number(ship.gid)}">
            ${createImg(ship.shipyard || '', ship.name || '', { className: 'art', fallback: IMG_FALLBACKS.CARD })}
            <div class="scrim"></div>
            ${badges ? `<div class="badges">${badges}</div>` : ''}
            <span class="rchip">${escapeHtml(ship.rarity || '')}</span>
            <div class="meta"><div class="gname">${escapeHtml(ship.name || '')}</div></div>
        </div>`;
}
