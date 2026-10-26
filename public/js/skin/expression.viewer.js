/**
 * expression.viewer.js
 * Page controller for the standalone expression illustration viewer.
 * Shows base + face composites for characters whose expressions are not shown
 * in the skin detail page; includes a lightbox of the same composite.
 * Part of the skin module group.
 *
 * The base painting has a transparent face hole, so the preview is ONE <canvas>
 * composited by skin.expression.js composeOverlay (the skin detail viewer's
 * seam-free path) and the lightbox snapshots it — never the bare painting, and
 * never a CSS-stacked base <img> + face <img>: the browser resamples those two
 * layers independently, so the hole edge showed as a thin dark frame.
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
    sanitizeFilename,
    renderStatus
} from '../utils.js';
import { pickFaceCandidates } from '../expression-face.js';
import { composeOverlay, expUrl, MAX_COMPOSITE_DIM } from './skin.expression.js';

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

    // Bumped on every lightbox open and close; a stale async snapshot checks it
    // before painting, so a reopen/close can't be overwritten by an earlier one.
    let lightboxToken = 0;
    let lightboxUrl = null; // composite blob URL, revoked on close

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
            const status = renderStatus(elements.loadingState, '데이터 로딩 실패', 'error');
            if (status && error.message) {
                const detail = document.createElement('p');
                detail.className = 'page-status-msg';
                detail.textContent = error.message;
                status.appendChild(detail);
            }
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
                lightboxToken++;
                elements.lightboxModal.setAttribute('aria-hidden', 'true');
                elements.lightboxImage.removeAttribute('src');
                if (lightboxUrl) URL.revokeObjectURL(lightboxUrl);
                lightboxUrl = null;
            }
        });

        const downloadBtn = elements.lightboxModal.querySelector('.lightbox-download');
        if (downloadBtn) downloadBtn.addEventListener('click', downloadCurrentImage);

        window.addEventListener('popstate', applyURLParams);
    }

    /**
     * Save the current lightbox image. The displayed src is the canvas composite
     * blob URL — mobile long-press doesn't reliably surface the save menu for
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
            renderStatus(elements.searchDropdown, '검색 결과가 없습니다', 'empty', { compact: true });
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
            renderStatus(elements.characterGrid, '검색 결과가 없습니다', 'empty');
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
            if (hasPainting) badges.appendChild(createBadge('badge--info', '기본'));
            if (hasZoomed) badges.appendChild(createBadge('badge--neutral', '확대'));

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

    // Game-faithful default face for the current painting type. Shares the
    // chain (manifest `default` → '0' → numerically-smallest) with the story
    // viewer and skin pages via expression-face.js — never the arbitrary
    // atlas-order `faces[0]`, which is wrong for ~77% of paintings here.
    function getDefaultFace(item) {
        const data = item[state.currentPaintingType];
        return pickFaceCandidates(data, null)[0] || null;
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
            renderStatus(elements.viewerPanel, '선택한 일러스트 타입이 없습니다.', 'empty');
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
     * Build the viewer-panel preview: a button holding ONE <canvas> that
     * composeOverlay fills with base + face (it caches the decoded base, so a
     * face switch only redraws, and swaps in an error box if the base fails).
     * The canvas is sized up front from the manifest so layout stays stable.
     */
    function renderImageWithOverlay(data) {
        if (!data) {
            return createStatusElement('이미지 없음', 'empty');
        }

        const container = document.createElement('button');
        container.type = 'button';
        container.className = 'face-overlay-container';
        container.setAttribute('aria-label', '이미지 확대 보기');

        const canvas = document.createElement('canvas');
        canvas.className = 'base-image';
        if (data.size) {
            const [sw, sh] = data.size;
            const scale = Math.min(1, MAX_COMPOSITE_DIM / Math.max(sw, sh));
            canvas.width = Math.round(sw * scale);
            canvas.height = Math.round(sh * scale);
        }
        container.appendChild(canvas);

        container._overlay = { baseUrl: expUrl(data.base_url), faceUrl: faceUrlFor(data), manifest: data };
        container._gen = 0;
        container._composePromise = composeOverlay(container);
        return container;
    }

    function faceUrlFor(data) {
        return expUrl(data.face_url_template.replace('{faceId}', state.currentFaceId || '0'));
    }

    function updateFaceOverlay() {
        const item = state.selectedCharacter;
        if (!item) return;

        const currentData = item[state.currentPaintingType];
        if (!currentData) return;

        const container = elements.viewerPanel.querySelector('.face-overlay-container');
        if (container?._overlay) {
            container._overlay.faceUrl = faceUrlFor(currentData);
            container._composePromise = composeOverlay(container);
        }
    }

    /**
     * Open the lightbox with a PNG snapshot of the preview <canvas>, so it shows
     * the same seam-free composite (never the bare, hole-punched base). toBlob,
     * NOT toDataURL: the canvas is up to 4096², and a synchronous encode of that
     * freezes the page. A generation token guards against a stale snapshot
     * landing after the user closed or reopened the box.
     */
    async function openLightbox() {
        const item = state.selectedCharacter;
        const container = elements.viewerPanel.querySelector('.face-overlay-container');
        if (!item || !container) return;

        const token = ++lightboxToken;
        elements.lightboxCaption.textContent = `${item.name} - ${state.currentPaintingType === 'painting' ? '기본 일러' : '확대 일러'}`;
        openModal('lightbox-modal', {
            onOpen: modal => modal.setAttribute('aria-hidden', 'false')
        });

        await container._composePromise;
        const canvas = container.querySelector('canvas.base-image');
        const blob = container._composed && canvas
            ? await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
            : null;
        if (token !== lightboxToken || !blob) return;
        lightboxUrl = URL.createObjectURL(blob);
        elements.lightboxImage.src = lightboxUrl;
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

    // Build a detached canonical .page-status element (components/status.css) for
    // call sites that need to insert/return it themselves (e.g. replaceWith or as
    // a return value), rather than rendering straight into a container.
    function createStatusElement(message, type) {
        const holder = document.createElement('div');
        renderStatus(holder, message, type);
        return holder.firstElementChild;
    }
});
