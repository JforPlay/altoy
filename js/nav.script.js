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
            highlightActiveGroup();
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

function highlightActiveGroup() {
    const pageGroupMap = {
        'index.html': 'Story Viewers',
        'skin-list.html': 'Skin',
        'skin-poll.html': 'Skin',
        'skin-viewer.html': 'Skin',
        'dorm3d-chat-viewer.html': 'Chat Viewers',
        'ins-chat-viewer.html': 'Chat Viewers',
        'ins-viewer.html': 'Chat Viewers'
    };

    const currentPage = window.location.pathname.split("/").pop() || 'index.html';
    const activeGroup = pageGroupMap[currentPage];

    if (activeGroup) {
        let linkToActivate;
        if (activeGroup === 'Story Viewers') {
            linkToActivate = document.querySelector('.nav-logo');
        } else {
            const navLinks = document.querySelectorAll('.nav-links');
            navLinks.forEach(link => {
                if (link.textContent.trim() === activeGroup) {
                    linkToActivate = link;
                }
            });
        }
        
        if (linkToActivate) {
            linkToActivate.classList.add('active-group');
        }
    }
}