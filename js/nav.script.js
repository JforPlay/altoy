document.addEventListener('DOMContentLoaded', function () {
    const iconFontId = 'google-material-icons';
    if (!document.getElementById(iconFontId)) {
        const link = document.createElement('link');
        link.id = iconFontId;
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
        document.head.appendChild(link);
    }
    // Corrected to call both functions at the same level
    loadNavbar();
    loadFooter();
});

function loadNavbar() {
    fetch('pages/layouts/nav.html')
        .then(response => response.text())
        .then(data => {
            document.getElementById('navbar-placeholder').innerHTML = data;

            const menuIcon = document.querySelector('.menu-icon');
            const navMenu = document.querySelector('.nav-menu');
            if (menuIcon && navMenu) {
                menuIcon.addEventListener('click', () => {
                    navMenu.classList.toggle('active');
                });
            }

            const navbar = document.querySelector('.navbar');

            if (navbar) {
                const navbarHeight = navbar.offsetHeight;
                document.documentElement.style.setProperty('--navbar-height', `${navbarHeight}px`);
            }

            // Apply special navbar theme if on the right page
            const currentPage = window.location.pathname.split("/").pop();
            if (currentPage === 'ins-viewer.html') {
                const navbar = document.querySelector('.navbar');
                if (navbar) {
                    navbar.classList.add('navbar-light');
                }
            }

            // Initialize navbar features
            initializeDropdowns();
        })
        .catch(error => console.error('Error loading the navigation bar:', error));
}

function initializeDropdowns() {
    const dropdowns = document.querySelectorAll('.dropdown');
    dropdowns.forEach(dropdown => {
        const link = dropdown.querySelector('.nav-links');
        link.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            const menu = dropdown.querySelector('.dropdown-menu');
            const isVisible = menu.style.display === 'block';
            document.querySelectorAll('.dropdown-menu').forEach(m => m.style.display = 'none');
            menu.style.display = isVisible ? 'none' : 'block';
        });
    });
    window.addEventListener('click', () => {
        document.querySelectorAll('.dropdown-menu').forEach(menu => menu.style.display = 'none');
    });
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

// --- Add this entire block for dynamic resizing ---
let resizeTimer;
window.addEventListener('resize', () => {
    // Clear the timeout to avoid running the function too often
    clearTimeout(resizeTimer);
    // Set a timeout to run the function once the resize is "finished"
    resizeTimer = setTimeout(() => {
        const navbar = document.querySelector('#navbar-placeholder .navbar');
        if (navbar) {
            const navbarHeight = navbar.offsetHeight;
            document.documentElement.style.setProperty('--navbar-height', `${navbarHeight}px`);
        }
    }, 100); // 100ms delay
});