/**
 * loadingbg.js
 * Gallery viewer for in-game loading illustrations (로딩일러).
 * Image list is fetched from the GitHub API; supports name search and a lightbox with arrow navigation.
 */

import { hideElement, openModal, closeModal, setupModal } from '../utils.js';

// ===== Configuration & State =====
const GITHUB_REPO = 'JforPlay/data_for_toy';
const FOLDER_PATH = 'loadingbg';
const RAW_BASE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/${FOLDER_PATH}`;

let images = [];
let currentImageIndex = 0;
let filteredImages = [];

// ===== DOM References =====
const gallery = document.getElementById('gallery');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCaption = document.querySelector('.lightbox-caption');
const searchInput = document.getElementById('searchInput');
const loading = document.getElementById('loading');

// ===== Data Loading =====

/**
 * Fetch the image list from the GitHub Contents API, filter to image extensions,
 * and populate the gallery. Strips extension from filenames to build display names.
 */
async function fetchImageList() {
    try {
        const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FOLDER_PATH}`;
        const response = await fetch(apiUrl);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const files = await response.json();
        
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
        hideElement(loading);
        
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

// ===== Gallery & Lightbox =====

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

// ===== Search =====

searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    filteredImages = images.filter(img => 
        img.displayName.toLowerCase().includes(searchTerm) ||
        img.name.toLowerCase().includes(searchTerm)
    );
    renderGallery();
});

function openLightbox(index) {
    currentImageIndex = index;
    updateLightboxImage();
    openModal('lightbox');
}

function closeLightbox() {
    closeModal('lightbox');
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

// ===== Event Listeners =====

setupModal('lightbox', {
    closeButtonSelector: '.lightbox-close',
    closeOnBackdrop: true,
    closeOnEscape: true
});
document.querySelector('.lightbox-next').addEventListener('click', showNextImage);
document.querySelector('.lightbox-prev').addEventListener('click', showPrevImage);

// Arrow keys navigate images when the lightbox is open
document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) return;
    if (e.key === 'ArrowLeft') showPrevImage();
    else if (e.key === 'ArrowRight') showNextImage();
});

fetchImageList();