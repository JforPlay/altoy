/**
 * skin.expression.js
 * Expression overlay logic and image gallery rendering for the skin detail viewer.
 * Handles face-expression selectors, base+overlay compositing, lightbox navigation,
 * and thumbnail display. Part of the skin module group; wired by skin.detail.viewer.js.
 */
import { hideElement, showElement, createImgElement, createIcon, lockBodyScroll, unlockBodyScroll } from '../utils.js';

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

// ===== Lightbox =====

/**
 * Open the lightbox with a pre-built image array, starting at the given index.
 */
function openLightbox(images, startIndex = 0) {
    state.currentLightboxImages = images;
    state.currentLightboxIndex = startIndex;
    updateLightboxContent();
    state.lightboxModal.classList.add('active');
    state.lightboxModal.setAttribute('aria-hidden', 'false');
    lockBodyScroll();
}

function closeLightbox() {
    state.lightboxModal.classList.remove('active');
    state.lightboxModal.setAttribute('aria-hidden', 'true');
    unlockBodyScroll();
}

function updateLightboxContent() {
    if (state.currentLightboxImages.length === 0) return;
    const currentImg = state.currentLightboxImages[state.currentLightboxIndex];
    state.lightboxImage.src = currentImg.src;
    state.lightboxImage.alt = currentImg.alt;
    state.lightboxCaption.textContent = currentImg.caption || '';
    state.lightboxCounter.textContent = `${state.currentLightboxIndex + 1} / ${state.currentLightboxImages.length}`;
}

/**
 * Trigger CSS slide animation in the given direction ('left' or 'right').
 * The forced reflow ensures the remove→add class cycle actually animates.
 */
function animateSlide(direction) {
    state.lightboxImage.classList.remove('animating', 'slide-from-left', 'slide-from-right');
    void state.lightboxImage.offsetWidth; // force reflow so class removal is committed before re-add
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

// ===== Gallery Rendering =====

/**
 * Build and mount the full image gallery for a skin into the given container.
 * Renders: expression selector (if manifest entry exists), main painting with overlay,
 * zoomed painting with overlay, and thumbnail panels. Attaches expression/lightbox handlers.
 */
function renderImageGallery(skin, container) {
    const topNodes = [];
    const galleryImages = [];
    const skinId = skin['클뜯 id'];

    // Apply manifest box/size as percentage-based positioning to an overlay element.
    const applyOverlayStyle = (el, entry) => {
        if (!entry || !entry.box || !entry.size) return;
        const [x, y, w, h] = entry.box;
        const [imgW, imgH] = entry.size;
        el.style.left = `${(x / imgW) * 100}%`;
        el.style.top = `${(y / imgH) * 100}%`;
        el.style.width = `${(w / imgW) * 100}%`;
        el.style.height = `${(h / imgH) * 100}%`;
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
        const defaultFaceUrl = `${baseDir}/painting_face_${mainDefaultFace}.png`;

        topNodes.push(buildExpressionSelector(manifestData.faces, mainDefaultFace, baseDir));
        topNodes.push(buildOverlayContainer({
            baseName: 'painting',
            baseImageUrl,
            overlayUrl: defaultFaceUrl,
            manifest: manifestData,
            applyOverlayStyle,
            baseClass: 'base-image gallery-top-banner',
            alt: '전체 일러스트'
        }));
        galleryImages.push({ src: baseImageUrl, alt: '전체 일러스트', caption: '전체 일러스트' });
    } else if (skin['전체 일러']) {
        topNodes.push(createImgElement(skin['전체 일러'], '전체 일러스트', { className: 'gallery-top-banner' }));
        galleryImages.push({ src: skin['전체 일러'], alt: '전체 일러스트', caption: '전체 일러스트' });
    }

    // Bottom Panel
    const bottomLeft = document.createElement('div');
    bottomLeft.className = 'bottom-left-panel';

    // Zoomed Art (with expression check)
    const zoomedManifestKey = `${skinId}_n`;
    const zoomedManifest = state.expressionManifest[zoomedManifestKey];
    const hasZoomedExpressionArt = !!(zoomedManifest && zoomedManifest.faces && zoomedManifest.faces.length > 0);

    if (hasZoomedExpressionArt) {
        const baseImageUrl = `${baseDir}/painting_n.png`;
        const zoomDefaultFace = (mainDefaultFace && zoomedManifest.faces.includes(mainDefaultFace)) ? mainDefaultFace : getDefaultFace(zoomedManifest.faces);
        const defaultFaceUrl = `${baseDir}/painting_n_face_${zoomDefaultFace}.png`;

        bottomLeft.appendChild(buildOverlayContainer({
            baseName: 'painting_n',
            baseImageUrl,
            overlayUrl: defaultFaceUrl,
            manifest: zoomedManifest,
            applyOverlayStyle,
            baseClass: 'base-image',
            alt: '확대 일러스트'
        }));
        galleryImages.push({ src: baseImageUrl, alt: '확대 일러스트', caption: '확대 일러스트' });
    } else if (skin['확대 일러']) {
        bottomLeft.appendChild(createImgElement(skin['확대 일러'], '확대 일러스트'));
        galleryImages.push({ src: skin['확대 일러'], alt: '확대 일러스트', caption: '확대 일러스트' });
    } else {
        const dummy = document.createElement('div');
        dummy.className = 'dummy-image-box';
        dummy.textContent = '이 스킨은 확대 일러가 없어요 지휘관님';
        bottomLeft.appendChild(dummy);
    }

    // Thumbnails
    const bottomRight = document.createElement('div');
    bottomRight.className = 'bottom-right-panel';

    const tallSources = [
        { src: skin['깔끔한 일러'], caption: '깔끔한 일러스트' },
        { src: skin['sd 일러'], caption: 'SD 일러스트' }
    ].filter(i => i.src);
    const smallSources = [
        { src: skin['아이콘 일러'], caption: '아이콘' },
        { src: skin['쥬스타 아이콘 일러'], caption: '쥬스타 아이콘' }
    ].filter(i => i.src);

    if (tallSources.length > 0) {
        const group = document.createElement('div');
        group.className = 'thumbnail-group tall-group';
        tallSources.forEach(item => {
            group.appendChild(createImgElement(item.src, item.caption, { className: 'tall-thumbnail' }));
            galleryImages.push(item);
        });
        bottomRight.appendChild(group);
    }
    if (smallSources.length > 0) {
        const group = document.createElement('div');
        group.className = 'thumbnail-group small-group';
        smallSources.forEach(item => {
            group.appendChild(createImgElement(item.src, item.caption));
            galleryImages.push(item);
        });
        bottomRight.appendChild(group);
    }

    let bottomPanel = null;
    if (hasZoomedExpressionArt || skin['확대 일러'] || tallSources.length || smallSources.length) {
        bottomPanel = document.createElement('div');
        bottomPanel.className = 'gallery-bottom-panel';
        bottomPanel.append(bottomLeft, bottomRight);
    }

    if (topNodes.length === 0 && !bottomPanel) {
        container.replaceChildren();
        hideElement(container);
        return;
    }

    container.replaceChildren();
    topNodes.forEach(node => container.appendChild(node));
    if (bottomPanel) container.appendChild(bottomPanel);
    showElement(container);

    // Attach Handlers (Selectors & Lightbox)
    attachGalleryHandlers(container, galleryImages, baseDir);
    addImageErrorHandlers(container);
}

/** Build the expression-thumbnail selector strip with default-face highlighted. */
function buildExpressionSelector(faces, defaultFace, baseDir) {
    const selectorContainer = document.createElement('div');
    selectorContainer.className = 'expression-selector-container';

    const header = document.createElement('div');
    header.className = 'expression-header';

    const label = document.createElement('div');
    label.className = 'expression-label';
    const hint = document.createElement('span');
    hint.className = 'expression-hint';
    hint.textContent = '(메인/확대 일러스트가 함께 변경됩니다)';
    label.append(createIcon('fas fa-smile'), ' 표정 선택 ', hint);

    const note = document.createElement('div');
    note.className = 'expression-note';
    note.textContent = '일러스트 클릭 후 확대 상태에서 저장해야 표정이 같이 저장됩니다';

    header.append(label, note);

    const selector = document.createElement('div');
    selector.className = 'expression-selector';
    faces.forEach(faceId => {
        const thumb = createImgElement(
            `${baseDir}/painting_face_${faceId}.png`,
            `Face ${faceId}`,
            { className: faceId === defaultFace ? 'expression-thumb active' : 'expression-thumb' }
        );
        thumb.dataset.faceId = faceId;
        selector.appendChild(thumb);
    });

    selectorContainer.append(header, selector);
    return selectorContainer;
}

/** Build a base-image + face-overlay container that the lightbox can canvas-composite. */
function buildOverlayContainer({ baseName, baseImageUrl, overlayUrl, manifest, applyOverlayStyle, baseClass, alt }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'face-overlay-container';
    wrapper.dataset.baseName = baseName;

    const baseImg = createImgElement(baseImageUrl, alt, { className: baseClass });
    baseImg.crossOrigin = 'anonymous';

    const overlayImg = createImgElement(overlayUrl, 'Expression', { className: 'face-overlay' });
    overlayImg.crossOrigin = 'anonymous';
    applyOverlayStyle(overlayImg, manifest);

    wrapper.append(baseImg, overlayImg);
    return wrapper;
}


/**
 * Attach expression-thumb click handlers (update all face-overlay imgs) and
 * lightbox triggers on gallery images. Canvas-composites overlay+base on click when loaded.
 */
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

/**
 * Canvas-composite the base image and face overlay from a face-overlay-container element.
 * Returns null if base image isn't loaded or canvas throws (CORS).
 * @returns {{ src, alt, caption } | null}
 */
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
