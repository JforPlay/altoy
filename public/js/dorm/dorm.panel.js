/**
 * dorm.panel.js
 * Left-side furniture panel for the dorm simulator: theme accordion,
 * furniture icon grid, hover info, search, and placement selection.
 * Part of the dorm module group (viewer + data + grid + panel).
 */
import { debounce, hideElement, showElement } from '../utils.js';
import { getFurniture, getThemesSorted, searchFurniture, getFurnitureIconUrl, getThemeIconUrl } from './dorm.data.js';

let state;
const themeBySection = new WeakMap();
const HOVER_PLACEHOLDER = '가구에 마우스를 올려보세요';

/** Receive the shared state reference from dorm.viewer.js. */
export function setup(stateRef) {
    state = stateRef;
}

/**
 * Initialize the panel after data is loaded.
 * Renders all theme sections and wires search and toggle behavior.
 */
export function init() {
    renderThemes();
    setupSearch();
    setupPanelToggle();
}

// ===== Rendering =====

function isPlaceable(f) {
    return f && f.type !== 1 && f.type !== 4 &&
        Array.isArray(f.size) && f.size.length >= 2;
}

function countPlaceableFurniture(theme) {
    return theme.furnitureIds.filter(fid => isPlaceable(getFurniture(fid))).length;
}

function countMatchingPlaceableFurniture(theme, matchIds) {
    return theme.furnitureIds.filter(fid => {
        const furniture = getFurniture(fid);
        return isPlaceable(furniture) && (matchIds === null || matchIds.has(Number(fid)));
    }).length;
}

function renderThemes() {
    const container = state.elements.themeList;
    const fragment = document.createDocumentFragment();
    const themes = getThemesSorted();

    for (const theme of themes) {
        const section = createThemeSection(theme);
        fragment.appendChild(section);
    }

    container.replaceChildren(fragment);
    updateSearchEmptyState(false);
}

function createThemeSection(theme) {
    const section = document.createElement('div');
    section.className = 'theme-section' + (theme.id === 0 ? ' no-theme' : '');
    section.dataset.themeId = theme.id;
    themeBySection.set(section, theme);

    const gridId = `dorm-theme-${theme.id}-grid`;

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'theme-header';
    header.setAttribute('aria-expanded', 'false');
    header.setAttribute('aria-controls', gridId);
    header.title = theme.name;

    const arrow = document.createElement('span');
    arrow.className = 'theme-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '▶';
    header.appendChild(arrow);

    if (theme.icon) {
        const icon = document.createElement('img');
        icon.className = 'theme-icon';
        icon.src = getThemeIconUrl(theme.icon);
        icon.alt = '';
        icon.loading = 'lazy';
        icon.setAttribute('data-onfail', 'hide');
        header.appendChild(icon);
    }

    const info = document.createElement('span');
    info.className = 'theme-info';

    const name = document.createElement('span');
    name.className = 'theme-name';
    name.textContent = theme.name;
    info.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'theme-meta';
    meta.textContent = `${countPlaceableFurniture(theme)}개${theme.comfortable > 0 ? ` · +${theme.comfortable} 쾌적도` : ''}`;
    info.appendChild(meta);

    header.appendChild(info);
    header.addEventListener('click', () => toggleTheme(section));
    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'furniture-grid';
    grid.id = gridId;
    grid.hidden = true;
    grid.dataset.rendered = 'false';

    section.appendChild(grid);
    return section;
}

function ensureThemeGridRendered(section) {
    const grid = section.querySelector('.furniture-grid');
    if (!grid || grid.dataset.rendered === 'true') return grid;

    const theme = themeBySection.get(section);
    if (!theme) return grid;

    const fragment = document.createDocumentFragment();
    for (const fid of theme.furnitureIds) {
        const furniture = getFurniture(fid);
        if (!isPlaceable(furniture)) continue;
        fragment.appendChild(createFurnitureIcon(furniture));
    }

    grid.replaceChildren(fragment);
    grid.dataset.rendered = 'true';
    return grid;
}

function createFurnitureIcon(furniture) {
    const wrapper = document.createElement('button');
    wrapper.type = 'button';
    wrapper.className = 'furniture-icon-wrapper';
    wrapper.dataset.furnitureId = furniture.id;
    wrapper.dataset.rarity = furniture.rarity;
    wrapper.draggable = true;
    wrapper.title = furniture.name;
    wrapper.setAttribute('aria-pressed', 'false');
    wrapper.setAttribute('aria-label', `${furniture.name} 배치 선택`);

    const img = document.createElement('img');
    img.className = 'furniture-icon-img';
    img.src = getFurnitureIconUrl(furniture.icon);
    img.alt = furniture.name;
    img.loading = 'lazy';
    img.onerror = function() {
        this.remove();
        const fallback = document.createElement('span');
        fallback.className = 'furniture-icon-fallback';
        fallback.textContent = furniture.name.slice(0, 4);
        wrapper.prepend(fallback);
    };
    wrapper.appendChild(img);

    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'furniture-size-label';
    sizeLabel.textContent = `${furniture.size[0]}x${furniture.size[1]}`;
    wrapper.appendChild(sizeLabel);

    wrapper.addEventListener('mouseenter', () => showHoverInfo(furniture));
    wrapper.addEventListener('mouseleave', () => clearHoverInfo());
    wrapper.addEventListener('focus', () => showHoverInfo(furniture));
    wrapper.addEventListener('blur', () => clearHoverInfo());

    wrapper.addEventListener('dragstart', (e) => {
        if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', furniture.id);
            e.dataTransfer.effectAllowed = 'copy';
        }
        wrapper.classList.add('dragging');
        if (state.onDragStart) state.onDragStart(furniture.id);
    });
    wrapper.addEventListener('dragend', () => {
        wrapper.classList.remove('dragging');
        if (state.onDragEnd) state.onDragEnd();
    });

    wrapper.addEventListener('click', (e) => {
        e.preventDefault();
        selectForPlacement(furniture.id);
    });

    return wrapper;
}

// ===== Theme Accordion =====

function toggleTheme(section) {
    const expanded = !section.classList.contains('expanded');
    setThemeExpanded(section, expanded);
}

function setThemeExpanded(section, expanded) {
    section.classList.toggle('expanded', expanded);
    const header = section.querySelector('.theme-header');
    const grid = expanded
        ? ensureThemeGridRendered(section)
        : section.querySelector('.furniture-grid');
    header?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (grid) grid.hidden = !expanded;
}

// ===== Hover Info =====

function showHoverInfo(furniture) {
    const info = state.elements.hoverInfo;
    const name = document.createElement('div');
    name.className = 'hover-info-name';
    name.textContent = furniture.name;

    const details = document.createElement('div');
    details.className = 'hover-info-details';
    details.textContent = `${furniture.typeName} · ${furniture.size[0]}x${furniture.size[1]} · 쾌적도 ${furniture.comfortable} · ${'★'.repeat(furniture.rarity)}`;

    info.replaceChildren(name, details);
}

function clearHoverInfo() {
    const placeholder = document.createElement('div');
    placeholder.className = 'hover-info-placeholder';
    placeholder.textContent = HOVER_PLACEHOLDER;
    state.elements.hoverInfo.replaceChildren(placeholder);
}

// ===== Search =====

function setupSearch() {
    const input = state.elements.furnitureSearch;
    input.addEventListener('input', debounce((e) => {
        filterBySearch(e.target.value.trim());
    }, 200));
}

function filterBySearch(query) {
    const matchIds = searchFurniture(query);
    const sections = state.elements.themeList.querySelectorAll('.theme-section');
    let visibleSections = 0;

    for (const section of sections) {
        const theme = themeBySection.get(section);
        if (!theme) continue;

        const visibleCount = countMatchingPlaceableFurniture(theme, matchIds);
        const shouldShow = visibleCount > 0;
        section.style.display = shouldShow ? '' : 'none';

        const grid = shouldShow && matchIds !== null
            ? ensureThemeGridRendered(section)
            : section.querySelector('.furniture-grid');

        if (grid?.dataset.rendered === 'true') {
            for (const icon of grid.querySelectorAll('.furniture-icon-wrapper')) {
                const fid = Number(icon.dataset.furnitureId);
                icon.style.display = matchIds === null || matchIds.has(fid) ? '' : 'none';
            }
        }

        // Hide empty themes, expand themes with matches
        if (matchIds !== null && shouldShow) {
            visibleSections++;
            setThemeExpanded(section, true);
        } else if (matchIds === null && shouldShow) {
            visibleSections++;
        }
    }

    updateSearchEmptyState(matchIds !== null && visibleSections === 0);
}

function updateSearchEmptyState(isEmpty) {
    if (!state.elements.themeEmptyState) return;
    if (isEmpty) {
        showElement(state.elements.themeEmptyState);
    } else {
        hideElement(state.elements.themeEmptyState);
    }
}

// ===== Placement Selection (click-to-place, touch fallback) =====

/**
 * Toggle click-to-place mode for a furniture item.
 * Clicking the same item again deselects and cancels placement mode.
 */
function selectForPlacement(furnitureId) {
    // Clear previous selection highlight
    const prev = state.elements.themeList.querySelector('.furniture-icon-wrapper.selected');
    if (prev) {
        prev.classList.remove('selected');
        prev.setAttribute('aria-pressed', 'false');
    }

    if (state.selectedFurnitureId === furnitureId) {
        // Deselect
        state.selectedFurnitureId = null;
        if (state.onPlacementCancel) state.onPlacementCancel();
        return;
    }

    state.selectedFurnitureId = furnitureId;
    const el = state.elements.themeList.querySelector(
        `.furniture-icon-wrapper[data-furniture-id="${furnitureId}"]`
    );
    if (el) {
        el.classList.add('selected');
        el.setAttribute('aria-pressed', 'true');
    }
    if (state.onPlacementSelect) state.onPlacementSelect(furnitureId);
}

// ===== Mobile Panel Toggle =====

function setupPanelToggle() {
    const toggleBtn = state.elements.btnTogglePanel;
    const panel = state.elements.dormPanel;

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            setPanelExpanded(!panel.classList.contains('expanded'));
        });
    }

    const header = panel.querySelector('.panel-header');
    header.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && e.target === header) {
            setPanelExpanded(!panel.classList.contains('expanded'));
        }
    });
}

function setPanelExpanded(expanded) {
    state.elements.dormPanel.classList.toggle('expanded', expanded);
    state.elements.btnTogglePanel?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}
