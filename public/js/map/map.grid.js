let state;
let onNodeClick = null;

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

/** Render a standard chapter grid into the target element. */
export function renderGrid(chapter, targetEl) {
    if (!chapter || !chapter.grids || chapter.grids.length === 0) {
        targetEl.innerHTML = '<div class="map-empty">그리드 데이터가 없습니다</div>';
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

    // Render top-to-bottom (highest row first)
    for (let row = maxRow; row >= 0; row--) {
        for (let col = 0; col <= maxCol; col++) {
            const cell = cellMap.get(`${row}_${col}`);
            const el = document.createElement('div');
            el.className = 'map-cell';

            if (!cell) {
                // Cell not in grid data — void
                el.classList.add('map-cell--void');
            } else if (!cell[2]) {
                // Not walkable
                el.classList.add('map-cell--void');
            } else {
                const attach = cell[3] || 0;
                const nodeType = NODE_TYPES[attach] || UNKNOWN_NODE;

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
                        if (nodeType.material) {
                            const icon = document.createElement('span');
                            icon.className = 'material-symbols-outlined';
                            icon.textContent = nodeType.icon;
                            el.appendChild(icon);
                        } else {
                            el.textContent = nodeType.icon;
                        }
                    } else {
                        const badge = document.createElement('div');
                        badge.className = `node-badge node-badge--${nodeType.cls}`;
                        if (nodeType.material) {
                            const icon = document.createElement('span');
                            icon.className = 'material-symbols-outlined';
                            icon.textContent = nodeType.icon;
                            badge.appendChild(icon);
                        } else {
                            badge.textContent = nodeType.icon;
                        }
                        el.appendChild(badge);
                    }
                }
            }

            fragment.appendChild(el);
        }
    }

    targetEl.innerHTML = '';
    targetEl.appendChild(fragment);

    // Click delegation
    targetEl.onclick = (e) => {
        const clickable = e.target.closest('.map-cell--clickable');
        if (clickable && onNodeClick) {
            const attach = parseInt(clickable.dataset.attach, 10);
            onNodeClick(attach, chapter);
        }
    };
}

/** Render legend below the grid. */
export function renderLegend(chapter, targetEl) {
    // Collect which node types are present in this grid
    const presentTypes = new Set();
    for (const cell of (chapter.grids || [])) {
        if (cell[2] && cell[3]) presentTypes.add(cell[3]);
    }

    let html = '';
    for (const [type, info] of Object.entries(NODE_TYPES)) {
        const t = parseInt(type, 10);
        if (t === 0 || t === 5) continue; // Skip sea and ambush
        if (!presentTypes.has(t)) continue;
        if (info.noBadge) {
            const iconHtml = info.material
                ? `<span class="material-symbols-outlined">${info.icon}</span>`
                : info.icon;
            html += `<div class="map-legend-item">
                <div class="map-legend-icon map-legend-icon--${info.cls}">${iconHtml}</div>
                ${info.label}
            </div>`;
        } else {
            const iconHtml = info.material
                ? `<span class="material-symbols-outlined">${info.icon}</span>`
                : info.icon;
            html += `<div class="map-legend-item">
                <div class="node-badge node-badge--${info.cls}">${iconHtml}</div>
                ${info.label}
            </div>`;
        }
    }
    html += `<div class="map-legend-item">
        <div class="map-legend-void"></div>
        이동불가
    </div>`;

    targetEl.innerHTML = html;
}

/** Render a world chapter grid (simpler: just walkable/void). */
export function renderWorldGrid(chapter, targetEl) {
    if (!chapter || !chapter.grids || chapter.grids.length === 0) {
        targetEl.innerHTML = '<div class="map-empty">그리드 데이터가 없습니다</div>';
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
    for (let row = maxRow; row >= 0; row--) {
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

    targetEl.innerHTML = '';
    targetEl.appendChild(fragment);
    targetEl.onclick = null;
}
