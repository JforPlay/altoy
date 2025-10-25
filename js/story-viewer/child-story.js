/**
 * tab-story.js
 * -------------
 * Unified Story Viewer with tab navigation for Navi and TB
 * Handles: Memories, Endings, Polaroids, Photos, and custom categories
 *
 * Uses the common StoryViewer engine for story playback with proper URL state management
 */

/**
 * Creates a tab-based story viewer instance
 * @param {Object} config - Configuration object
 * @param {string} config.type - Viewer type: 'navi' or 'tb'
 * @param {Object} config.dataPaths - Paths to JSON data files
 * @param {Object} config.imageUrls - Base URLs for images
 * @param {string} config.placeholderImage - Placeholder image path
 * @param {Array} config.categories - Custom category definitions
 * @param {Array} config.photoList - List of photo filenames (optional)
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

        // =========================================================================
        // INITIALIZATION
        // =========================================================================
        async init() {
            this.showLoadingState();

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
            this.handleUrlParameters();
            this.hideLoadingState();
        },

        showLoadingState() {
            this.elements.memoriesGrid.innerHTML = '<div class="loading">데이터 로딩 중...</div>';
        },

        hideLoadingState() {
            const loadingElements = document.querySelectorAll('.loading');
            loadingElements.forEach(el => el.remove());
        },

        async loadAllData() {
            try {
                const [memoriesData, endingsData, polaroidsData, storyData, shipgirlData, nameCodeData, iconMappingData] = await Promise.all([
                    fetch(this.config.dataPaths.memories).then(r => r.json()),
                    fetch(this.config.dataPaths.endings).then(r => r.json()),
                    fetch(this.config.dataPaths.polaroids).then(r => r.json()),
                    fetch(this.config.dataPaths.stories).then(r => r.json()),
                    fetch(this.config.dataPaths.shipgirls).then(r => r.json()),
                    fetch('https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/name_code.json').then(r => r.json()),
                    fetch(this.config.dataPaths.iconMapping).then(r => r.json())
                ]);

                this.memoriesData = memoriesData;
                this.endingsData = endingsData;
                this.polaroidsData = polaroidsData;
                this.storyData = storyData;
                this.shipgirlData = shipgirlData;
                this.nameCodeData = nameCodeData;
                this.iconMappingData = iconMappingData;

                // Build reverse lookup map
                this.buildStoryIconMap();

                // Extract custom categories data
                this.config.categories.forEach(cat => {
                    this.extractCategoryData(cat);
                });

            } catch (error) {
                console.error('Failed to load data:', error);
                this.showError('데이터를 불러오는데 실패했습니다.');
            }
        },

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

        convertDataForEngine() {
            this.convertedStorylineData = {};

            // Memories
            this.convertedStorylineData['memory'] = {
                id: 'memory',
                name: `${this.config.type.toUpperCase()} Memories`,
                child: Object.values(this.memoriesData).map(mem => {
                    const storyKey = this.config.type === 'navi' ? mem.lua : mem.performance;
                    const mappingData = this.storyIconMap[storyKey?.toLowerCase()] || {};
                    const title = mappingData.title || mem.desc || `Memory ${mem.id}`;
                    const icon = mappingData.icon || null;

                    return {
                        id: mem.id,
                        title: title,
                        condition: mem.condition || '',
                        icon: icon,
                        iconUrl: icon ? `${this.config.imageUrls.icon}${icon}.png` : null,
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
                        iconUrl: icon ? `${this.config.imageUrls.icon}${icon}.png` : null,
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

        // =========================================================================
        // EVENT LISTENERS
        // =========================================================================
        setupEventListeners() {
            // Tab navigation
            this.elements.tabBtns.forEach(btn => {
                btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
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
        },

        setupBrowserBackButton() {
            window.addEventListener('popstate', (e) => {
                if (e.state && e.state.category && e.state.storyId) {
                    this.playStoryById(e.state.category, e.state.storyId, false);
                } else {
                    this.returnToTabs(false);
                }
            });
        },

        // =========================================================================
        // TAB SWITCHING
        // =========================================================================
        switchTab(tabName) {
            this.currentTab = tabName;

            this.elements.tabBtns.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tab === tabName);
            });

            this.elements.tabContents.forEach(content => {
                content.classList.toggle('active', content.id === `${tabName}-content`);
            });
        },

        // =========================================================================
        // GRID POPULATION
        // =========================================================================
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
            this.elements.memoriesGrid.innerHTML = '';
            Object.values(this.memoriesData).forEach(memory => {
                const card = this.createMemoryCard(memory);
                this.elements.memoriesGrid.appendChild(card);
            });
        },

        populateEndingsGrid() {
            this.elements.endingsGrid.innerHTML = '';
            Object.values(this.endingsData).forEach(ending => {
                const card = this.createEndingCard(ending);
                this.elements.endingsGrid.appendChild(card);
            });
        },

        populateCategoryGrid(category) {
            const grid = this.elements[`${category.id}Grid`];
            if (!grid) return;

            grid.innerHTML = '';
            const sortedData = Object.values(this.customCategoriesData[category.id])
                .sort((a, b) => a.id - b.id);

            sortedData.forEach(item => {
                const card = this.createCategoryCard(category.id, item);
                grid.appendChild(card);
            });
        },

        populatePolaroidsGrid() {
            this.elements.polaroidsGrid.innerHTML = '';
            Object.values(this.polaroidsData).forEach(polaroid => {
                const card = this.createPolaroidCard(polaroid);
                this.elements.polaroidsGrid.appendChild(card);
            });
        },

        populatePhotosGrid() {
            this.elements.photosGrid.innerHTML = '';

            if (this.config.photoList) {
                this.config.photoList.forEach(filename => {
                    const card = this.createPhotoCard(filename);
                    this.elements.photosGrid.appendChild(card);
                });
            } else {
                // Default: plan_square_1 to plan_square_15
                for (let i = 1; i <= 15; i++) {
                    const card = this.createPhotoCard(`plan_square_${i}`);
                    this.elements.photosGrid.appendChild(card);
                }
            }
        },

        // =========================================================================
        // CARD CREATION
        // =========================================================================
        createMemoryCard(memory) {
            const card = document.createElement('div');
            card.className = `${this.config.type}-card`;

            const storyKey = this.config.type === 'navi' ? memory.lua : memory.performance;
            const mappingData = this.storyIconMap[storyKey?.toLowerCase()] || {};
            const title = mappingData.title || memory.desc || 'Untitled';

            card.dataset.title = title;
            const imageUrl = this.config.placeholderImage;

            card.innerHTML = `
                <img class="${this.config.type}-card-image" src="${imageUrl}" alt="${title}" loading="lazy">
                <div class="${this.config.type}-card-content">
                    <h3 class="${this.config.type}-card-title">${title}</h3>
                    <span class="${this.config.type}-card-badge">메모리 #${memory.id}</span>
                </div>
            `;

            card.addEventListener('click', () => {
                this.playStory('memory', memory.id, title);
            });

            return card;
        },

        createEndingCard(ending) {
            const card = document.createElement('div');
            card.className = `${this.config.type}-card`;

            const mappingData = this.storyIconMap[ending.performance?.toLowerCase()] || {};
            const title = mappingData.title || ending.name || 'Untitled';
            const icon = mappingData.icon;

            card.dataset.title = title;

            let imageUrl;
            if (this.config.type === 'navi') {
                imageUrl = ending.pic_preview
                    ? `${this.config.imageUrls.base}${ending.pic_preview}.png`
                    : this.config.placeholderImage;
            } else {
                imageUrl = icon
                    ? `${this.config.imageUrls.icon}${icon}.png`
                    : (ending.pic_preview ? `${this.config.imageUrls.base}${ending.pic_preview}.png` : this.config.placeholderImage);
            }

            card.innerHTML = `
                <img class="${this.config.type}-card-image" src="${imageUrl}" alt="${title}" loading="lazy">
                <div class="${this.config.type}-card-content">
                    <h3 class="${this.config.type}-card-title">${title}</h3>
                    <span class="${this.config.type}-card-badge">엔딩 #${ending.id}</span>
                </div>
            `;

            const img = card.querySelector(`.${this.config.type}-card-image`);
            this.addImageErrorHandler(img);

            card.addEventListener('click', () => {
                this.playStory('ending', ending.id, title);
            });

            return card;
        },

        createCategoryCard(categoryId, item) {
            const card = document.createElement('div');
            card.className = `${this.config.type}-card`;
            card.dataset.title = item.title;

            const imageUrl = item.icon
                ? `${this.config.imageUrls.icon}${item.icon}.png`
                : this.config.placeholderImage;

            const category = this.config.categories.find(c => c.id === categoryId);
            const badgeText = category ? `${category.badgePrefix} #${item.id}` : `#${item.id}`;

            card.innerHTML = `
                <img class="${this.config.type}-card-image" src="${imageUrl}" alt="${item.title}" loading="lazy">
                <div class="${this.config.type}-card-content">
                    <h3 class="${this.config.type}-card-title">${item.title}</h3>
                    <span class="${this.config.type}-card-badge">${badgeText}</span>
                </div>
            `;

            const img = card.querySelector(`.${this.config.type}-card-image`);
            this.addImageErrorHandler(img);

            card.addEventListener('click', () => {
                this.playStory(categoryId, item.id, item.title);
            });

            return card;
        },

        createPolaroidCard(polaroid) {
            const card = document.createElement('div');
            card.className = `${this.config.type}-card polaroid-card`;
            card.dataset.title = polaroid.title || '';

            const imageUrl = polaroid.pic
                ? `${this.config.imageUrls.base}${polaroid.pic}.png`
                : this.config.placeholderImage;

            card.innerHTML = `
                <img class="${this.config.type}-card-image" src="${imageUrl}" alt="${polaroid.title}" loading="lazy">
                <div class="${this.config.type}-card-content">
                    <h3 class="${this.config.type}-card-title">${polaroid.title || 'Untitled'}</h3>
                    <p class="${this.config.type}-card-desc">${polaroid.condition || ''}</p>
                    <div class="polaroid-card-footer">
                        <span class="polaroid-stage">
                            <span class="material-symbols-outlined" style="font-size: 14px; vertical-align: middle;">star</span>
                            ${polaroid.stage?.join(', ') || 'N/A'}
                        </span>
                        <span class="polaroid-group-badge">그룹 ${polaroid.group || 1}</span>
                    </div>
                </div>
            `;

            const img = card.querySelector(`.${this.config.type}-card-image`);
            this.addImageErrorHandler(img);

            card.addEventListener('click', () => {
                this.showPolaroidDetail(polaroid);
            });

            return card;
        },

        createPhotoCard(filename) {
            const card = document.createElement('div');
            card.className = 'photo-card';

            const imageUrl = `${this.config.imageUrls.photo || this.config.imageUrls.base}${filename}.png`;

            card.innerHTML = `<img src="${imageUrl}" alt="${filename}" loading="lazy">`;

            const img = card.querySelector('img');
            this.addImageErrorHandler(img);

            return card;
        },

        addImageErrorHandler(img) {
            const placeholderPath = window.location.origin + `/altoy/${this.config.placeholderImage}`;
            img.addEventListener('error', function() {
                if (this.src !== placeholderPath && !this.dataset.errorHandled) {
                    this.dataset.errorHandled = 'true';
                    this.src = viewer.config.placeholderImage;
                }
            }, { once: false });
        },

        // =========================================================================
        // URL & STATE MANAGEMENT
        // =========================================================================
        updateUrl(category, storyId, clear = false) {
            const url = new URL(window.location);
            if (clear) {
                history.pushState({}, '', window.location.pathname);
                return;
            }
            url.searchParams.delete('category');
            url.searchParams.delete('story');

            if (category) url.searchParams.set('category', category);
            if (storyId) url.searchParams.set('story', storyId);

            history.pushState({ category, storyId }, '', url.pathname + url.search);
        },

        handleUrlParameters() {
            const urlParams = new URLSearchParams(window.location.search);
            const category = urlParams.get('category');
            const storyId = urlParams.get('story');

            if (category && storyId) {
                this.playStoryById(category, parseInt(storyId, 10), false);
            }
        },

        // =========================================================================
        // STORY PLAYBACK
        // =========================================================================
        playStory(category, id, title) {
            this.currentCategory = category;
            this.currentStoryId = id;
            this.updateUrl(category, id);
            this.playStoryById(category, id, false);
        },

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

            this.elements.tabNavView.classList.add('hidden');
            this.elements.storyViewerView.classList.remove('hidden');

            if (window.StoryViewer) {
                window.StoryViewer.currentEventId = category;
                window.StoryViewer.currentMemoryId = storyId;
                window.StoryViewer.currentStoryScript = memory.story.scripts;
                window.StoryViewer.scriptIndex = 0;
                window.StoryViewer.lastActorId = null;
                window.StoryViewer.currentBgm = null;
                window.StoryViewer.currentStoryDefaultBgUrl = null;

                window.StoryViewer.cachedBackground = {
                    url: null,
                    isBlack: false,
                    lastIndex: -1
                };

                if (memory.story.mask) {
                    window.StoryViewer.currentStoryDefaultBgUrl = `${window.StoryViewer.BASE_URL}${memory.story.mask}.png`;
                }

                const memories = eventData.child;
                const index = memories.findIndex(m => m.id === storyId);
                window.StoryViewer.nextMemory = (index >= 0 && index < memories.length - 1) ? memories[index + 1] : null;

                if (window.StoryViewer.elements.fadeOverlay) {
                    window.StoryViewer.elements.fadeOverlay.classList.remove('visible');
                }

                window.StoryViewer.elements.storyTitle.textContent = `${eventData.name} - ${memory.title}`;
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

            this.elements.storyViewerView.classList.add('hidden');
            this.elements.tabNavView.classList.remove('hidden');
        },

        // =========================================================================
        // POLAROID MODAL
        // =========================================================================
        showPolaroidDetail(polaroid) {
            const frontUrl = polaroid.pic
                ? `${this.config.imageUrls.base}${polaroid.pic}.png`
                : this.config.placeholderImage;
            const backUrl = polaroid.pic_2
                ? `${this.config.imageUrls.base}${polaroid.pic_2}.png`
                : this.config.placeholderImage;

            delete this.elements.polaroidImgFront.dataset.errorHandled;
            delete this.elements.polaroidImgBack.dataset.errorHandled;

            this.elements.polaroidImgFront.src = frontUrl;
            this.elements.polaroidImgBack.src = backUrl;
            this.elements.polaroidImgFront.classList.remove('hidden');
            this.elements.polaroidImgBack.classList.add('hidden');

            const placeholderPath = window.location.origin + `/altoy/${this.config.placeholderImage}`;
            this.elements.polaroidImgFront.onerror = function() {
                if (this.src !== placeholderPath && !this.dataset.errorHandled) {
                    this.dataset.errorHandled = 'true';
                    this.src = viewer.config.placeholderImage;
                }
            };
            this.elements.polaroidImgBack.onerror = function() {
                if (this.src !== placeholderPath && !this.dataset.errorHandled) {
                    this.dataset.errorHandled = 'true';
                    this.src = viewer.config.placeholderImage;
                }
            };

            this.elements.polaroidInfo.innerHTML = `
                <h3>${polaroid.title || 'Untitled'}</h3>
                <div class="polaroid-info-grid">
                    <div class="polaroid-info-item">
                        <span class="material-symbols-outlined">bookmark</span>
                        <div>
                            <strong>조건</strong>
                            <p>${polaroid.condition || 'N/A'}</p>
                        </div>
                    </div>
                    <div class="polaroid-info-item">
                        <span class="material-symbols-outlined">star</span>
                        <div>
                            <strong>스테이지</strong>
                            <p>${polaroid.stage?.join(', ') || 'N/A'}</p>
                        </div>
                    </div>
                    <div class="polaroid-info-item">
                        <span class="material-symbols-outlined">category</span>
                        <div>
                            <strong>그룹</strong>
                            <p>${polaroid.group || 'N/A'}</p>
                        </div>
                    </div>
                    ${polaroid.desc ? `
                        <div class="polaroid-info-item polaroid-info-full">
                            <span class="material-symbols-outlined">description</span>
                            <div>
                                <strong>설명</strong>
                                <p>${Array.isArray(polaroid.desc) ? polaroid.desc.join(', ') : polaroid.desc}</p>
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;

            this.elements.polaroidModal.classList.remove('hidden');
        },

        closePolaroidModal() {
            this.elements.polaroidModal.classList.add('hidden');
        },

        flipPolaroid() {
            const isFrontVisible = !this.elements.polaroidImgFront.classList.contains('hidden');

            if (isFrontVisible) {
                this.elements.polaroidImgFront.classList.add('hidden');
                this.elements.polaroidImgBack.classList.remove('hidden');
            } else {
                this.elements.polaroidImgBack.classList.add('hidden');
                this.elements.polaroidImgFront.classList.remove('hidden');
            }
        },

        // =========================================================================
        // STORY VIEWER INITIALIZATION
        // =========================================================================
        initStoryViewer() {
            const viewerConfig = {
                viewerType: this.config.type,
                dataPaths: [],
                processLoadedData: (storyViewer, dataArray) => {
                    storyViewer.storylineData = viewer.convertedStorylineData;
                    storyViewer.shipgirlData = viewer.shipgirlData;
                    storyViewer.nameCodeData = viewer.nameCodeData;
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
                window.StoryViewer.loadData = async function() {
                    this.storylineData = viewer.convertedStorylineData;
                    this.shipgirlData = viewer.shipgirlData;
                    this.nameCodeData = viewer.nameCodeData;

                    for (const id in this.shipgirlData) {
                        this.shipgirlNameMap[this.shipgirlData[id].name] = id;
                    }

                    return Promise.resolve();
                };

                window.StoryViewer.returnToMemorySelection = function() {
                    viewer.returnToTabs();
                };

                window.StoryViewer.init(viewerConfig);
                window.StoryViewer.populateEventGrid = () => {};
            }
        },

        // =========================================================================
        // ERROR HANDLING
        // =========================================================================
        showError(message) {
            this.elements.errorContainer.textContent = message;
            this.elements.errorContainer.classList.remove('hidden');
            setTimeout(() => {
                this.elements.errorContainer.classList.add('hidden');
            }, 5000);
        },
    };

    return viewer;
}

// Export for use in page-specific scripts
window.createTabStoryViewer = createTabStoryViewer;
