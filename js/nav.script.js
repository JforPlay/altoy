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

    // Default to dark mode
    applyTheme(localStorage.getItem('theme') || 'dark');

    loadNavbar();
    loadFooter();

    // Initialize links after DOM is loaded
    initLinks();
});

/**
 * Applies the specified theme to the entire page.
 * @param {string} theme - The theme to apply ('light' or 'dark').
 */
function applyTheme(theme) {
    document.body.classList.toggle('dark-mode', theme === 'dark');

    // Find the navbar and apply the correct light/dark class
    const navbar = document.querySelector('#navbar-placeholder .navbar');
    if (navbar) {
        navbar.classList.toggle('navbar-light', theme !== 'dark');
    }

    // Update all theme toggle icons on the page
    document.querySelectorAll('.theme-toggle').forEach(toggle => {
        const sunIcon = toggle.querySelector('.theme-icon-sun');
        const moonIcon = toggle.querySelector('.theme-icon-moon');

        // Show the sun icon when in dark mode, hide it in light mode.
        if (sunIcon) sunIcon.classList.toggle('theme-icon-hidden', theme !== 'dark');

        // Show the moon icon when in light mode, hide it in dark mode.
        if (moonIcon) moonIcon.classList.toggle('theme-icon-hidden', theme === 'dark');
    });
}

/**
 * Attaches click event listeners to all theme toggle buttons.
 */
function setupThemeToggles() {
    document.querySelectorAll('.theme-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const newTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
            localStorage.setItem('theme', newTheme);
            applyTheme(newTheme);
        });
    });
}

/**
 * Navigation bar loading and setup
 */
function loadNavbar() {
    fetch('pages/layouts/nav.html')
        .then(response => response.text())
        .then(data => {
            const navbarPlaceholder = document.getElementById('navbar-placeholder');
            if (navbarPlaceholder) {
                navbarPlaceholder.innerHTML = data;
            }

            // After navbar is loaded, set up its interactive elements
            setupMobileMenu();
            setupThemeToggles();
            setupMegaMenuToggles();
            updateNavbarHeight();

            // Re-apply theme to ensure the loaded navbar gets the right class
            applyTheme(localStorage.getItem('theme') || 'dark');

            // Initialize links in the navbar after it's loaded
            initLinks();

            // Setup scroll listener after navbar is loaded
            const navbar = document.querySelector('.navbar');
            if (navbar) {
                window.addEventListener('scroll', () => {
                    if (window.scrollY > 50) {
                        navbar.classList.add('scrolled');
                    } else {
                        navbar.classList.remove('scrolled');
                    }
                });
            }
        })
        .catch(error => console.error('Error loading the navigation bar:', error));
}

// Footer loading
function loadFooter() {
    fetch('pages/layouts/footer.html')
        .then(response => {
            if (!response.ok) throw new Error('Network response was not ok');
            return response.text();
        })
        .then(data => {
            const footerPlaceholder = document.getElementById('footer-placeholder');
            if (footerPlaceholder) {
                footerPlaceholder.innerHTML = data;
                const copyrightYear = document.getElementById('copyright-year');
                if (copyrightYear) {
                    copyrightYear.textContent = new Date().getFullYear();
                }
            }
        })
        .catch(error => console.error('Error loading the footer:', error));
}

/**
 * Setup mega menu toggles for mobile (accordion style)
 */
function setupMegaMenuToggles() {
    const megaDropdowns = document.querySelectorAll('.mega-dropdown');

    megaDropdowns.forEach(dropdown => {
        const toggleLink = dropdown.querySelector('.nav-links');

        toggleLink.addEventListener('click', function(event) {
            // Prevent default link behavior
            event.preventDefault();

            // Mobile-only accordion behavior
            if (window.innerWidth <= 768) {
                const wasActive = dropdown.classList.contains('active');

                // Close all mega dropdowns
                document.querySelectorAll('.mega-dropdown').forEach(d => d.classList.remove('active'));

                // Toggle the clicked dropdown
                if (!wasActive) {
                    dropdown.classList.add('active');
                }
            }
        });
    });

    // Close mega menus when clicking outside on mobile
    document.addEventListener('click', function(event) {
        if (window.innerWidth <= 768) {
            const isClickInsideMenu = event.target.closest('.mega-dropdown');
            if (!isClickInsideMenu) {
                document.querySelectorAll('.mega-dropdown').forEach(d => d.classList.remove('active'));
            }
        }
    });
}

function setupMobileMenu() {
    const menuIcon = document.querySelector('.menu-icon');
    const navMenu = document.querySelector('.nav-menu');
    if (menuIcon && navMenu) {
        menuIcon.addEventListener('click', () => {
            navMenu.classList.toggle('active');
        });
    }
}

function updateNavbarHeight() {
    const navbar = document.querySelector('.navbar');
    if (navbar) {
        const navbarHeight = navbar.offsetHeight;
        document.documentElement.style.setProperty('--navbar-height', `${navbarHeight}px`);
    }
}

// Update navbar height on window resize
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(updateNavbarHeight, 100);
});