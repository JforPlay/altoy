document.addEventListener('DOMContentLoaded', function () {
    const iconFontId = 'google-material-icons';
    if (!document.getElementById(iconFontId)) {
        const link = document.createElement('link');
        link.id = iconFontId;
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
        document.head.appendChild(link);
    }
    
    // Apply the theme as soon as the DOM is loaded
    applyTheme(localStorage.getItem('theme') || 'dark');

    loadNavbar();
    loadFooter(); // This was in your original code, keep if needed
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
        
        // --- THIS IS THE UPDATED LOGIC ---
        // Show the sun icon when in dark mode, hide it in light mode.
        if (sunIcon) sunIcon.classList.toggle('hidden', theme !== 'dark');
        
        // Show the moon icon when in light mode, hide it in dark mode.
        if (moonIcon) moonIcon.classList.toggle('hidden', theme === 'dark');
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

function loadNavbar() {
    // Assuming nav.html is at the root or a known path. Adjust if necessary.
    fetch('pages/layouts/nav.html') 
        .then(response => response.text())
        .then(data => {
            const navbarPlaceholder = document.getElementById('navbar-placeholder');
            if (navbarPlaceholder) {
                navbarPlaceholder.innerHTML = data;
            }

            // After navbar is loaded, set up its interactive elements
            setupMobileMenu();
            setupThemeToggles(); // Setup theme toggles within the navbar AND on the page
            updateNavbarHeight();

            // Re-apply theme to ensure the loaded navbar gets the right class
            applyTheme(localStorage.getItem('theme') || 'dark');
        })
        .catch(error => console.error('Error loading the navigation bar:', error));
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