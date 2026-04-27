/**
 * shipgirl-info.detail.js
 * Detail panel rendering for the shipgirl info page: header, stat calculator, skills, SP weapon, gifts.
 * Part of the shipgirl-info module group (info + data + detail + maps).
 * State is shared via a ref passed to setup() from shipgirl-info.js.
 */

import { createImg, IMG_FALLBACKS, showToast, resolveUrl } from '../utils.js';
import { setupTooltipToggles } from '../global.script.js';
import {
    getSkillInfo,
    getAttrKoreanName,
    getShipType,
    createAttrMapping,
    loadSkillIconData,
    loadSkillDataTemplate
} from './shipgirl-info.data.js';
import { showMapsModal } from './shipgirl-info.maps.js';

'use strict';

// ===== Constants =====
const FAVORABILITY_BONUSES = {
    'other': 1.0,
    'friendly': 1.01,
    'crush': 1.03,
    'love': 1.06,
    'oath': 1.09,
    'oath200': 1.12
};

const ARMOR_TYPES = {
    1: '경장갑',
    2: '중형장갑',
    3: '중장갑'
};

const LIMIT_BREAK_NAMES = ['기본', '한계돌파 1', '한계돌파 2', '한계돌파 3'];

const UNAFFECTED_STATS = ['speed', 'luck'];

// ===== State Reference =====
let state;
// One-time flag: delegated click handler on the static #detailContent container
// is wired on first render and persists across re-renders, so we don't stack
// duplicate listeners every time setupDetailEventListeners runs.
let detailDelegatedClickWired = false;

export function setup(stateRef) {
    state = stateRef;
}

// ===== Detail View Entry =====

/**
 * Show the detail view for a ship by name.
 * Waits for full data to load if needed, sets initial state (level 100, love affinity, max LB),
 * then delegates to renderDetailView.
 */
export async function showDetailView(shipName) {
    // If full data isn't loaded yet, wait for it
    if (!state.fullShipData) {
        state.elements.loading.style.display = 'block';
        try {
            await state.fullShipDataPromise;
        } catch (e) {
            showToast("상세 데이터를 불러오는데 실패했습니다.", 'error');
            state.showMainView();
            state.elements.loading.style.display = 'none';
            return;
        }
        state.elements.loading.style.display = 'none';
    }

    if (!state.fullShipData) {
         showToast("상세 데이터 로드 실패.", 'error');
         state.showMainView();
         return;
    }

    const ship = state.fullShipData.find(s => s.name === shipName);

    if (!ship) {
        showToast('함순이를 찾을 수 없습니다', 'error');
        state.showMainView();
        return;
    }

    state.currentShip = ship;
    state.currentLevel = 100;
    state.currentFavorability = 'love';
    state.currentEnhancement = 'complete';

    const limitBreakOptions = Object.keys(ship.base);
    state.currentLimitBreak = limitBreakOptions[limitBreakOptions.length - 1];

    state.elements.loading.style.display = 'block';
    try {
        await Promise.all([loadSkillIconData(), loadSkillDataTemplate()]);
    } finally {
        state.elements.loading.style.display = 'none';
    }

    state.elements.mainView.style.display = 'none';
    state.elements.detailView.style.display = 'block';

    renderDetailView(ship);

    // Update prev/next navigation buttons
    if (state.updateNavButtons) state.updateNavButtons();

    // Reset scroll position to top
    window.scrollTo(0, 0);
}

// ===== Detail View Rendering =====

function renderDetailView(ship) {
    const limitBreakOptions = Object.keys(ship.base);
    const nationalityInfo = state.nationalityData[String(ship.nationality)] || {
        name: ship.nationality,
        code: '',
        image: ''
    };

    const detailContent = document.getElementById('detailContent');
    detailContent.innerHTML = `
        ${renderDetailHeader(ship, nationalityInfo)}
        ${renderGiftSection(ship)}
        ${renderStatsSection(ship, limitBreakOptions)}
        ${renderSkillSection(ship)}
        ${renderSpWeaponSection(ship)}
    `;

    setupDetailEventListeners();
    updateStats();
}

/**
 * Render the top info card: ship image, basic metadata, retrofit badge, and drop sources.
 * Equipment proficiency stats are excluded from the retrofit bonus display.
 */
function renderDetailHeader(ship, nationalityInfo) {
    const hasRetrofit = ship.retrofit && ship.retrofit.id;

    // Filter retrofit bonuses to exclude equipment proficiency
    let retrofitBonuses = {};
    if (hasRetrofit && ship.retrofit.bonus) {
        retrofitBonuses = Object.fromEntries(
            Object.entries(ship.retrofit.bonus).filter(([stat, value]) =>
                !stat.includes('equipment_proficiency')
            )
        );
    }

    return `
        <div class="detail-header">
            <div class="detail-image">
                ${createImg(ship.shipyard, ship.name, { fallback: IMG_FALLBACKS.DETAIL })}
            </div>
            <div class="detail-basic-info">
                <h2 class="detail-title">
                    ${ship.name}
                    ${hasRetrofit ? '<span class="retrofit-available-badge">개조 가능</span>' : ''}
                </h2>
                <div class="skin-link-container">
                        <a href="${resolveUrl(`skin/skin-detail-viewer/?character=${encodeURIComponent(ship.name)}&skin=${encodeURIComponent(ship.name)}`)}" class="skin-viewer-button">
                            🎨 스킨/대사 보러가기
                        </a>
                    </div>
                <div class="info-grid">
                    <div class="info-item">
                        <div class="info-label">등급</div>
                        <div class="info-value">
                            <span class="rarity-badge rarity-${ship.rarity}">${ship.rarity}</span>
                        </div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">그룹 ID</div>
                        <div class="info-value">${ship.gid}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">함종</div>
                        <div class="info-value">${getShipType(ship.type)}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">장갑</div>
                        <div class="info-value">${ARMOR_TYPES[ship.armor] || `장갑 ${ship.armor}`}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">진영</div>
                        <div class="info-value">
                            ${nationalityInfo.image ? `<img src="${nationalityInfo.image}" alt="${nationalityInfo.code}" style="height: 24px; vertical-align: middle; margin-right: 5px;">` : ''}
                            ${nationalityInfo.name}${nationalityInfo.code ? ` (${nationalityInfo.code})` : ''}
                        </div>
                    </div>
                    ${hasRetrofit ? `
                        <div class="info-item">
                            <div class="info-label">개조 레벨 요구</div>
                            <div class="info-value">${ship.retrofit.level}</div>
                        </div>
                    ` : ''}
                </div>
                ${ship.description && ship.description.length > 0 ? `
                    <div style="margin-top: 20px;">
                        <strong>드랍 정보:</strong>
                        <p style="margin-top: 10px;">${ship.description.join(', ')}</p>
                    </div>
                ` : ''}
                <div style="margin-top: 20px;">
                    <button class="view-maps-btn" data-action="show-maps" data-ship-name="${ship.name}">
                        <i class="fas fa-map-marked-alt"></i> 드랍 지역 보기
                    </button>
                </div>
                ${hasRetrofit && Object.keys(retrofitBonuses).length > 0 ? `
                    <div class="retrofit-bonus-section">
                        <h4 class="retrofit-bonus-title">개조 보너스</h4>
                        <div class="retrofit-bonus-grid">
                            ${Object.entries(retrofitBonuses).map(([stat, value]) => `
                                <div class="retrofit-bonus-item">
                                    <span class="bonus-stat">${getAttrKoreanName(stat) || stat}:</span>
                                    <span class="bonus-value">+${value}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

function renderGiftSection(ship) {
    return `
        <div class="gift-section">
            <h3 class="section-title">선호하는 선물</h3>
            <div class="gift-container">
                <div class="gift-group">
                    <div class="gift-group-title">좋아하는 선물</div>
                    <div class="gift-icons liked-gifts">
                        ${generateGiftIcons(ship.gift_dislike || [], 'liked')}
                    </div>
                </div>
                <div class="gift-group">
                    <div class="gift-group-title">싫어하는 선물</div>
                    <div class="gift-icons disliked-gifts">
                        ${generateGiftIcons(ship.gift_dislike || [], 'disliked')}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderStatsSection(ship, limitBreakOptions) {
    return `
        <div class="stats-section">
            <h3 class="section-title">
                능력치 계산기
                <button class="tooltip-toggle-button" data-tooltip-target="statInfoTooltip" title="계산 방식 보기">
                    <span class="material-symbols-outlined">help</span>
                </button>
            </h3>
            <div class="info-tooltip" id="statInfoTooltip">
                <div class="tooltip-content">
                    <h4>능력치 계산 공식</h4>
                    <p class="tooltip-formula">최종 능력치 = <strong>⌊(기본 + 성장 × (레벨-1) / 1000 + 강화) × 호감도 보너스⌋</strong></p>
                    <div class="tooltip-details">
                        <p><strong>기본:</strong> 한계돌파에 따른 기본 능력치</p>
                        <p><strong>성장:</strong> 레벨업 시 증가하는 성장치</p>
                        <p><strong>강화:</strong> 강화 완료 시 추가되는 수치</p>
                        <p><strong>호감도:</strong> 호감도에 따른 배율 (속도, 행운 제외)</p>
                    </div>
                    <p class="tooltip-note">※ ⌊ ⌋는 소수점 버림을 의미합니다</p>
                </div>
            </div>
            <div class="stats-grid" id="statsGrid"></div>
            <div class="stat-controls">
                <div class="control-row">
                    <div class="control-group">
                        <label for="limitBreakSelect">한계돌파</label>
                        <select id="limitBreakSelect">
                            ${limitBreakOptions.map((key, index) => `
                                <option value="${key}" ${key === state.currentLimitBreak ? 'selected' : ''}>
                                    ${LIMIT_BREAK_NAMES[index] || `한계돌파 ${index}`}
                                </option>
                            `).join('')}
                        </select>
                    </div>
                    <div class="control-group">
                        <label for="favorabilitySelect">호감도</label>
                        <select id="favorabilitySelect">
                            <option value="other">기타 (0%)</option>
                            <option value="friendly">호감 61+ (1%)</option>
                            <option value="crush">기쁨 81+ (3%)</option>
                            <option value="love" selected>사랑 100 (6%)</option>
                            <option value="oath">서약 100+ (9%)</option>
                            <option value="oath200">서약 200 (12%)</option>
                        </select>
                    </div>
                    <div class="control-group">
                        <label for="enhancementSelect">강화</label>
                        <select id="enhancementSelect">
                            <option value="none">강화 X</option>
                            <option value="complete" selected>강화 완료</option>
                        </select>
                    </div>
                </div>
                <div class="level-slider-container">
                    <label for="levelSlider">레벨: <span id="levelValue">${state.currentLevel}</span></label>
                    <input type="range" id="levelSlider" min="1" max="125" value="${state.currentLevel}">
                </div>
            </div>
        </div>
    `;
}

function renderSkillSection(ship) {
    if (!ship.skill || Object.keys(ship.skill).length === 0) return '';

    // Get all skills including retrofit skill if exists
    const allSkills = [];

    // Add regular skills (ignore skills with "Retrofit" requirement)
    Object.values(ship.skill).forEach(skill => {
        if (skill.requirement !== 'Retrofit') {
            allSkills.push({
                id: skill.id,
                parent: skill.parent,
                requirement: skill.requirement || '없음',
                isRetrofit: false,
                weapon_true: skill.weapon_true || false
            });
        }
    });

    // Add retrofit skill if it exists
    if (ship.retrofit && ship.retrofit.skill_id) {
        const retrofitSkillId = ship.retrofit.skill_id;
        // Check if this skill isn't already in the regular skills
        const alreadyExists = allSkills.some(s => s.id === retrofitSkillId);
        if (!alreadyExists) {
            // Find the retrofit skill to get weapon_true status
            const retrofitSkillData = Object.values(ship.skill).find(s => s.id === retrofitSkillId);
            allSkills.push({
                id: retrofitSkillId,
                parent: retrofitSkillId,
                requirement: '개조',
                isRetrofit: true,
                weapon_true: retrofitSkillData?.weapon_true || false
            });
        }
    }

    if (allSkills.length === 0) return '';

    return `
        <div class="stats-section">
            <h3 class="section-title">스킬</h3>
            <ul class="skill-list">
                ${allSkills.map(skill => {
        const skillInfo = getSkillInfo(skill.id);
        const iconUrl = skillInfo.iconUrl;
        const isWeaponSkill = skill.weapon_true === true;
        const skillUrl = resolveUrl(`simulators/sim-weapon/?skill_id=${skill.id}`);

        return `
                        <li class="skill-item ${skill.isRetrofit ? 'retrofit-skill' : ''} ${isWeaponSkill ? 'weapon-skill-clickable' : ''}"
                            ${isWeaponSkill ? `data-skill-url="${skillUrl}"` : ''}>
                            <div class="skill-header">
                                ${iconUrl ? `
                                    <img src="${iconUrl}"
                                         alt="${skillInfo.name}"
                                         class="skill-icon" loading="lazy" data-onfail="hide">
                                ` : `
                                    <div class="skill-icon-placeholder">${skill.id}</div>
                                `}
                                <div class="skill-title">
                                    <div>
                                        <strong>${skillInfo.name}</strong>
                                        ${skill.isRetrofit ? '<span class="retrofit-badge">개조</span>' : ''}
                                        ${isWeaponSkill ? '<span class="weapon-badge">무기 시뮬레이터</span>' : ''}
                                    </div>
                                    <span class="skill-id">ID: ${skill.id}</span>
                                </div>
                            </div>
                            <div class="skill-description">${skillInfo.description}</div>
                            <div class="skill-meta">
                                <span><strong>필요 조건:</strong> ${skill.requirement}</span>
                                ${isWeaponSkill ? '<span class="weapon-sim-hint">클릭하여 무기 시뮬레이터에서 보기 →</span>' : ''}
                            </div>
                        </li>
                    `;
    }).join('')}
            </ul>
        </div>
    `;
}

function renderSpWeaponSection(ship) {
    if (!ship.sp_weapon) return '';

    const spWeapon = ship.sp_weapon;
    const iconUrl = `https://raw.githubusercontent.com/JforPlay/data_for_toy/main/spweapon/${spWeapon.icon}.webp`;

    const skillUpgradeIds = (spWeapon.skill_upgrade || [])
        .filter(skillArray => Array.isArray(skillArray) && skillArray.length > 1)
        .map(skillArray => skillArray[1]);

    return `
        <div class="sp-weapon-section">
            <h3 class="section-title">특수 장비</h3>
            <div class="sp-weapon-header">
                <div class="sp-weapon-icon-container">
                    ${createImg(iconUrl, spWeapon.name, { className: 'sp-weapon-icon', fallback: IMG_FALLBACKS.DEFAULT })}
                </div>
                <div class="sp-weapon-details">
                    <div class="info-grid">
                        <div class="info-item">
                            <div class="info-label">이름</div>
                            <div class="info-value">${spWeapon.name}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">속성 1</div>
                            <div class="info-value">${getAttrKoreanName(spWeapon.attribute_1)}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">속성 2</div>
                            <div class="info-value">${getAttrKoreanName(spWeapon.attribute_2)}</div>
                        </div>
                    </div>
                </div>
            </div>
            ${skillUpgradeIds.length > 0 ? `
                <div class="sp-weapon-skills">
                    <h4 class="sp-weapon-skills-title">스킬 강화</h4>
                    <ul class="skill-list">
                        ${skillUpgradeIds.map(skillId => {
        const skillInfo = getSkillInfo(skillId);
        const isWeaponSkill = spWeapon.weapon_true === true;
        const skillUrl = resolveUrl(`simulators/sim-weapon/?skill_id=${skillId}`);

        return `
                                <li class="skill-item ${isWeaponSkill ? 'weapon-skill-clickable' : ''}"
                                    ${isWeaponSkill ? `data-skill-url="${skillUrl}"` : ''}>
                                    <div class="skill-header">
                                        ${skillInfo.iconUrl ? `
                                            <img src="${skillInfo.iconUrl}"
                                                 alt="${skillInfo.name}"
                                                 class="skill-icon"
                                                 data-onfail="hide">
                                        ` : ''}
                                        <div class="skill-title">
                                            <div>
                                                <strong>${skillInfo.name}</strong>
                                                ${isWeaponSkill ? '<span class="weapon-badge">무기 시뮬레이터</span>' : ''}
                                                </div>
                                            <span class="skill-id">ID: ${skillId}</span>
                                        </div>
                                    </div>
                                    <div class="skill-description">${skillInfo.description}</div>
                                    <div class="skill-meta">
                                        <span><strong>타입:</strong> 특수 장비 강화 스킬</span>
                                        ${isWeaponSkill ? '<span class="weapon-sim-hint">클릭하여 무기 시뮬레이터에서 보기 →</span>' : ''}
                                    </div>
                                </li>
                            `;
    }).join('')}
                    </ul>
                </div>
            ` : ''}
        </div>
    `;
}

export function setupDetailEventListeners() {
    const detailContent = document.getElementById('detailContent');
    const levelSlider = document.getElementById('levelSlider');
    const levelValue = document.getElementById('levelValue');
    const limitBreakSelect = document.getElementById('limitBreakSelect');
    const favorabilitySelect = document.getElementById('favorabilitySelect');
    const enhancementSelect = document.getElementById('enhancementSelect');

    levelSlider.addEventListener('input', (e) => {
        state.currentLevel = parseInt(e.target.value);
        levelValue.textContent = state.currentLevel;
        updateStats();
    });

    limitBreakSelect.addEventListener('change', (e) => {
        state.currentLimitBreak = e.target.value;
        updateStats();
    });

    favorabilitySelect.addEventListener('change', (e) => {
        state.currentFavorability = e.target.value;
        updateStats();
    });

    enhancementSelect.addEventListener('change', (e) => {
        state.currentEnhancement = e.target.value;
        updateStats();
    });

    // Delegated click handling for buttons/items rendered into detailContent.
    // Strict CSP forbids inline `onclick=` attributes, so the markup carries
    // intent via data-action / data-skill-url / data-ship-name and we route here.
    // Wired once — the container element is static, only its innerHTML changes.
    if (!detailDelegatedClickWired) {
        detailContent.addEventListener('click', (e) => {
            const mapsBtn = e.target.closest('[data-action="show-maps"]');
            if (mapsBtn) {
                const shipName = mapsBtn.dataset.shipName;
                if (shipName) showMapsModal(shipName);
                return;
            }
            const skillItem = e.target.closest('[data-skill-url]');
            if (skillItem) {
                window.location.href = skillItem.dataset.skillUrl;
            }
        });
        detailDelegatedClickWired = true;
    }

    // Reinitialize tooltip functionality for dynamically loaded content
    if (typeof setupTooltipToggles === 'function') {
        setupTooltipToggles();
    }
}

// ===== Gift & Stats Sections =====

/**
 * Generate icon chips for the gift preference display.
 * Gift IDs 180001–180009; liked = all gifts NOT in the disliked set.
 * The 'type' parameter controls which set is rendered, not which icons are "liked".
 */
function generateGiftIcons(dislikedGifts, type) {
    // IDs run from 180001 to 180009
    const allGiftIds = Array.from({ length: 9 }, (_, i) => 180001 + i);
    const dislikedSet = new Set(dislikedGifts || []);
    const baseUrl = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/props/';

    let targetGiftIds;

    // Determine which set of gifts to display based on the 'type' parameter
    if (type === 'liked') {
        // Liked gifts are all gifts that are NOT in the disliked set
        targetGiftIds = allGiftIds.filter(id => !dislikedSet.has(id));
    } else { // type === 'disliked'
        // Disliked gifts are simply the ones provided in the list
        targetGiftIds = [...dislikedSet];
    }

    // If there are no gifts in the target list, display a message
    if (targetGiftIds.length === 0) {
        return '<span class="no-gifts" style="color: var(--text-secondary);">없음</span>';
    }

    // Generate the HTML for each gift icon
    return targetGiftIds.map(giftId => {
        // Extract the last two digits from the ID to build the filename (e.g., 180005 -> 05)
        const fileNumber = String(giftId).slice(-2);
        const imageUrl = `${baseUrl}gift${fileNumber}.webp`;

        // Return the HTML for a single gift icon, now using an <img> tag
        return `
            <div class="gift-icon ${type}" data-gift-id="${giftId}">
                <img src="${imageUrl}" alt="Gift ${fileNumber}" title="선물 ID: ${giftId}" style="width: 100%; height: 100%;">
            </div>
        `;
    }).join('');
}

/**
 * Recompute and re-render all stat cells from the current slider/select values.
 * Formula: floor((base + growth*(level-1)/1000 + enhance) * favorabilityBonus)
 * Speed and luck are unaffected by the affinity bonus.
 */
function updateStats() {
    if (!state.currentShip) return;

    const statsGrid = document.getElementById('statsGrid');
    if (!statsGrid) return;

    const baseStats = state.currentShip.base[state.currentLimitBreak] || {};
    const growthStats = state.currentShip.growth[state.currentLimitBreak] || {};
    // Enhance is NOT organized by limit break - it's a flat object
    const enhanceStats = state.currentShip.enhance || {};

    const favorabilityBonus = FAVORABILITY_BONUSES[state.currentFavorability] || 1.06;
    const attrMapping = createAttrMapping();

    statsGrid.innerHTML = Object.keys(baseStats).map(stat => {
        const base = baseStats[stat] || 0;
        const growth = growthStats[stat] || 0;
        const enhanceValue = enhanceStats[stat] || 0;
        const enhance = state.currentEnhancement === 'complete' ? enhanceValue : 0;

        const bonus = UNAFFECTED_STATS.includes(stat.toLowerCase()) ? 1.0 : favorabilityBonus;
        const calculated = Math.floor((base + (growth * (state.currentLevel - 1) / 1000) + enhance) * bonus);

        const attrInfo = attrMapping[stat.toLowerCase()] || {};
        const koreanName = attrInfo.condition || stat;
        const icon = attrInfo.icon || '';

        return `
            <div class="stat-item">
                <div class="stat-name">
                    ${icon ? `<img src="${icon}" alt="${koreanName}" style="height: 20px; vertical-align: middle; margin-right: 5px;">` : ''}
                    ${koreanName}
                </div>
                <div class="stat-values">
                    <span class="stat-calculated">${calculated}</span>
                    <div class="stat-breakdown">
                        <span class="stat-base">기본 ${base}</span>
                        <span class="stat-separator">|</span>
                        <span class="stat-growth">성장 ${growth}</span>
                        ${enhance ? `<span class="stat-enhance">강화 ${enhance}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}
