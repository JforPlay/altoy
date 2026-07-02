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
import { getExpressionData, updatePaintings, clearPaintings, resolvePortraitFaceUrl } from './story.painting.js';
import { clearLineEffects, handleLineShake, handleLineDialogShake, handleLinePaintingShake, handleLineFlashN, handleLineSoundEffect, clearFlashOverlay, handleLineFlash, playFlashoutCover } from './story.effects.js';
import { correctKrNameColor } from './story.text.js';
import { resolveAudioCueUrl } from './story.bgm.js';
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
        lastPortraitUrl: null,
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
        PAINTING_FADE_OUT_MS: 150, // game fadeOutPaintingTime default (dialoguestep.lua:71)

        // Effect tuning. Shake "speed" in game data is a small-int tier; we map
        // it to a per-cycle duration. Flash duration caps keep runaway 'number:
        // 999' entries from pinning the screen forever.
        SHAKE_DEFAULT_X_PX: 8,
        SHAKE_MAX_TOTAL_MS: 8000,
        FLASH_MAX_TOTAL_MS: 8000,
        // Hard cap on how long a flashout cover may defer the next line's
        // render (covers in data are ~1s; a bad dur must not lock input).
        FLASH_COVER_MAX_MS: 3000,
        _flashTransition: null, // pending {timer} while a flashout cover plays

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
                // A page without the modal element counts as CLOSED — the
                // `!...?.` form turned missing modals into "open" and silently
                // swallowed all story keyboard nav (main-story has no summary
                // modal, so Space/Enter/arrows were dead there).
                const scriptOpen = this.elements.scriptModalOverlay
                    ? !this.elements.scriptModalOverlay.classList.contains('hidden') : false;
                const summaryOpen = this.elements.summaryModalOverlay
                    ? !this.elements.summaryModalOverlay.classList.contains('hidden') : false;
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
            btn.className = 'btn btn-secondary story-nav-btn auto-play-btn';
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
            btn.classList.toggle('is-active', this.autoPlaySpeed > 0);
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
            // Page-supplied index renderer (e.g. the event archive's year-grid).
            // Absent on all other story pages → unchanged flat-grid behavior below.
            if (this.config.renderEventGrid) {
                this.config.renderEventGrid(this, searchTerm);
                return;
            }

            this.elements.eventGrid.textContent = '';
            // Optional page-supplied predicate (e.g. main-story's 진영 필터)
            // composes with the name search; absent → search-only as before.
            const extraFilter = this.config.filterEvent || (() => true);
            const filteredEvents = Object.entries(this.storylineData)
                .filter(([key, event]) => event.name.toLowerCase().includes((searchTerm || '').toLowerCase())
                    && extraFilter(event));

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
            this.lastPortraitUrl = null;
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
                line.flashin || line.flashout || line.flash
            );
        },

        /**
         * Advance to the next reachable displayable line in the current branch context.
         * Sets _playFlashOnNextRender so flash/shake effects trigger on forward nav only.
         */
        advanceStory() {
            // A flashout cover is mid-transition: the step change is already
            // in flight, so further advance input is consumed (the game also
            // doesn't accept input during the exit-transition stages).
            if (this._flashTransition) return;
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
                this.renderAfterFlashCover();
            } else {
                // At end of reachable path
                this.renderScriptLine();
            }
        },

        /**
         * Render the (already-set) current line, playing its flashout as a
         * PRE-render cover when present. Game order (storyplayer.lua Play
         * :323-360): the curtain covers the OLD scene, content swaps behind
         * it, then the step's flashin reveals. Only natural forward advance
         * (advanceStory / selectOption) comes through here.
         */
        renderAfterFlashCover() {
            const line = this.currentStoryScript[this.scriptIndex];
            const coverMs = line ? this.playFlashoutCover(line) : 0;
            if (coverMs > 0) {
                const timer = setTimeout(() => {
                    this._flashTransition = null;
                    this.renderScriptLine();
                }, Math.min(coverMs, this.FLASH_COVER_MAX_MS));
                this._flashTransition = { timer };
            } else {
                this.renderScriptLine();
            }
        },

        /**
         * Abort a pending cover transition (back-nav, jumps, story switch).
         * The interrupted advance never rendered, so its effect flag must not
         * leak onto the unrelated render that interrupted it.
         */
        cancelFlashTransition() {
            if (this._flashTransition) {
                clearTimeout(this._flashTransition.timer);
                this._flashTransition = null;
                this._playFlashOnNextRender = false;
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
            // Any render NOT coming from a cover-transition completion kills
            // the pending transition (the completion callback nulls the
            // handle before calling us, so this no-ops on that path).
            this.cancelFlashTransition();
            if (this.scriptIndex >= this.currentStoryScript.length) return;
            const line = this.currentStoryScript[this.scriptIndex];
            const el = this.elements;

            el.optionsBox.textContent = '';
            hideElement(el.dialogueBox);
            hideElement(el.infoScreen);
            el.infoScreenText.textContent = '';

            this.updateBackground();
            this.updateOldPhoto(line);
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
            // Step-start curtain effects: flashin reveal + `flash` blink. The
            // flashout COVER already played before this render (see
            // renderAfterFlashCover — game plays it while leaving the previous
            // step). Only natural forward advance replays these — backward
            // nav, jumps, and resumes should NOT retrigger blackouts the user
            // has already seen; those paths clear any lingering overlay
            // instead so the screen never stays covered.
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

                // Name text + faction tag refresh on every line (cheap, and
                // actorName/factiontag can change while the speaker id stays
                // the same).
                this.renderActorName(displayedName, line);

                // Resolve the portrait URL on EVERY line — same candidate
                // chain as the painting compositor, so the dialog face tracks
                // per-line expression changes instead of freezing on the
                // first face of a same-speaker run (the old speaker-id gate).
                // Cheap: two manifest lookups + a small array scan; the <img>
                // below is only rebuilt when the resolved URL changes, so
                // same-face runs cause no reload or flicker.
                let portraitIcon = actorInfo.icon;
                if (typeof line.actor === 'number' && line.actor > 0) {
                    const faceUrl = resolvePortraitFaceUrl(this.getExpressionData(line.actor), line.expression);
                    if (faceUrl) portraitIcon = faceUrl;
                }

                if (portraitIcon !== this.lastPortraitUrl) {
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
                    this.lastPortraitUrl = portraitIcon;
                }

                // The KR client remaps several legacy nameColor values
                // (dialoguestep.lua:14-32) — apply the same correction.
                el.actorName.style.color = line.nameColor ? correctKrNameColor(line.nameColor) : '';

                el.actorPortrait.classList.toggle('actor-shadow', line.actorShadow === true);
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
                    button.className = 'btn option-button';
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
                this.renderAfterFlashCover();
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
         * Render the speaker name plus the optional faction tag suffix
         * (game's factiontag/subText — dialoguestep.lua GetSubActorName).
         * factiontagColor is used raw (the Lua applies no correction map to
         * it); when unset we inherit the theme color rather than forcing the
         * game's #FFFFFF default onto a possibly-light panel.
         */
        renderActorName(displayedName, line) {
            const el = this.elements.actorName;
            el.textContent = displayedName;
            if (line.factiontag) {
                const tag = document.createElement('span');
                tag.className = 'actor-faction-tag';
                tag.textContent = ` ${line.factiontag}`;
                if (line.factiontagColor) tag.style.color = line.factiontagColor;
                el.appendChild(tag);
            }
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
         * Toggle the per-step oldPhoto sepia tint (storyplayer.lua:1157-1169 —
         * flashback scenes). `oldPhoto` is `true` for the default vintage
         * color or an [r,g,b,a] array (0..1) for a custom tint. The overlay is
         * created on first use and toggled per line afterwards.
         */
        updateOldPhoto(line) {
            const spec = line?.oldPhoto;
            let overlay = this.elements.oldPhotoOverlay;
            if (!overlay) {
                if (!spec) return;
                overlay = document.createElement('div');
                overlay.className = 'story-oldphoto-overlay';
                overlay.setAttribute('aria-hidden', 'true');
                this.elements.viewerContainer.appendChild(overlay);
                this.elements.oldPhotoOverlay = overlay;
            }
            if (spec) {
                if (Array.isArray(spec) && spec.length >= 3) {
                    const [r, g, b, a] = spec;
                    overlay.style.backgroundColor =
                        `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a ?? 0.36})`;
                } else {
                    overlay.style.backgroundColor = ''; // CSS default vintage tint
                }
                showElement(overlay);
            } else {
                hideElement(overlay);
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
                if (line.bgm) {
                    // A few game scripts write the stop directive as the bgm
                    // VALUE (`bgm = "stopbgm"`, e.g. jufengyuqingchunzhiquan3)
                    // — no such bundle exists, the in-game result is silence.
                    resolved = line.bgm === 'stopbgm' ? false : line.bgm;
                    resolvedOnCurrentLine = (i === this.scriptIndex);
                    break;
                }
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
        // Implemented in ./story.painting.js — computePaintingStateAt,
        // applyPaintingState, createPaintingContainer, evictSidePainting,
        // and the canvas compositing pipeline live there as module helpers.
        // These thin wrappers are the engine entry points; the painting
        // module takes the engine instance as an explicit `ctx` argument
        // instead of relying on `this`.
        getExpressionData(actorId) { return getExpressionData(this, actorId); },
        updatePaintings() { return updatePaintings(this); },
        clearPaintings() { return clearPaintings(this); },

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

        // ===== Line Effects (shake / dialog-shake / painting-shake / flash / flashN / SFX) =====
        // Implemented in ./story.effects.js — _clearPaintingShake,
        // _ensureFlashNOverlay, and _ensureFlashOverlay live there as
        // module-private helpers. These thin wrappers are the engine entry
        // points; the effects module takes the engine instance as an explicit
        // `ctx` argument. handleLineSoundEffect defers to ctx.playSfx (audio
        // playback stays in the engine).
        clearLineEffects() { return clearLineEffects(this); },
        handleLineShake(line) { return handleLineShake(this, line); },
        handleLineDialogShake(line) { return handleLineDialogShake(this, line); },
        handleLinePaintingShake(line) { return handleLinePaintingShake(this, line); },
        handleLineFlashN(line) { return handleLineFlashN(this, line); },
        handleLineSoundEffect(line) { return handleLineSoundEffect(this, line); },
        clearFlashOverlay() { return clearFlashOverlay(this); },
        handleLineFlash(line) { return handleLineFlash(this, line); },
        playFlashoutCover(line) { return playFlashoutCover(this, line); },

        /**
         * Play a short sound effect with bounded concurrency and guaranteed cleanup.
         * SFX that fail to decode or never fire 'ended' are still released via a
         * timeout fallback so the activeSfx array cannot grow unbounded.
         */
        playSfx(audioId) {
            resolveAudioCueUrl(audioId).then(url => {
                // FMOD `event:/...` cues and unextracted bundles resolve to
                // null — skip silently (these never resolved on the legacy
                // host either; a warn here would spam every battle scene).
                if (url) this._playSfxUrl(url);
            });
        },

        _playSfxUrl(url) {
            const MAX_CONCURRENT_SFX = 3;
            const MAX_SFX_LIFETIME_MS = 15000;

            // Release finished SFX. Paused-but-not-ended entries stay active
            // until their own cleanup timer fires.
            this.activeSfx = this.activeSfx.filter(sfx => !sfx.ended);

            if (this.activeSfx.length >= MAX_CONCURRENT_SFX) {
                const oldest = this.activeSfx.shift();
                if (oldest._cleanup) oldest._cleanup();
            }

            const sfx = new Audio(url);
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
                // Dedupe on the REQUESTED track, set before play() settles —
                // advancing lines that repeat the same BGM while it's still
                // loading must no-op, not restart the load each click.
                this.currentBgm = requested;
                // Pause before swapping src — a slow load of the new track must not
                // leave the previous one audible in the gap.
                this.audio.pause();
                resolveAudioCueUrl(requested).then(url => {
                    // A newer request (or a stop) may have claimed the dedupe
                    // key while the cue map loaded — only the latest touches
                    // the audio element.
                    if (this.currentBgm !== requested) return;
                    if (!url) {
                        // Cue missing from audio_for_toy (game-data typo or a
                        // bundle newer than the last extraction) — stay silent,
                        // keep the dedupe key so repeats of the line don't spam.
                        console.warn(`BGM cue not in audio map: ${requested}`);
                        return;
                    }
                    this.audio.src = url;
                    this.audio.play()
                        .catch(e => {
                            // AbortError = a pending play() superseded by our own
                            // pause()/load() (track switch, BGM-stop line, view
                            // change) or the user's pause — intentional, not a failure.
                            if (e.name === 'AbortError') return;
                            // Genuine failure (autoplay policy, network/decode).
                            // Clear the dedupe key — only if a newer request hasn't
                            // claimed it — so the next handleBgm call retries.
                            if (this.currentBgm === requested) this.currentBgm = null;
                            console.warn("Audio playback failed.", e);
                        });
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
