document.addEventListener('DOMContentLoaded', function() {
    // Load the navigation bar
    loadNavbar();
});

function loadNavbar() {
    fetch('nav.html')
        .then(response => response.text())
        .then(data => {
            document.getElementById('navbar-placeholder').innerHTML = data;
            // Now that the nav is loaded, initialize all its functionality
            initializeDropdowns();
            initializeThemeToggle();
        })
        .catch(error => console.error('Error loading the navigation bar:', error));
}

function initializeDropdowns() {
    // Dropdown logic remains the same
    const dropdowns = document.querySelectorAll('.dropdown');
    dropdowns.forEach(dropdown => {
        const link = dropdown.querySelector('.nav-links');
        link.addEventListener('click', function(event) {
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

function initializeThemeToggle() {
    const toggleSwitch = document.querySelector('#checkbox');
    const currentTheme = localStorage.getItem('theme');

    // 1. Set the initial theme on page load
    if (currentTheme) {
        document.body.classList.add(currentTheme);
        if (currentTheme === 'dark-mode') {
            toggleSwitch.checked = true;
        }
    }

    // 2. Add listener for toggle clicks
    toggleSwitch.addEventListener('change', function(e) {
        if (e.target.checked) {
            document.body.classList.add('dark-mode');
            localStorage.setItem('theme', 'dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
            localStorage.setItem('theme', 'light-mode');
        }
    });
}