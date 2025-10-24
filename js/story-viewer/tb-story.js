/**
 * tb-story.js
 * -------------
 * Handles the TB Story Viewer with tab navigation for:
 * - Memories (tb_memory.json)
 * - Endings (tb_ending.json)
 * - Polaroids (tb_polaroid.json)
 * - Photos (placeholder)
 *
 * Uses the common StoryViewer engine for story playback with proper URL state management
 */

document.addEventListener('DOMContentLoaded', () => {
    // =========================================================================
    // STATE & DATA
    // =========================================================================
    const TbViewer = {
        // Data storage
        memoriesData: {},
        endingsData: {},
        polaroidsData: {},
        affectionData: {}, // Affection stories
        dailyData: {}, // Daily life
        storyData: {},
        shipgirlData: {},
        nameCodeData: {},
        iconMappingData: {}, // Icon mapping from tb_navi_memory.json
        storyIconMap: {}, // Reverse lookup: storyKey -> {icon, title}

        // Converted data for story engine (event/memory structure)
        convertedStorylineData: {},

        // Current state
        currentTab: 'memories',
        currentCategory: null, // 'memory', 'ending', 'affection', or 'daily'
        currentStoryId: null,

        // Image base URLs
        BASE_URL: "https://raw.githubusercontent.com/JforPlay/data_for_toy/main/educatepolaroid/",
        AVATAR_URL: "https://raw.githubusercontent.com/JforPlay/data_for_toy/main/educateavatar/",
        ICON_URL: "https://raw.githubusercontent.com/JforPlay/data_for_toy/main/memoryicon/",

        // Photo filenames from educateavatar folder
        PHOTO_FILENAMES: [
            'linghangyuan1_1', 'linghangyuan1_2', 'linghangyuan1_3', 'linghangyuan1_4', 'linghangyuan1_5', 'linghangyuan1_6',
            'linghangyuan2_1', 'linghangyuan2_2', 'linghangyuan2_3', 'linghangyuan2_4', 'linghangyuan2_5',
            'linghangyuan31_1', 'linghangyuan31_2',
            'linghangyuan32_1', 'linghangyuan32_2',
            'linghangyuan33_1', 'linghangyuan33_2'
        ],

        // DOM elements
        elements: {
            // Tab navigation
            tabBtns: document.querySelectorAll('.tab-btn'),
            tabContents: document.querySelectorAll('.tab-content'),

            // Grids
            memoriesGrid: document.getElementById('memories-grid'),
            endingsGrid: document.getElementById('endings-grid'),
            affectionGrid: document.getElementById('affection-grid'),
            dailyGrid: document.getElementById('daily-grid'),
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
                    fetch('data/story-viewer/tb_memory.json').then(r => r.json()),
                    fetch('data/story-viewer/tb_ending.json').then(r => r.json()),
                    fetch('data/story-viewer/tb_polaroid.json').then(r => r.json()),
                    fetch('data/story-viewer/tb_story_data.json').then(r => r.json()),
                    fetch('data/story-viewer/shipgirl_data.json').then(r => r.json()),
                    fetch('https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/name_code.json').then(r => r.json()),
                    fetch('data/story-viewer/tb_navi_memory.json').then(r => r.json())
                ]);

                this.memoriesData = memoriesData;
                this.endingsData = endingsData;
                this.polaroidsData = polaroidsData;
                this.storyData = storyData;
                this.shipgirlData = shipgirlData;
                this.nameCodeData = nameCodeData;
                this.iconMappingData = iconMappingData;

                // Build reverse lookup map: storyKey -> iconName
                this.buildStoryIconMap();

                // Extract affection and daily data from storyData
                this.extractAffectionData();
                this.extractDailyData();

            } catch (error) {
                console.error('Failed to load data:', error);
                this.showError('데이터를 불러오는데 실패했습니다.');
            }
        },

        // Build reverse lookup map: storyKey (lowercase) -> {icon, title}
        buildStoryIconMap() {
            this.storyIconMap = {};
            for (const id in this.iconMappingData) {
                const entry = this.iconMappingData[id];
                if (entry.story) {
                    // Store in lowercase for case-insensitive matching
                    this.storyIconMap[entry.story.toLowerCase()] = {
                        icon: entry.icon || null,
                        title: entry.title || null
                    };
                }
            }
        },

        // Extract affection stories from storyData (linghangyuanhaogandu - lowercase keys)
        extractAffectionData() {
            this.affectionData = {};
            for (const key in this.storyData) {
                if (key.startsWith('linghangyuanhaogandu')) {
                    // Extract the number from the key
                    const match = key.match(/linghangyuanhaogandu(\d+)/);
                    if (match) {
                        const id = parseInt(match[1], 10);
                        // Look up icon and title from the mapping
                        const mappingData = this.storyIconMap[key] || {};
                        const title = mappingData.title || `호감도 ${id}`; // Fallback to default
                        const icon = mappingData.icon || null;

                        this.affectionData[id] = {
                            id: id,
                            storyKey: key,
                            title: title,
                            icon: icon
                        };
                    }
                }
            }
        },

        // Extract daily life stories from storyData (linghangyuantanxin - lowercase keys)
        extractDailyData() {
            this.dailyData = {};
            for (const key in this.storyData) {
                if (key.startsWith('linghangyuantanxin')) {
                    // Extract the number from the key
                    const match = key.match(/linghangyuantanxin(\d+)/);
                    if (match) {
                        const id = parseInt(match[1], 10);
                        // Look up icon and title from the mapping
                        const mappingData = this.storyIconMap[key] || {};
                        const title = mappingData.title || `일상 ${id}`; // Fallback to default
                        const icon = mappingData.icon || null;

                        this.dailyData[id] = {
                            id: id,
                            storyKey: key,
                            title: title,
                            icon: icon
                        };
                    }
                }
            }
        },

        // Convert tb data into the event/memory structure expected by story engine
        convertDataForEngine() {
            // Create four "events": memories, endings, affection, and daily
            this.convertedStorylineData = {
                'memory': {
                    id: 'memory',
                    name: 'TB Memories',
                    child: Object.values(this.memoriesData).map(mem => {
                        // Look up icon and title from mapping based on performance field
                        const mappingData = this.storyIconMap[mem.performance?.toLowerCase()] || {};
                        const title = mappingData.title || mem.desc || `Memory ${mem.id}`;
                        const icon = mappingData.icon || null;

                        return {
                            id: mem.id,
                            title: title,
                            condition: mem.condition || '',
                            icon: icon,
                            iconUrl: icon ? `${this.ICON_URL}${icon}.png` : null,
                            story: this.storyData[mem.performance?.toLowerCase()] || { scripts: [] }
                        };
                    })
                },
                'ending': {
                    id: 'ending',
                    name: 'TB Endings',
                    child: Object.values(this.endingsData).map(end => {
                        // Look up icon and title from mapping based on performance field
                        const mappingData = this.storyIconMap[end.performance?.toLowerCase()] || {};
                        const title = mappingData.title || end.name || `Ending ${end.id}`;
                        const icon = mappingData.icon || null;

                        return {
                            id: end.id,
                            title: title,
                            condition: '',
                            icon: icon,
                            iconUrl: icon ? `${this.ICON_URL}${icon}.png` : null,
                            story: this.storyData[end.performance?.toLowerCase()] || { scripts: [] }
                        };
                    })
                },
                'affection': {
                    id: 'affection',
                    name: 'TB의 호감도 스토리',
                    child: Object.values(this.affectionData).map(affection => ({
                        id: affection.id,
                        title: affection.title,
                        condition: '',
                        icon: null,
                        story: this.storyData[affection.storyKey] || { scripts: [] }
                    }))
                },
                'daily': {
                    id: 'daily',
                    name: 'TB의 일상',
                    child: Object.values(this.dailyData).map(daily => ({
                        id: daily.id,
                        title: daily.title,
                        condition: '',
                        icon: null,
                        story: this.storyData[daily.storyKey] || { scripts: [] }
                    }))
                }
            };
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
                    // Restore story view
                    this.playStoryById(e.state.category, e.state.storyId, false);
                } else {
                    // Return to tabs
                    this.returnToTabs(false);
                }
            });
        },

        // =========================================================================
        // TAB SWITCHING
        // =========================================================================
        switchTab(tabName) {
            this.currentTab = tabName;

            // Update tab buttons
            this.elements.tabBtns.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tab === tabName);
            });

            // Update tab content
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
            this.populateAffectionGrid();
            this.populateDailyGrid();
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

        populateAffectionGrid() {
            this.elements.affectionGrid.innerHTML = '';

            // Sort by ID to maintain order
            const sortedAffection = Object.values(this.affectionData).sort((a, b) => a.id - b.id);

            sortedAffection.forEach(affection => {
                const card = this.createAffectionCard(affection);
                this.elements.affectionGrid.appendChild(card);
            });
        },

        populateDailyGrid() {
            this.elements.dailyGrid.innerHTML = '';

            // Sort by ID to maintain order
            const sortedDaily = Object.values(this.dailyData).sort((a, b) => a.id - b.id);

            sortedDaily.forEach(daily => {
                const card = this.createDailyCard(daily);
                this.elements.dailyGrid.appendChild(card);
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

            // Create cards for all photos from educateavatar folder
            this.PHOTO_FILENAMES.forEach(filename => {
                const card = this.createPhotoCard(filename);
                this.elements.photosGrid.appendChild(card);
            });
        },

        // =========================================================================
        // CARD CREATION
        // =========================================================================
        createMemoryCard(memory) {
            const card = document.createElement('div');
            card.className = 'tb-card';

            // Look up title from mapping based on performance field (use title but not icon)
            const mappingData = this.storyIconMap[memory.performance?.toLowerCase()] || {};
            const title = mappingData.title || memory.desc || 'Untitled';

            card.dataset.title = title;

            // Use placeholder for memories (icons are too plain)
            const imageUrl = 'assets/img/tb_placeholder.png';

            card.innerHTML = `
                <img class="tb-card-image" src="${imageUrl}" alt="${title}" loading="lazy">
                <div class="tb-card-content">
                    <h3 class="tb-card-title">${title}</h3>
                    <span class="tb-card-badge">메모리 #${memory.id}</span>
                </div>
            `;

            card.addEventListener('click', () => {
                this.playStory('memory', memory.id, title);
            });

            return card;
        },

        createEndingCard(ending) {
            const card = document.createElement('div');
            card.className = 'tb-card';

            // Look up icon and title from mapping based on performance field
            const mappingData = this.storyIconMap[ending.performance?.toLowerCase()] || {};
            const title = mappingData.title || ending.name || 'Untitled';
            const icon = mappingData.icon;

            card.dataset.title = title;

            // Use icon from mapping, fallback to pic_preview, then placeholder
            const imageUrl = icon
                ? `${this.ICON_URL}${icon}.png`
                : (ending.pic_preview ? `${this.BASE_URL}${ending.pic_preview}.png` : 'assets/img/tb_placeholder.png');

            card.innerHTML = `
                <img class="tb-card-image" src="${imageUrl}" alt="${title}" loading="lazy">
                <div class="tb-card-content">
                    <h3 class="tb-card-title">${title}</h3>
                    <span class="tb-card-badge">엔딩 #${ending.id}</span>
                </div>
            `;

            // Add error handling properly to avoid infinite loops
            const img = card.querySelector('.tb-card-image');
            img.addEventListener('error', function(e) {
                if (this.src !== window.location.origin + '/altoy/assets/img/tb_placeholder.png' && !this.dataset.errorHandled) {
                    this.dataset.errorHandled = 'true';
                    this.src = 'assets/img/tb_placeholder.png';
                }
            }, { once: false });

            card.addEventListener('click', () => {
                this.playStory('ending', ending.id, title);
            });

            return card;
        },

        createAffectionCard(affection) {
            const card = document.createElement('div');
            card.className = 'tb-card';
            card.dataset.title = affection.title;

            // Use icon from mapping, fallback to placeholder
            const imageUrl = affection.icon
                ? `${this.ICON_URL}${affection.icon}.png`
                : 'assets/img/tb_placeholder.png';

            card.innerHTML = `
                <img class="tb-card-image" src="${imageUrl}" alt="${affection.title}" loading="lazy">
                <div class="tb-card-content">
                    <h3 class="tb-card-title">${affection.title}</h3>
                    <span class="tb-card-badge">호감도 #${affection.id}</span>
                </div>
            `;

            // Add error handling properly to avoid infinite loops
            const img = card.querySelector('.tb-card-image');
            img.addEventListener('error', function(e) {
                if (this.src !== window.location.origin + '/altoy/assets/img/tb_placeholder.png' && !this.dataset.errorHandled) {
                    this.dataset.errorHandled = 'true';
                    this.src = 'assets/img/tb_placeholder.png';
                }
            }, { once: false });

            card.addEventListener('click', () => {
                this.playStory('affection', affection.id, affection.title);
            });

            return card;
        },

        createDailyCard(daily) {
            const card = document.createElement('div');
            card.className = 'tb-card';
            card.dataset.title = daily.title;

            // Use icon from mapping, fallback to placeholder
            const imageUrl = daily.icon
                ? `${this.ICON_URL}${daily.icon}.png`
                : 'assets/img/tb_placeholder.png';

            card.innerHTML = `
                <img class="tb-card-image" src="${imageUrl}" alt="${daily.title}" loading="lazy">
                <div class="tb-card-content">
                    <h3 class="tb-card-title">${daily.title}</h3>
                    <span class="tb-card-badge">일상 #${daily.id}</span>
                </div>
            `;

            // Add error handling properly to avoid infinite loops
            const img = card.querySelector('.tb-card-image');
            img.addEventListener('error', function(e) {
                if (this.src !== window.location.origin + '/altoy/assets/img/tb_placeholder.png' && !this.dataset.errorHandled) {
                    this.dataset.errorHandled = 'true';
                    this.src = 'assets/img/tb_placeholder.png';
                }
            }, { once: false });

            card.addEventListener('click', () => {
                this.playStory('daily', daily.id, daily.title);
            });

            return card;
        },

        createPolaroidCard(polaroid) {
            const card = document.createElement('div');
            card.className = 'tb-card polaroid-card';
            card.dataset.title = polaroid.title || '';

            // Use pic field (529x514 thumbnail)
            const imageUrl = polaroid.pic
                ? `${this.BASE_URL}${polaroid.pic}.png`
                : 'assets/img/tb_placeholder.png';

            card.innerHTML = `
                <img class="tb-card-image" src="${imageUrl}" alt="${polaroid.title}" loading="lazy">
                <div class="tb-card-content">
                    <h3 class="tb-card-title">${polaroid.title || 'Untitled'}</h3>
                    <p class="tb-card-desc">${polaroid.condition || ''}</p>
                    <div class="polaroid-card-footer">
                        <span class="polaroid-stage">
                            <span class="material-symbols-outlined" style="font-size: 14px; vertical-align: middle;">star</span>
                            ${polaroid.stage?.join(', ') || 'N/A'}
                        </span>
                        <span class="polaroid-group-badge">그룹 ${polaroid.group || 1}</span>
                    </div>
                </div>
            `;

            // Add error handling properly to avoid infinite loops
            const img = card.querySelector('.tb-card-image');
            img.addEventListener('error', function(e) {
                // Only try to set placeholder once
                if (this.src !== window.location.origin + '/altoy/assets/img/tb_placeholder.png' && !this.dataset.errorHandled) {
                    this.dataset.errorHandled = 'true';
                    this.src = 'assets/img/tb_placeholder.png';
                }
            }, { once: false });

            card.addEventListener('click', () => {
                this.showPolaroidDetail(polaroid);
            });

            return card;
        },

        createPhotoCard(filename) {
            const card = document.createElement('div');
            card.className = 'photo-card';

            const imageUrl = `${this.AVATAR_URL}${filename}.png`;

            card.innerHTML = `
                <img src="${imageUrl}" alt="${filename}" loading="lazy">
            `;

            // Add error handling
            const img = card.querySelector('img');
            img.addEventListener('error', function(e) {
                if (!this.dataset.errorHandled) {
                    this.dataset.errorHandled = 'true';
                    this.src = 'assets/img/tb_placeholder.png';
                }
            }, { once: false });

            return card;
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
            // category: 'memory' or 'ending'
            this.currentCategory = category;
            this.currentStoryId = id;

            // Update URL
            this.updateUrl(category, id);

            // Play the story using the engine
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

            // Set state
            this.currentCategory = category;
            this.currentStoryId = storyId;

            // Update URL if needed
            if (updateUrl) {
                this.updateUrl(category, storyId);
            }

            // Hide tab view, show story viewer
            this.elements.tabNavView.classList.add('hidden');
            this.elements.storyViewerView.classList.remove('hidden');

            // Use the StoryViewer engine to play the story
            if (window.StoryViewer) {
                // Reset all state properly
                window.StoryViewer.currentEventId = category;
                window.StoryViewer.currentMemoryId = storyId;
                window.StoryViewer.currentStoryScript = memory.story.scripts;
                window.StoryViewer.scriptIndex = 0;
                window.StoryViewer.lastActorId = null;
                window.StoryViewer.currentBgm = null;
                window.StoryViewer.currentStoryDefaultBgUrl = null;

                // Reset background cache for new story
                window.StoryViewer.cachedBackground = {
                    url: null,
                    isBlack: false,
                    lastIndex: -1
                };

                // Set default background if mask exists
                if (memory.story.mask) {
                    window.StoryViewer.currentStoryDefaultBgUrl = `${window.StoryViewer.BASE_URL}${memory.story.mask}.png`;
                }

                // Calculate next memory
                const memories = eventData.child;
                const index = memories.findIndex(m => m.id === storyId);
                window.StoryViewer.nextMemory = (index >= 0 && index < memories.length - 1) ? memories[index + 1] : null;

                // Clear fade overlay if present
                if (window.StoryViewer.elements.fadeOverlay) {
                    window.StoryViewer.elements.fadeOverlay.classList.remove('visible');
                }

                window.StoryViewer.elements.storyTitle.textContent = `${eventData.name} - ${memory.title}`;
                window.StoryViewer.renderScriptLine();
            }
        },

        returnToTabs(updateUrl = true) {
            // Stop audio
            if (window.StoryViewer && window.StoryViewer.audio) {
                window.StoryViewer.audio.pause();
                window.StoryViewer.currentBgm = null;
            }

            // Clear state
            this.currentCategory = null;
            this.currentStoryId = null;

            // Update URL
            if (updateUrl) {
                this.updateUrl(null, null, true);
            }

            // Show tab view, hide story viewer
            this.elements.storyViewerView.classList.add('hidden');
            this.elements.tabNavView.classList.remove('hidden');
        },

        // =========================================================================
        // POLAROID MODAL
        // =========================================================================
        showPolaroidDetail(polaroid) {
            // Use pic (529x514) for front/thumbnail
            const frontUrl = polaroid.pic
                ? `${this.BASE_URL}${polaroid.pic}.png`
                : 'assets/img/tb_placeholder.png';
            // Use pic_2 (960x720) for back/larger view
            const backUrl = polaroid.pic_2
                ? `${this.BASE_URL}${polaroid.pic_2}.png`
                : 'assets/img/tb_placeholder.png';

            // Reset error handling flags
            delete this.elements.polaroidImgFront.dataset.errorHandled;
            delete this.elements.polaroidImgBack.dataset.errorHandled;

            this.elements.polaroidImgFront.src = frontUrl;
            this.elements.polaroidImgBack.src = backUrl;
            this.elements.polaroidImgFront.classList.remove('hidden');
            this.elements.polaroidImgBack.classList.add('hidden');

            // Add error handling with guards to prevent infinite loops
            const placeholderPath = window.location.origin + '/altoy/assets/img/tb_placeholder.png';
            this.elements.polaroidImgFront.onerror = function() {
                if (this.src !== placeholderPath && !this.dataset.errorHandled) {
                    this.dataset.errorHandled = 'true';
                    this.src = 'assets/img/tb_placeholder.png';
                }
            };
            this.elements.polaroidImgBack.onerror = function() {
                if (this.src !== placeholderPath && !this.dataset.errorHandled) {
                    this.dataset.errorHandled = 'true';
                    this.src = 'assets/img/tb_placeholder.png';
                }
            };

            // Populate info with better formatting
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
            const tbStoryConfig = {
                viewerType: 'tb',

                dataPaths: [],

                processLoadedData: (viewer, dataArray) => {
                    // Inject our converted data
                    viewer.storylineData = TbViewer.convertedStorylineData;
                    viewer.shipgirlData = TbViewer.shipgirlData;
                    viewer.nameCodeData = TbViewer.nameCodeData;
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
                // Override the loadData method to use our already-loaded data
                window.StoryViewer.loadData = async function() {
                    this.storylineData = TbViewer.convertedStorylineData;
                    this.shipgirlData = TbViewer.shipgirlData;
                    this.nameCodeData = TbViewer.nameCodeData;

                    // Build name map
                    for (const id in this.shipgirlData) {
                        this.shipgirlNameMap[this.shipgirlData[id].name] = id;
                    }

                    return Promise.resolve();
                };

                // Override returnToMemorySelection to go back to tabs instead
                const originalReturnToMemory = window.StoryViewer.returnToMemorySelection;
                window.StoryViewer.returnToMemorySelection = function() {
                    TbViewer.returnToTabs();
                };

                window.StoryViewer.init(tbStoryConfig);

                // Override populateEventGrid to do nothing (we use our own tabs)
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

    // =========================================================================
    // START THE APPLICATION
    // =========================================================================
    TbViewer.init();
});