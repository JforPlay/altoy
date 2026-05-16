/**
 * equip.compare.js
 * Renders the side-by-side compare modal for equipment diff highlighting.
 * Part of the equip viewer module group (viewer + data + detail + compare + upgrade).
 * State is shared via a ref passed to setup() from equip.viewer.js.
 * Depends on equip.data.js for full equipment data and weapon/bullet lookups.
 */

import { showToast, openModal, closeModal, setupModal, setUrlParams } from '../utils.js';
import { getEquipIconUrl, getRarityBgUrl, getFullEquipData, getLevelStatistics, replaceEquipCodes, getBulletTemplate, getFiringPattern, getVisibleLevelCount, formatLevel, getMergedWeaponProperties, getPrimaryWeaponProperty } from './equip.data.js';

let state;

/** Receive shared state from equip.viewer.js. */
export function setup(stateRef) {
    state = stateRef;
}

// ===== Setup Compare Modal =====

/**
 * Wire up close handlers for the compare modal.
 * On close, resets compareSlots/compareLevels and clears the URL compare param.
 */
export function setupCompareModal() {
    setupModal('compareModal', {
        closeOnEscape: true,
        closeOnBackdrop: true,
        restoreFocus: true,
        onClose: () => {
            state.compareSlots = [null, null];
            state.compareLevels = [0, 0];
            setUrlParams({ compare: null }, { replace: true });
        }
    });
}

// ===== Render Compare Modal =====

/**
 * Populate and open the compare modal with two equipment entries.
 * Renders both slot headers, level sliders, equip selectors, and the stats table.
 */
export function renderCompareModal(equip0, equip1) {
    const modalBody = document.getElementById('compareModalBody');
    if (!modalBody) return;

    state.compareSlots = [equip0, equip1];
    state.compareLevels = [0, 0];

    let html = `
        <div class="compare-slots">
            <div class="compare-slot" id="compareSlot0">
                ${renderCompareSlot(equip0, 0)}
            </div>
            <div class="compare-slot" id="compareSlot1">
                ${renderCompareSlot(equip1, 1)}
            </div>
        </div>
    `;

    html += renderCompareTable(equip0, equip1);

    modalBody.innerHTML = html;
    setupCompareListeners();
    openModal('compareModal');
}

// ===== Load Compare from URL =====

/**
 * Parse a "id1,id2" URL compare param and open the modal.
 * Silently no-ops if either ID fails to resolve.
 */
export async function loadCompareFromUrl(compareParam) {
    const ids = compareParam.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    if (ids.length < 2) return;

    const [equip0, equip1] = await Promise.all([
        getFullEquipData(ids[0]),
        getFullEquipData(ids[1])
    ]);

    if (equip0 && equip1) {
        renderCompareModal(equip0, equip1);
    }
}

// ===== Render Helpers =====

/**
 * Render one slot header: icon, name, optional equip selector (for compare_group siblings),
 * and optional level range slider.
 */
function renderCompareSlot(equip, slotIndex) {
    const iconUrl = getEquipIconUrl(equip.icon);
    const maxLevel = getVisibleLevelCount(equip);
    const currentLevel = state.compareLevels[slotIndex];

    // Build selector options from same compare_group
    const sameGroupEquips = state.equipData
        ? state.equipData.filter(e => e.compare_group === equip.compare_group)
        : [];

    let selectorHtml = '';
    if (sameGroupEquips.length > 1) {
        selectorHtml = `
            <select class="compare-equip-selector" data-slot="${slotIndex}">
                ${sameGroupEquips.map(e => `
                    <option value="${e.id}" ${e.id === equip.id ? 'selected' : ''}>${e.name} (${e.rarity_name})</option>
                `).join('')}
            </select>
        `;
    }

    return `
        <div class="compare-slot-header">
            <div class="compare-slot-icon">
                <img class="equip-icon-bg-img" src="${getRarityBgUrl(equip.rarity)}" alt="">
                ${iconUrl ? `<img class="equip-icon-img" src="${iconUrl}" alt="${equip.name}">` : ''}
            </div>
            <div class="compare-slot-info">
                <div class="compare-slot-name">${equip.name}</div>
                <div class="compare-slot-type">${equip.type_name2 || equip.type_name} / ${equip.rarity_name}</div>
            </div>
        </div>
        ${selectorHtml}
        ${maxLevel > 1 ? `
            <div class="compare-level-selector">
                <label>단계</label>
                <input type="range" min="0" max="${maxLevel - 1}" value="${currentLevel}" data-slot="${slotIndex}" class="compare-level-input">
                <span class="compare-level-value" id="compareLevelValue${slotIndex}">${formatLevel(currentLevel)} / +${maxLevel - 1}</span>
            </div>
        ` : ''}
    `;
}

/**
 * Build the stats comparison table HTML for the current level selection.
 * Merges attr keys from both slots — missing attrs on one side show "-".
 * Highlights better/worse values; for reload and armor, lower/higher rules are inverted.
 */
function renderCompareTable(slot0, slot1) {
    const level0 = slot0.levels[state.compareLevels[0]] || slot0.levels[0];
    const level1 = slot1.levels[state.compareLevels[1]] || slot1.levels[0];

    // Merge all attr keys from both
    const allAttrs = new Map();
    for (const attr of (slot0.attr_info || [])) {
        allAttrs.set(attr.key, attr);
    }
    for (const attr of (slot1.attr_info || [])) {
        if (!allAttrs.has(attr.key)) {
            allAttrs.set(attr.key, attr);
        }
    }

    let rows = '';
    for (const [key, attr] of allAttrs) {
        const val0 = getAttrValue(slot0, level0, key);
        const val1 = getAttrValue(slot1, level1, key);
        const num0 = parseFloat(val0) || 0;
        const num1 = parseFloat(val1) || 0;

        let class0 = 'compare-equal';
        let class1 = 'compare-equal';
        if (num0 > num1) { class0 = 'compare-better'; class1 = 'compare-worse'; }
        if (num1 > num0) { class1 = 'compare-better'; class0 = 'compare-worse'; }

        rows += `<tr>
            <td>${attr.icon ? `<img class="stat-icon" src="${attr.icon}" alt="${attr.name}">` : ''}${attr.name}</td>
            <td class="${class0}">${val0 || '-'}</td>
            <td class="${class1}">${val1 || '-'}</td>
        </tr>`;
    }

    // Damage comparison
    if (level0.damage || level1.damage) {
        rows += `<tr>
            <td>데미지</td>
            <td>${level0.damage ? replaceEquipCodes(level0.damage) : '-'}</td>
            <td>${level1.damage ? replaceEquipCodes(level1.damage) : '-'}</td>
        </tr>`;
    }

    // Reload (사속) comparison — lower is better
    const reload0 = getReloadValue(slot0, level0);
    const reload1 = getReloadValue(slot1, level1);
    if (reload0 != null || reload1 != null) {
        let rc0 = 'compare-equal', rc1 = 'compare-equal';
        if (reload0 != null && reload1 != null) {
            if (reload0 < reload1) { rc0 = 'compare-better'; rc1 = 'compare-worse'; }
            if (reload1 < reload0) { rc1 = 'compare-better'; rc0 = 'compare-worse'; }
        }
        rows += `<tr>
            <td>사속</td>
            <td class="${rc0}">${reload0 != null ? `${reload0}s` : '-'}</td>
            <td class="${rc1}">${reload1 != null ? `${reload1}s` : '-'}</td>
        </tr>`;
    }

    // Firing pattern comparison (plain text, no better/worse)
    const pattern0 = getFiringPatternValue(slot0, level0);
    const pattern1 = getFiringPatternValue(slot1, level1);
    if (pattern0 || pattern1) {
        rows += `<tr>
            <td>발사 패턴</td>
            <td>${pattern0 || '-'}</td>
            <td>${pattern1 || '-'}</td>
        </tr>`;
    }

    // Armor modifiers (대갑 배율) comparison
    const armor0 = getArmorModifiers(slot0, level0);
    const armor1 = getArmorModifiers(slot1, level1);
    if (armor0 || armor1) {
        const labels = ['경장', '중형', '중장'];
        for (let i = 0; i < 3; i++) {
            const v0 = armor0 ? Math.round(armor0[i] * 100) : null;
            const v1 = armor1 ? Math.round(armor1[i] * 100) : null;
            let ac0 = 'compare-equal', ac1 = 'compare-equal';
            if (v0 != null && v1 != null) {
                if (v0 > v1) { ac0 = 'compare-better'; ac1 = 'compare-worse'; }
                if (v1 > v0) { ac1 = 'compare-better'; ac0 = 'compare-worse'; }
            }
            rows += `<tr>
                <td>${i === 0 ? '대갑 배율 - ' : ''}${labels[i]}</td>
                <td class="${ac0}">${v0 != null ? `${v0}%` : '-'}</td>
                <td class="${ac1}">${v1 != null ? `${v1}%` : '-'}</td>
            </tr>`;
        }
    }

    // Anti-siren comparison
    const stats0 = getLevelStatistics(level0.id);
    const stats1 = getLevelStatistics(level1.id);
    const siren0 = stats0?.anti_siren || 0;
    const siren1 = stats1?.anti_siren || 0;
    if (siren0 || siren1) {
        let sc0 = 'compare-equal', sc1 = 'compare-equal';
        if (siren0 > siren1) { sc0 = 'compare-better'; sc1 = 'compare-worse'; }
        if (siren1 > siren0) { sc1 = 'compare-better'; sc0 = 'compare-worse'; }
        rows += `<tr>
            <td>대형 작전 세이렌 증가 대미지</td>
            <td class="${sc0}">${siren0 ? `${(siren0 / 100).toFixed(0)}%` : '-'}</td>
            <td class="${sc1}">${siren1 ? `${(siren1 / 100).toFixed(0)}%` : '-'}</td>
        </tr>`;
    }

    return `
        <div class="compare-stats-section">
            <div class="compare-stats-title">스탯 비교</div>
            <table class="compare-table" id="compareTable">
                <thead>
                    <tr>
                        <th>스탯</th>
                        <th>${slot0.name}</th>
                        <th>${slot1.name}</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
}

/** Look up the level-specific value for a given attr key using attr_info index. */
function getAttrValue(equip, level, attrKey) {
    for (const attr of (equip.attr_info || [])) {
        if (attr.key === attrKey) {
            return level[`attr_${attr.index}_value`] || 0;
        }
    }
    return 0;
}

/** Get reload value (사속) from the primary weapon — standard path, matching
 *  the detail panel's 사속 row (never resolved through the aircraft chain). */
function getReloadValue(equip, level) {
    const wp = getPrimaryWeaponProperty(equip, level);
    if (!wp || wp.reload_max == null) return null;
    return Math.floor((wp.reload_max / 150) * 100) / 100;
}

/** Get the firing-pattern string from a slot's primary weapon, or null. */
function getFiringPatternValue(equip, level) {
    const weapons = getMergedWeaponProperties(equip, level);
    return weapons.length ? getFiringPattern(weapons[0]) : null;
}

/** Get armor modifiers (대갑 배율) from merged weapon properties */
function getArmorModifiers(equip, level) {
    const weapons = getMergedWeaponProperties(equip, level);
    if (!weapons.length) return null;
    // Use first weapon's first bullet
    const wp = weapons[0];
    const bulletIds = wp.bullet_ID || [];
    for (const bid of bulletIds) {
        const bullet = getBulletTemplate(bid);
        if (bullet && bullet.damage_type && bullet.damage_type.length >= 3) {
            return bullet.damage_type;
        }
    }
    return null;
}

// ===== Event Listeners =====

/**
 * Attach input and change listeners after modal HTML is injected.
 * Level slider updates the stats table in-place; equip selector re-renders the whole modal.
 */
function setupCompareListeners() {
    // Level sliders
    document.querySelectorAll('#compareModalBody .compare-level-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const slot = parseInt(e.target.dataset.slot);
            state.compareLevels[slot] = parseInt(e.target.value);
            const valueEl = document.getElementById(`compareLevelValue${slot}`);
            if (valueEl) valueEl.textContent = `${formatLevel(state.compareLevels[slot])} / +${e.target.max}`;
            updateCompareTable();
        });
    });

    // Equipment selector dropdowns
    document.querySelectorAll('#compareModalBody .compare-equip-selector').forEach(select => {
        select.addEventListener('change', async (e) => {
            const slot = parseInt(e.target.dataset.slot);
            const newId = parseInt(e.target.value);
            const equip = await getFullEquipData(newId);
            if (equip) {
                state.compareSlots[slot] = equip;
                state.compareLevels[slot] = 0;
                // Re-render the full modal content
                renderCompareModal(state.compareSlots[0], state.compareSlots[1]);
            }
        });
    });
}

function updateCompareTable() {
    const slot0 = state.compareSlots[0];
    const slot1 = state.compareSlots[1];
    if (!slot0 || !slot1) return;

    const tableContainer = document.querySelector('#compareModalBody .compare-stats-section');
    if (tableContainer) {
        tableContainer.outerHTML = renderCompareTable(slot0, slot1);
    }
}
