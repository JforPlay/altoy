/**
 * Equipment Viewer Module - Detail Panel
 * Renders equipment detail into the side panel with level selector, stats, icon download
 */

import { showToast, resolveUrl } from '../utils.js';
import {
    getEquipIconUrl, getRarityBgUrl, getFullEquipData, getLevelStatistics,
    replaceEquipCodes, getWeaponProperty, getBulletTemplate, getSkillData,
    getWeaponName, getAircraftTemplate
} from './equip.data.js';

/** Ammo type name mapping (matches equip.ammo field / equip_ammo_type_X i18n keys) */
const AMMO_TYPE_NAMES = {
    1: '철갑탄',
    2: '고폭탄',
    3: '통상탄',
    4: '음향 유도',
    5: '통상',
    6: '삼식탄',
    7: '반철갑탄(SAP탄)',
    8: '자성식',
    9: '격발식',
    10: '없음',
    11: '미사일',
};

let state;
/** Cached canvas from the last rendered icon (used for download) */
let iconCanvas = null;

export function setup(stateRef) {
    state = stateRef;
}

/** Format level index for display: 0 → "0", 1+ → "+1", "+2", etc. */
function formatLevel(index) {
    return index === 0 ? '0' : `+${index}`;
}

// ===== Show Detail View (renders into panel body) =====

export async function showDetailView(equipId) {
    const panelContent = document.getElementById('detailPanelContent');
    if (!panelContent) return;

    const equip = await getFullEquipData(equipId);

    if (!equip) {
        showToast('장비 데이터를 찾을 수 없습니다.', 'error');
        return null;
    }

    state.currentEquip = equip;
    state.currentLevel = 0;
    iconCanvas = null;

    renderDetail(equip);
    return equip;
}

// ===== Render Detail (compact layout for panel) =====

function renderDetail(equip) {
    const panelContent = document.getElementById('detailPanelContent');
    if (!panelContent) return;

    const level = equip.levels[state.currentLevel] || equip.levels[0];
    const iconUrl = getEquipIconUrl(equip.icon);
    const ENHANCE_CAP = { 2: 3, 3: 6, 4: 11, 5: 13, 6: 13 };
    const rarityCap = (ENHANCE_CAP[equip.rarity] ?? 13) + 1;
    const maxLevel = Math.min(equip.levels.length, rarityCap);

    let html = `
        <div class="panel-detail-top">
            <div class="panel-detail-icon-wrapper">
                <canvas id="detailIconCanvas" width="256" height="256"></canvas>
            </div>
            <div class="panel-detail-name">${equip.name}</div>
            <div class="panel-detail-meta">
                <span class="equip-type-badge">${equip.type_name2 || equip.type_name}</span>
                <span class="equip-rarity-badge rarity-${equip.rarity}">${equip.rarity_name}</span>
                ${equip.nation_name ? `<span class="panel-detail-nation-badge">
                    ${equip.nation_image ? `<img src="${equip.nation_image}" alt="${equip.nation_name}">` : ''}
                    ${equip.nation_name}
                </span>` : ''}
            </div>
            ${equip.speciality && equip.speciality !== '없음' ? `<div class="panel-detail-speciality">특성: ${replaceEquipCodes(equip.speciality)}</div>` : ''}
            ${equip.label && equip.label.length > 0 ? `<div class="panel-detail-labels">${equip.label.map(l => `<span class="panel-detail-label-tag">${l}</span>`).join('')}</div>` : ''}
            ${equip.descrip ? `<div class="panel-detail-descrip">${equip.descrip}</div>` : ''}
            ${AIRCRAFT_TYPES.has(equip.type) ? `<a href="${resolveUrl(`simulators/sim-aircraft?equip=${equip.id}`)}" class="sim-link-btn"><span class="material-symbols-outlined">flight</span> 시뮬레이션</a>` : ''}
        </div>
    `;

    // Level selector
    if (maxLevel > 1) {
        html += `
            <div class="level-selector-section">
                <div class="level-selector-header">
                    <span class="level-selector-title">강화 단계</span>
                    <span class="level-display" id="levelDisplay">${formatLevel(state.currentLevel)} / +${maxLevel - 1}</span>
                </div>
                <input type="range" class="level-slider" id="levelSlider"
                    min="0" max="${maxLevel - 1}" value="${state.currentLevel}" step="1">
            </div>
        `;
    }

    // Attribute stats
    if (equip.attr_info && equip.attr_info.length > 0) {
        html += `
            <div class="stats-section">
                <div class="stats-section-title">
                    <span class="material-symbols-outlined">bar_chart</span>
                    스탯
                </div>
                <table class="stats-table">
                    <tbody id="statsTableBody">
                        ${renderStatsRows(equip, level)}
                    </tbody>
                </table>
            </div>
        `;
    }

    // Weapon info (damage + ammo type)
    const ammoName = equip.ammo != null && equip.ammo !== 10 ? AMMO_TYPE_NAMES[equip.ammo] : null;
    if (level.damage || ammoName) {
        let weaponRows = '';
        if (level.damage) weaponRows += `<tr><th>데미지</th><td id="damageValue">${replaceEquipCodes(level.damage)}</td></tr>`;
        if (ammoName) weaponRows += `<tr><th>탄종</th><td>${ammoName}</td></tr>`;
        html += `
            <div class="stats-section">
                <div class="stats-section-title">
                    <span class="material-symbols-outlined">target</span>
                    무기 정보
                </div>
                <table class="stats-table">
                    <tbody id="weaponTableBody">
                        ${weaponRows}
                    </tbody>
                </table>
            </div>
        `;
    }

    // Aircraft parameters (for aircraft equip types)
    html += renderAircraftParams(equip, level);

    // Weapon parameters (from weapon_property.json via weapon_id)
    html += renderWeaponParams(equip, level);

    // Skills
    html += renderSkillSection(level);

    // Compatible ship types
    if ((equip.part_main && equip.part_main.length > 0) || (equip.part_sub && equip.part_sub.length > 0)) {
        html += `
            <div class="ship-types-section">
                <div class="stats-section-title">
                    <span class="material-symbols-outlined">directions_boat</span>
                    장착 가능 함종
                </div>
                ${equip.part_main.length > 0 ? `
                    <div class="ship-type-group">
                        <div class="ship-type-group-label">메인 슬롯</div>
                        <div class="ship-type-chips">
                            ${equip.part_main.map(st => `
                                <span class="ship-type-chip">
                                    ${st.icon ? `<img src="${st.icon}" alt="${st.name}">` : ''}
                                    ${st.name}
                                </span>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                ${equip.part_sub.length > 0 ? `
                    <div class="ship-type-group">
                        <div class="ship-type-group-label">보조 슬롯</div>
                        <div class="ship-type-chips">
                            ${equip.part_sub.map(st => `
                                <span class="ship-type-chip">
                                    ${st.icon ? `<img src="${st.icon}" alt="${st.name}">` : ''}
                                    ${st.name}
                                </span>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    // Upgrade costs table
    if (maxLevel > 1) {
        html += `
            <div class="upgrade-section">
                <div class="stats-section-title">
                    <span class="material-symbols-outlined">upgrade</span>
                    강화 비용
                </div>
                <table class="upgrade-table">
                    <thead>
                        <tr>
                            <th>단계</th>
                            <th>골드</th>
                            <th>재료</th>
                        </tr>
                    </thead>
                    <tbody id="upgradeTableBody">
                        ${renderUpgradeRows(equip)}
                    </tbody>
                </table>
            </div>
        `;
    }

    // Scrap info
    if (level.scrap_gold || (level.scrap_items && level.scrap_items.length > 0)) {
        html += `
            <div class="stats-section">
                <div class="stats-section-title">
                    <span class="material-symbols-outlined">recycling</span>
                    해체 보상
                </div>
                <table class="stats-table">
                    <tbody id="scrapTableBody">
                        ${renderScrapRows(level)}
                    </tbody>
                </table>
            </div>
        `;
    }

    panelContent.innerHTML = html;
    setupDetailListeners(equip);
    compositeIcon(equip);
}

// ===== Canvas Icon Compositing =====

function compositeIcon(equip) {
    const canvas = document.getElementById('detailIconCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const size = 256;
    const iconUrl = getEquipIconUrl(equip.icon);
    const bgUrl = getRarityBgUrl(equip.rarity);

    const bgImg = new Image();
    bgImg.crossOrigin = 'anonymous';
    bgImg.onload = () => {
        ctx.drawImage(bgImg, 0, 0, size, size);

        if (!iconUrl) {
            iconCanvas = canvas;
            return;
        }

        const equipImg = new Image();
        equipImg.crossOrigin = 'anonymous';
        equipImg.onload = () => {
            const padding = 8;
            const area = size - padding * 2;
            // Maintain aspect ratio (object-fit: contain)
            const ratio = Math.min(area / equipImg.naturalWidth, area / equipImg.naturalHeight);
            const w = equipImg.naturalWidth * ratio;
            const h = equipImg.naturalHeight * ratio;
            const x = padding + (area - w) / 2;
            const y = padding + (area - h) / 2;
            ctx.drawImage(equipImg, x, y, w, h);
            iconCanvas = canvas;
        };
        equipImg.onerror = () => {
            // BG already drawn, keep it
            iconCanvas = canvas;
        };
        equipImg.src = iconUrl;
    };
    bgImg.onerror = () => {
        // Clear canvas on failure
        ctx.clearRect(0, 0, size, size);
    };
    bgImg.src = bgUrl;
}

// ===== Render Helpers =====

/** Merge base and current weapon properties, skipping null overrides */
function getMergedWeaponProperty(baseWpId, currentWpId) {
    const baseWp = baseWpId ? getWeaponProperty(baseWpId) : null;
    const currentWp = currentWpId ? getWeaponProperty(currentWpId) : null;

    if (!baseWp && !currentWp) return null;
    if (!baseWp) return currentWp;
    if (!currentWp) return baseWp;

    const merged = { ...baseWp };
    for (const [key, val] of Object.entries(currentWp)) {
        if (val != null) merged[key] = val;
    }
    return merged;
}

/** Equipment types that use aircraft_template for bullet resolution */
const AIRCRAFT_TYPES = new Set([7, 8, 9, 12, 15]);

/** Get merged weapon properties for all weapon_ids in a level.
 *  For aircraft types (7,8,9,12,15): weapon_id → aircraft_template → weapon_ID → weapon_property
 *  For others: weapon_id → weapon_property directly */
function getMergedWeaponProperties(equip, level) {
    const weaponIds = level.weapon_id;
    if (!weaponIds || !weaponIds.length) return [];

    const baseIds = equip.levels[0].weapon_id || [];

    if (AIRCRAFT_TYPES.has(equip.type)) {
        // Aircraft path: each weapon_id maps to aircraft_template → weapon_ID list
        // Deduplicate by base weapon ID since multiple aircraft slots can share weapons
        const results = [];
        const seen = new Set();
        for (let i = 0; i < weaponIds.length; i++) {
            const aircraft = getAircraftTemplate(weaponIds[i]);
            if (!aircraft || !aircraft.weapon_ID) continue;
            const baseAircraft = getAircraftTemplate(baseIds[i] || baseIds[0]);
            const baseAcWeaponIds = baseAircraft ? (baseAircraft.weapon_ID || []) : [];
            for (let j = 0; j < aircraft.weapon_ID.length; j++) {
                const acWid = aircraft.weapon_ID[j];
                const acBaseWid = baseAcWeaponIds[j] || baseAcWeaponIds[0];
                if (seen.has(acBaseWid)) continue;
                seen.add(acBaseWid);
                const merged = getMergedWeaponProperty(acBaseWid, acWid);
                if (merged) {
                    merged._weaponId = acWid;
                    results.push(merged);
                }
            }
        }
        return results;
    }

    // Standard path
    return weaponIds.map((wid, i) => {
        const baseWpId = baseIds[i] || baseIds[0];
        const merged = getMergedWeaponProperty(baseWpId, wid);
        if (merged) merged._weaponId = wid;
        return merged;
    }).filter(Boolean);
}

/** Merge base and current aircraft template properties, skipping null overrides */
function getMergedAircraftTemplate(baseAcId, currentAcId) {
    const baseAc = baseAcId ? getAircraftTemplate(baseAcId) : null;
    const currentAc = currentAcId ? getAircraftTemplate(currentAcId) : null;

    if (!baseAc && !currentAc) return null;
    if (!baseAc) return currentAc;
    if (!currentAc) return baseAc;

    const merged = { ...baseAc };
    for (const [key, val] of Object.entries(currentAc)) {
        if (val != null) merged[key] = val;
    }
    return merged;
}

function renderAircraftParams(equip, level) {
    if (!AIRCRAFT_TYPES.has(equip.type)) return '';

    const baseIds = equip.levels[0].weapon_id || [];
    if (!baseIds.length) return '';

    const weaponIds = level.weapon_id || baseIds;

    // Use the first aircraft_template entry for the aircraft-level stats, merged with base
    const aircraft = getMergedAircraftTemplate(baseIds[0], weaponIds[0]);
    if (!aircraft) return '';

    let rows = '';
    if (aircraft.speed != null) rows += `<tr><th>항속</th><td>${aircraft.speed}</td></tr>`;
    if (aircraft.dodge != null) rows += `<tr><th>회피</th><td>${aircraft.dodge}</td></tr>`;
    if (aircraft.dodge_limit != null) rows += `<tr><th>회피한계</th><td>${aircraft.dodge_limit}</td></tr>`;
    if (aircraft.crash_DMG != null) rows += `<tr><th>충돌 데미지</th><td>${aircraft.crash_DMG}</td></tr>`;

    if (!rows) return '';

    return `
        <div class="stats-section">
            <div class="stats-section-title">
                <span class="material-symbols-outlined">flight</span>
                기체 파라미터
            </div>
            <table class="stats-table">
                <tbody id="aircraftParamsBody">${rows}</tbody>
            </table>
        </div>
    `;
}

function renderWeaponParamsRows(wp) {
    let rows = '';

    // Damage
    if (wp.damage != null) {
        rows += `<tr><th>화력</th><td>${wp.damage}</td></tr>`;
    }

    // Range
    if (wp.range) {
        const rangeText = wp.min_range ? `${wp.min_range} - ${wp.range}` : `${wp.range}`;
        rows += `<tr><th>색적 범위</th><td>${rangeText}</td></tr>`;
    }

    // Angle
    if (wp.angle != null) {
        rows += `<tr><th>색적 각도</th><td>${wp.angle}°</td></tr>`;
    }

    // Corrected
    if (wp.corrected != null) {
        rows += `<tr><th>대미지 수정 비율</th><td>${wp.corrected}%</td></tr>`;
    }

    // Reload (reload_max / 150, floor to 2 decimals)
    if (wp.reload_max != null) {
        const reload = Math.floor((wp.reload_max / 150) * 100) / 100;
        rows += `<tr><th>무기 사속</th><td>${reload}s</td></tr>`;
    }

    // Attack attribute ratio
    if (wp.attack_attribute_ratio != null) {
        rows += `<tr><th>속성 효율</th><td>${wp.attack_attribute_ratio}%</td></tr>`;
    }

    // Bullet info
    const bulletIds = wp.bullet_ID || [];
    for (const bid of bulletIds) {
        const bullet = getBulletTemplate(bid);
        if (!bullet) continue;

        // Armor modifiers (damage_type)
        const dt = bullet.damage_type;
        if (dt && dt.length >= 3) {
            rows += `<tr><th>대갑 비례(장갑 배율)</th><td>경장 ${Math.round(dt[0] * 100)}%<br>중형 ${Math.round(dt[1] * 100)}%<br>중장 ${Math.round(dt[2] * 100)}%</td></tr>`;
        }

        // Hit range
        const ht = bullet.hit_type;
        if (ht && typeof ht === 'object' && !Array.isArray(ht) && ht.range != null) {
            rows += `<tr><th>피해 범위</th><td>${ht.range}</td></tr>`;
        }

        // Spread (randomOffsetX * randomOffsetZ)
        const ep = bullet.extra_param;
        if (ep && typeof ep === 'object' && !Array.isArray(ep)) {
            const ox = ep.randomOffsetX;
            const oz = ep.randomOffsetZ;
            if (ox != null && oz != null) {
                rows += `<tr><th>확산 범위</th><td>${ox}*${oz}</td></tr>`;
            }
        }
    }

    return rows;
}

function renderWeaponParams(equip, level) {
    const weapons = getMergedWeaponProperties(equip, level);
    if (!weapons.length) return '';

    let allRows = '';
    if (weapons.length === 1) {
        allRows = renderWeaponParamsRows(weapons[0]);
    } else {
        for (let i = 0; i < weapons.length; i++) {
            const wpRows = renderWeaponParamsRows(weapons[i]);
            if (wpRows) {
                const wName = getWeaponName(weapons[i]._weaponId);
                const header = wName || `무기 ${i + 1}`;
                allRows += `<tr><th colspan="2" class="weapon-group-header">${header}</th></tr>`;
                allRows += wpRows;
            }
        }
    }

    if (!allRows) return '';

    return `
        <div class="stats-section">
            <div class="stats-section-title">
                <span class="material-symbols-outlined">tune</span>
                장비 파라미터
            </div>
            <table class="stats-table">
                <tbody id="weaponParamsBody">${allRows}</tbody>
            </table>
        </div>
    `;
}

/** Render skill info section for skill_id and hidden_skill_id */
function renderSkillSection(level) {
    const skills = level.skill_id || [];
    const hiddenSkills = level.hidden_skill_id || [];

    if (!skills.length && !hiddenSkills.length) return '';

    let rows = '';

    for (const entry of skills) {
        const skillId = entry[0];
        const skill = getSkillData(skillId);
        if (!skill) continue;
        rows += `<tr><th>${skill.name}</th><td>${skill.desc || ''}</td></tr>`;
    }

    for (const entry of hiddenSkills) {
        const skillId = entry[0];
        const skill = getSkillData(skillId);
        if (!skill) continue;
        rows += `<tr><th>${skill.name}</th><td>${skill.desc || ''}</td></tr>`;
    }

    if (!rows) return '';

    return `
        <div class="stats-section">
            <div class="stats-section-title">
                <span class="material-symbols-outlined">auto_awesome</span>
                스킬
            </div>
            <table class="stats-table">
                <tbody id="skillTableBody">${rows}</tbody>
            </table>
        </div>
    `;
}

/** Get the weapon_property for the primary (first) weapon_id of a level.
 *  Always uses weapon_id → weapon_property directly (not through aircraft chain). */
function getPrimaryWeaponProperty(equip, level) {
    const weaponIds = level.weapon_id;
    if (!weaponIds || !weaponIds.length) return null;

    const baseWid = (equip.levels[0].weapon_id || [])[0];
    return getMergedWeaponProperty(baseWid, weaponIds[0]);
}

function renderStatsRows(equip, level) {
    let rows = equip.attr_info.map(attr => {
        const value = level[`attr_${attr.index}_value`] || 0;
        return `<tr>
            <th>${attr.icon ? `<img class="stat-icon" src="${attr.icon}" alt="${attr.name}">` : ''}${attr.name}</th>
            <td>${value}</td>
        </tr>`;
    }).join('');

    // Reload speed from the primary weapon
    const reloadWp = getPrimaryWeaponProperty(equip, level);
    if (reloadWp && reloadWp.reload_max != null) {
        const reload = Math.floor((reloadWp.reload_max / 150) * 100) / 100;
        rows += `<tr><th>사속</th><td>${reload}s</td></tr>`;
    }

    // Check for anti_siren in statistics data
    const stats = getLevelStatistics(level.id);
    if (stats && stats.anti_siren) {
        const percent = (stats.anti_siren / 100).toFixed(0);
        rows += `<tr>
            <th>대형 작전 세이렌 증가 대미지</th>
            <td>${percent}%</td>
        </tr>`;
    }

    return rows;
}

/** Get prop icon URL from property ID */
function getPropIconUrl(propId) {
    return `https://raw.githubusercontent.com/JforPlay/data_for_toy/main/props/${propId}.webp`;
}

/** Render a list of [propId, quantity] pairs as icon + quantity chips */
function renderItemChips(items) {
    return items.map(it =>
        `<span class="prop-chip"><img class="prop-icon" src="${getPropIconUrl(it[0])}" alt="${it[0]}" loading="lazy">x${it[1]}</span>`
    ).join(' ');
}

function renderUpgradeRows(equip) {
    return equip.levels.map((lvl, i) => {
        const isCurrent = i === state.currentLevel;
        const gold = lvl.upgrade_gold || 0;
        const items = lvl.upgrade_items || [];
        return `<tr class="${isCurrent ? 'current-level' : ''}">
            <td>${formatLevel(i)}</td>
            <td>${gold > 0 ? gold.toLocaleString() : '-'}</td>
            <td>${items.length > 0 ? renderItemChips(items) : '-'}</td>
        </tr>`;
    }).join('');
}

function renderScrapRows(level) {
    let rows = '';
    if (level.scrap_gold) {
        rows += `<tr><th>골드</th><td>${level.scrap_gold.toLocaleString()}</td></tr>`;
    }
    if (level.scrap_items && level.scrap_items.length > 0) {
        rows += `<tr><th>재료</th><td>${renderItemChips(level.scrap_items)}</td></tr>`;
    }
    return rows;
}

// ===== Update on Level Change =====

function updateLevelDisplay(equip) {
    const level = equip.levels[state.currentLevel] || equip.levels[0];

    const levelDisplay = document.getElementById('levelDisplay');
    if (levelDisplay) {
        const ENHANCE_CAP = { 2: 3, 3: 6, 4: 11, 5: 13, 6: 13 };
        const capMax = Math.min(equip.levels.length, (ENHANCE_CAP[equip.rarity] ?? 13) + 1) - 1;
        levelDisplay.textContent = `${formatLevel(state.currentLevel)} / +${capMax}`;
    }

    const statsBody = document.getElementById('statsTableBody');
    if (statsBody) {
        statsBody.innerHTML = renderStatsRows(equip, level);
    }

    const damageValue = document.getElementById('damageValue');
    if (damageValue && level.damage) {
        damageValue.textContent = replaceEquipCodes(level.damage);
    }

    const upgradeBody = document.getElementById('upgradeTableBody');
    if (upgradeBody) {
        upgradeBody.innerHTML = renderUpgradeRows(equip);
    }

    const scrapBody = document.getElementById('scrapTableBody');
    if (scrapBody) {
        scrapBody.innerHTML = renderScrapRows(level);
    }

    updateDynamicSection('aircraftParamsBody', renderAircraftParams(equip, level));
    updateDynamicSection('weaponParamsBody', renderWeaponParams(equip, level));
    updateDynamicSection('skillTableBody', renderSkillSection(level));
}

/** Update a dynamic section's tbody content, toggling visibility */
function updateDynamicSection(tbodyId, fullHtml) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const section = tbody.closest('.stats-section');
    if (fullHtml) {
        const match = fullHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
        if (match) tbody.innerHTML = match[1];
        if (section) section.style.display = '';
    } else if (section) {
        section.style.display = 'none';
    }
}

// ===== Event Listeners =====

function setupDetailListeners(equip) {
    const levelSlider = document.getElementById('levelSlider');
    if (levelSlider) {
        levelSlider.addEventListener('input', (e) => {
            state.currentLevel = parseInt(e.target.value);
            updateLevelDisplay(equip);
        });
    }
}

// ===== Icon Download (uses cached canvas) =====

export function downloadEquipIcon(equip) {
    if (!equip) equip = state.currentEquip;
    if (!equip) return;

    if (!iconCanvas) {
        showToast('아이콘이 아직 로딩 중입니다.', 'info');
        return;
    }

    iconCanvas.toBlob((blob) => {
        if (!blob) {
            showToast('이미지 생성에 실패했습니다.', 'error');
            return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `equip_${equip.id}_${equip.name.replace(/[^a-zA-Z0-9가-힣]/g, '_')}.png`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('아이콘이 저장되었습니다.', 'success');
    }, 'image/png');
}
