/**
 * island-misc.js
 * Miscellaneous island assets gallery: dress icons, theme icons, rest events, invitations, and draw awards.
 * Fetches file lists from the GitHub API at runtime (no pre-processed JSON) and renders
 * an image gallery with a lightbox. Part of the island module group.
 */

import { hideElement, openModal, closeModal, setupModal } from '../utils.js';

// ===== Configuration =====
const GITHUB_REPO = 'JforPlay/data_for_toy';
const RAW_BASE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/island/`;
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

const CATEGORIES = [
    { key: 'islanddressicon', path: 'island/islanddressicon' },
    { key: 'islandthemeicon', path: 'island/islandthemeicon' },
    { key: 'islandrestevent', path: 'island/islandrestevent' },
    { key: 'islandinvitation', path: 'island/islandinvitation' },
    { key: 'islanddrawawardicon', path: 'island/islanddrawawardicon' },
];

// ===== State =====
let allImages = []; // flat list for lightbox navigation
let currentImageIndex = 0;

// ===== DOM =====
const lightbox = document.getElementById('island-misc-lightbox');
const lightboxImg = lightbox.querySelector('.lightbox-img');
const lightboxCaption = lightbox.querySelector('.lightbox-caption');

// ===== Data Fetching =====

/**
 * Fetch the image file list for a category from the GitHub Contents API.
 * Filters to known image extensions and normalizes names for display.
 */
async function fetchCategory(category) {
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${category.path}`;
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${category.key}`);
    const files = await response.json();

    return files
        .filter(file => {
            const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
            return IMAGE_EXTENSIONS.includes(ext);
        })
        .map(file => ({
            name: file.name,
            url: file.download_url,
            displayName: file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
            category: category.key,
        }));
}

// ===== Rendering =====

/**
 * Render a fetched image list into its section gallery.
 * Each image item gets a click handler to open the lightbox at the correct global index.
 */
function renderSection(category, images) {
    const section = document.querySelector(`.island-misc-section[data-category="${category}"]`);
    if (!section) return;

    const gallery = section.querySelector('.island-misc-gallery');
    const countEl = section.querySelector('.section-count');
    countEl.textContent = `${images.length}개`;

    gallery.innerHTML = '';
    const fragment = document.createDocumentFragment();
    images.forEach(image => {
        const item = document.createElement('div');
        item.className = 'island-misc-item';

        const img = document.createElement('img');
        img.src = image.url;
        img.alt = image.displayName;
        img.loading = 'lazy';

        const caption = document.createElement('div');
        caption.className = 'item-caption';
        caption.textContent = image.displayName;

        item.appendChild(img);
        item.appendChild(caption);
        item.addEventListener('click', () => {
            const globalIndex = allImages.indexOf(image);
            openLightbox(globalIndex);
        });

        fragment.appendChild(item);
    });

    gallery.appendChild(fragment);
}

function showSectionLoading(category) {
    const section = document.querySelector(`.island-misc-section[data-category="${category}"]`);
    if (!section) return;
    const gallery = section.querySelector('.island-misc-gallery');
    gallery.innerHTML = '<div class="island-misc-loading"><div class="spinner"></div><p>로딩 중...</p></div>';
}

function showSectionError(category, message) {
    const section = document.querySelector(`.island-misc-section[data-category="${category}"]`);
    if (!section) return;
    const gallery = section.querySelector('.island-misc-gallery');
    gallery.innerHTML = `<div class="island-misc-loading"><p>오류: ${message}</p></div>`;
}

// ===== Lightbox =====

function openLightbox(index) {
    currentImageIndex = index;
    updateLightboxImage();
    openModal('island-misc-lightbox');
}

function updateLightboxImage() {
    const image = allImages[currentImageIndex];
    lightboxImg.src = image.url;
    lightboxImg.alt = image.displayName;
    lightboxCaption.textContent = image.displayName;
}

function showNextImage() {
    currentImageIndex = (currentImageIndex + 1) % allImages.length;
    updateLightboxImage();
}

function showPrevImage() {
    currentImageIndex = (currentImageIndex - 1 + allImages.length) % allImages.length;
    updateLightboxImage();
}

// ===== Event Listeners =====
setupModal('island-misc-lightbox', {
    closeButtonSelector: '.lightbox-close',
    closeOnBackdrop: true,
    closeOnEscape: true,
    onClose: () => { lightboxImg.src = ''; },
});

lightbox.querySelector('.lightbox-next').addEventListener('click', showNextImage);
lightbox.querySelector('.lightbox-prev').addEventListener('click', showPrevImage);

document.addEventListener('keydown', (e) => {
    if (lightbox.style.display === 'none' || lightbox.style.display === '') return;
    if (e.key === 'ArrowLeft') showPrevImage();
    else if (e.key === 'ArrowRight') showNextImage();
});

// ===== Initialization =====

/**
 * Load all image categories in parallel and render each section.
 * Uses Promise.allSettled so a single failed category doesn't block the rest.
 */
async function init() {
    CATEGORIES.forEach(cat => showSectionLoading(cat.key));

    const results = await Promise.allSettled(CATEGORIES.map(cat => fetchCategory(cat)));

    results.forEach((result, i) => {
        const cat = CATEGORIES[i];
        if (result.status === 'fulfilled') {
            const images = result.value;
            allImages.push(...images);
            renderSection(cat.key, images);
        } else {
            console.error(`Failed to load ${cat.key}:`, result.reason);
            showSectionError(cat.key, result.reason?.message || '알 수 없는 오류');
        }
    });
}

init();
