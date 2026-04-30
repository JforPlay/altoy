/**
 * Fleet Build Simulator — UI Rendering Module
 * Renders ship cards (empty + populated), stats grids, reload times,
 * and fleet summary (tech bonuses + passive skills).
 */

import { showElement, hideElement, IMG_FALLBACKS, resolveUrl } from '../utils.js';
import { getShipByGid, getEquipById, getEquipIconUrl, getRarityBgUrl, getShipPortraitUrl, getSlotName, getSPWeaponIconUrl, getDedicatedSPWeapon } from './fleet-sim.data.js';
import {
    DISPLAY_STATS,
    calculateShipStats,
    calculateFleetTechBonuses,
    resolvePassiveBuffs,
    computeHighlights,
} from './fleet-sim.calc.js';

// ===== State =====
let state;

// ===== DOM Cache =====
let cardElements = [];    // 6 .ship-card elements (indexed by slot)
let summarySection = null;
let techBonusList = null;
let passiveSkillList = null;
let loadingOverlay = null;

/** Track which slots have stats collapsed (persists across re-renders) */
const statsCollapsed = new Set([0, 1, 2, 3, 4, 5]);

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
        const passiveBuffs = ship ? resolvePassiveBuffs(ship, fleetShips) : [];
        const result = calculateShipStats(slotConfig, techBonuses, passiveBuffs);

        allResults.push(result);
        allStats.push(result ? result.stats : null);
    }

    // 4. Compute stat highlights across all slots
    const highlights = computeHighlights(allStats);

    // 5. Render each card
    for (let i = 0; i < 6; i++) {
        _renderCard(i, allResults[i], highlights);
    }

    // 6. Render fleet summary
    _renderFleetSummary(techBonuses, fleetShips);

    // 7. Hide loading overlay
    if (loadingOverlay) {
        hideElement(loadingOverlay);
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

    _renderPopulatedCard(card, slotIndex, ship, slotConfig, calcResult, highlights);
}

/**
 * Render an empty card with "add ship" button.
 */
function _renderEmptyCard(card, slotIndex) {
    card.className = 'ship-card ship-card--empty';
    card.removeAttribute('data-rarity');
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
function _renderPopulatedCard(card, slotIndex, ship, slotConfig, calcResult, highlights) {
    const rarity = (ship.rarity || '').toLowerCase();
    card.className = 'ship-card';
    card.dataset.slot = slotIndex;
    card.dataset.rarity = rarity;
    card.draggable = true;

    const frag = document.createDocumentFragment();
    const wrapper = document.createElement('div');

    // Build all sections as HTML string for efficiency
    const isCollapsed = statsCollapsed.has(slotIndex);
    const html = [
        _buildIdentityHTML(slotIndex, ship, slotConfig),
        _buildReloadBarHTML(calcResult),
        _buildEquipSlotsHTML(slotIndex, ship, slotConfig),
        _buildStatsToggleHTML(slotIndex, isCollapsed),
        `<div class="ship-stats-collapsible${isCollapsed ? ' collapsed' : ''}"><div class="ship-stats-collapsible-inner">`,
        _buildStatsHTML(slotIndex, calcResult, highlights),
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
    const safeShipName = _escapeHtml(ship.name || '');
    const safeTypeNation = _escapeHtml(typeNation);
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

    const affinityOptions = AFFINITY_OPTIONS.map(opt =>
        `<option value="${opt.value}"${opt.value === affinity ? ' selected' : ''}>${opt.label}</option>`
    ).join('');

    return `
        <div class="ship-card-identity">
            <span class="material-symbols-outlined drag-handle" title="드래그하여 이동">drag_indicator</span>
            <img class="ship-portrait"
                 src="${portraitUrl}"
                 alt="${safeShipName}"
                 role="button"
                 tabindex="0"
                 data-action="change-ship"
                 data-slot="${slotIndex}"
                 loading="lazy" />
            <div class="ship-identity-content">
                <div class="ship-identity-top">
                    <div class="ship-name-group">
                        <div class="ship-name" title="${safeShipName}">${safeShipName}</div>
                        ${retrofitHTML}
                    </div>
                    <div class="config-group">
                        <span class="config-label">Lv.</span>
                        <div class="level-stepper">
                            <button class="stepper-btn" data-action="step-level" data-slot="${slotIndex}" data-dir="-1">−</button>
                            <span class="stepper-value" data-action="edit-level" data-slot="${slotIndex}">${level}</span>
                            <button class="stepper-btn" data-action="step-level" data-slot="${slotIndex}" data-dir="1">+</button>
                        </div>
                    </div>
                </div>
                <div class="ship-identity-bottom">
                    <div class="ship-type-nation">${safeTypeNation}</div>
                    <div class="config-group">
                        <span class="config-label">호감도</span>
                        <select class="config-select"
                                data-action="change-affinity"
                                data-slot="${slotIndex}">
                            ${affinityOptions}
                        </select>
                    </div>
                </div>
            </div>
            <div class="ship-card-actions">
                <button class="btn-icon" data-action="remove-ship" data-slot="${slotIndex}" title="제거">
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
 */
function _buildSingleEquipSlotHTML(slotIndex, equipIndex, equipConfig, ship, isRetrofit) {
    const slotName = getSlotName(ship, equipIndex, isRetrofit);
    const safeSlotName = _escapeHtml(slotName);

    if (!equipConfig || !equipConfig.id) {
        // Empty slot
        return `
            <div class="equip-slot"
                 role="button"
                 tabindex="0"
                 data-action="change-equip"
                 data-slot="${slotIndex}"
                 data-equip-index="${equipIndex}"
                 title="${safeSlotName}">
                <span class="equip-slot-label">${safeSlotName}</span>
                <div class="equip-slot-icon-box">
                    <span class="equip-slot-empty"><span class="material-symbols-outlined">add</span></span>
                </div>
            </div>
        `;
    }

    const equip = getEquipById(equipConfig.id);
    if (!equip) {
        return `
            <div class="equip-slot"
                 role="button"
                 tabindex="0"
                 data-action="change-equip"
                 data-slot="${slotIndex}"
                 data-equip-index="${equipIndex}"
                 title="${safeSlotName}">
                <span class="equip-slot-label">${safeSlotName}</span>
                <div class="equip-slot-icon-box">
                    <span class="equip-slot-empty"><span class="material-symbols-outlined">add</span></span>
                </div>
            </div>
        `;
    }

    const iconUrl = getEquipIconUrl(equip.icon);
    const bgUrl = getRarityBgUrl(equip.rarity);
    const rarityAttr = EQUIP_RARITY_MAP[equip.rarity] || '';
    const enhanceLevel = equipConfig.level || 0;
    const safeEquipName = _escapeHtml(equip.name || '');

    return `
        <div class="equip-slot equipped"
             role="button"
             tabindex="0"
             data-action="change-equip"
             data-slot="${slotIndex}"
             data-equip-index="${equipIndex}"
             data-equip-rarity="${rarityAttr}"
             title="${safeSlotName}: ${safeEquipName}">
            <span class="equip-slot-label">${safeSlotName}</span>
            <div class="equip-slot-icon-box">
                <div class="equip-icon-wrapper">
                    <img class="equip-icon-bg" src="${bgUrl}" alt="" loading="lazy" />
                    ${iconUrl ? `<img class="equip-icon-fg" src="${iconUrl}" alt="${safeEquipName}" loading="lazy" />` : ''}
                </div>
                <span class="equip-enhance-badge"
                      data-action="change-equip-level"
                      data-slot="${slotIndex}"
                      data-equip-index="${equipIndex}">+${enhanceLevel}</span>
            </div>
        </div>
    `;
}

/**
 * Build the SP weapon (6th) slot.
 * - Ships with dedicated SP weapon: show it display-only with correct icon
 * - Ships without: allow picking generic SP weapons, or show empty slot
 */
function _buildSPSlotHTML(slotIndex, ship, slotConfig) {
    // If user has selected a generic SP weapon
    const spConfig = slotConfig.spWeapon;
    if (spConfig && spConfig.id) {
        const spWeapon = _getSPWeaponDataById(spConfig.id);
        if (spWeapon) {
            const iconUrl = getSPWeaponIconUrl(spWeapon.icon);
            const bgUrl = getRarityBgUrl(spWeapon.rarity + 1);
            const safeName = _escapeHtml(spWeapon.name || '');
            return `
                <div class="equip-slot equipped sp-slot"
                     role="button"
                     tabindex="0"
                     data-action="change-sp-weapon"
                     data-slot="${slotIndex}"
                     data-equip-rarity="${SP_RARITY_MAP[spWeapon.rarity] || ''}"
                     title="${safeName}">
                    <span class="equip-slot-label">특수 장비</span>
                    <div class="equip-slot-icon-box">
                        <div class="equip-icon-wrapper">
                            <img class="equip-icon-bg" src="${bgUrl}" alt="" loading="lazy" />
                            ${iconUrl ? `<img class="equip-icon-fg" src="${iconUrl}" alt="${safeName}" loading="lazy" />` : ''}
                        </div>
                        <span class="equip-enhance-badge"
                              data-action="change-sp-level"
                              data-slot="${slotIndex}">+${spConfig.level || 1}</span>
                    </div>
                </div>`;
        }
    }

    // Ships with dedicated SP weapon — display-only with correct icon URL
    if (ship.sp_weapon) {
        const dedicated = getDedicatedSPWeapon(ship.gid);
        const iconUrl = dedicated ? getSPWeaponIconUrl(dedicated.icon) :
                         ship.sp_weapon.icon ? getSPWeaponIconUrl(ship.sp_weapon.icon) : '';
        const name = dedicated ? dedicated.name : (ship.sp_weapon.name || 'SP 무기');
        const spRarity = dedicated ? dedicated.rarity : 4;
        const bgUrl = getRarityBgUrl(spRarity + 1);
        const safeName = _escapeHtml(name);

        return `
            <div class="equip-slot equipped sp-slot sp-dedicated" data-equip-rarity="${SP_RARITY_MAP[spRarity] || 'ssr'}" title="${safeName} (전용)">
                <span class="equip-slot-label">전용 무기</span>
                <div class="equip-slot-icon-box">
                    <div class="equip-icon-wrapper">
                        <img class="equip-icon-bg" src="${bgUrl}" alt="" loading="lazy" />
                        ${iconUrl ? `<img class="equip-icon-fg" src="${iconUrl}" alt="${safeName}" loading="lazy" />` : ''}
                    </div>
                    <span class="equip-enhance-badge">SP</span>
                </div>
            </div>`;
    }

    // No dedicated SP weapon — show empty slot for generic SP weapon selection
    return `
        <div class="equip-slot sp-slot"
             role="button"
             tabindex="0"
             data-action="change-sp-weapon"
             data-slot="${slotIndex}"
             title="특수 장비 선택">
            <span class="equip-slot-label">특수 장비</span>
            <div class="equip-slot-icon-box">
                <span class="equip-slot-empty"><span class="material-symbols-outlined">add</span></span>
            </div>
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
            <span class="stats-toggle-label">스탯</span>
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
 * Build reload time bar (shown in config-row position, not collapsible).
 */
function _buildReloadBarHTML(calcResult) {
    if (!calcResult || !calcResult.reloads || calcResult.reloads.length === 0) {
        return `<div class="ship-reload-bar"></div>`;
    }

    const items = calcResult.reloads.map(({ label, seconds }) => `
        <div class="reload-item">
            <span class="material-symbols-outlined">timer</span>
            <span>${label}</span>
            <span class="reload-value">${seconds.toFixed(2)}s</span>
        </div>
    `).join('');

    return `<div class="ship-reload-bar">${items}</div>`;
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
            <div class="tech-bonus-item">
                <span>함대 기술 데이터 없음</span>
                <a href="${basePath}" class="tech-bonus-value" style="text-decoration:underline;">함순이 육성트래커로 이동</a>
            </div>
        `;
        return;
    }

    const frag = document.createDocumentFragment();

    for (const [groupId, data] of Object.entries(techBonuses)) {
        const item = document.createElement('div');
        item.className = 'tech-bonus-item';
        const name = document.createElement('span');
        name.textContent = data.name || '';
        const value = document.createElement('span');
        value.className = 'tech-bonus-value';
        value.textContent = `Lv.${data.level} (${data.score}pt)`;
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
        const item = document.createElement('div');
        item.className = 'passive-skill-item';
        const message = document.createElement('span');
        message.textContent = '적용 가능한 패시브 스킬 없음';
        item.appendChild(message);
        passiveSkillList.innerHTML = '';
        passiveSkillList.appendChild(item);
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

function _escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
