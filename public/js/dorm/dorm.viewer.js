/**
 * dorm.viewer.js
 * Entry point for the dorm furniture simulator.
 * Creates the shared state object and passes it to dorm.data, dorm.panel,
 * and dorm.grid via their setup() calls, then wires toolbar button listeners.
 */
import { showToast, hideElement } from '../utils.js';
import { setup as setupData, loadData } from './dorm.data.js';
import { setup as setupPanel, init as initPanel } from './dorm.panel.js';
import {
    setup as setupGrid, init as initGrid,
    startDrag, cancelDrag, startPlacementMode, cancelPlacementMode,
    rotateSelected, deleteSelected, clearAll, createEmptyGrid
} from './dorm.grid.js';

// ===== Shared State =====
const state = {
    furniture: {},
    themes: {},
    searchIndex: null,
    grid: {
        cells: createEmptyGrid(),
        placed: [],
    },
    selected: null,
    selectedFurnitureId: null, // For click-to-place from panel
    comfort: 0,
    elements: {},

    // Callbacks from panel → grid
    onDragStart: (furnitureId) => startDrag(furnitureId),
    onDragEnd: () => cancelDrag(),
    onPlacementSelect: (furnitureId) => startPlacementMode(furnitureId),
    onPlacementCancel: () => {
        state.selectedFurnitureId = null;
        cancelPlacementMode();
    },
};

// ===== Initialization =====

async function init() {
    // Measure actual navbar height so CSS can compute the remaining canvas height correctly.
    const navbar = document.querySelector('.navbar');
    if (navbar) {
        document.documentElement.style.setProperty('--dorm-nav-height', navbar.offsetHeight + 'px');
    }

    cacheElements();
    setupData(state);
    setupPanel(state);
    setupGrid(state);

    const loaded = await loadData();
    if (!loaded) {
        showToast('데이터 로딩 실패', 'error');
        return;
    }

    initPanel();
    initGrid(state.elements.dormCanvas);
    setupToolbar();

    hideElement(state.elements.canvasLoading);
}

function cacheElements() {
    state.elements = {
        dormPanel: document.getElementById('dormPanel'),
        themeList: document.getElementById('themeList'),
        furnitureSearch: document.getElementById('furnitureSearch'),
        hoverInfo: document.getElementById('hoverInfo'),
        dormCanvas: document.getElementById('dormCanvas'),
        canvasLoading: document.getElementById('canvasLoading'),
        comfortValue: document.getElementById('comfortValue'),
        itemCount: document.getElementById('itemCount'),
        btnRotate: document.getElementById('btnRotate'),
        btnDelete: document.getElementById('btnDelete'),
        btnClear: document.getElementById('btnClear'),
        btnZoomIn: document.getElementById('btnZoomIn'),
        btnZoomOut: document.getElementById('btnZoomOut'),
        btnTogglePanel: document.getElementById('btnTogglePanel'),
    };
}

function setupToolbar() {
    state.elements.btnRotate.addEventListener('click', () => rotateSelected());
    state.elements.btnDelete.addEventListener('click', () => deleteSelected());
    state.elements.btnClear.addEventListener('click', () => {
        if (state.grid.placed.filter(Boolean).length === 0) return;
        if (confirm('배치된 모든 가구를 삭제할까요?')) {
            clearAll();
        }
    });
}

document.addEventListener('DOMContentLoaded', init);
