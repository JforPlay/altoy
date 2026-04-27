/**
 * dorm.panel.js
 * Left-side furniture panel for the dorm simulator: theme accordion,
 * furniture icon grid, hover info, search, and placement selection.
 * Part of the dorm module group (viewer + data + grid + panel).
 */
import { debounce } from '../utils.js';
import { getFurniture, getThemesSorted, searchFurniture, getFurnitureIconUrl, getThemeIconUrl } from './dorm.data.js';

let state;

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

function renderThemes() {
    const container = state.elements.themeList;
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const themes = getThemesSorted();

    for (const theme of themes) {
        const section = createThemeSection(theme);
        fragment.appendChild(section);
    }

    container.appendChild(fragment);
}

function createThemeSection(theme) {
    const section = document.createElement('div');
    section.className = 'theme-section' + (theme.id === 0 ? ' no-theme' : '');
    section.dataset.themeId = theme.id;

    // Header
    const header = document.createElement('div');
    header.className = 'theme-header';
    header.innerHTML = `
        <span class="theme-arrow">&#9654;</span>
        ${theme.icon
            ? `<img class="theme-icon" src="${getThemeIconUrl(theme.icon)}" alt="" loading="lazy"
                 data-onfail="hide">`
            : ''
        }
        <div class="theme-info">
            <div class="theme-name">${theme.name}</div>
            <div class="theme-meta">
                ${countPlaceableFurniture(theme)}개${theme.comfortable > 0 ? ` · +${theme.comfortable} 쾌적도` : ''}
            </div>
        </div>
    `;
    header.addEventListener('click', () => toggleTheme(section));
    section.appendChild(header);

    // Furniture grid
    const grid = document.createElement('div');
    grid.className = 'furniture-grid';

    for (const fid of theme.furnitureIds) {
        const furniture = getFurniture(fid);
        if (!furniture) continue;
        // Skip wallpaper (1) and floorpaper (4) — not placeable on grid
        if (furniture.type === 1 || furniture.type === 4) continue;
        // Skip furniture with no valid size
        if (!Array.isArray(furniture.size) || furniture.size.length < 2) continue;
        grid.appendChild(createFurnitureIcon(furniture));
    }

    section.appendChild(grid);
    return section;
}

function createFurnitureIcon(furniture) {
    const wrapper = document.createElement('div');
    wrapper.className = 'furniture-icon-wrapper';
    wrapper.dataset.furnitureId = furniture.id;
    wrapper.dataset.rarity = furniture.rarity;
    wrapper.draggable = true;
    wrapper.title = furniture.name;

    const img = document.createElement('img');
    img.className = 'furniture-icon-img';
    img.src = getFurnitureIconUrl(furniture.icon);
    img.alt = furniture.name;
    img.loading = 'lazy';
    img.onerror = function() {
        this.style.display = 'none';
        wrapper.style.fontSize = '0.6rem';
        wrapper.style.textAlign = 'center';
        wrapper.style.color = 'var(--text-secondary)';
        wrapper.textContent = furniture.name.slice(0, 4);
    };
    wrapper.appendChild(img);

    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'furniture-size-label';
    sizeLabel.textContent = `${furniture.size[0]}x${furniture.size[1]}`;
    wrapper.appendChild(sizeLabel);

    wrapper.addEventListener('mouseenter', () => showHoverInfo(furniture));
    wrapper.addEventListener('mouseleave', () => clearHoverInfo());

    wrapper.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', furniture.id);
        e.dataTransfer.effectAllowed = 'copy';
        wrapper.classList.add('dragging');
        if (state.onDragStart) state.onDragStart(furniture.id);
    });
    wrapper.addEventListener('dragend', () => {
        wrapper.classList.remove('dragging');
        if (state.onDragEnd) state.onDragEnd();
    });

    wrapper.addEventListener('click', (e) => {
        if (e.detail === 1) { // single click only
            selectForPlacement(furniture.id);
        }
    });

    return wrapper;
}

// ===== Theme Accordion =====

function toggleTheme(section) {
    section.classList.toggle('expanded');
}

// ===== Hover Info =====

function showHoverInfo(furniture) {
    const info = state.elements.hoverInfo;
    info.innerHTML = `
        <div class="hover-info-name">${furniture.name}</div>
        <div class="hover-info-details">
            ${furniture.typeName} · ${furniture.size[0]}x${furniture.size[1]}
            · 쾌적도 ${furniture.comfortable}
            · ${'★'.repeat(furniture.rarity)}
        </div>
    `;
}

function clearHoverInfo() {
    state.elements.hoverInfo.innerHTML =
        '<div class="hover-info-placeholder">가구에 마우스를 올려보세요</div>';
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

    for (const section of sections) {
        const icons = section.querySelectorAll('.furniture-icon-wrapper');
        let visibleCount = 0;

        for (const icon of icons) {
            const fid = Number(icon.dataset.furnitureId);
            const visible = matchIds === null || matchIds.has(fid);
            icon.style.display = visible ? '' : 'none';
            if (visible) visibleCount++;
        }

        // Hide empty themes, expand themes with matches
        section.style.display = visibleCount === 0 ? 'none' : '';
        if (matchIds !== null && visibleCount > 0) {
            section.classList.add('expanded');
        }
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
    if (prev) prev.classList.remove('selected');

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
    if (el) el.classList.add('selected');
    if (state.onPlacementSelect) state.onPlacementSelect(furnitureId);
}

// ===== Mobile Panel Toggle =====

function setupPanelToggle() {
    const toggleBtn = state.elements.btnTogglePanel;
    const panel = state.elements.dormPanel;

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            panel.classList.toggle('expanded');
        });
    }

    const header = panel.querySelector('.panel-header');
    header.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && e.target === header) {
            panel.classList.toggle('expanded');
        }
    });
}
