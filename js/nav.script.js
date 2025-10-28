// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Throttle function execution for performance
 * Limits function calls to once per delay period
 * @param {Function} func - Function to throttle
 * @param {number} delay - Minimum delay between calls (ms)
 * @returns {Function} Throttled function
 */
function throttle(func, delay) {
    let timeout = null;
    return function(...args) {
        if (timeout) return;
        timeout = setTimeout(() => {
            func.apply(this, args);
            timeout = null;
        }, delay);
    };
}

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

    // Shipgirl & Skin
    SHIPGIRL_INFO: 'pages/shipgirl/shipgirl-info.html',
    SHIPGIRL_TRACKER: 'pages/shipgirl/shipgirl-tracker.html',
    SHIPGIRL_BUILD: 'pages/shipgirl-build-sim.html',
    SKIN_DETAIL: 'pages/skin/skin-detail-viewer.html',
    SKIN_LIST: 'pages/skin/skin-list-viewer.html',
    SKIN_POLL: 'pages/skin/skin-poll.html',
    SKIN_SD: 'pages/skin/skin-sd-viewer.html',

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
    HOF: 'pages/story-viewer/hof.html',

    // Misc
    EVENT_TIMELINE: 'pages/event-timeline.html',
    COMIC_VIEWER: 'pages/misc/comic-viewer.html',
    LOADINGBG: 'pages/misc/loadingbg.html',
    GALLERYPIC: 'pages/misc/gallerypic.html',
    BGM_PLAYER: 'pages/misc/bgm-player.html',

    // Simulators
    SIM_WEAPON: 'pages/simulators/sim-weapon.html',

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
 * Setup scroll-to-top button functionality
 * Shows button when user scrolls down 300px, hides when at top
 * Applies to pages that have #scroll-to-top element in HTML
 */
function setupScrollToTop() {
    const scrollToTopBtn = document.getElementById('scroll-to-top');
    if (!scrollToTopBtn) return; // Exit gracefully if button doesn't exist

    // Show/hide button based on scroll position
    const toggleButton = () => {
        if (window.scrollY > 300) {
            scrollToTopBtn.classList.remove('hidden');
        } else {
            scrollToTopBtn.classList.add('hidden');
        }
    };

    // Scroll to top with smooth animation
    const scrollToTop = () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    };

    // Throttled scroll handler for better performance
    const throttledToggle = throttle(toggleButton, 100);
    window.addEventListener('scroll', throttledToggle);

    // Click handler
    scrollToTopBtn.addEventListener('click', scrollToTop);

    // Initial visibility check
    toggleButton();
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