document.addEventListener("DOMContentLoaded", function() {
    const gallery = document.getElementById('gallery');
    const imageBaseUrl = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/mangapic/';
    const imageFiles = [];

    // Lightbox elements
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const closeButton = document.querySelector('.close-button');

    // Generate the list of image files from 1.png to 333.png
    for (let i = 1; i <= 333; i++) {
        imageFiles.push(`${i}.png`);
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
        img.setAttribute('data-src', fullImageUrl); // Store the real source in a data attribute
        img.alt = `Manga Image ${imageName}`;
        img.classList.add('lazy'); // Add a class for the observer to target
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // Tiny transparent gif placeholder
        
        // Add event listener for image click to open lightbox
        img.addEventListener('click', function() {
            lightbox.style.display = 'block';
            lightbox.classList.add('fade-in');
            lightboxImg.src = this.src; // Use the already loaded full-size image
            document.body.style.overflow = 'hidden'; // Prevent scrolling when lightbox is open
        });

        img.onload = function() {
            // Once the actual image is loaded, hide the loader and show the image
            div.classList.add('loaded'); // Mark the parent as loaded to hide spinner
            img.classList.add('loaded'); // Add loaded class to image for fade-in
        };

        div.appendChild(img);
        gallery.appendChild(div);
    }

    // Loop through the image list and create the gallery
    imageFiles.forEach(file => {
        createGalleryItem(file);
    });

    // Intersection Observer implementation
    const lazyImages = document.querySelectorAll('img.lazy');
    const observerOptions = {
        rootMargin: '0px 0px 100px 0px', // Pre-load images that are 100px away from the viewport
    };

    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const src = img.getAttribute('data-src');
                if (src) {
                    img.src = src; // Start loading the actual image
                    img.removeAttribute('data-src');
                    img.classList.remove('lazy');
                    observer.unobserve(img); // Stop observing the image once it's triggered
                }
            }
        });
    }, observerOptions);

    lazyImages.forEach(img => {
        imageObserver.observe(img);
    });

    // Lightbox Close Functionality
    closeButton.addEventListener('click', function() {
        lightbox.style.display = 'none';
        lightbox.classList.remove('fade-in');
        document.body.style.overflow = ''; // Restore scrolling
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
});