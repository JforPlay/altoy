/**
 * skin.expression.js
 * Expression overlay logic and image gallery rendering for the skin detail viewer.
 * Handles face-expression selectors, base+face compositing, lightbox navigation,
 * and thumbnail display. Part of the skin module group; wired by skin.detail.viewer.js.
 *
 * The base painting (output_expressions/painting.png) has a transparent hole where
 * the face sits, so it must never be shown alone. The inline preview is a <canvas>
 * with base + face composited onto it (the lightbox snapshots that canvas) —
 * compositing into ONE element instead of CSS-stacking a base <img> + face <img>
 * means no border or sub-pixel offset between layers can reopen the hole. The
 * decoded base is cached per container so an expression switch only redraws.
 */
import { hideElement, showElement, createImgElement, createIcon, lockBodyScroll, unlockBodyScroll, downloadImage, sanitizeFilename, DATA_VERSION, DATA_FOR_TOY_BASE } from '../utils.js';

// Cap the composite canvas — some paintings are 100+ megapixels (e.g. 이404
// 317020 is 11830×10224). A canvas that large overflows browser decode/canvas
// limits and yields a blank (black) result, so downscale the longest side.
const MAX_COMPOSITE_DIM = 4096;

/**
 * Append the data version to an output_expressions URL. The paintings live in a
 * separate repo served via GitHub raw (Cache-Control: max-age=300), so a base
 * painting can change while browsers keep serving a stale copy — which renders
 * the OLD rectangular face hole as a black box around the face. Versioning the
 * URL forces a fresh fetch whenever DATA_VERSION bumps.
 */
function expUrl(url) {
    return `${url}?v=${DATA_VERSION}`;
}

const state = {
    expressionManifest: {},
    currentLightboxImages: [],
    currentLightboxIndex: 0,
    lightboxGeneration: 0,
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
    const downloadBtn = state.lightboxModal.querySelector('.lightbox-download');

    closeBtn.addEventListener('click', closeLightbox);
    prevBtn.addEventListener('click', showPrevImage);
    nextBtn.addEventListener('click', showNextImage);
    if (downloadBtn) downloadBtn.addEventListener('click', downloadCurrentImage);

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

/**
 * Update the lightbox to show the current image. Face-overlay gallery entries
 * snapshot the <canvas> the inline preview already composited, so the lightbox
 * shows identical pixels. Async + generation-guarded so fast navigation can't
 * paint a stale image.
 */
async function updateLightboxContent() {
    if (state.currentLightboxImages.length === 0) return;
    const gen = ++state.lightboxGeneration;
    const currentImg = state.currentLightboxImages[state.currentLightboxIndex];

    state.lightboxImage.alt = currentImg.alt;
    state.lightboxCaption.textContent = currentImg.caption || '';
    state.lightboxCounter.textContent = `${state.currentLightboxIndex + 1} / ${state.currentLightboxImages.length}`;

    let src = currentImg.src;
    if (currentImg.overlay) {
        // Wait for the inline composite, then snapshot its <canvas> to a PNG —
        // a one-off encode on lightbox open, never on an expression switch.
        if (currentImg.overlay._composePromise) await currentImg.overlay._composePromise;
        if (gen !== state.lightboxGeneration) return; // superseded by newer navigation
        const cv = currentImg.overlay.querySelector('canvas.base-image');
        if (currentImg.overlay._composed && cv) src = cv.toDataURL('image/png');
    }
    state.lightboxImage.src = src;
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

/**
 * Save the current lightbox image — the displayed src is already the composite
 * (or a plain URL for non-overlay gallery items), so the helper just blob-fetches
 * it and triggers a download. Mobile long-press on data URLs is unreliable, so
 * this button is the canonical save path.
 */
function downloadCurrentImage() {
    const src = state.lightboxImage?.src;
    if (!src) return;
    const caption = state.lightboxCaption?.textContent || 'altoy-image';
    downloadImage(src, `${sanitizeFilename(caption)}.png`);
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
 *
 * `skinName` is the human-readable skin name (e.g. "프린츠 오이겐 (기본)"); it's
 * prefixed onto each lightbox caption so the user sees which skin they're viewing
 * AND so the saved-image filename ends up specific.
 */
function renderImageGallery(skin, container, skinName = '') {
    const topNodes = [];
    const galleryImages = [];
    const skinId = skin['클뜯 id'];
    const captionFor = (label) => skinName ? `${skinName} - ${label}` : label;

    const getDefaultFace = (faces) => (faces && faces.includes('0') ? '0' : (faces ? faces[0] : '0'));

    let manifestData = null;
    let baseDir = '';

    if (skinId) {
        baseDir = `${DATA_FOR_TOY_BASE}/output_expressions/${skinId}`;
        if (state.expressionManifest[skinId]) {
            manifestData = state.expressionManifest[skinId];
        }
    }

    const mainDefaultFace = manifestData ? getDefaultFace(manifestData.faces) : null;

    // Top Banner (Full Art)
    if (manifestData && manifestData.faces && manifestData.faces.length > 0) {
        const baseImageUrl = expUrl(`${baseDir}/painting.png`);
        const defaultFaceUrl = expUrl(`${baseDir}/painting_face_${mainDefaultFace}.png`);

        const overlayNode = buildOverlayContainer({
            baseName: 'painting',
            baseImageUrl,
            overlayUrl: defaultFaceUrl,
            manifest: manifestData,
            alt: '전체 일러스트'
        });
        topNodes.push(buildExpressionSelector(manifestData.faces, mainDefaultFace, baseDir));
        topNodes.push(overlayNode);
        // `src` (painting.png) has a transparent face hole — the lightbox
        // composites `overlay`'s live face onto it instead of showing it bare.
        galleryImages.push({ src: baseImageUrl, alt: '전체 일러스트', caption: captionFor('전체 일러스트'), overlay: overlayNode });
    } else if (skin['전체 일러']) {
        topNodes.push(createImgElement(skin['전체 일러'], '전체 일러스트', { className: 'gallery-top-banner' }));
        galleryImages.push({ src: skin['전체 일러'], alt: '전체 일러스트', caption: captionFor('전체 일러스트') });
    }

    // Bottom Panel
    const bottomLeft = document.createElement('div');
    bottomLeft.className = 'bottom-left-panel';

    // Zoomed Art (with expression check)
    const zoomedManifestKey = `${skinId}_n`;
    const zoomedManifest = state.expressionManifest[zoomedManifestKey];
    const hasZoomedExpressionArt = !!(zoomedManifest && zoomedManifest.faces && zoomedManifest.faces.length > 0);

    if (hasZoomedExpressionArt) {
        const baseImageUrl = expUrl(`${baseDir}/painting_n.png`);
        const zoomDefaultFace = (mainDefaultFace && zoomedManifest.faces.includes(mainDefaultFace)) ? mainDefaultFace : getDefaultFace(zoomedManifest.faces);
        const defaultFaceUrl = expUrl(`${baseDir}/painting_n_face_${zoomDefaultFace}.png`);

        const overlayNode = buildOverlayContainer({
            baseName: 'painting_n',
            baseImageUrl,
            overlayUrl: defaultFaceUrl,
            manifest: zoomedManifest,
            alt: '확대 일러스트'
        });
        bottomLeft.appendChild(overlayNode);
        // `src` (painting_n.png) has a transparent face hole — composited in the lightbox.
        galleryImages.push({ src: baseImageUrl, alt: '확대 일러스트', caption: captionFor('확대 일러스트'), overlay: overlayNode });
    } else if (skin['확대 일러']) {
        bottomLeft.appendChild(createImgElement(skin['확대 일러'], '확대 일러스트'));
        galleryImages.push({ src: skin['확대 일러'], alt: '확대 일러스트', caption: captionFor('확대 일러스트') });
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
        { src: skin['깔끔한 일러'], caption: captionFor('깔끔한 일러스트') },
        { src: skin['sd 일러'], caption: captionFor('SD 일러스트') }
    ].filter(i => i.src);
    const smallSources = [
        { src: skin['아이콘 일러'], caption: captionFor('아이콘') },
        { src: skin['쥬스타 아이콘 일러'], caption: captionFor('쥬스타 아이콘') }
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
            expUrl(`${baseDir}/painting_face_${faceId}.png`),
            `Face ${faceId}`,
            { className: faceId === defaultFace ? 'expression-thumb active' : 'expression-thumb' }
        );
        thumb.dataset.faceId = faceId;
        selector.appendChild(thumb);
    });

    selectorContainer.append(header, selector);
    return selectorContainer;
}

/**
 * Build a `.face-overlay-container` holding a <canvas> that shows the base
 * painting + face composited together. Using one <canvas> (not a CSS-stacked
 * base <img> + face <img>) means no inter-layer offset can reopen the face hole.
 * The canvas is sized up front from the manifest so layout stays stable while
 * the (async) composite runs.
 */
function buildOverlayContainer({ baseName, baseImageUrl, overlayUrl, manifest, alt }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'face-overlay-container';
    wrapper.dataset.baseName = baseName;

    const canvas = document.createElement('canvas');
    canvas.className = 'base-image';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', alt);
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    if (manifest && manifest.size) {
        const [sw, sh] = manifest.size;
        const scale = Math.min(1, MAX_COMPOSITE_DIM / Math.max(sw, sh));
        canvas.width = Math.round(sw * scale);
        canvas.height = Math.round(sh * scale);
    }
    wrapper.appendChild(canvas);

    wrapper._overlay = { baseUrl: baseImageUrl, faceUrl: overlayUrl, manifest };
    wrapper._gen = 0;
    wrapper._composePromise = composeOverlay(wrapper);
    return wrapper;
}


/**
 * Attach expression-thumb click handlers (re-composite every overlay container
 * with the picked face) and lightbox triggers on gallery images.
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
                if (ov._overlay && baseName) {
                    ov._overlay.faceUrl = expUrl(`${baseDir}/${baseName}_face_${faceId}.png`);
                    ov._composePromise = composeOverlay(ov);
                }
            });

            thumbs.forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');
        });
    });

    // Lightbox triggers — gallery <img>s plus the overlay <canvas>es, in document
    // order so each index lines up with the galleryImages array.
    const clickable = container.querySelectorAll('img:not(.expression-thumb), canvas.base-image');
    clickable.forEach((el, index) => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => openLightbox(galleryImages, index));
    });
}

/**
 * Load an image cross-origin. crossOrigin is set before src so the response is
 * CORS-enabled and a canvas drawn from it stays untainted (toDataURL works).
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`failed to load ${url}`));
        img.src = url;
    });
}

/**
 * Decode the base painting once into an offscreen canvas at composite resolution.
 * Expression switches then redraw from this canvas, never touching the (possibly
 * 100+ MP) source again — so a switch costs only a small face load + two draws.
 * Capped at MAX_COMPOSITE_DIM: a canvas past browser limits composites to blank.
 * @param {string} url - base painting URL
 * @returns {Promise<HTMLCanvasElement>}
 */
async function buildBaseCanvas(url) {
    const base = await loadImage(url);
    const nw = base.naturalWidth;
    const nh = base.naturalHeight;
    if (!nw || !nh) throw new Error('base painting has no dimensions');

    const scale = Math.min(1, MAX_COMPOSITE_DIM / Math.max(nw, nh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(nw * scale);
    canvas.height = Math.round(nh * scale);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
    return canvas; // the decoded source Image falls out of scope and can be freed
}

/**
 * Draw the container's base painting + current face onto its display <canvas>.
 * The base painting has a transparent face hole; compositing base + face onto one
 * <canvas> means no border or sub-pixel offset between layers can reopen it.
 *
 * The decoded base is cached per container (see buildBaseCanvas), so an expression
 * switch only loads the small face and redraws — no re-download, no re-decode, no
 * PNG re-encode. A per-container generation counter discards a run superseded by
 * a faster switch.
 * @param {HTMLElement} wrapper - a `.face-overlay-container` element
 * @returns {Promise<void>}
 */
async function composeOverlay(wrapper) {
    const canvas = wrapper.querySelector('canvas.base-image');
    const ov = wrapper._overlay;
    if (!canvas || !ov) return;
    const gen = ++wrapper._gen;

    try {
        if (!wrapper._baseCanvasPromise) wrapper._baseCanvasPromise = buildBaseCanvas(ov.baseUrl);
        const [baseCanvas, face] = await Promise.all([
            wrapper._baseCanvasPromise,
            loadImage(ov.faceUrl).catch(() => null)
        ]);
        if (gen !== wrapper._gen) return; // a newer expression superseded this run

        if (canvas.width !== baseCanvas.width || canvas.height !== baseCanvas.height) {
            canvas.width = baseCanvas.width;
            canvas.height = baseCanvas.height;
        }
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(baseCanvas, 0, 0);
        if (face && ov.manifest && ov.manifest.box && ov.manifest.size) {
            const [bx, by, bw, bh] = ov.manifest.box;
            const [sw, sh] = ov.manifest.size;
            // box is in manifest-size space; scale it into the (capped) canvas.
            const sx = canvas.width / sw;
            const sy = canvas.height / sh;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(face, bx * sx, by * sy, bw * sx, bh * sy);
        }
        wrapper._composed = true;
    } catch (e) {
        console.warn('Expression composite failed', e);
        if (gen === wrapper._gen && wrapper.parentElement) {
            const box = document.createElement('div');
            box.className = 'dummy-image-box';
            box.textContent = '이미지를 불러올 수 없습니다';
            wrapper.parentElement.replaceChild(box, wrapper);
        }
    }
}

function addImageErrorHandlers(container) {
    // Overlay base images are <canvas> (failures handled in composeOverlay), so
    // this only covers plain gallery <img>s; a broken expression thumb is non-fatal.
    container.querySelectorAll('img').forEach(img => {
        img.addEventListener('error', function() {
            if (this.classList.contains('expression-thumb')) return;
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
