import { fetchJSON, openModal, setupModal } from '../utils.js';
document.addEventListener('DOMContentLoaded', () => {
    const gallery = document.getElementById('gallery');
    const modal = document.getElementById('modal');
    const modalImage = document.getElementById('modal-image');

    const baseImageUrl = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/gallerypic/';

    // Fetch the image data from the JSON file
    fetchJSON('data/misc/gallery_data.json')
        .then(data => {
            // Filter out the 'all' key and process the rest of the image objects
            Object.values(data).forEach(item => {
                if (item && typeof item === 'object' && item.illustration) {
                    const imageName = item.illustration; // This is "gallerypic1", "gallerypic2", etc.

                    // Format the name to match the repo's capitalization, e.g., "GalleryPic1"
                    const formattedName = imageName.replace('gallerypic', 'GalleryPic');
                    
                    const thumbnailUrl = `${baseImageUrl}${formattedName}_t.webp`;
                    const fullImageUrl = `${baseImageUrl}${formattedName}.webp`;

                    // Create gallery item container
                    const galleryItem = document.createElement('div');
                    galleryItem.className = 'gallery-item bg-white rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-shadow duration-300 ease-in-out';
                    galleryItem.dataset.fullSrc = fullImageUrl;

                    // Create image element
                    const img = document.createElement('img');
                    img.src = thumbnailUrl;
                    img.alt = `Gallery thumbnail for ${formattedName}`;
                    img.className = 'w-full h-auto object-cover aspect-square';
                    img.loading = 'lazy';
                    // Fallback for broken images
                    img.onerror = () => {
                        img.src = 'https://placehold.co/400x400/EEE/31343C?text=Image+Not+Found';
                    };
                    
                    galleryItem.appendChild(img);
                    gallery.appendChild(galleryItem);
                }
            });
        })
        .catch(error => {
            console.error('Error fetching or processing gallery data:', error);
            gallery.innerHTML = `<p class="text-red-500 col-span-full text-center">Could not load gallery images. Please check the console for more information.</p>`;
        });

    // Event listener for opening the modal
    gallery.addEventListener('click', (e) => {
        const item = e.target.closest('.gallery-item');
        if (item) {
            modalImage.src = item.dataset.fullSrc;
            openModal('modal');
        }
    });

    // Setup modal close handlers (close button, backdrop, ESC)
    setupModal('modal', {
        closeButtonSelector: '#close',
        closeOnBackdrop: true,
        closeOnEscape: true,
        onClose: () => { modalImage.src = ''; }
    });
});