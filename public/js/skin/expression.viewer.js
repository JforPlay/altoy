import { debounce, fetchJSON, getUrlParam, setUrlParams, hideElement, showElement, createSearchIndex, setupModal } from '../utils.js';

/**
 * Expression Viewer
 * Modern viewer for expression illustrations not covered by the skin detail page.
 */
document.addEventListener('DOMContentLoaded', async () => {
    // State
    const state = {
        data: [],
        fuse: null,
        selectedCharacter: null,
        currentPaintingType: 'painting', // 'painting' or 'painting_n'
        currentFaceId: null
    };

    // DOM Elements
    const elements = {
        searchInput: document.getElementById('search-input'),
        searchDropdown: document.getElementById('search-dropdown'),
        totalCount: document.getElementById('total-count'),
        filteredCount: document.getElementById('filtered-count'),
        loadingState: document.getElementById('loading-state'),
        mainContent: document.getElementById('main-content'),
        characterGrid: document.getElementById('character-grid'),
        viewerPanel: document.getElementById('viewer-panel'),
        lightboxModal: document.getElementById('lightbox-modal'),
        lightboxImage: document.getElementById('lightbox-image'),
        lightboxCaption: document.querySelector('.lightbox-caption'),
        lightboxClose: document.querySelector('.lightbox-close')
    };

    // Initialize
    await init();

    async function init() {
        try {
            // Load data
            state.data = await fetchJSON('data/skin/expression_viewer_data.json');

            // Initialize Fuse.js for search
            state.fuse = createSearchIndex(state.data, { keys: ['name', 'id'], threshold: 0.4 });

            // Update UI
            elements.totalCount.textContent = state.data.length;
            elements.filteredCount.textContent = `${state.data.length}개`;

            // Render character list
            renderCharacterList(state.data);

            // Setup event listeners
            setupEventListeners();

            // Hide loading, show content
            hideElement(elements.loadingState);
            showElement(elements.mainContent);

            // Check URL params
            applyURLParams();

        } catch (error) {
            console.error('Initialization failed:', error);
            elements.loadingState.innerHTML = `
                <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: var(--danger-color);"></i>
                <p>데이터 로딩 실패</p>
                <p style="font-size: 0.875rem;">${error.message}</p>
            `;
        }
    }

    function setupEventListeners() {
        // Search input
        elements.searchInput.addEventListener('input', debounce(handleSearch, 200));
        elements.searchInput.addEventListener('focus', () => {
            if (elements.searchInput.value.trim()) {
                elements.searchDropdown.style.display = 'block';
            }
        });
        elements.searchInput.addEventListener('blur', () => {
            setTimeout(() => elements.searchDropdown.style.display = 'none', 200);
        });

        // Lightbox close handlers (close button, backdrop, ESC)
        setupModal('lightbox-modal', {
            closeButtonSelector: '.lightbox-close',
            closeOnBackdrop: true,
            closeOnEscape: true,
            onClose: () => {
                elements.lightboxModal.setAttribute('aria-hidden', 'true');
                document.body.classList.remove('no-scroll');
            }
        });

        // URL changes
        window.addEventListener('popstate', applyURLParams);
    }

    function handleSearch() {
        const query = elements.searchInput.value.trim();

        if (!query) {
            elements.searchDropdown.style.display = 'none';
            renderCharacterList(state.data);
            elements.filteredCount.textContent = `${state.data.length}개`;
            return;
        }

        const results = state.fuse.search(query);
        const filteredData = results.map(r => r.item);

        // Show dropdown
        renderSearchDropdown(results.slice(0, 10));
        elements.searchDropdown.style.display = 'block';

        // Update character list
        renderCharacterList(filteredData);
        elements.filteredCount.textContent = `${filteredData.length}개`;
    }

    function renderSearchDropdown(results) {
        elements.searchDropdown.innerHTML = '';

        if (results.length === 0) {
            elements.searchDropdown.innerHTML = '<div class="no-results">검색 결과가 없습니다</div>';
            return;
        }

        results.forEach(result => {
            const item = result.item;
            const a = document.createElement('a');
            a.innerHTML = `
                <span class="dropdown-name">${item.name}</span>
                <span class="dropdown-id">${item.id}</span>
            `;
            a.addEventListener('click', () => {
                selectCharacter(item);
                elements.searchDropdown.style.display = 'none';
            });
            elements.searchDropdown.appendChild(a);
        });
    }

    function renderCharacterList(data) {
        elements.characterGrid.innerHTML = '';

        data.forEach(item => {
            const card = document.createElement('div');
            card.className = 'character-card';
            card.dataset.id = item.id;

            const hasPainting = !!item.painting;
            const hasZoomed = !!item.painting_n;

            card.innerHTML = `
                <div class="card-top-row">
                    <span class="card-id">${item.id}</span>
                    <div class="card-badges">
                        ${hasPainting ? '<span class="badge has-painting">기본</span>' : ''}
                        ${hasZoomed ? '<span class="badge has-zoomed">확대</span>' : ''}
                    </div>
                </div>
                <span class="card-name">${item.name}</span>
            `;

            card.addEventListener('click', () => selectCharacter(item));
            elements.characterGrid.appendChild(card);
        });
    }

    function selectCharacter(item) {
        state.selectedCharacter = item;
        state.currentPaintingType = item.painting ? 'painting' : 'painting_n';
        state.currentFaceId = getDefaultFace(item);

        // Update active state in list
        document.querySelectorAll('.character-card').forEach(card => {
            card.classList.toggle('active', card.dataset.id === item.id);
        });

        // Update URL
        updateURL(item.id);

        // Render viewer
        renderViewer();
    }

    function getDefaultFace(item) {
        const data = item[state.currentPaintingType];
        if (!data || !data.faces || data.faces.length === 0) return null;
        return data.faces.includes('0') ? '0' : data.faces[0];
    }

    function renderViewer() {
        const item = state.selectedCharacter;
        if (!item) return;

        const hasPainting = !!item.painting;
        const hasZoomed = !!item.painting_n;
        const currentData = item[state.currentPaintingType];

        if (!currentData) {
            elements.viewerPanel.innerHTML = `
                <div class="no-data-state">
                    <i class="fas fa-image-slash"></i>
                    <p>선택한 일러스트 타입이 없습니다.</p>
                </div>
            `;
            return;
        }

        const faces = currentData.faces || [];
        state.currentFaceId = state.currentFaceId || getDefaultFace(item);

        elements.viewerPanel.innerHTML = `
            <div class="viewer-content">
                <div class="viewer-header">
                    <div class="viewer-title">
                        <h2>${item.name}</h2>
                        <span class="id-badge">ID: ${item.id}</span>
                    </div>
                    <div class="painting-tabs">
                        <button class="painting-tab ${state.currentPaintingType === 'painting' ? 'active' : ''}"
                                data-type="painting"
                                ${!hasPainting ? 'disabled' : ''}>
                            기본 일러
                        </button>
                        <button class="painting-tab ${state.currentPaintingType === 'painting_n' ? 'active' : ''}"
                                data-type="painting_n"
                                ${!hasZoomed ? 'disabled' : ''}>
                            확대 일러
                        </button>
                    </div>
                </div>

                <div class="expression-section">
                    <div class="expression-label">
                        <i class="fas fa-smile"></i>
                        <span>표정 선택</span>
                        <span class="count">(${faces.length}개)</span>
                    </div>
                    <div class="expression-selector">
                        ${faces.map(faceId => {
                            const faceUrl = currentData.face_url_template.replace('{faceId}', faceId);
                            const isActive = faceId === state.currentFaceId;
                            return `<img src="${faceUrl}"
                                        class="expression-thumb ${isActive ? 'active' : ''}"
                                        data-face-id="${faceId}"
                                        alt="표정 ${faceId}"
                                        loading="lazy">`;
                        }).join('')}
                    </div>
                </div>

                <div class="image-display">
                    ${renderImageWithOverlay(currentData)}
                </div>
            </div>
        `;

        // Setup tab listeners
        elements.viewerPanel.querySelectorAll('.painting-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                if (tab.disabled) return;
                state.currentPaintingType = tab.dataset.type;
                state.currentFaceId = getDefaultFace(item);
                renderViewer();
            });
        });

        // Setup expression thumb listeners
        elements.viewerPanel.querySelectorAll('.expression-thumb').forEach(thumb => {
            thumb.addEventListener('click', () => {
                state.currentFaceId = thumb.dataset.faceId;
                updateFaceOverlay();

                // Update active state
                elements.viewerPanel.querySelectorAll('.expression-thumb').forEach(t => {
                    t.classList.toggle('active', t.dataset.faceId === state.currentFaceId);
                });
            });
        });

        // Setup lightbox trigger
        const container = elements.viewerPanel.querySelector('.face-overlay-container');
        if (container) {
            container.addEventListener('click', () => openLightbox());
        }
    }

    function renderImageWithOverlay(data) {
        if (!data) return '<div class="no-data-state"><p>이미지 없음</p></div>';

        const baseUrl = data.base_url;
        const faceUrl = data.face_url_template.replace('{faceId}', state.currentFaceId || '0');
        const overlayStyle = computeOverlayStyle(data);

        return `
            <div class="face-overlay-container">
                <img class="base-image" src="${baseUrl}" alt="일러스트" crossorigin="anonymous">
                <img class="face-overlay" src="${faceUrl}" style="${overlayStyle}" alt="표정" crossorigin="anonymous">
            </div>
        `;
    }

    function computeOverlayStyle(data) {
        if (!data || !data.box || !data.size) return '';
        const [x, y, w, h] = data.box;
        const [imgW, imgH] = data.size;
        return `left: ${(x / imgW) * 100}%; top: ${(y / imgH) * 100}%; width: ${(w / imgW) * 100}%; height: ${(h / imgH) * 100}%;`;
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

    function openLightbox() {
        const item = state.selectedCharacter;
        if (!item) return;

        const currentData = item[state.currentPaintingType];
        if (!currentData) return;

        // Build composite image
        const container = elements.viewerPanel.querySelector('.face-overlay-container');
        const baseImg = container?.querySelector('.base-image');
        const overlayImg = container?.querySelector('.face-overlay');

        if (baseImg && baseImg.complete) {
            const canvas = document.createElement('canvas');
            canvas.width = baseImg.naturalWidth;
            canvas.height = baseImg.naturalHeight;
            const ctx = canvas.getContext('2d');

            try {
                ctx.drawImage(baseImg, 0, 0);

                if (overlayImg && overlayImg.complete) {
                    const [x, y, w, h] = currentData.box || [0, 0, 0, 0];
                    const [imgW, imgH] = currentData.size || [1, 1];
                    const left = (x / imgW) * canvas.width;
                    const top = (y / imgH) * canvas.height;
                    const width = (w / imgW) * canvas.width;
                    const height = (h / imgH) * canvas.height;
                    ctx.drawImage(overlayImg, left, top, width, height);
                }

                elements.lightboxImage.src = canvas.toDataURL('image/png');
            } catch (e) {
                console.warn('Canvas composite failed', e);
                elements.lightboxImage.src = currentData.base_url;
            }
        } else {
            elements.lightboxImage.src = currentData.base_url;
        }

        elements.lightboxCaption.textContent = `${item.name} - ${state.currentPaintingType === 'painting' ? '기본 일러' : '확대 일러'}`;
        elements.lightboxModal.classList.add('active');
        elements.lightboxModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('no-scroll');
    }

    // closeLightbox handled by setupModal('lightbox-modal') onClose callback

    function updateURL(id) {
        setUrlParams({ id }, { replace: false, clear: true });
    }

    function applyURLParams() {
        const id = getUrlParam('id');

        if (id) {
            const item = state.data.find(d => d.id === id);
            if (item) {
                selectCharacter(item);

                // Scroll to item in list
                const card = document.querySelector(`.character-card[data-id="${id}"]`);
                if (card) {
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        }
    }

    // Note: debounce() is available from utils.js
});
