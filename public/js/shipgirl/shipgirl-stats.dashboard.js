'use strict';

/**
 * shipgirl-stats.dashboard.js
 * Chart.js dashboards for the ship info and skin info tabs.
 * Renders rarity/type/nationality breakdowns, top-stat rankings, skin timelines,
 * and L2D/dual cumulative trend charts. Chart.js is loaded via CDN (window.Chart);
 * the skin-only treemap controller is loaded on first skin-tab activation.
 */

import { normalizeRomanNumerals, RARITY_TIERS_DESC as rarityOrder } from '../utils.js';
import { getAttrKoreanName, getNationalityName, getShipTypeName } from './shipgirl-stats.data.js';
import { releaseSortKey } from '../skin/skin.dates.js';

// ===== State =====
let state;
const charts = {};
const TREEMAP_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/chartjs-chart-treemap@3';
let treemapScriptPromise = null;

export function setup(stateRef) {
    state = stateRef;
}

function hasTreemapController() {
    if (typeof window === 'undefined' || !window.Chart?.registry) return false;
    try {
        return Boolean(window.Chart.registry.getController('treemap'));
    } catch {
        return false;
    }
}

/**
 * Load the skin-only treemap controller once. Network failures remove the
 * failed script and clear the promise so a later tab activation can retry.
 *
 * @returns {Promise<boolean>}
 */
export function ensureTreemapPlugin() {
    if (hasTreemapController()) return Promise.resolve(true);
    if (treemapScriptPromise) return treemapScriptPromise;

    const script = document.createElement('script');
    script.src = TREEMAP_SCRIPT_URL;
    script.async = true;
    script.dataset.shipgirlStatsTreemap = 'true';

    treemapScriptPromise = new Promise((resolve, reject) => {
        script.addEventListener('load', () => resolve(true), { once: true });
        script.addEventListener('error', () => {
            reject(new Error('Treemap plugin failed to load.'));
        }, { once: true });
        document.head.appendChild(script);
    }).catch((error) => {
        script.remove();
        treemapScriptPromise = null;
        throw error;
    });

    return treemapScriptPromise;
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
    try {
        charts[key] = new window.Chart(canvas, config);
    } catch (err) {
        console.error(`Chart "${key}" failed to render:`, err);
        canvas.hidden = true;
        canvas.closest('.chart-container')?.classList.add('chart-empty');
    }
}

// Horizontal bar charts size their container to the category count so that
// y-axis labels never overlap (a fixed height clips them — see spec #3).
const BAR_ROW_PX = 28;
const BAR_AXIS_PX = 44;
const BAR_MIN_PX = 180;
const BAR_MAX_PX = 560;

function _sizeBarContainer(canvas, count) {
    const container = canvas.closest('.chart-container');
    if (!container) return;
    const px = Math.max(BAR_MIN_PX, Math.min(BAR_MAX_PX, count * BAR_ROW_PX + BAR_AXIS_PX));
    container.style.height = `${px}px`;
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
    _renderRarityTypeHeatmap(data);
}

function _renderShipSummary(data) {
    const container = document.getElementById('shipSummaryContent');
    if (!container) return;

    const rarityCounts = countBy(data, d => d.rarity);

    const tags = rarityOrder
        .filter(r => rarityCounts[r])
        .map(r => `<span class="rarity-tag rarity-${r}">${r}: ${rarityCounts[r]}</span>`)
        .join('');

    container.innerHTML = `
        <div class="summary-stat summary-stat--inline">
            <span class="summary-stat-label">총 :</span>
            <span class="summary-stat-value">${data.length}</span>
            <span class="summary-stat-label">명</span>
        </div>
        <div class="rarity-breakdown">${tags}</div>
    `;
}

function _renderShipTypeChart(data) {
    const canvas = document.getElementById('shipTypeChart');
    if (!canvas) return;
    destroyChart('shipType');

    const counts = countBy(data, d => getShipTypeName(d.shipType));
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    _sizeBarContainer(canvas, sorted.length);
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
    _sizeBarContainer(canvas, sorted.length);
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
    _sizeBarContainer(canvas, sorted.length);

    createChart('topStat', canvas, {
        type: 'bar',
        data: {
            labels: sorted.map(d => d.displayName),
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

/**
 * Render the rarity × ship-type heatmap. Cell color intensity = shipgirl count.
 * Uses the chartjs-chart-matrix plugin (CDN). Respects the shared filters.
 */
function _renderRarityTypeHeatmap(data) {
    const canvas = document.getElementById('rarityTypeHeatmap');
    if (!canvas) return;
    destroyChart('rarityTypeHeatmap');

    const rarities = ['N', 'R', 'SR', 'SSR', 'UR'];

    // Ship types present, ordered by overall count (busiest first).
    const typeTotals = new Map();
    for (const d of data) {
        const t = getShipTypeName(d.shipType);
        typeTotals.set(t, (typeTotals.get(t) || 0) + 1);
    }
    const types = [...typeTotals.keys()].sort((a, b) => typeTotals.get(b) - typeTotals.get(a));

    // Count per (rarity, type) cell.
    const counts = {};
    for (const d of data) {
        const key = `${d.rarity}|${getShipTypeName(d.shipType)}`;
        counts[key] = (counts[key] || 0) + 1;
    }

    let maxV = 0;
    const matrixData = [];
    for (const r of rarities) {
        for (const t of types) {
            const v = counts[`${r}|${t}`] || 0;
            if (v > maxV) maxV = v;
            matrixData.push({ x: t, y: r, v });
        }
    }

    const colors = getChartColors();
    createChart('rarityTypeHeatmap', canvas, {
        type: 'matrix',
        data: {
            datasets: [{
                label: '등급 × 함종',
                data: matrixData,
                backgroundColor: (ctx) => {
                    const v = ctx.raw?.v || 0;
                    if (!v) return colors.gridColor;
                    const alpha = 0.15 + 0.85 * (v / (maxV || 1));
                    return `rgba(91,155,213,${alpha.toFixed(3)})`;
                },
                borderColor: colors.gridColor,
                borderWidth: 1,
                width: (ctx) => {
                    const area = ctx.chart.chartArea;
                    return area ? area.width / types.length - 2 : 16;
                },
                height: (ctx) => {
                    const area = ctx.chart.chartArea;
                    return area ? area.height / rarities.length - 2 : 16;
                },
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: () => '',
                        label: (ctx) => ` ${ctx.raw.y} · ${ctx.raw.x}: ${ctx.raw.v}명`,
                    },
                },
            },
            scales: {
                x: {
                    type: 'category', labels: types, offset: true,
                    grid: { display: false },
                    ticks: { color: colors.textSecondary, font: { size: 10 }, maxRotation: 45 },
                },
                y: {
                    type: 'category', labels: rarities, offset: true,
                    grid: { display: false },
                    ticks: { color: colors.textSecondary, font: { size: 11 } },
                },
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
    _renderSkinDensityChart(data);
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
            <span class="summary-stat-label">평균/함순이</span>
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
    _sizeBarContainer(canvas, sorted.length);
    const colors = getChartColors();

    createChart('topSkin', canvas, {
        type: 'bar',
        data: {
            labels: sorted.map(d => d.displayName),
            datasets: [{ data: sorted.map(d => d.skin.total), backgroundColor: colors.palette[2], borderRadius: 4 }],
        },
        options: defaultChartOptions(true),
    });
}

function _renderSkinTypeChart(data) {
    const canvas = document.getElementById('skinTypeChart');
    if (!canvas) return;
    destroyChart('skinType');

    if (!hasTreemapController()) {
        canvas.hidden = true;
        canvas.closest('.chart-container')?.classList.add('chart-empty');
        return;
    }

    const typeCounts = {};
    for (const d of data) {
        for (const [type, count] of Object.entries(d.skin.skinTypes || {})) {
            if (type === '기본' || type === '개조') continue;
            typeCounts[type] = (typeCounts[type] || 0) + count;
        }
    }

    const tree = Object.entries(typeCounts)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);
    if (tree.length === 0) return;

    const colors = getChartColors();

    // Treemap cell labels are white; restrict to palette colors dark enough
    // for white text to stay legible (drops the light gold/blue/green entries).
    const treemapPalette = ['#5B9BD5', '#ED7D31', '#70AD47', '#4472C4', '#FF6B6B', '#47B39C', '#C55A89'];

    createChart('skinType', canvas, {
        type: 'treemap',
        data: {
            datasets: [{
                tree,
                key: 'count',
                groups: ['type'],
                spacing: 1,
                borderWidth: 0,
                backgroundColor: (ctx) => {
                    if (ctx.type !== 'data') return 'transparent';
                    return treemapPalette[ctx.dataIndex % treemapPalette.length];
                },
                labels: {
                    display: true,
                    color: '#ffffff',
                    font: { size: 11, weight: 700 },
                    formatter: (ctx) => [String(ctx.raw.g), `${ctx.raw.v}개`],
                },
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => String(items[0]?.raw?.g ?? ''),
                        label: (ctx) => ` ${ctx.raw.v}개`,
                    },
                },
            },
        },
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
            if (state.skinFilterPredicate && !state.skinFilterPredicate(skin)) continue;
            const skinId = String(skin['클뜯 id']);
            const dateStr = releaseSortKey((state.skinReleaseDates || {})[skinId]);
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
            if (state.skinFilterPredicate && !state.skinFilterPredicate(skin)) continue;
            const dateStr = releaseSortKey((state.skinReleaseDates || {})[String(skin['클뜯 id'])]);
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

/**
 * Render the skin-recency bubble chart: X = days since last skin, Y = total
 * skins. Shipgirls sharing the same point are grouped into one bubble whose
 * radius grows with the group size; bubbles are colored/outlined by rarity.
 */
function _renderSkinDensityChart(data) {
    const canvas = document.getElementById('skinDensityChart');
    if (!canvas) return;
    destroyChart('skinDensity');

    const rarities = ['N', 'R', 'SR', 'SSR', 'UR'];
    const colors = getChartColors();

    // Group shipgirls landing on the same (경과일, 스킨 수) point per rarity so a
    // cluster renders as one larger bubble instead of overplotted dots.
    const cellsByRarity = {};
    for (const r of rarities) cellsByRarity[r] = new Map();
    for (const d of data) {
        const days = d.skin.daysSinceLast;
        if (days == null) continue;
        const cells = cellsByRarity[d.rarity];
        if (!cells) continue;
        const key = `${days}|${d.skin.total}`;
        const cell = cells.get(key);
        if (cell) {
            cell.count++;
            if (cell.names.length < 8) cell.names.push(d.displayName);
        } else {
            cells.set(key, { x: days, y: d.skin.total, count: 1, names: [d.displayName] });
        }
    }

    if (rarities.every(r => cellsByRarity[r].size === 0)) return;

    // Bubble radius grows with the number of shipgirls sharing the point.
    const radiusFor = (count) => 3 + Math.sqrt(count - 1) * 2.4;

    const datasets = rarities.map(r => ({
        label: r,
        data: [...cellsByRarity[r].values()].map(c => ({
            x: c.x, y: c.y, r: radiusFor(c.count), count: c.count, names: c.names,
        })),
        backgroundColor: `${colors.rarityColors[r]}55`,
        borderColor: colors.rarityColors[r],
        borderWidth: 1,
        hoverBorderWidth: 2,
    }));

    createChart('skinDensity', canvas, {
        type: 'bubble',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: '보유 스킨 수 × 마지막 스킨 경과일',
                    color: colors.textSecondary,
                    font: { size: 12, weight: 700 },
                    padding: { bottom: 4 },
                },
                legend: { labels: { color: colors.text, font: { size: 11 }, usePointStyle: true } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const { x, y, count } = ctx.raw;
                            return count === 1
                                ? ` ${ctx.raw.names[0]}: 스킨 ${y}개 · ${x}일 경과`
                                : ` 스킨 ${y}개 · ${x}일 경과 · 함순이 ${count}명`;
                        },
                        afterLabel: (ctx) => {
                            const { count, names } = ctx.raw;
                            if (count === 1) return '';
                            return count > names.length
                                ? `${names.join(', ')} 외 ${count - names.length}명`
                                : names.join(', ');
                        },
                    },
                },
            },
            scales: {
                x: {
                    min: 0,
                    title: { display: true, text: '마지막 스킨 경과일', color: colors.textSecondary, font: { size: 10 } },
                    grid: { color: colors.gridColor },
                    ticks: { color: colors.textSecondary, font: { size: 10 } },
                },
                y: {
                    title: { display: true, text: '보유 스킨 수', color: colors.textSecondary, font: { size: 10 } },
                    grid: { color: colors.gridColor },
                    ticks: { color: colors.textSecondary, font: { size: 10 }, precision: 0 },
                },
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
