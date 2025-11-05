/**
 * Island Character Module
 * Handles character data loading, rendering, stats calculation, and search
 */

window.CharacterModule = (function () {
    'use strict';

    // ============================================
    // STATE
    // ============================================
    const state = {
        characters: {},
        attRankings: {},
        attRankingsArray: [],
        levelData: {},
        selectedCharacterId: null,
        selectedLevel: 1,
        selectedEnhancement: 0, // 0 = no enhancement, 1 = 1st enhancement, 2 = 2nd enhancement
        selectedSkillLevel: 1, // Skill level 1-10
        fuseInstance: null,
        items: {} // Item data from island_item_data_template.json
    };

    // ============================================
    // DATA LOADING
    // ============================================

    async function init(sharedData) {
        try {
            console.log('[Island Character] Initializing module...');

            // Use shared item data instead of loading again
            if (sharedData && sharedData.items) {
                state.items = sharedData.items;
                console.log('[Island Character] Using shared item data');
            }

            // Load module-specific data in parallel
            const [charactersData, attData, levelData] = await Promise.all([
                IslandEngine.fetchJSON('data/island/characters.json'),
                IslandEngine.fetchJSON('data/island/island_chara_att.json'),
                IslandEngine.fetchJSON('data/island/island_chara_level.json')
            ]);

            state.characters = charactersData;
            state.attRankings = attData;
            state.levelData = levelData;

            // Convert rankings to sorted array for easy lookup
            state.attRankingsArray = Object.values(attData)
                .filter(rank => rank.id) // Filter out the "all" entry
                .sort((a, b) => b.range[0] - a.range[0]); // Sort by range descending

            console.log(`[Island Character] Loaded ${Object.keys(state.characters).length} characters`);

            // Initialize search
            initializeSearch();

            // Render character list
            renderCharacterList();

            return true;
        } catch (error) {
            console.error('[Island Character] Failed to initialize:', error);
            IslandEngine.showError('캐릭터 데이터를 불러오는데 실패했습니다. 페이지를 새로고침해주세요.');
            throw error;
        }
    }

    // ============================================
    // SEARCH FUNCTIONALITY
    // ============================================

    /**
     * Initialize Fuse.js search
     */
    function initializeSearch() {
        const searchableData = Object.values(state.characters).map(char => ({
            id: char.id,
            name: char.name
        }));

        state.fuseInstance = IslandEngine.createSearchIndex(searchableData, {
            keys: ['name'],
            threshold: 0.3,
            includeScore: true
        });

        console.log('[Island Character] Search initialized');
    }

    /**
     * Filter characters based on search query
     */
    function searchCharacters(query) {
        if (!query || query.trim() === '') {
            return Object.values(state.characters);
        }

        const results = state.fuseInstance.search(query);
        return results.map(result => state.characters[result.item.id]);
    }

    // ============================================
    // CHARACTER LIST RENDERING
    // ============================================

    /**
     * Render the character list with cards
     */
    function renderCharacterList(characters = null) {
        const container = document.getElementById('character-list');
        if (!container) return;

        const charList = characters || Object.values(state.characters);

        if (charList.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-outlined">person_off</span>
                    <p>캐릭터를 찾을 수 없습니다</p>
                </div>
            `;
            return;
        }

        container.innerHTML = charList
            .map(char => createCharacterCard(char))
            .join('');

        // Attach click handlers
        container.querySelectorAll('.character-card').forEach(card => {
            card.addEventListener('click', () => {
                const charId = card.dataset.charId;
                selectCharacter(charId);
            });
        });
    }

    /**
     * Create HTML for a character card
     */
    function createCharacterCard(char) {
        const portraitUrl = char.chara_pic && char.chara_pic !== 'aabbcc'
            ? `https://raw.githubusercontent.com/Fernando2603/AzurLane/main/portrait/${char.chara_pic}.png`
            : '';

        const isSelected = state.selectedCharacterId === String(char.id);

        return `
            <div class="character-card ${isSelected ? 'selected' : ''}" data-char-id="${char.id}">
                <div class="character-card-portrait">
                    ${portraitUrl ? `<img src="${portraitUrl}" alt="${char.name}" onerror="this.style.display='none'">` : ''}
                </div>
                <div class="character-card-info">
                    <h4 class="character-card-name">${char.name}</h4>
                    <p class="character-card-power">
                        <span class="material-symbols-outlined">bolt</span>
                        ${char.power}
                    </p>
                </div>
            </div>
        `;
    }

    // ============================================
    // CHARACTER SELECTION & DETAIL
    // ============================================

    /**
     * Select a character and show details
     */
    function selectCharacter(charId) {
        state.selectedCharacterId = String(charId);
        state.selectedLevel = 1; // Reset to level 1
        state.selectedEnhancement = 0; // Reset to no enhancement
        state.selectedSkillLevel = 1; // Reset to skill level 1

        // Update card selection visuals
        document.querySelectorAll('.character-card').forEach(card => {
            card.classList.toggle('selected', card.dataset.charId === charId);
        });

        // Render detail panel
        renderCharacterDetail();
    }

    /**
     * Render the character detail panel
     */
    function renderCharacterDetail() {
        const container = document.getElementById('character-detail');
        if (!container) return;

        const char = state.characters[state.selectedCharacterId];
        if (!char) {
            container.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-outlined">person_search</span>
                    <h3>캐릭터를 선택하세요</h3>
                    <p>목록에서 캐릭터를 선택하여 상세 정보를 확인하세요.</p>
                </div>
            `;
            return;
        }

        const portraitUrl = char.chara_pic && char.chara_pic !== 'aabbcc'
            ? `https://raw.githubusercontent.com/Fernando2603/AzurLane/main/portrait/${char.chara_pic}.png`
            : '';

        const currentPower = calculatePower(char, state.selectedLevel);

        container.innerHTML = `
            <div class="detail-header">
                <div class="detail-portrait">
                    ${portraitUrl ? `<img src="${portraitUrl}" alt="${char.name}" onerror="this.style.display='none'">` : ''}
                </div>
                <div class="detail-info">
                    <h2 class="detail-name">${char.name}</h2>
                    <div class="detail-stats-row">
                        <div class="detail-stat">
                            <span class="material-symbols-outlined">bolt</span>
                            <span>행동력: <strong id="power-display">${currentPower}</strong></span>
                        </div>
                        <div class="detail-stat">
                            <span class="material-symbols-outlined">autorenew</span>
                            <span>회복: <strong>${char.power_recover}</strong></span>
                        </div>
                    </div>
                </div>
            </div>

            ${renderLevelCalculator(char)}
            ${renderStatsSection(char)}
            ${renderSkillSection(char)}
            ${renderSkinSection(char)}
        `;

        // Attach level slider handler
        const slider = container.querySelector('.level-slider');
        if (slider) {
            slider.addEventListener('input', (e) => {
                state.selectedLevel = parseInt(e.target.value);
                updateStatsDisplay(char);
                updateLevelDisplay();
                updateSkillDisplay(char);
                updatePowerDisplay(char);
            });
        }

        // Attach enhancement button handlers
        const enhancementButtons = container.querySelectorAll('.enhancement-btn');
        enhancementButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                state.selectedEnhancement = parseInt(btn.dataset.enhancement);
                updateEnhancementDisplay();
                updateStatsDisplay(char);
            });
        });

        // Attach help icon handler
        const helpIcon = container.querySelector('#stats-help-icon');
        const helpTooltip = container.querySelector('#stats-help-tooltip');
        if (helpIcon && helpTooltip) {
            helpIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                helpTooltip.classList.toggle('visible');
            });

            // Close tooltip when clicking outside
            document.addEventListener('click', (e) => {
                if (!helpIcon.contains(e.target) && !helpTooltip.contains(e.target)) {
                    helpTooltip.classList.remove('visible');
                }
            });
        }

        // Attach skill level button handlers
        const skillLevelButtons = container.querySelectorAll('.skill-level-btn');
        skillLevelButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                state.selectedSkillLevel = parseInt(btn.dataset.skillLevel);
                updateSkillDisplay(char);
            });
        });
    }

    /**
     * Render level calculator section
     */
    function renderLevelCalculator(char) {
        const limitBreak = Math.min(Math.floor((state.selectedLevel - 1) / 10), 4);
        const expRequired = getExpForNextLevel(state.selectedLevel);
        const hasEnhancement = char.extra_max && char.extra_max.length > 0;

        return `
            <div class="detail-section">
                <h3>
                    <span class="material-symbols-outlined">equalizer</span>
                    레벨 계산기
                </h3>
                <div class="level-calculator">
                    <div class="level-slider-container">
                        <div class="level-slider-label">
                            <div class="level-info-group">
                                <div class="level-display-item">
                                    <span>레벨</span>
                                    <strong id="level-display">${state.selectedLevel}</strong>
                                </div>
                                <div class="exp-display" id="exp-display">
                                    ${expRequired > 0 ? `
                                        <span class="exp-label">다음 레벨까지</span>
                                        <span class="exp-value">${expRequired.toLocaleString()} EXP</span>
                                    ` : '<span class="exp-max">최대 레벨</span>'}
                                </div>
                            </div>
                            <div class="limit-break-indicator">
                                <span class="limit-break-label">한계돌파</span>
                                <strong id="limit-break-display" class="limit-break-value">${limitBreak}</strong>
                            </div>
                        </div>
                        <input type="range"
                               class="level-slider"
                               min="1"
                               max="50"
                               value="${state.selectedLevel}">
                    </div>
                    ${hasEnhancement ? `
                        <div class="enhancement-selector">
                            <label class="enhancement-label">강화 단계</label>
                            <div class="enhancement-buttons">
                                <button class="enhancement-btn ${state.selectedEnhancement === 0 ? 'active' : ''}" data-enhancement="0">
                                    강화 X
                                </button>
                                <button class="enhancement-btn ${state.selectedEnhancement === 1 ? 'active' : ''}" data-enhancement="1">
                                    1차 강화
                                </button>
                                <button class="enhancement-btn ${state.selectedEnhancement === 2 ? 'active' : ''}" data-enhancement="2">
                                    2차 강화
                                </button>
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    /**
     * Render stats section
     */
    function renderStatsSection(char) {
        const attributeNames = [
            '농업',
            '채집',
            '축산',
            '요리',
            '관리',
            '제조'
        ];

        const enhancementLabels = ['', ' + 1차 강화', ' + 2차 강화'];
        const enhancementLabel = state.selectedEnhancement > 0 ? enhancementLabels[state.selectedEnhancement] : '';

        const statsRows = char.base_att.map((baseStat, index) => {
            const attrId = baseStat[0];
            const baseValue = baseStat[1];
            const growthRates = char.growth_att[index][1];
            const levelValue = calculateStatValue(baseValue, growthRates, state.selectedLevel);
            const enhancementBonus = getEnhancementBonus(char, attrId, state.selectedEnhancement);
            const currentValue = levelValue + enhancementBonus;
            const rank = getStatRank(currentValue);

            return `
                <tr>
                    <td class="attr-name-cell">${attributeNames[index] || `속성 ${attrId}`}</td>
                    <td class="stat-cell">
                        <span class="stat-value current-stat" id="stat-${index}">
                            ${levelValue}${enhancementBonus > 0 ? `<span class="enhancement-bonus"> +${enhancementBonus}</span>` : ''}
                        </span>
                    </td>
                    <td class="rank-cell">
                        <span class="rank-badge rank-${rank.name.toLowerCase()}" id="rank-${index}">${rank.name}</span>
                    </td>
                    <td class="stat-cell">
                        <span class="stat-value base-stat">${baseValue}</span>
                    </td>
                    <td class="growth-rates-cell" id="growth-${index}">${formatGrowthRates(growthRates, state.selectedLevel)}</td>
                </tr>
            `;
        }).join('');

        return `
            <div class="detail-section">
                <h3>
                    <span class="material-symbols-outlined">analytics</span>
                    <span class="title-with-help">
                        캐릭터 스탯
                        <span class="help-icon" id="stats-help-icon">
                            <span class="material-symbols-outlined">help</span>
                        </span>
                    </span>
                </h3>
                <div class="help-tooltip" id="stats-help-tooltip">
                    <p><strong>스탯 설명</strong></p>
                    <p>• <strong>기본값 (Lv.0)</strong>: 레벨 0에서의 기본 스탯</p>
                    <p>• <strong>스탯</strong>: 선택한 레벨 + 강화 단계의 최종 스탯</p>
                    <p>• <strong>등급</strong>: 스탯 값에 따른 랭크 (SSS ~ E)</p>
                    <p>• <strong>성장률</strong>: 각 한계돌파 단계별 레벨당 증가량</p>
                    <p>• <strong>강화</strong>: 추가 스탯 보너스 (1차/2차 강화)</p>
                </div>
                <table class="stats-table">
                    <thead>
                        <tr>
                            <th>속성</th>
                            <th>스탯 (레벨 ${state.selectedLevel}${enhancementLabel})</th>
                            <th>등급</th>
                            <th>기본값 (Lv.0)</th>
                            <th>성장률 (한계돌파 0→4)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${statsRows}
                    </tbody>
                </table>
            </div>
        `;
    }

    // ============================================
    // CALCULATION FUNCTIONS
    // ============================================

    /**
     * Calculate stat value at a given level
     * Base value is treated as level 0
     * Growth rates correspond to limit break (한계돌파) levels:
     * - Index 0: 한계돌파 0 (levels 1-10)
     * - Index 1: 한계돌파 1 (levels 11-20)
     * - Index 2: 한계돌파 2 (levels 21-30)
     * - Index 3: 한계돌파 3 (levels 31-40)
     * - Index 4: 한계돌파 4 (levels 41-50)
     */
    function calculateStatValue(baseValue, growthRates, level) {
        let value = baseValue;
        const levelRanges = [10, 20, 30, 40, 50];

        for (let i = 0; i < levelRanges.length; i++) {
            const rangeEnd = levelRanges[i];
            const rangeStart = i === 0 ? 0 : levelRanges[i - 1];
            const growthRate = growthRates[i];

            if (level > rangeEnd) {
                // Full range
                value += (rangeEnd - rangeStart) * growthRate;
            } else if (level > rangeStart) {
                // Partial range
                value += (level - rangeStart) * growthRate;
                break;
            } else {
                break;
            }
        }

        return Math.round(value);
    }

    /**
     * Get rank badge for a stat value
     */
    function getStatRank(statValue) {
        for (const rank of state.attRankingsArray) {
            if (statValue >= rank.range[0] && statValue <= rank.range[1]) {
                return rank;
            }
        }
        // Default to lowest rank if not found
        return state.attRankingsArray[state.attRankingsArray.length - 1] || { name: 'E', id: 8 };
    }

    /**
     * Get EXP required for next level
     */
    function getExpForNextLevel(currentLevel) {
        if (currentLevel >= 50) {
            return 0; // Max level
        }
        const levelData = state.levelData[String(currentLevel)];
        return levelData ? levelData.level_up_exp : 0;
    }

    /**
     * Calculate power value at a given level
     * Power increases based on upgrade_power array corresponding to limit break levels
     */
    function calculatePower(char, level) {
        let power = char.power;

        if (char.upgrade_power && char.upgrade_power.length > 0) {
            const limitBreak = Math.min(Math.floor((level - 1) / 10), 4);

            // Add all upgrade power values up to current limit break
            for (let i = 0; i <= limitBreak; i++) {
                if (char.upgrade_power[i]) {
                    power += char.upgrade_power[i];
                }
            }
        }

        return power;
    }

    /**
     * Get enhancement bonus for a specific stat attribute
     * @param {Object} char - Character object
     * @param {number} attrId - Attribute ID (1-6)
     * @param {number} enhancement - Enhancement level (0, 1, or 2)
     * @returns {number} Enhancement bonus value
     */
    function getEnhancementBonus(char, attrId, enhancement) {
        if (enhancement === 0 || !char.extra_max || char.extra_max.length === 0) {
            return 0;
        }

        // Find the extra_max entry for this attribute
        const extraEntry = char.extra_max.find(entry => entry[0] === attrId);
        if (!extraEntry || !extraEntry[1]) {
            return 0;
        }

        // extraEntry[1] is [first_limit, second_limit]
        const limits = extraEntry[1];

        if (enhancement === 1) {
            return limits[0] || 0;
        } else if (enhancement === 2) {
            // Second enhancement is flat value, not cumulative
            return limits[1] || 0;
        }

        return 0;
    }

    /**
     * Format growth rates for display with highlight on current limit break
     */
    function formatGrowthRates(rates, currentLevel) {
        const limitBreak = Math.min(Math.floor((currentLevel - 1) / 10), 4);

        return rates.map((rate, index) => {
            const value = rate.toFixed(1);
            if (index === limitBreak) {
                return `<span class="growth-rate-active">${value}</span>`;
            }
            return `<span class="growth-rate">${value}</span>`;
        }).join(' <span class="growth-separator">/</span> ');
    }

    // ============================================
    // UPDATE FUNCTIONS
    // ============================================

    /**
     * Update stats display when level or enhancement changes
     */
    function updateStatsDisplay(char) {
        const enhancementLabels = ['', ' + 1차 강화', ' + 2차 강화'];
        const enhancementLabel = state.selectedEnhancement > 0 ? enhancementLabels[state.selectedEnhancement] : '';

        char.base_att.forEach((baseStat, index) => {
            const attrId = baseStat[0];
            const baseValue = baseStat[1];
            const growthRates = char.growth_att[index][1];
            const levelValue = calculateStatValue(baseValue, growthRates, state.selectedLevel);
            const enhancementBonus = getEnhancementBonus(char, attrId, state.selectedEnhancement);
            const currentValue = levelValue + enhancementBonus;
            const rank = getStatRank(currentValue);

            // Update stat value with enhancement bonus
            const statElement = document.getElementById(`stat-${index}`);
            if (statElement) {
                if (enhancementBonus > 0) {
                    statElement.innerHTML = `${levelValue}<span class="enhancement-bonus"> +${enhancementBonus}</span>`;
                } else {
                    statElement.textContent = levelValue;
                }
                // Add flash animation
                statElement.style.animation = 'none';
                setTimeout(() => {
                    statElement.style.animation = 'flash 0.3s ease';
                }, 10);
            }

            // Update rank badge
            const rankElement = document.getElementById(`rank-${index}`);
            if (rankElement) {
                // Remove all rank classes
                rankElement.className = 'rank-badge';
                // Add new rank class
                rankElement.classList.add(`rank-${rank.name.toLowerCase()}`);
                rankElement.textContent = rank.name;
                // Add bounce animation
                rankElement.style.animation = 'none';
                setTimeout(() => {
                    rankElement.style.animation = 'bounce 0.4s ease';
                }, 10);
            }

            // Update growth rates with new highlight
            const growthElement = document.getElementById(`growth-${index}`);
            if (growthElement) {
                growthElement.innerHTML = formatGrowthRates(growthRates, state.selectedLevel);
            }
        });

        // Update table header for current stat column
        const statHeader = document.querySelector('.stats-table thead th:nth-child(2)');
        if (statHeader) {
            statHeader.textContent = `스탯 (레벨 ${state.selectedLevel}${enhancementLabel})`;
        }
    }

    /**
     * Update level and limit break display
     */
    function updateLevelDisplay() {
        const levelDisplay = document.getElementById('level-display');
        if (levelDisplay) {
            levelDisplay.textContent = state.selectedLevel;
        }

        const limitBreak = Math.min(Math.floor((state.selectedLevel - 1) / 10), 4);
        const limitBreakDisplay = document.getElementById('limit-break-display');
        if (limitBreakDisplay) {
            limitBreakDisplay.textContent = limitBreak;
            // Add pulse animation
            limitBreakDisplay.style.animation = 'none';
            setTimeout(() => {
                limitBreakDisplay.style.animation = 'pulse 0.3s ease';
            }, 10);
        }

        // Update exp display
        const expDisplay = document.getElementById('exp-display');
        if (expDisplay) {
            const expRequired = getExpForNextLevel(state.selectedLevel);
            if (expRequired > 0) {
                expDisplay.innerHTML = `
                    <span class="exp-label">다음 레벨까지</span>
                    <span class="exp-value">${expRequired.toLocaleString()} EXP</span>
                `;
            } else {
                expDisplay.innerHTML = '<span class="exp-max">최대 레벨</span>';
            }
        }
    }

    /**
     * Update power display
     */
    function updatePowerDisplay(char) {
        const powerDisplay = document.getElementById('power-display');
        if (powerDisplay) {
            const currentPower = calculatePower(char, state.selectedLevel);
            powerDisplay.textContent = currentPower;
            // Add flash animation
            powerDisplay.style.animation = 'none';
            setTimeout(() => {
                powerDisplay.style.animation = 'flash 0.3s ease';
            }, 10);
        }
    }

    /**
     * Update enhancement button display
     */
    function updateEnhancementDisplay() {
        const enhancementButtons = document.querySelectorAll('.enhancement-btn');
        enhancementButtons.forEach(btn => {
            const enhancement = parseInt(btn.dataset.enhancement);
            btn.classList.toggle('active', enhancement === state.selectedEnhancement);
        });
    }

    // ============================================
    // SKILL SECTION
    // ============================================

    /**
     * Render skill section
     */
    function renderSkillSection(char) {
        if (!char.skill_id || typeof char.skill_id !== 'object') {
            return `
                <div class="detail-section">
                    <h3>
                        <span class="material-symbols-outlined">psychology</span>
                        캐릭터 스킬
                    </h3>
                    <p style="color: var(--island-text-tertiary); font-style: italic;">스킬 정보가 없습니다</p>
                </div>
            `;
        }

        const skill = char.skill_id;
        const iconUrl = skill.icon
            ? `https://raw.githubusercontent.com/Fernando2603/AzurLane/main/skillicon/${skill.icon}.png`
            : '';

        // Get current skill level value (1-10, index 0-9)
        const skillLevelIndex = state.selectedSkillLevel - 1;
        const currentBonus = skill.desc_add && skill.desc_add[0] && skill.desc_add[0][skillLevelIndex]
            ? skill.desc_add[0][skillLevelIndex][0]
            : '?';

        const description = skill.desc.replace('$1', `<strong>${currentBonus}</strong>`);

        // Get material for current skill level
        const currentMaterial = skill.material && skill.material[skillLevelIndex]
            ? skill.material[skillLevelIndex]
            : null;

        // Create 10 skill level buttons
        const hasSkillLevels = skill.desc_add && skill.desc_add[0] && skill.desc_add[0].length > 0;
        const skillLevelButtons = hasSkillLevels
            ? Array.from({ length: 10 }, (_, index) => {
                const level = index + 1;
                const isActive = level === state.selectedSkillLevel;
                return `
                    <button class="skill-level-btn ${isActive ? 'active' : ''}" data-skill-level="${level}">
                        ${level}
                    </button>
                `;
            }).join('')
            : '';

        return `
            <div class="detail-section">
                <h3>
                    <span class="material-symbols-outlined">psychology</span>
                    캐릭터 스킬
                </h3>
                <div class="skill-card">
                    <div class="skill-header">
                        ${iconUrl ? `
                            <div class="skill-icon">
                                <img src="${iconUrl}" alt="스킬 아이콘" onerror="this.parentElement.style.display='none'">
                            </div>
                        ` : ''}
                        <div>
                            <h4 class="skill-title">${skill.name || '특수 능력'}</h4>
                            <p class="skill-level-label">레벨 <span id="current-skill-level">${state.selectedSkillLevel}</span></p>
                        </div>
                    </div>
                    <p class="skill-description" id="skill-description">${description}</p>
                    ${skillLevelButtons ? `
                        <div class="skill-level-selector">
                            <label class="skill-level-selector-label">스킬 레벨</label>
                            <div class="skill-level-buttons" id="skill-level-buttons">
                                ${skillLevelButtons}
                            </div>
                        </div>
                    ` : ''}
                    ${currentMaterial ? renderSkillMaterial(currentMaterial) : ''}
                </div>
            </div>
        `;
    }

    /**
     * Update skill display when skill level changes
     */
    function updateSkillDisplay(char) {
        if (!char.skill_id || typeof char.skill_id !== 'object') return;

        const skill = char.skill_id;
        const skillLevelIndex = state.selectedSkillLevel - 1;

        // Update active button
        const buttons = document.querySelectorAll('.skill-level-btn');
        buttons.forEach((button, index) => {
            button.classList.toggle('active', (index + 1) === state.selectedSkillLevel);
        });

        // Update skill level display
        const skillLevelDisplay = document.getElementById('current-skill-level');
        if (skillLevelDisplay) {
            skillLevelDisplay.textContent = state.selectedSkillLevel;
        }

        // Update description
        const currentBonus = skill.desc_add && skill.desc_add[0] && skill.desc_add[0][skillLevelIndex]
            ? skill.desc_add[0][skillLevelIndex][0]
            : '?';
        const description = skill.desc.replace('$1', `<strong>${currentBonus}</strong>`);

        const descElement = document.getElementById('skill-description');
        if (descElement) {
            descElement.innerHTML = description;
        }

        // Update material
        const currentMaterial = skill.material && skill.material[skillLevelIndex]
            ? skill.material[skillLevelIndex]
            : null;

        const materialContainer = document.getElementById('skill-material');
        if (materialContainer) {
            if (currentMaterial) {
                materialContainer.outerHTML = renderSkillMaterial(currentMaterial);
            } else {
                materialContainer.style.display = 'none';
            }
        }
    }

    // ============================================
    // SKIN SECTION
    // ============================================

    /**
     * Render skin section
     */
    function renderSkinSection(char) {
        if (!char.skin || char.skin.length === 0) {
            return `
                <div class="detail-section">
                    <h3>
                        <span class="material-symbols-outlined">checkroom</span>
                        캐릭터 스킨
                    </h3>
                    <p style="color: var(--island-text-tertiary); font-style: italic;">사용 가능한 스킨이 없습니다</p>
                </div>
            `;
        }

        const skinCards = char.skin.map(skin => {
            const iconUrl = skin.icon_normal
                ? `https://raw.githubusercontent.com/JforPlay/data_for_toy/main/${skin.icon_normal}.png`
                : '';

            return `
                <div class="skin-card">
                    <div class="skin-thumbnail">
                        ${iconUrl ? `<img src="${iconUrl}" alt="${skin.name}" onerror="this.style.opacity='0.3'">` : ''}
                    </div>
                    <div class="skin-info">
                        <h5 class="skin-name">${skin.name}</h5>
                        <p class="skin-description">${skin.desc || '설명이 없습니다'}</p>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="detail-section">
                <h3>
                    <span class="material-symbols-outlined">checkroom</span>
                    캐릭터 스킨
                </h3>
                <div class="skin-gallery">
                    ${skinCards}
                </div>
            </div>
        `;
    }

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================

    /**
     * Render skill material with item data
     */
    function renderSkillMaterial(material) {
        // Ensure we have valid material data
        if (!material || !Array.isArray(material) || material.length === 0) {
            return '';
        }

        // Material structure is [[itemId, quantity]] - array containing one array
        const innerArray = material[0];
        if (!Array.isArray(innerArray) || innerArray.length < 2) {
            return '';
        }

        const itemId = innerArray[0];
        const quantity = innerArray[1];
        const item = IslandEngine.getItemInfo(itemId);

        return `
            <div class="skill-material" id="skill-material">
                <label class="skill-material-label">
                    <span class="material-symbols-outlined">construction</span>
                    레벨업 재료
                </label>
                <div class="skill-material-item">
                    <div class="skill-material-icon">
                        ${item.icon ? `<div class="icon-placeholder">🎁</div>` : '<div class="icon-placeholder">📦</div>'}
                    </div>
                    <div class="skill-material-info">
                        <div class="skill-material-name">${item.name}</div>
                        <div class="skill-material-quantity">×${quantity}</div>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================
    // PUBLIC API
    // ============================================

    return {
        init: init,
        searchCharacters: searchCharacters,
        renderCharacterList: renderCharacterList,
        selectCharacter: selectCharacter,
        getState: () => state // For debugging
    };

})();

// Add animations to global styles
const characterModuleStyle = document.createElement('style');
characterModuleStyle.textContent = `
    @keyframes flash {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; transform: scale(1.1); }
    }

    @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.15); }
    }

    @keyframes bounce {
        0%, 100% { transform: translateY(0); }
        25% { transform: translateY(-6px); }
        50% { transform: translateY(0); }
        75% { transform: translateY(-3px); }
    }
`;
document.head.appendChild(characterModuleStyle);
