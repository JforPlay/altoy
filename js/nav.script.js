document.addEventListener('DOMContentLoaded', function() {
    loadNavbar();
});

function loadNavbar() {
    fetch('nav.html')
        .then(response => response.text())
        .then(data => {
            document.getElementById('navbar-placeholder').innerHTML = data;
            
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