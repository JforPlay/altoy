document.addEventListener('DOMContentLoaded', function() {
    // Fetch and insert the navigation bar
    fetch('nav.html')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.text();
        })
        .then(data => {
            document.getElementById('navbar-placeholder').innerHTML = data;
            // Now that the navigation is loaded, initialize the dropdown logic
            initializeDropdowns();
        })
        .catch(error => {
            console.error('Error loading the navigation bar:', error);
            document.getElementById('navbar-placeholder').innerHTML = '<p style="color:red;">Failed to load navigation.</p>';
        });
});

function initializeDropdowns() {
    const dropdowns = document.querySelectorAll('.dropdown');

    dropdowns.forEach(dropdown => {
        const link = dropdown.querySelector('.nav-links');
        const menu = dropdown.querySelector('.dropdown-menu');

        link.addEventListener('click', function(event) {
            // Prevent default link behavior
            event.preventDefault();
            event.stopPropagation();
            
            // Check if this menu is already open
            const isVisible = menu.style.display === 'block';
            
            // Close all other dropdowns
            document.querySelectorAll('.dropdown-menu').forEach(m => m.style.display = 'none');
            
            // Toggle the current menu
            menu.style.display = isVisible ? 'none' : 'block';
        });
    });

    // Close dropdowns if clicking anywhere else on the window
    window.addEventListener('click', function(event) {
        if (!event.target.closest('.dropdown')) {
            document.querySelectorAll('.dropdown-menu').forEach(menu => {
                menu.style.display = 'none';
            });
        }
    });
}