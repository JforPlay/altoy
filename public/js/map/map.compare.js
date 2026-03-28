import { openModal, closeModal, setupModal, setUrlParams, showElement, hideElement } from '../utils.js';
import { getChapter } from './map.data.js';
import { renderGrid } from './map.grid.js';
import { calcClearEstimate } from './map.detail.js';

let state;

export function setup(stateRef) {
    state = stateRef;
}

export function setupCompareModal() {
    setupModal('compareModal', {
        closeOnEscape: true,
        closeOnBackdrop: true,
        onClose: () => {
            state.compareMode = false;
            state.compareMapId = null;
            setUrlParams({ compare: null }, { replace: true });
        }
    });
}

/** Enter compare mode — show floating bar. */
export function enterCompareMode() {
    state.compareMode = true;
    showElement(document.getElementById('compareBar'));
}

/** Exit compare mode — hide bar. */
export function exitCompareMode() {
    state.compareMode = false;
    state.compareMapId = null;
    hideElement(document.getElementById('compareBar'));
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

/** Render the compare modal for two maps. */
export function renderCompareModal(id1, id2) {
    const ch1 = getChapter(id1);
    const ch2 = getChapter(id2);
    if (!ch1 || !ch2) return;

    const body = document.getElementById('compareModalBody');
    if (!body) return;

    let html = '<div class="compare-sides">';

    // Side 1
    html += '<div>';
    html += `<div class="compare-side-header">${ch1.chapter_name || ch1.name}</div>`;
    html += `<div id="compareGrid1" class="map-grid" style="margin-bottom:var(--spacing-sm);"></div>`;
    html += '</div>';

    // Side 2
    html += '<div>';
    html += `<div class="compare-side-header">${ch2.chapter_name || ch2.name}</div>`;
    html += `<div id="compareGrid2" class="map-grid" style="margin-bottom:var(--spacing-sm);"></div>`;
    html += '</div>';

    html += '</div>';

    // Stats comparison table
    html += '<div style="margin-top:var(--spacing-md);">';

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

        html += `<div class="compare-stat-row">
            <span class="${cls1}">${v1}</span>
            <span style="color:var(--text-dim);flex:1;text-align:center;">${stat.label}</span>
            <span class="${cls2}">${v2}</span>
        </div>`;
    }

    html += '</div>';

    body.innerHTML = html;

    // Render mini grids inside modal
    const grid1El = document.getElementById('compareGrid1');
    const grid2El = document.getElementById('compareGrid2');
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
}
