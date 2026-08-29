/**
 * Fleet Build Simulator — UI Rendering Module
 * Renders ship cards (empty + populated), stats grids, reload times,
 * and fleet summary (tech bonuses + passive skills).
 */

import { showElement, hideElement, IMG_FALLBACKS, resolveUrl, escapeHtml, renderStatus } from '../utils.js';
import { getShipByGid, getEquipById, getEquipIconUrl, getRarityBgUrl, getShipPortraitUrl, getSlotName, getSPWeaponIconUrl, getMetaBoss } from './fleet-sim.data.js';
import {
    DISPLAY_STATS,
    pickVitalStats,
    calculateShipStats,
    calculateFleetTechBonuses,
    resolvePassiveBuffs,
    computeHighlights,
    SHIPTYPE_TECH_KEY,
} from './fleet-sim.calc.js';
import { simulateFleetDamage, effectiveProficiency, hasFateSimulation } from './fleet-sim.damage.js';
import { ARMOR_PRESETS, BATTLE_START_DELAY } from '../engine/damage/index.js';

// ===== State =====
let state;

// ===== DOM Cache =====
let cardElements = [];    // 6 .ship-card elements (indexed by slot)
let summarySection = null;
let techBonusList = null;
let passiveSkillList = null;
let loadingOverlay = null;
let damageResultsEl = null;

/** Track which slots have stats collapsed (persists across re-renders) */
const statsCollapsed = new Set([0, 1, 2, 3, 4, 5]);

/** Last successfully computed damage result — used for per-weapon card breakdown */
let _lastDamageResult = null;

// ===== Constants =====

/** Affinity option labels (value → Korean display) */
const AFFINITY_OPTIONS = [
    { value: 'other',    label: '기타' },
    { value: 'friendly', label: '호감' },
    { value: 'crush',    label: '기쁨' },
    { value: 'love',     label: '사랑' },
    { value: 'oath',     label: '서약' },
    { value: 'oath200',  label: '서약200' },
];

/** Map equip numeric rarity → CSS attribute value */
const EQUIP_RARITY_MAP = {
    6: 'ur',
    5: 'ssr',
    4: 'sr',
    3: 'r',
    2: 'n',
};

/** SP weapon rarity is shifted by 1 vs regular equip: 2=R, 3=SR, 4=SSR */
const SP_RARITY_MAP = {
    5: 'ur',
    4: 'ssr',
    3: 'sr',
    2: 'r',
};

// ===== Setup =====

export function setup(stateRef) {
    state = stateRef;
    _cacheDOM();
}

// ===== Public API =====

/**
 * Toggle stats visibility for a given ship slot.
 */
/**
 * Drop the cached damage result and supersede any in-flight damage render.
 * Cards match their per-weapon breakdown by gid, so a ship present in two
 * fleets would otherwise paint the other fleet's numbers after a switch — and
 * an in-flight render for the old fleet must not land either, which the token
 * bump handles (renderFleet skips renderDamagePanel entirely for an empty
 * fleet, so it cannot be relied on to bump the token itself).
 */
export function clearDamageCache() {
    _lastDamageResult = null;
    _renderToken++;
}

export function toggleStats(slotIndex) {
    if (statsCollapsed.has(slotIndex)) {
        statsCollapsed.delete(slotIndex);
    } else {
        statsCollapsed.add(slotIndex);
    }

    // Toggle DOM directly without full re-render
    const card = cardElements[slotIndex];
    if (!card) return;

    const toggle = card.querySelector('.stats-toggle');
    const collapsible = card.querySelector('.ship-stats-collapsible');
    if (toggle && collapsible) {
        const isCollapsed = statsCollapsed.has(slotIndex);
        toggle.classList.toggle('collapsed', isCollapsed);
        collapsible.classList.toggle('collapsed', isCollapsed);
        toggle.setAttribute('aria-expanded', String(!isCollapsed));
    }
}

/**
 * Full re-render of all 6 ship cards and fleet summary.
 * Called whenever fleet composition, levels, affinity, or equipment changes.
 */
export function renderFleet() {
    // 1. Calculate fleet tech bonuses (from tracker localStorage)
    const techBonuses = calculateFleetTechBonuses();

    // 2. Build ship data objects for passive buff resolution
    const fleetShips = state.ships.map(slot => {
        if (!slot || !slot.gid) return null;
        return getShipByGid(slot.gid);
    });

    // 3. Calculate stats for all 6 slots
    const allResults = [];   // { stats, reloads } or null
    const allStats = [];     // raw stats objects for highlight comparison

    for (let i = 0; i < 6; i++) {
        const slotConfig = state.ships[i];
        if (!slotConfig || !slotConfig.gid) {
            allResults.push(null);
            allStats.push(null);
            continue;
        }

        const ship = fleetShips[i];
        const passiveBuffs = ship ? resolvePassiveBuffs(ship, fleetShips, i, state.ships) : [];
        const result = calculateShipStats(slotConfig, techBonuses, passiveBuffs);

        allResults.push(result);
        allStats.push(result ? result.stats : null);
    }

    // 4. Compute stat highlights across all slots
    const highlights = computeHighlights(allStats);

    // 5. Render each card (uses _lastDamageResult from previous calc for breakdown)
    for (let i = 0; i < 6; i++) {
        _renderCard(i, allResults[i], highlights);
    }

    // 6. Render fleet summary
    _renderFleetSummary(techBonuses, fleetShips);

    // 7. Hide loading overlay
    if (loadingOverlay) {
        hideElement(loadingOverlay);
    }

    // 8. Trigger async damage panel (fire-and-forget; updates DOM when resolved)
    const hasAnyShip = fleetShips.some(s => s !== null);
    if (damageResultsEl) {
        if (hasAnyShip) {
            renderDamagePanel(damageResultsEl).catch((err) => {
                console.warn('[fleet-sim] damage panel error:', err);
            });
        } else {
            damageResultsEl.innerHTML = '';
        }
    }
}

// ===== Card Rendering =====

/**
 * Render a single ship card (empty or populated).
 */
function _renderCard(slotIndex, calcResult, highlights) {
    const card = cardElements[slotIndex];
    if (!card) return;

    const slotConfig = state.ships[slotIndex];

    if (!slotConfig || !slotConfig.gid) {
        _renderEmptyCard(card, slotIndex);
        return;
    }

    const ship = getShipByGid(slotConfig.gid);
    if (!ship) {
        _renderEmptyCard(card, slotIndex);
        return;
    }

    // Look up this ship's per-weapon result from the last damage calc (may be null on first render)
    const shipDmgResult = _lastDamageResult
        ? (_lastDamageResult.perShip.find(s => s.ref === slotConfig.gid) || null)
        : null;

    _renderPopulatedCard(card, slotIndex, ship, slotConfig, calcResult, highlights, shipDmgResult);
}

/**
 * Render an empty card with "add ship" button.
 */
function _renderEmptyCard(card, slotIndex) {
    card.className = 'ship-card ship-card--empty';
    card.draggable = false;
    card.dataset.slot = slotIndex;
    card.innerHTML = `
        <button class="ship-card-add" data-action="change-ship" data-slot="${slotIndex}" aria-label="함순이 추가">
            <span class="material-symbols-outlined">add</span>
            <span class="add-label">함순이 추가</span>
        </button>
    `;
}

/**
 * Render a populated card with all sections.
 */
function _renderPopulatedCard(card, slotIndex, ship, slotConfig, calcResult, highlights, shipDmgResult = null) {
    card.className = 'ship-card';
    card.dataset.slot = slotIndex;
    card.draggable = true;

    const frag = document.createDocumentFragment();
    const wrapper = document.createElement('div');

    // Build all sections as HTML string for efficiency
    const isCollapsed = statsCollapsed.has(slotIndex);
    const html = [
        _buildIdentityHTML(slotIndex, ship, slotConfig),
        _buildVitalsHTML(calcResult),
        _buildEquipSlotsHTML(slotIndex, ship, slotConfig),
        _buildStatsToggleHTML(slotIndex, isCollapsed),
        `<div class="ship-stats-collapsible${isCollapsed ? ' collapsed' : ''}"><div class="ship-stats-collapsible-inner">`,
        _buildStatsHTML(slotIndex, calcResult, highlights),
        _buildWeaponBreakdownHTML(shipDmgResult),
        `</div></div>`,
    ].join('');

    wrapper.innerHTML = html;

    // Move children into fragment
    while (wrapper.firstChild) {
        frag.appendChild(wrapper.firstChild);
    }

    card.innerHTML = '';
    card.appendChild(frag);

    // Set up image error handlers after DOM insertion
    _setupImageFallbacks(card);
}

// ===== Section Builders =====

/**
 * Build identity section: portrait + name + type/nation + remove button.
 */
function _buildIdentityHTML(slotIndex, ship, slotConfig) {
    const portraitUrl = getShipPortraitUrl(ship.skin_id);
    const shipType = _getShipTypeName(ship.type);
    const shipNation = _getNationalityName(ship.nationality);
    const typeNation = [shipType, shipNation].filter(Boolean).join(' · ');
    const safeShipName = escapeHtml(ship.name || '');
    const safeTypeNation = escapeHtml(typeNation);
    // ship.rarity is already the rarity.css palette-class suffix (N/R/SR/SSR/UR).
    const rarityGrade = String(ship.rarity || '').toUpperCase();
    const rarityBadge = rarityGrade
        ? `<span class="rarity-badge rarity-${escapeHtml(rarityGrade)} ship-rarity-badge">${escapeHtml(rarityGrade)}</span>`
        : '';
    const level = slotConfig.level || 125;
    const affinity = slotConfig.affinity || 'love';

    // Retrofit toggle
    let retrofitHTML = '';
    if (ship.retrofit) {
        const isRetrofit = slotConfig.retrofit !== false;
        retrofitHTML = `
            <label class="retrofit-toggle" title="개장 적용">
                <input type="checkbox" data-action="toggle-retrofit" data-slot="${slotIndex}" ${isRetrofit ? 'checked' : ''} />
                <span class="toggle-track"></span>
                <span class="toggle-label">개장</span>
            </label>`;
    }

    // 운명 시뮬레이션 — none vs. all five steps. Only the 33 research ships that have
    // one show it; its whole stat payload is 행운, the rest is the skill upgrades.
    let fateHTML = '';
    if (hasFateSimulation(ship)) {
        const isFate = slotConfig.fate !== false;
        fateHTML = `
            <label class="retrofit-toggle" title="운명 시뮬레이션 5단계(용골 max) 적용">
                <input type="checkbox" data-action="toggle-fate" data-slot="${slotIndex}" ${isFate ? 'checked' : ''} />
                <span class="toggle-track"></span>
                <span class="toggle-label">용골 max</span>
            </label>`;
    }

    const affinityOptions = AFFINITY_OPTIONS.map(opt =>
        `<option value="${opt.value}"${opt.value === affinity ? ' selected' : ''}>${opt.label}</option>`
    ).join('');

    return `
        <div class="ship-card-identity" data-level="${escapeHtml(String(level))}" data-rarity="${escapeHtml(rarityGrade)}">
            <span class="material-symbols-outlined drag-handle" title="드래그하여 이동">drag_indicator</span>
            <div class="ship-portrait-wrap">
                <img class="ship-portrait"
                     src="${portraitUrl}"
                     alt="${safeShipName}"
                     role="button"
                     tabindex="0"
                     data-action="change-ship"
                     data-slot="${slotIndex}"
                     loading="lazy" />
                ${rarityBadge}
            </div>
            <div class="ship-identity-main">
                <div class="ship-name" title="${safeShipName}">${safeShipName}</div>
                <div class="ship-identity-bottom">
                    <div class="ship-type-nation" title="${safeTypeNation}">${safeTypeNation}</div>
                    ${retrofitHTML}
                    ${fateHTML}
                </div>
            </div>
            <div class="ship-identity-controls">
                <div class="config-group">
                    <span class="config-label">Lv.</span>
                    <div class="level-stepper btn-group">
                        <button class="btn btn-icon btn-sm stepper-btn" data-action="step-level" data-slot="${slotIndex}" data-dir="-1">−</button>
                        <span class="stepper-value" data-action="edit-level" data-slot="${slotIndex}">${level}</span>
                        <button class="btn btn-icon btn-sm stepper-btn" data-action="step-level" data-slot="${slotIndex}" data-dir="1">+</button>
                    </div>
                </div>
                <div class="config-group">
                    <span class="config-label">호감도</span>
                    <span class="select-wrap">
                        <select class="config-select"
                                data-action="change-affinity"
                                data-slot="${slotIndex}">
                            ${affinityOptions}
                        </select>
                    </span>
                </div>
            </div>
            <div class="ship-card-actions">
                <button class="btn btn-ghost btn-sm equip-code-btn" data-action="equip-code" data-slot="${slotIndex}"
                        title="이 함순이의 장비 코드 만들기 / 불러오기" aria-label="장비 코드">
                    <span class="equip-code-btn-label">장비 코드</span>
                </button>
                <button class="btn btn-close btn-sm" data-action="remove-ship" data-slot="${slotIndex}" title="제거" aria-label="제거">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
        </div>
    `;
}

/**
 * Build equip slots grid: up to 5 equip slots + optional SP weapon.
 */
function _buildEquipSlotsHTML(slotIndex, ship, slotConfig) {
    const equips = slotConfig.equips || [];
    const isRetrofit = slotConfig.retrofit !== false && !!ship.retrofit;
    let slotsHTML = '';

    // 5 standard equip slots (indices 0-4)
    for (let i = 0; i < 5; i++) {
        slotsHTML += _buildSingleEquipSlotHTML(slotIndex, i, equips[i], ship, isRetrofit);
    }

    // 6th cell: SP weapon slot
    slotsHTML += _buildSPSlotHTML(slotIndex, ship, slotConfig);

    return `<div class="equip-slots-grid">${slotsHTML}</div>`;
}

/**
 * Build a single equip slot cell.
 *
 * The caption names the equip on filled slots and the slot type on empty
 * ones, so every cell can be read without relying on the icon alone. The
 * `title` attribute carries `slotName: equipName` in both states for hover
 * and assistive tech.
 */
function _buildSingleEquipSlotHTML(slotIndex, equipIndex, equipConfig, ship, isRetrofit) {
    const slotName = getSlotName(ship, equipIndex, isRetrofit);
    const safeSlotName = escapeHtml(slotName);
    const equip = equipConfig && equipConfig.id ? getEquipById(equipConfig.id) : null;

    if (!equip) {
        return `
            <div class="equip-slot"
                 role="button"
                 tabindex="0"
                 data-action="change-equip"
                 data-slot="${slotIndex}"
                 data-equip-index="${equipIndex}"
                 title="${safeSlotName}">
                <div class="equip-slot-icon-box">
                    <span class="equip-slot-empty"><span class="material-symbols-outlined">add</span></span>
                </div>
                <span class="equip-slot-caption equip-slot-caption--label">${safeSlotName}</span>
            </div>
        `;
    }

    const iconUrl = getEquipIconUrl(equip.icon);
    const bgUrl = getRarityBgUrl(equip.rarity);
    const rarityAttr = EQUIP_RARITY_MAP[equip.rarity] || '';
    const enhanceLevel = equipConfig.level || 0;
    const safeEquipName = escapeHtml(equip.name || '');

    // Weapon slots (0-2) carry an equipment-efficiency multiplier (max-LB +
    // retrofit). effectiveProficiency fills gaps with `?? 1`, so a `!= null`
    // guard is always true — gate on the VALUE instead, or every card prints
    // six copies of 100%.
    let effBadge = '';
    if (equipIndex < 3) {
        const eff = effectiveProficiency(ship, isRetrofit)[equipIndex];
        if (eff != null && eff !== 1) {
            effBadge = `<span class="equip-slot-badge equip-eff-badge" title="장비 효율">${Math.round(eff * 100)}%</span>`;
        }
    }

    return `
        <div class="equip-slot equipped"
             role="button"
             tabindex="0"
             data-action="change-equip"
             data-slot="${slotIndex}"
             data-equip-index="${equipIndex}"
             data-equip-rarity="${rarityAttr}"
             title="${safeSlotName}: ${safeEquipName}">
            <div class="equip-slot-icon-box">
                <div class="equip-icon-wrapper">
                    <img class="equip-icon-bg" src="${bgUrl}" alt="" loading="lazy" />
                    ${iconUrl ? `<img class="equip-icon-fg" src="${iconUrl}" alt="${safeEquipName}" loading="lazy" />` : ''}
                </div>
                ${effBadge}
                <span class="equip-slot-badge equip-enhance-badge"
                      data-action="change-equip-level"
                      data-slot="${slotIndex}"
                      data-equip-index="${equipIndex}">+${enhanceLevel}</span>
            </div>
            <span class="equip-slot-caption" title="${safeEquipName}">${safeEquipName}</span>
        </div>
    `;
}

/**
 * Build the SP weapon (6th) slot. One path: whatever the slot holds is a real,
 * selectable weapon with a live level badge — a 전용 장비 is materialised into
 * slot state on ship select, so it no longer needs a display-only branch.
 */
function _buildSPSlotHTML(slotIndex, ship, slotConfig) {
    const spConfig = slotConfig.spWeapon;
    if (spConfig && spConfig.id) {
        const spWeapon = _getSPWeaponDataById(spConfig.id);
        if (spWeapon) {
            const iconUrl = getSPWeaponIconUrl(spWeapon.icon);
            const bgUrl = getRarityBgUrl(spWeapon.rarity + 1);
            const safeName = escapeHtml(spWeapon.name || '');
            return `
                <div class="equip-slot equipped sp-slot"
                     role="button"
                     tabindex="0"
                     data-action="change-sp-weapon"
                     data-slot="${slotIndex}"
                     data-equip-rarity="${SP_RARITY_MAP[spWeapon.rarity] || ''}"
                     title="${safeName}">
                    <div class="equip-slot-icon-box">
                        <div class="equip-icon-wrapper">
                            <img class="equip-icon-bg" src="${bgUrl}" alt="" loading="lazy" />
                            ${iconUrl ? `<img class="equip-icon-fg" src="${iconUrl}" alt="${safeName}" loading="lazy" />` : ''}
                        </div>
                        <span class="equip-slot-badge equip-enhance-badge"
                              data-action="change-sp-level"
                              data-slot="${slotIndex}">+${spConfig.level ?? 0}</span>
                    </div>
                    <span class="equip-slot-caption" title="${safeName}">${safeName}</span>
                </div>`;
        }
    }

    // Nothing equipped — empty slot that opens the SP picker
    return `
        <div class="equip-slot sp-slot"
             role="button"
             tabindex="0"
             data-action="change-sp-weapon"
             data-slot="${slotIndex}"
             title="특수 장비 선택">
            <div class="equip-slot-icon-box">
                <span class="equip-slot-empty"><span class="material-symbols-outlined">add</span></span>
            </div>
            <span class="equip-slot-caption equip-slot-caption--label">특수 장비</span>
        </div>`;
}

/** Helper to get SP weapon data from state */
function _getSPWeaponDataById(id) {
    if (!state.spWeaponData || !state.spWeaponData.weapons) return null;
    return state.spWeaponData.weapons[String(id)] || null;
}

/**
 * Build stats toggle button.
 */
function _buildStatsToggleHTML(slotIndex, isCollapsed) {
    return `
        <div class="stats-toggle${isCollapsed ? ' collapsed' : ''}" role="button" tabindex="0" aria-expanded="${String(!isCollapsed)}" data-action="toggle-stats" data-slot="${slotIndex}">
            <span class="stats-toggle-label">스탯 전체</span>
            <span class="material-symbols-outlined">expand_less</span>
        </div>
    `;
}

/**
 * Build stats grid: 2-column grid with 8 stats.
 */
function _buildStatsHTML(slotIndex, calcResult, highlights) {
    const stats = calcResult ? calcResult.stats : null;
    const breakdown = calcResult ? calcResult.breakdown : null;

    const rows = DISPLAY_STATS.map(({ key, label }) => {
        const value = stats ? (stats[key] || 0) : 0;
        const isZero = value === 0;
        const isBest = highlights[key] && highlights[key].has(slotIndex);

        let valueClasses = 'stat-value';
        if (isZero) valueClasses += ' stat-zero';
        else if (isBest) valueClasses += ' stat-best';

        const displayValue = isZero ? '---' : Math.floor(value);
        const marker = (!isZero && isBest) ? '<span class="stat-best-marker">★</span>' : '';

        // Breakdown line: base + equip + tech + buff
        let breakdownHTML = '';
        if (!isZero && breakdown && breakdown[key]) {
            breakdownHTML = _buildBreakdownHTML(breakdown[key]);
        }

        return `
            <div class="ship-stat-row${breakdownHTML ? ' has-breakdown' : ''}">
                <span class="stat-label">${label}</span>
                <span class="${valueClasses}">${displayValue}${marker}</span>
                ${breakdownHTML}
            </div>
        `;
    }).join('');

    return `<div class="ship-stats-grid">${rows}</div>`;
}

/**
 * Build compact breakdown HTML for a single stat.
 * Shows: base + non-zero bonus components.
 */
function _buildBreakdownHTML(bd) {
    const parts = [];
    parts.push(`<span class="bd-base">${bd.base}</span>`);

    if (bd.equip) parts.push(`<span class="bd-equip">+${bd.equip}</span>`);
    if (bd.tech) parts.push(`<span class="bd-tech">+${bd.tech}</span>`);
    if (bd.buffFlat) parts.push(`<span class="bd-buff">+${bd.buffFlat}</span>`);
    if (bd.buffRatio) {
        const pct = bd.buffRatioPercent % 1 === 0
            ? bd.buffRatioPercent.toFixed(0) : bd.buffRatioPercent.toFixed(1);
        parts.push(`<span class="bd-buff">+${bd.buffRatio}<small>(${pct}%)</small></span>`);
    }

    // Only show breakdown if there are bonuses beyond base
    if (parts.length <= 1) return '';

    return `<span class="stat-breakdown">${parts.join('')}</span>`;
}

/**
 * Build the always-on vitals strip: offensive headline stats, then reload times.
 *
 * Returns '' rather than an empty wrapper when there is nothing to show — the
 * predecessor (.ship-reload-bar) emitted a childless div with a min-height and a
 * background, which drew a hollow tinted band on every equip-less ship.
 */
function _buildVitalsHTML(calcResult) {
    const vitals = pickVitalStats(calcResult ? calcResult.stats : null);
    const statItems = vitals.map(({ label, value }) => `
        <span class="vital-stat">
            <span class="vital-label">${escapeHtml(label)}</span>
            <span class="vital-value">${value}</span>
        </span>`).join('');

    const reloads = (calcResult && calcResult.reloads) || [];
    const reloadItems = reloads.map(({ label, seconds }) => `
        <span class="reload-item">
            <span class="material-symbols-outlined">timer</span>
            <span>${escapeHtml(String(label))}</span>
            <span class="reload-value">${seconds.toFixed(2)}s</span>
        </span>`).join('');

    if (!statItems && !reloadItems) return '';

    const sep = (statItems && reloadItems) ? '<span class="vital-sep" aria-hidden="true"></span>' : '';
    return `<div class="ship-vitals">${statItems}${sep}${reloadItems}</div>`;
}

// ===== Fleet Summary =====

/**
 * Render fleet summary section (tech bonuses + passive skills).
 */
function _renderFleetSummary(techBonuses, fleetShips) {
    const hasAnyShip = fleetShips.some(s => s !== null);

    if (!hasAnyShip) {
        if (summarySection) hideElement(summarySection);
        return;
    }

    if (summarySection) showElement(summarySection);

    _renderTechBonuses(techBonuses);
    _renderPassiveSkills(fleetShips);
}

/**
 * Render fleet tech bonus list.
 */
function _renderTechBonuses(techBonuses) {
    if (!techBonusList) return;

    if (!techBonuses) {
        const basePath = resolveUrl('shipgirl/shipgirl-tracker');
        techBonusList.innerHTML = `
            <div class="page-status page-status-empty page-status--compact">
                <span class="material-symbols-outlined page-status-icon">info</span>
                <p class="page-status-msg">함대 기술 데이터 없음</p>
                <a class="page-status-action" href="${basePath}">함순이 육성트래커로 이동</a>
            </div>
        `;
        return;
    }

    const frag = document.createDocumentFragment();

    for (const [groupId, data] of Object.entries(techBonuses)) {
        // 함종 기술 has no level and no pt threshold — it is a flat per-hull-type
        // sum — so it reports how many hull types it is currently feeding instead
        // of a fabricated Lv.undefined (0pt).
        const item = document.createElement('div');
        item.className = 'tech-bonus-item';
        const name = document.createElement('span');
        name.textContent = data.name || '';
        const value = document.createElement('span');
        value.className = 'tech-bonus-value';
        value.textContent = groupId === SHIPTYPE_TECH_KEY
            ? `${Object.keys(data.bonusByShipType || {}).length}개 함종`
            : `Lv.${data.level} (${data.score}pt)`;
        item.append(name, value);
        frag.appendChild(item);
    }

    techBonusList.innerHTML = '';
    techBonusList.appendChild(frag);
}

/**
 * Render passive skills list (unique skills from all fleet members).
 */
function _renderPassiveSkills(fleetShips) {
    if (!passiveSkillList) return;

    // Collect unique passive skill IDs across all fleet members
    const seenSkillIds = new Set();
    const skillEntries = [];

    for (const ship of fleetShips) {
        if (!ship || !ship.skill) continue;

        for (const skillId of Object.keys(ship.skill)) {
            if (seenSkillIds.has(skillId)) continue;

            // Check if this skill has passive data
            const passiveData = state.passiveSkillData
                ? state.passiveSkillData[String(skillId)]
                : null;
            if (!passiveData) continue;

            seenSkillIds.add(skillId);
            skillEntries.push({
                id: skillId,
                name: passiveData.name || `스킬 ${skillId}`,
                targetMode: passiveData.target_mode || '',
                ownerName: ship.name,
            });
        }
    }

    if (skillEntries.length === 0) {
        passiveSkillList.innerHTML = `
            <div class="page-status page-status-empty page-status--compact">
                <span class="material-symbols-outlined page-status-icon">info</span>
                <p class="page-status-msg">적용 가능한 패시브 스킬 없음</p>
            </div>
        `;
        return;
    }

    const frag = document.createDocumentFragment();

    for (const entry of skillEntries) {
        const targetLabel = entry.targetMode === 'self' ? '자신' : '함대';
        const item = document.createElement('div');
        item.className = 'passive-skill-item';
        const name = document.createElement('span');
        name.textContent = entry.name;
        const value = document.createElement('span');
        value.className = 'passive-skill-value';
        value.textContent = `${entry.ownerName} (${targetLabel})`;
        item.append(name, value);
        frag.appendChild(item);
    }

    passiveSkillList.innerHTML = '';
    passiveSkillList.appendChild(frag);
}

// ===== Internal Helpers =====

/**
 * Cache DOM element references for re-use.
 */
function _cacheDOM() {
    cardElements = [];
    for (let i = 0; i < 6; i++) {
        const el = document.querySelector(`.ship-card[data-slot="${i}"]`);
        if (el) cardElements.push(el);
    }

    summarySection = document.getElementById('fleet-summary');
    techBonusList = document.querySelector('#fleet-tech-bonuses .tech-bonus-list');
    passiveSkillList = document.querySelector('#fleet-passive-skills .passive-skill-list');
    loadingOverlay = document.getElementById('loading-overlay');
    damageResultsEl = document.getElementById('damage-results');
}

/**
 * Set up image onerror fallback handlers on all images within a card.
 */
function _setupImageFallbacks(card) {
    const images = card.querySelectorAll('img');
    for (const img of images) {
        img.onerror = function () {
            this.onerror = null;
            this.src = IMG_FALLBACKS.DEFAULT;
        };
    }
}

/**
 * Get ship type display name from ship type ID.
 */
function _getShipTypeName(typeId) {
    if (!state.shipTypeData) return '';
    const typeInfo = state.shipTypeData[String(typeId)];
    return typeInfo ? typeInfo.type_name : '';
}

/**
 * Get nationality display name from nationality ID.
 */
function _getNationalityName(natId) {
    if (!state.nationalityData) return '';
    const natInfo = state.nationalityData[String(natId)];
    return natInfo ? natInfo.name : '';
}

// ===== Damage Panel =====

/** Format number with thousands separators, rounded to nearest integer. */
const _fmt = (n) => Math.round(n).toLocaleString('en-US');

/**
 * Build per-weapon breakdown table HTML for a ship's damage result.
 * Shown inside the stats collapsible. Returns empty string if no data.
 */
function _buildWeaponBreakdownHTML(shipResult) {
    if (!shipResult || !Array.isArray(shipResult.perWeapon) || shipResult.perWeapon.length === 0) return '';
    // Salvo counts are rolled up to the sim window, which is the kill time when
    // the boss dies first — so the column header cannot say a fixed 90초.
    const winLabel = (_lastDamageResult?.window ?? 90).toFixed(1).replace(/\.0$/, '');
    const rows = shipResult.perWeapon.map((w) => `
        <tr${w.cadence ? ' class="dmg-row-barrage"' : ''}>
            <td>${escapeHtml(w.label || '')}</td>
            <td>${_fmt(w.oneSalvoExpected)}</td>
            <td>${w.cadence ? escapeHtml(w.cadence) : `${w.reloadInterval.toFixed(2)}s`}</td>
            <td>${w.salvoCount % 1 ? w.salvoCount.toFixed(1) : w.salvoCount}</td>
            <td>${_fmt(w.dps)}</td>
            <td>${Math.round(w.hitRate * 100)}%</td>
            <td>${Math.round(w.critRate * 100)}%</td>
        </tr>`).join('');
    // A barrage's activation count can be fractional (proc chance is an expected
    // value over the window), so it's formatted above rather than printed raw.
    // Two different answers, so two different notes: the trigger could not be read
    // at all, vs it was read and this loadout never fires it (unequipped ship,
    // carrier, 대공 slot). One shared message called both a failure and made an
    // empty or carrier card look broken.
    const unmodeled = (shipResult.unmodeledBarrages
        ? `<p class="dmg-unmodeled-note">발동 조건이 아직 구현되지 않은 탄막 ${shipResult.unmodeledBarrages}개는 제외되었습니다.</p>`
        : '')
        + (shipResult.inactiveBarrages
        ? `<p class="dmg-unmodeled-note">현재 편성에서 발동하지 않는 탄막 ${shipResult.inactiveBarrages}개는 제외되었습니다.</p>`
        : '');
    return `<table class="dmg-weapon-table">
        <thead><tr>
            <th>무기</th><th>일격</th><th>장전</th><th title="${escapeHtml(winLabel)}초 동안의 발사(살보) 횟수">발사/${escapeHtml(winLabel)}초</th><th>DPS</th><th>명중</th><th>치명</th>
        </tr></thead>
        <tbody>${rows}</tbody>
    </table>${unmodeled}`;
}

/**
 * Async render of the damage results section.
 * Runs three async calls (active target + L/M/H compare) and updates the DOM.
 * Mount point: #damage-results.
 */
let _renderToken = 0;   // serializes async damage renders — only the latest call writes the DOM

export async function renderDamagePanel(container) {
    if (!state.damageTarget) return;
    const hasAnyShip = (state.ships || []).some(Boolean);
    if (!hasAnyShip) {
        container.innerHTML = '';
        return;
    }

    const tgt = state.damageTarget;
    const myToken = ++_renderToken;   // a newer render will supersede this one

    // Show brief loading state
    renderStatus(container, '계산 중...', 'loading', { compact: true });

    // Resolve active preset result + L/M/H compare strip in parallel
    let result, compareResults;
    try {
        [result, ...compareResults] = await Promise.all([
            simulateFleetDamage(state.ships, tgt.kind === 'meta'
                ? { kind: 'meta', bossId: tgt.bossId, tier: tgt.tier, overrides: tgt.overrides, window: tgt.window }
                : { presetKey: tgt.presetKey, overrides: { ...tgt.overrides, adapt: tgt.adapt, difficulty: tgt.difficulty }, window: tgt.window }),
            ...['light', 'medium', 'heavy'].map((k) =>
                simulateFleetDamage(state.ships, {
                    presetKey: k,
                    overrides: { ...tgt.overrides, adapt: tgt.adapt, difficulty: tgt.difficulty },
                    window: tgt.window,
                }).catch(() => null)
            ),
        ]);
    } catch (err) {
        console.warn('[fleet-sim] damage panel calc failed:', err);
        container.innerHTML = '';
        return;
    }

    // Drop a stale result if a newer render started while we awaited (latest wins).
    if (myToken !== _renderToken) return;

    // Store for next renderFleet card pass (per-weapon breakdown)
    _lastDamageResult = result;

    // Target selector: current target name + 변경 button, and (META only) a tier <select>.
    const isMeta = tgt.kind === 'meta';
    const targetName = result.target?.name
        || (isMeta ? '' : (ARMOR_PRESETS[tgt.presetKey]?.name || ''));
    let tierSelect = '';
    if (isMeta && tgt.bossId != null) {
        const boss = getMetaBoss(tgt.bossId);
        if (boss && Array.isArray(boss.tiers) && boss.tiers.length > 1) {
            const activeTier = result.target?.tier ?? tgt.tier;
            const opts = boss.tiers.map((t) =>
                `<option value="${t.tier}"${t.tier === activeTier ? ' selected' : ''}>Tier ${t.tier}</option>`
            ).join('');
            tierSelect = `<span class="select-wrap"><select class="dmg-tier-select" data-action="dmg-tier" aria-label="난이도 티어">${opts}</select></span>`;
        }
    }
    // A META boss's own always-on 받는 피해 skill is already inside every number
    // below, so it is named here rather than left as an invisible multiplier —
    // 요크타운's -60% otherwise reads as the fleet being bad.
    const injure = result.target ? (result.target.injureRatio || 0) : 0;
    const injureChip = injure
        ? `<span class="dmg-target-injure${injure < 0 ? ' is-resist' : ''}">보스 스킬 · 받는 피해 ${injure > 0 ? '+' : ''}${Math.round(injure * 100)}%</span>`
        : '';
    // 장갑 종류 is the one target stat the panel never showed, yet every number in
    // it goes through that weapon armor-mod (damageType[armorType-1]) — it decides
    // which weapons are worth bringing more than 회피/대공 do.
    const armorLabel = ['경장', '중형', '중장'][(result.target?.armorType || 0) - 1] || '';
    const armorChip = armorLabel ? `<span class="badge badge--neutral">${armorLabel}</span>` : '';
    const targetSelectRow =
        `<div class="dmg-target-select">
            <span class="dmg-target-name">${escapeHtml(targetName)}</span>
            ${armorChip}
            ${tierSelect}
            <button class="btn btn-sm btn-outline" data-action="dmg-open-picker">변경</button>
            ${injureChip}
        </div>`;

    const missingNote = result.target && result.target.bossMissing
        ? `<div class="dmg-missing-note">저장된 보스 데이터를 찾을 수 없어 기본 타겟으로 계산했습니다.</div>`
        : '';

    // Same contract as the per-card 미구현 탄막 note: disclose what the sim skipped
    // instead of letting the total read as complete. These are the boss's
    // phase/stack/timer buffs — their trigger is precisely what is not modelled.
    const unmodeledBuffs = result.target ? (result.target.unmodeledBuffs || 0) : 0;
    const bossSkillNote = unmodeledBuffs
        ? `<div class="dmg-missing-note">조건부로 발동하는 보스 스킬 ${unmodeledBuffs}개는 계산에 반영되지 않았습니다.</div>`
        : '';

    const windowField =
        `<label class="dmg-edit-label">제한 시간
            <input class="dmg-edit-input" type="number" min="10" max="600" step="10"
                   data-action="dmg-window" aria-label="제한 시간(초)"
                   value="${escapeHtml(String(tgt.window))}" />
        </label>`;

    // Clear-check row (uses the boss/preset HP the engine carried on the result).
    const cc = result.clearCheck;
    // What the fleet actually got to fire for: the limit minus the ~2s opening,
    // cut short at the kill when the boss dies first. Every 누적/DPS below is over
    // exactly this, which is the point — damage past the kill is not DPS.
    const simWindow = (result.window ?? tgt.window).toFixed(1).replace(/\.0$/, '');
    let clearCheckRow = '';
    // Shown for the Arbiter presets as well as META bosses (user request): their
    // HP is large but not out of reach — a 90s window against The Hermit IX's
    // 1.9M sits right on the boundary, so the verdict is a real check, not noise.
    if (cc) {
        const ttk = Number.isFinite(cc.ttkSeconds) ? `${cc.ttkSeconds.toFixed(1)}초` : '—';
        const verdict = cc.clears
            ? `<span class="dmg-clear-ok">${escapeHtml(String(tgt.window))}초 내 클리어 ✓</span>`
            : `<span class="dmg-clear-no">시간 내 미클리어 ✗ · 잔여 ${_fmt(cc.hpRemaining)}</span>`;
        clearCheckRow = `<div class="dmg-clearcheck"><span class="dmg-clear-ttk">격파 예상 ${ttk}</span>${verdict}</div>`;
    }

    // 난이도 + 적응 buttons — presets only (a META boss has neither; its tier select
    // above is the equivalent). Only 내구 and 회피 differ between 일반 and 하드.
    const diffLabels = { hard: '하드', normal: '일반' };
    const diffBtns = isMeta ? '' : ['hard', 'normal'].map((d) =>
        `<button class="btn btn-secondary btn-sm dmg-adapt-btn${d === (tgt.difficulty || 'hard') ? ' is-active' : ''}" data-action="dmg-difficulty" data-difficulty="${d}">${diffLabels[d]}</button>`
    ).join('');
    const adaptLabels = { base: '기본', noAdapt: '무적응', full: '완전적응' };
    const adaptBtns = isMeta ? '' : ['base', 'noAdapt', 'full'].map((a) =>
        `<button class="btn btn-secondary btn-sm dmg-adapt-btn${a === tgt.adapt ? ' is-active' : ''}" data-action="dmg-adapt" data-adapt="${a}">${adaptLabels[a] || a}</button>`
    ).join('');
    const adaptRow = isMeta ? ''
        : `<div class="dmg-adapt-row"><div class="btn-group">${diffBtns}</div><div class="btn-group">${adaptBtns}</div></div>`;

    // Editable enemy overrides
    const ov = tgt.overrides || {};
    // The placeholder carries the value actually in use when the field is blank —
    // a bare "기본" left the target's own 내구/레벨/회피/대공 unreadable, which is the
    // one thing a boss panel has to show. result.target already resolved every
    // default (preset adapt tier or META tier), so it IS what the sim just used.
    const editFields = [
        ['hp', '내구'],
        ['level', '레벨'],
        ['evasion', '회피'],
        ['antiAir', '대공'],
        ['armorReduce', '경감'],
    ];
    const editRow = windowField + editFields.map(([k, lab]) => {
        const shown = result.target && result.target[k] != null ? _fmt(result.target[k]) : '기본';
        return `<label class="dmg-edit-label">${escapeHtml(lab)}<input class="dmg-edit-input" type="number" data-action="dmg-edit" data-field="${k}" value="${escapeHtml(String(ov[k] != null ? ov[k] : ''))}" placeholder="${escapeHtml(shown)}" /></label>`;
    }).join('');

    // Per-ship rows
    const perShipRows = result.perShip.map((s) => {
        const ship = getShipByGid(s.ref);
        const name = ship ? escapeHtml(ship.name) : escapeHtml(String(s.ref));
        // Label and value are separate elements so the shared grid can pin one to
        // each edge of its column — a 5-digit 일격 otherwise shifts every number after it.
        return `<div class="dmg-ship-row">
            <span class="dmg-ship-name">${name}</span>
            <span class="dmg-stat dmg-oneshot"><em>일격</em>${_fmt(s.oneShotExpected)}</span>
            <span class="dmg-stat dmg-cumulative"><em>누적</em>${_fmt(s.total)}</span>
            <span class="dmg-stat dmg-dps"><em>DPS</em>${_fmt(s.dps)}</span>
        </div>`;
    }).join('');

    // L/M/H compare strip
    const compareStrip = ['light', 'medium', 'heavy'].map((k, i) => {
        const r = compareResults[i];
        const preset = ARMOR_PRESETS[k];
        if (!r) return '';
        return `<span class="dmg-cmp-cell"><em>${escapeHtml(preset.shipClass)}</em>${_fmt(r.dps)}</span>`;
    }).join('');
    const compareRow = compareStrip
        ? `<div class="dmg-compare"><span class="dmg-cmp-key">장갑별 DPS</span>${compareStrip}</div>`
        : '';

    container.innerHTML = `
        <div class="dmg-panel">
            <div class="dmg-panel-header">
                <span class="dmg-panel-title">피해 계산 (${escapeHtml(String(tgt.window))}초)</span>
            </div>
            ${targetSelectRow}
            ${missingNote}
            ${bossSkillNote}
            ${adaptRow}
            <div class="dmg-edit-row">${editRow}</div>
            <div class="dmg-ship-list">${perShipRows}</div>
            <div class="dmg-fleet-total">
                <span class="dmg-total-label" title="제한 시간에서 전투 시작 ${BATTLE_START_DELAY}초를 뺀 시간, 보스 격파 시 격파 시점까지">함대 ${escapeHtml(simWindow)}초 누적</span>
                <strong class="dmg-total-val">${_fmt(result.total)}</strong>
                <span class="dmg-total-label">함대 DPS</span>
                <strong class="dmg-total-val">${_fmt(result.dps)}</strong>
            </div>
            ${clearCheckRow}
            ${compareRow}
        </div>`;

    // After updating the panel DOM, re-render the per-weapon breakdown in ship cards
    // (without triggering a full re-render — just update the breakdown tables in-place)
    _updateCardBreakdowns(result);
}

/**
 * Update per-weapon breakdown tables in already-rendered ship cards.
 * Called after the async damage result arrives so cards reflect the new data
 * without a full re-render (which would reset the expanded/collapsed toggle).
 */
function _updateCardBreakdowns(damageResult) {
    for (let i = 0; i < 6; i++) {
        const slotConfig = state.ships[i];
        if (!slotConfig || !slotConfig.gid) continue;

        const card = cardElements[i];
        if (!card) continue;

        const collapsibleInner = card.querySelector('.ship-stats-collapsible-inner');
        if (!collapsibleInner) continue;

        // Remove existing breakdown table AND every unmodelled-barrage note sibling —
        // _buildWeaponBreakdownHTML returns up to three sibling nodes (table +
        // an unreadable-trigger note + a no-activation note), and a patch path
        // that removes fewer than it appends orphans a stale note on every
        // recompute.
        const existing = collapsibleInner.querySelector('.dmg-weapon-table');
        if (existing) existing.remove();
        collapsibleInner.querySelectorAll('.dmg-unmodeled-note').forEach((n) => n.remove());

        const shipResult = damageResult
            ? (damageResult.perShip.find(s => s.ref === slotConfig.gid) || null)
            : null;

        const html = _buildWeaponBreakdownHTML(shipResult);
        if (html) {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = html;
            while (wrapper.firstChild) {
                collapsibleInner.appendChild(wrapper.firstChild);
            }
        }
    }
}
