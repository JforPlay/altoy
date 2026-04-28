/**
 * map.compare.js
 * Compare modal and compare mode (floating bar) for the map viewer.
 * Part of the map module group (viewer + data + detail + grid + compare).
 * State is shared via a ref passed to setup() from map.viewer.js.
 * Depends on map.data.js for chapter lookup and map.grid.js for mini-grid rendering.
 */

import { openModal, setupModal, setUrlParams, showElement, hideElement } from '../utils.js';
import { getChapter } from './map.data.js';
import { renderGrid } from './map.grid.js';
import { calcClearEstimate } from './map.detail.js';

let state;

/** Receive shared state from map.viewer.js. */
export function setup(stateRef) {
    state = stateRef;
}

/**
 * Wire close handlers for the compare modal.
 * On close, exits compare mode and clears the URL compare param.
 */
export function setupCompareModal() {
    setupModal('compareModal', {
        closeButtonSelector: '#compareModalClose',
        closeOnEscape: true,
        closeOnBackdrop: true,
        onClose: () => {
            state.compareMode = false;
            state.compareMapId = null;
            const modal = document.getElementById('compareModal');
            if (modal) modal.setAttribute('aria-hidden', 'true');
            setUrlParams({ compare: null }, { replace: true });
        }
    });
}

/** Enter compare mode — show floating bar. */
export function enterCompareMode() {
    state.compareMode = true;
    const bar = document.getElementById('compareBar');
    showElement(bar);
    if (bar) bar.setAttribute('aria-hidden', 'false');
}

/** Exit compare mode — hide bar. */
export function exitCompareMode() {
    state.compareMode = false;
    state.compareMapId = null;
    const bar = document.getElementById('compareBar');
    hideElement(bar);
    if (bar) bar.setAttribute('aria-hidden', 'true');
}

/** Stats to compare with labels and "lower is better" flag. */
const COMPARE_STATS = [
    { key: 'difficulty', label: '난이도', lowerBetter: false },
    { key: 'oil', label: '연료', lowerBetter: true },
    { key: 'ammo_total', label: '탄약', lowerBetter: false },
    { key: 'air_dominance', label: '제공', lowerBetter: false },
    { key: 'boss_refresh', label: '보스출현', lowerBetter: true },
    { key: 'group_num', label: '함대 수', lowerBetter: false },
];

// Average EXP/level helpers for the dynamic stats rows in the compare table
function getAvgExp(chapter, type) {
    const fleets = chapter?.expeditions?.[type] || [];
    if (fleets.length === 0) return 0;
    return Math.round(fleets.reduce((sum, f) => sum + (f.exp || 0), 0) / fleets.length);
}

function getAvgLevel(chapter, type) {
    const fleets = chapter?.expeditions?.[type] || [];
    if (fleets.length === 0) return 0;
    return Math.round(fleets.reduce((sum, f) => sum + (f.level || 0), 0) / fleets.length);
}

/**
 * Render and open the compare modal for two map IDs.
 * Shows side-by-side mini grids and a stats table with better/worse highlighting.
 * Computed rows (EXP totals, oil total, EXP/oil) use calcClearEstimate from map.detail.js.
 */
export function renderCompareModal(id1, id2) {
    const ch1 = getChapter(id1);
    const ch2 = getChapter(id2);
    if (!ch1 || !ch2) return;

    const body = document.getElementById('compareModalBody');
    if (!body) return;

    const compareSides = document.createElement('div');
    compareSides.className = 'compare-sides';

    const side1 = document.createElement('div');
    const side1Header = document.createElement('div');
    side1Header.className = 'compare-side-header';
    side1Header.textContent = ch1.chapter_name || ch1.name || String(id1);
    const grid1El = document.createElement('div');
    grid1El.id = 'compareGrid1';
    grid1El.className = 'map-grid compare-grid';
    side1.append(side1Header, grid1El);

    const side2 = document.createElement('div');
    const side2Header = document.createElement('div');
    side2Header.className = 'compare-side-header';
    side2Header.textContent = ch2.chapter_name || ch2.name || String(id2);
    const grid2El = document.createElement('div');
    grid2El.id = 'compareGrid2';
    grid2El.className = 'map-grid compare-grid';
    side2.append(side2Header, grid2El);

    compareSides.append(side1, side2);

    const statsWrap = document.createElement('div');
    statsWrap.className = 'compare-stats';

    const allStats = [
        ...COMPARE_STATS,
        { key: '_normal_level', label: '일반 적 레벨', lowerBetter: false, fn: ch => getAvgLevel(ch, 'normal') },
        { key: '_normal_exp', label: '일반 EXP', lowerBetter: false, fn: ch => getAvgExp(ch, 'normal') },
        { key: '_boss_exp', label: '보스 EXP', lowerBetter: false, fn: ch => getAvgExp(ch, 'boss') },
        { key: '_total_exp', label: '클리어 총 EXP', lowerBetter: false, fn: ch => calcClearEstimate(ch).shipExpAvg },
        { key: '_total_oil', label: '클리어 총 연료', lowerBetter: true, fn: ch => calcClearEstimate(ch).oilTotal || '—' },
        { key: '_exp_per_oil', label: 'EXP/연료', lowerBetter: false, fn: ch => {
            const est = calcClearEstimate(ch);
            return est.expPerOil !== null ? parseFloat(est.expPerOil.toFixed(2)) : '—';
        }},
    ];

    for (const stat of allStats) {
        const v1 = stat.fn ? stat.fn(ch1) : (ch1[stat.key] ?? '—');
        const v2 = stat.fn ? stat.fn(ch2) : (ch2[stat.key] ?? '—');
        const n1 = typeof v1 === 'number' ? v1 : 0;
        const n2 = typeof v2 === 'number' ? v2 : 0;

        let cls1 = 'compare-equal', cls2 = 'compare-equal';
        if (n1 !== n2 && typeof v1 === 'number' && typeof v2 === 'number') {
            const higherIsBetter = !stat.lowerBetter;
            if (higherIsBetter) {
                cls1 = n1 > n2 ? 'compare-higher' : 'compare-lower';
                cls2 = n2 > n1 ? 'compare-higher' : 'compare-lower';
            } else {
                cls1 = n1 < n2 ? 'compare-higher' : 'compare-lower';
                cls2 = n2 < n1 ? 'compare-higher' : 'compare-lower';
            }
        }

        const row = document.createElement('div');
        row.className = 'compare-stat-row';
        const left = document.createElement('span');
        left.className = cls1;
        left.textContent = String(v1);
        const label = document.createElement('span');
        label.className = 'compare-stat-label';
        label.textContent = stat.label;
        const right = document.createElement('span');
        right.className = cls2;
        right.textContent = String(v2);
        row.append(left, label, right);
        statsWrap.appendChild(row);
    }

    body.replaceChildren(compareSides, statsWrap);

    // Render mini grids inside modal
    if (grid1El && ch1.grids) {
        renderGrid(ch1, grid1El);
        grid1El.onclick = null; // Disable clicks in compare modal
    }
    if (grid2El && ch2.grids) {
        renderGrid(ch2, grid2El);
        grid2El.onclick = null; // Disable clicks in compare modal
    }

    setUrlParams({ compare: `${id1},${id2}` }, { replace: true });
    openModal('compareModal');
    const modal = document.getElementById('compareModal');
    if (modal) modal.setAttribute('aria-hidden', 'false');
}
