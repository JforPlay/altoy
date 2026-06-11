/**
 * comic-viewer.js
 * Gallery viewer for in-game manga/comic images served from the JforPlay CDN.
 * Image list is fetched dynamically from the GitHub API; supports sort toggle and lightbox.
 */

import { openModal, setupModal, requireElements, renderStatus, observeLazyImages, DATA_FOR_TOY_BASE } from '../utils.js';

document.addEventListener('DOMContentLoaded', async () => {
    const gallery = document.getElementById('gallery');
    const sortButton = document.getElementById('sort-button');
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');

    if (!requireElements({ gallery, sortButton, lightbox, lightboxImg }, 'Comic viewer')) {
        return;
    }

    const imageBaseUrl = `${DATA_FOR_TOY_BASE}/mangapic/`;
    const apiUrl = 'https://api.github.com/repos/JforPlay/data_for_toy/contents/mangapic';
    const placeholderSrc = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const supportedImagePattern = /\.(avif|gif|jpe?g|png|webp)$/i;

    let imageFiles = [];
    let isAscending = false;
    let imageObserver = null;

    async function fetchImageFiles() {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`GitHub API responded with status: ${response.status}`);
        }

        const data = await response.json();
        if (!Array.isArray(data)) {
            throw new Error('Unexpected GitHub API response format.');
        }

        return data
            .filter(item => item && item.type === 'file' && supportedImagePattern.test(item.name || ''))
            .map(item => item.name);
    }

    function buildImageUrl(imageName) {
        return imageBaseUrl + encodeURIComponent(imageName);
    }

    function openLightbox(imageName) {
        const fullImageUrl = buildImageUrl(imageName);
        lightboxImg.src = fullImageUrl;
        lightboxImg.alt = `Manga image ${imageName}`;
        openModal('lightbox');
    }

    function createGalleryItem(imageName) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'gallery-item';
        item.setAttribute('aria-label', `Open manga image ${imageName}`);

        const loader = document.createElement('div');
        loader.className = 'loader';

        const img = document.createElement('img');
        img.dataset.src = buildImageUrl(imageName);
        img.dataset.name = imageName;
        img.alt = `Manga image ${imageName}`;
        img.classList.add('lazy');
        img.loading = 'lazy';
        img.src = placeholderSrc;

        img.addEventListener('load', () => {
            if (img.src === placeholderSrc) return;
            item.classList.add('loaded');
            img.classList.add('loaded');
        });
        img.addEventListener('error', () => {
            item.classList.add('load-error');
            img.classList.remove('lazy');
            loader.textContent = '!';
        });

        item.addEventListener('click', () => openLightbox(imageName));
        item.append(loader, img);
        gallery.appendChild(item);
    }

    function initializeLazyLoading() {
        if (imageObserver) {
            imageObserver.disconnect();
            imageObserver = null;
        }
        // .loaded class is added by the per-image `load` event handler in createGalleryItem
        // (which discriminates against the placeholder src) — let it own that class.
        imageObserver = observeLazyImages(gallery, {
            rootMargin: '0px 0px 100px 0px',
            useViewportRoot: true,
            addLoadedClass: false,
        });
    }

    function updateSortButton() {
        sortButton.textContent = isAscending ? '정렬: 1화부터' : '정렬: 최신화부터';
        sortButton.setAttribute('aria-pressed', String(isAscending));
    }

    function renderGallery() {
        gallery.replaceChildren();
        if (imageFiles.length === 0) {
            renderStatus(gallery,'No comic images found.', 'empty');
            return;
        }

        imageFiles.forEach(createGalleryItem);
        initializeLazyLoading();
    }

    sortButton.addEventListener('click', () => {
        isAscending = !isAscending;
        imageFiles.sort((a, b) => isAscending ? collator.compare(a, b) : collator.compare(b, a));
        updateSortButton();
        renderGallery();
    });

    setupModal('lightbox', {
        closeButtonSelector: '.close-button',
        closeOnBackdrop: true,
        closeOnEscape: true,
        restoreFocus: true,
        onClose: () => {
            lightboxImg.removeAttribute('src');
            lightboxImg.alt = 'Enlarged Manga Image';
        },
    });

    window.addEventListener('pagehide', () => {
        if (imageObserver) {
            imageObserver.disconnect();
            imageObserver = null;
        }
    }, { once: true });

    try {
        sortButton.disabled = true;
        renderStatus(gallery,'Loading comic images...');
        imageFiles = await fetchImageFiles();
        imageFiles.sort((a, b) => collator.compare(b, a));
        isAscending = false;
        updateSortButton();
        renderGallery();
    } catch (error) {
        console.error('Could not fetch image file list:', error);
        renderStatus(gallery,'Error loading images. Please try again later.', 'error');
    } finally {
        sortButton.disabled = imageFiles.length === 0;
    }
});
