/**
 * island.technology.engine.js
 * Technology tree sub-engine for the island module. Loads tech nodes, renders a scrollable
 * category-filtered tree with expandable details (unlock conditions, resource costs), tracks
 * completion state in localStorage, and provides resource-total summaries.
 * Registers as window.TechnologyModule.
 */

import { fetchJSON, formatTime, getStorageItem, setStorageItem, ensureFuse, renderStatus, DATA_FOR_TOY_BASE } from '../utils.js';

// ===== State =====
const state = {
    technologies: {},
    selectedTechId: null,
    activeCategory: 'all', // 'all' or 1-6
    fuseInstance: null,
    completedTechs: {}, // { techId: true/false }
    resourceData: {}, // Resource names from island_item_data_template.json
    showCheckedTotals: false // false = unchecked (unfinished) techs, true = checked techs
};

// Category mapping
const CATEGORIES = {
    1: { name: '본부 인증', icon: 'admin_panel_settings', color: '#7289da' },
    2: { name: '채집', icon: 'nature', color: '#43b581' },
    3: { name: '재배', icon: 'agriculture', color: '#faa61a' },
    4: { name: '사육', icon: 'savings', color: '#99aab5' },
    5: { name: '요리', icon: 'restaurant', color: '#f47fff' },
    6: { name: '제조', icon: 'construction', color: '#00b0f4' }
};

// Unlock type mapping for sys_unlock
const UNLOCK_TYPES = {
    1: 'quest',
    3: 'tech'
};

// ===== Data Loading =====

/**
 * Initialize the technology module by loading data
 */
async function init(sharedData) {
    try {
        // Use shared item data instead of loading again
        if (sharedData && sharedData.items) {
            state.resourceData = sharedData.items;
        }

        // Load module-specific data. normalizeArrayFields() repairs array fields
        // the Lua→JSON pipeline emits as `{}` (e.g. sys_unlock for a tech with no
        // dependencies), which would otherwise crash canCompleteTech and the
        // requirement/connection renderers.
        const techData = await fetchJSON('data/island/technology.json');
        state.technologies = window.IslandEngine.normalizeArrayFields(techData);

        // Load completion state from localStorage
        loadCompletionState();

        // Initialize search — await Fuse so the index is built with the real
        // constructor instead of falling through to the substring fallback.
        await initializeSearch();

        // Render initial view
        renderCategoryFilter();
        renderTechnologyTree();

        // Setup event delegation (once)
        setupEventDelegation();

        return true;
    } catch (error) {
        console.error('[Island Technology] Failed to initialize:', error);
        window.IslandEngine.showError('기술 데이터를 불러오는데 실패했습니다. 페이지를 새로고침해주세요.');
        throw error;
    }
}

// ===== Event Delegation =====

/**
 * Setup event delegation for technology module
 * Handles all clicks and drag interactions in one place
 */
function setupEventDelegation() {
    // Handle category filter clicks
    const filterContainer = document.getElementById('tech-category-filter');
    if (filterContainer) {
        filterContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.category-filter-btn');
            if (btn) {
                const category = btn.dataset.category;
                filterByCategory(category === 'all' ? 'all' : parseInt(category));
            }
        });
    }

    // Handle tree interactions (clicks and dragging)
    const treeContainer = document.getElementById('tech-tree-container');
    if (treeContainer) {
        let isDragging = false;
        let startX, startY, scrollLeft, scrollTop;

        // Drag to scroll functionality
        treeContainer.addEventListener('mousedown', (e) => {
            // Don't drag if clicking on interactive elements
            if (e.target.closest('[data-tech-id]') ||
                e.target.closest('[data-toggle-tech-id]') ||
                e.target.closest('button')) {
                return;
            }

            isDragging = true;
            startX = e.pageX - treeContainer.offsetLeft;
            startY = e.pageY - treeContainer.offsetTop;
            scrollLeft = treeContainer.scrollLeft;
            scrollTop = treeContainer.scrollTop;
            treeContainer.style.cursor = 'grabbing';
        });

        // A breakpoint resizes the grid without re-rendering it, leaving the
        // measured connector coordinates behind. Deliberately not a
        // ResizeObserver: it delivers before the media query restyles the
        // nodes, so the callback still measures the outgoing node size.
        let repositionTimer;
        window.addEventListener('resize', () => {
            clearTimeout(repositionTimer);
            repositionTimer = setTimeout(() => positionConnections(treeContainer), 150);
        });

        treeContainer.addEventListener('mouseleave', () => {
            isDragging = false;
            treeContainer.style.cursor = 'grab';
        });

        treeContainer.addEventListener('mouseup', () => {
            isDragging = false;
            treeContainer.style.cursor = 'grab';
        });

        treeContainer.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            const x = e.pageX - treeContainer.offsetLeft;
            const y = e.pageY - treeContainer.offsetTop;
            const walkX = (x - startX) * 1.5;
            const walkY = (y - startY) * 1.5;
            treeContainer.scrollLeft = scrollLeft - walkX;
            treeContainer.scrollTop = scrollTop - walkY;
        });

        // Handle tech card and toggle clicks
        treeContainer.addEventListener('click', (e) => {
            // Handle completion toggle
            const toggle = e.target.closest('[data-toggle-tech-id]');
            if (toggle) {
                e.stopPropagation();
                const techId = toggle.dataset.toggleTechId;
                toggleTechCompletion(techId);
                return;
            }

            // Handle tech card selection
            const techCard = e.target.closest('[data-tech-id]');
            if (techCard) {
                const techId = techCard.dataset.techId;
                selectTechnology(techId);
                return;
            }
        });
    }

    // Handle detail panel close button + quest-requirement navigation
    const detailContainer = document.getElementById('tech-detail');
    if (detailContainer) {
        detailContainer.addEventListener('click', (e) => {
            if (e.target.closest('#tech-detail-close')) {
                closeTechnologyDetail();
                return;
            }
            const questItem = e.target.closest('.requirement-item.clickable[data-quest-id]');
            if (questItem) {
                const questId = parseInt(questItem.dataset.questId, 10);
                if (Number.isFinite(questId)) navigateToQuest(questId);
            }
        });
    }
}

// ===== Search =====

/**
 * Initialize Fuse.js search
 */
async function initializeSearch() {
    const searchableData = Object.values(state.technologies).map(tech => ({
        id: tech.id,
        name: tech.tech_name,
        desc: tech.tech_desc
    }));

    await ensureFuse();
    state.fuseInstance = window.IslandEngine.createSearchIndex(searchableData, {
        keys: ['name', 'desc'],
        threshold: 0.3,
        includeScore: true
    });
}

/**
 * Search technologies by query
 */
function searchTechnologies(query) {
    if (!query || query.trim() === '') {
        return Object.values(state.technologies);
    }

    if (!state.fuseInstance) {
        const normalizedQuery = query.trim().toLowerCase();
        return Object.values(state.technologies).filter(tech => {
            const searchText = `${tech.tech_name || ''} ${tech.tech_desc || ''}`.toLowerCase();
            return searchText.includes(normalizedQuery);
        });
    }

    const results = state.fuseInstance.search(query);
    return results.map(result => state.technologies[result.item.id]);
}

// ===== Completion Tracking =====

const STORAGE_KEY_TECH_COMPLETION = 'island-tech-completion';

/**
 * Load completion state from localStorage
 */
function loadCompletionState() {
    try {
        const saved = getStorageItem(STORAGE_KEY_TECH_COMPLETION, null);
        state.completedTechs = saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('[Island Technology] Failed to load completion state:', error);
        state.completedTechs = {};
    }
}

/**
 * Save completion state to localStorage
 */
function saveCompletionState() {
    try {
        setStorageItem(STORAGE_KEY_TECH_COMPLETION, JSON.stringify(state.completedTechs));
    } catch (error) {
        console.error('[Island Technology] Failed to save completion state:', error);
    }
}

/**
 * Toggle tech completion status
 */
function toggleTechCompletion(techId) {
    const tech = state.technologies[techId];
    if (!tech) return;

    // Toggle completion state
    state.completedTechs[techId] = !state.completedTechs[techId];

    // Save to localStorage
    saveCompletionState();

    // Re-render the tree to update all dependent techs' disabled states
    renderTechnologyTree();

    // Scroll back to the toggled tech if needed
    setTimeout(() => {
        const element = document.querySelector(`[data-tech-id="${techId}"]`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, 100);
}

/**
 * Check if tech completion is allowed (based on dependencies within current filter)
 * @param {string} techId - The tech ID to check
 * @param {Array} currentTechs - The currently filtered/visible techs
 */
function canCompleteTech(techId, currentTechs) {
    const tech = state.technologies[techId];
    if (!tech) return false;

    // If no dependencies, can always complete
    if (!tech.sys_unlock || tech.sys_unlock.length === 0) {
        return true;
    }

    // Only check dependencies that exist in the current filtered view
    // (same logic as connection rendering)
    for (const [type, depTechId] of tech.sys_unlock) {
        if (type === 3) { // Tech dependency
            const depTech = currentTechs.find(t => t.id === depTechId);

            // Only check if dependency exists in current filter
            if (depTech && !state.completedTechs[depTechId]) {
                return false;
            }
        }
    }

    return true;
}

// ===== Category Filtering =====

/**
 * Render category filter buttons
 */
function renderCategoryFilter() {
    const container = document.getElementById('tech-category-filter');
    if (!container) return;

    const categories = [
        { id: 'all', name: '전체', icon: 'apps', color: '#7289da' },
        ...Object.entries(CATEGORIES).map(([id, data]) => ({
            id: parseInt(id),
            ...data
        }))
    ];

    container.innerHTML = categories.map(cat => `
        <button class="category-filter-btn ${state.activeCategory === cat.id ? 'active' : ''}"
                data-category="${cat.id}"
                style="--category-color: ${cat.color}">
            <span class="material-symbols-outlined">${cat.icon}</span>
            <span>${cat.name}</span>
        </button>
    `).join('');

    // Event delegation handles clicks - no listeners needed here
}

/**
 * Filter technologies by category
 */
function filterByCategory(category) {
    state.activeCategory = category;

    // Update active button state
    document.querySelectorAll('.category-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category == category);
    });

    // Re-render the tree
    renderTechnologyTree();
}

/**
 * Get filtered technologies based on active category
 */
function getFilteredTechnologies() {
    const allTechs = Object.values(state.technologies);

    if (state.activeCategory === 'all') {
        return allTechs;
    }

    return allTechs.filter(tech => tech.tech_belong === state.activeCategory);
}

// ===== Technology Tree Rendering =====

/**
 * Render the technology tree visualization
 */
function renderTechnologyTree() {
    const container = document.getElementById('tech-tree-container');
    if (!container) return;

    const techs = getFilteredTechnologies();

    if (techs.length === 0) {
        renderStatus(container, '기술을 찾을 수 없습니다', 'empty', { icon: 'device_hub' });
        return;
    }

    // Group by category if showing all, or by axis if single category
    if (state.activeCategory === 'all') {
        renderCategoryGroupedView(techs, container);
    } else {
        renderSkillTreeView(techs, container);
    }
}

/**
 * Render grouped view by category (for "all" filter)
 */
function renderCategoryGroupedView(techs, container) {
    // Group technologies by category
    const grouped = {};
    techs.forEach(tech => {
        if (!grouped[tech.tech_belong]) {
            grouped[tech.tech_belong] = [];
        }
        grouped[tech.tech_belong].push(tech);
    });

    let html = Object.entries(grouped)
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .map(([catId, categoryTechs]) => {
            const category = CATEGORIES[catId];
            return `
                <div class="tech-category-group">
                    <h3 class="tech-category-title">
                        <span class="material-symbols-outlined" style="color: ${category.color}">${category.icon}</span>
                        ${category.name}
                        <span class="tech-count">${categoryTechs.length}</span>
                    </h3>
                    <div class="tech-grid card-grid">
                        ${categoryTechs.map(tech => createTechCard(tech, categoryTechs)).join('')}
                    </div>
                </div>
            `;
        }).join('');

    container.innerHTML = html;

    // Render resource totals separately (outside the scrolling container)
    renderResourceTotalsContainer(techs);

    // Event delegation handles all interactions - no listeners needed here
}

/**
 * Render skill tree view with nodes and connections
 */
function renderSkillTreeView(techs, container) {
    // COORDINATE NORMALIZATION
    // Collect all unique x-coordinates and create a mapping to eliminate empty columns
    const uniqueXCoords = [...new Set(techs.map(t => Math.floor(t.axis[0])))].sort((a, b) => a - b);
    const xCoordMap = {};
    uniqueXCoords.forEach((rawX, index) => {
        xCoordMap[rawX] = index + 1; // Map to 1-indexed normalized coordinates
    });

    // Calculate normalized grid dimensions
    const maxX = uniqueXCoords.length; // Number of unique x-coordinates
    const maxY = Math.max(...techs.map(t => Math.floor(t.axis[1])));

    // Build the skill tree HTML
    let html = '<div class="skill-tree-grid" style="--max-x: ' + maxX + '; --max-y: ' + maxY + ';">';

    // Add connections (SVG lines) - ONLY for same-category dependencies
    const connections = [];
    techs.forEach(tech => {
        if (tech.sys_unlock && tech.sys_unlock.length > 0) {
            tech.sys_unlock.forEach(([type, targetId]) => {
                if (type === 3) { // Tech dependency
                    const targetTech = techs.find(t => t.id === targetId);
                    // Only create connection if target tech exists in current filtered list
                    if (targetTech) {
                        connections.push({ from: targetTech.id, to: tech.id });
                    }
                }
            });
        }
    });

    html += renderConnections(connections);

    // Add nodes - use normalized coordinates
    techs.forEach(tech => {
        const hasExternalDep = checkExternalDependencies(tech, techs);
        const rawX = Math.floor(tech.axis[0]);
        const rawY = Math.floor(tech.axis[1]);
        const normalizedX = xCoordMap[rawX];
        html += createSkillTreeNode(tech, normalizedX, rawY, hasExternalDep, techs);
    });

    html += '</div>';

    container.innerHTML = html;
    positionConnections(container);

    // Render resource totals separately (outside the scrolling container)
    renderResourceTotalsContainer(techs);

    // Event delegation handles all interactions - no listeners needed here
}

/**
 * Check if a tech has dependencies outside the current filtered category
 */
function checkExternalDependencies(tech, currentTechs) {
    if (!tech.sys_unlock || tech.sys_unlock.length === 0) {
        return null;
    }

    const externalDeps = [];
    tech.sys_unlock.forEach(([type, targetId]) => {
        if (type === 3) { // Tech dependency
            const targetTech = state.technologies[targetId];
            const isInCurrentList = currentTechs.find(t => t.id === targetId);

            if (targetTech && !isInCurrentList) {
                // This is an external dependency
                externalDeps.push({
                    tech: targetTech,
                    category: CATEGORIES[targetTech.tech_belong]
                });
            }
        }
    });

    return externalDeps.length > 0 ? externalDeps : null;
}

/**
 * Render the SVG connection layer. Lines are emitted without coordinates —
 * positionConnections() fills them in from the laid-out DOM.
 */
function renderConnections(connections) {
    if (connections.length === 0) return '';

    const lines = connections
        .map(conn => `<line class="tech-connection" data-from="${conn.from}" data-to="${conn.to}" />`)
        .join('');

    return `<svg class="skill-tree-connections" style="grid-column: 1 / -1; grid-row: 1 / -1;">${lines}</svg>`;
}

/**
 * Point every connector at the real centre of the nodes it joins, measured from
 * the laid-out DOM. Deriving the centres from the CSS rem values instead drifts:
 * nodes are content-box, so a node renders ~20px wider and ~12px taller than the
 * grid track it sits in, and four responsive breakpoints resize the tracks, the
 * nodes and the gap together. Coordinates are relative to the SVG, which spans
 * the whole grid area and carries no viewBox, so user units are CSS pixels.
 */
function positionConnections(container) {
    const svg = container.querySelector('.skill-tree-connections');
    if (!svg) return;

    const origin = svg.getBoundingClientRect();
    const centreOf = techId => {
        const node = container.querySelector(`.skill-tree-node[data-tech-id="${techId}"]`);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return [rect.x - origin.x + rect.width / 2, rect.y - origin.y + rect.height / 2];
    };

    svg.querySelectorAll('line').forEach(line => {
        const from = centreOf(line.dataset.from);
        const to = centreOf(line.dataset.to);
        if (!from || !to) {
            line.remove();
            return;
        }
        line.setAttribute('x1', from[0]);
        line.setAttribute('y1', from[1]);
        line.setAttribute('x2', to[0]);
        line.setAttribute('y2', to[1]);
    });
}

/**
 * Create a skill tree node
 */
function createSkillTreeNode(tech, x, y, externalDeps = null, currentTechs = []) {
    const isLocked = tech.sys_unlock && tech.sys_unlock.length > 0;
    const isCompleted = state.completedTechs[tech.id] || false;
    const canComplete = canCompleteTech(tech.id, currentTechs);

    // Build badges for top-left corner
    let topLeftBadges = '';

    // External dependency badge (top-left, primary position)
    if (externalDeps && externalDeps.length > 0) {
        const depCategories = [...new Set(externalDeps.map(d => d.category.name))].join(', ');
        topLeftBadges += `
            <div class="tech-badge external-dep-badge" title="외부 필요: ${depCategories}">
                <span class="material-symbols-outlined">link</span>
            </div>
        `;
    }
    // Lock badge (top-left, secondary position) - Only show when dependencies aren't met
    else if (!canComplete && !isCompleted) {
        topLeftBadges += `
            <div class="tech-badge lock-badge" title="필요 조건을 먼저 완료하세요">
                <span class="material-symbols-outlined">lock</span>
            </div>
        `;
    }

    // Completion toggle button (top-right)
    const toggleButton = `
        <button class="tech-completion-toggle ${isCompleted ? 'completed' : ''} ${!canComplete ? 'disabled' : ''}"
                data-toggle-tech-id="${tech.id}"
                title="${!canComplete ? '필요 조건을 먼저 완료하세요' : (isCompleted ? '완료 취소' : '완료 표시')}"
                aria-label="${isCompleted ? '완료됨' : '미완료'}"
                aria-checked="${isCompleted}"
                ${!canComplete ? 'disabled' : ''}>
            <span class="material-symbols-outlined">${isCompleted ? 'check_circle' : 'radio_button_unchecked'}</span>
        </button>
    `;

    return `
        <div class="skill-tree-node ${isLocked ? 'locked' : 'available'} ${isCompleted ? 'tech-completed' : ''}"
             data-tech-id="${tech.id}"
             style="grid-column: ${x}; grid-row: ${y};">
            ${topLeftBadges}
            ${toggleButton}
            <div class="node-icon">
                <img src="${DATA_FOR_TOY_BASE}/island/islandtechnology/${tech.tech_icon}.webp" alt="${tech.tech_name}" />
            </div>
            <div class="node-name">
                <span class="badge badge--neutral node-level-badge">Lv.${tech.island_level}</span>
                ${tech.tech_name}
            </div>
        </div>
    `;
}

/**
 * Create a technology card (for grid view)
 */
function createTechCard(tech, currentTechs = []) {
    const isLocked = tech.sys_unlock && tech.sys_unlock.length > 0;
    const isCompleted = state.completedTechs[tech.id] || false;
    const canComplete = canCompleteTech(tech.id, currentTechs);

    // Lock badge (top-left) - Only show when dependencies aren't met
    const lockBadge = (!canComplete && !isCompleted) ? `
        <div class="tech-badge lock-badge" title="필요 조건을 먼저 완료하세요">
            <span class="material-symbols-outlined">lock</span>
        </div>
    ` : '';

    // Completion toggle button (top-right)
    const toggleButton = `
        <button class="tech-completion-toggle ${isCompleted ? 'completed' : ''} ${!canComplete ? 'disabled' : ''}"
                data-toggle-tech-id="${tech.id}"
                title="${!canComplete ? '필요 조건을 먼저 완료하세요' : (isCompleted ? '완료 취소' : '완료 표시')}"
                aria-label="${isCompleted ? '완료됨' : '미완료'}"
                aria-checked="${isCompleted}"
                ${!canComplete ? 'disabled' : ''}>
            <span class="material-symbols-outlined">${isCompleted ? 'check_circle' : 'radio_button_unchecked'}</span>
        </button>
    `;

    return `
        <div class="tech-card ${isLocked ? 'locked' : 'available'} ${isCompleted ? 'tech-completed' : ''}"
             data-tech-id="${tech.id}">
            ${lockBadge}
            ${toggleButton}
            <div class="tech-card-icon">
                <img src="${DATA_FOR_TOY_BASE}/island/islandtechnology/${tech.tech_icon}.webp" alt="${tech.tech_name}" />
            </div>
            <div class="tech-card-content">
                <h4 class="tech-card-name">
                    <span class="badge badge--neutral node-level-badge">Lv.${tech.island_level}</span>
                    ${tech.tech_name}
                </h4>
            </div>
        </div>
    `;
}

// ===== Technology Detail Panel =====

/**
 * Select and display technology details
 */
function selectTechnology(techId) {
    state.selectedTechId = techId;
    const tech = state.technologies[techId];

    if (!tech) {
        console.error(`[Island Technology] Technology not found: ${techId}`);
        return;
    }

    // Update selected state in UI
    document.querySelectorAll('[data-tech-id]').forEach(el => {
        el.classList.toggle('selected', el.dataset.techId === techId);
    });

    // Show the detail panel
    const detailPanel = document.getElementById('tech-detail');
    if (detailPanel) {
        detailPanel.classList.add('visible');
    }

    renderTechnologyDetail(tech);
}

/**
 * Close the technology detail panel
 */
function closeTechnologyDetail() {
    state.selectedTechId = null;

    // Hide the detail panel
    const detailPanel = document.getElementById('tech-detail');
    if (detailPanel) {
        detailPanel.classList.remove('visible');
    }

    // Clear selected state
    document.querySelectorAll('[data-tech-id]').forEach(el => {
        el.classList.remove('selected');
    });
}

/**
 * Render technology detail panel
 */
function renderTechnologyDetail(tech) {
    const container = document.getElementById('tech-detail');
    if (!container) return;

    const category = CATEGORIES[tech.tech_belong];
    const formula = tech.formula_id;

    container.innerHTML = `
        <div class="tech-detail-content">
            <!-- Close Button -->
            <button class="tech-detail-close" id="tech-detail-close" aria-label="Close detail panel">
                <span class="material-symbols-outlined">close</span>
            </button>

            <!-- Header -->
            <div class="tech-detail-header">
                <div class="tech-detail-icon">
                    <img src="${DATA_FOR_TOY_BASE}/island/islandtechnology/${tech.tech_icon}.webp" alt="${tech.tech_name}" />
                </div>
                <div class="tech-detail-title">
                    <h2>${tech.tech_name}</h2>
                    <div class="tech-detail-meta">
                        <span class="badge tech-category-badge" style="background-color: ${category.color}20; color: ${category.color};">
                            ${category.name}
                        </span>
                        <span class="badge badge--neutral tech-level-badge">Island Lv.${tech.island_level}</span>
                    </div>
                </div>
            </div>

            <!-- Description -->
            <div class="detail-section">
                <h3>
                    <span class="material-symbols-outlined">description</span>
                    설명
                </h3>
                <p class="tech-description">${tech.tech_desc}</p>
            </div>

            <!-- Requirements -->
            ${renderRequirements(tech)}

            <!-- Formula Details -->
            ${renderFormulaDetails(formula)}

            <!-- Completion Bonus -->
            ${tech.complete_tips ? `
                <div class="detail-section">
                    <h3>
                        <span class="material-symbols-outlined">check_circle</span>
                        완료 보상
                    </h3>
                    <div class="completion-tips">
                        ${tech.complete_tips.replace(/<color=#1E8FFE>/g, '<span class="highlight">').replace(/<\/color>/g, '</span>')}
                    </div>
                </div>
            ` : ''}
        </div>
    `;

    // Event delegation handles close button - no listener needed here
}

/**
 * Render requirements section
 */
function renderRequirements(tech) {
    if (!tech.sys_unlock || tech.sys_unlock.length === 0) {
        return `
            <div class="detail-section">
                <h3>
                    <span class="material-symbols-outlined">lock_open</span>
                    필요 조건
                </h3>
                <p class="no-requirements">필요 조건 없음</p>
            </div>
        `;
    }

    const requirements = tech.sys_unlock.map(([type, id]) => {
        const typeName = UNLOCK_TYPES[type] || 'unknown';
        let displayName = `${typeName} #${id}`;
        let categoryBadge = '';
        let clickable = '';
        let clickHandler = '';

        if (type === 1) { // Quest requirement - make it clickable
            clickable = 'clickable';
            clickHandler = `data-quest-id="${id}"`;

            // Try to get quest name if QuestModule is loaded
            if (window.QuestModule && window.QuestModule.getQuestName) {
                const questName = window.QuestModule.getQuestName(id);
                if (questName) {
                    displayName = questName;
                }
            }

            // Add quest badge to make it clear this is a quest
            categoryBadge = `<span class="badge requirement-quest-badge">퀘스트</span>`;
        } else if (type === 3) { // Tech requirement
            const reqTech = state.technologies[id];
            if (reqTech) {
                displayName = reqTech.tech_name;

                // Check if it's from a different category
                if (reqTech.tech_belong !== tech.tech_belong) {
                    const reqCategory = CATEGORIES[reqTech.tech_belong];
                    categoryBadge = `<span class="badge requirement-category-badge" style="background-color: ${reqCategory.color}20; color: ${reqCategory.color};">${reqCategory.name}</span>`;
                }
            }
        }

        return `
            <div class="requirement-item ${clickable}" ${clickHandler}>
                <span class="material-symbols-outlined">${type === 1 ? 'task_alt' : 'build'}</span>
                <div class="requirement-content">
                    <span>${displayName}</span>
                    ${categoryBadge}
                </div>
                ${type === 1 ? '<span class="material-symbols-outlined link-arrow">arrow_forward</span>' : ''}
            </div>
        `;
    }).join('');

    return `
        <div class="detail-section">
            <h3>
                <span class="material-symbols-outlined">lock</span>
                필요 조건
            </h3>
            <div class="requirements-list">
                ${requirements}
            </div>
        </div>
    `;
}

/**
 * Render formula details section
 */
function renderFormulaDetails(formula) {
    if (!formula) return '';

    const workloadTime = formatTime(formula.workload);
    const costs = formula.cost || [];

    return `
        <div class="detail-section">
            <h3>
                <span class="material-symbols-outlined">science</span>
                연구 정보
            </h3>
            <div class="formula-stats">
                <div class="formula-stat">
                    <span class="stat-icon material-symbols-outlined">schedule</span>
                    <div class="stat-info">
                        <span class="stat-label">연구 시간</span>
                        <span class="stat-value">${workloadTime}</span>
                    </div>
                </div>
                <div class="formula-stat">
                    <span class="stat-icon material-symbols-outlined">stars</span>
                    <div class="stat-info">
                        <span class="stat-label">경험치</span>
                        <span class="stat-value">${formula.ship_exp} EXP</span>
                    </div>
                </div>
                <div class="formula-stat">
                    <span class="stat-icon material-symbols-outlined">bolt</span>
                    <div class="stat-info">
                        <span class="stat-label">스태미나</span>
                        <span class="stat-value">${formula.stamina_cost}</span>
                    </div>
                </div>
            </div>

            ${costs.length > 0 ? `
                <div class="formula-costs">
                    <h4>필요 자원</h4>
                    <div class="cost-list">
                        ${costs.map(([resourceId, amount]) => {
        const resource = state.resourceData[resourceId];
        const resourceName = resource?.name || `Resource #${resourceId}`;
        const resourceIcon = resource?.icon ? `${DATA_FOR_TOY_BASE}/island/islandprops/${resource.icon.split('/').pop()}.webp` : '';
        return `
                            <div class="cost-item">
                                <div class="cost-resource-display">
                                    ${resourceIcon ? `<img src="${resourceIcon}" alt="${resourceName}" class="cost-resource-icon">` : '<span class="material-symbols-outlined cost-resource-icon">inventory_2</span>'}
                                    <span class="cost-resource-name">${resourceName}</span>
                                </div>
                                <span class="cost-amount">×${amount}</span>
                            </div>
                        `;
    }).join('')}
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

// ===== Resource Totals =====

/**
 * Calculate resource totals for a list of techs
 * When showCheckedTotals=false: sums unchecked (unfinished) techs
 * When showCheckedTotals=true: sums checked (completed) techs
 */
function calculateResourceTotals(techs) {
    const totals = {};

    techs.forEach(tech => {
        const isCompleted = !!state.completedTechs[tech.id];
        if (isCompleted !== state.showCheckedTotals) return;

        // Add costs from formula
        if (tech.formula_id && tech.formula_id.cost) {
            tech.formula_id.cost.forEach(([resourceId, amount]) => {
                totals[resourceId] = (totals[resourceId] || 0) + amount;
            });
        }
    });

    return totals;
}

/**
 * Render resource totals to the separate container
 */
function renderResourceTotalsContainer(techs) {
    const resourceContainer = document.getElementById('tech-resource-totals');
    if (!resourceContainer) {
        console.warn('[Island Technology] Resource totals container not found');
        return;
    }

    resourceContainer.innerHTML = renderResourceTotals(techs);

    const toggleBtn = resourceContainer.querySelector('.resource-totals-mode-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            state.showCheckedTotals = !state.showCheckedTotals;
            renderResourceTotalsContainer(techs);
        });
    }
}

/**
 * Render resource totals display HTML
 */
function renderResourceTotals(techs) {
    const totals = calculateResourceTotals(techs);
    const resourceEntries = Object.entries(totals);
    const titleText = state.showCheckedTotals
        ? '체크한 연구 자원 총합'
        : '체크 안된 (미완료) 연구 자원 총합';
    const toggleLabel = state.showCheckedTotals
        ? '자원 계산 방식 : 체크 기준'
        : '자원 계산 방식 : 체크 안된 기준';
    const toggleIcon = state.showCheckedTotals ? 'check_circle' : 'pending';
    const emptyMessage = state.showCheckedTotals
        ? '체크한 연구가 없습니다.'
        : '모든 기술이 완료되었습니다!';

    const toggleBtnHtml = `
        <button class="btn btn-secondary resource-totals-mode-toggle">
            <span class="material-symbols-outlined">${toggleIcon}</span>
            ${toggleLabel}
        </button>`;

    if (resourceEntries.length === 0) {
        return `
            <div class="resource-totals-container" id="resource-totals">
                <div class="resource-totals-header">
                    <h3 class="resource-totals-title">
                        <span class="material-symbols-outlined">inventory_2</span>
                        ${titleText}
                        ${toggleBtnHtml}
                    </h3>
                </div>
                <p class="resource-totals-empty">${emptyMessage}</p>
            </div>
        `;
    }

    const completedCount = techs.filter(t => state.completedTechs[t.id]).length;
    const totalCount = techs.length;
    const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    return `
        <div class="resource-totals-container" id="resource-totals">
            <div class="resource-totals-header">
                <h3 class="resource-totals-title">
                    <span class="material-symbols-outlined">inventory_2</span>
                    ${titleText}
                    ${toggleBtnHtml}
                </h3>
                <div class="tech-progress">
                    <span class="tech-progress-text">${completedCount} / ${totalCount} 완료</span>
                    <div class="tech-progress-bar">
                        <div class="tech-progress-fill" style="width: ${progressPercent}%"></div>
                    </div>
                </div>
            </div>
            <div class="resource-totals-grid card-grid">
                ${resourceEntries.map(([resourceId, amount]) => {
        const resourceName = state.resourceData[resourceId]?.name || `Resource #${resourceId}`;
        const resourceIcon = state.resourceData[resourceId]?.icon || 'help';
        return `
                        <div class="resource-total-item">
                            <div class="resource-total-icon">
                                <img src="${DATA_FOR_TOY_BASE}/island/islandprops/${resourceIcon.split('/').pop()}.webp" alt="${resourceName}" />
                            </div>
                            <div class="resource-total-info">
                                <span class="resource-total-name">${resourceName}</span>
                                <span class="resource-total-amount">${amount.toLocaleString()}</span>
                            </div>
                        </div>
                    `;
    }).join('')}
            </div>
        </div>
    `;
}

// ===== Utility Functions =====



// ===== Navigation Helpers =====

/**
 * Navigate to quest tab and select a specific quest
 */
async function navigateToQuest(questId) {
    if (!window.IslandEngine?.activateTab) return;

    await window.IslandEngine.activateTab('quests');
    window.QuestModule?.selectQuest?.(questId);
}

// ===== Public API =====

window.TechnologyModule = {
    init,
    searchTechnologies,
    filterByCategory,
    selectTechnology,
    navigateToQuest,
    state: () => state
};

export { init, searchTechnologies, filterByCategory, selectTechnology, navigateToQuest };
