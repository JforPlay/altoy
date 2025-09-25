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
            setupDropdownToggles();
            updateNavbarHeight();

            // Re-apply theme to ensure the loaded navbar gets the right class
            applyTheme(localStorage.getItem('theme') || 'dark');
        })
        .catch(error => console.error('Error loading the navigation bar:', error));
}

// Added footer
function loadFooter() {
    fetch('pages/layouts/footer.html')
        .then(response => {
            if (!response.ok) throw new Error('Network response was not ok');
            return response.text();
        })
        .then(data => {
            const footerPlaceholder = document.getElementById('footer-placeholder');
            if (footerPlaceholder) { // Check if the element exists
                footerPlaceholder.innerHTML = data;
                // Automatically set the current year
                const copyrightYear = document.getElementById('copyright-year');
                if (copyrightYear) {
                    copyrightYear.textContent = new Date().getFullYear();
                }
            }
        })
        .catch(error => console.error('Error loading the footer:', error));
}

function setupDropdownToggles() {
    const dropdowns = document.querySelectorAll('.nav-item.dropdown');

    dropdowns.forEach(dropdown => {
        const toggleLink = dropdown.querySelector('.nav-links');

        toggleLink.addEventListener('click', function(event) {
            // This prevents the page from jumping to the top from the href="#"
            event.preventDefault();

            // This mobile-only logic toggles the dropdown on tap
            if (window.innerWidth <= 768) {
                // Check if the current dropdown is already open
                const wasActive = dropdown.classList.contains('active');

                // First, close all dropdowns to ensure only one is open at a time
                document.querySelectorAll('.nav-item.dropdown').forEach(d => d.classList.remove('active'));

                // If the clicked dropdown wasn't already open, open it
                if (!wasActive) {
                    dropdown.classList.add('active');
                }
            }
        });
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