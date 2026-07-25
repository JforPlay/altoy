/**
 * equip.compare.js
 * Renders the multi-equip compare modal as a ROW-WISE table: one row per equipment
 * (so adding more equips grows the table vertically, never cramping horizontally),
 * one column per comparable stat, with a per-row level slider and best/worst
 * highlighting down each stat column. Columns include a per-armor-type "이론 DPS"
 * (theoretical DPS) folding damage × bullets × armor-mod / 사속.
 * Part of the equip viewer module group (viewer + data + detail + compare + upgrade).
 * Selection is driven by equip.viewer.js (toolbar 비교 select-mode); state is shared
 * via a ref passed to setup(). Pure flagging + DPS arithmetic live in equip.compare.logic.js.
 * Depends on equip.data.js for full equipment data and weapon/bullet/barrage lookups.
 */

import { openModal, setupModal, setUrlParams, escapeHtml } from '../utils.js';
import { getEquipIconUrl, getRarityBgUrl, getFullEquipData, getLevelStatistics, replaceEquipCodes, getFiringPattern, getVisibleLevelCount, formatLevel, getMergedWeaponProperties, getPrimaryWeaponProperty, getTheoreticalSurfaceDps, ensureCompareData } from './equip.data.js';
import { buildComparisonRows, compareRowFlags, formatDps } from './equip.compare.logic.js';

let state;

/** Receive shared state from equip.viewer.js. */
export function setup(stateRef) {
    state = stateRef;
}

// ===== Setup Compare Modal =====

/**
 * Wire up close handlers for the compare modal.
 * On close, clears the resolved items and the URL compare param.
 */
export function setupCompareModal() {
    setupModal('compareModal', {
        closeOnEscape: true,
        closeOnBackdrop: true,
        restoreFocus: true,
        onClose: () => {
            state.compareItems = [];
            setUrlParams({ compare: null }, { replace: true });
        }
    });
}

// ===== Render Compare Modal =====

/**
 * Populate and open the compare modal for a list of equips.
 * @param {{equip:object, level?:number}[]} items  full equip data + start level per
 *   column; `level` omitted ⇒ defaults to the equip's max enhance level.
 */
export function renderCompareModal(items) {
    const modalBody = document.getElementById('compareModalBody');
    if (!modalBody) return;

    // Default each column to the equip's MAX enhance level (last selectable slider
    // index); an explicit caller `level` still wins (0 honored via ??).
    state.compareItems = items.map(it => ({
        equip: it.equip,
        level: it.level ?? Math.max(0, getVisibleLevelCount(it.equip) - 1),
    }));
    state.compareColumns = freezeColumns(state.compareItems);

    modalBody.innerHTML = renderCompareTable();
    setupCompareListeners();
    openModal('compareModal');
}

// ===== Load Compare from URL =====

/**
 * Parse an "id1,id2,id3,…" URL compare param and open the modal.
 * Silently no-ops if fewer than two IDs resolve.
 */
export async function loadCompareFromUrl(compareParam) {
    const ids = compareParam.split(',').map(id => parseInt(id.trim())).filter(id => !Number.isNaN(id));
    if (ids.length < 2) return;

    await ensureCompareData();
    const equips = await Promise.all(ids.map(id => getFullEquipData(id)));
    const items = equips.filter(Boolean).map(equip => ({ equip })); // level ⇒ max (renderCompareModal default)

    if (items.length >= 2) renderCompareModal(items);
}

// ===== Columns model =====
// One column per comparable stat. Columns are FROZEN at modal open (and after a
// removal) so cell ids stay stable as level sliders move — a level change re-resolves
// values in place rather than rebuilding the table (which would kill a dragging slider).
// Each column carries an impure resolve(equip, level) → {value, display}: `value` is
// the number compared for best/worst (null = the equip lacks that stat → neutral);
// `display` is the cell text (may be styled HTML, hence not escaped at render).

const ARMOR_LABELS = ['경장', '중형', '중장']; // damage_type[0..2] = Light / Medium / Heavy

/** Build every candidate stat column (with resolvers) for the compared items. */
function getCompareColumns(items) {
    const cols = [];

    // Attributes — union of every equip's attr_info keys (higher is better).
    const allAttrs = new Map();
    for (const it of items) {
        for (const attr of (it.equip.attr_info || [])) {
            if (!allAttrs.has(attr.key)) allAttrs.set(attr.key, attr);
        }
    }
    for (const [key, attr] of allAttrs) {
        cols.push({
            key: `attr:${key}`, label: escapeHtml(attr.name), icon: attr.icon || null, dir: 'higher',
            resolve: (equip, level) => getAttrCell(equip, level, key),
        });
    }

    // 데미지 — styled text (replaceEquipCodes emits spans, so not escaped). Not ranked.
    cols.push({
        key: 'damage', label: '데미지', icon: null, dir: 'none',
        resolve: (equip, level) => {
            const d = level && level.damage;
            return { value: null, display: d ? replaceEquipCodes(d) : '-' };
        },
    });

    // 데미지 수정배율 — weapon coefficient (`corrected`, %), higher is better. The same
    // coefficient folded into 이론 DPS; read from the DPS weapon so they stay consistent.
    cols.push({
        key: 'coefficient', label: '데미지 수정배율', icon: null, dir: 'higher',
        resolve: (equip, level) => {
            const wp = getPrimaryMergedWeapon(equip, level);
            const c = wp && wp.corrected != null ? wp.corrected : null;
            return { value: c, display: c != null ? `${c}%` : '-' };
        },
    });

    // 사속 (reload, seconds) — lower is better.
    cols.push({
        key: 'reload', label: '사속', icon: null, dir: 'lower',
        resolve: (equip, level) => {
            const r = getReloadValue(equip, level);
            return { value: r, display: r != null ? `${r}s` : '-' };
        },
    });

    // 이론 DPS · 경장/중형/중장 — equip-only theoretical DPS per armor type (higher is better).
    for (let a = 0; a < 3; a++) {
        cols.push({
            key: `dps${a}`, label: `${a === 0 ? '이론 DPS · ' : ''}${ARMOR_LABELS[a]}`, icon: null, dir: 'higher',
            resolve: (equip, level) => getDpsCell(equip, level, a),
        });
    }

    // 대형 작전 세이렌 증가 대미지 (anti-siren) — higher is better.
    cols.push({
        key: 'siren', label: '대형 작전 세이렌 증가 대미지', icon: null, dir: 'higher',
        resolve: (equip, level) => {
            const stats = getLevelStatistics(level.id);
            const siren = stats && stats.anti_siren ? stats.anti_siren : null;
            return { value: siren, display: siren != null ? `${(siren / 100).toFixed(0)}%` : '-' };
        },
    });

    return cols;
}

/**
 * Freeze the column set: keep only columns at least one equip carries (drops e.g.
 * a 대공 column when nothing in the comparison is anti-air). Reuses the pure
 * buildComparisonRows drop rule against the current levels.
 */
function freezeColumns(items) {
    const levels = items.map(it => it.equip.levels[it.level] || it.equip.levels[0]);
    const defs = getCompareColumns(items);
    const pseudoRows = defs.map(col => ({
        key: col.key, dir: col.dir,
        cells: items.map((it, i) => col.resolve(it.equip, levels[i])),
    }));
    const surviving = new Set(buildComparisonRows(pseudoRows).map(r => r.key));
    return defs.filter(col => surviving.has(col.key));
}

// ===== Render =====

/**
 * Build the row-wise compare table: a sticky header row of stat columns, then one
 * row per equip (sticky identity cell + level slider + stat cells). Adding equips
 * grows the table downward; the column count is fixed by the (frozen) stat set.
 */
function renderCompareTable() {
    const headCols = state.compareColumns.map(col =>
        `<th class="compare-stat-head" title="${col.label}">${col.icon ? `<img class="stat-icon" src="${col.icon}" alt="">` : ''}${col.label}</th>`
    ).join('');

    return `
        <div class="compare-stats-section">
            <div class="compare-table-scroll scroll-styled">
                <table class="compare-table compare-table--rows">
                    <thead>
                        <tr>
                            <th class="compare-corner">장비</th>
                            <th class="compare-level-head">강화</th>
                            ${headCols}
                        </tr>
                    </thead>
                    <tbody id="compareTableBody">
                        ${renderCompareBodyRows()}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

/** Resolve every (column × equip) cell + best/worst flag for the current levels. */
function resolveCompareMatrix() {
    const items = state.compareItems;
    const levels = items.map(it => it.equip.levels[it.level] || it.equip.levels[0]);
    return state.compareColumns.map(col => {
        const cells = items.map((it, i) => col.resolve(it.equip, levels[i]));
        const flags = compareRowFlags(cells.map(c => c.value), col.dir);
        return { col, cells, flags };
    });
}

/** CSS class for one resolved cell given its column + flag. */
function cellClass(col, flag) {
    const neutral = col.dir === 'none' ? '' : 'compare-equal';
    const tone = flag === 'best' ? 'compare-better' : flag === 'worst' ? 'compare-worse' : neutral;
    return `compare-data-cell ${tone}`.trim();
}

/** Render every equip row (identity + level + stat cells). */
function renderCompareBodyRows() {
    const matrix = resolveCompareMatrix();
    return state.compareItems.map((it, i) => {
        const dataCells = matrix.map(({ col, cells, flags }, ci) =>
            `<td id="cmpCell-${i}-${ci}" class="${cellClass(col, flags[i])}">${cells[i].display}</td>`
        ).join('');
        return `<tr>${renderEquipCell(it, i)}${renderLevelCell(it, i)}${dataCells}</tr>`;
    }).join('');
}

/** Sticky identity cell: rarity-framed icon, name, 발사 패턴 sub-line, remove button. */
function renderEquipCell(it, i) {
    const iconUrl = getEquipIconUrl(it.equip.icon);
    const name = escapeHtml(it.equip.name);
    const pattern = getFiringPatternValue(it.equip, it.equip.levels[it.level] || it.equip.levels[0]);
    // Removing is only offered above the 2-item floor so a comparison always keeps ≥2 rows.
    const removeBtn = state.compareItems.length > 2
        ? `<button class="compare-col-remove" data-col="${i}" type="button" aria-label="비교에서 제거" title="비교에서 제거"><span class="material-symbols-outlined">close</span></button>`
        : '';
    return `<td class="compare-equip-cell">
        <div class="compare-equip-id">
            ${removeBtn}
            <div class="compare-slot-icon">
                <img class="equip-icon-bg-img" src="${getRarityBgUrl(it.equip.rarity)}" alt="">
                ${iconUrl ? `<img class="equip-icon-img" src="${iconUrl}" alt="${name}">` : ''}
            </div>
            <div class="compare-equip-meta">
                <span class="compare-col-name" title="${name}">${name}</span>
                ${pattern ? `<span class="compare-equip-pattern" title="${escapeHtml(pattern)}">${escapeHtml(pattern)}</span>` : ''}
            </div>
        </div>
    </td>`;
}

/** Per-row level slider cell (or a dash when the equip has no enhance levels). */
function renderLevelCell(it, i) {
    const maxLevel = getVisibleLevelCount(it.equip);
    if (maxLevel <= 1) return `<td class="compare-level-cell"><span class="compare-level-value">—</span></td>`;
    return `<td class="compare-level-cell">
        <input type="range" min="0" max="${maxLevel - 1}" value="${it.level}" data-col="${i}" class="compare-level-input" aria-label="${escapeHtml(it.equip.name)} 강화 단계">
        <span class="compare-level-value" id="compareLevelValue${i}">${formatLevel(it.level)}</span>
    </td>`;
}

// ===== Stat resolvers (impure: read loaded weapon/bullet/barrage/statistics data) =====

/** Resolve one attr's level value into a cell — absent attr → neutral '-'. */
function getAttrCell(equip, level, attrKey) {
    const attr = (equip.attr_info || []).find(a => a.key === attrKey);
    if (!attr) return { value: null, display: '-' };
    const raw = level[`attr_${attr.index}_value`];
    const n = parseFloat(raw);
    if (raw == null || raw === '' || Number.isNaN(n)) return { value: null, display: '-' };
    return { value: n, display: escapeHtml(String(raw)) };
}

/** Get reload value (사속, seconds) from the primary weapon — standard path, matching
 *  the detail panel's 사속 row (never resolved through the aircraft chain). */
function getReloadValue(equip, level) {
    const wp = getPrimaryWeaponProperty(equip, level);
    if (!wp || wp.reload_max == null) return null;
    return Math.floor((wp.reload_max / 150) * 100) / 100;
}

/** First merged weapon property for a level — the one 데미지 수정배율 / 대갑 / 패턴 / DPS
 *  all read (aircraft-safe via getMergedWeaponProperties), or null. */
function getPrimaryMergedWeapon(equip, level) {
    return getMergedWeaponProperties(equip, level)[0] || null;
}

/** Get the firing-pattern string from a slot's primary weapon, or null. */
function getFiringPatternValue(equip, level) {
    const wp = getPrimaryMergedWeapon(equip, level);
    return wp ? getFiringPattern(wp) : null;
}

/**
 * Resolve one equip's combined 이론 DPS against armor type `armorIndex` (0=경장,1=중형,2=중장).
 * Sums every surface weapon (aircraft drop ordnance over the airstrike cadence × 2.2, strafing
 * guns excluded; surface mounts use their own 사속) via `getTheoreticalSurfaceDps`. The cell
 * shows the DPS (drives best/worst); a single-weapon equip also shows its 대갑 배율 as a muted
 * sub-label (a multi-weapon sum has no single mod, so it's omitted there).
 */
function getDpsCell(equip, level, armorIndex) {
    const result = getTheoreticalSurfaceDps(equip, level);
    const dps = result ? result.dps[armorIndex] : null;
    if (dps == null) return { value: null, display: '-' };
    const mod = result.mods ? result.mods[armorIndex] : null;
    const modLabel = mod != null ? `<span class="compare-dps-mod">${Math.round(mod * 100)}%</span>` : '';
    return { value: dps, display: `<span class="compare-dps-val">${formatDps(dps)}</span>${modLabel}` };
}

// ===== Event Listeners =====

/**
 * Attach listeners after modal HTML is injected. A level slider re-resolves stat
 * cells IN PLACE (the slider DOM is untouched, so a drag isn't interrupted). The
 * per-row remove button drops that equip, re-freezes columns, and re-renders.
 */
function setupCompareListeners() {
    document.querySelectorAll('#compareModalBody .compare-level-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const col = parseInt(e.target.dataset.col);
            if (!state.compareItems[col]) return;
            state.compareItems[col].level = parseInt(e.target.value);
            const valueEl = document.getElementById(`compareLevelValue${col}`);
            if (valueEl) valueEl.textContent = formatLevel(state.compareItems[col].level);
            refreshCompareCells();
        });
    });

    document.querySelectorAll('#compareModalBody .compare-col-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const col = parseInt(e.currentTarget.dataset.col);
            state.compareItems.splice(col, 1);
            setUrlParams({ compare: state.compareItems.map(it => it.equip.id).join(',') }, { replace: true });
            rerenderCompareModal();
        });
    });
}

/**
 * Re-resolve stat cells for the current levels and update them in place (text +
 * best/worst class) without rebuilding the equip/level cells — so the slider being
 * dragged survives. Best/worst can shift for OTHER equips too, so every cell refreshes.
 */
function refreshCompareCells() {
    resolveCompareMatrix().forEach(({ col, cells, flags }, ci) => {
        cells.forEach((c, i) => {
            const el = document.getElementById(`cmpCell-${i}-${ci}`);
            if (!el) return;
            el.className = cellClass(col, flags[i]);
            el.innerHTML = c.display;
        });
    });
}

/** Rebuild the whole table (after a row is removed) and re-bind listeners. */
function rerenderCompareModal() {
    const modalBody = document.getElementById('compareModalBody');
    if (!modalBody) return;
    state.compareColumns = freezeColumns(state.compareItems);
    modalBody.innerHTML = renderCompareTable();
    setupCompareListeners();
}
