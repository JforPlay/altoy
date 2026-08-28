/**
 * equip.detail.js
 * Renders the slide-in detail panel for a selected equipment entry.
 * Part of the equip viewer module group (viewer + data + detail + compare + upgrade).
 * State is shared via a ref passed to setup() from equip.viewer.js.
 * Covers: canvas icon compositing, stat rows, weapon/aircraft params, skills, upgrade costs, scrap info.
 */

import { showToast, resolveUrl, DATA_FOR_TOY_BASE, escapeHtml } from '../utils.js';
import {
    getEquipIconUrl, getRarityBgUrl, getFullEquipData, getLevelStatistics,
    replaceEquipCodes, getBulletTemplate, getSkillData, getWeaponName,
    getFiringPattern, formatLevel, getVisibleLevelCount, AIRCRAFT_TYPES,
    getMergedAircraftTemplate, getMergedWeaponProperties, getPrimaryWeaponProperty,
    getHearingEntry, getTheoreticalSurfaceDps, ensureDetailData, reloadMaxToSeconds,
    getSPWeaponRawData, getSPWeaponIconUrl, loadSkillData,
    SP_RARITY_NAMES, SP_RARITY_TO_EQUIP, SP_ATTR_NAMES
} from './equip.data.js';
import { formatDps } from './equip.compare.logic.js';
import { renderHearingComment } from './equip.hearing-view.js';

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

/**
 * Escape a game text field for innerHTML, dropping the Unity `<color=…>` wrapper
 * two 장비 descriptions carry. Those tags are markup for the game's own renderer,
 * not HTML — unescaped they parse as unknown elements and vanish, which is what
 * they look like today; escaped without this they'd read as literal `<color=…>`.
 */
function escapeGameText(text) {
    return escapeHtml(String(text ?? '').replace(/<\/?color(=[^>]*)?>/g, ''));
}

let state;
/** Cached canvas from the last rendered icon (used for download) */
let iconCanvas = null;

/** Receive shared state from equip.viewer.js. */
export function setup(stateRef) {
    state = stateRef;
}

// ===== Panel Header Title =====

/**
 * Set the pinned panel-header bar to the equipment name (+ optional 별명 badge).
 * The header is the always-reachable close bar on mobile (the drawer fills the
 * viewport there), so it carries the identity of what's open. textContent only —
 * names/aliases are data values.
 */
export function setDetailPanelTitle(name, alias = null) {
    const titleEl = document.getElementById('detailPanelTitle');
    if (!titleEl) return;
    titleEl.textContent = '';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'panel-title-name';
    nameSpan.textContent = name;
    titleEl.appendChild(nameSpan);
    if (alias) {
        const aliasSpan = document.createElement('span');
        aliasSpan.className = 'panel-detail-alias';
        aliasSpan.textContent = alias;
        titleEl.appendChild(aliasSpan);
    }
}

// ===== Show Detail View =====

/**
 * Load full equipment data by ID and render it into the detail panel.
 * Resets current level to 0 and clears the icon canvas on each call.
 * Returns the resolved equipment object, or null if not found.
 */
export async function showDetailView(equipId) {
    const panelContent = document.getElementById('detailPanelContent');
    if (!panelContent) return;

    await ensureDetailData();
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

// ===== SP (특수 장비) Detail =====

/**
 * Render the detail panel for an SP weapon. Separate from renderDetail because
 * SP weapons have their own data shape (attr pairs, level progression, skill
 * upgrades) and share none of the equip level/upgrade sections.
 * Returns false when the weapon or the panel is missing; the caller opens the panel.
 */
export async function showSPWeaponDetail(spId) {
    const spWeapon = getSPWeaponRawData(spId);
    const panelContent = document.getElementById('detailPanelContent');
    if (!spWeapon || !panelContent) return false;

    await loadSkillData();

    const iconUrl = getSPWeaponIconUrl(spWeapon.icon);
    const maxLvl = spWeapon.levels ? spWeapon.levels[spWeapon.levels.length - 1] : null;
    const attr1Name = SP_ATTR_NAMES[spWeapon.attr_1] || spWeapon.attr_1;
    const attr2Name = SP_ATTR_NAMES[spWeapon.attr_2] || spWeapon.attr_2;
    const rarityClass = SP_RARITY_TO_EQUIP[spWeapon.rarity] || '';
    const rarityName = SP_RARITY_NAMES[spWeapon.rarity] || '';
    const uniqueLabel = spWeapon.unique ? '전용' : '범용';

    let levelsHTML = '';
    if (spWeapon.levels && spWeapon.levels.length > 1) {
        const rows = spWeapon.levels.map((lvl, i) =>
            `<tr><td>+${i}</td><td>${lvl.v1}</td><td>${lvl.v2}</td></tr>`
        ).join('');
        levelsHTML = `
            <div class="stats-section">
                <div class="stats-section-title section-title section-title--sm">
                    <span class="material-symbols-outlined">upgrade</span>
                    강화 단계
                </div>
                <table class="stats-table">
                    <thead><tr><th>단계</th><th>${escapeHtml(attr1Name)}</th><th>${escapeHtml(attr2Name)}</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }

    // Only unique (전용) SP weapons have skill upgrades
    let skillHTML = '';
    if (spWeapon.skill_upgrade && spWeapon.skill_upgrade.length > 0) {
        const skillRows = [];
        for (const [origId, upgId] of spWeapon.skill_upgrade) {
            if (origId && origId !== 0) {
                const origSkill = getSkillData(origId);
                const upgSkill = getSkillData(upgId);
                if (origSkill || upgSkill) {
                    skillRows.push(`<tr><th>${escapeHtml(origSkill?.name || `스킬 ${origId}`)}</th><td>→ ${escapeHtml(upgSkill?.name || `스킬 ${upgId}`)}</td></tr>`);
                }
            } else if (upgId) {
                const skill = getSkillData(upgId);
                if (skill) {
                    skillRows.push(`<tr><th>${escapeHtml(skill.name)}</th><td>추가 스킬</td></tr>`);
                    if (skill.desc) skillRows.push(`<tr><td colspan="2" class="sp-skill-desc">${escapeHtml(skill.desc)}</td></tr>`);
                }
            }
        }
        if (skillRows.length > 0) {
            skillHTML = `
                <div class="stats-section">
                    <div class="stats-section-title section-title section-title--sm">
                        <span class="material-symbols-outlined">auto_awesome</span>
                        스킬
                    </div>
                    <table class="stats-table"><tbody>${skillRows.join('')}</tbody></table>
                </div>`;
        }
    }

    panelContent.innerHTML = `
        <div class="panel-detail-top">
            <div class="panel-detail-icon-wrapper sp-detail-icon">
                <img class="equip-icon-bg-img" src="${escapeHtml(getRarityBgUrl(rarityClass || 3))}" alt="">
                ${iconUrl ? `<img class="sp-detail-icon-img" src="${escapeHtml(iconUrl)}" alt="${escapeHtml(spWeapon.name)}">` : ''}
            </div>
            <div class="panel-detail-name">${escapeHtml(spWeapon.name)}</div>
            <div class="panel-detail-meta">
                <span class="badge badge--neutral">특수 장비</span>
                <span class="equip-rarity-badge rarity-${rarityClass}">${rarityName}</span>
                <span class="badge badge--neutral">${uniqueLabel}</span>
            </div>
        </div>
        <div class="stats-section">
            <div class="stats-section-title section-title section-title--sm">
                <span class="material-symbols-outlined">bar_chart</span>
                스탯 (최대 강화)
            </div>
            <table class="stats-table">
                <tbody>
                    <tr><th>${escapeHtml(attr1Name)}</th><td>${maxLvl ? maxLvl.v1 : '-'}</td></tr>
                    <tr><th>${escapeHtml(attr2Name)}</th><td>${maxLvl ? maxLvl.v2 : '-'}</td></tr>
                </tbody>
            </table>
        </div>
        ${skillHTML}
        ${levelsHTML}
    `;
    setDetailPanelTitle(spWeapon.name);

    // SP weapons don't participate in the upgrade tree system
    const researchLink = document.getElementById('detailResearchLink');
    if (researchLink) researchLink.style.display = 'none';
    return true;
}

// ===== Render Detail =====

/**
 * Build and inject the full detail panel HTML for the given equipment.
 * Sections are conditionally rendered based on available data fields.
 * ENHANCE_CAP caps the visible level range by rarity (e.g., rarity 2 → max +3).
 */
function renderDetail(equip) {
    const panelContent = document.getElementById('detailPanelContent');
    if (!panelContent) return;

    const level = equip.levels[state.currentLevel] || equip.levels[0];
    const iconUrl = getEquipIconUrl(equip.icon);
    const maxLevel = getVisibleLevelCount(equip);
    const hearingEntry = getHearingEntry(equip.id);

    setDetailPanelTitle(equip.name, hearingEntry?.alias || null);

    let html = `
        <div class="panel-detail-top">
            <div class="panel-detail-icon-wrapper">
                <canvas id="detailIconCanvas" width="256" height="256"></canvas>
            </div>
            <div class="panel-detail-name">${equip.name}${hearingEntry?.alias ? `<span class="panel-detail-alias">${escapeHtml(hearingEntry.alias)}</span>` : ''}</div>
            <div class="panel-detail-meta">
                <span class="badge badge--neutral">${escapeHtml(equip.type_name2 || equip.type_name)}</span>
                <span class="equip-rarity-badge rarity-${equip.rarity}">${escapeHtml(equip.rarity_name)}</span>
                ${equip.nation_name ? `<span class="panel-detail-nation-badge">
                    ${equip.nation_image ? `<img src="${escapeHtml(equip.nation_image)}" alt="${escapeHtml(equip.nation_name)}">` : ''}
                    ${escapeHtml(equip.nation_name)}
                </span>` : ''}
            </div>
            ${equip.speciality && equip.speciality !== '없음' ? `<div class="panel-detail-speciality">특성: ${escapeHtml(replaceEquipCodes(equip.speciality))}</div>` : ''}
            ${equip.label && equip.label.length > 0 ? `<div class="panel-detail-labels">${equip.label.map(l => `<span class="badge badge--neutral">${escapeHtml(l)}</span>`).join('')}</div>` : ''}
            ${equip.descrip ? `<div class="panel-detail-descrip">${escapeGameText(equip.descrip)}</div>` : ''}
            ${AIRCRAFT_TYPES.has(equip.type) ? `<a href="${resolveUrl(`simulators/sim-aircraft?equip=${equip.id}`)}" class="sim-link-btn btn btn-outline btn-sm"><span class="material-symbols-outlined">flight</span> 시뮬레이션</a>` : ''}
        </div>
    `;

    // 한줄평 (장비 청문회) — placed before stats; all reviews shown here
    if (hearingEntry && (hearingEntry.reviews || []).length > 0) {
        const reviewsHtml = hearingEntry.reviews
            .map(r => `<div class="hearing-comment">${renderHearingComment(r)}</div>`)
            .join('');
        html += `
            <div class="stats-section">
                <div class="stats-section-title section-title section-title--sm">
                    <span class="material-symbols-outlined">chat_bubble</span>
                    한줄평
                </div>
                <div class="hearing-detail-comments">${reviewsHtml}</div>
            </div>
        `;
    }

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
                <div class="stats-section-title section-title section-title--sm">
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
        if (level.damage) weaponRows += `<tr><th>데미지</th><td id="damageValue">${escapeHtml(replaceEquipCodes(level.damage))}</td></tr>`;
        if (ammoName) weaponRows += `<tr><th>탄종</th><td>${ammoName}</td></tr>`;
        html += `
            <div class="stats-section">
                <div class="stats-section-title section-title section-title--sm">
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
                <div class="stats-section-title section-title section-title--sm">
                    <span class="material-symbols-outlined">directions_boat</span>
                    장착 가능 함종
                </div>
                ${equip.part_main.length > 0 ? `
                    <div class="ship-type-group">
                        <div class="ship-type-group-label">메인 슬롯</div>
                        <div class="ship-type-chips">
                            ${equip.part_main.map(st => `
                                <span class="ship-type-chip">
                                    ${st.icon ? `<img src="${escapeHtml(st.icon)}" alt="${escapeHtml(st.name)}">` : ''}
                                    ${escapeHtml(st.name)}
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
                                    ${st.icon ? `<img src="${escapeHtml(st.icon)}" alt="${escapeHtml(st.name)}">` : ''}
                                    ${escapeHtml(st.name)}
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
                <div class="stats-section-title section-title section-title--sm">
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
                <div class="stats-section-title section-title section-title--sm">
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

/**
 * Draw the rarity background and equipment icon onto the detail canvas.
 * Images are loaded with crossOrigin=anonymous so the canvas can be exported.
 * Stores the finished canvas reference in iconCanvas for download.
 */
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

/**
 * Render aircraft-level stats (speed, dodge, dodge_limit, crash_DMG) for aircraft equip types.
 * Uses the first weapon_id → aircraft_template, merged with the base level's template.
 */
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
            <div class="stats-section-title section-title section-title--sm">
                <span class="material-symbols-outlined">flight</span>
                기체 파라미터
            </div>
            <table class="stats-table">
                <tbody id="aircraftParamsBody">${rows}</tbody>
            </table>
        </div>
    `;
}

/** One combined "이론 DPS" row (경장/중형/중장) from getTheoreticalSurfaceDps, or '' when null.
 *  A per-equip surface total (aircraft sum ordnance over the airstrike cadence × 2.2, guns
 *  excluded; surface mounts use their own 사속) — see equip.data.js getTheoreticalSurfaceDps. */
function renderSurfaceDpsRow(surface) {
    if (!surface) return '';
    const [l, m, h] = surface.dps;
    return `<tr><th title="데미지 × 수정배율 × 탄수 × 장갑 배율 ÷ 사속, 표면 무장 합산 — 항공기는 폭장만 발진 간격×2.2로, 대공 기총 제외 (함선 스탯을 뺀 상대 지표)">이론 DPS</th>`
        + `<td>경장 ${formatDps(l)}<br>중형 ${formatDps(m)}<br>중장 ${formatDps(h)}</td></tr>`;
}

/**
 * Build table rows for a single merged weapon property object.
 * Reads damage_type from bullet_template for armor modifiers (대갑 배율).
 * Does NOT use equip.ammo for ammo type — that's rendered separately via AMMO_TYPE_NAMES.
 * @param wp merged weapon property
 * @param {?{dps:number[]}} surfaceDps  combined 이론 DPS to inject directly under this weapon's
 *        대갑 비례 row — passed ONLY for single-weapon equips (then the equip total == this
 *        weapon). Multi-weapon (aircraft) append one combined row at the section end instead.
 */
function renderWeaponParamsRows(wp, surfaceDps = null) {
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

    if (wp.reload_max != null) {
        rows += `<tr><th>무기 사속</th><td>${reloadMaxToSeconds(wp.reload_max)}s</td></tr>`;
    }

    // Firing pattern (barrage timing)
    const firingPattern = getFiringPattern(wp);
    if (firingPattern) {
        rows += `<tr><th>발사 패턴</th><td>${escapeHtml(firingPattern)}</td></tr>`;
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
            // Single-weapon equips show the 이론 DPS right under 대갑 비례 (once).
            if (surfaceDps) {
                rows += renderSurfaceDpsRow(surfaceDps);
                surfaceDps = null;
            }
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

/**
 * Render the weapon parameters section for the current level.
 * Every weapon shows a grouped header with its name (from weapon_name.json).
 * Multi-weapon entries fall back to a positional "무기 N" label; a single
 * unnamed weapon gets no header (the positional label would be meaningless).
 */
function renderWeaponParams(equip, level) {
    const weapons = getMergedWeaponProperties(equip, level);
    if (!weapons.length) return '';

    // Combined per-equip "이론 DPS" (sums surface weapons; aircraft = ordnance over airstrike×2.2,
    // guns excluded). Single-weapon equips inject it under 대갑 비례; multi-weapon (aircraft) append
    // one combined row after all blocks — a single weapon's 대갑 비례 can't host a multi-weapon sum.
    const surface = getTheoreticalSurfaceDps(equip, level);
    const single = weapons.length === 1;

    let allRows = '';
    for (let i = 0; i < weapons.length; i++) {
        const wpRows = renderWeaponParamsRows(weapons[i], single ? surface : null);
        if (!wpRows) continue;
        const wName = getWeaponName(weapons[i]._weaponId);
        const header = wName || (single ? '' : `무기 ${i + 1}`);
        if (header) {
            allRows += `<tr><th colspan="2" class="weapon-group-header">${escapeHtml(header)}</th></tr>`;
        }
        allRows += wpRows;
    }
    if (!single) allRows += renderSurfaceDpsRow(surface);

    if (!allRows) return '';

    return `
        <div class="stats-section">
            <div class="stats-section-title section-title section-title--sm">
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
        rows += `<tr><th>${escapeHtml(skill.name)}</th><td>${escapeHtml(skill.desc || '')}</td></tr>`;
    }

    for (const entry of hiddenSkills) {
        const skillId = entry[0];
        const skill = getSkillData(skillId);
        if (!skill) continue;
        rows += `<tr><th>${escapeHtml(skill.name)}</th><td>${escapeHtml(skill.desc || '')}</td></tr>`;
    }

    if (!rows) return '';

    return `
        <div class="stats-section">
            <div class="stats-section-title section-title section-title--sm">
                <span class="material-symbols-outlined">auto_awesome</span>
                스킬
            </div>
            <table class="stats-table">
                <tbody id="skillTableBody">${rows}</tbody>
            </table>
        </div>
    `;
}

/**
 * Build attribute stat rows for the current level, appending reload speed and anti_siren if present.
 * Reload is sourced from the primary weapon (not aircraft chain) — see getPrimaryWeaponProperty.
 */
function renderStatsRows(equip, level) {
    let rows = equip.attr_info.map(attr => {
        const value = level[`attr_${attr.index}_value`] || 0;
        return `<tr>
            <th>${attr.icon ? `<img class="stat-icon" src="${escapeHtml(attr.icon)}" alt="${escapeHtml(attr.name)}">` : ''}${escapeHtml(attr.name)}</th>
            <td>${value}</td>
        </tr>`;
    }).join('');

    // Reload speed from the primary weapon
    const reloadSeconds = reloadMaxToSeconds(getPrimaryWeaponProperty(equip, level)?.reload_max);
    if (reloadSeconds != null) {
        rows += `<tr><th>사속</th><td>${reloadSeconds}s</td></tr>`;
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
    return `${DATA_FOR_TOY_BASE}/props/${propId}.webp`;
}

/** Render a list of [propId, quantity] pairs as icon + quantity chips */
function renderItemChips(items) {
    return items.map(it =>
        `<span class="prop-chip"><img class="prop-icon" src="${getPropIconUrl(it[0])}" alt="${it[0]}" loading="lazy">x${it[1]}</span>`
    ).join(' ');
}

/** Render one row per level with gold cost and material chips. Highlights the current level. */
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

/** Render gold and item rows for the scrap reward section. */
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

/**
 * Refresh all level-dependent sections when the slider moves.
 * Updates the level display, stats, damage value, upgrade table, scrap table,
 * and dynamic sections (aircraft params, weapon params, skills) without a full re-render.
 */
function updateLevelDisplay(equip) {
    const level = equip.levels[state.currentLevel] || equip.levels[0];

    const levelDisplay = document.getElementById('levelDisplay');
    if (levelDisplay) {
        const capMax = getVisibleLevelCount(equip) - 1;
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

/** Attach the level slider input handler after panel HTML is injected. */
function setupDetailListeners(equip) {
    const levelSlider = document.getElementById('levelSlider');
    if (levelSlider) {
        levelSlider.addEventListener('input', (e) => {
            state.currentLevel = parseInt(e.target.value);
            updateLevelDisplay(equip);
        });
    }
}

// ===== Icon Download =====

/**
 * Download the composited equipment icon as a PNG.
 * Falls back to the current equip in state if none is passed.
 * Toasts a warning if the canvas hasn't finished rendering yet.
 */
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
