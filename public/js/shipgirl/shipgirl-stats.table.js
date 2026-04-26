'use strict';

/**
 * shipgirl-stats.table.js
 * Sortable, paginated ranking tables for the ship info and skin info tabs.
 * Renders column headers (with click-to-sort), per-page rows with ship icons,
 * rarity chips, and stat/skin count cells, plus a page-number pagination strip.
 */

import { createImgElement, IMG_FALLBACKS } from '../utils.js';
import {
    getNationalityName,
    getShipTypeName,
    getShipIconUrl,
} from './shipgirl-stats.data.js';

// ===== Constants =====

const ROWS_PER_PAGE = 50;

const RARITY_ORDER = { UR: 5, SSR: 4, SR: 3, R: 2, N: 1 };

// ===== Column Definitions =====

/** @type {Array<{key: string, label: string, sortKey?: string, className?: string, sortable?: boolean, isStat?: boolean, hidden?: boolean}>} */
const SHIP_COLUMNS = [
    { key: 'compare', label: '', className: 'col-compare', sortable: false },
    { key: 'icon', label: '', sortable: false },
    { key: 'name', label: '이름', sortKey: 'name' },
    { key: 'rarity', label: '등급', sortKey: 'rarity' },
    { key: 'nationality', label: '진영', sortKey: 'nationality' },
    { key: 'type', label: '함종', sortKey: 'type' },
    { key: 'health', label: '내구', sortKey: 'health', isStat: true },
    { key: 'firepower', label: '포격', sortKey: 'firepower', isStat: true },
    { key: 'torpedo', label: '뇌장', sortKey: 'torpedo', isStat: true },
    { key: 'antiair', label: '대공', sortKey: 'antiair', isStat: true },
    { key: 'aviation', label: '항공', sortKey: 'aviation', isStat: true },
    { key: 'reload', label: '장전', sortKey: 'reload', isStat: true },
    { key: 'accuracy', label: '명중', sortKey: 'accuracy', isStat: true },
    { key: 'evasion', label: '기동', sortKey: 'evasion', isStat: true },
    { key: 'speed', label: '항속', sortKey: 'speed', isStat: true, hidden: true },
    { key: 'luck', label: '행운', sortKey: 'luck', isStat: true, hidden: true },
    { key: 'asw', label: '대잠', sortKey: 'asw', isStat: true, hidden: true },
];

/** @type {Array<{key: string, label: string, sortKey?: string, className?: string, sortable?: boolean}>} */
const SKIN_COLUMNS = [
    { key: 'compare', label: '', className: 'col-compare', sortable: false },
    { key: 'icon', label: '', sortable: false },
    { key: 'name', label: '이름', sortKey: 'name' },
    { key: 'rarity', label: '등급', sortKey: 'rarity' },
    { key: 'nationality', label: '진영', sortKey: 'nationality' },
    { key: 'total', label: '총 스킨', sortKey: 'skin.total' },
    { key: 'L2D', label: 'L2D', sortKey: 'skin.L2D' },
    { key: 'L2D+', label: 'L2D+', sortKey: 'skin.L2D+' },
    { key: '듀얼', label: '듀얼', sortKey: 'skin.듀얼' },
    { key: '쁘띠모션', label: '쁘띠모션', sortKey: 'skin.쁘띠모션' },
    { key: 'totalGems', label: '총 다이아', sortKey: 'skin.totalGems' },
    { key: 'latestDate', label: '최근 스킨', sortKey: 'skin.latestDate' },
    { key: 'daysSinceLast', label: '경과일', sortKey: 'skin.daysSinceLast' },
];

// ===== State =====

let state;

export function setup(stateRef) {
    state = stateRef;
    state.shipSort = { key: 'name', dir: 'asc' };
    state.skinSort = { key: 'skin.total', dir: 'desc' };
    state.shipPage = 1;
    state.skinPage = 1;
    state.shipExpanded = false;
}

// ===== Sort Helpers =====

function getSortValue(entry, sortKey) {
    if (sortKey === 'name') return entry.ship.name;
    if (sortKey === 'rarity') return RARITY_ORDER[entry.ship.rarity] ?? 0;
    if (sortKey === 'nationality') return getNationalityName(entry.ship.nationality);
    if (sortKey === 'type') return getShipTypeName(entry.ship.type);

    if (sortKey.startsWith('skin.')) {
        const field = sortKey.slice(5);
        const val = entry.skin ? entry.skin[field] : null;
        return val == null ? -Infinity : val;
    }

    const statVal = entry.combat ? entry.combat[sortKey] : null;
    return statVal == null ? -Infinity : statVal;
}

function sortData(data, sortConfig) {
    const { key, dir } = sortConfig;
    const multiplier = dir === 'asc' ? 1 : -1;

    return [...data].sort((a, b) => {
        const va = getSortValue(a, key);
        const vb = getSortValue(b, key);

        if (typeof va === 'string' && typeof vb === 'string') {
            return multiplier * va.localeCompare(vb, 'ko');
        }

        if (va === -Infinity && vb === -Infinity) return 0;
        if (va === -Infinity) return 1;
        if (vb === -Infinity) return -1;

        return multiplier * (va - vb);
    });
}

// ===== Table Head =====

function renderTableHead(elementId, columns, sortConfig, tableType) {
    const thead = document.getElementById(elementId);
    if (!thead) return;

    const tr = document.createElement('tr');

    columns.forEach(col => {
        const th = document.createElement('th');
        if (col.className) th.className = col.className;
        if (col.hidden) th.classList.add('col-hidden');

        th.textContent = col.label;

        const sortable = col.sortable !== false && col.sortKey;
        if (sortable) {
            th.classList.add('sortable');

            if (sortConfig.key === col.sortKey) {
                th.classList.add(sortConfig.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
            }

            th.addEventListener('click', () => {
                let newDir;
                if (sortConfig.key === col.sortKey) {
                    newDir = sortConfig.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    newDir = col.isStat ? 'desc' : 'asc';
                }

                sortConfig.key = col.sortKey;
                sortConfig.dir = newDir;

                if (tableType === 'ship') {
                    state.shipPage = 1;
                    renderShipTable();
                } else {
                    state.skinPage = 1;
                    renderSkinTable();
                }
            });
        }

        tr.appendChild(th);
    });

    thead.innerHTML = '';
    thead.appendChild(tr);
}

// ===== Pagination =====

function renderPagination(elementId, currentPage, totalPages, tableType) {
    const container = document.getElementById(elementId);
    if (!container) return;

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    const fragment = document.createDocumentFragment();

    const goToPage = (page) => {
        if (tableType === 'ship') {
            state.shipPage = page;
            renderShipTable();
        } else {
            state.skinPage = page;
            renderSkinTable();
        }
        const table = document.getElementById(tableType === 'ship' ? 'shipTable' : 'skinTable');
        if (table) table.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const prevBtn = document.createElement('button');
    prevBtn.className = 'pagination-btn page-prev';
    prevBtn.textContent = '‹';
    prevBtn.disabled = currentPage === 1;
    prevBtn.addEventListener('click', () => { if (currentPage > 1) goToPage(currentPage - 1); });
    fragment.appendChild(prevBtn);

    const pageNumbers = getPageNumbers(currentPage, totalPages);
    pageNumbers.forEach(num => {
        if (num === null) {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'pagination-ellipsis';
            ellipsis.textContent = '…';
            fragment.appendChild(ellipsis);
        } else {
            const btn = document.createElement('button');
            btn.className = 'pagination-btn' + (num === currentPage ? ' active' : '');
            btn.textContent = String(num);
            btn.addEventListener('click', () => goToPage(num));
            fragment.appendChild(btn);
        }
    });

    const nextBtn = document.createElement('button');
    nextBtn.className = 'pagination-btn page-next';
    nextBtn.textContent = '›';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.addEventListener('click', () => { if (currentPage < totalPages) goToPage(currentPage + 1); });
    fragment.appendChild(nextBtn);

    container.innerHTML = '';
    container.appendChild(fragment);
}

function getPageNumbers(current, total) {
    if (total <= 7) {
        return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages = new Set();
    pages.add(1);
    pages.add(total);
    for (let i = Math.max(2, current - 2); i <= Math.min(total - 1, current + 2); i++) {
        pages.add(i);
    }

    const sorted = [...pages].sort((a, b) => a - b);
    const result = [];
    for (let i = 0; i < sorted.length; i++) {
        if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
            result.push(null);
        }
        result.push(sorted[i]);
    }
    return result;
}

// ===== Ship Table =====

/**
 * Render or re-render the ship-info ranking table for the current page and sort state.
 * Rebuilds the thead (with sort indicators), the tbody rows, and the pagination strip.
 */
export function renderShipTable() {
    const source = state.filteredShipStats || state.shipStats;
    if (!source) return;

    const sorted = sortData(source, state.shipSort);
    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / ROWS_PER_PAGE));

    if (state.shipPage > totalPages) state.shipPage = totalPages;

    const start = (state.shipPage - 1) * ROWS_PER_PAGE;
    const pageData = sorted.slice(start, start + ROWS_PER_PAGE);

    const countEl = document.getElementById('shipTableCount');
    if (countEl) countEl.textContent = `${total}명`;

    const tableEl = document.getElementById('shipTable');
    if (tableEl) {
        tableEl.classList.toggle('show-expanded', !!state.shipExpanded);
    }

    renderTableHead('shipTableHead', SHIP_COLUMNS, state.shipSort, 'ship');

    const tbody = document.getElementById('shipTableBody');
    if (!tbody) return;

    const fragment = document.createDocumentFragment();

    pageData.forEach(entry => {
        const tr = document.createElement('tr');
        tr.dataset.shipId = entry.ship?.id ?? '';

        SHIP_COLUMNS.forEach(col => {
            const td = document.createElement('td');
            if (col.className) td.className = col.className;
            if (col.hidden) td.classList.add('col-hidden');

            switch (col.key) {
                case 'compare': {
                    const shipId = String(entry.ship?.id ?? '');
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.className = 'compare-check';
                    cb.dataset.ship = shipId;
                    cb.checked = state.compareList.includes(shipId);
                    cb.setAttribute('aria-label', `${entry.ship?.name ?? ''} 비교 선택`);
                    td.appendChild(cb);
                    break;
                }

                case 'icon': {
                    const img = createImgElement(getShipIconUrl(entry.ship), entry.ship?.name ?? '', {
                        className: 'table-ship-icon',
                        loading: 'lazy',
                        fallback: IMG_FALLBACKS.CARD,
                    });
                    td.appendChild(img);
                    break;
                }

                case 'name':
                    td.textContent = entry.ship?.name ?? '';
                    break;

                case 'rarity': {
                    const rarity = entry.ship?.rarity ?? '';
                    const span = document.createElement('span');
                    span.className = `table-rarity rarity-${rarity}`;
                    span.textContent = rarity;
                    td.appendChild(span);
                    break;
                }

                case 'nationality':
                    td.textContent = getNationalityName(entry.ship?.nationality);
                    break;

                case 'type':
                    td.textContent = getShipTypeName(entry.ship?.type);
                    break;

                default: {
                    if (col.isStat) {
                        const val = entry.combat ? (entry.combat[col.key] ?? 0) : 0;
                        td.className = (td.className ? td.className + ' ' : '') + 'stat-cell';
                        if (val === 0) td.classList.add('stat-zero');
                        td.textContent = val;
                    }
                    break;
                }
            }

            tr.appendChild(td);
        });

        fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);

    renderPagination('shipPagination', state.shipPage, totalPages, 'ship');
}

// ===== Skin Table =====

/**
 * Render or re-render the skin-info ranking table for the current page and sort state.
 * Rebuilds the thead, the tbody rows with skin-count cells, and the pagination strip.
 */
export function renderSkinTable() {
    const source = state.filteredShipStats || state.shipStats;
    if (!source) return;

    const sorted = sortData(source, state.skinSort);
    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / ROWS_PER_PAGE));

    if (state.skinPage > totalPages) state.skinPage = totalPages;

    const start = (state.skinPage - 1) * ROWS_PER_PAGE;
    const pageData = sorted.slice(start, start + ROWS_PER_PAGE);

    const countEl = document.getElementById('skinTableCount');
    if (countEl) countEl.textContent = `${total}명`;

    renderTableHead('skinTableHead', SKIN_COLUMNS, state.skinSort, 'skin');

    const tbody = document.getElementById('skinTableBody');
    if (!tbody) return;

    const fragment = document.createDocumentFragment();

    pageData.forEach(entry => {
        const tr = document.createElement('tr');
        tr.dataset.shipId = entry.ship?.id ?? '';

        SKIN_COLUMNS.forEach(col => {
            const td = document.createElement('td');
            if (col.className) td.className = col.className;

            switch (col.key) {
                case 'compare': {
                    const shipId = String(entry.ship?.id ?? '');
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.className = 'compare-check';
                    cb.dataset.ship = shipId;
                    cb.checked = state.compareList.includes(shipId);
                    cb.setAttribute('aria-label', `${entry.ship?.name ?? ''} 비교 선택`);
                    td.appendChild(cb);
                    break;
                }

                case 'icon': {
                    const img = createImgElement(getShipIconUrl(entry.ship), entry.ship?.name ?? '', {
                        className: 'table-ship-icon',
                        loading: 'lazy',
                        fallback: IMG_FALLBACKS.CARD,
                    });
                    td.appendChild(img);
                    break;
                }

                case 'name':
                    td.textContent = entry.ship?.name ?? '';
                    break;

                case 'rarity': {
                    const rarity = entry.ship?.rarity ?? '';
                    const span = document.createElement('span');
                    span.className = `table-rarity rarity-${rarity}`;
                    span.textContent = rarity;
                    td.appendChild(span);
                    break;
                }

                case 'nationality':
                    td.textContent = getNationalityName(entry.ship?.nationality);
                    break;

                case 'total':
                case 'L2D':
                case 'L2D+':
                case '듀얼':
                case '쁘띠모션': {
                    const val = entry.skin ? (entry.skin[col.key] ?? 0) : 0;
                    td.classList.add('stat-cell');
                    if (val === 0) td.classList.add('stat-zero');
                    td.textContent = val;
                    break;
                }

                case 'totalGems': {
                    const val = entry.skin ? (entry.skin.totalGems ?? 0) : 0;
                    td.classList.add('stat-cell');
                    if (val === 0) {
                        td.classList.add('stat-zero');
                        td.textContent = '-';
                    } else {
                        td.textContent = val.toLocaleString();
                    }
                    break;
                }

                case 'latestDate': {
                    const val = entry.skin ? entry.skin.latestDate : null;
                    td.textContent = val || '-';
                    break;
                }

                case 'daysSinceLast': {
                    const val = entry.skin ? entry.skin.daysSinceLast : null;
                    td.textContent = (val != null && val !== '' && val !== -1) ? `${val}일` : '-';
                    break;
                }

                default:
                    break;
            }

            tr.appendChild(td);
        });

        fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);

    renderPagination('skinPagination', state.skinPage, totalPages, 'skin');
}
