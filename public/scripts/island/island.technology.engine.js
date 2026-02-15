/**
 * Island Technology Module
 * Handles technology tree data loading, rendering, and visualization
 */

import { fetchJSON, formatTime } from '../utils.js';

// ============================================
// STATE
// ============================================
const state = {
    technologies: {},
    selectedTechId: null,
    activeCategory: 'all', // 'all' or 1-6
    fuseInstance: null,
    completedTechs: {}, // { techId: true/false }
    resourceData: {} // Resource names from island_item_data_template.json
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

// ============================================
// DATA LOADING
// ============================================

/**
 * Initialize the technology module by loading data
 */
async function init(sharedData) {
    try {
        console.log('[Island Technology] Initializing module...');

        // Use shared item data instead of loading again
        if (sharedData && sharedData.items) {
            state.resourceData = sharedData.items;
            console.log('[Island Technology] Using shared item data');
        }

        // Load module-specific data
        const techData = await fetchJSON('data/island/technology.json');
        state.technologies = techData;

        // Load completion state from localStorage
        loadCompletionState();

        console.log(`[Island Technology] Loaded ${Object.keys(state.technologies).length} technologies`);
        console.log(`[Island Technology] Loaded ${Object.keys(state.resourceData).length} resource types`);

        // Initialize search
        initializeSearch();

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

// ============================================
// EVENT DELEGATION (Fixed Memory Leaks)
// ============================================

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

    // Handle detail panel close button
    const detailContainer = document.getElementById('tech-detail');
    if (detailContainer) {
        detailContainer.addEventListener('click', (e) => {
            if (e.target.closest('#tech-detail-close')) {
                closeTechnologyDetail();
            }
        });
    }

    console.log('[Island Technology] Event delegation set up');
}

// ============================================
// SEARCH FUNCTIONALITY
// ============================================

/**
 * Initialize Fuse.js search
 */
function initializeSearch() {
    const searchableData = Object.values(state.technologies).map(tech => ({
        id: tech.id,
        name: tech.tech_name,
        desc: tech.tech_desc
    }));

    state.fuseInstance = window.IslandEngine.createSearchIndex(searchableData, {
        keys: ['name', 'desc'],
        threshold: 0.3,
        includeScore: true
    });

    console.log('[Island Technology] Search initialized');
}

/**
 * Search technologies by query
 */
function searchTechnologies(query) {
    if (!query || query.trim() === '') {
        return Object.values(state.technologies);
    }

    const results = state.fuseInstance.search(query);
    return results.map(result => state.technologies[result.item.id]);
}

// ============================================
// COMPLETION TRACKING
// ============================================

const STORAGE_KEY_TECH_COMPLETION = 'island-tech-completion';

/**
 * Load completion state from localStorage
 */
function loadCompletionState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY_TECH_COMPLETION);
        state.completedTechs = saved ? JSON.parse(saved) : {};
        console.log(`[Island Technology] Loaded ${Object.keys(state.completedTechs).length} completed techs from storage`);
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
        localStorage.setItem(STORAGE_KEY_TECH_COMPLETION, JSON.stringify(state.completedTechs));
        console.log('[Island Technology] Saved completion state');
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

    console.log(`[Island Technology] ${tech.tech_name} marked as ${state.completedTechs[techId] ? 'completed' : 'incomplete'}`);
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

// ============================================
// CATEGORY FILTERING
// ============================================

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

    console.log(`[Island Technology] Filtered to category: ${category}`);
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

// ============================================
// TECHNOLOGY TREE RENDERING
// ============================================

/**
 * Render the technology tree visualization
 */
function renderTechnologyTree() {
    const container = document.getElementById('tech-tree-container');
    if (!container) return;

    const techs = getFilteredTechnologies();

    if (techs.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="material-symbols-outlined">device_hub</span>
                <p>기술을 찾을 수 없습니다</p>
            </div>
        `;
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
                    <div class="tech-grid">
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
 * Setup drag-to-pan functionality for tech tree container
 */
function setupDragToPan(container) {
    let isDragging = false;
    let startX, startY, scrollLeft, scrollTop;

    container.addEventListener('mousedown', (e) => {
        // Don't drag if clicking on interactive elements
        if (e.target.closest('[data-tech-id]') ||
            e.target.closest('.tech-completion-toggle') ||
            e.target.closest('button')) {
            return;
        }

        isDragging = true;
        container.style.cursor = 'grabbing';
        container.style.userSelect = 'none';

        startX = e.pageX - container.offsetLeft;
        startY = e.pageY - container.offsetTop;
        scrollLeft = container.scrollLeft;
        scrollTop = container.scrollTop;
    });

    container.addEventListener('mouseleave', () => {
        isDragging = false;
        container.style.cursor = 'grab';
        container.style.userSelect = '';
    });

    container.addEventListener('mouseup', () => {
        isDragging = false;
        container.style.cursor = 'grab';
        container.style.userSelect = '';
    });

    container.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();

        const x = e.pageX - container.offsetLeft;
        const y = e.pageY - container.offsetTop;
        const walkX = (x - startX) * 1.5; // Multiply for faster scroll
        const walkY = (y - startY) * 1.5;

        container.scrollLeft = scrollLeft - walkX;
        container.scrollTop = scrollTop - walkY;
    });
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

    // Create a map for quick lookup
    const techMap = {};
    techs.forEach(tech => {
        const key = `${tech.axis[0]},${tech.axis[1]}`;
        techMap[key] = tech;
    });

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
                        connections.push({
                            from: targetTech.axis,
                            to: tech.axis
                        });
                    }
                }
            });
        }
    });

    html += renderConnections(connections, maxX, maxY, xCoordMap);

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
 * Render SVG connections between nodes
 */
function renderConnections(connections, maxX, maxY, xCoordMap) {
    if (connections.length === 0) return '';

    // Dynamically get the base font size (1rem in pixels)
    // Default to 16 if calculation fails
    let baseFontSize = 16;
    try {
        baseFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    } catch (e) {
        console.warn('[Island Technology] Failed to calculate base font size, using default 16px');
    }

    // Use rem values converted to px matching CSS grid values
    // Node width: 300px (18.75rem)
    // Node height: ~33.6px (2.1rem)
    // Gap: 32px (2rem)
    const nodeWidth = 18.75 * baseFontSize;
    const nodeHeight = 2.1 * baseFontSize;
    const gap = 2 * baseFontSize;

    let svg = `<svg class="skill-tree-connections" style="grid-column: 1 / -1; grid-row: 1 / -1;">`;

    connections.forEach(conn => {
        // Floor decimal coordinates and normalize
        const rawX1 = Math.floor(conn.from[0]);
        const rawY1 = Math.floor(conn.from[1]);
        const rawX2 = Math.floor(conn.to[0]);
        const rawY2 = Math.floor(conn.to[1]);

        // Apply coordinate normalization
        const x1 = xCoordMap[rawX1];
        const y1 = rawY1;
        const x2 = xCoordMap[rawX2];
        const y2 = rawY2;

        // Calculate positions (center of each node)
        const startX = (x1 - 1) * (nodeWidth + gap) + nodeWidth / 2;
        const startY = (y1 - 1) * (nodeHeight + gap) + nodeHeight / 2;
        const endX = (x2 - 1) * (nodeWidth + gap) + nodeWidth / 2;
        const endY = (y2 - 1) * (nodeHeight + gap) + nodeHeight / 2;

        // Draw line
        svg += `<line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}"
                     class="tech-connection" stroke="var(--island-border)" stroke-width="2" />`;
    });

    svg += '</svg>';
    return svg;
}

/**
 * Create a skill tree node
 */
function createSkillTreeNode(tech, x, y, externalDeps = null, currentTechs = []) {
    const category = CATEGORIES[tech.tech_belong];
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
                <img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${tech.tech_icon}.png" alt="${tech.tech_name}" />
            </div>
            <div class="node-name">
                <span class="node-level-badge">Lv.${tech.island_level}</span>
                ${tech.tech_name}
            </div>
        </div>
    `;
}

/**
 * Create a technology card (for grid view)
 */
function createTechCard(tech, currentTechs = []) {
    const category = CATEGORIES[tech.tech_belong];
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
                <img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${tech.tech_icon}.png" alt="${tech.tech_name}" />
            </div>
            <div class="tech-card-content">
                <h4 class="tech-card-name">
                    <span class="node-level-badge">Lv.${tech.island_level}</span>
                    ${tech.tech_name}
                </h4>
            </div>
        </div>
    `;
}

/**
 * Attach click handlers to tech cards/nodes
 */
function attachTechCardHandlers(container) {
    // Tech card selection handlers
    container.querySelectorAll('[data-tech-id]').forEach(element => {
        element.addEventListener('click', (e) => {
            // Don't select if clicking the toggle button
            if (e.target.closest('.tech-completion-toggle')) {
                return;
            }
            const techId = element.dataset.techId;
            selectTechnology(techId);
        });
    });

    // Completion toggle handlers
    container.querySelectorAll('[data-toggle-tech-id]').forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent card selection
            const techId = toggle.dataset.toggleTechId;
            toggleTechCompletion(techId);
        });
    });
}

// ============================================
// TECHNOLOGY DETAIL PANEL
// ============================================

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
    console.log(`[Island Technology] Selected: ${tech.tech_name}`);
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

    console.log('[Island Technology] Detail panel closed');
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
                    <img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${tech.tech_icon}.png" alt="${tech.tech_name}" />
                </div>
                <div class="tech-detail-title">
                    <h2>${tech.tech_name}</h2>
                    <div class="tech-detail-meta">
                        <span class="tech-category-badge" style="background-color: ${category.color}20; color: ${category.color};">
                            ${category.name}
                        </span>
                        <span class="tech-level-badge">Island Lv.${tech.island_level}</span>
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
            clickHandler = `onclick="TechnologyModule.navigateToQuest(${id})"`;

            // Try to get quest name if QuestModule is loaded
            if (window.QuestModule && window.QuestModule.getQuestName) {
                const questName = window.QuestModule.getQuestName(id);
                if (questName) {
                    displayName = questName;
                }
            }

            // Add quest badge to make it clear this is a quest
            categoryBadge = `<span class="requirement-quest-badge">퀘스트</span>`;
        } else if (type === 3) { // Tech requirement
            const reqTech = state.technologies[id];
            if (reqTech) {
                displayName = reqTech.tech_name;

                // Check if it's from a different category
                if (reqTech.tech_belong !== tech.tech_belong) {
                    const reqCategory = CATEGORIES[reqTech.tech_belong];
                    categoryBadge = `<span class="requirement-category-badge" style="background-color: ${reqCategory.color}20; color: ${reqCategory.color};">${reqCategory.name}</span>`;
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
                            const resourceIcon = resource?.icon ? `https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${resource.icon.split('/').pop()}.png` : '';
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

// ============================================
// RESOURCE TOTALS
// ============================================

/**
 * Calculate resource totals for a list of techs (excluding completed ones)
 */
function calculateResourceTotals(techs) {
    const totals = {};

    techs.forEach(tech => {
        // Skip completed techs
        if (state.completedTechs[tech.id]) {
            return;
        }

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
}

/**
 * Render resource totals display HTML
 */
function renderResourceTotals(techs) {
    const totals = calculateResourceTotals(techs);
    const resourceEntries = Object.entries(totals);

    if (resourceEntries.length === 0) {
        return `
            <div class="resource-totals-container" id="resource-totals">
                <h3 class="resource-totals-title">
                    <span class="material-symbols-outlined">inventory_2</span>
                    필요 자원 총합
                </h3>
                <p class="resource-totals-empty">모든 기술이 완료되었습니다!</p>
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
                    필요 자원 총합
                </h3>
                <div class="tech-progress">
                    <span class="tech-progress-text">${completedCount} / ${totalCount} 완료</span>
                    <div class="tech-progress-bar">
                        <div class="tech-progress-fill" style="width: ${progressPercent}%"></div>
                    </div>
                </div>
            </div>
            <div class="resource-totals-grid">
                ${resourceEntries.map(([resourceId, amount]) => {
                    const resourceName = state.resourceData[resourceId]?.name || `Resource #${resourceId}`;
                    const resourceIcon = state.resourceData[resourceId]?.icon || 'help';
                    return `
                        <div class="resource-total-item">
                            <div class="resource-total-icon">
                                <img src="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/island/${resourceIcon.split('/').pop()}.png" alt="${resourceName}" />
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

// ============================================
// UTILITY FUNCTIONS
// ============================================



// ============================================
// NAVIGATION HELPERS
// ============================================

/**
 * Navigate to quest tab and select a specific quest
 */
function navigateToQuest(questId) {
    // Switch to quest tab
    const questTabButton = document.querySelector('.tab-button[data-tab="quests"]');
    if (questTabButton) {
        questTabButton.click();
    }

    // Small delay to ensure tab is switched and quest module is ready
    setTimeout(() => {
        if (window.QuestModule && window.QuestModule.selectQuest) {
            window.QuestModule.selectQuest(questId);
        }
    }, 100);
}

// ============================================
// PUBLIC API - backwards compatibility via window global
// ============================================

window.TechnologyModule = {
    init,
    searchTechnologies,
    filterByCategory,
    selectTechnology,
    navigateToQuest,
    state: () => state
};

export { init, searchTechnologies, filterByCategory, selectTechnology, navigateToQuest };
