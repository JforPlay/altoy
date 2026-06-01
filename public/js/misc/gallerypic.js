/**
 * gallerypic.js
 * Gallery viewer for in-game illustration images.
 */

import { IMG_FALLBACKS, createImgElement, fetchJSON, openModal, setupModal, requireElements, DATA_FOR_TOY_BASE } from '../utils.js';

document.addEventListener('DOMContentLoaded', async () => {
    const gallery = document.getElementById('gallery');
    const status = document.getElementById('gallery-status');
    const modalImage = document.getElementById('modal-image');

    if (!requireElements({ gallery, status, modalImage }, 'Gallery picture viewer')) {
        return;
    }

    const baseImageUrl = `${DATA_FOR_TOY_BASE}/gallerypic/`;

    function setStatus(message, isError = false) {
        status.textContent = message;
        status.classList.toggle('error', isError);
        status.hidden = false;
    }

    function hideStatus() {
        status.hidden = true;
    }

    function normalizeIllustrationName(rawName) {
        return String(rawName || '').replace(/^gallerypic/i, 'GalleryPic').replace(/[^A-Za-z0-9_-]/g, '');
    }

    function createGalleryItem(item) {
        const formattedName = normalizeIllustrationName(item.illustration);
        if (!formattedName) return null;

        const thumbnailUrl = `${baseImageUrl}${formattedName}_t.webp`;
        const fullImageUrl = `${baseImageUrl}${formattedName}.webp`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gallery-item';
        button.dataset.fullSrc = fullImageUrl;
        button.dataset.imageName = formattedName;
        button.setAttribute('aria-label', `Open gallery image ${formattedName}`);

        const img = createImgElement(thumbnailUrl, `Gallery thumbnail for ${formattedName}`, {
            className: 'gallery-item-image',
            fallback: IMG_FALLBACKS.CARD
        });

        button.appendChild(img);
        return button;
    }

    function renderGallery(data) {
        const fragment = document.createDocumentFragment();
        Object.values(data).forEach(item => {
            if (!item || typeof item !== 'object' || !item.illustration) return;
            const galleryItem = createGalleryItem(item);
            if (galleryItem) fragment.appendChild(galleryItem);
        });

        gallery.replaceChildren(fragment);
        if (gallery.children.length === 0) {
            setStatus('No gallery images found.');
        } else {
            hideStatus();
        }
    }

    gallery.addEventListener('click', event => {
        const item = event.target.closest('.gallery-item');
        if (!item) return;

        modalImage.src = item.dataset.fullSrc;
        modalImage.alt = `Full-size gallery image ${item.dataset.imageName || ''}`.trim();
        openModal('modal');
    });

    setupModal('modal', {
        closeButtonSelector: '#close',
        closeOnBackdrop: true,
        closeOnEscape: true,
        restoreFocus: true,
        onClose: () => {
            modalImage.removeAttribute('src');
            modalImage.alt = '';
        }
    });

    setStatus('Loading gallery images...');
    try {
        const data = await fetchJSON('data/misc/gallery_data.json');
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid gallery data payload.');
        }
        renderGallery(data);
    } catch (error) {
        console.error('Error fetching or processing gallery data:', error);
        gallery.replaceChildren();
        setStatus('Could not load gallery images. Please try again later.', true);
    }
});
