/**
 * island.script.js
 * Page entry script for the island feature. Wires tab navigation, character search,
 * and initializes island.engine.js on DOMContentLoaded. After core init completes,
 * activates the last-used tab (from localStorage) or the default 'characters' tab.
 */

import { init } from './island.engine.js';
import { getStorageItem, setStorageItem } from '../utils.js';

// ===== Initialization =====

document.addEventListener('DOMContentLoaded', async function () {
    console.log('[Island Page] Initializing...');

    setupTabNavigation();
    setupCharacterSearch();

    // Initialize island engine (loads shared data) before activating any tab.
    // Activating before init would race with module load and force defensive
    // re-render hooks in dependent modules — see island.engine.js loadModule.
    await init();

    // Restore the saved tab (or default) via the same activation path as a
    // manual click: programmatic click → click handler → switchTab → loadModule.
    const savedTab = getStorageItem('island-active-tab', null);
    const savedButton = savedTab
        ? document.querySelector(`.tab-button[data-tab="${savedTab}"]`)
        : null;
    const initialTab = savedButton ? savedTab : 'characters';
    window.IslandEngine.activateTab(initialTab);

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

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;

            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            tabContents.forEach(content => {
                const contentId = content.id.replace('tab-', '');
                content.classList.toggle('active', contentId === targetTab);
            });

            if (window.IslandEngine) {
                window.IslandEngine.switchTab(targetTab);
            }

            setStorageItem('island-active-tab', targetTab);

            console.log(`[Island] Switched to tab: ${targetTab}`);
        });
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
    const results = window.IslandEngine.searchCharacters(query);
    window.IslandEngine.renderCharacterList(results);

    console.log(`[Island] Search: "${query}" - ${results.length} results`);
}
