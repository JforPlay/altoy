// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Safely get item from localStorage
 * Handles private browsing mode and permission errors
 * @param {string} key - Storage key
 * @param {string} defaultValue - Default if unavailable
 * @returns {string} Stored value or default
 */
function getStorageItem(key, defaultValue) {
    try {
        return localStorage.getItem(key) || defaultValue;
    } catch (e) {
        console.warn('[Nav] localStorage unavailable:', e);
        return defaultValue;
    }
}

/**
 * Safely set item in localStorage
 * Handles private browsing mode and permission errors
 * @param {string} key - Storage key
 * @param {string} value - Value to store
 */
function setStorageItem(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        console.warn('[Nav] localStorage unavailable:', e);
    }
}

// ============================================
// CENTRALIZED LINK CONFIGURATION
// ============================================
const LINKS = {
    // Main Pages
    HOME: 'index.html',

    // Shipgirl
    SHIPGIRL_INFO: 'pages/shipgirl/shipgirl-info.html',
    SHIPGIRL_TRACKER: 'pages/shipgirl/shipgirl-tracker.html',
    SHIPGIRL_BUILD: 'pages/shipgirl/shipgirl-build-sim.html',
    SHIPGIRL_BIRTHDAY: 'pages/shipgirl/shipgirl-birthday.html',

    // Skin
    SKIN_DETAIL: 'pages/skin/skin-detail-viewer.html',
    SKIN_LIST: 'pages/skin/skin-list-viewer.html',
    SKIN_POLL: 'pages/skin/skin-poll.html',
    SKIN_SD: 'pages/skin/skin-sd-viewer.html',
    SKIN_EXPRESSION: 'pages/skin/expression-viewer.html',

    // Chat & Social
    JUUSTAGRAM: 'pages/juustagram.html',
    CHAT_JUUS: 'pages/chat-viewer/juus.html',
    CHAT_DORM3D: 'pages/chat-viewer/dorm3d.html',

    // Story
    MAIN_STORY: 'pages/story-viewer/main-story.html',
    MAIN_STORYLINE: 'pages/story-viewer/main-storyline.html',
    WORLD_STORY: 'pages/story-viewer/world-story.html',
    WORLD_FILE: 'pages/story-viewer/world-file.html',
    NAVI_STORY: 'pages/story-viewer/navi-story.html',
    TB_STORY: 'pages/story-viewer/tb-story.html',
    SECRETARY_STORY: 'pages/story-viewer/secretary-story.html',
    HOF: 'pages/story-viewer/hof.html',

    // Misc
    EVENT_TIMELINE: 'pages/event-timeline.html',
    COMIC_VIEWER: 'pages/misc/comic-viewer.html',
    LOADINGBG: 'pages/misc/loadingbg.html',
    GALLERYPIC: 'pages/misc/gallerypic.html',
    BGM_PLAYER: 'pages/misc/bgm-player.html',

    // Simulators
    SIM_WEAPON: 'pages/simulators/sim-weapon.html',

    // Island
    ISLAND: 'pages/island/island.html',

    // External Links
    EXTERNAL_HEARING: 'https://999dulgi.github.io/azurlane-hearing/ships',
    EXTERNAL_EQUIPMENT: 'https://gateisbug.github.io/alit/#/item',
    EXTERNAL_ARCA_AZUR: 'https://arca.live/b/azurlane',
    EXTERNAL_ARCA_MANJUU: 'https://arca.live/b/manjuugame',
    EXTERNAL_BUG_REPORT: 'https://arca.live/b/azurlane/148734027',
    EXTERNAL_GODROOKLYN: 'https://godrooklyn.tistory.com/',
    EXTERNAL_GITHUB: 'https://github.com/JforPlay/altoy'
};

// ============================================
// LINK INITIALIZATION
// ============================================
function initLinks() {
    const linkElements = document.querySelectorAll('[data-link]');

    linkElements.forEach(el => {
        const linkKey = el.getAttribute('data-link');
        if (LINKS[linkKey]) {
            el.href = LINKS[linkKey];
        } else {
            console.warn(`[Links] Key not found: "${linkKey}"`);
            el.href = '#';
        }
    });
}

// ============================================
// MAIN INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', function () {
    // Apply saved theme or default to dark mode
    const savedTheme = getStorageItem('theme', 'dark');
    applyTheme(savedTheme);

    // Setup interactive elements
    setupMobileMenu();
    setupThemeToggles();
    setupMegaMenuToggles();
    updateNavbarHeight();

    // Initialize links
    initLinks();

    // Setup scroll listener for navbar with throttling (performance optimization)
    const navbar = document.querySelector('.navbar');
    if (navbar) {
        const handleNavbarScroll = throttle(() => {
            navbar.classList.toggle('scrolled', window.scrollY > 50);
        }, 100);
        window.addEventListener('scroll', handleNavbarScroll);
    }

    // Initialize scroll-to-top button
    setupScrollToTop();

    // Initialize info popups
    setupInfoPopups();

    // Initialize tooltip toggles
    setupTooltipToggles();
});

/**
 * Applies the specified theme to the entire page.
 * @param {string} theme - The theme to apply ('light' or 'dark').
 */
function applyTheme(theme) {
    document.body.classList.toggle('dark-mode', theme === 'dark');

    // Apply the correct light/dark class to navbar
    const navbar = document.querySelector('.navbar');
    if (navbar) {
        navbar.classList.toggle('navbar-light', theme !== 'dark');
    }

    // Update all theme toggle icons
    document.querySelectorAll('.theme-toggle').forEach(toggle => {
        const sunIcon = toggle.querySelector('.theme-icon-sun');
        const moonIcon = toggle.querySelector('.theme-icon-moon');

        if (sunIcon) sunIcon.classList.toggle('theme-icon-hidden', theme !== 'dark');
        if (moonIcon) moonIcon.classList.toggle('theme-icon-hidden', theme === 'dark');
    });
}

/**
 * Attaches click event listeners to all theme toggle buttons
 * Persists theme preference to localStorage
 */
function setupThemeToggles() {
    document.querySelectorAll('.theme-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const newTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
            setStorageItem('theme', newTheme);
            applyTheme(newTheme);
        });
    });
}

/**
 * Setup mega menu toggles for mobile (accordion style)
 * On desktop: hover to open (handled by CSS)
 * On mobile: click to toggle accordion
 */
function setupMegaMenuToggles() {
    const megaDropdowns = document.querySelectorAll('.mega-dropdown');

    megaDropdowns.forEach(dropdown => {
        const toggleLink = dropdown.querySelector('.nav-links');

        toggleLink?.addEventListener('click', (event) => {
            // Only handle on mobile (≤768px)
            if (window.innerWidth <= 768) {
                event.preventDefault();

                const isActive = dropdown.classList.contains('active');

                // Close all other dropdowns (accordion behavior)
                megaDropdowns.forEach(d => d.classList.remove('active'));

                // Toggle this dropdown
                if (!isActive) {
                    dropdown.classList.add('active');
                }
            }
        });
    });

    // Close all dropdowns when clicking outside nav menu
    document.addEventListener('click', (event) => {
        if (window.innerWidth <= 768 && !event.target.closest('.nav-menu')) {
            megaDropdowns.forEach(d => d.classList.remove('active'));
        }
    });
}

/**
 * Setup mobile hamburger menu toggle
 * Toggles mobile menu and hamburger icon animation
 */
function setupMobileMenu() {
    const menuIcon = document.querySelector('.menu-icon');
    const navMenu = document.querySelector('.nav-menu');
    if (menuIcon && navMenu) {
        menuIcon.addEventListener('click', () => {
            navMenu.classList.toggle('active');
            menuIcon.classList.toggle('active');
        });
    }
}

/**
 * Update CSS custom property with navbar height
 * Useful for pages that need to offset content below fixed navbar
 */
function updateNavbarHeight() {
    const navbar = document.querySelector('.navbar');
    if (navbar) {
        const navbarHeight = navbar.offsetHeight;
        document.documentElement.style.setProperty('--navbar-height', `${navbarHeight}px`);
    }
}

/**
 * Setup info popup functionality
 * Handles opening/closing info popups with keyboard and click events
 * Applies to pages that have .info-button and .info-popup elements
 */
function setupInfoPopups() {
    // Support both single button or multiple buttons
    const infoButtons = document.querySelectorAll('.info-button, #info-button');
    const infoPopups = document.querySelectorAll('.info-popup, #info-popup');

    infoButtons.forEach((infoButton, index) => {
        if (!infoButton) return;

        // Find corresponding popup (either by index or just use the first one)
        const infoPopup = infoPopups[index] || infoPopups[0];
        if (!infoPopup) return;

        const closePopupBtn = infoPopup.querySelector('.close-popup-btn');

        const openPopup = () => {
            infoPopup.classList.add('visible');
            infoPopup.setAttribute('aria-hidden', 'false');
            document.body.classList.add('no-scroll');
            if (closePopupBtn) closePopupBtn.focus();
        };

        const closePopup = () => {
            infoPopup.classList.remove('visible');
            infoPopup.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('no-scroll');
        };

        // Button click to open
        infoButton.addEventListener('click', openPopup);

        // Close button click
        if (closePopupBtn) {
            closePopupBtn.addEventListener('click', closePopup);
        }

        // Click outside to close
        infoPopup.addEventListener('click', (e) => {
            if (e.target === infoPopup) closePopup();
        });

        // ESC key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && infoPopup.classList.contains('visible')) {
                closePopup();
            }
        });
    });
}

/**
 * Setup tooltip toggle functionality
 * Toggles visibility of info tooltips with fade-in/out animation
 * Uses data-tooltip-target attribute to link button to tooltip
 *
 * Usage:
 * <button class="tooltip-toggle-button" data-tooltip-target="myTooltip">
 *   <span class="material-symbols-outlined">help</span>
 * </button>
 * <div class="info-tooltip" id="myTooltip">
 *   <div class="tooltip-content">
 *     <h4>Title</h4>
 *     <p>Content</p>
 *   </div>
 * </div>
 */
function setupTooltipToggles() {
    const tooltipButtons = document.querySelectorAll('.tooltip-toggle-button');

    tooltipButtons.forEach(button => {
        const targetId = button.getAttribute('data-tooltip-target');
        if (!targetId) return;

        const tooltip = document.getElementById(targetId);
        if (!tooltip) return;

        button.addEventListener('click', (e) => {
            e.stopPropagation();

            // Close all other tooltips
            document.querySelectorAll('.info-tooltip.visible').forEach(otherTooltip => {
                if (otherTooltip !== tooltip) {
                    otherTooltip.classList.remove('visible');
                }
            });

            // Toggle this tooltip
            tooltip.classList.toggle('visible');
        });
    });

    // Close tooltips when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.tooltip-toggle-button') && !e.target.closest('.info-tooltip')) {
            document.querySelectorAll('.info-tooltip.visible').forEach(tooltip => {
                tooltip.classList.remove('visible');
            });
        }
    });

    // Close tooltips on ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.info-tooltip.visible').forEach(tooltip => {
                tooltip.classList.remove('visible');
            });
        }
    });
}

// ============================================
// RESIZE HANDLER
// ============================================

/**
 * Update navbar height on window resize (debounced)
 * Prevents excessive updates during resize
 */
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(updateNavbarHeight, 100);
});