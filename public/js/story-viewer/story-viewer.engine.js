/**
 * story-viewer.engine.js
 * Shared story viewer engine for all story viewer pages (main, world, secretary, HOF, child).
 * Exposes window.StoryViewer and is configured by a page-specific init script that calls
 * window.StoryViewer.init(config). The config object provides data paths, data processing,
 * event/memory accessors, and optional overrides for grid population.
 *
 * Concerns handled here: data loading, URL routing, view switching, script navigation
 * (including branching with option flags), background/BGM sync, painting/expression
 * rendering, screen shake/flash effects, SFX playback, auto-play, full-script modal,
 * and all keyboard/pointer event wiring.
 */
import { debounce, fetchJSONWithCache, getUrlParam, setUrlParams, hideElement, showElement, toggleElement, resolveUrl, makeKeyboardActivatable, DATA_FOR_TOY_BASE } from '../utils.js';
document.addEventListener('DOMContentLoaded', () => {
    window.StoryViewer = {
        // ===== State & Constants =====
        config: {}, // Page-specific configuration
        storylineData: {},
        storylineSummaryData: {}, // Only used by world viewer
        shipgirlData: {},
        shipgirlNameMap: {},
        expressionManifest: {}, // Painting/expression data for characters
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

        COMMANDER_ICON_PATH: resolveUrl('assets/icon/commander.webp'),
        BASE_URL: `${DATA_FOR_TOY_BASE}/`,
        // TODO(sub-project-3): de-Fernando audio. BGM hosting moves to data_for_toy_audio
        // when the audio extraction pipeline lands.
        BGM_URL_PREFIX: "https://github.com/Fernando2603/AzurLane/raw/refs/heads/main/audio/bgm/",

        // ===== DOM Elements =====
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
            paintingLayer: document.getElementById('painting-layer'),
            // Cached elements (populated on first access)
            storyBackground: null,
            playPauseIcon: null,
            muteIcon: null,
        },

        // Auto-play state. Speed 0 = disabled; 1/2/3 = slow/medium/fast.
        // Reset to 0 at the start of every story (see startStory) — not
        // persisted across sessions or stories.
        autoPlaySpeed: 0,
        AUTO_PLAY_DELAYS_MS: { 1: 6000, 2: 4000, 3: 2500 },
        _autoPlayTimer: null,

        // Painting state — one painting per side (0=left, 1=right, 2=center).
        // Paintings are rebuilt from the script on every render, matching the
        // game's dialoguestoryplayer.lua. Non-active sides dim to the current
        // step's painting.alpha; the active speaker is always at 1.0.
        paintingsBySide: new Map(), // Map<side:number, {actorId, element, expression, side, dir}>
        activeSpeakerSide: null,
        PAINTING_FADE_OUT_MS: 250,

        // Effect tuning. Shake "speed" in game data is a small-int tier; we map
        // it to a per-cycle duration. Flash duration caps keep runaway 'number:
        // 999' entries from pinning the screen forever.
        SHAKE_DEFAULT_X_PX: 8,
        SHAKE_MAX_TOTAL_MS: 8000,
        FLASH_MAX_TOTAL_MS: 8000,

        // ===== Initialization =====

        /**
         * Bootstrap the engine with a page-specific config.
         * Loads all data, renders the event grid, handles deep-link URL params,
         * and wires all event listeners and the browser back button.
         */
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
                    this.injectAutoPlayButton();
                })
                .catch(error => {
                    console.error('Initialization failed:', error);
                    this.showError('Failed to load critical story data. Please refresh.');
                });
        },

        /**
         * Fetch all data paths declared by config, delegate to config.processLoadedData,
         * populate the shipgirl name map, and load the expression manifest.
         */
        async loadData() {
            const fetchPromises = this.config.dataPaths.map(path => fetchJSONWithCache(path));
            const jsonDataArray = await Promise.all(fetchPromises);

            this.config.processLoadedData(this, jsonDataArray);

            for (const id in this.shipgirlData) {
                this.shipgirlNameMap[this.shipgirlData[id].name] = id;
            }

            try {
                this.expressionManifest = await fetchJSONWithCache('data/skin/expression_manifest.json');
            } catch (e) {
                console.warn('Could not load expression manifest:', e);
            }
        },

        // ===== Event Listeners =====

        /**
         * Wire all DOM event listeners for search, navigation buttons, story
         * interaction, modals, and the audio player.
         */
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

            el.storyViewerView?.addEventListener('click', (e) => {
                if (e.target.closest('.option-button, .nav-button, .story-nav-btn, .audio-player-container, .theme-toggle')) return;
                if (el.optionsBox.children.length === 0) this.advanceStory();
            });
            el.prevLineBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.goBackStory(); });
            el.nextLineBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.advanceStory(); });
            el.nextStoryBtn?.addEventListener('click', (e) => { e.stopPropagation(); if (this.nextMemory) this.startStory(this.nextMemory); });
            el.returnBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.returnToMemorySelection(); });

            el.viewScriptBtn?.addEventListener('click', () => this.showFullScript());
            el.closeModalBtn?.addEventListener('click', () => this.hideFullScript());
            el.scriptModalOverlay?.addEventListener('click', (e) => { if (e.target === el.scriptModalOverlay) this.hideFullScript(); });
            el.closeSummaryModalBtn?.addEventListener('click', () => this.hideSummaryModal());
            el.summaryModalOverlay?.addEventListener('click', (e) => { if (e.target === el.summaryModalOverlay) this.hideSummaryModal(); });

            el.playPauseBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.audio.paused ? this.audio.play().catch(console.warn) : this.audio.pause(); });
            el.muteBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.audio.muted = !this.audio.muted; this.updateAudioPlayerUI(); });
            el.volumeSlider?.addEventListener('input', (e) => { e.stopPropagation(); this.audio.volume = e.target.value; this.audio.muted = e.target.value == 0; this.updateAudioPlayerUI(); });

            this.cleanupAudioListeners();

            // Keyboard navigation (only when the story viewer pane is active
            // and the user isn't typing into an input).
            this.setupKeyboardNavigation();
        },

        /** Return true when the story viewer pane is visible (not in event/memory selection). */
        isStoryViewActive() {
            const v = this.elements.storyViewerView;
            if (!v) return false;
            // switchView toggles display:none/flex via the standard 'hidden' class;
            // fall back to a computed style check so we work either way.
            if (v.classList.contains('hidden')) return false;
            return v.offsetParent !== null;
        },

        /**
         * Register the document-level keydown handler for story navigation.
         * Replaces any previously registered handler so re-calls are safe.
         * Arrow keys / Space advance or rewind; Escape returns to memory selection;
         * 'A' toggles auto-play; 'S' opens the full-script modal.
         */
        setupKeyboardNavigation() {
            if (this._keydownHandler) {
                document.removeEventListener('keydown', this._keydownHandler);
            }
            this._keydownHandler = (e) => {
                // Don't steal keys from form inputs, textareas, or contenteditable.
                const t = e.target;
                if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

                // If a modal is open, let Escape close it but ignore other keys.
                const scriptOpen = !this.elements.scriptModalOverlay?.classList.contains('hidden');
                const summaryOpen = !this.elements.summaryModalOverlay?.classList.contains('hidden');
                if (scriptOpen || summaryOpen) {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        if (scriptOpen) this.hideFullScript();
                        if (summaryOpen) this.hideSummaryModal();
                    }
                    return;
                }

                if (!this.isStoryViewActive()) return;

                const hasOptions = this.elements.optionsBox?.children.length > 0;

                switch (e.key) {
                    case ' ':
                    case 'ArrowRight':
                    case 'Enter':
                        // While options are displayed, let the user pick with a click;
                        // don't auto-advance past a decision point.
                        if (hasOptions) return;
                        e.preventDefault();
                        this.advanceStory();
                        break;
                    case 'ArrowLeft':
                        e.preventDefault();
                        this.goBackStory();
                        break;
                    case 'Escape':
                        e.preventDefault();
                        this.returnToMemorySelection();
                        break;
                    case 'a':
                    case 'A':
                        // Reserved for auto-play toggle.
                        if (typeof this.toggleAutoPlay === 'function') {
                            e.preventDefault();
                            this.toggleAutoPlay();
                        }
                        break;
                    case 's':
                    case 'S':
                        e.preventDefault();
                        this.showFullScript();
                        break;
                }
            };
            document.addEventListener('keydown', this._keydownHandler);
        },

        // ===== Auto-Play =====

        /**
         * Create the auto-play button and insert it into the story nav-arrows
         * container. No-op if the container is missing or the button already exists.
         */
        injectAutoPlayButton() {
            // Find the nav-arrows container in whichever story page this engine is mounted on.
            const navArrows = this.elements.storyViewerView?.querySelector('.story-nav-arrows');
            if (!navArrows || document.getElementById('auto-play-btn')) return;

            const btn = document.createElement('button');
            btn.id = 'auto-play-btn';
            btn.className = 'story-nav-btn auto-play-btn';
            btn.type = 'button';
            btn.title = '자동 재생 (A)';
            navArrows.insertBefore(btn, navArrows.firstChild);

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleAutoPlay();
            });

            this.elements.autoPlayBtn = btn;
            this.updateAutoPlayButton();
        },

        /** Sync the auto-play button label and aria-pressed to the current speed tier. */
        updateAutoPlayButton() {
            const btn = this.elements.autoPlayBtn;
            if (!btn) return;
            const label = ['자동', '자동 (느림)', '자동 (보통)', '자동 (빠름)'][this.autoPlaySpeed] || '자동';
            btn.textContent = label;
            btn.classList.toggle('active', this.autoPlaySpeed > 0);
            btn.setAttribute('aria-pressed', String(this.autoPlaySpeed > 0));
        },

        /** Cycle auto-play speed: off → slow → medium → fast → off. */
        toggleAutoPlay() {
            // Cycle off → slow → medium → fast → off.
            this.autoPlaySpeed = (this.autoPlaySpeed + 1) % 4;
            this.updateAutoPlayButton();
            this.cancelAutoAdvance();
            if (this.autoPlaySpeed > 0) this.scheduleAutoAdvance();
        },

        /**
         * Queue the next auto-advance after the delay for the current speed tier.
         * Cancels any pending timer first. No-op when the story view is hidden,
         * options are showing, or there is no next reachable line.
         */
        scheduleAutoAdvance() {
            this.cancelAutoAdvance();
            if (this.autoPlaySpeed <= 0) return;

            // Don't schedule if we're on an options line, at path end, or if the
            // story view isn't visible.
            if (!this.isStoryViewActive()) return;
            const optionsShowing = this.elements.optionsBox?.children.length > 0;
            if (optionsShowing) return;
            if (!this.hasReachableNextDisplayable()) return;

            const delay = this.AUTO_PLAY_DELAYS_MS[this.autoPlaySpeed] || 4000;
            this._autoPlayTimer = setTimeout(() => {
                this._autoPlayTimer = null;
                // Guard again at fire time — state may have changed.
                if (this.autoPlaySpeed <= 0) return;
                if (!this.isStoryViewActive()) return;
                if (this.elements.optionsBox?.children.length > 0) return;
                this.advanceStory();
            }, delay);
        },

        /** Clear the pending auto-advance timer, if any. */
        cancelAutoAdvance() {
            if (this._autoPlayTimer != null) {
                clearTimeout(this._autoPlayTimer);
                this._autoPlayTimer = null;
            }
        },

        /**
         * Handle browser back/forward navigation via the History API popstate event.
         * Restores story or memory-selection state from the history entry's state object.
         */
        setupBrowserBackButton() {
            window.addEventListener('popstate', async (e) => {
                if (e.state) {
                    // User pressed back with saved state
                    const { eventId, storyId } = e.state;
                    if (eventId && storyId) {
                        // Restore story view
                        await this.selectEvent(eventId, false);
                        const eventData = this.storylineData[eventId];
                        const memoryData = this.config.findMemory(eventData, storyId);
                        if (memoryData) {
                            this.startStory(memoryData, false);
                        }
                    } else if (eventId) {
                        // Restore memory selection view
                        await this.selectEvent(eventId, false);
                    }
                } else {
                    // User pressed back to initial state
                    this.switchView(this.elements.eventSelectionView);
                }
            });
        },

        /**
         * Replace the audio element's play/pause listeners with fresh ones.
         * Called by setupEventListeners to avoid stacking duplicate handlers
         * if init() is somehow called more than once.
         */
        cleanupAudioListeners() {
            if (this.audioPlayHandler) {
                this.audio.removeEventListener('play', this.audioPlayHandler);
            }
            if (this.audioPauseHandler) {
                this.audio.removeEventListener('pause', this.audioPauseHandler);
            }

            this.audioPlayHandler = () => this.updateAudioPlayerUI();
            this.audioPauseHandler = () => this.updateAudioPlayerUI();

            this.audio.addEventListener('play', this.audioPlayHandler);
            this.audio.addEventListener('pause', this.audioPauseHandler);
        },

        // ===== URL & View Management =====

        /** Push or replace the URL to reflect the current event/story selection. */
        updateUrl(eventId, storyId, clear = false) {
            if (clear) {
                history.pushState({}, '', window.location.pathname);
                return;
            }
            setUrlParams({
                eventid: eventId || null,
                story: storyId || null
            }, { replace: false });
        },

        /**
         * Read `eventid` and `story` URL params on initial load and open the
         * matching event or story directly, bypassing the selection grids.
         */
        async handleUrlParameters() {
            const eventId = getUrlParam('eventid'); // Consistently use lowercase 'eventid'
            const storyId = getUrlParam('story');

            if (eventId && this.storylineData[eventId]) {
                await this.selectEvent(eventId, false);
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

        /**
         * Show one of the three views (event grid / memory grid / story viewer)
         * and hide the other two. Also pauses audio and cancels auto-play when
         * leaving the story viewer pane.
         */
        switchView(viewToShow, scrollToTop = true) {
            [this.elements.eventSelectionView, this.elements.memorySelectionView, this.elements.storyViewerView].forEach(view => {
                if (view) toggleElement(view, view === viewToShow);
            });

            if (scrollToTop) {
                window.scrollTo(0, 0);
            }

            if (viewToShow !== this.elements.storyViewerView) {
                this.audio.pause();
                hideElement(this.elements.audioPlayerContainer);
                this.cancelAutoAdvance();
            }
        },

        /**
         * Lazy-load full chapter data for a specific event.
         * Only fetches if the chapter hasn't been loaded yet (no memory_id).
         * Requires config.chapterDataPath to be set.
         * @param {string} eventId - The chapter/event ID
         * @returns {Promise<Object>} - The full chapter data
         */
        async loadChapterData(eventId) {
            // If full data already loaded (has memory_id), return it
            if (this.storylineData[eventId]?.memory_id) {
                return this.storylineData[eventId];
            }

            if (!this.config.chapterDataPath) {
                return this.storylineData[eventId];
            }

            const chapterUrl = this.config.chapterDataPath.replace('{id}', eventId);
            const fullChapter = await fetchJSONWithCache(chapterUrl);

            this.storylineData[eventId] = { ...this.storylineData[eventId], ...fullChapter };
            return this.storylineData[eventId];
        },

        // ===== UI Population & Navigation =====

        /**
         * Render the event/chapter grid, optionally filtered by a search term.
         * Shows skeleton cards while data is loading (empty storylineData).
         * Called on init and on search input; also called by the secretary-story
         * page's filter logic after it re-renders via renderEventEntries.
         */
        populateEventGrid(searchTerm = '') {
            this.elements.eventGrid.textContent = '';
            const filteredEvents = Object.entries(this.storylineData)
                .filter(([key, event]) => event.name.toLowerCase().includes((searchTerm || '').toLowerCase()));

            if (filteredEvents.length === 0 && Object.keys(this.storylineData).length === 0) {
                for (let i = 0; i < 6; i++) {
                    const skeletonCard = this.createSkeletonCard();
                    this.elements.eventGrid.appendChild(skeletonCard);
                }
                return;
            }

            filteredEvents.forEach(([key, event]) => {
                const eventId = event.id || key;
                const specialLink = this.config.getEventLink ? this.config.getEventLink(event) : null;
                const subtitle = specialLink
                    ? '대형작전 스토리 뷰어에서 확인하세요'
                    : (event.description || `Chapter: ${event.name.replace(/[^0-9]/g, '')}`);

                const card = this.createCard(
                    event.name,
                    subtitle,
                    event.icon,
                    this.config.getEventIconPath(event),
                    () => {
                        if (specialLink) {
                            window.location.href = specialLink;
                            return;
                        }
                        this.selectEvent(eventId);
                    }
                );

                if (specialLink) {
                    card.classList.add('world-story-link');
                }
                this.elements.eventGrid.appendChild(card);
            });
        },

        /** Return a CSS-animated skeleton placeholder card for the loading state. */
        createSkeletonCard() {
            const card = document.createElement('div');
            card.className = 'grid-card skeleton-card';
            const thumbnail = document.createElement('div');
            thumbnail.className = 'card-thumbnail skeleton-thumbnail';
            const content = document.createElement('div');
            content.className = 'card-content';
            const title = document.createElement('div');
            title.className = 'skeleton-title';
            const subtitle = document.createElement('div');
            subtitle.className = 'skeleton-subtitle';
            content.append(title, subtitle);
            card.append(thumbnail, content);
            return card;
        },

        /**
         * Build a clickable grid card DOM element. The icon URL is resolved from
         * a base path + filename unless it is already an absolute URL or a local
         * asset path. Used for both event and memory grid cards.
         */
        createCard(title, subtitle, icon, pathPrefix, onClick, id = null) {
            const card = document.createElement('div');
            card.className = 'grid-card';
            if (id) card.dataset.id = id;

            const thumbnail = document.createElement('div');
            thumbnail.className = 'card-thumbnail';
            if (icon) {
                const imageUrl = icon.startsWith('http') || icon.startsWith('data:image') || icon.includes('assets/')
                    ? icon
                    : `${pathPrefix}${icon}.webp`;
                thumbnail.style.backgroundImage = `url("${imageUrl}")`;
            } else {
                thumbnail.classList.add('is-placeholder');
            }

            const content = document.createElement('div');
            content.className = 'card-content';
            const titleEl = document.createElement('h3');
            titleEl.className = 'card-title';
            titleEl.textContent = title || '';
            const subtitleEl = document.createElement('p');
            subtitleEl.className = 'card-subtitle';
            subtitleEl.textContent = subtitle || '';
            content.append(titleEl, subtitleEl);
            card.append(thumbnail, content);

            makeKeyboardActivatable(card, onClick);
            return card;
        },

        /**
         * Navigate to the memory-selection view for the given event/chapter.
         * Lazy-loads full chapter data if only index metadata is available,
         * delegates extras injection to config.populateMemoryGridExtras, and
         * renders the memory card list via config.getEventMemories.
         */
        async selectEvent(eventId, updateUrl = true) {
            this.currentEventId = eventId;

            const eventData = await this.loadChapterData(eventId);
            this.elements.memoryViewTitle.textContent = eventData.name;
            this.elements.memoryGrid.textContent = '';

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
        },

        /**
         * Return to the memory-selection view without scrolling to top, and
         * highlight the next memory card (if any) so the user can see where
         * they left off.
         */
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

        // ===== Navigation Cache =====

        /**
         * Precompute next/prev reachable line indices for every (index, flagContext)
         * pair in the current story script. Stored in this.scriptNavCache so that
         * advanceStory, goBackStory, and hasReachableNextDisplayable are O(1)
         * lookups instead of per-render linear scans.
         */
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
                // Also track flags introduced by option buttons — these are the
                // flags the user can select, and handleOptionSelect will use them
                // as the navigation context key.
                if (hasOptions) {
                    for (const opt of line.options) {
                        if (opt && opt.flag !== undefined) flagSet.add(opt.flag);
                    }
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

        // ===== Story Player Logic =====

        /**
         * Initialize and begin playing a memory (story script). Resets all per-
         * story state (script index, paintings, background cache, auto-play),
         * preloads the first background image, builds the navigation cache, and
         * switches to the story viewer pane.
         */
        async startStory(memory, updateUrl = true) {
            let story;
            try {
                const result = this.config.getMemoryStory(memory);
                if (result instanceof Promise) {
                    // Show loading state (reuse fade overlay or a specific spinner if available)
                    showElement(this.elements.fadeOverlay, true);
                    story = await result;
                    hideElement(this.elements.fadeOverlay, true);
                } else {
                    story = result;
                }
            } catch (error) {
                console.error("Failed to load story:", error);
                this.showError("Failed to load story data.");
                hideElement(this.elements.fadeOverlay, true);
                return;
            }

            if (!story?.scripts) {
                this.showError("This story is not available.");
                return;
            }

            hideElement(this.elements.fadeOverlay, true);

            this.currentStoryScript = story.scripts;
            this.currentMemoryId = memory.id;
            this.scriptIndex = 0;
            this.lastActorId = null;
            this.currentBgm = null;
            this.currentStoryDefaultBgUrl = null;
            this.activeOptionFlag = null;

            // Auto-play resets to OFF at the start of every story. Carrying
            // the previous story's auto state over surprised users, and a
            // persistent "active" state combined with poor dark-mode contrast
            // made the button look like it had disappeared.
            this.autoPlaySpeed = 0;
            this.cancelAutoAdvance();
            this.updateAutoPlayButton();
            this.lastOptionIndex = -1;

            // Clear any existing paintings from previous story
            this.clearPaintings();


            // Reset caches for new story
            this.cachedBackground = {
                url: null,
                isBlack: false,
                lastIndex: -1
            };
            this.scriptNavCache = null;
            this.cachedFullScript = null;

            if (memory.mask) {
                this.currentStoryDefaultBgUrl = `${this.BASE_URL}${memory.mask}.webp`;
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

            const imagesToPreload = new Set();
            if (this.currentStoryDefaultBgUrl) imagesToPreload.add(this.currentStoryDefaultBgUrl);
            const firstBgLine = this.currentStoryScript.find(line => line.bgName);
            if (firstBgLine) imagesToPreload.add(`${this.BASE_URL}bg/${firstBgLine.bgName}.webp`);
            imagesToPreload.forEach(src => { new Image().src = src; });

            this.buildNavigationCache();

            this.renderScriptLine();
            this.switchView(this.elements.storyViewerView);
        },

        /**
         * Return true if a script line should be presented as a navigable step.
         * Lines with no visible content and no scene transition are skipped by
         * the nav cache so the user never lands on a blank dialogue state.
         */
        isLineDisplayable(line) {
            if (!line) return false;
            // A line is a "step" the user should navigate through if it has
            // ANY visible content OR a scene transition. Terminal visual-only
            // steps (e.g., chapter 9 memory 797 line 14: empty sequence text
            // but flashout/flashin + IronBloodLogoEffect) are part of the
            // game's step sequence and must be reachable so the user can see
            // the outro transition instead of getting stranded one step early.
            return !!(
                line.say ||
                (line.sequence && line.sequence[0] && line.sequence[0][0]) ||
                (line.signDate && line.signDate[0]) ||
                (line.options && line.options.length > 0) ||
                line.flashin || line.flashout
            );
        },

        /**
         * Advance to the next reachable displayable line in the current branch context.
         * Sets _playFlashOnNextRender so flash/shake effects trigger on forward nav only.
         */
        advanceStory() {
            if (this.scriptIndex >= this.currentStoryScript.length - 1) return;

            const currentLine = this.currentStoryScript[this.scriptIndex];
            const flagContext = (currentLine && currentLine.optionFlag !== undefined) ? currentLine.optionFlag : null;
            const key = `${this.scriptIndex}_${flagContext}`;
            const navInfo = this.scriptNavCache.navigation[key];

            if (navInfo && navInfo.next !== null) {
                this.scriptIndex = navInfo.next;
                // Only forward advance replays flash curtains — backward nav,
                // resume, and jumps should NOT re-trigger blackouts.
                this._playFlashOnNextRender = true;
                this.renderScriptLine();
            } else {
                // At end of reachable path
                this.renderScriptLine();
            }
        },

        /**
         * Move to the previous reachable displayable line, respecting the active
         * branch context. Crossing back over a decision point (lastOptionIndex)
         * exits branch mode and returns to the options line.
         */
        goBackStory() {
            if (this.scriptIndex <= 0) return;

            const currentLine = this.currentStoryScript[this.scriptIndex];
            let flagContext;

            if (this.activeOptionFlag !== null) {
                flagContext = this.activeOptionFlag;
            } else {
                flagContext = (currentLine && currentLine.optionFlag !== undefined) ? currentLine.optionFlag : null;
            }

            const key = `${this.scriptIndex}_${flagContext}`;
            const navInfo = this.scriptNavCache.navigation[key];

            if (navInfo && navInfo.prev !== null) {
                if (this.activeOptionFlag !== null && navInfo.prev <= this.lastOptionIndex) {
                    // Crossed the decision point — exit branch mode and land on the options line.
                    this.activeOptionFlag = null;
                    this.scriptIndex = this.lastOptionIndex;
                } else {
                    this.scriptIndex = navInfo.prev;
                }
                this.renderScriptLine();
            }
        },


        /**
         * Render the current script line to the DOM. Updates background, BGM, paintings,
         * dialogue/sequence content, navigation button states, option buttons, the
         * branch-end hint, progress indicator, and schedules the next auto-advance.
         * This is the central render function called after every index change.
         */
        renderScriptLine() {
            if (this.scriptIndex >= this.currentStoryScript.length) return;
            const line = this.currentStoryScript[this.scriptIndex];
            const el = this.elements;

            el.optionsBox.textContent = '';
            hideElement(el.dialogueBox);
            hideElement(el.infoScreen);
            el.infoScreenText.textContent = '';

            this.updateBackground();
            // Line-level visual/audio effects (game's per-step playback).
            // Gated to forward-advance only (same rule as flashout/flashin) —
            // replaying shake/flash/sfx on backward nav feels like the story is
            // resetting on the user. Jumps & resumes also skip. We still cancel
            // any in-flight effects so a mid-animation escape doesn't linger.
            //   line.shakeTime — full-screen shake (rare, dramatic moments)
            //   line.shake — painting shake (NOT screen shake; storymgr.lua:991)
            //   line.dialogShake — dialogue box shake
            //   line.action[].type="shake" — painting/portrait shake
            //   line.flashN    — color blink sequence (white/red/etc)
            //   line.soundeffect + line.seDelay — SFX with delay
            //   line.effects[] — named GameObject overlays (ignored: assets not
            //                    available as web resources)
            if (this._playFlashOnNextRender) {
                this.handleLineShake(line);
                this.handleLineDialogShake(line);
                this.handleLinePaintingShake(line);
                this.handleLineFlashN(line);
                this.handleLineSoundEffect(line);
            } else {
                this.clearLineEffects();
            }
            // Re-sync BGM from the script position (not just the current line)
            // so back-navigation and resume jumps land on the correct track.
            this.updateBgm();
            // flashin/flashout are top-level fields that bracket the step with a
            // black (or white) curtain — independent from the `effects` array.
            // Only replay curtains on natural forward advance (set by
            // advanceStory) — backward nav, jumps, and resumes should NOT
            // retrigger blackouts the user has already seen. We still clear
            // any lingering flash overlay on non-advance renders so the screen
            // doesn't stay black if we jumped away mid-animation.
            if (this._playFlashOnNextRender) {
                this._playFlashOnNextRender = false;
                this.handleLineFlash(line);
            } else {
                this._playFlashOnNextRender = false;
                this.clearFlashOverlay();
            }

            // Painting state is rebuilt from the full script history so that
            // forward AND backward navigation always land on the same visual
            // state the game would show at this step.
            this.updatePaintings();

            const hasSequenceContent = this.renderSequenceContent(line);

            if (hasSequenceContent) {
                // Sequence overlay is rendered by renderSequenceContent
            } else if (line.say) {
                showElement(el.dialogueBox);

                // Handle text formatting based on viewer type
                if (this.config.viewerType === 'main') {
                    this.renderColoredDialogue(el.dialogueText, line.say);
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

                    let portraitIcon = actorInfo.icon;
                    if (typeof line.actor === 'number' && line.actor > 0) {
                        const expressionData = this.getExpressionData(line.actor);
                        if (expressionData) {
                            const expression = line.expression !== undefined ? String(line.expression) : '0';
                            portraitIcon = expressionData.faceUrlTemplate.replace('{faceId}', expression);
                        }
                    }

                    if (portraitIcon) {
                        const img = document.createElement('img');
                        img.src = portraitIcon;
                        img.alt = actorInfo.name;
                        img.onerror = () => {
                            if (actorInfo.icon && img.src !== actorInfo.icon) {
                                img.src = actorInfo.icon;
                            } else {
                                hideElement(el.actorPortrait);
                            }
                        };
                        el.actorPortrait.textContent = '';
                        el.actorPortrait.appendChild(img);
                        showElement(el.actorPortrait);
                    } else {
                        el.actorPortrait.textContent = '';
                        hideElement(el.actorPortrait);
                    }
                }

                if (line.nameColor) {
                    el.actorName.style.color = line.nameColor;
                } else {
                    el.actorName.style.color = '';
                }

                el.actorPortrait.classList.toggle('actor-shadow', line.actorShadow === true);

                this.lastActorId = actorInfo.id;
            }

            const hasOptions = line.options && line.options.length > 0;
            const isAtFileEnd = this.scriptIndex >= this.currentStoryScript.length - 1;
            el.prevLineBtn.disabled = (this.scriptIndex <= 0);

            const nextDisplayableExists = this.hasReachableNextDisplayable();
            const isAtPathEnd = !nextDisplayableExists;

            toggleElement(el.nextLineBtn, !(hasOptions || !nextDisplayableExists));
            toggleElement(el.returnBtn, isAtFileEnd || isAtPathEnd);

            // If the user has reached the end of a branch (but not the end of the
            // script), surface a hint so they know they can rewind and try the
            // other choice. We distinguish "end of branch" from "end of file" by
            // checking whether there are actually unreachable lines beyond us.
            const isBranchDeadEnd = isAtPathEnd && !isAtFileEnd && !hasOptions;
            this.setBranchEndHint(isBranchDeadEnd);

            toggleElement(el.nextStoryBtn, (isAtFileEnd || isAtPathEnd) && this.nextMemory);
            toggleElement(el.nextPageIndicator, !(isAtPathEnd || hasOptions));

            this.updateProgressIndicator();

            if (hasOptions) {
                line.options.forEach(opt => {
                    const button = document.createElement('button');
                    button.className = 'option-button';
                    button.type = 'button';
                    button.textContent = opt.content.replace(/<.*?>/g, '');
                    button.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.handleOptionSelect(opt.flag);
                    });
                    el.optionsBox.appendChild(button);
                });
            }

            this.scheduleAutoAdvance();
        },

        /**
         * Show/hide a small hint element near the dialogue area when the user
         * has reached the end of a branch but the story has more content behind
         * other choices. Injected once, then toggled.
         */
        setBranchEndHint(show) {
            let hint = this.elements.branchEndHint;
            if (!hint && show) {
                hint = document.createElement('div');
                hint.id = 'branch-end-hint';
                hint.className = 'branch-end-hint';
                hint.textContent = '이 분기의 끝입니다. 뒤로 가서 다른 선택을 해보세요.';
                // Mount below the dialogue box; fall back to viewerContainer.
                const host = this.elements.dialogueBox?.parentNode || this.elements.viewerContainer;
                host?.appendChild(hint);
                this.elements.branchEndHint = hint;
            }
            if (hint) {
                toggleElement(hint, !!show);
            }
        },

        /**
         * Record the player's choice at a branching decision point, set the active
         * flag context, and navigate to the first reachable line in the chosen branch.
         */
        handleOptionSelect(chosenFlag) {
            const currentLineIndex = this.scriptIndex;
            const currentLine = this.currentStoryScript[currentLineIndex];
            const optionCount = currentLine.options ? currentLine.options.length : 0;

            this.lastOptionIndex = currentLineIndex;
            this.activeOptionFlag = (optionCount >= 1) ? chosenFlag : null;

            const key = `${currentLineIndex}_${this.activeOptionFlag}`;
            const navInfo = this.scriptNavCache?.navigation?.[key];

            if (navInfo && navInfo.next !== null) {
                this.scriptIndex = navInfo.next;
                // Treat option selection as a forward advance so flash curtains baked
                // into the first line of the chosen branch play on the natural path.
                this._playFlashOnNextRender = true;
                this.renderScriptLine();
            } else {
                // No reachable line — this branch ends immediately; render to show end state.
                this.scriptIndex = currentLineIndex;
                this.renderScriptLine();
            }
        },

        /**
         * Render sequence/signDate overlay text (fullscreen title cards) to the
         * info-screen element. Returns true when content was rendered so the caller
         * knows to skip the normal dialogue path.
         */
        renderSequenceContent(line) {
            const sequences = this.extractSequenceLines(line);
            if (sequences.length === 0) return false;

            const el = this.elements;
            el.infoScreenText.textContent = '';

            sequences.forEach(sequenceLine => {
                const lineEl = document.createElement('span');
                lineEl.className = 'sequence-line';
                lineEl.textContent = sequenceLine.text;
                if (sequenceLine.scale !== 1) {
                    lineEl.style.setProperty('--sequence-scale', sequenceLine.scale);
                } else {
                    lineEl.style.removeProperty('--sequence-scale');
                }
                el.infoScreenText.appendChild(lineEl);
            });

            showElement(el.infoScreen);
            return true;
        },

        /**
         * Extract formatted text entries from a line's sequence or signDate field.
         * Returns an array of {text, scale} objects for renderSequenceContent.
         */
        extractSequenceLines(line) {
            if (!line) return [];

            const collected = [];

            if (Array.isArray(line.sequence) && line.sequence.length > 0) {
                line.sequence.forEach(entry => {
                    const rawText = Array.isArray(entry) ? entry[0] : entry;
                    const formatted = this.formatSequenceLine(rawText);
                    if (formatted.text) collected.push(formatted);
                });
            } else if (typeof line.sequence === 'string') {
                const formatted = this.formatSequenceLine(line.sequence);
                if (formatted.text) collected.push(formatted);
            } else if (Array.isArray(line.signDate) && line.signDate[0]) {
                const formatted = this.formatSequenceLine(line.signDate[0]);
                if (formatted.text) collected.push(formatted);
            }

            return collected;
        },

        /**
         * Render dialogue text with <color=#XXX>...</color> tags into a target
         * element using DOM nodes (no innerHTML). Text inside color tags is
         * inserted via textContent, so any other HTML in the raw data is
         * treated as plain text. Only hex color values that match the pattern
         * are applied.
         */
        renderColoredDialogue(target, rawSay) {
            target.textContent = '';
            if (!rawSay || typeof rawSay !== 'string') return;

            const stripTags = (s) => s.replace(/<\/?[^>]+>/g, '');
            const colorRe = /<color=(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})>([\s\S]*?)<\/color>/gi;

            let lastIdx = 0;
            let match;
            while ((match = colorRe.exec(rawSay)) !== null) {
                if (match.index > lastIdx) {
                    target.appendChild(document.createTextNode(
                        stripTags(rawSay.slice(lastIdx, match.index))
                    ));
                }
                const span = document.createElement('span');
                span.style.color = match[1];
                span.textContent = stripTags(match[2]);
                target.appendChild(span);
                lastIdx = match.index + match[0].length;
            }
            if (lastIdx < rawSay.length) {
                target.appendChild(document.createTextNode(
                    stripTags(rawSay.slice(lastIdx))
                ));
            }
        },

        /**
         * Parse a raw sequence text entry — strip HTML tags and map any `<size=N>`
         * tags to a CSS scale factor clamped to [0.7, 1.6].
         */
        formatSequenceLine(rawText) {
            if (!rawText || typeof rawText !== 'string') return { text: '', scale: 1 };

            const sizeMatch = rawText.match(/<size=([0-9]+)>/i);
            let scale = 1;
            if (sizeMatch) {
                const sizeValue = parseFloat(sizeMatch[1]);
                if (Number.isFinite(sizeValue) && sizeValue > 0) {
                    const normalized = sizeValue / 50;
                    scale = Math.min(Math.max(normalized, 0.7), 1.6);
                }
            }

            const cleanedText = rawText
                .replace(/<size=\d+>/gi, '')
                .replace(/<\/size>/gi, '')
                .replace(/<\/?[^>]+>/g, '')
                .trim();

            return { text: cleanedText, scale };
        },


        // ===== Helpers: Visual & Audio =====

        /**
         * Resolve display info (id, name, icon) for a script line's speaker.
         * Handles the many ways the game identifies actors: numeric IDs, string
         * names, actorName overrides, Commander (actor 0), world-viewer Narrator,
         * {namecode:N} placeholders, and pure narration lines with no speaker.
         */
        getActorInfo(line) {
            const isKorean = (text) => /[\uAC00-\uD7AF]/.test(text || '');

            // Narration: no actor or actorName. A distinct ID forces the renderer
            // to clear the previous character's portrait.
            if (line.actor == null && !line.actorName) {
                return { id: 'no-actor', name: '', icon: null };
            }

            // Named character with no numeric actor ID — show name, no portrait.
            // Using the name as ID ensures the UI updates when the speaker changes.
            if (line.actor == null && line.actorName && isKorean(line.actorName)) {
                return { id: line.actorName, name: line.actorName, icon: null };
            }

            let actorInfo = { id: null, name: '', icon: null };

            // Step 1: Base actor from line.actor
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

            // Step 2: actorName overrides
            if (line.actorName) {
                const actorNameId = parseInt(line.actorName, 10);
                if (!isNaN(actorNameId) && this.shipgirlData[actorNameId]) {
                    const overrideChar = this.shipgirlData[actorNameId];
                    actorInfo.id = actorNameId;
                    actorInfo.name = overrideChar.name;
                    actorInfo.icon = overrideChar.icon;
                } else {
                    actorInfo.id = line.actorName;
                    actorInfo.name = line.actorName;
                }
            }

            // Step 3: Special cases — Commander, world-viewer Narrator
            if ((line.actor === 0 || line.portrait === 'zhihuiguan') && !line.actorName) {
                actorInfo = { id: 0, name: '지휘관', icon: this.COMMANDER_ICON_PATH };
            } else if (this.config.viewerType === 'world' && line.say && !line.actor && !line.actorName) {
                actorInfo.name = (line.say.includes('·') || line.say.includes('————')) ? 'Narrator' : '지휘관';
                if (actorInfo.name === '지휘관') {
                    actorInfo.icon = this.COMMANDER_ICON_PATH;
                }
            } else if (actorInfo.name === '') {
                actorInfo.name = 'Narrator';
            }

            // Step 4: Translate {namecode:N} placeholders
            const nameCodeMatch = String(actorInfo.name).match(/{namecode:(\d+)}/);
            if (nameCodeMatch && this.nameCodeData) {
                const code = nameCodeMatch[1];
                if (this.nameCodeData[code]) {
                    actorInfo.name = this.nameCodeData[code].name;
                }
            }

            // Step 5: Numeric-only names are raw IDs with no translation — show as Narrator
            if (!isNaN(parseInt(actorInfo.name, 10)) && String(actorInfo.name).indexOf('{') === -1) {
                actorInfo.name = 'Narrator';
            }

            // Step 6: Clear portrait for non-character speakers
            const nonCharacterNames = ['Narrator', '통신기', '분석기', '모두들'];
            if (nonCharacterNames.includes(actorInfo.name) || actorInfo.name?.includes('?')) {
                actorInfo.icon = null;
            }

            return actorInfo;
        },

        /**
         * Apply the background for the current script line. Mirrors the game's
         * Reset()+UpdateBg() flow: each step uses only THIS line's bgName/blackBg,
         * falling back to the memory's default mask. Backward nav and resume jumps
         * therefore always show the correct background rather than whatever was
         * last rendered. Short-circuits if the index hasn't changed.
         */
        updateBackground() {
            // Cache the background element on first access
            if (!this.elements.storyBackground) {
                this.elements.storyBackground = this.elements.storyViewerView.querySelector('.story-background');
            }
            const backgroundElement = this.elements.storyBackground;

            // Short-circuit if we're rendering the same index we just rendered.
            if (this.cachedBackground.lastIndex === this.scriptIndex) {
                return;
            }

            // Per-step bg resolution — matches the game's Reset()+UpdateBg() flow
            // (storyplayer.lua:1085-1123). Reset() deactivates bgPanel/curtain on
            // every step entry, and UpdateBg() only re-activates them if THIS step
            // defines bgName / blackBg. If neither is set, the scene falls back to
            // the memory's default mask (what shows through the inactive panels).
            //
            // The old implementation scanned backward for the most recent bgName,
            // which is wrong: it left stale backgrounds on lines that were meant
            // to revert to the memory default (e.g., chapter 9 memory 804 lines
            // 67-69 should show the memory mask, not bg_bsm_1 from line 66).
            const line = this.currentStoryScript[this.scriptIndex];
            let backgroundImageUrl = null;
            let isBlackBackground = false;

            if (line) {
                if (line.blackBg === true) {
                    isBlackBackground = true;
                } else if (line.bgName) {
                    backgroundImageUrl = `url('${this.BASE_URL}bg/${line.bgName}.webp')`;
                }
            }

            // Fall back to the memory's default mask when this step doesn't set
            // its own bg. Without a mask we land on transparent (the layer under
            // the story-background element will show).
            if (!isBlackBackground && !backgroundImageUrl && this.currentStoryDefaultBgUrl) {
                backgroundImageUrl = `url('${this.currentStoryDefaultBgUrl}')`;
            }

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

        /**
         * Resolve which BGM should be playing at the current script position by
         * scanning backwards for the most recent `bgm`/`stopbgm` directive, and
         * apply it. This makes backward navigation and resume-jumps land on the
         * correct track instead of inheriting whatever was last played.
         *
         * `bgmDelay` (game data, in seconds) is honored ONLY when the BGM switch
         * happens on the CURRENT line during forward advance — matches game
         * semantics where DelayCall(bgmDelay) wraps TempPlay(bgm) per step
         * (storyplayer.lua:1412). Backward nav and jumps play immediately since
         * the user has already "passed" the delay.
         */
        updateBgm() {
            let resolved = null; // null = no change, false = stop, string = play
            let resolvedOnCurrentLine = false;
            for (let i = this.scriptIndex; i >= 0; i--) {
                const line = this.currentStoryScript[i];
                if (!line) continue;
                if (line.stopbgm) { resolved = false; resolvedOnCurrentLine = (i === this.scriptIndex); break; }
                if (line.bgm) { resolved = line.bgm; resolvedOnCurrentLine = (i === this.scriptIndex); break; }
            }
            if (resolved === null) return;

            const target = resolved === false ? null : resolved;
            const currentLine = this.currentStoryScript[this.scriptIndex];
            const bgmDelaySec = Number.isFinite(currentLine?.bgmDelay) ? currentLine.bgmDelay : 0;

            // Cancel any pending delayed BGM switch from a previous render.
            if (this._bgmDelayTimer) { clearTimeout(this._bgmDelayTimer); this._bgmDelayTimer = null; }

            const shouldDelay = resolvedOnCurrentLine
                && this._playFlashOnNextRender === true
                && bgmDelaySec > 0;

            if (shouldDelay) {
                this._bgmDelayTimer = setTimeout(() => {
                    this._bgmDelayTimer = null;
                    this.handleBgm(target);
                }, bgmDelaySec * 1000);
            } else {
                this.handleBgm(target);
            }
        },

        // ===== Painting & Expression Rendering =====

        /**
         * Look up expression manifest data for a character.
         * Prefers painting_n (zoomed variant used in story mode) over the
         * standard painting, and returns null if neither variant is present.
         */
        getExpressionData(actorId) {
            if (!actorId || !this.expressionManifest) return null;

            const idStr = String(actorId);

            // First try painting_n (zoomed version, used in story mode)
            const paintingN = this.expressionManifest[`${idStr}_n`];
            if (paintingN) {
                return {
                    ...paintingN,
                    type: 'painting_n',
                    baseUrl: `${this.BASE_URL}output_expressions/${idStr}/painting_n.png`,
                    faceUrlTemplate: `${this.BASE_URL}output_expressions/${idStr}/painting_n_face_{faceId}.png`
                };
            }

            // Fall back to regular painting
            const painting = this.expressionManifest[idStr];
            if (painting) {
                return {
                    ...painting,
                    type: 'painting',
                    baseUrl: `${this.BASE_URL}output_expressions/${idStr}/painting.png`,
                    faceUrlTemplate: `${this.BASE_URL}output_expressions/${idStr}/painting_face_{faceId}.png`
                };
            }

            return null;
        },

        /**
         * Rebuild the painting state for the current script position and apply
         * it to the DOM. Mirrors the game's dialoguestoryplayer.lua model:
         *
         *   - Each side (0=LEFT, 1=RIGHT, 2=CENTER) holds at most one painting.
         *   - When a new step lands on CENTER, LEFT and RIGHT paintings are
         *     cleared (game's GetRecycleActorList rule for SIDE_MIDDLE).
         *   - Lines with `hideOther:true`, `hidePainting:true`, or no renderable
         *     actor clear ALL sides (game's hidePainting/actor==nil path).
         *   - `paintingFadeOut = {side, time}` MOVES the previous painting from
         *     its current side to the specified side.
         *   - The active speaker's painting is at alpha=1.0.
         *   - All other paintings dim to the CURRENT step's `painting.alpha`
         *     (the game fades prev speakers to the current step's alpha).
         *
         * We rebuild the full state on every render rather than tracking deltas
         * so that Back/Resume navigation always produces the correct visual
         * state without needing to "undo" transitions.
         */
        updatePaintings() {
            if (!this.elements.paintingLayer) return;
            const target = this.computePaintingStateAt(this.scriptIndex);
            this.applyPaintingState(target);
        },

        computePaintingStateAt(index) {
            /** @type {Map<number, {actorId:number, side:number, dir:number, expression:string, paintingNoise:boolean}>} */
            const paintings = new Map();
            let activeSide = null;
            let dimAlpha = 1; // non-speakers get this alpha (set by latest step with painting.alpha)
            let prevSide = null; // side of the previously-placed painting (for paintingFadeOut)

            const resolveActor = (line) => {
                if (typeof line.actor === 'number') return line.actor;
                if (line.actorName && !isNaN(parseInt(line.actorName, 10))) {
                    return parseInt(line.actorName, 10);
                }
                return null;
            };

            // In branching stories, skip lines that aren't reachable in the
            // currently-selected branch. Matches the nav-cache logic: when
            // activeOptionFlag is null we only include unflagged lines; when
            // a flag is active we include unflagged lines and lines with
            // matching flag.
            const activeFlag = this.activeOptionFlag;
            const lineReachable = (line) => {
                if (line.optionFlag === undefined) return true;
                return activeFlag !== null && line.optionFlag === activeFlag;
            };

            for (let i = 0; i <= index && i < this.currentStoryScript.length; i++) {
                const line = this.currentStoryScript[i];
                if (!line) continue;
                if (!lineReachable(line)) continue;

                const actorId = resolveActor(line);
                const hasRenderableActor = actorId != null && this.getExpressionData(actorId) != null;
                const hideAll =
                    line.hideOther === true ||
                    line.hidePainting === true ||
                    (line.actor === undefined && line.actorName === undefined);

                if (hideAll) {
                    paintings.clear();
                    activeSide = null;
                    prevSide = null;
                    continue;
                }

                // Actor exists but has no expression data (missing from manifest).
                // Don't clear other paintings — just skip painting placement and
                // update the active speaker side for dimming.
                if (!hasRenderableActor) {
                    activeSide = line.side !== undefined ? line.side : null;
                    continue;
                }

                const targetSide = line.side !== undefined ? line.side : 0;
                const dir = line.dir !== undefined ? line.dir : 1;
                const expression = line.expression !== undefined ? String(line.expression) : '0';
                const paintingNoise = line.paintingNoise === true;

                if (line.painting?.alpha !== undefined) dimAlpha = line.painting.alpha;

                // paintingFadeOut: move the previously-placed painting to a new side.
                // This runs BEFORE recycle, so the moved painting survives the recycle pass.
                let movedToSide = null;
                if (line.paintingFadeOut && prevSide !== null && prevSide !== targetSide) {
                    const fadeDest = line.paintingFadeOut.side;
                    const prevPainting = paintings.get(prevSide);
                    if (prevPainting && fadeDest !== targetSide) {
                        paintings.delete(prevSide);
                        paintings.delete(fadeDest); // overwrite anything at the destination
                        paintings.set(fadeDest, { ...prevPainting, side: fadeDest });
                        movedToSide = fadeDest;
                    }
                }

                // Recycle: replace the target side if a different actor is there;
                // CENTER additionally clears LEFT and RIGHT (game rule).
                const existing = paintings.get(targetSide);
                if (existing && existing.actorId !== actorId) paintings.delete(targetSide);
                if (targetSide === 2) {
                    if (movedToSide !== 0) paintings.delete(0);
                    if (movedToSide !== 1) paintings.delete(1);
                }

                // Place (or update) the new painting on the target side.
                paintings.set(targetSide, {
                    actorId, side: targetSide, dir, expression, paintingNoise,
                });

                activeSide = targetSide;
                prevSide = targetSide;
            }

            return { paintings, activeSide, dimAlpha };
        },

        /**
         * Reconcile the DOM with a target painting state. Paintings already
         * matching by (side, actorId) are updated in place; mismatches are
         * evicted and replaced. Opacity is set so the active speaker is fully
         * visible (1.0) and every other painting is dimmed to dimAlpha.
         */
        applyPaintingState(target) {
            const { paintings: targetMap, activeSide, dimAlpha } = target;

            // Evict paintings that don't belong in the target state.
            const currentSides = Array.from(this.paintingsBySide.keys());
            for (const side of currentSides) {
                const current = this.paintingsBySide.get(side);
                const want = targetMap.get(side);
                if (!want || want.actorId !== current.actorId) {
                    this.evictSidePainting(side);
                }
            }

            // Create or update paintings to match the target.
            for (const [side, want] of targetMap) {
                const current = this.paintingsBySide.get(side);
                const expressionData = this.getExpressionData(want.actorId);
                if (!expressionData) continue;

                if (current && current.actorId === want.actorId) {
                    // Same actor, same side — reuse the element and update fields.
                    if (current.expression !== want.expression) {
                        this.updatePaintingExpression(current.element, expressionData, want.expression);
                        current.expression = want.expression;
                    }
                    if (current.dir !== want.dir) {
                        current.element.dataset.dir = want.dir;
                        current.dir = want.dir;
                    }
                    current.element.classList.toggle('painting-noise', want.paintingNoise);
                } else {
                    const container = this.createPaintingContainer({
                        actorId: want.actorId,
                        side: want.side,
                        dir: want.dir,
                        expressionData,
                        expression: want.expression,
                        hasNoise: want.paintingNoise,
                        fadeInSec: 0.25,
                    });
                    this.elements.paintingLayer.appendChild(container);
                    this.paintingsBySide.set(side, {
                        actorId: want.actorId,
                        element: container,
                        expression: want.expression,
                        side: want.side,
                        dir: want.dir,
                    });
                }
            }

            // Apply speaker highlight: active = 1.0, others = dimAlpha.
            //
            // Newly-created containers were seeded with --painting-opacity: 0
            // for fade-in. The browser may batch style writes into a single
            // frame, which would skip the 0 state and show no animation. We
            // force a layout read on the new containers to commit the 0, then
            // set the real opacity so the CSS transition runs. Existing
            // containers update immediately — no flash possible there.
            this.activeSpeakerSide = activeSide;
            for (const [side, p] of this.paintingsBySide) {
                // Touch offsetHeight to flush the '0' baseline if present.
                if (p.element.style.getPropertyValue('--painting-opacity') === '0') {
                    void p.element.offsetHeight; // force reflow
                }
                const isActive = side === activeSide;
                p.element.classList.toggle('active', isActive);
                p.element.classList.toggle('inactive', !isActive);
                p.element.style.setProperty('--painting-opacity', isActive ? 1 : dimAlpha);
            }
        },

        /**
         * Build a detached painting-container DOM node. Alpha is controlled
         * entirely by --painting-opacity (set by applyPaintingState); this
         * function only handles the initial fade-in from 0 to the target alpha.
         */
        createPaintingContainer({ actorId, side, dir, expressionData, expression,
                                  hasNoise, fadeInSec }) {
            const container = document.createElement('div');
            container.className = 'painting-container';
            container.dataset.side = side;
            container.dataset.dir = dir;
            container.dataset.actorId = actorId;
            if (hasNoise) container.classList.add('painting-noise');

            if (fadeInSec && fadeInSec > 0) {
                // Seed the custom property to 0 so the CSS-driven transition
                // animates up to whatever applyPaintingState() sets next frame.
                container.style.setProperty('--painting-opacity', 0);
                container.style.transition = `opacity ${fadeInSec}s ease-in`;
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'painting-image-wrapper';
            // Publish the painting's natural dimensions so CSS can compute a
            // box that matches the rendered image exactly (see .painting-image-
            // wrapper rules). Face overlay percentages are derived from these
            // same dims, so aligning wrapper to image guarantees face placement.
            if (expressionData.size && expressionData.size[0] && expressionData.size[1]) {
                const [imgW, imgH] = expressionData.size;
                wrapper.style.setProperty('--painting-w', String(imgW));
                wrapper.style.setProperty('--painting-h', String(imgH));
                wrapper.style.aspectRatio = `${imgW} / ${imgH}`;
            }

            const baseImg = document.createElement('img');
            baseImg.className = 'painting-base';
            baseImg.src = expressionData.baseUrl;
            baseImg.alt = '';
            baseImg.loading = 'eager';
            wrapper.appendChild(baseImg);

            if (expressionData.faces && expressionData.faces.length > 0) {
                const faceImg = document.createElement('img');
                faceImg.className = 'painting-face-overlay';
                const defaultFaceId = expressionData.faces[0] || '0';
                faceImg.src = expressionData.faceUrlTemplate.replace('{faceId}', expression);
                faceImg.alt = '';
                faceImg.loading = 'eager';

                faceImg.addEventListener('error', () => {
                    const defaultSrc = expressionData.faceUrlTemplate.replace('{faceId}', defaultFaceId);
                    if (faceImg.src !== defaultSrc) {
                        faceImg.src = defaultSrc;
                    } else {
                        faceImg.style.display = 'none';
                    }
                }, { once: true });

                // Positioning uses percentages, so we can set it immediately —
                // no need to wait for the base image to load.
                this.applyFaceOverlayPosition(faceImg, expressionData);

                wrapper.appendChild(faceImg);
            }

            container.appendChild(wrapper);
            return container;
        },

        /**
         * Fade out and remove the painting currently on `side`.
         */
        evictSidePainting(side) {
            const existing = this.paintingsBySide.get(side);
            if (!existing) return;
            const el = existing.element;
            el.style.transition = `opacity ${this.PAINTING_FADE_OUT_MS}ms ease-out`;
            el.style.opacity = '0';
            const removeAfter = this.PAINTING_FADE_OUT_MS + 20;
            setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, removeAfter);
            this.paintingsBySide.delete(side);
        },

        /**
         * Apply face overlay positioning based on expression data.
         *
         * The face overlay is positioned relative to the painting-image-wrapper,
         * which sizes itself to the rendered base image. Using percentages of the
         * original image dimensions therefore maps 1:1 to percentages of the
         * rendered image — it's automatic, aspect-ratio-correct, and doesn't
         * depend on offsetWidth/offsetHeight being resolved at load time (which
         * can return 0 or stale values if layout hasn't settled).
         */
        applyFaceOverlayPosition(faceImg, expressionData /*, baseImg */) {
            if (!expressionData.box || !expressionData.size) return;
            const [x, y, w, h] = expressionData.box;
            const [imgW, imgH] = expressionData.size;
            if (!imgW || !imgH) return;

            faceImg.style.left = `${(x / imgW) * 100}%`;
            faceImg.style.top = `${(y / imgH) * 100}%`;
            faceImg.style.width = `${(w / imgW) * 100}%`;
            faceImg.style.height = `${(h / imgH) * 100}%`;
        },

        /**
         * Swap the face overlay src on an existing painting container when only
         * the expression changes (actor and side are the same). Falls back to the
         * default face ID if the requested expression image fails to load.
         */
        updatePaintingExpression(container, expressionData, newExpression) {
            const faceImg = container.querySelector('.painting-face-overlay');
            if (!faceImg) return;

            faceImg.style.display = '';

            const newSrc = expressionData.faceUrlTemplate.replace('{faceId}', newExpression);
            const defaultFaceId = expressionData.faces?.[0] || '0';
            const defaultSrc = expressionData.faceUrlTemplate.replace('{faceId}', defaultFaceId);

            faceImg.src = newSrc;
            faceImg.onerror = () => {
                if (faceImg.src !== defaultSrc) {
                    faceImg.src = defaultSrc;
                } else {
                    faceImg.style.display = 'none';
                }
            };
        },

        /** Clear all paintings when starting a new story. */
        clearPaintings() {
            if (this.elements.paintingLayer) {
                this.elements.paintingLayer.textContent = '';
            }
            this.paintingsBySide.clear();
            this.activeSpeakerSide = null;
        },

        /**
         * Return true if there is at least one displayable line reachable from the
         * current position in the active branch context. Used to decide whether to
         * show the Next button and whether auto-play should schedule another advance.
         */
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

        /**
         * Cancel any in-flight line-level effects (shake/flashN/sfx). Called on
         * non-advance renders so backward nav / jumps / resume don't leave a
         * stale animation playing after the user has moved past its step.
         */
        clearLineEffects() {
            // Shake (whole viewer)
            const container = this.elements.viewerContainer;
            if (container) {
                clearTimeout(this._shakeTimer);
                container.classList.remove('shake');
                container.style.removeProperty('--shake-x');
                container.style.removeProperty('--shake-y');
                container.style.removeProperty('--shake-duration');
                container.style.removeProperty('--shake-iterations');
            }
            // DialogShake (dialogue box only)
            const dbox = this.elements.dialogueBox;
            if (dbox) {
                clearTimeout(this._dialogShakeTimer);
                dbox.classList.remove('dialog-shake');
                dbox.style.removeProperty('--dialog-shake-x');
                dbox.style.removeProperty('--dialog-shake-duration');
                dbox.style.removeProperty('--dialog-shake-iterations');
            }
            // PaintingShake (character portrait)
            this._clearPaintingShake();
            // FlashN
            if (this._flashNAnims) {
                this._flashNAnims.forEach(a => { try { a.cancel(); } catch (_) {} });
                this._flashNAnims = null;
            }
            if (this._flashNTimers) {
                this._flashNTimers.forEach(clearTimeout);
                this._flashNTimers = null;
            }
            if (this._flashNOverlay) this._flashNOverlay.style.opacity = '0';
            // Sound effect (cancel pending delayed SFX only; don't interrupt
            // SFX already playing — those finish naturally via their own
            // cleanup in playSfx).
            if (this._sfxTimer) { clearTimeout(this._sfxTimer); this._sfxTimer = null; }
        },

        /**
         * Apply full-screen shake from `line.shakeTime`.
         *
         * line.shakeTime — number (seconds)
         *   In the game (storyplayer.lua) this plays a looping Unity animation
         *   for the given duration. Only ~27 occurrences across all story data
         *   — reserved for dramatic moments (explosions, impacts).
         *
         * NOTE: `line.shake` is NOT a screen shake — it's a painting shake
         * handled by handleLinePaintingShake(). See storymgr.lua:991-994.
         */
        handleLineShake(line) {
            const container = this.elements.viewerContainer;
            if (!container) return;

            // Clear any prior shake first so we can re-apply cleanly.
            clearTimeout(this._shakeTimer);
            container.classList.remove('shake');
            container.style.removeProperty('--shake-x');
            container.style.removeProperty('--shake-y');
            container.style.removeProperty('--shake-duration');
            container.style.removeProperty('--shake-iterations');

            if (!Number.isFinite(line.shakeTime) || line.shakeTime <= 0) return;

            // Derive iteration count from duration at a moderate cycle pace.
            const perCycleMs = 520;
            const number = Math.max(1, Math.round(line.shakeTime * 1000 / perCycleMs));
            const ampX = this.SHAKE_DEFAULT_X_PX;
            const totalMs = Math.min(this.SHAKE_MAX_TOTAL_MS, perCycleMs * number);

            container.style.setProperty('--shake-x', `${ampX}px`);
            container.style.setProperty('--shake-y', '0px');
            container.style.setProperty('--shake-duration', `${perCycleMs}ms`);
            container.style.setProperty('--shake-iterations', String(number));
            container.classList.add('shake');

            this._shakeTimer = setTimeout(() => {
                container.classList.remove('shake');
                container.style.removeProperty('--shake-x');
                container.style.removeProperty('--shake-y');
                container.style.removeProperty('--shake-duration');
                container.style.removeProperty('--shake-iterations');
            }, totalMs + 20);
        },

        /**
         * Dialogue-box shake from `line.dialogShake`.
         *
         * Game data shape: { number, speed, x, delay? }
         *   number — cycles of back-and-forth movement
         *   speed  — SECONDS per cycle (fractional, e.g., 0.08, 0.09, 0.12)
         *            NOTE: completely different semantic from line.shake.speed
         *   x      — horizontal amplitude in px (e.g., 8.5, 11, 15)
         *   delay  — optional seconds before start
         *
         * Per dialoguestoryplayer.lua:303 this is `TweenMovex(dialogueWin, x,
         * origX, speed, delay, number)` — it shakes the dialogue box WINDOW
         * horizontally (not the whole screen). Used on emphatic lines to make
         * the textbox jitter as characters shout.
         */
        handleLineDialogShake(line) {
            const dbox = this.elements.dialogueBox;
            if (!dbox) return;

            clearTimeout(this._dialogShakeTimer);
            dbox.classList.remove('dialog-shake');
            dbox.style.removeProperty('--dialog-shake-x');
            dbox.style.removeProperty('--dialog-shake-duration');
            dbox.style.removeProperty('--dialog-shake-iterations');

            const s = line.dialogShake;
            if (!s || typeof s !== 'object') return;

            const number = Math.max(1, parseInt(s.number, 10) || 1);
            const speedSec = Number.isFinite(s.speed) && s.speed > 0 ? s.speed : 0.1;
            const ampX = Number.isFinite(s.x) ? s.x : 10;
            const delayMs = Math.max(0, (s.delay || 0) * 1000);
            const perCycleMs = Math.max(40, speedSec * 1000);
            const totalMs = perCycleMs * number;

            const start = () => {
                dbox.style.setProperty('--dialog-shake-x', `${ampX}px`);
                dbox.style.setProperty('--dialog-shake-duration', `${perCycleMs}ms`);
                dbox.style.setProperty('--dialog-shake-iterations', String(number));
                // Force a reflow so re-adding the class restarts the animation
                // even if the previous run hadn't fully ended yet.
                void dbox.offsetHeight;
                dbox.classList.add('dialog-shake');
                this._dialogShakeTimer = setTimeout(() => {
                    dbox.classList.remove('dialog-shake');
                    dbox.style.removeProperty('--dialog-shake-x');
                    dbox.style.removeProperty('--dialog-shake-duration');
                    dbox.style.removeProperty('--dialog-shake-iterations');
                }, totalMs + 20);
            };

            if (delayMs > 0) {
                this._dialogShakeTimer = setTimeout(start, delayMs);
            } else {
                start();
            }
        },

        /**
         * Painting/portrait shake from `line.action[]` entries with type="shake".
         *
         * Game data shape (per action entry):
         *   { type:"shake", x, y, dur, number, delay }
         *   x/y   — displacement in px (game coords, scaled down for web)
         *   dur   — seconds per ping-pong cycle
         *   number — how many ping-pong loops
         *   delay — seconds before start
         *
         * In the game this is TweenMove on the character painting with
         * setLoopPingPong. We apply a CSS animation to the painting element
         * on the active speaker's side.
         */
        handleLinePaintingShake(line) {
            // Clear any prior painting shake.
            this._clearPaintingShake();

            // Two sources of painting shake (both use LeanTween.move on the
            // painting in storymgr.lua):
            //
            // 1. line.shake = {number, speed, x?, y?}   (storymgr.lua:991-994)
            //    speed is a divisor: duration = 1/speed seconds per tween
            //    x defaults 0, y defaults 10 (game px)
            //
            // 2. line.action[].type="shake" = {x, y, dur, number, delay}
            //    dur is direct duration in seconds    (storymgr.lua:1002-1003)
            //    x defaults 0, y defaults 10 (game px)
            let ampX, ampY, perCycleMs, number, delayMs;

            const actionShake = Array.isArray(line.action)
                ? line.action.find(a => a && a.type === 'shake')
                : null;
            const lineShake = (line.shake && typeof line.shake === 'object') ? line.shake : null;

            if (!actionShake && !lineShake) return;

            // Scale down game coords — game paintings are much larger than the
            // web viewer's painting layer. Use ~15% of the raw value so the
            // effect is noticeable without being jarring.
            const scale = 0.15;

            if (actionShake) {
                // action shake: dur is seconds per tween cycle
                number = Math.max(1, parseInt(actionShake.number, 10) || 2);
                const dur = Number.isFinite(actionShake.dur) && actionShake.dur > 0 ? actionShake.dur : 0.15;
                delayMs = Math.max(0, (actionShake.delay || 0) * 1000);
                ampX = (Number.isFinite(actionShake.x) ? actionShake.x : 0) * scale;
                ampY = (Number.isFinite(actionShake.y) ? actionShake.y : 10) * scale;
                perCycleMs = Math.max(40, dur * 1000);
            } else {
                // line.shake: speed is a divisor → duration = 1/speed seconds
                number = Math.max(1, parseInt(lineShake.number, 10) || 1);
                const speed = Number.isFinite(lineShake.speed) && lineShake.speed > 0 ? lineShake.speed : 1;
                delayMs = 0;
                ampX = (Number.isFinite(lineShake.x) ? lineShake.x : 0) * scale;
                ampY = (Number.isFinite(lineShake.y) ? lineShake.y : 10) * scale;
                perCycleMs = Math.max(40, (1 / speed) * 1000);
            }

            // Find the painting element for the current speaker's side.
            const side = line.side !== undefined ? line.side : 0;
            const paintingInfo = this.paintingsBySide.get(side);
            if (!paintingInfo?.element) return;

            const el = paintingInfo.element;
            const totalMs = perCycleMs * number;

            const start = () => {
                el.style.setProperty('--painting-shake-x', `${ampX}px`);
                el.style.setProperty('--painting-shake-y', `${ampY}px`);
                el.style.setProperty('--painting-shake-duration', `${perCycleMs}ms`);
                el.style.setProperty('--painting-shake-iterations', String(number));
                void el.offsetHeight;
                el.classList.add('painting-shake');
                this._paintingShakeTimer = setTimeout(() => {
                    this._clearPaintingShake();
                }, totalMs + 20);
            };

            this._paintingShakeEl = el;
            if (delayMs > 0) {
                this._paintingShakeTimer = setTimeout(start, delayMs);
            } else {
                start();
            }
        },

        /** Clear any in-flight painting shake animation. */
        _clearPaintingShake() {
            clearTimeout(this._paintingShakeTimer);
            this._paintingShakeTimer = null;
            const el = this._paintingShakeEl;
            if (el) {
                el.classList.remove('painting-shake');
                el.style.removeProperty('--painting-shake-x');
                el.style.removeProperty('--painting-shake-y');
                el.style.removeProperty('--painting-shake-duration');
                el.style.removeProperty('--painting-shake-iterations');
                this._paintingShakeEl = null;
            }
        },

        /**
         * Multi-phase color blink from `line.flashN`.
         *
         * Game data shape: { alpha: [[from, to, dur, delay?], ...], color: [r,g,b] | [r,g,b,a] }
         *   Each alpha entry is one phase: tween opacity from→to over dur
         *   seconds, starting after `delay` seconds (cumulative from t=0, not
         *   between phases — verified against sample data where delays grow
         *   monotonically: 0, 0.2, 0.4, 0.6).
         *   color is normalized RGB(A) 0..1.
         *
         * Uses the dedicated flash-overlay element to avoid conflicting with
         * flashout/flashin curtains (which use story-flash-overlay).
         */
        handleLineFlashN(line) {
            // Cancel any previous flashN animation.
            if (this._flashNAnims) {
                this._flashNAnims.forEach(a => { try { a.cancel(); } catch (_) {} });
                this._flashNAnims = null;
            }
            if (this._flashNTimers) {
                this._flashNTimers.forEach(clearTimeout);
                this._flashNTimers = null;
            }

            const fn = line.flashN;
            if (!fn || !Array.isArray(fn.alpha) || fn.alpha.length === 0) {
                // Hide any lingering flashN overlay.
                if (this._flashNOverlay) this._flashNOverlay.style.opacity = '0';
                return;
            }

            const overlay = this._ensureFlashNOverlay();
            const c = Array.isArray(fn.color) ? fn.color : [1, 1, 1];
            const r = Math.round((c[0] ?? 1) * 255);
            const g = Math.round((c[1] ?? 1) * 255);
            const b = Math.round((c[2] ?? 1) * 255);
            const a = c[3] != null ? c[3] : 1;
            overlay.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${a})`;

            this._flashNAnims = [];
            this._flashNTimers = [];
            const lineDelay = Math.max(0, (fn.delay || 0) * 1000);

            let maxEndMs = 0;
            fn.alpha.forEach((phase) => {
                if (!Array.isArray(phase) || phase.length < 3) return;
                const [from, to, durSec, delaySec] = phase;
                const durMs = Math.max(0, (durSec || 0) * 1000);
                const startMs = lineDelay + Math.max(0, (delaySec || 0) * 1000);
                if (durMs === 0) return;
                if (startMs + durMs > maxEndMs) maxEndMs = startMs + durMs;

                const startTimer = setTimeout(() => {
                    overlay.style.opacity = String(from);
                    const anim = overlay.animate(
                        [{ opacity: from }, { opacity: to }],
                        { duration: durMs, easing: 'ease-in-out', fill: 'forwards' }
                    );
                    this._flashNAnims?.push(anim);
                    anim.onfinish = () => { overlay.style.opacity = String(to); };
                }, startMs);
                this._flashNTimers.push(startTimer);
            });

            // Cap total so runaway configurations don't leave the screen tinted.
            if (maxEndMs > this.FLASH_MAX_TOTAL_MS) maxEndMs = this.FLASH_MAX_TOTAL_MS;
            const cleanupTimer = setTimeout(() => {
                overlay.style.opacity = '0';
            }, maxEndMs + 50);
            this._flashNTimers.push(cleanupTimer);
        },

        _ensureFlashNOverlay() {
            if (this._flashNOverlay) return this._flashNOverlay;
            const el = document.createElement('div');
            el.className = 'story-flashn-overlay';
            el.setAttribute('aria-hidden', 'true');
            document.body.appendChild(el);
            this._flashNOverlay = el;
            return el;
        },

        /**
         * Play `line.soundeffect` after `line.seDelay` seconds.
         *
         * FMOD event paths ('event:/battle/boom2') can't be loaded as web audio
         * — they reference FMOD Studio event IDs compiled into the game's audio
         * bank. We skip those and play only plain ID paths. (The existing
         * playSfx URL convention is `${BGM_URL_PREFIX}${id}.ogg`.)
         */
        handleLineSoundEffect(line) {
            if (this._sfxTimer) { clearTimeout(this._sfxTimer); this._sfxTimer = null; }
            const sfxId = line.soundeffect;
            if (!sfxId || typeof sfxId !== 'string') return;
            if (sfxId.startsWith('event:/')) return; // FMOD event — not available
            const delayMs = Math.max(0, (line.seDelay || 0) * 1000);
            if (delayMs === 0) {
                this.playSfx(sfxId);
            } else {
                this._sfxTimer = setTimeout(() => {
                    this._sfxTimer = null;
                    this.playSfx(sfxId);
                }, delayMs);
            }
        },

        /**
         * Cancel any in-flight flash animations/timers and reset the overlay
         * to transparent. Used on non-advance renders (back nav, jumps,
         * resume) so we never leave the screen stuck at a mid-fade opacity.
         */
        clearFlashOverlay() {
            if (this._flashAnims) {
                this._flashAnims.forEach(a => { try { a.cancel(); } catch (_) {} });
                this._flashAnims = null;
            }
            if (this._flashTimers) {
                this._flashTimers.forEach(clearTimeout);
                this._flashTimers = null;
            }
            if (this._flashOverlay) this._flashOverlay.style.opacity = '0';
        },

        /**
         * Animate the step-level flashout/flashin curtain sequence.
         * `flashout` fades a full-screen overlay IN (black or white) and `flashin`
         * fades it OUT, with an optional delay between them. Distinct from the
         * `flashN` multi-phase blink — uses a separate overlay element.
         */
        handleLineFlash(line) {
            if (this._flashAnims) {
                this._flashAnims.forEach(a => { try { a.cancel(); } catch (_) {} });
                this._flashAnims = null;
            }
            if (this._flashTimers) {
                this._flashTimers.forEach(clearTimeout);
                this._flashTimers = null;
            }

            if (!line.flashout && !line.flashin) {
                if (this._flashOverlay) this._flashOverlay.style.opacity = '0';
                return;
            }

            const overlay = this._ensureFlashOverlay();
            this._flashAnims = [];
            this._flashTimers = [];

            let offset = 0; // ms since this call

            const schedulePhase = (spec) => {
                const a = spec.alpha || [0, 1];
                const durMs = Math.max(0, (spec.dur || 0.5) * 1000);
                const color = spec.black ? 'rgb(0,0,0)' : 'rgb(255,255,255)';
                const startAt = offset;
                // We queue the start with setTimeout so phases run sequentially.
                const startTimer = setTimeout(() => {
                    overlay.style.backgroundColor = color;
                    // Pin the starting opacity before the animation so we don't
                    // see a flash of the wrong intensity.
                    overlay.style.opacity = String(a[0]);
                    const anim = overlay.animate(
                        [{ opacity: a[0] }, { opacity: a[1] }],
                        { duration: durMs, easing: 'linear', fill: 'forwards' }
                    );
                    this._flashAnims?.push(anim);
                    anim.onfinish = () => {
                        // Commit the end opacity inline so removing `fill` later
                        // won't snap the overlay back.
                        overlay.style.opacity = String(a[1]);
                    };
                }, startAt);
                this._flashTimers.push(startTimer);
                offset += durMs;
            };

            if (line.flashout) schedulePhase(line.flashout);

            if (line.flashin) {
                const delayMs = Math.max(0, (line.flashin.delay || 0) * 1000);
                offset += delayMs;
                schedulePhase(line.flashin);
            }
        },

        _ensureFlashOverlay() {
            if (this._flashOverlay) return this._flashOverlay;
            const el = document.createElement('div');
            el.className = 'story-flash-overlay';
            el.setAttribute('aria-hidden', 'true');
            document.body.appendChild(el);
            this._flashOverlay = el;
            return el;
        },

        /**
         * Play a short sound effect with bounded concurrency and guaranteed cleanup.
         * SFX that fail to decode or never fire 'ended' are still released via a
         * timeout fallback so the activeSfx array cannot grow unbounded.
         */
        playSfx(audioId) {
            const MAX_CONCURRENT_SFX = 3;
            const MAX_SFX_LIFETIME_MS = 15000;

            // Release finished SFX. Paused-but-not-ended entries stay active
            // until their own cleanup timer fires.
            this.activeSfx = this.activeSfx.filter(sfx => !sfx.ended);

            if (this.activeSfx.length >= MAX_CONCURRENT_SFX) {
                const oldest = this.activeSfx.shift();
                if (oldest._cleanup) oldest._cleanup();
            }

            const sfx = new Audio(`${this.BGM_URL_PREFIX}${audioId}.ogg`);
            sfx.volume = this.audio.volume;

            let released = false;
            const cleanup = () => {
                if (released) return;
                released = true;
                try { sfx.pause(); } catch (_) { /* ignore */ }
                sfx.src = '';
                clearTimeout(timeoutId);
                this.activeSfx = this.activeSfx.filter(s => s !== sfx);
            };
            sfx._cleanup = cleanup;

            sfx.addEventListener('ended', cleanup, { once: true });
            sfx.addEventListener('error', cleanup, { once: true });
            const timeoutId = setTimeout(cleanup, MAX_SFX_LIFETIME_MS);

            this.activeSfx.push(sfx);
            sfx.play().catch(e => { console.warn("SFX playback failed.", e); cleanup(); });
        },

        /**
         * Apply a BGM change: start playing the named track, stop BGM when null,
         * show/hide the audio player container, and update the UI. No-op when
         * the same track is already playing.
         */
        handleBgm(bgmName) {
            toggleElement(this.elements.audioPlayerContainer, !!bgmName);

            if (bgmName && bgmName !== this.currentBgm) {
                const requested = bgmName;
                this.audio.src = `${this.BGM_URL_PREFIX}${requested}.ogg`;
                this.audio.play()
                    .then(() => { this.currentBgm = requested; })
                    .catch(e => {
                        // Playback failed (autoplay policy, network, etc.) — keep currentBgm null
                        // so a retry can re-attempt this track next time handleBgm is called.
                        this.currentBgm = null;
                        console.warn("Audio playback failed.", e);
                    });
            } else if (!bgmName && this.currentBgm) {
                this.currentBgm = null;
                this.audio.pause();
            }

            if (this.elements.bgmNameSpan) this.elements.bgmNameSpan.textContent = bgmName || '';
            this.updateAudioPlayerUI();
        },

        /** Sync the audio player button icons and volume slider to the audio element's current state. */
        updateAudioPlayerUI() {
            const el = this.elements;
            if (!el.playPauseBtn || !el.muteBtn || !el.volumeSlider) return;

            if (!el.playPauseIcon) {
                el.playPauseIcon = el.playPauseBtn.querySelector('.material-symbols-outlined');
            }
            if (!el.muteIcon) {
                el.muteIcon = el.muteBtn.querySelector('.material-symbols-outlined');
            }

            el.playPauseIcon.textContent = this.audio.paused ? 'play_arrow' : 'pause';
            el.muteIcon.textContent = this.audio.muted || this.audio.volume === 0 ? 'volume_off' : 'volume_up';
            el.volumeSlider.value = this.audio.muted ? 0 : this.audio.volume;

            if (el.audioPlayerContainer) {
                el.audioPlayerContainer.classList.toggle('playing', !this.audio.paused);
            }
        },

        /** Display an error message in the error container for 5 seconds. */
        showError(message) {
            this.elements.errorContainer.textContent = message;
            showElement(this.elements.errorContainer);
            setTimeout(() => hideElement(this.elements.errorContainer), 5000);
        },

        /** Update the line-count and progress-bar UI based on the current script position. */
        updateProgressIndicator() {
            if (!this.elements.progressIndicator) return;

            const totalLines = this.currentStoryScript.length;
            const currentLine = this.scriptIndex + 1;
            const percentage = Math.round((currentLine / totalLines) * 100);

            const indicator = this.elements.progressIndicator;
            indicator.textContent = '';

            const text = document.createElement('div');
            text.className = 'progress-text';
            text.textContent = `${currentLine} / ${totalLines}`;

            const barContainer = document.createElement('div');
            barContainer.className = 'progress-bar-container';
            const barFill = document.createElement('div');
            barFill.className = 'progress-bar-fill';
            barFill.style.width = `${percentage}%`;
            barContainer.appendChild(barFill);
            indicator.append(text, barContainer);
        },

        // ===== Modals =====

        /**
         * Open the full-script modal. The dialogue DOM is built once per story
         * (cachedFullScript) and cloned on subsequent opens to avoid rebuilding it.
         */
        showFullScript() {
            if (!this.currentStoryScript || this.currentStoryScript.length === 0) return;

            // Build the full-script DOM once per story, then clone-mount on subsequent opens.
            if (!this.cachedFullScript) {
                const frag = document.createDocumentFragment();
                this.currentStoryScript.forEach(line => {
                    if (!line.say || line.say.trim() === '') return;
                    const actorInfo = this.getActorInfo(line);
                    const p = document.createElement('p');
                    const strong = document.createElement('strong');
                    strong.textContent = `${actorInfo.name || 'Narrator'}:`;
                    p.appendChild(strong);
                    p.appendChild(document.createTextNode(
                        ' ' + line.say.replace(/<.*?>/g, '')
                    ));
                    frag.appendChild(p);
                });
                this.cachedFullScript = frag;
            }

            this.elements.fullScriptContent.textContent = '';
            this.elements.fullScriptContent.appendChild(this.cachedFullScript.cloneNode(true));
            showElement(this.elements.scriptModalOverlay);
        },
        hideFullScript() { hideElement(this.elements.scriptModalOverlay); },

        /**
         * Open the world-story summary modal for the given event ID.
         * Renders title, summary text, and key character list from storylineSummaryData.
         */
        showSummaryModal(eventId) {
            const data = this.storylineSummaryData[eventId];
            if (!data) return;

            const content = this.elements.summaryModalContent;
            content.textContent = '';

            const h2 = document.createElement('h2');
            h2.textContent = data.title || '';
            content.appendChild(h2);

            const p = document.createElement('p');
            p.textContent = data.summary || '';
            content.appendChild(p);

            if (Array.isArray(data.keychar) && data.keychar.length > 0) {
                const h3 = document.createElement('h3');
                h3.textContent = data.keychar[0];
                content.appendChild(h3);
                const ul = document.createElement('ul');
                for (let i = 1; i < data.keychar.length; i++) {
                    const li = document.createElement('li');
                    li.textContent = data.keychar[i];
                    ul.appendChild(li);
                }
                content.appendChild(ul);
            }

            showElement(this.elements.summaryModalOverlay);
        },
        hideSummaryModal() { hideElement(this.elements.summaryModalOverlay); },

    };
});
