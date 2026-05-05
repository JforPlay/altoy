/**
 * island-misc.js
 * Miscellaneous island assets gallery: dress icons, theme icons, rest events, invitations, and draw awards.
 * Fetches file lists from the GitHub API at runtime (no pre-processed JSON) and renders
 * an image gallery with a lightbox. Part of the island module group.
 */

import { fetchJSONWithCache, openModal, setupModal } from '../utils.js';

// ===== Configuration =====
const GITHUB_REPO = 'JforPlay/data_for_toy';
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const CATEGORY_CACHE_MAX_AGE = 6 * 60 * 60 * 1000;

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
const lightboxClose = lightbox.querySelector('.lightbox-close');
const lightboxPrev = lightbox.querySelector('.lightbox-prev');
const lightboxNext = lightbox.querySelector('.lightbox-next');
const galleryContainer = document.querySelector('.island-misc-container');
let previousActiveElement = null;

// ===== Data Fetching =====

/**
 * Fetch the image file list for a category from the GitHub Contents API.
 * Filters to known image extensions and normalizes names for display.
 */
async function fetchCategory(category) {
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${category.path}`;
    const files = await fetchJSONWithCache(apiUrl, { maxAge: CATEGORY_CACHE_MAX_AGE });

    if (!Array.isArray(files)) {
        throw new Error(`${category.key} file list was not available`);
    }

    return files
        .filter(file => {
            if (file.type !== 'file' || typeof file.name !== 'string' || !file.download_url) {
                return false;
            }
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

    if (images.length === 0) {
        renderSectionStatus(gallery, '표시할 이미지가 없습니다.', 'island-misc-empty');
        return;
    }

    const fragment = document.createDocumentFragment();
    images.forEach(image => {
        const item = document.createElement('button');
        item.className = 'island-misc-item';
        item.type = 'button';
        item.dataset.galleryIndex = String(image.galleryIndex);
        item.setAttribute('aria-label', `${image.displayName} 크게 보기`);

        const img = document.createElement('img');
        img.src = image.url;
        img.alt = image.displayName;
        img.loading = 'lazy';
        img.addEventListener('error', () => {
            item.classList.add('is-image-missing');
            item.disabled = true;
            item.setAttribute('aria-label', `${image.displayName} 이미지를 불러올 수 없음`);
        }, { once: true });

        const caption = document.createElement('div');
        caption.className = 'item-caption';
        caption.textContent = image.displayName;

        item.appendChild(img);
        item.appendChild(caption);

        fragment.appendChild(item);
    });

    gallery.appendChild(fragment);
}

function showSectionLoading(category) {
    const section = document.querySelector(`.island-misc-section[data-category="${category}"]`);
    if (!section) return;
    const gallery = section.querySelector('.island-misc-gallery');
    gallery.innerHTML = '';

    const status = document.createElement('div');
    status.className = 'island-misc-loading';
    status.setAttribute('role', 'status');

    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');

    const text = document.createElement('p');
    text.textContent = '로딩 중...';

    status.appendChild(spinner);
    status.appendChild(text);
    gallery.appendChild(status);
}

function showSectionError(category, message) {
    const section = document.querySelector(`.island-misc-section[data-category="${category}"]`);
    if (!section) return;
    const gallery = section.querySelector('.island-misc-gallery');
    renderSectionStatus(gallery, `오류: ${message}`, 'island-misc-error');
}

function renderSectionStatus(gallery, message, className = '') {
    gallery.innerHTML = '';

    const status = document.createElement('div');
    status.className = ['island-misc-loading', className].filter(Boolean).join(' ');
    status.setAttribute('role', className === 'island-misc-error' ? 'alert' : 'status');

    const text = document.createElement('p');
    text.textContent = message;

    status.appendChild(text);
    gallery.appendChild(status);
}

// ===== Lightbox =====

function openLightbox(index) {
    if (!Number.isInteger(index) || index < 0 || index >= allImages.length) return;

    previousActiveElement = document.activeElement;
    currentImageIndex = index;
    updateLightboxImage();
    openModal('island-misc-lightbox', {
        onOpen: () => {
            lightbox.setAttribute('aria-hidden', 'false');
            lightboxClose?.focus({ preventScroll: true });
        },
    });
}

function updateLightboxImage() {
    const image = allImages[currentImageIndex];
    if (!image) return;

    lightboxImg.src = image.url;
    lightboxImg.alt = image.displayName;
    lightboxCaption.textContent = image.displayName;
    updateLightboxControls();
}

function showNextImage() {
    if (allImages.length < 2) return;
    currentImageIndex = (currentImageIndex + 1) % allImages.length;
    updateLightboxImage();
}

function showPrevImage() {
    if (allImages.length < 2) return;
    currentImageIndex = (currentImageIndex - 1 + allImages.length) % allImages.length;
    updateLightboxImage();
}

function updateLightboxControls() {
    const hasMultipleImages = allImages.length > 1;
    lightboxPrev.disabled = !hasMultipleImages;
    lightboxNext.disabled = !hasMultipleImages;
}

function handleLightboxClose() {
    lightboxImg.src = '';
    lightboxImg.alt = '';
    lightbox.setAttribute('aria-hidden', 'true');

    if (previousActiveElement && document.contains(previousActiveElement)) {
        previousActiveElement.focus({ preventScroll: true });
    }
    previousActiveElement = null;
}

// ===== Event Listeners =====
setupModal('island-misc-lightbox', {
    closeButtonSelector: '.lightbox-close',
    closeOnBackdrop: true,
    closeOnEscape: true,
    restoreFocus: true,
    onClose: handleLightboxClose,
});

galleryContainer.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;

    const item = event.target.closest('.island-misc-item');
    if (!item || !galleryContainer.contains(item)) return;

    openLightbox(Number(item.dataset.galleryIndex));
});

lightboxNext.addEventListener('click', showNextImage);
lightboxPrev.addEventListener('click', showPrevImage);

document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) return;

    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        showPrevImage();
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        showNextImage();
    }
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
            const startIndex = allImages.length;
            const images = result.value.map((image, imageIndex) => ({
                ...image,
                galleryIndex: startIndex + imageIndex,
            }));
            allImages.push(...images);
            renderSection(cat.key, images);
        } else {
            console.error(`Failed to load ${cat.key}:`, result.reason);
            showSectionError(cat.key, result.reason?.message || '알 수 없는 오류');
        }
    });
}

init();
