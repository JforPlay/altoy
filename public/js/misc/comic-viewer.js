import { openModal, closeModal, setupModal } from '../utils.js';
document.addEventListener("DOMContentLoaded", async function() {
    const gallery = document.getElementById('gallery');
    const sortButton = document.getElementById('sort-button');
    const imageBaseUrl = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/mangapic/';
    let imageFiles = [];
    let isAscending = false;

    // Lightbox elements
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const closeButton = document.querySelector('.close-button');

    /**
     * Fetches the list of image files directly from the GitHub repository.
     * This replaces the hardcoded file generation.
     */
    async function fetchImageFiles() {
        const apiUrl = 'https://api.github.com/repos/JforPlay/data_for_toy/contents/mangapic';
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`GitHub API responded with status: ${response.status}`);
            }
            const data = await response.json();
            // Filter for files only (in case of subdirectories) and map to their names.
            return data.filter(item => item.type === 'file').map(item => item.name);
        } catch (error) {
            console.error('Could not fetch image file list:', error);
            gallery.innerHTML = '<p style="color: white; text-align: center;">Error loading images. Please try again later.</p>';
            return []; // Return an empty array on error to prevent the script from breaking.
        }
    }

    // Function to create and append image elements
    function createGalleryItem(imageName) {
        const fullImageUrl = imageBaseUrl + imageName;
        
        const div = document.createElement('div');
        div.className = 'gallery-item';

        const loader = document.createElement('div');
        loader.className = 'loader';
        div.appendChild(loader);

        const img = document.createElement('img');
        img.setAttribute('data-src', fullImageUrl);
        img.alt = `Manga Image ${imageName}`;
        img.classList.add('lazy');
        img.loading = 'lazy';
        // Use a transparent placeholder to maintain layout
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

        img.addEventListener('click', function() {
            lightboxImg.src = this.src;
            openModal('lightbox');
        });

        img.onload = function() {
            div.classList.add('loaded');
            img.classList.add('loaded');
        };

        div.appendChild(img);
        gallery.appendChild(div);
    }
    
    // Function to initialize the Intersection Observer for lazy loading
    function initializeLazyLoading() {
        const lazyImages = document.querySelectorAll('img.lazy');
        const observerOptions = {
            rootMargin: '0px 0px 100px 0px',
        };

        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const src = img.getAttribute('data-src');
                    if (src) {
                        img.src = src;
                        img.removeAttribute('data-src');
                        img.classList.remove('lazy');
                        observer.unobserve(img);
                    }
                }
            });
        }, observerOptions);

        lazyImages.forEach(img => {
            imageObserver.observe(img);
        });
    }

    // Function to render the gallery
    function renderGallery() {
        gallery.innerHTML = '';
        imageFiles.forEach(file => {
            createGalleryItem(file);
        });
        initializeLazyLoading();
    }

    // Sort function
    sortButton.addEventListener('click', function() {
        isAscending = !isAscending;
        // Natural sort to handle numbers in filenames correctly (e.g., '10.png' vs '2.png')
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        if (isAscending) {
            imageFiles.sort(collator.compare);
            sortButton.textContent = '기간정렬 : 1호부터';
        } else {
            imageFiles.sort((a, b) => collator.compare(b, a));
            sortButton.textContent = '기간정렬 : 최신부터';
        }
        renderGallery();
    });

    // Lightbox close handlers (close button, backdrop click, ESC)
    setupModal('lightbox', {
        closeButtonSelector: '.close-button',
        closeOnBackdrop: true,
        closeOnEscape: true
    });

    // --- Initial Setup ---
    imageFiles = await fetchImageFiles(); // Fetch files dynamically
    
    if (imageFiles.length > 0) {
        // Use natural sort for the initial descending order
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        imageFiles.sort((a, b) => collator.compare(b, a));
        sortButton.textContent = '기간정렬 : 최신부터';
        
        renderGallery();
    }
});