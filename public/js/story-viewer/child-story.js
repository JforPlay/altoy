/**
 * child-story.js
 * Tabbed story viewer engine for Navi, TB, and Lora child story pages.
 * Exports window.createTabStoryViewer, which is called by the page-specific
 * init scripts (child-navi-init.js, child-tb-init.js, child-lora-init.js).
 *
 * Handles: memories, endings, polaroids, photos, and config-driven custom
 * categories. Delegates actual script playback to the shared StoryViewer engine
 * (story-viewer.engine.js) by patching its loadData and returnToMemorySelection.
 */
import { fetchJSON, getUrlParam, setUrlParams, hideElement, showElement, toggleElement, makeKeyboardActivatable, createMaterialIcon, DATA_FOR_TOY_BASE } from '../utils.js';

/**
 * Create a tab-based story viewer instance for a child story page.
 * The returned object must be initialized by calling viewer.init().
 *
 * @param {Object} config
 * @param {string} config.type - Viewer type identifier: 'navi', 'tb', or 'lora'
 * @param {Object} config.dataPaths - Paths to JSON data files (memories, endings, etc.)
 * @param {Object} config.imageUrls - Base URLs for images (base, icon, photo)
 * @param {string} config.placeholderImage - Fallback image URL
 * @param {Array}  config.categories - Custom category definitions with storyKeyPrefix
 * @param {Array|null} config.photoList - Explicit photo filenames, or null to use default
 */
function createTabStoryViewer(config) {
    const viewer = {
        // Configuration
        config: config,

        // Data storage
        memoriesData: {},
        endingsData: {},
        polaroidsData: {},
        customCategoriesData: {}, // For visits/affection/daily/etc
        storyData: {},
        shipgirlData: {},
        nameCodeData: {},
        iconMappingData: {},
        storyIconMap: {},

        // Converted data for story engine
        convertedStorylineData: {},

        // Current state
        currentTab: 'memories',
        currentCategory: null,
        currentStoryId: null,

        // Event listener cleanup tracking
        cardClickHandlers: [],
        boundImageErrorHandler: null,

        // DOM elements
        elements: {
            // Tab navigation
            tabBtns: document.querySelectorAll('.tab-btn'),
            tabContents: document.querySelectorAll('.tab-content'),

            // Grids
            memoriesGrid: document.getElementById('memories-grid'),
            endingsGrid: document.getElementById('endings-grid'),
            polaroidsGrid: document.getElementById('polaroids-grid'),
            photosGrid: document.getElementById('photos-grid'),

            // Views
            tabNavView: document.getElementById('tab-navigation-view'),
            storyViewerView: document.getElementById('story-viewer-view'),

            // Buttons
            backToTabs: document.getElementById('back-to-tabs'),

            // Polaroid modal
            polaroidModal: document.getElementById('polaroid-modal'),
            closePolaroidModal: document.getElementById('close-polaroid-modal'),
            polaroidImgFront: document.getElementById('polaroid-img-front'),
            polaroidImgBack: document.getElementById('polaroid-img-back'),
            flipPolaroidBtn: document.getElementById('flip-polaroid-btn'),
            polaroidInfo: document.getElementById('polaroid-info'),

            // Error container
            errorContainer: document.getElementById('error-container'),
        },

        // ===== Initialization =====
        async init() {
            this.showLoadingState();

            try {
                // Add custom category grids to elements
                this.config.categories.forEach(cat => {
                    this.elements[`${cat.id}Grid`] = document.getElementById(`${cat.id}-grid`);
                    this.customCategoriesData[cat.id] = {};
                });

                await this.loadAllData();
                this.convertDataForEngine();
                this.setupEventListeners();
                this.setupBrowserBackButton();
                this.populateAllGrids();
                this.initStoryViewer();
                this.preloadFirstImages();
                this.handleUrlParameters();
            } catch (error) {
                console.error('Failed to initialize child story viewer:', error);
                this.showError('데이터를 불러오는 데 실패했습니다.');
            } finally {
                this.hideLoadingState();
            }
        },

        /** Show a loading indicator while data is being fetched. */
        showLoadingState() {
            this.elements.memoriesGrid.textContent = '';
            const loading = document.createElement('div');
            loading.className = 'loading';
            loading.textContent = '데이터 로딩 중...';
            this.elements.memoriesGrid.appendChild(loading);
        },

        hideLoadingState() {
            const loadingElements = document.querySelectorAll('.loading');
            loadingElements.forEach(el => el.remove());
        },

        /**
         * Fetch all data sources in parallel, store them, build the icon lookup map,
         * and extract per-category story entries from the raw story data.
         */
        async loadAllData() {
            try {
                // namecodes are pipeline-resolved in the child story data; no
                // runtime name_code.json fetch (the old AzurLaneData ShareCfg
                // source is stale — see main-story.js). nameCodeData stays {}
                // and the engine's placeholder fallback no-ops.
                const [memoriesData, endingsData, polaroidsData, storyData, shipgirlData, iconMappingData] = await Promise.all([
                    fetchJSON(this.config.dataPaths.memories),
                    fetchJSON(this.config.dataPaths.endings),
                    fetchJSON(this.config.dataPaths.polaroids),
                    fetchJSON(this.config.dataPaths.stories),
                    fetchJSON(this.config.dataPaths.shipgirls),
                    fetchJSON(this.config.dataPaths.iconMapping)
                ]);

                this.memoriesData = memoriesData;
                this.endingsData = endingsData;
                this.polaroidsData = polaroidsData;
                this.storyData = storyData;
                this.shipgirlData = shipgirlData;
                this.iconMappingData = iconMappingData;

                // Build reverse lookup map
                this.buildStoryIconMap();

                // Extract custom categories data
                this.config.categories.forEach(cat => {
                    this.extractCategoryData(cat);
                });

            } catch (error) {
                console.error('Failed to load data:', error);
                throw error;
            }
        },

        /**
         * Build a reverse lookup from story key → {icon, title} using iconMappingData.
         * Keys are lowercased to match the lowercase story keys used in storyData.
         */
        buildStoryIconMap() {
            this.storyIconMap = {};
            for (const id in this.iconMappingData) {
                const entry = this.iconMappingData[id];
                if (entry.story) {
                    this.storyIconMap[entry.story.toLowerCase()] = {
                        icon: entry.icon || null,
                        title: entry.title || null
                    };
                }
            }
        },

        extractCategoryData(category) {
            this.customCategoriesData[category.id] = {};

            for (const key in this.storyData) {
                if (key.startsWith(category.storyKeyPrefix)) {
                    const match = key.match(new RegExp(`${category.storyKeyPrefix}(\\d+)`));
                    if (match) {
                        const id = parseInt(match[1], 10);
                        const mappingData = this.storyIconMap[key] || {};
                        const title = mappingData.title || `${category.defaultTitlePrefix} ${id}`;
                        const icon = mappingData.icon || null;

                        this.customCategoriesData[category.id][id] = {
                            id: id,
                            storyKey: key,
                            title: title,
                            icon: icon
                        };
                    }
                }
            }
        },

        /**
         * Transform raw memories, endings, and custom categories into the engine's
         * expected {id, name, child[]} structure and store in convertedStorylineData.
         */
        convertDataForEngine() {
            this.convertedStorylineData = {};

            // Memories
            this.convertedStorylineData['memory'] = {
                id: 'memory',
                name: `${this.config.type.toUpperCase()} Memories`,
                child: Object.values(this.memoriesData).map(mem => {
                    const storyKey = mem.lua || mem.performance;
                    const mappingData = this.storyIconMap[storyKey?.toLowerCase()] || {};
                    const title = mappingData.title || mem.desc || `Memory ${mem.id}`;
                    const icon = mappingData.icon || null;

                    return {
                        id: mem.id,
                        title: title,
                        condition: mem.condition || '',
                        icon: icon,
                        iconUrl: icon ? `${this.config.imageUrls.icon}${icon}.webp` : null,
                        story: this.storyData[storyKey?.toLowerCase()] || { scripts: [] }
                    };
                })
            };

            // Endings
            this.convertedStorylineData['ending'] = {
                id: 'ending',
                name: `${this.config.type.toUpperCase()} Endings`,
                child: Object.values(this.endingsData).map(end => {
                    const storyKey = end.performance;
                    const mappingData = this.storyIconMap[storyKey?.toLowerCase()] || {};
                    const title = mappingData.title || end.name || `Ending ${end.id}`;
                    const icon = mappingData.icon || null;

                    return {
                        id: end.id,
                        title: title,
                        condition: '',
                        icon: icon,
                        iconUrl: icon ? `${this.config.imageUrls.icon}${icon}.webp` : null,
                        story: this.storyData[storyKey?.toLowerCase()] || { scripts: [] }
                    };
                })
            };

            // Custom categories
            this.config.categories.forEach(cat => {
                this.convertedStorylineData[cat.id] = {
                    id: cat.id,
                    name: cat.name,
                    child: Object.values(this.customCategoriesData[cat.id]).map(item => ({
                        id: item.id,
                        title: item.title,
                        condition: '',
                        icon: null,
                        story: this.storyData[item.storyKey] || { scripts: [] }
                    }))
                };
            });
        },

        // ===== Event Listeners =====
        setupEventListeners() {
            // Tab navigation
            this.elements.tabBtns.forEach((btn, index) => {
                btn.setAttribute('role', 'tab');
                btn.setAttribute('aria-selected', String(btn.classList.contains('active')));
                btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
                btn.addEventListener('keydown', (event) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                    event.preventDefault();
                    const offset = event.key === 'ArrowRight' ? 1 : -1;
                    const nextIndex = (index + offset + this.elements.tabBtns.length) % this.elements.tabBtns.length;
                    const nextTab = this.elements.tabBtns[nextIndex];
                    nextTab?.focus();
                    if (nextTab?.dataset.tab) this.switchTab(nextTab.dataset.tab);
                });
            });
            this.elements.tabContents.forEach(content => {
                content.setAttribute('role', 'tabpanel');
            });

            // Back to tabs button
            this.elements.backToTabs?.addEventListener('click', (e) => {
                e.preventDefault();
                this.returnToTabs();
            });

            // Polaroid modal
            this.elements.closePolaroidModal?.addEventListener('click', () => {
                this.closePolaroidModal();
            });
            this.elements.polaroidModal?.addEventListener('click', (e) => {
                if (e.target === this.elements.polaroidModal) {
                    this.closePolaroidModal();
                }
            });
            this.elements.flipPolaroidBtn?.addEventListener('click', () => {
                this.flipPolaroid();
            });
            document.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return;
                if (!this.elements.polaroidModal?.classList.contains('hidden')) {
                    event.preventDefault();
                    this.closePolaroidModal();
                }
            });
        },

        /**
         * Handle browser back/forward navigation by restoring the story or
         * returning to the tab view based on the popstate history state.
         */
        setupBrowserBackButton() {
            window.addEventListener('popstate', (e) => {
                if (e.state && e.state.category && e.state.storyId) {
                    this.playStoryById(e.state.category, e.state.storyId, false);
                } else {
                    this.returnToTabs(false);
                }
            });
        },

        // ===== Tab Switching =====
        switchTab(tabName) {
            this.currentTab = tabName;

            this.elements.tabBtns.forEach(btn => {
                const active = btn.dataset.tab === tabName;
                btn.classList.toggle('active', active);
                btn.setAttribute('aria-selected', String(active));
            });

            this.elements.tabContents.forEach(content => {
                const active = content.id === `${tabName}-content`;
                content.classList.toggle('active', active);
            });
        },

        // ===== Grid Population =====
        populateAllGrids() {
            this.populateMemoriesGrid();
            this.populateEndingsGrid();
            this.config.categories.forEach(cat => {
                this.populateCategoryGrid(cat);
            });
            this.populatePolaroidsGrid();
            this.populatePhotosGrid();
        },

        populateMemoriesGrid() {
            // Use DocumentFragment for batch insertion (single reflow)
            const fragment = document.createDocumentFragment();
            Object.values(this.memoriesData).forEach(memory => {
                const card = this.createMemoryCard(memory);
                fragment.appendChild(card);
            });
            this.elements.memoriesGrid.replaceChildren(fragment);
        },

        populateEndingsGrid() {
            const fragment = document.createDocumentFragment();
            Object.values(this.endingsData).forEach(ending => {
                const card = this.createEndingCard(ending);
                fragment.appendChild(card);
            });
            this.elements.endingsGrid.replaceChildren(fragment);
        },

        populateCategoryGrid(category) {
            const grid = this.elements[`${category.id}Grid`];
            if (!grid) return;

            const sortedData = Object.values(this.customCategoriesData[category.id])
                .sort((a, b) => a.id - b.id);

            const fragment = document.createDocumentFragment();
            sortedData.forEach(item => {
                const card = this.createCategoryCard(category.id, item);
                fragment.appendChild(card);
            });

            grid.replaceChildren(fragment);
        },

        populatePolaroidsGrid() {
            const fragment = document.createDocumentFragment();
            Object.values(this.polaroidsData).forEach(polaroid => {
                const card = this.createPolaroidCard(polaroid);
                fragment.appendChild(card);
            });
            this.elements.polaroidsGrid.replaceChildren(fragment);
        },

        populatePhotosGrid() {
            const fragment = document.createDocumentFragment();

            if (this.config.photoList) {
                this.config.photoList.forEach(filename => {
                    const card = this.createPhotoCard(filename);
                    fragment.appendChild(card);
                });
            } else {
                // Default: plan_square_1 to plan_square_15
                for (let i = 1; i <= 15; i++) {
                    const card = this.createPhotoCard(`plan_square_${i}`);
                    fragment.appendChild(card);
                }
            }

            this.elements.photosGrid.replaceChildren(fragment);
        },

        // ===== Card Creation =====
        createInteractiveCard(className, title, onClick) {
            const card = document.createElement('div');
            card.className = className;
            card.dataset.title = title || '';
            makeKeyboardActivatable(card, onClick);
            return card;
        },

        appendCardImage(card, imageUrl, title) {
            const img = document.createElement('img');
            img.className = `${this.config.type}-card-image`;
            img.src = imageUrl;
            img.alt = title || '';
            img.loading = 'lazy';
            card.appendChild(img);
            this.addImageErrorHandler(img);
        },

        appendCardContent(card, title, badgeText, description = '') {
            const content = document.createElement('div');
            content.className = `${this.config.type}-card-content`;

            const titleEl = document.createElement('h3');
            titleEl.className = `${this.config.type}-card-title`;
            titleEl.textContent = title || 'Untitled';
            content.appendChild(titleEl);

            if (description) {
                const desc = document.createElement('p');
                desc.className = `${this.config.type}-card-desc`;
                desc.textContent = description;
                content.appendChild(desc);
            }

            if (badgeText) {
                const badge = document.createElement('span');
                badge.className = `${this.config.type}-card-badge`;
                badge.textContent = badgeText;
                content.appendChild(badge);
            }

            card.appendChild(content);
            return content;
        },

        createMemoryCard(memory) {
            const storyKey = memory.lua || memory.performance;
            const mappingData = this.storyIconMap[storyKey?.toLowerCase()] || {};
            const title = mappingData.title || memory.desc || 'Untitled';
            const card = this.createInteractiveCard(`${this.config.type}-card`, title, () => {
                this.playStory('memory', memory.id, title);
            });

            this.appendCardImage(card, this.config.placeholderImage, title);
            this.appendCardContent(card, title, `메모리 #${memory.id}`);
            return card;
        },

        createEndingCard(ending) {
            const mappingData = this.storyIconMap[ending.performance?.toLowerCase()] || {};
            const title = mappingData.title || ending.name || 'Untitled';
            const icon = mappingData.icon;
            const card = this.createInteractiveCard(`${this.config.type}-card`, title, () => {
                this.playStory('ending', ending.id, title);
            });

            let imageUrl;
            if (this.config.type === 'tb') {
                imageUrl = icon
                    ? `${this.config.imageUrls.icon}${icon}.webp`
                    : (ending.pic_preview ? `${this.config.imageUrls.base}${ending.pic_preview}.webp` : this.config.placeholderImage);
            } else {
                imageUrl = ending.pic_preview
                    ? `${this.config.imageUrls.base}${ending.pic_preview}.webp`
                    : this.config.placeholderImage;
            }

            this.appendCardImage(card, imageUrl, title);
            this.appendCardContent(card, title, `엔딩 #${ending.id}`);
            return card;
        },

        createCategoryCard(categoryId, item) {
            const card = this.createInteractiveCard(`${this.config.type}-card`, item.title, () => {
                this.playStory(categoryId, item.id, item.title);
            });

            const imageUrl = item.icon
                ? `${this.config.imageUrls.icon}${item.icon}.webp`
                : this.config.placeholderImage;

            const category = this.config.categories.find(c => c.id === categoryId);
            const badgeText = category ? `${category.badgePrefix} #${item.id}` : `#${item.id}`;

            this.appendCardImage(card, imageUrl, item.title);
            this.appendCardContent(card, item.title, badgeText);
            return card;
        },

        createPolaroidCard(polaroid) {
            const title = polaroid.title || 'Untitled';
            const card = this.createInteractiveCard(`${this.config.type}-card polaroid-card`, title, () => {
                this.showPolaroidDetail(polaroid);
            });

            const imageUrl = polaroid.pic
                ? `${this.config.imageUrls.base}${polaroid.pic}.webp`
                : this.config.placeholderImage;

            this.appendCardImage(card, imageUrl, title);
            const content = this.appendCardContent(card, title, '', polaroid.condition || '');

            const footer = document.createElement('div');
            footer.className = 'polaroid-card-footer';
            const stage = document.createElement('span');
            stage.className = 'polaroid-stage';
            const icon = document.createElement('span');
            icon.className = 'material-symbols-outlined polaroid-stage-icon';
            icon.textContent = 'star';
            stage.append(icon, document.createTextNode(` ${polaroid.stage?.join(', ') || 'N/A'}`));
            const group = document.createElement('span');
            group.className = 'polaroid-group-badge';
            group.textContent = `그룹 ${polaroid.group || 1}`;
            footer.append(stage, group);
            content.appendChild(footer);

            return card;
        },

        createPhotoCard(filename) {
            const card = document.createElement('div');
            card.className = 'photo-card';

            const imageUrl = `${this.config.imageUrls.photo || this.config.imageUrls.base}${filename}.webp`;

            const img = document.createElement('img');
            img.src = imageUrl;
            img.alt = filename;
            img.loading = 'lazy';
            card.appendChild(img);
            this.addImageErrorHandler(img);

            return card;
        },

        addImageErrorHandler(img) {
            // Shared handler is created once and reused across all cards.
            // { once: true } auto-removes it after the first error, preventing memory leaks.
            if (!this.boundImageErrorHandler) {
                const placeholderImage = this.config.placeholderImage;
                this.boundImageErrorHandler = function(event) {
                    const img = event.target;
                    if (!img.dataset.errorHandled) {
                        img.dataset.errorHandled = 'true';
                        img.src = placeholderImage;
                    }
                };
            }
            img.addEventListener('error', this.boundImageErrorHandler, { once: true });
        },

        // ===== URL & State Management =====
        updateUrl(category, storyId, clear = false) {
            if (clear) {
                history.pushState({}, '', window.location.pathname);
                return;
            }
            setUrlParams({
                category: category || null,
                story: storyId || null
            }, { replace: false });
        },

        handleUrlParameters() {
            const category = getUrlParam('category');
            const storyId = getUrlParam('story');

            if (category && storyId) {
                this.playStoryById(category, parseInt(storyId, 10), false);
            }
        },

        // ===== Story Playback =====
        playStory(category, id, title) {
            this.currentCategory = category;
            this.currentStoryId = id;
            this.updateUrl(category, id);
            this.playStoryById(category, id, false);
        },

        /**
         * Load and start the specified story by category and ID.
         * Resets the StoryViewer engine state directly — bypasses normal
         * event/memory selection so back navigation stays within this viewer.
         */
        playStoryById(category, storyId, updateUrl = true) {
            const eventData = this.convertedStorylineData[category];
            if (!eventData) {
                this.showError(`카테고리를 찾을 수 없습니다: ${category}`);
                return;
            }

            const memory = eventData.child.find(m => m.id === storyId);
            if (!memory) {
                this.showError(`스토리를 찾을 수 없습니다: ${storyId}`);
                return;
            }

            if (!memory.story || !memory.story.scripts) {
                this.showError('이 스토리는 사용할 수 없습니다.');
                return;
            }

            this.currentCategory = category;
            this.currentStoryId = storyId;

            if (updateUrl) {
                this.updateUrl(category, storyId);
            }

            hideElement(this.elements.tabNavView);
            showElement(this.elements.storyViewerView);

            // Scroll to top when entering story viewer
            window.scrollTo(0, 0);

            if (window.StoryViewer) {
                window.StoryViewer.currentEventId = category;
                window.StoryViewer.currentMemoryId = storyId;
                window.StoryViewer.currentStoryScript = memory.story.scripts;
                window.StoryViewer.scriptIndex = 0;
                window.StoryViewer.lastPortraitUrl = null;
                window.StoryViewer.currentBgm = null;
                window.StoryViewer.currentStoryDefaultBgUrl = null;
                window.StoryViewer.activeOptionFlag = null;
                window.StoryViewer.lastOptionIndex = -1;

                // Reset caches for new story
                window.StoryViewer.cachedBackground = {
                    url: null,
                    isBlack: false,
                    lastIndex: -1
                };
                window.StoryViewer.scriptNavCache = null;
                window.StoryViewer.cachedFullScript = null;

                if (memory.story.mask) {
                    window.StoryViewer.currentStoryDefaultBgUrl = `${window.StoryViewer.BASE_URL}${memory.story.mask}.webp`;
                }

                const memories = eventData.child;
                const index = memories.findIndex(m => m.id === storyId);
                window.StoryViewer.nextMemory = (index >= 0 && index < memories.length - 1) ? memories[index + 1] : null;

                if (window.StoryViewer.elements.fadeOverlay) {
                    window.StoryViewer.elements.fadeOverlay.classList.remove('visible');
                }

                window.StoryViewer.elements.storyTitle.textContent = `${eventData.name} - ${memory.title}`;

                // Build navigation cache for fast lookups (required for advanceStory to work)
                window.StoryViewer.buildNavigationCache();

                window.StoryViewer.renderScriptLine();
            }
        },

        returnToTabs(updateUrl = true) {
            if (window.StoryViewer && window.StoryViewer.audio) {
                window.StoryViewer.audio.pause();
                window.StoryViewer.currentBgm = null;
            }

            this.currentCategory = null;
            this.currentStoryId = null;

            if (updateUrl) {
                this.updateUrl(null, null, true);
            }

            hideElement(this.elements.storyViewerView);
            showElement(this.elements.tabNavView);
        },

        // ===== Polaroid Modal =====
        showPolaroidDetail(polaroid) {
            const frontUrl = polaroid.pic
                ? `${this.config.imageUrls.base}${polaroid.pic}.webp`
                : this.config.placeholderImage;
            const backUrl = polaroid.pic_2
                ? `${this.config.imageUrls.base}${polaroid.pic_2}.webp`
                : this.config.placeholderImage;

            delete this.elements.polaroidImgFront.dataset.errorHandled;
            delete this.elements.polaroidImgBack.dataset.errorHandled;

            this.elements.polaroidImgFront.src = frontUrl;
            this.elements.polaroidImgBack.src = backUrl;
            showElement(this.elements.polaroidImgFront);
            hideElement(this.elements.polaroidImgBack);

            // Use the shared error handler with { once: true } for auto-cleanup
            this.addImageErrorHandler(this.elements.polaroidImgFront);
            this.addImageErrorHandler(this.elements.polaroidImgBack);

            this.elements.polaroidInfo.textContent = '';
            const title = document.createElement('h3');
            title.textContent = polaroid.title || 'Untitled';

            const grid = document.createElement('div');
            grid.className = 'polaroid-info-grid';

            const appendInfoItem = (iconName, label, value, full = false) => {
                const item = document.createElement('div');
                item.className = `polaroid-info-item${full ? ' polaroid-info-full' : ''}`;
                const icon = createMaterialIcon(iconName);
                const text = document.createElement('div');
                const strong = document.createElement('strong');
                strong.textContent = label;
                const p = document.createElement('p');
                p.textContent = value || 'N/A';
                text.append(strong, p);
                item.append(icon, text);
                grid.appendChild(item);
            };

            appendInfoItem('bookmark', '조건', polaroid.condition || 'N/A');
            appendInfoItem('star', '스테이지', polaroid.stage?.join(', ') || 'N/A');
            appendInfoItem('category', '그룹', polaroid.group || 'N/A');
            if (polaroid.desc) {
                appendInfoItem(
                    'description',
                    '설명',
                    Array.isArray(polaroid.desc) ? polaroid.desc.join(', ') : polaroid.desc,
                    true
                );
            }

            this.elements.polaroidInfo.append(title, grid);

            this.elements.polaroidModal?.setAttribute('aria-hidden', 'false');
            showElement(this.elements.polaroidModal);
        },

        closePolaroidModal() {
            this.elements.polaroidModal?.setAttribute('aria-hidden', 'true');
            hideElement(this.elements.polaroidModal);
        },

        flipPolaroid() {
            const isFrontVisible = !this.elements.polaroidImgFront.classList.contains('hidden');
            toggleElement(this.elements.polaroidImgFront, !isFrontVisible);
            toggleElement(this.elements.polaroidImgBack, isFrontVisible);
        },

        // ===== Story Viewer Initialization =====
        /**
         * Patch window.StoryViewer so it uses this viewer's pre-loaded data
         * instead of fetching its own. Also overrides loadData and
         * returnToMemorySelection to integrate with the tab-based UI.
         */
        initStoryViewer() {
            const viewerConfig = {
                viewerType: this.config.type,
                dataPaths: [],
                processLoadedData: (storyViewer, dataArray) => {
                    storyViewer.storylineData = this.convertedStorylineData;
                    storyViewer.shipgirlData = this.shipgirlData;
                    storyViewer.nameCodeData = this.nameCodeData;
                },
                getEventMemories: (eventData) => eventData?.child,
                findMemory: (eventData, storyId) => {
                    const numericStoryId = parseInt(storyId, 10);
                    return eventData?.child?.find(mem => mem.id === numericStoryId);
                },
                getMemoryStory: (memoryData) => memoryData?.story,
                getEventIconPath: () => null,
                populateMemoryGridExtras: () => {},
            };

            if (window.StoryViewer) {
                // Capture by value so the overridden function doesn't capture `this`
                const convertedData = this.convertedStorylineData;
                const shipgirlData = this.shipgirlData;
                const nameCodeData = this.nameCodeData;
                const returnToTabsFn = this.returnToTabs.bind(this);

                window.StoryViewer.loadData = async function() {
                    this.storylineData = convertedData;
                    this.shipgirlData = shipgirlData;
                    this.nameCodeData = nameCodeData;

                    for (const id in this.shipgirlData) {
                        this.shipgirlNameMap[this.shipgirlData[id].name] = id;
                    }

                    return Promise.resolve();
                };

                window.StoryViewer.returnToMemorySelection = returnToTabsFn;

                window.StoryViewer.init(viewerConfig);
                window.StoryViewer.populateEventGrid = () => {};
            }
        },

        // ===== Cleanup & Optimization =====
        cleanup() {
            this.cardClickHandlers = [];
            this.boundImageErrorHandler = null;

            if (window.StoryViewer && window.StoryViewer.audio) {
                window.StoryViewer.audio.pause();
                window.StoryViewer.audio.src = '';
            }
        },

        preloadFirstImages() {
            // Kick off background image load for the first story so it's ready when the user clicks.
            const firstMemory = Object.values(this.memoriesData)[0];
            if (firstMemory) {
                const storyKey = firstMemory.lua || firstMemory.performance;
                const story = this.storyData[storyKey?.toLowerCase()];
                if (story && story.scripts) {
                    // Preload first background image
                    const firstBgLine = story.scripts.find(line => line.bgName);
                    if (firstBgLine) {
                        const img = new Image();
                        img.src = `${window.StoryViewer?.BASE_URL || `${DATA_FOR_TOY_BASE}/`}bg/${firstBgLine.bgName}.webp`;
                    }
                }
            }
        },

        // ===== Error Handling =====
        showError(message) {
            this.elements.errorContainer.textContent = message;
            showElement(this.elements.errorContainer);
            setTimeout(() => hideElement(this.elements.errorContainer), 5000);
        },
    };

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (viewer) viewer.cleanup();
    });

    return viewer;
}

// Export for use in page-specific scripts
window.createTabStoryViewer = createTabStoryViewer;
