/**
 * map.grid.js
 * Grid and legend renderers for the map viewer.
 * Part of the map module group (viewer + data + detail + grid + compare).
 * State is shared via a ref; setup() also receives a node click callback from map.viewer.js.
 * renderGrid is also called from map.compare.js to show mini grids inside the compare modal.
 */

import { createMaterialIcon } from '../utils.js';

let state;
let onNodeClick = null;

/** Receive shared state and the node click handler from map.viewer.js. */
export function setup(stateRef, nodeClickHandler) {
    state = stateRef;
    onNodeClick = nodeClickHandler;
}

/** Attachment type → CSS class + icon */
const NODE_TYPES = {
    0:   { cls: 'sea', icon: '·', label: '바다', clickable: false },
    1:   { cls: 'spawn', icon: 'directions_boat', label: '출격', clickable: false, material: true },
    2:   { cls: 'box', icon: 'inventory_2', label: '상자', clickable: false, material: true },
    3:   { cls: 'supply', icon: 'local_gas_station', label: '탄약', clickable: false, material: true },
    4:   { cls: 'elite', icon: 'swords', label: '강한 일반', clickable: true, material: true, noBadge: true },
    5:   { cls: 'sea', icon: '·', label: '매복', clickable: false },
    6:   { cls: 'enemy', icon: 'swords', label: '일반', clickable: true, material: true, noBadge: true },
    7:   { cls: 'torpedo', icon: 'rocket', label: '어뢰', clickable: true, material: true },
    8:   { cls: 'boss', icon: 'skull', label: '보스', clickable: true, material: true },
    12:  { cls: 'champion', icon: 'diamond', label: '엘리트', clickable: true, material: true },
    16:  { cls: 'spawn-sub', icon: '⚓', label: '잠수 출격', clickable: false },
    17:  { cls: 'transport', icon: 'local_shipping', label: '수송', clickable: false, material: true },
    18:  { cls: 'transport-target', icon: 'flag', label: '수송 목표', clickable: false, material: true },
    100: { cls: 'landbase', icon: 'apartment', label: '기지', clickable: false, material: true },
};

const UNKNOWN_NODE = { cls: 'unknown', icon: '?', label: '?', clickable: false };

function renderEmptyGrid(targetEl, message) {
    const empty = document.createElement('div');
    empty.className = 'map-empty';
    empty.textContent = message;
    targetEl.replaceChildren(empty);
}

function appendNodeIcon(targetEl, info) {
    if (info.material) {
        targetEl.appendChild(createMaterialIcon(info.icon));
    } else {
        targetEl.textContent = info.icon;
    }
}

/**
 * Render a standard chapter grid (main, hard, event, archive) into the target element.
 * Builds a cell lookup map, then renders bottom-to-top to match in-game grid orientation.
 * Clickable nodes (enemy, boss, etc.) get data attributes and delegate clicks via targetEl.onclick.
 */
export function renderGrid(chapter, targetEl) {
    if (!chapter || !chapter.grids || chapter.grids.length === 0) {
        renderEmptyGrid(targetEl, '그리드 데이터가 없습니다');
        return;
    }

    const grids = chapter.grids;

    // Determine grid dimensions
    let maxRow = 0, maxCol = 0;
    for (const cell of grids) {
        if (cell[0] > maxRow) maxRow = cell[0];
        if (cell[1] > maxCol) maxCol = cell[1];
    }

    // Build cell lookup: "row_col" -> cell data
    const cellMap = new Map();
    for (const cell of grids) {
        cellMap.set(`${cell[0]}_${cell[1]}`, cell);
    }

    targetEl.style.gridTemplateColumns = `repeat(${maxCol + 1}, var(--map-cell-size))`;

    const fragment = document.createDocumentFragment();

    // Render bottom-to-top (lowest row first) to match in-game orientation
    for (let row = 0; row <= maxRow; row++) {
        for (let col = 0; col <= maxCol; col++) {
            const cell = cellMap.get(`${row}_${col}`);
            const attach = cell?.[3] || 0;
            const nodeType = NODE_TYPES[attach] || UNKNOWN_NODE;
            const el = nodeType.clickable ? document.createElement('button') : document.createElement('div');
            el.className = 'map-cell';
            if (nodeType.clickable) {
                el.type = 'button';
                el.setAttribute('aria-label', `${nodeType.label} 함대 정보 보기`);
            }

            if (!cell) {
                // Cell not in grid data — void
                el.classList.add('map-cell--void');
            } else if (!cell[2]) {
                // Not walkable
                el.classList.add('map-cell--void');
            } else {
                if (attach === 0) {
                    el.classList.add('map-cell--sea');
                    el.textContent = '·';
                } else {
                    el.classList.add('map-cell--node');
                    if (attach === 8) el.classList.add('map-cell--boss');
                    if (nodeType.clickable) {
                        el.classList.add('map-cell--clickable');
                        el.dataset.attach = attach;
                        el.dataset.row = row;
                        el.dataset.col = col;
                    }

                    if (nodeType.noBadge) {
                        // Render icon directly in cell without badge circle
                        el.classList.add(`map-cell--${nodeType.cls}`);
                        appendNodeIcon(el, nodeType);
                    } else {
                        const badge = document.createElement('div');
                        badge.className = `node-badge node-badge--${nodeType.cls}`;
                        appendNodeIcon(badge, nodeType);
                        el.appendChild(badge);
                    }
                }
            }

            fragment.appendChild(el);
        }
    }

    targetEl.replaceChildren(fragment);

    // Click delegation
    targetEl.onclick = (e) => {
        const clickable = e.target.closest('.map-cell--clickable');
        if (clickable && onNodeClick) {
            const attach = parseInt(clickable.dataset.attach, 10);
            onNodeClick(attach, chapter);
        }
    };
}

/** Render a legend row showing only node types present in this grid. */
export function renderLegend(chapter, targetEl) {
    // Collect which node types are present in this grid
    const presentTypes = new Set();
    for (const cell of (chapter.grids || [])) {
        if (cell[2] && cell[3]) presentTypes.add(cell[3]);
    }

    const fragment = document.createDocumentFragment();
    for (const [type, info] of Object.entries(NODE_TYPES)) {
        const t = parseInt(type, 10);
        if (t === 0 || t === 5) continue; // Skip sea and ambush
        if (!presentTypes.has(t)) continue;
        const item = document.createElement('div');
        item.className = 'map-legend-item';
        if (info.noBadge) {
            const icon = document.createElement('div');
            icon.className = `map-legend-icon map-legend-icon--${info.cls}`;
            appendNodeIcon(icon, info);
            item.appendChild(icon);
        } else {
            const badge = document.createElement('div');
            badge.className = `node-badge node-badge--${info.cls}`;
            appendNodeIcon(badge, info);
            item.appendChild(badge);
        }
        item.append(document.createTextNode(info.label));
        fragment.appendChild(item);
    }

    const voidItem = document.createElement('div');
    voidItem.className = 'map-legend-item';
    const voidIcon = document.createElement('div');
    voidIcon.className = 'map-legend-void';
    voidItem.append(voidIcon, document.createTextNode('이동불가'));
    fragment.appendChild(voidItem);

    targetEl.replaceChildren(fragment);
}

/**
 * Render a world chapter grid — simpler than renderGrid: only walkable vs. void cells.
 * Node types are not distinguished; no click delegation.
 */
export function renderWorldGrid(chapter, targetEl) {
    if (!chapter || !chapter.grids || chapter.grids.length === 0) {
        renderEmptyGrid(targetEl, '그리드 데이터가 없습니다');
        return;
    }

    const grids = chapter.grids;
    let maxRow = 0, maxCol = 0;
    for (const cell of grids) {
        if (cell[0] > maxRow) maxRow = cell[0];
        if (cell[1] > maxCol) maxCol = cell[1];
    }

    const cellMap = new Map();
    for (const cell of grids) {
        cellMap.set(`${cell[0]}_${cell[1]}`, cell);
    }

    targetEl.style.gridTemplateColumns = `repeat(${maxCol + 1}, var(--map-cell-size))`;

    const fragment = document.createDocumentFragment();
    for (let row = 0; row <= maxRow; row++) {
        for (let col = 0; col <= maxCol; col++) {
            const cell = cellMap.get(`${row}_${col}`);
            const el = document.createElement('div');
            el.className = 'map-cell';

            if (!cell || !cell[2]) {
                el.classList.add('map-cell--world-void');
            } else {
                el.classList.add('map-cell--world-sea');
            }

            fragment.appendChild(el);
        }
    }

    targetEl.replaceChildren(fragment);
    targetEl.onclick = null;
}
