/**
 * expression.viewer.js
 * Page controller for the standalone expression illustration viewer.
 * Shows base-image + face-overlay composites for characters whose expressions
 * are not shown in the skin detail page; includes lightbox with canvas composite.
 * Part of the skin module group.
 *
 * The base painting has a transparent face hole, so the lightbox always shows a
 * canvas-composited base+overlay image — never the bare painting.
 */
import {
    debounce,
    fetchJSON,
    getUrlParam,
    setUrlParams,
    hideElement,
    showElement,
    createSearchIndex,
    ensureFuse,
    setupModal,
    openModal,
    downloadImage,
    sanitizeFilename
} from '../utils.js';

document.addEventListener('DOMContentLoaded', async () => {
    const state = {
        data: [],
        fuse: null,
        selectedCharacter: null,
        currentPaintingType: 'painting', // 'painting' or 'painting_n'
        currentFaceId: null
    };

    const elements = {
        searchInput: document.getElementById('search-input'),
        clearSearchBtn: document.getElementById('clear-search'),
        searchDropdown: document.getElementById('search-dropdown'),
        totalCount: document.getElementById('total-count'),
        filteredCount: document.getElementById('filtered-count'),
        loadingState: document.getElementById('loading-state'),
        mainContent: document.getElementById('main-content'),
        characterGrid: document.getElementById('character-grid'),
        viewerPanel: document.getElementById('viewer-panel'),
        lightboxModal: document.getElementById('lightbox-modal'),
        lightboxImage: document.getElementById('lightbox-image'),
        lightboxCaption: document.querySelector('.lightbox-caption')
    };

    // Bumped on every lightbox open; a stale async composite checks it before
    // painting, so a reopen/close can't be overwritten by an earlier composite.
    let lightboxToken = 0;

    await init();

    /**
     * Bootstrap: load data, build search index, render list, wire event listeners,
     * then apply any URL params for deep-link restoration.
     */
    async function init() {
        try {
            state.data = await fetchJSON('data/skin/expression_viewer_data.json');
            await ensureFuse();
            state.fuse = createSearchIndex(state.data, { keys: ['name', 'id'], threshold: 0.4 });

            elements.totalCount.textContent = state.data.length;
            elements.filteredCount.textContent = `${state.data.length}개`;

            renderCharacterList(state.data);
            setupEventListeners();

            hideElement(elements.loadingState);
            showElement(elements.mainContent);

            applyURLParams();

        } catch (error) {
            console.error('Initialization failed:', error);
            elements.loadingState.replaceChildren(createMessageState({
                iconClass: 'fas fa-exclamation-triangle',
                message: '데이터 로딩 실패',
                detail: error.message,
                className: 'load-error-state'
            }));
        }
    }

    function setupEventListeners() {
        elements.searchInput.addEventListener('input', updateClearButton);
        elements.searchInput.addEventListener('input', debounce(handleSearch, 200));
        elements.searchInput.addEventListener('focus', () => {
            if (elements.searchInput.value.trim()) {
                setDropdownVisible(true);
            }
        });
        elements.searchInput.addEventListener('blur', () => {
            setTimeout(() => setDropdownVisible(false), 200);
        });

        elements.clearSearchBtn.addEventListener('click', () => {
            elements.searchInput.value = '';
            updateClearButton();
            handleSearch();
            elements.searchInput.focus();
        });

        setupModal('lightbox-modal', {
            closeButtonSelector: '.lightbox-close',
            closeOnBackdrop: true,
            closeOnEscape: true,
            restoreFocus: true,
            setAriaHidden: false,
            onClose: () => {
                elements.lightboxModal.setAttribute('aria-hidden', 'true');
                elements.lightboxImage.removeAttribute('src');
            }
        });

        const downloadBtn = elements.lightboxModal.querySelector('.lightbox-download');
        if (downloadBtn) downloadBtn.addEventListener('click', downloadCurrentImage);

        window.addEventListener('popstate', applyURLParams);
    }

    /**
     * Save the current lightbox image. The displayed src is the canvas composite
     * data URL — mobile long-press doesn't reliably surface the save menu for
     * those, so this button is the canonical save path.
     */
    function downloadCurrentImage() {
        const src = elements.lightboxImage.src;
        if (!src) return;
        const caption = elements.lightboxCaption.textContent || 'altoy-expression';
        downloadImage(src, `${sanitizeFilename(caption)}.png`);
    }

    function handleSearch() {
        const query = elements.searchInput.value.trim();

        if (!query) {
            setDropdownVisible(false);
            renderCharacterList(state.data);
            elements.filteredCount.textContent = `${state.data.length}개`;
            return;
        }

        const results = state.fuse.search(query);
        const filteredData = results.map(r => r.item);

        renderSearchDropdown(results.slice(0, 10));
        setDropdownVisible(true);

        renderCharacterList(filteredData);
        elements.filteredCount.textContent = `${filteredData.length}개`;
    }

    function renderSearchDropdown(results) {
        elements.searchDropdown.replaceChildren();

        if (results.length === 0) {
            const noResults = document.createElement('div');
            noResults.className = 'no-results';
            noResults.textContent = '검색 결과가 없습니다';
            elements.searchDropdown.appendChild(noResults);
            return;
        }

        results.forEach(result => {
            const item = result.item;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'dropdown-option';
            button.setAttribute('role', 'option');

            const name = document.createElement('span');
            name.className = 'dropdown-name';
            name.textContent = item.name;

            const id = document.createElement('span');
            id.className = 'dropdown-id';
            id.textContent = item.id;

            button.append(name, id);
            button.addEventListener('click', () => {
                selectCharacter(item);
                setDropdownVisible(false);
            });
            elements.searchDropdown.appendChild(button);
        });
    }

    function renderCharacterList(data) {
        elements.characterGrid.replaceChildren();

        if (data.length === 0) {
            elements.characterGrid.appendChild(createMessageState({
                iconClass: 'fas fa-search',
                message: '검색 결과가 없습니다',
                className: 'empty-list-state'
            }));
            return;
        }

        data.forEach(item => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'character-card';
            card.dataset.id = item.id;
            setActive(card, state.selectedCharacter?.id === item.id);

            const hasPainting = !!item.painting;
            const hasZoomed = !!item.painting_n;

            const topRow = document.createElement('div');
            topRow.className = 'card-top-row';

            const id = document.createElement('span');
            id.className = 'card-id';
            id.textContent = item.id;

            const badges = document.createElement('div');
            badges.className = 'card-badges';
            if (hasPainting) badges.appendChild(createBadge('has-painting', '기본'));
            if (hasZoomed) badges.appendChild(createBadge('has-zoomed', '확대'));

            const name = document.createElement('span');
            name.className = 'card-name';
            name.textContent = item.name;

            topRow.append(id, badges);
            card.append(topRow, name);

            card.addEventListener('click', () => selectCharacter(item));
            elements.characterGrid.appendChild(card);
        });
    }

    function selectCharacter(item, { updateHistory = true } = {}) {
        if (state.selectedCharacter?.id === item.id) return;

        state.selectedCharacter = item;
        state.currentPaintingType = item.painting ? 'painting' : 'painting_n';
        state.currentFaceId = getDefaultFace(item);

        document.querySelectorAll('.character-card').forEach(card => {
            setActive(card, card.dataset.id === item.id);
        });

        if (updateHistory) updateURL(item.id);

        renderViewer();
    }

    function getDefaultFace(item) {
        const data = item[state.currentPaintingType];
        if (!data || !data.faces || data.faces.length === 0) return null;
        return data.faces.includes('0') ? '0' : data.faces[0];
    }

    /**
     * Render the full viewer panel for the selected character:
     * header, painting type tabs, expression selector, and image-with-overlay display.
     */
    function renderViewer() {
        const item = state.selectedCharacter;
        if (!item) return;

        const hasPainting = !!item.painting;
        const hasZoomed = !!item.painting_n;
        const currentData = item[state.currentPaintingType];

        if (!currentData) {
            elements.viewerPanel.replaceChildren(createMessageState({
                iconClass: 'fas fa-image-slash',
                message: '선택한 일러스트 타입이 없습니다.',
                className: 'no-data-state'
            }));
            return;
        }

        const faces = currentData.faces || [];
        state.currentFaceId = state.currentFaceId || getDefaultFace(item);

        const viewerContent = document.createElement('div');
        viewerContent.className = 'viewer-content';

        const viewerHeader = document.createElement('div');
        viewerHeader.className = 'viewer-header';

        const viewerTitle = document.createElement('div');
        viewerTitle.className = 'viewer-title';

        const title = document.createElement('h2');
        title.textContent = item.name;

        const idBadge = document.createElement('span');
        idBadge.className = 'id-badge';
        idBadge.textContent = `ID: ${item.id}`;

        viewerTitle.append(title, idBadge);

        const tabs = document.createElement('div');
        tabs.className = 'painting-tabs';
        tabs.append(
            createPaintingTab('painting', '기본 일러', hasPainting),
            createPaintingTab('painting_n', '확대 일러', hasZoomed)
        );

        viewerHeader.append(viewerTitle, tabs);

        const expressionSection = document.createElement('div');
        expressionSection.className = 'expression-section';

        const expressionLabel = document.createElement('div');
        expressionLabel.className = 'expression-label';
        const smileIcon = document.createElement('i');
        smileIcon.className = 'fas fa-smile';
        smileIcon.setAttribute('aria-hidden', 'true');
        const labelText = document.createElement('span');
        labelText.textContent = '표정 선택';
        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = `(${faces.length}개)`;
        expressionLabel.append(smileIcon, labelText, count);

        const expressionSelector = document.createElement('div');
        expressionSelector.className = 'expression-selector';
        expressionSelector.setAttribute('role', 'group');
        expressionSelector.setAttribute('aria-label', '표정 선택');

        faces.forEach(faceId => {
            const faceUrl = currentData.face_url_template.replace('{faceId}', faceId);
            expressionSelector.appendChild(createExpressionThumb(faceId, faceUrl));
        });

        expressionSection.append(expressionLabel, expressionSelector);

        const imageDisplay = document.createElement('div');
        imageDisplay.className = 'image-display';
        imageDisplay.appendChild(renderImageWithOverlay(currentData));

        viewerContent.append(viewerHeader, expressionSection, imageDisplay);
        elements.viewerPanel.replaceChildren(viewerContent);

        elements.viewerPanel.querySelectorAll('.painting-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                if (tab.disabled) return;
                state.currentPaintingType = tab.dataset.type;
                state.currentFaceId = getDefaultFace(item);
                renderViewer();
            });
        });

        elements.viewerPanel.querySelectorAll('.expression-thumb-btn').forEach(thumb => {
            thumb.addEventListener('click', () => {
                state.currentFaceId = thumb.dataset.faceId;
                updateFaceOverlay();

                elements.viewerPanel.querySelectorAll('.expression-thumb-btn').forEach(t => {
                    setActive(t, t.dataset.faceId === state.currentFaceId);
                });
            });
        });

        const container = elements.viewerPanel.querySelector('.face-overlay-container');
        if (container) {
            container.addEventListener('click', () => openLightbox());
        }
    }

    /**
     * Build the base-image + face-overlay HTML for the viewer panel.
     * The overlay is positioned via percentage-based CSS computed from the manifest box/size.
     */
    function renderImageWithOverlay(data) {
        if (!data) {
            return createMessageState({
                iconClass: 'fas fa-image-slash',
                message: '이미지 없음',
                className: 'no-data-state'
            });
        }

        const baseUrl = data.base_url;
        const faceUrl = data.face_url_template.replace('{faceId}', state.currentFaceId || '0');

        const container = document.createElement('button');
        container.type = 'button';
        container.className = 'face-overlay-container';
        container.setAttribute('aria-label', '이미지 확대 보기');

        const baseImage = document.createElement('img');
        baseImage.className = 'base-image';
        baseImage.src = baseUrl;
        baseImage.alt = '일러스트';
        baseImage.crossOrigin = 'anonymous';
        baseImage.addEventListener('error', () => {
            container.replaceWith(createMessageState({
                iconClass: 'fas fa-image-slash',
                message: '이미지를 불러올 수 없습니다.',
                className: 'no-data-state'
            }));
        }, { once: true });

        const faceOverlay = document.createElement('img');
        faceOverlay.className = 'face-overlay';
        faceOverlay.src = faceUrl;
        faceOverlay.alt = '표정';
        faceOverlay.crossOrigin = 'anonymous';
        applyOverlayStyle(faceOverlay, data);

        container.append(baseImage, faceOverlay);
        return container;
    }

    function applyOverlayStyle(element, data) {
        if (!data || !data.box || !data.size) return;
        const [x, y, w, h] = data.box;
        const [imgW, imgH] = data.size;
        element.style.left = `${(x / imgW) * 100}%`;
        element.style.top = `${(y / imgH) * 100}%`;
        element.style.width = `${(w / imgW) * 100}%`;
        element.style.height = `${(h / imgH) * 100}%`;
    }

    function updateFaceOverlay() {
        const item = state.selectedCharacter;
        if (!item) return;

        const currentData = item[state.currentPaintingType];
        if (!currentData) return;

        const overlay = elements.viewerPanel.querySelector('.face-overlay');
        if (overlay) {
            const faceUrl = currentData.face_url_template.replace('{faceId}', state.currentFaceId);
            overlay.src = faceUrl;
        }
    }

    /**
     * Open the lightbox with a canvas-composited base painting + face overlay.
     *
     * The base painting has a transparent face hole (output_expressions pipeline),
     * so it must never be shown bare. We `await decode()` on both images, then
     * composite — this also covers the case where the base wasn't loaded yet
     * (the old code fell back to the holed `base_url` there). A generation token
     * guards against a stale composite landing after the user reopened the box.
     */
    async function openLightbox() {
        const item = state.selectedCharacter;
        if (!item) return;

        const currentData = item[state.currentPaintingType];
        if (!currentData) return;

        const container = elements.viewerPanel.querySelector('.face-overlay-container');
        const baseImg = container?.querySelector('.base-image');
        const overlayImg = container?.querySelector('.face-overlay');

        const token = ++lightboxToken;
        elements.lightboxCaption.textContent = `${item.name} - ${state.currentPaintingType === 'painting' ? '기본 일러' : '확대 일러'}`;
        openModal('lightbox-modal', {
            onOpen: modal => modal.setAttribute('aria-hidden', 'false')
        });

        const composited = await compositeExpression(baseImg, overlayImg, currentData);
        if (token !== lightboxToken) return; // user reopened/closed before composite finished
        // Fall back to the bare base only if compositing genuinely failed (rare —
        // e.g. an overlay network error). decode() removes the not-loaded-yet case.
        elements.lightboxImage.src = composited || currentData.base_url;
    }

    /**
     * Canvas-composite a base painting + face overlay into a PNG data URL.
     * Awaits `decode()` on both images so an unloaded base still composites.
     * @returns {Promise<string|null>} data URL, or null if compositing fails
     */
    async function compositeExpression(baseImg, overlayImg, data) {
        if (!baseImg) return null;
        try {
            await baseImg.decode();
            if (overlayImg) await overlayImg.decode().catch(() => {});

            const canvas = document.createElement('canvas');
            canvas.width = baseImg.naturalWidth;
            canvas.height = baseImg.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx || !canvas.width || !canvas.height) return null;

            ctx.drawImage(baseImg, 0, 0);
            if (overlayImg && overlayImg.naturalWidth > 0) {
                const [x, y, w, h] = data.box || [0, 0, 0, 0];
                const [imgW, imgH] = data.size || [1, 1];
                ctx.drawImage(overlayImg,
                    (x / imgW) * canvas.width, (y / imgH) * canvas.height,
                    (w / imgW) * canvas.width, (h / imgH) * canvas.height);
            }
            return canvas.toDataURL('image/png');
        } catch (e) {
            console.warn('Expression composite failed', e);
            return null;
        }
    }

    function updateURL(id) {
        setUrlParams({ id }, { replace: false, clear: true });
    }

    function applyURLParams() {
        const id = getUrlParam('id');

        if (id) {
            const item = state.data.find(d => d.id === id);
            if (item) {
                selectCharacter(item, { updateHistory: false });

                const card = document.querySelector(`.character-card[data-id="${id}"]`);
                if (card) {
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        }
    }

    function setActive(el, isActive) {
        el.classList.toggle('active', isActive);
        el.setAttribute('aria-pressed', String(isActive));
    }

    function setDropdownVisible(isVisible) {
        elements.searchDropdown.style.display = isVisible ? 'block' : 'none';
        elements.searchInput.setAttribute('aria-expanded', String(isVisible));
    }

    function updateClearButton() {
        elements.clearSearchBtn.hidden = !elements.searchInput.value;
    }

    function createBadge(className, text) {
        const badge = document.createElement('span');
        badge.className = `badge ${className}`;
        badge.textContent = text;
        return badge;
    }

    function createPaintingTab(type, label, isEnabled) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'painting-tab';
        tab.dataset.type = type;
        tab.textContent = label;
        tab.disabled = !isEnabled;
        setActive(tab, state.currentPaintingType === type);
        return tab;
    }

    function createExpressionThumb(faceId, faceUrl) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'expression-thumb-btn';
        button.dataset.faceId = faceId;
        button.setAttribute('aria-label', `표정 ${faceId}`);
        setActive(button, faceId === state.currentFaceId);

        const img = document.createElement('img');
        img.src = faceUrl;
        img.className = 'expression-thumb';
        img.alt = '';
        img.loading = 'lazy';
        img.setAttribute('aria-hidden', 'true');

        button.appendChild(img);
        return button;
    }

    function createMessageState({ iconClass, message, detail = '', className }) {
        const wrapper = document.createElement('div');
        wrapper.className = className;

        const icon = document.createElement('i');
        icon.className = iconClass;
        icon.setAttribute('aria-hidden', 'true');

        const messageEl = document.createElement('p');
        messageEl.textContent = message;
        wrapper.append(icon, messageEl);

        if (detail) {
            const detailEl = document.createElement('p');
            detailEl.className = 'message-detail';
            detailEl.textContent = detail;
            wrapper.appendChild(detailEl);
        }

        return wrapper;
    }
});
