/**
 * island-misc.js
 * Miscellaneous island assets gallery: dress icons, theme icons, rest events, invitations, and draw awards.
 * Fetches file lists from the GitHub API on demand (no pre-processed JSON) and
 * renders an image gallery with a lightbox. Part of the island module group.
 */

import { createImgElement, fetchJSONWithCache, openModal, requireElements, setupModal, renderStatus } from '../utils.js';

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
const CATEGORY_BY_KEY = new Map(CATEGORIES.map(category => [category.key, category]));

// ===== State =====
let allImages = []; // flat loaded list for lightbox navigation
let currentImageIndex = 0;
let currentImageKey = '';
const categoryState = new Map();
const categoryImages = new Map();
const categoryPromises = new Map();
const sectionByCategory = new Map();
let listenersReady = false;

// ===== DOM =====
const lightbox = document.getElementById('island-misc-lightbox');
const lightboxImg = lightbox?.querySelector('.lightbox-img');
const lightboxCaption = lightbox?.querySelector('.lightbox-caption');
const lightboxClose = lightbox?.querySelector('.lightbox-close');
const lightboxPrev = lightbox?.querySelector('.lightbox-prev');
const lightboxNext = lightbox?.querySelector('.lightbox-next');
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
 * Tile activation and image errors are delegated from the gallery container.
 */
function renderSection(category, images) {
    const section = sectionByCategory.get(category);
    if (!section) return;

    const gallery = section.querySelector('.island-misc-gallery');
    const countEl = section.querySelector('.section-count');
    countEl.textContent = `${images.length}개`;

    gallery.replaceChildren();

    if (images.length === 0) {
        renderStatus(gallery, '표시할 이미지가 없습니다.', 'empty');
        return;
    }

    const fragment = document.createDocumentFragment();
    images.forEach(image => {
        const item = document.createElement('button');
        item.className = 'island-misc-item';
        item.type = 'button';
        item.dataset.imageKey = image.key;
        item.setAttribute('aria-label', `${image.displayName} 크게 보기`);

        const img = createImgElement(image.url, image.displayName);
        img.decoding = 'async';
        img.width = 100;
        img.height = 100;
        img.dataset.displayName = image.displayName;

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
    const section = sectionByCategory.get(category);
    if (!section) return;
    const gallery = section.querySelector('.island-misc-gallery');
    renderStatus(gallery, '로딩 중...', 'loading');
}

function showSectionError(category, message) {
    const section = sectionByCategory.get(category);
    if (!section) return;
    const gallery = section.querySelector('.island-misc-gallery');
    renderStatus(gallery, `오류: ${message}`, 'error');
}

function rebuildImageIndex() {
    const activeKey = currentImageKey;
    allImages = CATEGORIES.flatMap(category => categoryImages.get(category.key) || []);
    if (activeKey) {
        const nextIndex = allImages.findIndex(image => image.key === activeKey);
        if (nextIndex !== -1) currentImageIndex = nextIndex;
    }
    if (lightbox?.classList.contains('active')) {
        updateLightboxControls();
    }
}

function setCategoryCount(category, text = '') {
    const section = sectionByCategory.get(category);
    const countEl = section?.querySelector('.section-count');
    if (countEl) countEl.textContent = text;
}

function normalizeImages(category, images) {
    return images.map(image => ({
        ...image,
        key: `${category.key}/${image.name}`,
    }));
}

function loadCategory(category) {
    const key = category.key;
    if (categoryState.get(key) === 'loaded') {
        return Promise.resolve(categoryImages.get(key) || []);
    }
    if (categoryPromises.has(key)) {
        return categoryPromises.get(key);
    }

    categoryState.set(key, 'loading');
    setCategoryCount(key);
    showSectionLoading(key);

    const promise = fetchCategory(category)
        .then(result => {
            const images = normalizeImages(category, result);
            categoryImages.set(key, images);
            categoryState.set(key, 'loaded');
            rebuildImageIndex();
            renderSection(key, images);
            return images;
        })
        .catch(error => {
            categoryState.set(key, 'error');
            categoryImages.delete(key);
            rebuildImageIndex();
            console.warn(`Failed to load ${key}:`, error);
            showSectionError(key, error?.message || '알 수 없는 오류');
            return [];
        })
        .finally(() => {
            categoryPromises.delete(key);
        });

    categoryPromises.set(key, promise);
    return promise;
}

// ===== Lightbox =====

function openLightbox(index) {
    if (!Number.isInteger(index) || index < 0 || index >= allImages.length) return;

    previousActiveElement = document.activeElement;
    currentImageIndex = index;
    currentImageKey = allImages[index]?.key || '';
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

    currentImageKey = image.key;
    lightboxImg.src = image.url;
    lightboxImg.alt = image.displayName;
    lightboxCaption.textContent = image.displayName;
    updateLightboxControls();
}

function openLightboxByKey(imageKey) {
    const index = allImages.findIndex(image => image.key === imageKey);
    openLightbox(index);
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

function cacheSections() {
    sectionByCategory.clear();
    galleryContainer.querySelectorAll('.island-misc-section').forEach(section => {
        const category = CATEGORY_BY_KEY.get(section.dataset.category);
        if (!category) return;
        sectionByCategory.set(category.key, section);
        section.addEventListener('toggle', () => {
            if (section.open) loadCategory(category);
        });
    });
}

function handleGalleryClick(event) {
    if (!(event.target instanceof Element)) return;

    const item = event.target.closest('.island-misc-item');
    if (!item || !galleryContainer.contains(item)) return;

    openLightboxByKey(item.dataset.imageKey);
}

function handleGalleryImageError(event) {
    if (!(event.target instanceof HTMLImageElement)) return;

    const item = event.target.closest('.island-misc-item');
    if (!item || !galleryContainer.contains(item)) return;

    item.classList.add('is-image-missing');
    item.disabled = true;
    item.setAttribute('aria-label', `${event.target.dataset.displayName || event.target.alt} 이미지를 불러올 수 없음`);
}

function handleLightboxKeydown(event) {
    if (!lightbox.classList.contains('active')) return;

    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        showPrevImage();
    } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        showNextImage();
    }
}

function setupEventListeners() {
    if (listenersReady) return;
    listenersReady = true;

    setupModal('island-misc-lightbox', {
        closeButtonSelector: '.lightbox-close',
        closeOnBackdrop: true,
        closeOnEscape: true,
        restoreFocus: true,
        onClose: handleLightboxClose,
    });

    galleryContainer.addEventListener('click', handleGalleryClick);
    galleryContainer.addEventListener('error', handleGalleryImageError, true);
    lightboxNext.addEventListener('click', showNextImage);
    lightboxPrev.addEventListener('click', showPrevImage);
    document.addEventListener('keydown', handleLightboxKeydown);
}

// ===== Initialization =====

/**
 * Load only categories that are initially open; closed sections fetch and render
 * on first expansion so the gallery does not hit every GitHub API endpoint at boot.
 */
function init() {
    if (!requireElements({
        galleryContainer,
        lightbox,
        lightboxImg,
        lightboxCaption,
        lightboxClose,
        lightboxPrev,
        lightboxNext,
    }, 'Island misc')) {
        return;
    }

    cacheSections();
    setupEventListeners();
    CATEGORIES.forEach(category => {
        categoryState.set(category.key, 'idle');
        if (sectionByCategory.get(category.key)?.open) {
            loadCategory(category);
        }
    });
}

init();
