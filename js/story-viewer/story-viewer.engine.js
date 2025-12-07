/**
 * story-viewer-common.js
 * ----------------------
 * This is the shared "engine" for both the Main and World Story Viewers.
 * It contains all the common logic for rendering the story, handling audio,
 * managing UI views, and processing user interactions.
 *
 * It is configured by a page-specific script (like main-story-viewer.script.js)
 * which tells it what data to load and how to handle minor variations.
 */
document.addEventListener('DOMContentLoaded', () => {
    // A global namespace to hold all viewer logic and state.
    window.StoryViewer = {
        // =========================================================================
        // STATE & CONSTANTS
        // =========================================================================
        config: {}, // Page-specific configuration
        storylineData: {},
        storylineSummaryData: {}, // Only used by world viewer
        shipgirlData: {},
        shipgirlNameMap: {},
        currentEventId: null,
        currentMemoryId: null,
        currentStoryScript: [],
        scriptIndex: 0,
        lastActorId: null,
        nextMemory: null,
        currentBgm: null,
        currentStoryDefaultBgUrl: null, // Only used by main viewer
        audio: new Audio(),
        activeSfx: [], // Track active sound effects to prevent memory leaks

        // Branching state, for handling options
        activeOptionFlag: null,     // currently selected option flag (null when not in a branch)
        lastOptionIndex: -1,        // index of the last line that presented options (decision point)

        // Navigation cache for fast lookups (precomputed on story start)
        scriptNavCache: null,

        // Performance cache for full script modal
        cachedFullScript: null,

        // Performance cache for background state
        cachedBackground: {
            url: null,
            isBlack: false,
            lastIndex: -1
        },

        COMMANDER_ICON_PATH: 'assets/icon/commander.png',
        BASE_URL: "https://raw.githubusercontent.com/JforPlay/data_for_toy/main/",
        BGM_URL_PREFIX: "https://github.com/Fernando2603/AzurLane/raw/refs/heads/main/audio/bgm/",

        // =========================================================================
        // DOM ELEMENTS
        // =========================================================================
        elements: {
            eventSelectionView: document.getElementById('event-selection-view'),
            memorySelectionView: document.getElementById('memory-selection-view'),
            storyViewerView: document.getElementById('story-viewer-view'),
            eventGrid: document.getElementById('event-grid'),
            memoryGrid: document.getElementById('memory-grid'),
            searchBar: document.getElementById('search-bar'),
            backToEventBtn: document.getElementById('back-to-event-selection'),
            backToMemoryBtn: document.getElementById('back-to-memory-selection'),
            storyTitle: document.getElementById('story-title'),
            dialogueBox: document.getElementById('dialogue-box'),
            actorPortrait: document.getElementById('actor-portrait'),
            actorName: document.getElementById('actor-name'),
            dialogueText: document.getElementById('dialogue-text'),
            optionsBox: document.getElementById('options-box'),
            nextPageIndicator: document.getElementById('next-page-indicator'),
            prevLineBtn: document.getElementById('prev-line-btn'),
            nextLineBtn: document.getElementById('next-line-btn'),
            nextStoryBtn: document.getElementById('next-story-btn'),
            returnBtn: document.getElementById('return-btn'),
            viewerContainer: document.getElementById('viewer-container'),
            errorContainer: document.getElementById('error-container'),
            memoryViewTitle: document.getElementById('memory-view-title'),
            themeToggles: document.querySelectorAll('.theme-toggle'),
            viewScriptBtn: document.getElementById('view-script-btn'),
            scriptModalOverlay: document.getElementById('script-modal-overlay'),
            closeModalBtn: document.getElementById('close-modal-btn'),
            fullScriptContent: document.getElementById('full-script-content'),
            infoScreen: document.getElementById('info-screen'),
            infoScreenText: document.getElementById('info-screen-text'),
            fadeOverlay: document.getElementById('fade-overlay'),
            summaryModalOverlay: document.getElementById('summary-modal-overlay'),
            closeSummaryModalBtn: document.getElementById('close-summary-modal-btn'),
            summaryModalContent: document.getElementById('summary-modal-content'),
            audioPlayerContainer: document.getElementById('audio-player-container'),
            playPauseBtn: document.getElementById('play-pause-btn'),
            muteBtn: document.getElementById('mute-btn'),
            volumeSlider: document.getElementById('volume-slider'),
            bgmNameSpan: document.getElementById('bgm-name'),
            progressIndicator: document.getElementById('progress-indicator'),
            // Cached elements (populated on first access)
            storyBackground: null,
            playPauseIcon: null,
            muteIcon: null,
        },

        // =========================================================================
        // INITIALIZATION
        // =========================================================================
        init(config) {
            this.config = config;
            this.audio.loop = true;
            this.audio.volume = 0.01;
            this.loadData()
                .then(() => {
                    this.populateEventGrid();
                    this.handleUrlParameters();
                    this.setupEventListeners();
                    this.setupBrowserBackButton();
                    // Loading state automatically handled by populateEventGrid
                })
                .catch(error => {
                    console.error('Initialization failed:', error);
                    this.showError('Failed to load critical story data. Please refresh.');
                });
        },

        async loadData() {
            const fetchPromises = this.config.dataPaths.map(path => fetch(path).then(res => {
                if (!res.ok) throw new Error(`Network response was not ok for ${path}`);
                return res.json();
            }));

            const jsonDataArray = await Promise.all(fetchPromises);

            // Allow the config to process the loaded data
            this.config.processLoadedData(this, jsonDataArray);

            for (const id in this.shipgirlData) {
                this.shipgirlNameMap[this.shipgirlData[id].name] = id;
            }
        },

        // =========================================================================
        // EVENT LISTENERS SETUP
        // =========================================================================
        setupEventListeners() {
            const el = this.elements;

            // --- Listeners for Static Page Elements ---
            // Debounce search to avoid rebuilding grid on every keystroke
            if (el.searchBar) {
                const debouncedSearch = debounce((value) => this.populateEventGrid(value), 300);
                el.searchBar.addEventListener('input', (e) => debouncedSearch(e.target.value));
            }
            el.backToEventBtn?.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchView(el.eventSelectionView);
                this.updateUrl(null, null, true);
            });
            el.backToMemoryBtn?.addEventListener('click', (e) => {
                e.preventDefault();
                this.returnToMemorySelection();
            });

            // Story Viewer Interactions
            el.storyViewerView?.addEventListener('click', (e) => {
                if (e.target.closest('.option-button, .nav-button, .story-nav-btn, .audio-player-container, .theme-toggle')) return;
                if (el.optionsBox.children.length === 0) this.advanceStory();
            });
            el.prevLineBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.goBackStory(); });
            el.nextLineBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.advanceStory(); });
            el.nextStoryBtn?.addEventListener('click', (e) => { e.stopPropagation(); if (this.nextMemory) this.startStory(this.nextMemory); });
            el.returnBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.returnToMemorySelection(); });

            // Modals
            el.viewScriptBtn?.addEventListener('click', () => this.showFullScript());
            el.closeModalBtn?.addEventListener('click', () => this.hideFullScript());
            el.scriptModalOverlay?.addEventListener('click', (e) => { if (e.target === el.scriptModalOverlay) this.hideFullScript(); });
            el.closeSummaryModalBtn?.addEventListener('click', () => this.hideSummaryModal());
            el.summaryModalOverlay?.addEventListener('click', (e) => { if (e.target === el.summaryModalOverlay) this.hideSummaryModal(); });

            // Audio Player
            el.playPauseBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.audio.paused ? this.audio.play().catch(console.warn) : this.audio.pause(); });
            el.muteBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.audio.muted = !this.audio.muted; this.updateAudioPlayerUI(); });
            el.volumeSlider?.addEventListener('input', (e) => { e.stopPropagation(); this.audio.volume = e.target.value; this.audio.muted = e.target.value == 0; this.updateAudioPlayerUI(); });

            // Clean up old audio listeners and add new ones
            this.cleanupAudioListeners();
        },

        setupBrowserBackButton() {
            window.addEventListener('popstate', (e) => {
                if (e.state) {
                    // User pressed back with saved state
                    const { eventId, storyId } = e.state;
                    if (eventId && storyId) {
                        // Restore story view
                        this.selectEvent(eventId, false);
                        const eventData = this.storylineData[eventId];
                        const memoryData = this.config.findMemory(eventData, storyId);
                        if (memoryData) {
                            this.startStory(memoryData, false);
                        }
                    } else if (eventId) {
                        // Restore memory selection view
                        this.selectEvent(eventId, false);
                    }
                } else {
                    // User pressed back to initial state
                    this.switchView(this.elements.eventSelectionView);
                }
            });
        },

        cleanupAudioListeners() {
            // Remove old event listeners if they exist
            if (this.audioPlayHandler) {
                this.audio.removeEventListener('play', this.audioPlayHandler);
            }
            if (this.audioPauseHandler) {
                this.audio.removeEventListener('pause', this.audioPauseHandler);
            }

            // Store new handlers for future cleanup
            this.audioPlayHandler = () => this.updateAudioPlayerUI();
            this.audioPauseHandler = () => this.updateAudioPlayerUI();

            this.audio.addEventListener('play', this.audioPlayHandler);
            this.audio.addEventListener('pause', this.audioPauseHandler);
        },

        // =========================================================================
        // URL & VIEW MANAGEMENT
        // =========================================================================
        updateUrl(eventId, storyId, clear = false) {
            const url = new URL(window.location);
            if (clear) {
                // Pushes state to the base path of the current page, clearing query params
                history.pushState({}, '', window.location.pathname);
                return;
            }
            url.searchParams.delete('eventid');
            url.searchParams.delete('story');

            if (eventId) url.searchParams.set('eventid', eventId);
            if (storyId) url.searchParams.set('story', storyId);

            // Use pathname and search to keep the full path
            history.pushState({ eventId, storyId }, '', url.pathname + url.search);
        },

        handleUrlParameters() {
            const urlParams = new URLSearchParams(window.location.search);
            const eventId = urlParams.get('eventid'); // Consistently use lowercase 'eventid'
            const storyId = urlParams.get('story');

            if (eventId && this.storylineData[eventId]) {
                this.selectEvent(eventId, false);
                if (storyId) {
                    const eventData = this.storylineData[eventId];
                    const memoryData = this.config.findMemory(eventData, storyId);
                    if (memoryData) {
                        this.startStory(memoryData, false);
                    } else {
                        this.showError(`Story with ID '${storyId}' not found in this event.`);
                    }
                }
            } else if (eventId) {
                this.showError(`Event with ID '${eventId}' not found.`);
            }
        },

        switchView(viewToShow, scrollToTop = true) {
            [this.elements.eventSelectionView, this.elements.memorySelectionView, this.elements.storyViewerView].forEach(view => {
                if (view) view.classList.toggle('hidden', view !== viewToShow);
            });

            // Scroll to top when navigating forward (unless explicitly disabled)
            if (scrollToTop) {
                window.scrollTo(0, 0);
            }

            // When leaving memory view, pause audio and hide player
            if (viewToShow !== this.elements.storyViewerView) {
                this.audio.pause();
                if (this.elements.audioPlayerContainer) this.elements.audioPlayerContainer.classList.add('hidden');
            }
        },

        // =========================================================================
        // UI POPULATION & NAVIGATION
        // =========================================================================
        populateEventGrid(searchTerm = '') {
            this.elements.eventGrid.innerHTML = '';
            const filteredEvents = Object.entries(this.storylineData) // Use Object.entries to get both key and value
                .filter(([key, event]) => event.name.toLowerCase().includes((searchTerm || '').toLowerCase()));

            if (filteredEvents.length === 0 && Object.keys(this.storylineData).length === 0) {
                // Still loading - show skeleton cards
                for (let i = 0; i < 6; i++) {
                    const skeletonCard = this.createSkeletonCard();
                    this.elements.eventGrid.appendChild(skeletonCard);
                }
                return;
            }

            filteredEvents.forEach(([key, event]) => {
                // This new line robustly finds the ID whether it's the key or a property inside the object.
                const eventId = event.id || key;

                const card = this.createCard(
                    event.name,
                    event.description || `Chapter: ${event.name.replace(/[^0-9]/g, '')}`,
                    event.icon,
                    this.config.getEventIconPath(event),
                    () => this.selectEvent(eventId) // Pass the correct eventId
                );
                this.elements.eventGrid.appendChild(card);
            });
        },

        createSkeletonCard() {
            const card = document.createElement('div');
            card.className = 'grid-card skeleton-card';
            card.innerHTML = `
                <div class="card-thumbnail skeleton-thumbnail"></div>
                <div class="card-content">
                    <div class="skeleton-title"></div>
                    <div class="skeleton-subtitle"></div>
                </div>`;
            return card;
        },

        createCard(title, subtitle, icon, pathPrefix, onClick, id = null) {
            const card = document.createElement('div');
            card.className = 'grid-card';
            if (id) card.dataset.id = id;

            let thumbnailHtml = '';
            if (icon) {
                let imageUrl = icon.startsWith('http') || icon.startsWith('data:image') || icon.includes('assets/')
                    ? icon
                    : `${pathPrefix}${icon}.png`;
                thumbnailHtml = `<div class="card-thumbnail" style="background-image: url('${imageUrl}')"></div>`;
            } else {
                thumbnailHtml = `<div class="card-thumbnail" style="background-color: #34495e;"></div>`;
            }

            card.innerHTML = `
                ${thumbnailHtml}
                <div class="card-content">
                    <h3 class="card-title">${title}</h3>
                    <p class="card-subtitle">${subtitle || ''}</p>
                </div>`;
            card.addEventListener('click', onClick);
            return card;
        },

        selectEvent(eventId, updateUrl = true) {
            this.currentEventId = eventId;
            const eventData = this.storylineData[eventId];
            this.elements.memoryViewTitle.textContent = eventData.name;
            this.elements.memoryGrid.innerHTML = '';

            // Allow config to add extra cards (like summary card for world viewer)
            if (this.config.populateMemoryGridExtras) {
                this.config.populateMemoryGridExtras(this, this.elements.memoryGrid, eventId);
            }

            const memories = this.config.getEventMemories(eventData);
            if (memories && Array.isArray(memories)) {
                memories.forEach(memory => {
                    const card = this.createCard(
                        memory.title || memory.name,
                        memory.condition,
                        memory.icon,
                        `${this.BASE_URL}memoryicon/`,
                        () => this.startStory(memory),
                        memory.id
                    );
                    this.elements.memoryGrid.appendChild(card);
                });
            }

            if (updateUrl) {
                this.updateUrl(this.currentEventId);
            }

            this.switchView(this.elements.memorySelectionView);
            // Note: Audio warning now displayed via flavor-text-box in HTML (not programmatic popup)
        },

        returnToMemorySelection() {
            this.updateUrl(this.currentEventId);
            this.switchView(this.elements.memorySelectionView, false); // Don't scroll to top when going back

            const previouslyHighlighted = this.elements.memoryGrid.querySelector('.highlighted-card');
            if (previouslyHighlighted) previouslyHighlighted.classList.remove('highlighted-card');

            if (this.nextMemory && this.nextMemory.id) {
                const nextCard = this.elements.memoryGrid.querySelector(`.grid-card[data-id='${this.nextMemory.id}']`);
                if (nextCard) {
                    nextCard.classList.add('highlighted-card');
                    nextCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        },

        // =========================================================================
        // NAVIGATION CACHE (Precomputed for Performance)
        // =========================================================================
        buildNavigationCache() {
            // First pass: collect metadata and find all unique flags
            const flagSet = new Set();
            const lineMetadata = [];

            this.currentStoryScript.forEach((line, idx) => {
                const isDisplayable = this.isLineDisplayable(line);
                const hasOptions = line.options && line.options.length > 0;
                const flag = line.optionFlag;

                lineMetadata.push({ flag, isDisplayable, hasOptions });

                if (flag !== undefined) {
                    flagSet.add(flag);
                }
            });

            // Flag contexts: null (outside branch) + all unique flags
            const flagContexts = [null, ...Array.from(flagSet)];

            // Second pass: for each (index, flagContext) pair, compute navigation
            const navigation = {};

            for (let i = 0; i < this.currentStoryScript.length; i++) {
                for (const flagContext of flagContexts) {
                    const key = `${i}_${flagContext}`;

                    // Find next displayable line reachable from this position in this flag context
                    let next = null;
                    for (let j = i + 1; j < this.currentStoryScript.length; j++) {
                        const targetMeta = lineMetadata[j];
                        if (!targetMeta.isDisplayable) continue;

                        // Check if reachable based on flag context
                        const reachable = (flagContext === null)
                            ? (targetMeta.flag === undefined)  // Outside branch: only unflagged
                            : (targetMeta.flag === undefined || targetMeta.flag === flagContext); // Inside: same flag or unflagged

                        if (reachable) {
                            next = j;
                            break;
                        }
                    }

                    // Find previous displayable line reachable to this position in this flag context
                    let prev = null;
                    for (let j = i - 1; j >= 0; j--) {
                        const targetMeta = lineMetadata[j];
                        if (!targetMeta.isDisplayable) continue;

                        // For going back, check if we could have reached current position from j
                        const reachable = (flagContext === null)
                            ? (targetMeta.flag === undefined)
                            : (targetMeta.flag === undefined || targetMeta.flag === flagContext);

                        if (reachable) {
                            prev = j;
                            break;
                        }
                    }

                    navigation[key] = {
                        next,
                        prev
                    };
                }
            }

            this.scriptNavCache = {
                lineMetadata,
                navigation
            };
        },

        // =========================================================================
        // STORY PLAYER LOGIC
        // =========================================================================
        startStory(memory, updateUrl = true) {
            const story = this.config.getMemoryStory(memory);
            if (!story?.scripts) {
                this.showError("This story is not available.");
                return;
            }

            if (this.elements.fadeOverlay) this.elements.fadeOverlay.classList.remove('visible');

            this.currentStoryScript = story.scripts;
            this.currentMemoryId = memory.id;
            this.scriptIndex = 0;
            this.lastActorId = null;
            this.currentBgm = null;
            this.currentStoryDefaultBgUrl = null;
            this.activeOptionFlag = null;
            this.lastOptionIndex = -1;


            // Reset caches for new story
            this.cachedBackground = {
                url: null,
                isBlack: false,
                lastIndex: -1
            };
            this.scriptNavCache = null; // Will be rebuilt after preloading
            this.cachedFullScript = null; // Will be built on first modal open

            // Set default background for both viewer types if mask exists
            if (memory.mask) {
                this.currentStoryDefaultBgUrl = `${this.BASE_URL}${memory.mask}.png`;
            }

            const event = this.storylineData[this.currentEventId];
            const memories = this.config.getEventMemories(event);
            const index = memories.findIndex(mem => mem.id == memory.id);
            this.nextMemory = (index >= 0 && index < memories.length - 1) ? memories[index + 1] : null;

            const eventName = event?.name || 'Event';
            this.elements.storyTitle.textContent = `${eventName} - ${memory.title || memory.name || 'Chapter'}`;

            if (updateUrl) {
                this.updateUrl(this.currentEventId, memory.id);
            }

            // Preload key images
            const imagesToPreload = new Set();
            if (this.currentStoryDefaultBgUrl) imagesToPreload.add(this.currentStoryDefaultBgUrl);
            const firstBgLine = this.currentStoryScript.find(line => line.bgName);
            if (firstBgLine) imagesToPreload.add(`${this.BASE_URL}bg/${firstBgLine.bgName}.png`);
            imagesToPreload.forEach(src => { new Image().src = src; });

            // Build navigation cache for fast lookups
            this.buildNavigationCache();

            this.renderScriptLine();
            this.switchView(this.elements.storyViewerView);
        },

        isLineDisplayable(line) {
            if (!line) return false;
            return line.say || (line.sequence && line.sequence[0] && line.sequence[0][0]) || (line.signDate && line.signDate[0]) || (line.options && line.options.length > 0);
        },

        advanceStory() {
            if (this.scriptIndex >= this.currentStoryScript.length - 1) return;

            const currentLine = this.currentStoryScript[this.scriptIndex];
            const flagContext = (currentLine && currentLine.optionFlag !== undefined) ? currentLine.optionFlag : null;
            const key = `${this.scriptIndex}_${flagContext}`;
            const navInfo = this.scriptNavCache.navigation[key];

            if (navInfo && navInfo.next !== null) {
                this.scriptIndex = navInfo.next;
                this.renderScriptLine();
            } else {
                // At end of reachable path
                this.renderScriptLine();
            }
        },

        goBackStory() {
            if (this.scriptIndex <= 0) return;

            // For going back, we need to consider both the current line's context
            // and whether we're in an active branch
            const currentLine = this.currentStoryScript[this.scriptIndex];
            let flagContext;

            if (this.activeOptionFlag !== null) {
                // Inside a branch, use the active flag
                flagContext = this.activeOptionFlag;
            } else {
                // Outside branch, use current line's flag (if any)
                flagContext = (currentLine && currentLine.optionFlag !== undefined) ? currentLine.optionFlag : null;
            }

            const key = `${this.scriptIndex}_${flagContext}`;
            const navInfo = this.scriptNavCache.navigation[key];

            if (navInfo && navInfo.prev !== null) {
                // Check if going back crosses the decision point
                if (this.activeOptionFlag !== null && navInfo.prev <= this.lastOptionIndex) {
                    // Exit branch mode and land on the options line
                    this.activeOptionFlag = null;
                    this.scriptIndex = this.lastOptionIndex;
                } else {
                    this.scriptIndex = navInfo.prev;
                }
                this.renderScriptLine();
            }
        },


        renderScriptLine() {
            if (this.scriptIndex >= this.currentStoryScript.length) return;
            const line = this.currentStoryScript[this.scriptIndex];
            const el = this.elements;

            el.optionsBox.innerHTML = '';
            el.dialogueBox.classList.add('hidden');
            el.infoScreen.classList.add('hidden');

            this.updateBackground();
            if (line.effects) this.handleEffect(line.effects);
            if (line.stopbgm) { this.handleBgm(null); }
            else if (line.bgm) { this.handleBgm(line.bgm); }

            const infoText = line.sequence?.[0]?.[0] || line.signDate?.[0];

            if (infoText && infoText.trim() !== "") {
                el.infoScreen.classList.remove('hidden');
                el.infoScreenText.textContent = infoText;
            } else if (line.say) {
                el.dialogueBox.classList.remove('hidden');

                // Handle text formatting based on viewer type
                if (this.config.viewerType === 'main') {
                    const formattedDialogue = line.say.replace(/<color=(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})>(.*?)<\/color>/gi, '<span style="color: $1;">$2</span>');
                    el.dialogueText.innerHTML = formattedDialogue.replace(/<\/?[^>]+(>|$)/g, (match) => (match.startsWith('<span') || match.startsWith('</span')) ? match : '');
                } else {
                    el.dialogueText.textContent = line.say.replace(/<.*?>/g, '');
                }

                const actorInfo = this.getActorInfo(line);

                let displayedName = actorInfo.name;
                if (this.config.viewerType === 'world' && actorInfo.name === 'Narrator') {
                    displayedName = '';
                }

                if (actorInfo.id !== this.lastActorId) {
                    el.actorName.textContent = displayedName;
                    el.actorPortrait.innerHTML = actorInfo.icon ? `<img src="${actorInfo.icon}" alt="${actorInfo.name}">` : '';
                    el.actorPortrait.classList.toggle('hidden', !actorInfo.icon);
                }

                // Apply shadow effect if actorShadow flag is set
                el.actorPortrait.classList.toggle('actor-shadow', line.actorShadow === true);

                this.lastActorId = actorInfo.id;
            }

            // Update navigation buttons
            const hasOptions = line.options && line.options.length > 0;
            const isAtFileEnd = this.scriptIndex >= this.currentStoryScript.length - 1;
            el.prevLineBtn.disabled = (this.scriptIndex <= 0);

            // Use "reachable path" semantics (branch-aware) for both Next and Return
            const nextDisplayableExists = this.hasReachableNextDisplayable();
            const isAtPathEnd = !nextDisplayableExists;

            // Hide Next when there’s no reachable next line OR we’re on an options line
            el.nextLineBtn.classList.toggle('hidden', hasOptions || !nextDisplayableExists);

            // Show the Return/Go Back button when at the end of file OR end of reachable path
            el.returnBtn.classList.toggle('hidden', !(isAtFileEnd || isAtPathEnd));

            // If you have a "next story" button, you probably want to show it
            // only at the *true* file end; keep that behavior:
            el.nextStoryBtn.classList.toggle('hidden', !((isAtFileEnd || isAtPathEnd) && this.nextMemory));

            // Page indicator hidden when we’re at path end (no next) or on options
            el.nextPageIndicator.classList.toggle('hidden', isAtPathEnd || hasOptions);


            // Update progress indicator
            this.updateProgressIndicator();

            if (hasOptions) {
                line.options.forEach(opt => {
                    const button = document.createElement('button');
                    button.className = 'option-button';
                    button.textContent = opt.content.replace(/<.*?>/g, '');
                    button.onclick = (e) => { e.stopPropagation(); this.handleOptionSelect(opt.flag); };
                    el.optionsBox.appendChild(button);
                });
            }
        },

        handleOptionSelect(chosenFlag) {
            const currentLineIndex = this.scriptIndex;
            const currentLine = this.currentStoryScript[currentLineIndex];
            const optionCount = currentLine.options ? currentLine.options.length : 0;

            // Record decision point
            this.lastOptionIndex = currentLineIndex;

            // If only one option, we simply "advance" but explicitly set branch state anyway
            this.activeOptionFlag = (optionCount >= 1) ? chosenFlag : null;

            // Find the first line with the chosen flag after the options
            let nextIndex = -1;
            for (let i = currentLineIndex + 1; i < this.currentStoryScript.length; i++) {
                const line = this.currentStoryScript[i];
                if (line && line.optionFlag === chosenFlag) {
                    nextIndex = i;
                    break;
                }
                // If we hit an unflagged line before any chosen-flag line, we treat it as a rejoin
                if (line && line.optionFlag === undefined) {
                    nextIndex = i;
                    break;
                }
            }

            if (nextIndex !== -1) {
                this.scriptIndex = nextIndex;
                this.renderScriptLine();
            } else {
                // No reachable line -> this option ends the story immediately
                this.scriptIndex = currentLineIndex; // stay put; UI will show end after render
                this.renderScriptLine();
            }
        },


        // =========================================================================
        // HELPERS (VISUAL & AUDIO)
        // =========================================================================
        getActorInfo(line) {
            const isKorean = (text) => /[\uAC00-\uD7AF]/.test(text || '');

            // --- REQUIREMENT 1: No actor or actorName ---
            // Handles narration lines that should have no speaker info displayed.
            // `line.actor == null` checks for both undefined and null.
            if (line.actor == null && !line.actorName) {
                // Return an object that results in an empty name and no portrait.
                // A distinct ID forces the renderer to clear any previous character's info.
                return { id: 'no-actor', name: '', icon: null };
            }

            // --- REQUIREMENT 2: Only actorName, and it's Korean ---
            // Handles characters who are named but don't have a standard actor entry.
            if (line.actor == null && line.actorName && isKorean(line.actorName)) {
                // Return the specified name with an empty portrait.
                // Using the name as the ID ensures the UI updates if the speaker changes.
                return { id: line.actorName, name: line.actorName, icon: null };
            }


            // --- ORIGINAL LOGIC FOR ALL OTHER CASES ---
            // This existing code will now only run for lines that don't match the special cases above.
            let actorInfo = { id: null, name: '', icon: null };

            // --- Step 1: Establish base actor from `line.actor` ---
            let baseActorId = null;
            if (typeof line.actor === 'number') {
                baseActorId = line.actor;
            } else if (typeof line.actor === 'string') {
                baseActorId = this.shipgirlNameMap[line.actor] || null;
            }

            if (this.shipgirlData[baseActorId]) {
                const char = this.shipgirlData[baseActorId];
                actorInfo = { id: baseActorId, name: char.name, icon: char.icon };
            }

            // --- Step 2: Handle `line.actorName` overrides ---
            if (line.actorName) {
                const actorNameId = parseInt(line.actorName, 10);
                if (!isNaN(actorNameId) && this.shipgirlData[actorNameId]) {
                    const overrideChar = this.shipgirlData[actorNameId];
                    actorInfo.id = actorNameId; // Update ID so UI knows actor changed
                    actorInfo.name = overrideChar.name;
                    actorInfo.icon = overrideChar.icon;
                } else {
                    // For text actorName, use it as both ID and name
                    actorInfo.id = line.actorName;
                    actorInfo.name = line.actorName;
                }
            }

            // --- Step 3: Handle special cases (Commander, Narrator) ---
            if (line.actor === 0 || line.portrait === 'zhihuiguan') {
                actorInfo = { id: 0, name: '지휘관', icon: this.COMMANDER_ICON_PATH };
            } else if (this.config.viewerType === 'world' && line.say && !line.actor && !line.actorName) {
                actorInfo.name = (line.say.includes('·') || line.say.includes('————')) ? 'Narrator' : '지휘관';
                if (actorInfo.name === '지휘관') {
                    actorInfo.icon = this.COMMANDER_ICON_PATH;
                }
            } else if (actorInfo.name === '') {
                actorInfo.name = 'Narrator';
            }

            // --- Step 4: Translate namecode ---
            const nameCodeMatch = String(actorInfo.name).match(/{namecode:(\d+)}/);
            if (nameCodeMatch && this.nameCodeData) {
                const code = nameCodeMatch[1];
                if (this.nameCodeData[code]) {
                    actorInfo.name = this.nameCodeData[code].name;
                }
            }

            // --- Step 5: Clean up names that are just raw IDs ---
            if (!isNaN(parseInt(actorInfo.name, 10)) && String(actorInfo.name).indexOf('{') === -1) {
                actorInfo.name = 'Narrator';
            }

            // --- Step 6: Final icon cleanup for all non-character speakers ---
            const nonCharacterNames = ['Narrator', '통신기', '분석기', '모두들'];
            if (nonCharacterNames.includes(actorInfo.name) || actorInfo.name?.includes('?')) {
                actorInfo.icon = null;
            }

            return actorInfo;
        },

        updateBackground() {
            // Cache the background element on first access
            if (!this.elements.storyBackground) {
                this.elements.storyBackground = this.elements.storyViewerView.querySelector('.story-background');
            }
            const backgroundElement = this.elements.storyBackground;

            // Check if we need to recalculate background (performance optimization)
            if (this.cachedBackground.lastIndex === this.scriptIndex) {
                return; // Background hasn't changed
            }

            // Only scan if current line has background info, otherwise use cached
            const currentLine = this.currentStoryScript[this.scriptIndex];
            const needsRescan = currentLine?.bgName || currentLine?.blackBg !== undefined;

            if (!needsRescan && this.cachedBackground.lastIndex >= 0) {
                // Use cached values
                this.cachedBackground.lastIndex = this.scriptIndex;
                return;
            }

            let backgroundImageUrl = null;
            let isBlackBackground = false;

            // Only scan backwards when necessary
            for (let i = this.scriptIndex; i >= 0; i--) {
                const line = this.currentStoryScript[i];
                if (line) {
                    if (line.blackBg === true) { isBlackBackground = true; break; }
                    if (line.bgName) { backgroundImageUrl = `url('${this.BASE_URL}bg/${line.bgName}.png')`; break; }
                }
            }

            if (!backgroundImageUrl && this.currentStoryDefaultBgUrl) {
                backgroundImageUrl = `url('${this.currentStoryDefaultBgUrl}')`;
            }

            // Update cache
            this.cachedBackground = {
                url: backgroundImageUrl,
                isBlack: isBlackBackground,
                lastIndex: this.scriptIndex
            };

            if (isBlackBackground) {
                backgroundElement.style.backgroundColor = 'black';
                backgroundElement.style.backgroundImage = 'none';
            } else {
                backgroundElement.style.backgroundColor = 'transparent';
                backgroundElement.style.backgroundImage = backgroundImageUrl || 'none';
            }
        },

        // to determine if there is any non-option flag ahead that can be displayed
        hasReachableNextDisplayable() {
            const curr = this.currentStoryScript[this.scriptIndex];

            // If we're currently on an options line, do NOT consider this a path end.
            // We still have pending user choice, so treat it as having a "next".
            if (curr?.options?.length) {
                return true;
            }

            const currFlag = (curr && curr.optionFlag !== undefined) ? curr.optionFlag : null;
            const key = `${this.scriptIndex}_${currFlag}`;
            const navInfo = this.scriptNavCache.navigation[key];
            return navInfo ? navInfo.next !== null : false;
        },

        handleEffect(effects) {
            effects?.forEach(effect => {
                const duration = (effect.duration || 0.5) * 1000;
                switch (effect.type) {
                    case "shake":
                        this.elements.viewerContainer.classList.add('shake');
                        setTimeout(() => this.elements.viewerContainer.classList.remove('shake'), duration);
                        break;
                    case "flash":
                        const flashEl = document.createElement('div');
                        flashEl.className = 'flash';
                        document.body.appendChild(flashEl);
                        setTimeout(() => {
                            if (flashEl.parentNode) {
                                flashEl.parentNode.removeChild(flashEl);
                            }
                        }, 300);
                        break;
                    case "fadeout":
                        if (this.elements.fadeOverlay) {
                            this.elements.fadeOverlay.style.transitionDuration = `${duration / 1000}s`;
                            this.elements.fadeOverlay.classList.add('visible');
                        }
                        break;
                    case "fadein":
                        if (this.elements.fadeOverlay) {
                            this.elements.fadeOverlay.style.transitionDuration = `${duration / 1000}s`;
                            this.elements.fadeOverlay.classList.remove('visible');
                        }
                        break;
                    case "se":
                        if (effect.audio) {
                            // Limit concurrent sound effects to prevent memory issues
                            const MAX_CONCURRENT_SFX = 3;

                            // Clean up finished SFX
                            this.activeSfx = this.activeSfx.filter(sfx => !sfx.ended && !sfx.paused);

                            // If at limit, stop the oldest SFX
                            if (this.activeSfx.length >= MAX_CONCURRENT_SFX) {
                                const oldest = this.activeSfx.shift();
                                oldest.pause();
                                oldest.src = '';
                            }

                            const sfx = new Audio(`${this.BGM_URL_PREFIX}${effect.audio}.ogg`);
                            sfx.volume = this.audio.volume;

                            // Clean up audio resources after playback completes
                            sfx.addEventListener('ended', () => {
                                sfx.src = '';
                                this.activeSfx = this.activeSfx.filter(s => s !== sfx);
                            }, { once: true });

                            this.activeSfx.push(sfx);
                            sfx.play().catch(e => console.warn("SFX playback failed.", e));
                        }
                        break;
                }
            });
        },

        handleBgm(bgmName) {
            if (bgmName) this.elements.audioPlayerContainer?.classList.remove('hidden');
            else this.elements.audioPlayerContainer?.classList.add('hidden');

            if (bgmName && bgmName !== this.currentBgm) {
                this.currentBgm = bgmName;
                this.audio.src = `${this.BGM_URL_PREFIX}${bgmName}.ogg`;
                this.audio.play().catch(e => console.warn("Audio playback failed.", e));
            } else if (!bgmName && this.currentBgm) {
                this.currentBgm = null;
                this.audio.pause();
            }

            if (this.elements.bgmNameSpan) this.elements.bgmNameSpan.textContent = bgmName || '';
            this.updateAudioPlayerUI();
        },

        updateAudioPlayerUI() {
            const el = this.elements;
            if (!el.playPauseBtn || !el.muteBtn || !el.volumeSlider) return;

            // Cache icon elements on first access
            if (!el.playPauseIcon) {
                el.playPauseIcon = el.playPauseBtn.querySelector('.material-symbols-outlined');
            }
            if (!el.muteIcon) {
                el.muteIcon = el.muteBtn.querySelector('.material-symbols-outlined');
            }

            el.playPauseIcon.textContent = this.audio.paused ? 'play_arrow' : 'pause';
            el.muteIcon.textContent = this.audio.muted || this.audio.volume === 0 ? 'volume_off' : 'volume_up';
            el.volumeSlider.value = this.audio.muted ? 0 : this.audio.volume;

            // Toggle waveform animation
            if (el.audioPlayerContainer) {
                el.audioPlayerContainer.classList.toggle('playing', !this.audio.paused);
            }
        },

        showError(message) {
            this.elements.errorContainer.textContent = message;
            this.elements.errorContainer.classList.remove('hidden');
            setTimeout(() => this.elements.errorContainer.classList.add('hidden'), 5000);
        },

        updateProgressIndicator() {
            if (!this.elements.progressIndicator) return;

            const totalLines = this.currentStoryScript.length;
            const currentLine = this.scriptIndex + 1;
            const percentage = Math.round((currentLine / totalLines) * 100);

            this.elements.progressIndicator.innerHTML = `
                <div class="progress-text">${currentLine} / ${totalLines}</div>
                <div class="progress-bar-container">
                    <div class="progress-bar-fill" style="width: ${percentage}%"></div>
                </div>
            `;
        },

        // =========================================================================
        // MODALS
        // =========================================================================
        showFullScript() {
            if (!this.currentStoryScript || this.currentStoryScript.length === 0) return;

            // Use cached script if available
            if (!this.cachedFullScript) {
                this.cachedFullScript = this.currentStoryScript
                    .filter(line => line.say && line.say.trim() !== "")
                    .map(line => {
                        const actorInfo = this.getActorInfo(line);
                        const dialogue = line.say.replace(/<.*?>/g, '');
                        return `<p><strong>${actorInfo.name || 'Narrator'}:</strong> ${dialogue}</p>`;
                    }).join('');
            }

            this.elements.fullScriptContent.innerHTML = this.cachedFullScript;
            this.elements.scriptModalOverlay.classList.remove('hidden');
        },
        hideFullScript() { this.elements.scriptModalOverlay.classList.add('hidden'); },

        showSummaryModal(eventId) {
            const data = this.storylineSummaryData[eventId];
            if (!data) return;
            let keycharHtml = '';
            if (data.keychar && Array.isArray(data.keychar)) {
                keycharHtml = `<h3>${data.keychar[0]}</h3><ul>${data.keychar.slice(1).map(item => `<li>${item}</li>`).join('')}</ul>`;
            }
            this.elements.summaryModalContent.innerHTML = `<h2>${data.title}</h2><p>${data.summary}</p>${keycharHtml}`;
            this.elements.summaryModalOverlay.classList.remove('hidden');
        },
        hideSummaryModal() { this.elements.summaryModalOverlay.classList.add('hidden'); },

    };
});
