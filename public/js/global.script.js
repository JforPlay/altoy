/**
 * global.script.js
 * Global UI behavior loaded on every page via Layout.astro.
 * Handles: navbar (theme, mobile menu, mega-menu, scroll), link routing, info popups, tooltip toggles.
 * Exports LINKS and setup functions so page scripts can re-invoke specific behaviors.
 */

import { throttle, setupScrollToTop, getStorageItem, setStorageItem, getUrlParam, getBasePath, lockBodyScroll, unlockBodyScroll } from './utils.js';

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
//
// LINKS is derived from the shared pages catalog so adding a new internal page
// only requires editing pages.catalog.js. External links live here directly.
import { PAGE_CATALOG } from './pages.catalog.js';

const EXTERNAL_LINKS = {
    EXTERNAL_HEARING: 'https://999dulgi.github.io/azurlane-hearing/ships',
    EXTERNAL_EQUIPMENT: 'https://gateisbug.github.io/alit/#/item',
    EXTERNAL_ARCA_AZUR: 'https://arca.live/b/azurlane',
    EXTERNAL_ARCA_MANJUU: 'https://arca.live/b/manjuugame',
    EXTERNAL_BUG_REPORT: 'https://arca.live/b/azurlane/148734027',
    EXTERNAL_GODROOKLYN: 'https://godrooklyn.tistory.com/',
    EXTERNAL_GITHUB: 'https://github.com/JforPlay/altoy',
};

const LINKS = {
    HOME: '',
    ...Object.fromEntries(PAGE_CATALOG.map(page => [page.key, page.path])),
    ...EXTERNAL_LINKS,
};

// ===== Main Initialization =====
document.addEventListener('DOMContentLoaded', function () {
    const savedTheme = getStorageItem('theme', 'dark');
    applyTheme(savedTheme);

    setupMobileMenu();
    setupThemeToggles();
    setupMegaMenuToggles();
    updateNavbarHeight();
    // Before the icon font loads, nav icons render as ligature text and can wrap
    // the bar taller on narrow screens — re-measure once fonts settle so
    // --navbar-height consumers (drawers, sticky offsets) don't inherit the
    // inflated pre-load height.
    if (document.fonts?.ready) document.fonts.ready.then(updateNavbarHeight);

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
 *
 * Info popups use the `.visible` class instead of `.active`, so they don't go
 * through `setupModal`. The wrapper still participates in the ref-counted
 * body-scroll lock and uses one document ESC listener for ALL popups on the page.
 */
function setupInfoPopups() {
    // Support both single button or multiple buttons
    const infoButtons = document.querySelectorAll('.info-button, #info-button');
    const infoPopups = document.querySelectorAll('.info-popup, #info-popup');
    if (!infoButtons.length || !infoPopups.length) return;

    const pairs = [];
    infoButtons.forEach((infoButton, index) => {
        const infoPopup = infoPopups[index] || infoPopups[0];
        if (infoPopup) pairs.push({ button: infoButton, popup: infoPopup });
    });
    if (!pairs.length) return;

    const openPopup = (popup) => {
        if (popup.classList.contains('visible')) return;
        popup.classList.add('visible');
        popup.setAttribute('aria-hidden', 'false');
        lockBodyScroll();
        popup.querySelector('.close-popup-btn')?.focus();
    };

    const closePopup = (popup) => {
        if (!popup.classList.contains('visible')) return;
        popup.classList.remove('visible');
        popup.setAttribute('aria-hidden', 'true');
        unlockBodyScroll();
    };

    pairs.forEach(({ button, popup }) => {
        button.addEventListener('click', () => openPopup(popup));
        popup.querySelector('.close-popup-btn')?.addEventListener('click', () => closePopup(popup));
        popup.addEventListener('click', (e) => {
            if (e.target === popup) closePopup(popup);
        });
    });

    // ONE document-level ESC listener for all popups (was N before — one per button).
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const visible = pairs.find(p => p.popup.classList.contains('visible'));
        if (visible) closePopup(visible.popup);
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
    applyTheme,
    setupThemeToggles,
    setupMegaMenuToggles,
    setupMobileMenu,
    updateNavbarHeight,
    setupInfoPopups,
    setupTooltipToggles
};
