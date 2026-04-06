/**
 * island.quest.engine.js
 * Quest sub-engine for the island module. Loads task data, groups quests by type,
 * and provides a filterable list with a detail panel. Registers as window.QuestModule.
 */

import { fetchJSON } from '../utils.js';

'use strict';

// ===== State =====
const state = {
    allQuests: [],
    groupedQuests: {},
    selectedQuest: null,
    activeFilter: 'all',
    searchQuery: '',
    isLoading: true
};

// Quest type mapping (Korean) - UPDATED
const QUEST_TYPES = {
    'all': '전체 퀘스트',
    '1': '메인 퀘스트',
    '2': '서브 퀘스트',
    '3': '일일 퀘스트',
    '4': '주간 퀘스트',
    '5': '이벤트 서브 퀘스트',
    '6': '이벤트 일일 퀘스트',
    '7': '이벤트 주간 퀘스트',
    '8': '시즌제 퀘스트',
    '9': '히든 퀘스트'
};

// Quest type icons
const QUEST_TYPE_ICONS = {
    '1': 'campaign',
    '2': 'task',
    '3': 'today',
    '4': 'date_range',
    '5': 'event',
    '6': 'event_available',
    '7': 'event_repeat',
    '8': 'calendar_month',
    '9': 'mystery'
};

// Quest type colors (for badges)
const QUEST_TYPE_COLORS = {
    '1': '#FF6B6B', // Red - Main
    '2': '#4ECDC4', // Teal - Sub
    '3': '#95E1D3', // Light Teal - Daily
    '4': '#F38181', // Pink - Weekly
    '5': '#AA96DA', // Purple - Event Sub
    '6': '#FCBAD3', // Light Pink - Event Daily
    '7': '#FFFFD2', // Yellow - Event Weekly
    '8': '#A8D8EA', // Blue - Seasonal
    '9': '#FFE66D'  // Gold - Hidden
};

// ===== Initialization =====

/**
 * Initialize quest module
 */
async function init(sharedData) {
    console.log('[Quest Module] Initializing...');

    try {
        await loadQuestData();
        groupQuestsByType();
        renderQuestFilter();
        renderQuestList(state.allQuests);
        setupEventListeners();

        state.isLoading = false;
        console.log('[Quest Module] Initialization complete');
    } catch (error) {
        console.error('[Quest Module] Initialization failed:', error);
        window.IslandEngine.showError('퀘스트 데이터를 불러오는데 실패했습니다.');
    }
}

/**
 * Load quest data from JSON
 */
async function loadQuestData() {
    console.log('[Quest Module] Loading quest data...');

    const tasksData = await fetchJSON('data/island/tasks.json');

    // Convert tasks object to array with IDs
    state.allQuests = Object.entries(tasksData).map(([id, quest]) => ({
        id,
        type: quest.type ? String(quest.type) : '1', // Default to main quest
        series: quest.series || '',
        series_name: quest.series_name || '',
        name: quest.name || `퀘스트 ${id}`,
        task_desc: quest.task_desc || '',
        unlock_condition: quest.unlock_condition || [],
        unlock_time: quest.unlock_time || 'always',
        // Parse target_id as an object
        target: quest.target_id ? {
            id: quest.target_id.id || '',
            name: quest.target_id.name || '',
            target_num: quest.target_id.target_num || 0,
            target_param: quest.target_id.target_param || '',
            tips: quest.target_id.tips || '',
            type: quest.target_id.type || 0
        } : null,
        // Store raw data for debugging
        raw: quest
    }));

    console.log(`[Quest Module] Loaded ${state.allQuests.length} quests`);
}

/**
 * Group quests by type
 */
function groupQuestsByType() {
    state.groupedQuests = {};

    state.allQuests.forEach(quest => {
        const type = quest.type;
        if (!state.groupedQuests[type]) {
            state.groupedQuests[type] = [];
        }
        state.groupedQuests[type].push(quest);
    });

    console.log('[Quest Module] Grouped quests:', state.groupedQuests);
}

// ===== Event Listeners =====

function setupEventListeners() {
    // Search functionality
    const searchInput = document.getElementById('quest-search');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                state.searchQuery = e.target.value.toLowerCase();
                filterAndRenderQuests();
            }, 300);
        });
    }

    // Event delegation for quest filter and dropdown
    const filterContainer = document.getElementById('quest-type-filter');
    if (filterContainer) {
        filterContainer.addEventListener('click', (e) => {
            // Handle dropdown toggle
            if (e.target.closest('#quest-type-dropdown')) {
                e.stopPropagation();
                const dropdownMenu = document.getElementById('quest-type-menu');
                if (dropdownMenu) {
                    dropdownMenu.classList.toggle('visible');
                }
                return;
            }

            // Handle quest type option selection
            const option = e.target.closest('.quest-type-option');
            if (option) {
                e.stopPropagation();
                setFilter(option.dataset.type);
                return;
            }
        });
    }

    // Event delegation for quest card clicks
    const questList = document.getElementById('quest-list');
    if (questList) {
        questList.addEventListener('click', (e) => {
            const questCard = e.target.closest('.quest-card');
            if (questCard) {
                const questId = questCard.dataset.questId;
                selectQuest(questId);
            }
        });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const dropdownMenu = document.getElementById('quest-type-menu');
        const dropdown = document.getElementById('quest-type-dropdown');

        if (dropdownMenu && dropdown &&
            dropdownMenu.classList.contains('visible') &&
            !dropdown.contains(e.target) &&
            !dropdownMenu.contains(e.target)) {
            dropdownMenu.classList.remove('visible');
        }
    });

    console.log('[Quest Module] Event delegation set up');
}

// ===== Filtering =====

/**
 * Filter quests by type and search query
 */
function filterAndRenderQuests() {
    let filtered = state.allQuests;

    // Filter by type
    if (state.activeFilter !== 'all') {
        filtered = filtered.filter(q => q.type === state.activeFilter);
    }

    // Filter by search query
    if (state.searchQuery) {
        filtered = filtered.filter(q => {
            const searchText = `${q.name} ${q.task_desc} ${q.series_name}`.toLowerCase();
            return searchText.includes(state.searchQuery);
        });
    }

    renderQuestList(filtered);
}

/**
 * Set active filter
 */
function setFilter(type) {
    state.activeFilter = type;

    // Update dropdown display
    const dropdown = document.getElementById('quest-type-dropdown');
    if (dropdown) {
        const displayText = dropdown.querySelector('.dropdown-text');
        const icon = dropdown.querySelector('.material-symbols-outlined');

        displayText.textContent = QUEST_TYPES[type] || `타입 ${type}`;
        icon.textContent = QUEST_TYPE_ICONS[type] || 'filter_list';
    }

    // Update menu item states
    document.querySelectorAll('.quest-type-option').forEach(option => {
        option.classList.toggle('active', option.dataset.type === type);
    });

    // Close dropdown
    const dropdownMenu = document.getElementById('quest-type-menu');
    if (dropdownMenu) {
        dropdownMenu.classList.remove('visible');
    }

    filterAndRenderQuests();
    console.log(`[Quest Module] Filter set to: ${type}`);
}

// ===== Rendering =====

/**
 * Render quest filter dropdown
 */
function renderQuestFilter() {
    const container = document.getElementById('quest-type-filter');
    if (!container) return;

    const types = ['all', ...Object.keys(state.groupedQuests).sort((a, b) => parseInt(a) - parseInt(b))];

    const html = `
        <button class="quest-type-dropdown" id="quest-type-dropdown">
            <span class="material-symbols-outlined">${QUEST_TYPE_ICONS['all'] || 'filter_list'}</span>
            <span class="dropdown-text">전체 퀘스트</span>
            <span class="material-symbols-outlined dropdown-arrow">expand_more</span>
        </button>
        <div class="quest-type-menu" id="quest-type-menu">
            ${types.map(type => {
                const count = type === 'all'
                    ? state.allQuests.length
                    : (state.groupedQuests[type] || []).length;

                return `
                    <div class="quest-type-option ${type === 'all' ? 'active' : ''}" data-type="${type}">
                        <span class="material-symbols-outlined">${QUEST_TYPE_ICONS[type] || 'task'}</span>
                        <span class="option-name">${QUEST_TYPES[type] || `타입 ${type}`}</span>
                        <span class="option-count">${count}</span>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    container.innerHTML = html;

    // Event delegation handles clicks - no listeners needed here
}

/**
 * Render quest list
 */
function renderQuestList(quests) {
    const container = document.getElementById('quest-list');
    if (!container) return;

    if (quests.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="material-symbols-outlined">search_off</span>
                <h3>퀘스트를 찾을 수 없습니다</h3>
                <p>검색 조건을 변경하거나 필터를 재설정하세요.</p>
            </div>
        `;
        return;
    }

    const html = quests.map(quest => {
        const typeColor = QUEST_TYPE_COLORS[quest.type] || '#6c757d';
        return `
            <div class="quest-card" data-quest-id="${quest.id}">
                <div class="quest-card-header">
                    <div class="quest-type-badge" style="background-color: ${typeColor}">
                        <span class="material-symbols-outlined">${QUEST_TYPE_ICONS[quest.type] || 'task'}</span>
                        <span>${QUEST_TYPES[quest.type] || `타입 ${quest.type}`}</span>
                    </div>
                    ${quest.series_name ? `<div class="quest-series">${quest.series_name}</div>` : ''}
                </div>
                <h3 class="quest-name">${quest.name}</h3>
                <p class="quest-desc">${quest.task_desc || '설명 없음'}</p>
                <div class="quest-card-footer">
                    <span class="quest-id">ID: ${quest.id}</span>
                    ${quest.unlock_time !== 'always' ? `<span class="quest-unlock-time">${quest.unlock_time}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = html;

    // Event delegation handles clicks - no listeners needed here
}

/**
 * Select and display quest details
 */
function selectQuest(questId) {
    // Convert to string to match quest IDs (which are strings from Object.entries)
    const questIdStr = String(questId);
    const quest = state.allQuests.find(q => q.id === questIdStr);
    if (!quest) {
        console.warn(`[Quest Module] Quest not found: ${questId}`);
        return;
    }

    state.selectedQuest = quest;

    // Update active state in list
    document.querySelectorAll('.quest-card').forEach(card => {
        card.classList.toggle('active', card.dataset.questId === questIdStr);
    });

    renderQuestDetail(quest);
    console.log(`[Quest Module] Selected quest: ${questId}`);
}

/**
 * Get quest name by ID
 */
function getQuestName(questId) {
    const questIdStr = String(questId);
    const quest = state.allQuests.find(q => q.id === questIdStr);
    return quest ? quest.name : null;
}

/**
 * Render quest detail panel
 */
function renderQuestDetail(quest) {
    const container = document.getElementById('quest-detail');
    if (!container) return;

    const typeColor = QUEST_TYPE_COLORS[quest.type] || '#6c757d';

    const html = `
        <div class="quest-detail-header">
            <div class="quest-detail-type" style="background-color: ${typeColor}">
                <span class="material-symbols-outlined">${QUEST_TYPE_ICONS[quest.type] || 'task'}</span>
                <span>${QUEST_TYPES[quest.type] || `타입 ${quest.type}`}</span>
            </div>
            <h2>${quest.name}</h2>
            ${quest.series_name ? `<div class="quest-detail-series">${quest.series_name}</div>` : ''}
        </div>

        <div class="detail-section">
            <h3>
                <span class="material-symbols-outlined">description</span>
                퀘스트 설명
            </h3>
            <p class="quest-detail-desc">${quest.task_desc || '설명 없음'}</p>
        </div>

        ${renderUnlockConditions(quest)}
        ${renderTarget(quest)}
        ${renderMetadata(quest)}
    `;

    container.innerHTML = html;
}

/**
 * Render unlock conditions section
 */
function renderUnlockConditions(quest) {
    if (!quest.unlock_condition || quest.unlock_condition.length === 0) {
        return '';
    }

    return `
        <div class="detail-section">
            <h3>
                <span class="material-symbols-outlined">lock_open</span>
                잠금 해제 조건
            </h3>
            <div class="unlock-conditions">
                ${quest.unlock_condition.map(condition => `
                    <div class="unlock-condition-item">
                        <span class="material-symbols-outlined">check_circle</span>
                        <span>${JSON.stringify(condition)}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

/**
 * Render target/objectives section
 */
function renderTarget(quest) {
    if (!quest.target) {
        return '';
    }

    const target = quest.target;

    return `
        <div class="detail-section">
            <h3>
                <span class="material-symbols-outlined">flag</span>
                목표 (개발 중)
            </h3>
            <div class="quest-targets">
                <div class="quest-target-item">
                    <div class="target-header">
                        <span class="target-index">#1</span>
                        ${target.name ? `<span class="target-name">${target.name}</span>` : ''}
                    </div>
                    ${target.id ? `<div class="target-info">ID: ${target.id}</div>` : ''}
                    ${target.target_num ? `<div class="target-info">목표: ${target.target_num}</div>` : ''}
                    ${target.target_param ? `<div class="target-info">파라미터: ${JSON.stringify(target.target_param)}</div>` : ''}
                    ${target.tips ? `<div class="target-tips">${target.tips}</div>` : ''}
                    ${target.type ? `<div class="target-info">타입: ${target.type}</div>` : ''}
                </div>
            </div>
            <p class="dev-note">
                <span class="material-symbols-outlined">info</span>
                목표 상세 정보는 추후 처리될 예정입니다.
            </p>
        </div>
    `;
}

/**
 * Render metadata section
 */
function renderMetadata(quest) {
    return `
        <div class="detail-section">
            <h3>
                <span class="material-symbols-outlined">info</span>
                메타 정보
            </h3>
            <div class="quest-metadata">
                <div class="metadata-item">
                    <span class="metadata-label">퀘스트 ID</span>
                    <span class="metadata-value">${quest.id}</span>
                </div>
                <div class="metadata-item">
                    <span class="metadata-label">시리즈</span>
                    <span class="metadata-value">${quest.series || 'N/A'}</span>
                </div>
                <div class="metadata-item">
                    <span class="metadata-label">잠금 해제 시간</span>
                    <span class="metadata-value">${quest.unlock_time}</span>
                </div>
                <div class="metadata-item">
                    <span class="metadata-label">타입</span>
                    <span class="metadata-value">${QUEST_TYPES[quest.type] || quest.type}</span>
                </div>
            </div>
        </div>
    `;
}


// ===== Public API =====

window.QuestModule = {
    init,
    selectQuest,
    getQuestName,
    state: () => state
};

export { init, selectQuest, getQuestName };
