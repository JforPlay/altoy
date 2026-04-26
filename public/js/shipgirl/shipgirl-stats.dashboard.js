'use strict';

/**
 * shipgirl-stats.dashboard.js
 * Chart.js dashboards for the ship info and skin info tabs.
 * Renders rarity/type/nationality breakdowns, top-stat rankings, skin timelines,
 * and L2D/dual cumulative trend charts. Chart.js is loaded via CDN (window.Chart).
 */

import { normalizeRomanNumerals } from '../utils.js';
import { getAttrKoreanName, getNationalityName, getShipTypeName } from './shipgirl-stats.data.js';

// ===== State =====
let state;
const charts = {};

export function setup(stateRef) {
    state = stateRef;
}

// ===== Theme Colors =====
function getChartColors() {
    const isDark = document.body.classList.contains('dark-mode');
    return {
        text: isDark ? '#e0e0e0' : '#212121',
        textSecondary: isDark ? '#9e9e9e' : '#757575',
        gridColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        palette: [
            '#5B9BD5', '#ED7D31', '#70AD47', '#FFC000', '#4472C4',
            '#FF6B6B', '#47B39C', '#C55A89', '#9DC3E6', '#A9D18E',
        ],
        rarityColors: {
            N: '#9e9e9e', R: '#4db6ac', SR: '#7e57c2', SSR: '#ffb300', UR: '#ef5350',
        },
        tagColors: {
            'L2D': '#1e88e5', 'L2D+': '#8e24aa', '듀얼': '#e91e63', '쁘띠모션': '#43a047', '기타': '#78909c',
        },
    };
}

// ===== Shared Helpers =====
function destroyChart(key) {
    if (charts[key]) { charts[key].destroy(); charts[key] = null; }
}

function createChart(key, canvas, config) {
    if (typeof window === 'undefined' || typeof window.Chart !== 'function') {
        canvas.hidden = true;
        canvas.closest('.chart-container')?.classList.add('chart-empty');
        return;
    }

    canvas.hidden = false;
    canvas.closest('.chart-container')?.classList.remove('chart-empty');
    charts[key] = new window.Chart(canvas, config);
}

function getFilteredData() {
    return state.filteredShipStats || state.shipStats || [];
}

function countBy(arr, keyFn) {
    const map = {};
    for (const item of arr) {
        const key = keyFn(item);
        if (key == null) continue;
        map[key] = (map[key] || 0) + 1;
    }
    return map;
}

function defaultChartOptions(horizontal = false) {
    const colors = getChartColors();
    return {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: horizontal ? 'y' : 'x',
        plugins: { legend: { display: false } },
        scales: {
            x: { grid: { color: colors.gridColor }, ticks: { color: colors.textSecondary, font: { size: 11 } } },
            y: { grid: { color: colors.gridColor }, ticks: { color: colors.textSecondary, font: { size: 11 } } },
        },
    };
}

// ===== Ship Info Dashboard =====
/**
 * Render all ship-info dashboard charts: summary counts, ship type bar,
 * nationality bar, and top-stat ranking bar.
 */
export function renderShipDashboard() {
    const data = getFilteredData();
    _renderShipSummary(data);
    _renderShipTypeChart(data);
    _renderNationalityChart(data);
    renderTopStatChart();
}

function _renderShipSummary(data) {
    const container = document.getElementById('shipSummaryContent');
    if (!container) return;

    const rarityCounts = countBy(data, d => d.ship.rarity);
    const rarityOrder = ['UR', 'SSR', 'SR', 'R', 'N'];

    const tags = rarityOrder
        .filter(r => rarityCounts[r])
        .map(r => `<span class="rarity-tag rarity-${r}">${r}: ${rarityCounts[r]}</span>`)
        .join('');

    container.innerHTML = `
        <div class="summary-stat">
            <span class="summary-stat-value">${data.length}</span>
            <span class="summary-stat-label">총 함선</span>
        </div>
        <div class="rarity-breakdown">${tags}</div>
    `;
}

function _renderShipTypeChart(data) {
    const canvas = document.getElementById('shipTypeChart');
    if (!canvas) return;
    destroyChart('shipType');

    const counts = countBy(data, d => getShipTypeName(d.ship.type));
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const colors = getChartColors();

    createChart('shipType', canvas, {
        type: 'bar',
        data: {
            labels: sorted.map(e => e[0]),
            datasets: [{ data: sorted.map(e => e[1]), backgroundColor: colors.palette, borderRadius: 4 }],
        },
        options: defaultChartOptions(true),
    });
}

function _renderNationalityChart(data) {
    const canvas = document.getElementById('nationalityChart');
    if (!canvas) return;
    destroyChart('nationality');

    const counts = countBy(data, d => getNationalityName(d.ship.nationality));
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const colors = getChartColors();

    createChart('nationality', canvas, {
        type: 'bar',
        data: {
            labels: sorted.map(e => e[0]),
            datasets: [{ data: sorted.map(e => e[1]), backgroundColor: colors.palette, borderRadius: 4 }],
        },
        options: defaultChartOptions(true),
    });
}

/**
 * Render the top-10 ships bar chart for the stat selected in #topStatSelector.
 * Called on initial render and whenever the selector changes.
 */
export function renderTopStatChart() {
    const canvas = document.getElementById('topStatChart');
    if (!canvas) return;
    destroyChart('topStat');

    const selector = document.getElementById('topStatSelector');
    const statKey = selector ? selector.value : 'health';

    const data = getFilteredData();
    const colors = getChartColors();

    const sorted = [...data]
        .filter(d => d.combat[statKey] != null)
        .sort((a, b) => (b.combat[statKey] || 0) - (a.combat[statKey] || 0))
        .slice(0, 10)
        .reverse();

    createChart('topStat', canvas, {
        type: 'bar',
        data: {
            labels: sorted.map(d => d.ship.name),
            datasets: [{
                label: getAttrKoreanName(statKey),
                data: sorted.map(d => d.combat[statKey] || 0),
                backgroundColor: colors.palette[0],
                borderRadius: 4,
            }],
        },
        options: {
            ...defaultChartOptions(true),
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x} (${getAttrKoreanName(statKey)})` } },
            },
        },
    });
}

// ===== Skin Info Dashboard =====
/**
 * Render all skin-info dashboard charts: summary totals, skin-type doughnut,
 * top-skin-count bar, skin-type breakdown, monthly release timeline, and
 * cumulative L2D/L2D+/dual trend line.
 */
export function renderSkinDashboard() {
    const data = getFilteredData();
    _renderSkinSummary(data);
    _renderTagChart(data);
    _renderTopSkinChart(data);
    _renderSkinTypeChart(data);
    _renderTimelineChart(data);
    _renderTrendChart(data);
}

function _renderSkinSummary(data) {
    const container = document.getElementById('skinSummaryContent');
    if (!container) return;

    let totalSkins = 0, totalL2D = 0, totalL2DPlus = 0, totalDual = 0, totalPetit = 0;
    for (const d of data) {
        totalSkins += d.skin.total;
        totalL2D += d.skin['L2D'];
        totalL2DPlus += d.skin['L2D+'];
        totalDual += d.skin['듀얼'];
        totalPetit += d.skin['쁘띠모션'];
    }

    const avgSkins = data.length > 0 ? (totalSkins / data.length).toFixed(1) : '0';

    container.innerHTML = `
        <div class="summary-stat">
            <span class="summary-stat-value">${totalSkins.toLocaleString()}</span>
            <span class="summary-stat-label">총 스킨</span>
        </div>
        <div class="summary-stat">
            <span class="summary-stat-value">${avgSkins}</span>
            <span class="summary-stat-label">평균/함선</span>
        </div>
        <div class="summary-stat">
            <span class="summary-stat-value">${totalL2D} / ${totalL2DPlus}</span>
            <span class="summary-stat-label">L2D / L2D+</span>
        </div>
        <div class="summary-stat">
            <span class="summary-stat-value">${totalDual} / ${totalPetit}</span>
            <span class="summary-stat-label">듀얼 / 쁘띠모션</span>
        </div>
    `;
}

function _renderTagChart(data) {
    const canvas = document.getElementById('tagChart');
    if (!canvas) return;
    destroyChart('tag');

    let l2d = 0, l2dPlus = 0, dual = 0, petit = 0, totalSkins = 0;
    for (const d of data) {
        l2d += d.skin['L2D'];
        l2dPlus += d.skin['L2D+'];
        dual += d.skin['듀얼'];
        petit += d.skin['쁘띠모션'];
        totalSkins += d.skin.total;
    }
    const other = totalSkins - l2d - l2dPlus - dual - petit;

    const colors = getChartColors();
    const labels = ['L2D', 'L2D+', '듀얼', '쁘띠모션', '기타'];
    const values = [l2d, l2dPlus, dual, petit, other];
    const bgColors = labels.map(l => colors.tagColors[l]);

    createChart('tag', canvas, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: values, backgroundColor: bgColors, borderWidth: 0 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: colors.text, font: { size: 11 }, padding: 8 } },
            },
        },
    });
}

function _renderTopSkinChart(data) {
    const canvas = document.getElementById('topSkinChart');
    if (!canvas) return;
    destroyChart('topSkin');

    const sorted = [...data].sort((a, b) => b.skin.total - a.skin.total).slice(0, 10).reverse();
    const colors = getChartColors();

    createChart('topSkin', canvas, {
        type: 'bar',
        data: {
            labels: sorted.map(d => d.ship.name),
            datasets: [{ data: sorted.map(d => d.skin.total), backgroundColor: colors.palette[2], borderRadius: 4 }],
        },
        options: defaultChartOptions(true),
    });
}

function _renderSkinTypeChart(data) {
    const canvas = document.getElementById('skinTypeChart');
    if (!canvas) return;
    destroyChart('skinType');

    const typeCounts = {};
    for (const d of data) {
        for (const [type, count] of Object.entries(d.skin.skinTypes || {})) {
            if (type === '기본' || type === '개조') continue;
            typeCounts[type] = (typeCounts[type] || 0) + count;
        }
    }

    const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const colors = getChartColors();

    createChart('skinType', canvas, {
        type: 'bar',
        data: {
            labels: sorted.map(e => e[0]),
            datasets: [{ data: sorted.map(e => e[1]), backgroundColor: colors.palette, borderRadius: 4 }],
        },
        options: defaultChartOptions(true),
    });
}

function _renderTimelineChart(data) {
    const canvas = document.getElementById('timelineChart');
    if (!canvas) return;
    destroyChart('timeline');

    // Collect skins belonging to filtered ships via skinByShip
    const monthlyCounts = {};
    for (const entry of data) {
        const normalizedName = normalizeRomanNumerals(entry.ship.name);
        const skins = state.skinByShip.get(normalizedName) || [];
        for (const skin of skins) {
            const skinId = String(skin['클뜯 id']);
            const dateStr = (state.skinReleaseDates || {})[skinId];
            if (!dateStr) continue;
            const month = dateStr.slice(0, 7);
            monthlyCounts[month] = (monthlyCounts[month] || 0) + 1;
        }
    }

    const sortedMonths = Object.keys(monthlyCounts).sort();
    const filtered = sortedMonths.length > 1 && monthlyCounts[sortedMonths[0]] > 500
        ? sortedMonths.slice(1) : sortedMonths;

    if (filtered.length === 0) return;

    const colors = getChartColors();
    createChart('timeline', canvas, {
        type: 'bar',
        data: {
            labels: filtered,
            datasets: [{
                data: filtered.map(m => monthlyCounts[m]),
                backgroundColor: colors.palette[0] + '99',
                borderColor: colors.palette[0],
                borderWidth: 1,
                borderRadius: 2,
            }],
        },
        options: {
            ...defaultChartOptions(),
            scales: {
                x: { ticks: { color: colors.textSecondary, font: { size: 10 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 24 }, grid: { display: false } },
                y: { ticks: { color: colors.textSecondary, font: { size: 11 } }, grid: { color: colors.gridColor } },
            },
        },
    });
}

function _renderTrendChart(data) {
    const canvas = document.getElementById('trendChart');
    if (!canvas) return;
    destroyChart('trend');

    // Collect skins belonging to filtered ships via skinByShip
    const skinEntries = [];
    for (const entry of data) {
        const normalizedName = normalizeRomanNumerals(entry.ship.name);
        const skins = state.skinByShip.get(normalizedName) || [];
        for (const skin of skins) {
            const dateStr = (state.skinReleaseDates || {})[String(skin['클뜯 id'])];
            if (!dateStr) continue;
            const tags = (skin['스킨 태그'] || '').split(',').map(t => t.trim());
            skinEntries.push({ date: dateStr, tags });
        }
    }
    skinEntries.sort((a, b) => a.date.localeCompare(b.date));

    const firstDate = skinEntries.length > 0 ? skinEntries[0].date : null;
    const bulkCount = skinEntries.filter(e => e.date === firstDate).length;
    const skipBulk = bulkCount > 500;

    const monthly = {};
    for (const entry of skinEntries) {
        if (skipBulk && entry.date === firstDate) continue;
        const month = entry.date.slice(0, 7);
        if (!monthly[month]) monthly[month] = { l2d: 0, l2dPlus: 0, dual: 0 };
        if (entry.tags.includes('L2D+')) monthly[month].l2dPlus++;
        else if (entry.tags.includes('L2D')) monthly[month].l2d++;
        if (entry.tags.includes('듀얼')) monthly[month].dual++;
    }

    const months = Object.keys(monthly).sort();
    let cumL2D = 0, cumL2DPlus = 0, cumDual = 0;

    if (skipBulk) {
        for (const entry of skinEntries) {
            if (entry.date !== firstDate) break;
            if (entry.tags.includes('L2D+')) cumL2DPlus++;
            else if (entry.tags.includes('L2D')) cumL2D++;
            if (entry.tags.includes('듀얼')) cumDual++;
        }
    }

    const l2dData = [], l2dPlusData = [], dualData = [];
    for (const month of months) {
        cumL2D += monthly[month].l2d;
        cumL2DPlus += monthly[month].l2dPlus;
        cumDual += monthly[month].dual;
        l2dData.push(cumL2D);
        l2dPlusData.push(cumL2DPlus);
        dualData.push(cumDual);
    }

    const colors = getChartColors();
    createChart('trend', canvas, {
        type: 'line',
        data: {
            labels: months,
            datasets: [
                { label: 'L2D', data: l2dData, borderColor: colors.tagColors['L2D'], backgroundColor: colors.tagColors['L2D'] + '22', fill: true, tension: 0.3, pointRadius: 0 },
                { label: 'L2D+', data: l2dPlusData, borderColor: colors.tagColors['L2D+'], backgroundColor: colors.tagColors['L2D+'] + '22', fill: true, tension: 0.3, pointRadius: 0 },
                { label: '듀얼', data: dualData, borderColor: colors.tagColors['듀얼'], backgroundColor: colors.tagColors['듀얼'] + '22', fill: true, tension: 0.3, pointRadius: 0 },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: colors.text, font: { size: 11 } } } },
            scales: {
                x: { ticks: { color: colors.textSecondary, font: { size: 10 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 24 }, grid: { display: false } },
                y: { ticks: { color: colors.textSecondary, font: { size: 11 } }, grid: { color: colors.gridColor } },
            },
        },
    });
}

// ===== Cleanup =====
/**
 * Destroy all active Chart.js instances to free memory and prevent
 * "canvas already in use" errors on theme switch or tab change.
 */
export function destroyAllCharts() {
    for (const key of Object.keys(charts)) {
        destroyChart(key);
    }
}
