document.addEventListener("DOMContentLoaded", function() {
    const gallery = document.getElementById('gallery');
    const sortButton = document.getElementById('sort-button');
    const imageBaseUrl = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/mangapic/';
    let imageFiles = [];
    let isAscending = true;

    // Lightbox elements
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const closeButton = document.querySelector('.close-button');

    // Generate the list of image files from 1.png to 333.png
    function generateImageFiles() {
        imageFiles = [];
        for (let i = 1; i <= 333; i++) {
            imageFiles.push(`${i}.png`);
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
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

        img.addEventListener('click', function() {
            lightbox.style.display = 'block';
            lightbox.classList.add('fade-in');
            lightboxImg.src = this.src;
            document.body.style.overflow = 'hidden';
        });

        img.onload = function() {
            div.classList.add('loaded');
            img.classList.add('loaded');
        };

        div.appendChild(img);
        gallery.appendChild(div);
    }
    
    // Function to initialize the Intersection Observer
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
        if (isAscending) {
            imageFiles.sort((a, b) => parseInt(a) - parseInt(b));
            sortButton.textContent = '기간정렬 : 1호부터';
        } else {
            imageFiles.sort((a, b) => parseInt(b) - parseInt(a));
            sortButton.textContent = '기간정렬 : 최신부터';
        }
        renderGallery();
    });

    // Lightbox Close Functionality
    closeButton.addEventListener('click', function() {
        lightbox.style.display = 'none';
        lightbox.classList.remove('fade-in');
        document.body.style.overflow = '';
    });

    // Close lightbox if clicked outside the image
    lightbox.addEventListener('click', function(event) {
        if (event.target === lightbox) {
            lightbox.style.display = 'none';
            lightbox.classList.remove('fade-in');
            document.body.style.overflow = '';
        }
    });

    // Close lightbox with ESC key
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && lightbox.style.display === 'block') {
            lightbox.style.display = 'none';
            lightbox.classList.remove('fade-in');
            document.body.style.overflow = '';
        }
    });

    // Initial setup
    generateImageFiles();
    renderGallery();
});