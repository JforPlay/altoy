// Configuration
const GITHUB_REPO = 'JforPlay/data_for_toy';
const FOLDER_PATH = 'loadingbg';
const RAW_BASE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/${FOLDER_PATH}`;

// State
let images = [];
let currentImageIndex = 0;
let filteredImages = [];

// DOM Elements
const gallery = document.getElementById('gallery');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCaption = document.querySelector('.lightbox-caption');
const searchInput = document.getElementById('searchInput');
const loading = document.getElementById('loading');

// Fetch image list from GitHub API
async function fetchImageList() {
    try {
        const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FOLDER_PATH}`;
        const response = await fetch(apiUrl);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const files = await response.json();
        
        // Filter for image files
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
        images = files
            .filter(file => {
                const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
                return imageExtensions.includes(ext);
            })
            .map(file => ({
                name: file.name,
                url: file.download_url,
                displayName: file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
            }));
        
        filteredImages = [...images];
        renderGallery();
        loading.classList.add('hidden');
        
    } catch (error) {
        console.error('Error fetching images:', error);
        loading.innerHTML = `
            <div class="spinner"></div>
            <p>이미지를 불러오는 중 오류가 발생했습니다.</p>
            <p style="font-size: 0.9rem; color: #94a3b8; margin-top: 0.5rem;">
                ${error.message}
            </p>
        `;
    }
}

// Render gallery
function renderGallery() {
    gallery.innerHTML = '';
    
    filteredImages.forEach((image, index) => {
        const item = document.createElement('div');
        item.className = 'gallery-item';
        item.style.animationDelay = `${index * 0.05}s`;
        
        const img = document.createElement('img');
        img.src = image.url;
        img.alt = image.displayName;
        img.loading = 'lazy';
        
        const caption = document.createElement('div');
        caption.className = 'caption';
        caption.textContent = image.displayName;
        
        item.appendChild(img);
        item.appendChild(caption);
        
        item.addEventListener('click', () => openLightbox(index));
        
        gallery.appendChild(item);
    });
}

// Search functionality
searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    filteredImages = images.filter(img => 
        img.displayName.toLowerCase().includes(searchTerm) ||
        img.name.toLowerCase().includes(searchTerm)
    );
    renderGallery();
});

// Lightbox functionality
function openLightbox(index) {
    currentImageIndex = index;
    updateLightboxImage();
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
}

function updateLightboxImage() {
    const image = filteredImages[currentImageIndex];
    lightboxImg.src = image.url;
    lightboxImg.alt = image.displayName;
    lightboxCaption.textContent = image.displayName;
}

function showNextImage() {
    currentImageIndex = (currentImageIndex + 1) % filteredImages.length;
    updateLightboxImage();
}

function showPrevImage() {
    currentImageIndex = (currentImageIndex - 1 + filteredImages.length) % filteredImages.length;
    updateLightboxImage();
}

// Event listeners
document.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
document.querySelector('.lightbox-next').addEventListener('click', showNextImage);
document.querySelector('.lightbox-prev').addEventListener('click', showPrevImage);

// Close lightbox on background click
lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) {
        closeLightbox();
    }
});

// Keyboard navigation
document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) return;
    
    switch(e.key) {
        case 'Escape':
            closeLightbox();
            break;
        case 'ArrowLeft':
            showPrevImage();
            break;
        case 'ArrowRight':
            showNextImage();
            break;
    }
});

// Initialize
fetchImageList();