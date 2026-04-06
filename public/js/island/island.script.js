/**
 * island.script.js
 * Page entry script for the island feature. Wires tab navigation, character search,
 * and initializes island.engine.js on DOMContentLoaded. Restores the last active tab from
 * localStorage and triggers the season-calc module's post-activation hook when needed.
 */

import { init, loadModule, switchTab } from './island.engine.js';
import { getStorageItem, setStorageItem } from '../utils.js';

// ===== Initialization =====

document.addEventListener('DOMContentLoaded', async function () {
    console.log('[Island Page] Initializing...');

    // Setup tab navigation
    setupTabNavigation();

    // Setup search
    setupCharacterSearch();

    // Initialize island engine
    await init();

    // Identify and load the initial module
    const activeTabBtn = document.querySelector('.tab-button.active');
    const initialTab = activeTabBtn ? activeTabBtn.dataset.tab : 'characters';
    await loadModule(initialTab);

    // Use requestAnimationFrame to ensure the DOM is ready for the season-calc module
    // This avoids race conditions where the tab content isn't fully rendered yet
    if (initialTab === 'season-calc' && window.SeasonCalcModule) {
        requestAnimationFrame(() => {
            window.SeasonCalcModule.onTabActivated();
        });
    }

    console.log('[Island Page] Initialization complete');
});

// ===== Tab Navigation =====

/**
 * Attach click handlers to all tab buttons, update active state, and restore the last tab from localStorage.
 * Also triggers the season-calc module hook when its tab becomes active.
 */
function setupTabNavigation() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;

            // Update button states
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // Update content visibility
            tabContents.forEach(content => {
                const contentId = content.id.replace('tab-', '');
                content.classList.toggle('active', contentId === targetTab);
            });

            // Notify Engine of switch (triggers lazy load)
            if (window.IslandEngine) {
                window.IslandEngine.switchTab(targetTab);
            }

            // Notify modules when their tab is activated
            if (targetTab === 'season-calc' && window.SeasonCalcModule) {
                window.SeasonCalcModule.onTabActivated();
            }

            // Save active tab to localStorage
            setStorageItem('island-active-tab', targetTab);

            console.log(`[Island] Switched to tab: ${targetTab}`);
        });
    });

    // Restore last active tab
    const savedTab = getStorageItem('island-active-tab', null);
    if (savedTab) {
        const savedButton = document.querySelector(`.tab-button[data-tab="${savedTab}"]`);
        if (savedButton) {
            savedButton.click();
        }
    }
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
