/**
 * island.script.js
 * Page entry script for the island feature. Wires tab navigation, character search,
 * and initializes island.engine.js on DOMContentLoaded. After core init completes,
 * activates the last-used tab (from localStorage) or the default 'characters' tab.
 */

import { init } from './island.engine.js';
import { getStorageItem } from '../utils.js';

// ===== Initialization =====

document.addEventListener('DOMContentLoaded', async function () {
    console.log('[Island Page] Initializing...');

    setupTabNavigation();
    setupCharacterSearch();

    // Initialize island engine (loads shared data) before activating any tab.
    // Activating before init would race with module load and force defensive
    // re-render hooks in dependent modules — see island.engine.js loadModule.
    await init();

    // activateTab normalizes invalid/missing values, syncs tab DOM/ARIA, and
    // persists via switchTab — same path manual clicks take.
    window.IslandEngine.activateTab(getStorageItem('island-active-tab', null));

    console.log('[Island Page] Initialization complete');
});

// ===== Tab Navigation =====

/**
 * Attach click handlers to all tab buttons. Saved-tab restoration happens
 * separately, after init() — see DOMContentLoaded above.
 */
function setupTabNavigation() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach((button, index) => {
        const isActive = button.classList.contains('active');
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-controls', `tab-${button.dataset.tab}`);
        button.setAttribute('aria-selected', String(isActive));
        button.tabIndex = isActive ? 0 : -1;

        button.addEventListener('click', () => {
            window.IslandEngine?.activateTab(button.dataset.tab);
        });

        button.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const direction = e.key === 'ArrowRight' ? 1 : -1;
            const nextIndex = (index + direction + tabButtons.length) % tabButtons.length;
            tabButtons[nextIndex].focus();
            tabButtons[nextIndex].click();
        });
    });

    tabContents.forEach(content => {
        const isActive = content.classList.contains('active');
        content.setAttribute('role', 'tabpanel');
        content.setAttribute('aria-hidden', String(!isActive));
        content.hidden = !isActive;
    });
}

// ===== Character Search =====

/** Wire the character search input with debouncing and ESC-to-clear. */
function setupCharacterSearch() {
    const searchInput = document.getElementById('character-search');
    if (!searchInput) return;

    let searchTimeout;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value;

        // Debounce search
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            performSearch(query);
        }, 300);
    });

    // Clear search on ESC
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            performSearch('');
        }
    });
}

/** Run a character search and re-render the character list with the results. */
function performSearch(query) {
    if (!window.IslandEngine) return;

    const results = window.IslandEngine.searchCharacters(query);
    window.IslandEngine.renderCharacterList(results);

    console.log(`[Island] Search: "${query}" - ${results.length} results`);
}
