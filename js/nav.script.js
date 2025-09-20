document.addEventListener('DOMContentLoaded', function() {
    fetch('nav.html')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.text();
        })
        .then(data => {
            document.getElementById('navbar-placeholder').innerHTML = data;

            // ---- START: NEW CODE FOR PAGE-SPECIFIC STYLING ----
            const currentPage = window.location.pathname.split("/").pop();
            if (currentPage === 'ins-viewer.html') {
                const navbar = document.querySelector('.navbar');
                if (navbar) {
                    navbar.classList.add('navbar-light');
                }
            }
            // ---- END: NEW CODE ----

            initializeDropdowns();
        })
        .catch(error => {
            console.error('Error loading the navigation bar:', error);
            document.getElementById('navbar-placeholder').innerHTML = '<p style="color:red;">Failed to load navigation.</p>';
        });
});

function initializeDropdowns() {
    // ... (The rest of your initializeDropdowns function remains exactly the same) ...
    const dropdowns = document.querySelectorAll('.dropdown');

    dropdowns.forEach(dropdown => {
        const link = dropdown.querySelector('.nav-links');
        const menu = dropdown.querySelector('.dropdown-menu');

        link.addEventListener('click', function(event) {
            event.preventDefault();
            event.stopPropagation();
            const isVisible = menu.style.display === 'block';
            document.querySelectorAll('.dropdown-menu').forEach(m => m.style.display = 'none');
            menu.style.display = isVisible ? 'none' : 'block';
        });
    });

    window.addEventListener('click', function(event) {
        if (!event.target.closest('.dropdown')) {
            document.querySelectorAll('.dropdown-menu').forEach(menu => {
                menu.style.display = 'none';
            });
        }
    });
}