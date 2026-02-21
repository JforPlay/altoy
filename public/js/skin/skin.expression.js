/**
 * Skin Expression & Gallery Module
 * Handles image gallery rendering, expression overlay logic, and lightbox functionality.
 */
import { showElement } from '../utils.js';

const state = {
    expressionManifest: {},
    currentLightboxImages: [],
    currentLightboxIndex: 0,
    lightboxModal: null,
    lightboxImage: null,
    lightboxCaption: null,
    lightboxCounter: null
};

/**
 * Initialize lightbox elements
 */
function init() {
    state.lightboxModal = document.getElementById('lightbox-modal');
    state.lightboxImage = document.getElementById('lightbox-image');
    state.lightboxCaption = state.lightboxModal.querySelector('.lightbox-caption');
    state.lightboxCounter = state.lightboxModal.querySelector('.lightbox-counter');

    const closeBtn = state.lightboxModal.querySelector('.lightbox-close');
    const prevBtn = state.lightboxModal.querySelector('.lightbox-prev');
    const nextBtn = state.lightboxModal.querySelector('.lightbox-next');

    closeBtn.addEventListener('click', closeLightbox);
    prevBtn.addEventListener('click', showPrevImage);
    nextBtn.addEventListener('click', showNextImage);

    state.lightboxModal.addEventListener('click', (e) => {
        if (e.target === state.lightboxModal) closeLightbox();
    });

    document.addEventListener('keydown', (e) => {
        if (!state.lightboxModal.classList.contains('active')) return;
        switch (e.key) {
            case 'Escape': closeLightbox(); break;
            case 'ArrowLeft': showPrevImage(); break;
            case 'ArrowRight': showNextImage(); break;
        }
    });
}

function setManifest(manifest) {
    state.expressionManifest = manifest || {};
}

// Lightbox Logic
function openLightbox(images, startIndex = 0) {
    state.currentLightboxImages = images;
    state.currentLightboxIndex = startIndex;
    updateLightboxContent();
    state.lightboxModal.classList.add('active');
    state.lightboxModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
}

function closeLightbox() {
    state.lightboxModal.classList.remove('active');
    state.lightboxModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
}

function updateLightboxContent() {
    if (state.currentLightboxImages.length === 0) return;
    const currentImg = state.currentLightboxImages[state.currentLightboxIndex];
    state.lightboxImage.src = currentImg.src;
    state.lightboxImage.alt = currentImg.alt;
    state.lightboxCaption.textContent = currentImg.caption || '';
    state.lightboxCounter.textContent = `${state.currentLightboxIndex + 1} / ${state.currentLightboxImages.length}`;
}

function animateSlide(direction) {
    state.lightboxImage.classList.remove('animating', 'slide-from-left', 'slide-from-right');
    void state.lightboxImage.offsetWidth; // Force reflow
    state.lightboxImage.classList.add(`slide-from-${direction}`);
    requestAnimationFrame(() => {
        state.lightboxImage.classList.add('animating');
        state.lightboxImage.classList.remove(`slide-from-${direction}`);
    });
}

function showPrevImage() {
    if (state.currentLightboxImages.length === 0) return;
    state.currentLightboxIndex = (state.currentLightboxIndex - 1 + state.currentLightboxImages.length) % state.currentLightboxImages.length;
    updateLightboxContent();
    animateSlide('left');
}

function showNextImage() {
    if (state.currentLightboxImages.length === 0) return;
    state.currentLightboxIndex = (state.currentLightboxIndex + 1) % state.currentLightboxImages.length;
    updateLightboxContent();
    animateSlide('right');
}

// Gallery Rendering
function renderImageGallery(skin, container) {
    let galleryHtml = '';
    const galleryImages = [];
    const skinId = skin['클뜯 id'];

    // Helper: Compute overlay CSS from manifest box/size
    const computeOverlayStyle = (entry) => {
        if (!entry || !entry.box || !entry.size) return { style: '' };
        const [x, y, w, h] = entry.box;
        const [imgW, imgH] = entry.size;
        return {
            style: `left: ${(x / imgW) * 100}%; top: ${(y / imgH) * 100}%; width: ${(w / imgW) * 100}%; height: ${(h / imgH) * 100}%;`
        };
    };

    const getDefaultFace = (faces) => (faces && faces.includes('0') ? '0' : (faces ? faces[0] : '0'));

    let manifestData = null;
    let baseDir = '';

    if (skinId) {
        baseDir = `https://raw.githubusercontent.com/JforPlay/data_for_toy/main/output_expressions/${skinId}`;
        if (state.expressionManifest[skinId]) {
            manifestData = state.expressionManifest[skinId];
        }
    }

    const mainDefaultFace = manifestData ? getDefaultFace(manifestData.faces) : null;

    // Top Banner (Full Art)
    if (manifestData && manifestData.faces && manifestData.faces.length > 0) {
        const baseImageUrl = `${baseDir}/painting.png`;
        const overlayStyle = computeOverlayStyle(manifestData);
        const defaultFaceUrl = `${baseDir}/painting_face_${mainDefaultFace}.png`;

        // Expression Selector
        let expressionSelectorHtml = `
            <div class="expression-selector-container">
                <div class="expression-header">
                    <div class="expression-label">
                        <i class="fas fa-smile"></i> 표정 선택
                        <span class="expression-hint">(메인/확대 일러스트가 함께 변경됩니다)</span>
                    </div>
                    <div class="expression-note">일러스트 클릭 후 확대 상태에서 저장해야 표정이 같이 저장됩니다</div>
                </div>
                <div class="expression-selector">
        `;
        manifestData.faces.forEach(faceId => {
            const activeClass = faceId === mainDefaultFace ? 'active' : '';
            const thumbUrl = `${baseDir}/painting_face_${faceId}.png`;
            expressionSelectorHtml += `<img src="${thumbUrl}" class="expression-thumb ${activeClass}" data-face-id="${faceId}" alt="Face ${faceId}" loading="lazy">`;
        });
        expressionSelectorHtml += `</div></div>`;
        galleryHtml += expressionSelectorHtml;

        galleryHtml += `
            <div class="face-overlay-container" data-base-name="painting">
                <img class="base-image gallery-top-banner" src="${baseImageUrl}" alt="전체 일러스트" loading="lazy" crossorigin="anonymous">
                <img class="face-overlay" src="${defaultFaceUrl}" style="${overlayStyle.style}" alt="Expression" crossorigin="anonymous">
            </div>
        `;
        galleryImages.push({ src: baseImageUrl, alt: '전체 일러스트', caption: '전체 일러스트' });
    } else if (skin['전체 일러']) {
        galleryHtml += `<img class="gallery-top-banner" src="${skin['전체 일러']}" alt="전체 일러스트" loading="lazy">`;
        galleryImages.push({ src: skin['전체 일러'], alt: '전체 일러스트', caption: '전체 일러스트' });
    }

    // Bottom Panel
    let bottomPanelHtml = '';
    let bottomLeftHtml = '<div class="bottom-left-panel">';

    // Zoomed Art (with expression check)
    const zoomedManifestKey = `${skinId}_n`;
    const zoomedManifest = state.expressionManifest[zoomedManifestKey];

    if (zoomedManifest && zoomedManifest.faces && zoomedManifest.faces.length > 0) {
        const baseImageUrl = `${baseDir}/painting_n.png`;
        const overlayStyle = computeOverlayStyle(zoomedManifest);
        const zoomDefaultFace = (mainDefaultFace && zoomedManifest.faces.includes(mainDefaultFace)) ? mainDefaultFace : getDefaultFace(zoomedManifest.faces);
        const defaultFaceUrl = `${baseDir}/painting_n_face_${zoomDefaultFace}.png`;

        bottomLeftHtml += `
            <div class="face-overlay-container" data-base-name="painting_n">
                <img class="base-image" src="${baseImageUrl}" alt="확대 일러스트" loading="lazy" crossorigin="anonymous">
                <img class="face-overlay" src="${defaultFaceUrl}" style="${overlayStyle.style}" alt="Expression" crossorigin="anonymous">
            </div>
        `;
        galleryImages.push({ src: baseImageUrl, alt: '확대 일러스트', caption: '확대 일러스트' });
    } else if (skin['확대 일러']) {
        bottomLeftHtml += `<img src="${skin['확대 일러']}" alt="확대 일러스트" loading="lazy">`;
        galleryImages.push({ src: skin['확대 일러'], alt: '확대 일러스트', caption: '확대 일러스트' });
    } else {
        bottomLeftHtml += `<div class="dummy-image-box">이 스킨은 확대 일러가 없어요 지휘관님</div>`;
    }
    bottomLeftHtml += '</div>';

    // Thumbnails
    let bottomRightHtml = '<div class="bottom-right-panel">';
    const tallSources = [{ src: skin['깔끔한 일러'], caption: '깔끔한 일러스트' }, { src: skin['sd 일러'], caption: 'SD 일러스트' }].filter(i => i.src);
    const smallSources = [{ src: skin['아이콘 일러'], caption: '아이콘' }, { src: skin['쥬스타 아이콘 일러'], caption: '쥬스타 아이콘' }].filter(i => i.src);

    if (tallSources.length > 0) {
        bottomRightHtml += '<div class="thumbnail-group tall-group">';
        tallSources.forEach(item => {
            bottomRightHtml += `<img src="${item.src}" class="tall-thumbnail" alt="${item.caption}" loading="lazy">`;
            galleryImages.push(item);
        });
        bottomRightHtml += '</div>';
    }
    if (smallSources.length > 0) {
        bottomRightHtml += '<div class="thumbnail-group small-group">';
        smallSources.forEach(item => {
            bottomRightHtml += `<img src="${item.src}" alt="${item.caption}" loading="lazy">`;
            galleryImages.push(item);
        });
        bottomRightHtml += '</div>';
    }
    bottomRightHtml += '</div>';

    if (skin['확대 일러'] || tallSources.length || smallSources.length) {
        bottomPanelHtml = `<div class="gallery-bottom-panel">${bottomLeftHtml}${bottomRightHtml}</div>`;
    }

    container.innerHTML = galleryHtml + bottomPanelHtml;
    showElement(container);

    // Attach Handlers (Selectors & Lightbox)
    attachGalleryHandlers(container, galleryImages, baseDir);
    addImageErrorHandlers(container);
}

function attachGalleryHandlers(container, galleryImages, baseDir) {
    // Expression Selectors
    const thumbs = container.querySelectorAll('.expression-thumb');
    const overlays = container.querySelectorAll('.face-overlay-container');

    thumbs.forEach(thumb => {
        thumb.addEventListener('click', (e) => {
            e.stopPropagation();
            const faceId = thumb.getAttribute('data-face-id');

            overlays.forEach(ov => {
                const baseName = ov.getAttribute('data-base-name');
                const img = ov.querySelector('.face-overlay');
                if (img && baseName) {
                    img.src = `${baseDir}/${baseName}_face_${faceId}.png`;
                }
            });

            thumbs.forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');
        });
    });

    // Lightbox Triggers
    const images = container.querySelectorAll('img:not(.face-overlay):not(.expression-thumb)');
    images.forEach((img, index) => {
        img.style.cursor = 'pointer';
        img.addEventListener('click', () => {
            const overlayContainer = img.closest('.face-overlay-container');
            if (overlayContainer) {
                const composite = buildComposite(overlayContainer);
                if (composite) {
                    const newGallery = [...galleryImages];
                    newGallery[index] = composite;
                    openLightbox(newGallery, index);
                    return;
                }
            }
            openLightbox(galleryImages, index);
        });
    });
}

function buildComposite(container) {
    const baseImg = container.querySelector('.base-image');
    const overlayImg = container.querySelector('.face-overlay');
    if (!baseImg || !baseImg.complete) return null;

    const canvas = document.createElement('canvas');
    canvas.width = baseImg.naturalWidth;
    canvas.height = baseImg.naturalHeight;
    const ctx = canvas.getContext('2d');

    try {
        ctx.drawImage(baseImg, 0, 0);
        if (overlayImg && overlayImg.complete && overlayImg.style.opacity !== '0') {
            const left = parseFloat(overlayImg.style.left) / 100 * canvas.width;
            const top = parseFloat(overlayImg.style.top) / 100 * canvas.height;
            const width = parseFloat(overlayImg.style.width) / 100 * canvas.width;
            const height = parseFloat(overlayImg.style.height) / 100 * canvas.height;
            ctx.drawImage(overlayImg, left, top, width, height);
        }
        return { src: canvas.toDataURL('image/png'), alt: baseImg.alt, caption: baseImg.alt };
    } catch (e) {
        console.warn('Canvas composite failed (CORS)', e);
        return null;
    }
}

function addImageErrorHandlers(container) {
    container.querySelectorAll('img').forEach(img => {
        img.addEventListener('error', function() {
            if (this.classList.contains('face-overlay') || this.classList.contains('expression-thumb')) return;
            const box = document.createElement('div');
            box.className = 'dummy-image-box';
            box.textContent = '이미지를 불러올 수 없습니다';
            if (this.parentElement) this.parentElement.replaceChild(box, this);
        }, { once: true });
    });
}

// Backwards-compatible global access
window.SkinExpression = {
    init,
    setManifest,
    renderImageGallery
};

export {
    init,
    setManifest,
    renderImageGallery
};
