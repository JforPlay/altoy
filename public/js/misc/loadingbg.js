/**
 * loadingbg.js
 * Gallery viewer for in-game loading illustrations.
 * Image list is fetched from the GitHub API; supports name search and a lightbox with arrow navigation.
 */

import { IMG_FALLBACKS, createImgElement, debounce, hideElement, openModal, closeModal, setupModal, requireElements } from '../utils.js';

// ===== Configuration & State =====
const GITHUB_REPO = 'JforPlay/data_for_toy';
const FOLDER_PATH = 'loadingbg';

let images = [];
let currentImageIndex = 0;
let filteredImages = [];

// ===== DOM References =====
const gallery = document.getElementById('gallery');
const galleryStatus = document.getElementById('gallery-status');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCaption = document.querySelector('.lightbox-caption');
const searchInput = document.getElementById('searchInput');
const loading = document.getElementById('loading');
const nextButton = document.querySelector('.lightbox-next');
const prevButton = document.querySelector('.lightbox-prev');

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

function setGalleryStatus(message, type = '') {
    if (!galleryStatus) return;
    galleryStatus.textContent = message;
    galleryStatus.className = type ? `gallery-status ${type}` : 'gallery-status';
    galleryStatus.hidden = !message;
}

function setLoadingError(error) {
    if (!loading) return;

    const spinner = document.createElement('div');
    spinner.className = 'spinner';

    const message = document.createElement('p');
    message.textContent = 'Could not load images.';

    const detail = document.createElement('p');
    detail.className = 'loading-detail';
    detail.textContent = error.message;

    loading.replaceChildren(spinner, message, detail);
}

function getImageExtension(fileName) {
    const lastDot = fileName.lastIndexOf('.');
    return lastDot >= 0 ? fileName.slice(lastDot).toLowerCase() : '';
}

function toImage(file) {
    const displayName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    return {
        name: file.name,
        url: file.download_url,
        displayName
    };
}

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
            throw new Error(`GitHub API returned ${response.status}`);
        }

        const files = await response.json();
        if (!Array.isArray(files)) {
            throw new Error('GitHub API returned an unexpected response.');
        }

        images = files
            .filter(file => file && file.type === 'file' && typeof file.name === 'string' && typeof file.download_url === 'string')
            .filter(file => imageExtensions.has(getImageExtension(file.name)))
            .map(toImage);

        filteredImages = [...images];
        renderGallery();
        hideElement(loading);
    } catch (error) {
        console.error('Error fetching images:', error);
        gallery?.replaceChildren();
        setGalleryStatus('Could not load loading background images.', 'error');
        setLoadingError(error);
    }
}

// ===== Gallery & Lightbox =====

function createGalleryItem(image, index) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'gallery-item';
    item.style.animationDelay = `${Math.min(index, 20) * 0.05}s`;
    item.dataset.index = String(index);
    item.setAttribute('aria-label', `Open ${image.displayName}`);

    const img = createImgElement(image.url, image.displayName, {
        fallback: IMG_FALLBACKS.CARD
    });

    const caption = document.createElement('div');
    caption.className = 'caption';
    caption.textContent = image.displayName;

    item.append(img, caption);
    return item;
}

function renderGallery() {
    if (!gallery) return;

    gallery.replaceChildren();

    if (!filteredImages.length) {
        setGalleryStatus(images.length ? 'No images match your search.' : 'No loading background images were found.', 'empty');
        return;
    }

    const fragment = document.createDocumentFragment();
    filteredImages.forEach((image, index) => {
        fragment.appendChild(createGalleryItem(image, index));
    });
    gallery.appendChild(fragment);
    setGalleryStatus('');
}

// ===== Search =====

function updateSearch(value) {
    const searchTerm = value.trim().toLowerCase();
    filteredImages = images.filter(img =>
        img.displayName.toLowerCase().includes(searchTerm) ||
        img.name.toLowerCase().includes(searchTerm)
    );
    renderGallery();

    if (lightbox?.classList.contains('active') && !filteredImages[currentImageIndex]) {
        closeLightbox();
    }
}

function openLightbox(index) {
    if (!filteredImages[index]) return;
    currentImageIndex = index;
    updateLightboxImage();
    openModal('lightbox');
}

function closeLightbox() {
    closeModal('lightbox');
}

function updateLightboxImage() {
    const image = filteredImages[currentImageIndex];
    if (!image || !lightboxImg || !lightboxCaption) return;

    lightboxImg.src = image.url;
    lightboxImg.alt = image.displayName;
    lightboxCaption.textContent = image.displayName;

    const hasMultipleImages = filteredImages.length > 1;
    if (nextButton) nextButton.disabled = !hasMultipleImages;
    if (prevButton) prevButton.disabled = !hasMultipleImages;
}

function showNextImage() {
    if (!filteredImages.length) return;
    currentImageIndex = (currentImageIndex + 1) % filteredImages.length;
    updateLightboxImage();
}

function showPrevImage() {
    if (!filteredImages.length) return;
    currentImageIndex = (currentImageIndex - 1 + filteredImages.length) % filteredImages.length;
    updateLightboxImage();
}

// ===== Event Listeners =====

function onLightboxKeydown(event) {
    if (!lightbox.classList.contains('active')) return;
    if (event.key === 'ArrowLeft') showPrevImage();
    else if (event.key === 'ArrowRight') showNextImage();
}

if (!requireElements({ gallery, galleryStatus, lightbox, lightboxImg, lightboxCaption,
    searchInput, loading, nextButton, prevButton }, 'Loading background viewer')) {
    // module top-level — nothing further to bind
} else {
    setupModal('lightbox', {
        closeButtonSelector: '.lightbox-close',
        closeOnBackdrop: true,
        closeOnEscape: true,
        restoreFocus: true,
        onClose: () => {
            lightboxImg.src = '';
            lightboxImg.alt = '';
            lightboxCaption.textContent = '';
        }
    });

    gallery.addEventListener('click', (event) => {
        const item = event.target.closest('.gallery-item');
        if (!item || !gallery.contains(item)) return;

        const index = Number.parseInt(item.dataset.index, 10);
        if (Number.isInteger(index)) openLightbox(index);
    });

    searchInput.addEventListener('input', debounce((event) => {
        updateSearch(event.target.value);
    }, 120));

    nextButton.addEventListener('click', showNextImage);
    prevButton.addEventListener('click', showPrevImage);

    document.addEventListener('keydown', onLightboxKeydown);

    window.addEventListener('pagehide', () => {
        document.removeEventListener('keydown', onLightboxKeydown);
    }, { once: true });

    fetchImageList();
}
