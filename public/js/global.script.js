/**
 * global.script.js
 * Global UI behavior loaded on every page via Layout.astro.
 * Handles: navbar (theme, mobile menu, mega-menu, scroll), link routing, info popups, tooltip toggles.
 * Exports LINKS and setup functions so page scripts can re-invoke specific behaviors.
 */

import { throttle, setupScrollToTop, getStorageItem, setStorageItem, getUrlParam, getBasePath } from './utils.js';

// ===== Drive Sync Feature Flag =====
//
// Sync is LIVE for everyone by default (OAuth verification cleared 2026-04-23).
// Per-device opt-out: ?sync=off stores 'off' in altoy:sync:beta; re-enable with ?sync=on.
// altoy:sync:beta values: '' / unset = default, 'on' = explicit on, 'off' = explicit off.
const DEFAULT_SYNC_ENABLED = true;

const syncParam = getUrlParam('sync');
if (syncParam === '1' || syncParam === 'on') setStorageItem('altoy:sync:beta', 'on');
if (syncParam === '0' || syncParam === 'off') setStorageItem('altoy:sync:beta', 'off');

const syncPref = getStorageItem('altoy:sync:beta', '');
const SYNC_UI_ENABLED =
    syncPref === 'on' ? true :
    syncPref === 'off' ? false :
    DEFAULT_SYNC_ENABLED;

if (SYNC_UI_ENABLED) {
    const mount = () => {
        import('./sync/drive-sync.ui.js')
            .then(mod => mod.mountSyncUI())
            .catch(err => console.warn('Drive sync UI failed to mount:', err));
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
}

// ===== Centralized Link Configuration =====
const LINKS = {
    // Main Pages
    HOME: '',

    // Shipgirl
    SHIPGIRL_INFO: 'shipgirl/shipgirl-info/',
    SHIPGIRL_TRACKER: 'shipgirl/shipgirl-tracker/',
    SHIPGIRL_BUILD: 'shipgirl/shipgirl-build-sim/',
    SHIPGIRL_BIRTHDAY: 'shipgirl/shipgirl-birthday/',
    RESEARCH_TRACKER: 'shipgirl/research-tracker/',

    // Skin
    SKIN_DETAIL: 'skin/skin-detail-viewer/',
    SKIN_LIST: 'skin/skin-list-viewer/',
    SKIN_POLL: 'skin/skin-poll/',
    SKIN_SD: 'skin/skin-sd-viewer/',
    SKIN_EXPRESSION: 'skin/expression-viewer/',

    // Chat & Social
    JUUSTAGRAM: 'juustagram/',
    CHAT_JUUS: 'chat-viewer/juus/',
    CHAT_DORM3D: 'chat-viewer/dorm3d/',

    // Story
    MAIN_STORY: 'story-viewer/main-story/',
    MAIN_STORYLINE: 'story-viewer/main-storyline/',
    WORLD_STORY: 'story-viewer/world-story/',
    WORLD_FILE: 'story-viewer/world-file/',
    NAVI_STORY: 'story-viewer/navi-story/',
    TB_STORY: 'story-viewer/tb-story/',
    LORA_STORY: 'story-viewer/lora-story/',
    SECRETARY_STORY: 'story-viewer/secretary-story/',
    HOF: 'story-viewer/hof/',

    // Misc
    EVENT_TIMELINE: 'event-timeline/',
    COMIC_VIEWER: 'misc/comic-viewer/',
    LOADINGBG: 'misc/loadingbg/',
    GALLERYPIC: 'misc/gallerypic/',
    BGM_PLAYER: 'misc/bgm-player/',

    // Simulators
    SIM_WEAPON: 'simulators/sim-weapon/',

    // Equip
    EQUIP_VIEWER: 'equip/equip-viewer/',

    // Island
    ISLAND: 'island/',

    // External Links
    EXTERNAL_HEARING: 'https://999dulgi.github.io/azurlane-hearing/ships',
    EXTERNAL_EQUIPMENT: 'https://gateisbug.github.io/alit/#/item',
    EXTERNAL_ARCA_AZUR: 'https://arca.live/b/azurlane',
    EXTERNAL_ARCA_MANJUU: 'https://arca.live/b/manjuugame',
    EXTERNAL_BUG_REPORT: 'https://arca.live/b/azurlane/148734027',
    EXTERNAL_GODROOKLYN: 'https://godrooklyn.tistory.com/',
    EXTERNAL_GITHUB: 'https://github.com/JforPlay/altoy'
};

/**
 * Resolve all [data-link] anchors on the page to their full URLs.
 * Reads the LINKS constant above and prepends the correct base path for GitHub Pages.
 */
function initLinks() {
    const base = getBasePath();
    const linkElements = document.querySelectorAll('[data-link]');

    linkElements.forEach(el => {
        const linkKey = el.getAttribute('data-link');
        if (LINKS[linkKey]) {
            const url = LINKS[linkKey];
            el.href = url.startsWith('http') ? url : `${base}/${url}`;
        } else {
            console.warn(`[Links] Key not found: "${linkKey}"`);
            el.href = '#';
        }
    });
}

// ===== Main Initialization =====
document.addEventListener('DOMContentLoaded', function () {
    const savedTheme = getStorageItem('theme', 'dark');
    applyTheme(savedTheme);

    setupMobileMenu();
    setupThemeToggles();
    setupMegaMenuToggles();
    updateNavbarHeight();
    initLinks();

    const navbar = document.querySelector('.navbar');
    if (navbar) {
        const handleNavbarScroll = throttle(() => {
            navbar.classList.toggle('scrolled', window.scrollY > 50);
        }, 100);
        window.addEventListener('scroll', handleNavbarScroll, { passive: true });
    }

    setupScrollToTop();
    setupInfoPopups();
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

        infoButton.addEventListener('click', openPopup);

        if (closePopupBtn) {
            closePopupBtn.addEventListener('click', closePopup);
        }

        infoPopup.addEventListener('click', (e) => {
            if (e.target === infoPopup) closePopup();
        });

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
let tooltipGlobalListenersBound = false;

function closeVisibleTooltips() {
    document.querySelectorAll('.info-tooltip.visible').forEach(tooltip => {
        tooltip.classList.remove('visible');
    });
}

function setupTooltipToggles() {
    const tooltipButtons = document.querySelectorAll('.tooltip-toggle-button');

    tooltipButtons.forEach(button => {
        if (button.dataset.tooltipToggleBound === 'true') return;

        const targetId = button.getAttribute('data-tooltip-target');
        if (!targetId) return;

        const tooltip = document.getElementById(targetId);
        if (!tooltip) return;

        button.addEventListener('click', (e) => {
            e.stopPropagation();

            // Close all other open tooltips before toggling this one (one-at-a-time behavior)
            document.querySelectorAll('.info-tooltip.visible').forEach(otherTooltip => {
                if (otherTooltip !== tooltip) otherTooltip.classList.remove('visible');
            });

            tooltip.classList.toggle('visible');
        });

        button.dataset.tooltipToggleBound = 'true';
    });

    if (tooltipGlobalListenersBound) return;

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.tooltip-toggle-button') && !e.target.closest('.info-tooltip')) {
            closeVisibleTooltips();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeVisibleTooltips();
        }
    });

    tooltipGlobalListenersBound = true;
}

// ===== Resize Handler =====

/**
 * Update navbar height on window resize (debounced).
 * Keeps --navbar-height accurate for pages that offset content below the fixed bar.
 */
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(updateNavbarHeight, 100);
});

// ===== ES Module Exports =====
export {
    getStorageItem,
    setStorageItem,
    LINKS,
    initLinks,
    applyTheme,
    setupThemeToggles,
    setupMegaMenuToggles,
    setupMobileMenu,
    updateNavbarHeight,
    setupInfoPopups,
    setupTooltipToggles
};
