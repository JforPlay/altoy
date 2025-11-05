/**
 * Island Page Script
 * Initializes the island page and handles tab navigation, search, etc.
 */

(function () {
    'use strict';

    // ============================================
    // INITIALIZATION
    // ============================================

    document.addEventListener('DOMContentLoaded', async function () {
        console.log('[Island Page] Initializing...');

        // Setup tab navigation
        setupTabNavigation();

        // Setup search
        setupCharacterSearch();

        // Initialize island engine
        await IslandEngine.init();

        console.log('[Island Page] Initialization complete');
    });

    // ============================================
    // TAB NAVIGATION
    // ============================================

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

                // Save active tab to localStorage
                try {
                    localStorage.setItem('island-active-tab', targetTab);
                } catch (e) {
                    console.warn('[Island] Could not save tab state:', e);
                }

                console.log(`[Island] Switched to tab: ${targetTab}`);
            });
        });

        // Restore last active tab
        try {
            const savedTab = localStorage.getItem('island-active-tab');
            if (savedTab) {
                const savedButton = document.querySelector(`.tab-button[data-tab="${savedTab}"]`);
                if (savedButton) {
                    savedButton.click();
                }
            }
        } catch (e) {
            console.warn('[Island] Could not restore tab state:', e);
        }
    }

    // ============================================
    // CHARACTER SEARCH
    // ============================================

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

    function performSearch(query) {
        const results = IslandEngine.searchCharacters(query);
        IslandEngine.renderCharacterList(results);

        console.log(`[Island] Search: "${query}" - ${results.length} results`);
    }

})();
