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
import { debounce, fetchJSONWithCache, getUrlParam, setUrlParams, hideElement, showElement, toggleElement, makeKeyboardActivatable, DATA_FOR_TOY_BASE } from '../utils.js';
import { getExpressionData, updatePaintings, clearPaintings } from './story.painting.js';
import { resolveStoryPortrait } from './story.portrait.js';
import { ensurePaintingFrames } from './story.frames.js';
import { createTypewriter } from './story.typewriter.js';
import { loadSettings, settingsToCssVars, ensureFontLoaded, AUTO_DELAY_MS } from './story.settings.js';
import { setupReaderSettings } from './story.settings-ui.js';
import { createReadLogStore } from './story.readlog.js';
import { clearLineEffects, handleLineShake, handleLineDialogShake, handleLinePaintingShake, handleLineFlashN, handleLineSoundEffect, clearFlashOverlay, handleLineFlash, playFlashoutCover } from './story.effects.js';
import { correctKrNameColor } from './story.text.js';
import { collectTranscriptLines, transcriptToPlainText, buildTranscriptFragment, extractSequenceLines, formatSequenceLine } from './story.transcript.js';
import { resolveAudioCueUrl } from './story.bgm.js';
import { ensureExpressionManifest as loadExpressionManifest } from '../expression-manifest.js';
document.addEventListener('DOMContentLoaded', () => {
    window.StoryViewer = {
        // ===== State & Constants =====
        config: {}, // Page-specific configuration
        storylineData: {},
        storylineSummaryData: {}, // Only used by world viewer
        shipgirlData: {},
        shipgirlNameMap: {},
        expressionManifest: null, // Painting/expression data, loaded on first story playback
        paintingFrames: null, // painting_frames.json duihua rects, loaded with the manifest
        typewriter: null, // story.typewriter.js reveal for the current line (created in init)
        uiHidden: false, // H / eye chip: chrome + band hidden to look at the art
        settings: null, // reader settings (story.settings.js), applied by applyReaderSettings
        settingsPanel: null, // story.settings-ui.js { open, close, isOpen }
        readLog: null, // story.readlog.js store: which stories this reader finished (Drive-synced)
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

        // Transcript cache for the full-script modal (per-story AND group
        // views share it; key = 'story:<memoryId>' / 'group:<eventId>')
        cachedTranscript: null,

        // Performance cache for background state
        cachedBackground: {
            url: null,
            isBlack: false,
            lastIndex: -1
        },

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
            prevLineBtn: document.getElementById('prev-line-btn'),
            nextLineBtn: document.getElementById('next-line-btn'),
            nextStoryBtn: document.getElementById('next-story-btn'),
            returnBtn: document.getElementById('return-btn'),
            viewerContainer: document.getElementById('viewer-container'),
            errorContainer: document.getElementById('error-container'),
            memoryViewTitle: document.getElementById('memory-view-title'),
            themeToggles: document.querySelectorAll('.theme-toggle'),
            viewScriptBtn: document.getElementById('view-script-btn'),
            groupScriptBtn: document.getElementById('group-script-btn'),
            scriptModalOverlay: document.getElementById('script-modal-overlay'),
            closeModalBtn: document.getElementById('close-modal-btn'),
            scriptModalTitle: document.getElementById('script-modal-title'),
            copyScriptBtn: document.getElementById('copy-script-btn'),
            fullScriptContent: document.getElementById('full-script-content'),
            infoScreen: document.getElementById('info-screen'),
            infoScreenText: document.getElementById('info-screen-text'),
            fadeOverlay: document.getElementById('fade-overlay'),
            summaryModalOverlay: document.getElementById('summary-modal-overlay'),
            closeSummaryModalBtn: document.getElementById('close-summary-modal-btn'),
            summaryModalContent: document.getElementById('summary-modal-content'),
            audioPlayerContainer: document.getElementById('audio-player-container'),
            playPauseBtn: document.getElementById('play-pause-btn'),
            bgmBtn: document.getElementById('bgm-btn'),
            bgmNameSpan: document.getElementById('bgm-name'),
            progressIndicator: document.getElementById('progress-indicator'),
            paintingLayer: document.getElementById('painting-layer'),
            autoPlayBtn: document.getElementById('auto-play-btn'),
            settingsBtn: document.getElementById('settings-btn'),
            hideUiBtn: document.getElementById('hide-ui-btn'),
            readMark: document.getElementById('read-mark'),
            upNext: document.getElementById('up-next'),
            upNextTitle: document.getElementById('up-next-title'),
            upNextRead: document.getElementById('up-next-read'),
            upNextCount: document.getElementById('up-next-count'),
            upNextCancel: document.getElementById('up-next-cancel'),
            branchEnd: document.getElementById('branch-end'),
            branchBackBtn: document.getElementById('branch-back-btn'),
            lineStatus: document.getElementById('line-status'),
            readerSettings: document.getElementById('reader-settings'),
            // Cached elements (populated on first access)
            storyBackground: null,
        },

        // Auto-play: on/off, kept across stories within the page (the E2 card
        // chains them), reset on reload. The per-line delay is the reader's
        // 자동 진행 speed (story.settings.js AUTO_DELAY_MS).
        autoPlay: false,
        _autoPlayTimer: null,
        _upNextTimer: null,
        _upNextCancelled: false, // 취소 on the card sticks until the next render
        UP_NEXT_COUNTDOWN_MS: 8000,
        failedPortraitUrls: new Set(), // storyicons that 404'd once stay hidden for the page

        // Painting state — one painting per side (0=left, 1=right, 2=center).
        // Paintings are rebuilt from the script on every render, matching the
        // game's dialoguestoryplayer.lua. Non-active sides dim to the current
        // step's painting.alpha; the active speaker is always at 1.0.
        paintingsBySide: new Map(), // Map<side:number, {actorId, element, expression, side, dir, placeKey, want}>
        stageNeed: null,     // stage px the painting layer fits across the viewer (story.painting.js fitStage)
        stageObserver: null, // re-crops on resize when the fit pad moves
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
            this.typewriter = createTypewriter();
            this.applyReaderSettings(loadSettings());
            this.readLog = createReadLogStore({ onRemoteChange: () => this.refreshReadMarks() });
            this.loadData()
                .then(() => {
                    this.populateEventGrid();
                    this.handleUrlParameters();
                    this.setupEventListeners();
                    this.settingsPanel = setupReaderSettings(this);
                    this.setupBrowserBackButton();
                    this.updateAutoPlayButton();
                })
                .catch(error => {
                    console.error('Initialization failed:', error);
                    this.showError('Failed to load critical story data. Please refresh.');
                });
        },

        /**
         * Fetch the boot data paths declared by config, delegate to
         * config.processLoadedData, and populate the shipgirl name map.
         */
        async loadData() {
            const fetchPromises = this.config.dataPaths.map(path => fetchJSONWithCache(path));
            const jsonDataArray = await Promise.all(fetchPromises);

            this.config.processLoadedData(this, jsonDataArray);

            for (const id in this.shipgirlData) {
                this.shipgirlNameMap[this.shipgirlData[id].name] = id;
            }
        },

        /**
         * Load painting/expression metadata when story playback first needs it,
         * via the shared expression-manifest loader (one cached request; failure
         * resolves null and the next activation retries without the IndexedDB
         * entry). A missing manifest degrades to dialogue without paintings.
         */
        async ensureExpressionManifest() {
            this.expressionManifest = await loadExpressionManifest();
            return this.expressionManifest;
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

            // Tap zones: the left third goes back, the rest advances (or finishes
            // a typing line). While the UI is hidden, any tap only restores it.
            el.storyViewerView?.addEventListener('click', (e) => {
                if (this.uiHidden) { this.setUiHidden(false); return; }
                if (this.settingsPanel?.isOpen()) { this.settingsPanel.close(); return; }
                if (e.target.closest('button, a, input, .options-box, .reader-settings, .up-next, .story-chrome')) return;
                const rect = el.viewerContainer.getBoundingClientRect();
                if (e.clientX - rect.left < rect.width / 3) { this.goBackStory(); return; }
                this.nextOrFinish();
            });
            el.hideUiBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.setUiHidden(true); });
            el.prevLineBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.goBackStory(); });
            el.nextLineBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.nextOrFinish(); });
            el.nextStoryBtn?.addEventListener('click', (e) => { e.stopPropagation(); if (this.nextMemory) this.startStory(this.nextMemory); });
            el.returnBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.returnToMemorySelection(); });
            el.autoPlayBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.toggleAutoPlay(); });
            el.branchBackBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.jumpToLastChoice(); });
            el.upNextCancel?.addEventListener('click', (e) => { e.stopPropagation(); this._upNextCancelled = true; this.cancelUpNextCountdown(); });
            // A hidden tab pauses both clocks: the line wait and the E2 countdown.
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) this.cancelAutoAdvance(); else this.scheduleAutoAdvance();
            });

            el.viewScriptBtn?.addEventListener('click', () => this.showFullScript());
            el.groupScriptBtn?.addEventListener('click', () => this.showGroupScript());
            el.copyScriptBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.copyTranscript(); });
            el.closeModalBtn?.addEventListener('click', () => this.hideFullScript());
            el.scriptModalOverlay?.addEventListener('click', (e) => { if (e.target === el.scriptModalOverlay) this.hideFullScript(); });
            el.closeSummaryModalBtn?.addEventListener('click', () => this.hideSummaryModal());
            el.summaryModalOverlay?.addEventListener('click', (e) => { if (e.target === el.summaryModalOverlay) this.hideSummaryModal(); });

            el.playPauseBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.audio.paused ? this.audio.play().catch(console.warn) : this.audio.pause(); });
            el.bgmBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.setBgmPopOpen(!this.isBgmPopOpen()); });
            // The BGM pop-up closes on any click outside it (capture phase, so a
            // toolbar button's stopPropagation can't keep it open). A tap on the
            // art that closes it is consumed, like the settings panel's, so it
            // doesn't also turn the page.
            document.addEventListener('click', (e) => {
                if (!this.isBgmPopOpen() || e.target.closest('.bgm-ctl')) return;
                this.setBgmPopOpen(false);
                if (el.storyViewerView?.contains(e.target) && !e.target.closest('button, a, input')) e.stopPropagation();
            }, true);

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
                // Browser/OS shortcuts (Ctrl+L, Alt+←, Ctrl+A …) are never story keys.
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                // A control reached by keyboard (chips, card buttons, the settings
                // panel) handles its own Space/Enter; a mouse-focused one does not,
                // so Space still advances after clicking a chip.
                const onControl = t?.closest?.('button, a, [role="button"], [role="checkbox"], [role="tab"], .reader-settings');
                if (onControl && t.matches?.(':focus-visible') && ['Space', 'Enter', 'NumpadEnter'].includes(e.code)) return;

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

                if (this.settingsPanel?.isOpen() && e.key === 'Escape') { e.preventDefault(); this.settingsPanel.close(); return; }
                if (this.isBgmPopOpen() && e.key === 'Escape') { e.preventDefault(); this.setBgmPopOpen(false); el.bgmBtn?.focus(); return; }
                if (this.uiHidden && (e.key === 'Escape' || e.code === 'KeyH')) { e.preventDefault(); this.setUiHidden(false); return; }
                // e.code names the physical key, so the letters work with the Korean IME on.
                switch (e.code) {
                    case 'Space': case 'ArrowRight': case 'Enter': case 'NumpadEnter':
                        // While options are displayed, let the user pick with a click;
                        // don't advance past a decision point.
                        if (hasOptions) return;
                        e.preventDefault(); this.nextOrFinish(); break;
                    case 'ArrowLeft':
                        e.preventDefault(); this.goBackStory(); break;
                    case 'Escape':
                        e.preventDefault(); this.returnToMemorySelection(); break;
                    case 'KeyA':
                        e.preventDefault(); this.toggleAutoPlay(); break;
                    case 'KeyS': case 'KeyL':
                        e.preventDefault(); this.showFullScript(); break;
                    case 'KeyH':
                        e.preventDefault(); this.setUiHidden(true); break;
                }
            };
            document.addEventListener('keydown', this._keydownHandler);
        },

        // ===== Auto-Play =====

        /** Sync the AUTO chip's pressed state (its label stays "AUTO"). */
        updateAutoPlayButton() {
            this.elements.autoPlayBtn?.setAttribute('aria-pressed', String(this.autoPlay));
        },

        /** Toggle auto-play. It stays on across stories in this page (E2 chains them). */
        toggleAutoPlay() {
            this.autoPlay = !this.autoPlay;
            this.updateAutoPlayButton();
            this.cancelAutoAdvance();
            if (this.autoPlay) this.scheduleAutoAdvance();
        },

        /**
         * The one owner of both auto-play clocks: queue the next advance after the
         * reader's 자동 진행 delay or — at the end of the path — the E2 card's 8 s
         * countdown. No-op while typing (onLineShown re-calls it), at a choice,
         * with settings or the LOG open, or when the tab is hidden; every one of
         * those re-calls it when it clears. The hairline shows the line wait.
         */
        scheduleAutoAdvance() {
            this.cancelAutoAdvance();
            if (!this.autoPlay || !this.isStoryViewActive() || document.hidden) return;
            if (this.settingsPanel?.isOpen() || this.typewriter?.isTyping()) return;
            if (this.elements.scriptModalOverlay && !this.elements.scriptModalOverlay.classList.contains('hidden')) return;
            if (this.elements.optionsBox?.children.length > 0) return;
            if (!this.hasReachableNextDisplayable()) {
                const cardShown = this.elements.upNext && !this.elements.upNext.classList.contains('hidden');
                if (cardShown && !this._upNextCancelled) this.startUpNextCountdown();
                return;
            }
            const delay = AUTO_DELAY_MS[this.settings?.autoSpeed] || 4000;
            this.elements.dialogueBox.classList.remove('is-counting');
            void this.elements.dialogueBox.offsetWidth;   // restart the hairline animation
            this.elements.dialogueBox.classList.add('is-counting');
            this._autoPlayTimer = setTimeout(() => {
                this._autoPlayTimer = null;
                // Guard again at fire time — state may have changed.
                if (!this.autoPlay || !this.isStoryViewActive()) return;
                if (this.elements.optionsBox?.children.length > 0) return;
                this.advanceStory();
            }, delay);
        },

        /** Stop both auto-play clocks (the line wait and the E2 countdown). */
        cancelAutoAdvance() {
            if (this._autoPlayTimer != null) { clearTimeout(this._autoPlayTimer); this._autoPlayTimer = null; }
            this.elements.dialogueBox?.classList.remove('is-counting');
            this.cancelUpNextCountdown();
        },

        /** E2: count 8 s down inside the card, then play the next story. */
        startUpNextCountdown() {
            this.cancelUpNextCountdown();
            const el = this.elements;
            if (!this.autoPlay || !this.nextMemory || !el.upNext) return;
            el.upNext.classList.add('is-counting');
            el.upNextCount.textContent = `${this.UP_NEXT_COUNTDOWN_MS / 1000}초 후 자동 재생`;
            showElement(el.upNextCount);
            showElement(el.upNextCancel);
            const next = this.nextMemory;
            this._upNextTimer = setTimeout(() => {
                this._upNextTimer = null;
                if (this.isStoryViewActive() && this.nextMemory === next) this.startStory(next);
            }, this.UP_NEXT_COUNTDOWN_MS);
        },

        cancelUpNextCountdown() {
            if (this._upNextTimer != null) { clearTimeout(this._upNextTimer); this._upNextTimer = null; }
            const el = this.elements;
            el.upNext?.classList.remove('is-counting');
            if (el.upNextCount) hideElement(el.upNextCount);
            if (el.upNextCancel) hideElement(el.upNextCancel);
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
                this.decorateReadCount(card, eventId, Number(event.memoryCount) || this.config.getEventMemories(event)?.length || 0);
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
            this.cachedTranscript = null;

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
                    this.decorateReadCheckbox(card, eventId, memory.id);
                    this.elements.memoryGrid.appendChild(card);
                });
            }

            // Group transcript button (markup opt-in per page): show only when
            // at least one entry actually carries a sync script — deeplink /
            // index-only events and Promise-based getMemoryStory pages don't.
            if (this.elements.groupScriptBtn) {
                const hasScripts = Array.isArray(memories) && memories.some(m => {
                    const s = this.config.getMemoryStory(m);
                    return !!(s && typeof s === 'object' && Array.isArray(s.scripts) && s.scripts.length);
                });
                toggleElement(this.elements.groupScriptBtn, hasScripts);
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
            this.hideUpNext();
            this.cancelAutoAdvance();
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

            const event = this.storylineData[this.currentEventId];
            const memories = this.config.getEventMemories(event);
            const index = memories.findIndex(mem => mem.id == memory.id);
            const eventName = event?.name || 'Event';

            if (updateUrl) this.updateUrl(this.currentEventId, memory.id);

            const imagesToPreload = new Set();
            if (memory.mask) imagesToPreload.add(`${this.BASE_URL}${memory.mask}.webp`);
            const firstBgLine = story.scripts.find(line => line.bgName);
            if (firstBgLine) imagesToPreload.add(`${this.BASE_URL}bg/${firstBgLine.bgName}.webp`);
            imagesToPreload.forEach(src => { new Image().src = src; });

            await this.beginScript({
                scripts: story.scripts,
                memoryId: memory.id,
                title: `${eventName} - ${memory.title || memory.name || 'Chapter'}`,
                mask: memory.mask,
                nextMemory: (index >= 0 && index < memories.length - 1) ? memories[index + 1] : null,
            });
            this.switchView(this.elements.storyViewerView);
            // Line 0 rendered while the grid was still showing, so auto-play saw an
            // inactive view; arm it now (a no-op while the line is typing).
            this.scheduleAutoAdvance();
        },

        /**
         * Reset every per-story field, make sure the stage data is loaded, and
         * render line 0. Shared by startStory and child-story.js playStory so a
         * per-story behaviour lives in exactly one place.
         */
        async beginScript({ scripts, memoryId, eventId, title, mask, nextMemory }) {
            // The event/chapter grids do not consume painting metadata. Wait
            // for it only at the first playback boundary so the initial line's
            // portrait and painting render deterministically. Failure remains
            // non-fatal and is retried by a later story activation.
            const [, frames] = await Promise.all([this.ensureExpressionManifest(), ensurePaintingFrames()]);
            this.paintingFrames = frames;
            this.cancelFlashTransition();
            this.cancelAutoAdvance();
            this.currentStoryScript = scripts;
            if (eventId != null) this.currentEventId = eventId;
            this.currentMemoryId = memoryId;
            this.scriptIndex = 0;
            this.lastPortraitUrl = null;
            this.currentBgm = null;
            this.activeOptionFlag = null;
            this.lastOptionIndex = -1;
            this.currentStoryDefaultBgUrl = mask ? `${this.BASE_URL}${mask}.webp` : null;
            this.cachedBackground = { url: null, isBlack: false, lastIndex: -1 };
            this.scriptNavCache = null;
            this.cachedTranscript = null;
            this.nextMemory = nextMemory || null;
            this.clearPaintings();
            this.elements.storyTitle.textContent = title;
            this.buildNavigationCache();
            this.renderScriptLine();
            this.refreshReadMarks(this.elements.storyViewerView);
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
            }
            // At the end of the reachable path the line already shows its end
            // state (E2 card / branch panel) — re-rendering would retype it.
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
            this.hideUpNext();
            this.typewriter?.cancel();
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

                // The band image is the step's own `portrait` (storyicon), never
                // the speaker's painting — game dialoguestoryplayer.lua UpdatePortrait.
                this.renderBandPortrait(resolveStoryPortrait(line, this.BASE_URL), actorInfo.name);

                // The KR client remaps several legacy nameColor values
                // (dialoguestep.lua:14-32) — apply the same correction.
                el.actorName.style.color = line.nameColor ? correctKrNameColor(line.nameColor) : '';
            }

            const hasOptions = line.options && line.options.length > 0;
            const isAtFileEnd = this.scriptIndex >= this.currentStoryScript.length - 1;
            el.prevLineBtn.disabled = (this.scriptIndex <= 0);

            const nextDisplayableExists = this.hasReachableNextDisplayable();
            const isAtPathEnd = !nextDisplayableExists;

            toggleElement(el.nextLineBtn, !(hasOptions || !nextDisplayableExists));

            // End of a branch (but not of the script): offer the last decision
            // point. "End of branch" vs "end of file" = are there lines beyond us
            // that this path cannot reach.
            const isBranchDeadEnd = isAtPathEnd && !isAtFileEnd && !hasOptions;
            toggleElement(el.branchEnd, isBranchDeadEnd);
            this.showUpNext((isAtFileEnd || isAtPathEnd) && !hasOptions);
            // The ▼ continue cue is the text's own ::after (story-player.css).
            el.dialogueBox.classList.toggle('can-continue', !(isAtPathEnd || hasOptions));

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

            if (line.say && !hasSequenceContent) this.revealLine();
            else this.scheduleAutoAdvance();
        },

        /** Type the current line out (reader setting), or show it at once. */
        revealLine() {
            const el = this.elements;
            const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
            const s = this.settings || { reveal: 'instant', cps: 40 };
            if (s.reveal === 'type' && !reduced) {
                el.dialogueText.setAttribute('aria-busy', 'true');
                el.storyViewerView.dataset.typing = '1';
                this.typewriter.start(el.dialogueText, s.cps, () => this.onLineShown());
            } else {
                this.onLineShown();
            }
        },

        /** The current line is fully visible: announce it once, then let auto-play continue. */
        onLineShown() {
            const el = this.elements;
            el.dialogueText.setAttribute('aria-busy', 'false');
            el.storyViewerView.dataset.typing = '0';
            if (el.lineStatus) el.lineStatus.textContent = `${el.actorName.textContent} ${el.dialogueText.textContent}`.trim();
            this.scheduleAutoAdvance();
        },

        /** Advance, or finish a line that is still typing. */
        nextOrFinish() {
            if (this.typewriter?.isTyping()) { this.typewriter.finish(); return; }
            if (this.elements.optionsBox.children.length === 0) this.advanceStory();
        },

        /** Hide the chrome/band/choices to look at the art; a tap or H restores. */
        setUiHidden(hidden) {
            this.uiHidden = hidden;
            this.elements.storyViewerView.dataset.ui = hidden ? 'hidden' : 'shown';
        },

        /** Apply reader settings to the player root, audio and pacing. */
        applyReaderSettings(s) {
            this.settings = s;
            const root = this.elements.storyViewerView;
            if (!root) return;
            for (const [name, value] of Object.entries(settingsToCssVars(s))) {
                if (value == null) root.style.removeProperty(name); else root.style.setProperty(name, value);
            }
            root.style.setProperty('--auto-ms', `${AUTO_DELAY_MS[s.autoSpeed]}ms`);
            ensureFontLoaded(s.font);
            this.audio.volume = s.volume / 100;
            this.audio.muted = s.volume === 0;
        },

        /** The E2 ending card. Countdown + read marking arrive in Tasks C6/C7. */
        showUpNext(atEnd) {
            const el = this.elements;
            if (!atEnd || !el.upNext) return;
            el.upNextTitle.textContent = this.nextMemory
                ? (this.nextMemory.title || this.nextMemory.name || '')
                : '마지막 이야기입니다';
            toggleElement(el.nextStoryBtn, !!this.nextMemory);
            showElement(el.upNext);
            toggleElement(el.upNextRead, this.markCurrentStoryRead());
            // The countdown starts from scheduleAutoAdvance once the last line is shown.
        },

        hideUpNext() {
            this._upNextCancelled = false;
            this.cancelUpNextCountdown();
            if (this.elements.upNext) hideElement(this.elements.upNext);
        },

        // ===== Read tracking (story.readlog.js) =====

        /** Read-log scope: memory ids are only unique within one story source. */
        readScope() { return this.config.viewerType || 'story'; },

        /** Mark the open story read; returns true when this call newly marked it. */
        markCurrentStoryRead() {
            const scope = this.readScope();
            if (!this.readLog || this.currentEventId == null || this.currentMemoryId == null) return false;
            if (this.readLog.isRead(scope, this.currentEventId, this.currentMemoryId)) return false;
            this.readLog.setRead(scope, this.currentEventId, this.currentMemoryId, true);
            this.refreshReadMarks();
            return true;
        },

        /** A role=checkbox toggle on a memory card (secretary's pattern, shared). */
        decorateReadCheckbox(card, eventId, memoryId) {
            const box = document.createElement('div');
            box.className = 'card-checkbox';
            box.dataset.readEvent = String(eventId);
            box.dataset.readMemory = String(memoryId);
            box.setAttribute('aria-label', '읽음 표시');
            makeKeyboardActivatable(box, (e) => {
                e.stopPropagation();
                this.readLog.toggleRead(this.readScope(), eventId, memoryId);
                this.refreshReadMarks();
            }, { role: 'checkbox' });
            card.appendChild(box);
            this.refreshReadMarks(card);
        },

        /** A "3 / 8" badge on an event card; a full check once all are read. */
        decorateReadCount(card, eventId, total) {
            if (!total) return;
            const badge = document.createElement('span');
            badge.className = 'read-count';
            badge.dataset.readEvent = String(eventId);
            badge.dataset.readTotal = String(total);
            card.appendChild(badge);
            this.refreshReadMarks(card);
        },

        /** Re-sync every read mark under `root` (a card, or the whole page). */
        refreshReadMarks(root = document) {
            if (!this.readLog) return;
            const scope = this.readScope();
            root.querySelectorAll('.card-checkbox[data-read-memory]').forEach((box) => {
                const read = this.readLog.isRead(scope, box.dataset.readEvent, box.dataset.readMemory);
                box.classList.toggle('completed', read);
                box.setAttribute('aria-checked', String(read));
                box.closest('.grid-card, [class*="-card"]')?.classList.toggle('completed-card', read);
            });
            root.querySelectorAll('.read-count[data-read-total]').forEach((badge) => {
                const n = this.readLog.countRead(scope, badge.dataset.readEvent);
                const total = Number(badge.dataset.readTotal);
                badge.textContent = n >= total ? '✓ 다 읽음' : `${n} / ${total}`;
                toggleElement(badge, n > 0);
                badge.classList.toggle('is-complete', n >= total);
            });
            if (this.elements.readMark && this.currentMemoryId != null) {
                toggleElement(this.elements.readMark, this.readLog.isRead(scope, this.currentEventId, this.currentMemoryId));
            }
        },

        /** ↶ 마지막 선택지로: re-show the last decision point's options. */
        jumpToLastChoice() {
            if (this.lastOptionIndex < 0) return;
            this.activeOptionFlag = null;
            this.scriptIndex = this.lastOptionIndex;
            this.renderScriptLine();
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

        // Sequence/title-card parsing is implemented in ./story.transcript.js
        // (pure, node-tested — shared with the transcript modal); these thin
        // wrappers keep the engine entry points stable.
        extractSequenceLines(line) { return extractSequenceLines(line); },

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
         * Show (or clear) the band portrait. Rebuilds the <img> only when the
         * resolved URL changes, so a same-portrait run never reloads. A failed
         * load hides the slot — a portrait can ship before its extraction runs.
         */
        renderBandPortrait(portrait, alt) {
            const box = this.elements.actorPortrait;
            // A storyicon that 404'd stays hidden for the page: a speaker run shares
            // it, and re-arming the bust padding on every line would leave a gap.
            const url = portrait && !this.failedPortraitUrls.has(portrait.url) ? portrait.url : null;
            this.elements.dialogueBox.classList.toggle('has-portrait', !!url);
            this.elements.dialogueBox.classList.toggle('has-mini-portrait', !!url && portrait.mini);
            box.classList.toggle('is-mini', !!url && portrait.mini);
            box.classList.toggle('portrait-noise', !!url && portrait.noise);
            if (url === this.lastPortraitUrl) return;
            this.lastPortraitUrl = url;
            box.textContent = '';
            if (!url) { hideElement(box); return; }
            const img = document.createElement('img');
            img.alt = alt || '';
            img.decoding = 'async';
            img.addEventListener('error', () => {
                this.failedPortraitUrls.add(url);
                if (this.lastPortraitUrl !== url) return;
                hideElement(box);
                this.elements.dialogueBox.classList.remove('has-portrait', 'has-mini-portrait');
            }, { once: true });
            img.src = url;
            box.appendChild(img);
            showElement(box);
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

        formatSequenceLine(rawText) { return formatSequenceLine(rawText); },


        // ===== Helpers: Visual & Audio =====

        /**
         * Resolve display info (id, name) for a script line's speaker.
         * Handles the many ways the game identifies actors: numeric IDs, string
         * names, actorName overrides, Commander (actor 0), world-viewer Narrator,
         * {namecode:N} placeholders, and pure narration lines with no speaker.
         */
        getActorInfo(line) {
            const isKorean = (text) => /[\uAC00-\uD7AF]/.test(text || '');

            // Narration: no actor or actorName.
            if (line.actor == null && !line.actorName) {
                return { id: 'no-actor', name: '' };
            }

            // Named character with no numeric actor ID — show the name as given.
            if (line.actor == null && line.actorName && isKorean(line.actorName)) {
                return { id: line.actorName, name: line.actorName };
            }

            let actorInfo = { id: null, name: '' };

            // Step 1: Base actor from line.actor
            let baseActorId = null;
            if (typeof line.actor === 'number') {
                baseActorId = line.actor;
            } else if (typeof line.actor === 'string') {
                baseActorId = this.shipgirlNameMap[line.actor] || null;
            }

            if (this.shipgirlData[baseActorId]) {
                const char = this.shipgirlData[baseActorId];
                actorInfo = { id: baseActorId, name: char.name };
            }

            // Step 2: actorName overrides
            if (line.actorName) {
                const actorNameId = parseInt(line.actorName, 10);
                if (!isNaN(actorNameId) && this.shipgirlData[actorNameId]) {
                    const overrideChar = this.shipgirlData[actorNameId];
                    actorInfo.id = actorNameId;
                    actorInfo.name = overrideChar.name;
                } else {
                    actorInfo.id = line.actorName;
                    actorInfo.name = line.actorName;
                }
            }

            // Step 3: Special cases — Commander, world-viewer Narrator
            if ((line.actor === 0 || line.portrait === 'zhihuiguan') && !line.actorName) {
                actorInfo = { id: 0, name: '지휘관' };
            } else if (this.config.viewerType === 'world' && line.say && !line.actor && !line.actorName) {
                actorInfo.name = (line.say.includes('·') || line.say.includes('————')) ? 'Narrator' : '지휘관';
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
                // Inside the stage (spec: overlays inside the stage), so it tints
                // the scene and never the band or chrome above it.
                const stage = this.elements.storyViewerView?.querySelector('.story-stage-canvas');
                (stage || this.elements.viewerContainer).appendChild(overlay);
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
            if (!bgmName) this.setBgmPopOpen(false);

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

        /** Open or close the toolbar's BGM pop-up (play/pause, track name, volume). */
        setBgmPopOpen(open) {
            this.elements.audioPlayerContainer?.classList.toggle('open', open);
            this.elements.bgmBtn?.setAttribute('aria-expanded', String(open));
        },

        isBgmPopOpen() { return !!this.elements.audioPlayerContainer?.classList.contains('open'); },

        /** Sync the BGM controls: animated bars + pause icon while playing, the note + play icon while paused. */
        updateAudioPlayerUI() {
            const playing = !this.audio.paused;
            this.elements.playPauseBtn?.setAttribute('aria-pressed', String(playing));
            this.elements.audioPlayerContainer?.classList.toggle('playing', playing);
        },

        /** Display an error message in the error container for 5 seconds. */
        showError(message) {
            this.elements.errorContainer.textContent = message;
            showElement(this.elements.errorContainer);
            setTimeout(() => hideElement(this.elements.errorContainer), 5000);
        },

        /** Update the line-count and progress-bar UI based on the current script position. */
        updateProgressIndicator() {
            if (this.elements.progressIndicator) this.elements.progressIndicator.textContent = `${this.scriptIndex + 1} / ${this.currentStoryScript.length}`;
        },

        // ===== Modals =====

        /**
         * Open the full-script modal for the CURRENT story. Transcript DOM +
         * copy text are built once per story (cachedTranscript) and cloned on
         * subsequent opens.
         */
        showFullScript() {
            if (!this.currentStoryScript || this.currentStoryScript.length === 0) return;
            this.cancelAutoAdvance();   // reading the log pauses auto-play; hideFullScript resumes

            const key = `story:${this.currentEventId}:${this.currentMemoryId}`;
            if (this.cachedTranscript?.key !== key) {
                const sections = [{
                    title: null,
                    lines: collectTranscriptLines(this.currentStoryScript, (line) => this.getActorInfo(line).name),
                }];
                const title = this.elements.storyTitle?.textContent || '';
                this.cachedTranscript = {
                    key,
                    title,
                    frag: buildTranscriptFragment(sections),
                    text: transcriptToPlainText(title, sections),
                };
            }
            this.openTranscriptModal();
        },

        /**
         * Open the full-script modal for EVERY entry of the current event/
         * chapter, concatenated in entry order ("전체 대사 모아보기"). Entries
         * whose story data is missing (e.g. pruned dungeon configs) render a
         * muted marker instead of being silently dropped.
         */
        showGroupScript() {
            const event = this.storylineData[this.currentEventId];
            const memories = this.config.getEventMemories(event);
            if (!Array.isArray(memories) || memories.length === 0) return;

            const key = `group:${this.currentEventId}`;
            if (this.cachedTranscript?.key !== key) {
                const sections = memories.map(memory => {
                    const story = this.config.getMemoryStory(memory);
                    const scripts = (story && typeof story === 'object' && Array.isArray(story.scripts))
                        ? story.scripts : null;
                    return {
                        title: memory.title || memory.name || '',
                        lines: scripts
                            ? collectTranscriptLines(scripts, (line) => this.getActorInfo(line).name)
                            : null,
                    };
                });
                const title = `${event.name || ''} — 전체 대사`.trim();
                this.cachedTranscript = {
                    key,
                    title,
                    frag: buildTranscriptFragment(sections),
                    text: transcriptToPlainText(title, sections),
                };
            }
            this.openTranscriptModal();
        },

        /** Mount the cached transcript into the modal and show it. */
        openTranscriptModal() {
            const el = this.elements;
            if (el.scriptModalTitle) el.scriptModalTitle.textContent = this.cachedTranscript.title;
            this.resetCopyButton();
            el.fullScriptContent.textContent = '';
            el.fullScriptContent.appendChild(this.cachedTranscript.frag.cloneNode(true));
            el.fullScriptContent.scrollTop = 0;
            showElement(el.scriptModalOverlay);
        },
        hideFullScript() { hideElement(this.elements.scriptModalOverlay); this.scheduleAutoAdvance(); },

        /** Copy the open transcript as plain text (deterministic 화자: 대사 grammar). */
        copyTranscript() {
            if (!this.cachedTranscript) return;
            navigator.clipboard.writeText(this.cachedTranscript.text)
                .then(() => this.flashCopyButton('복사됨!'))
                .catch(() => this.flashCopyButton('복사 실패'));
        },

        /** Swap the copy button label for ~1.5s as click feedback. */
        flashCopyButton(message) {
            const label = this.elements.copyScriptBtn?.querySelector('.copy-script-label');
            if (!label) return;
            if (this._copyLabelDefault == null) this._copyLabelDefault = label.textContent;
            if (this._copyResetTimer) clearTimeout(this._copyResetTimer);
            label.textContent = message;
            this._copyResetTimer = setTimeout(() => {
                this._copyResetTimer = null;
                label.textContent = this._copyLabelDefault;
            }, 1500);
        },

        /** Restore the copy button label immediately (modal re-open). */
        resetCopyButton() {
            if (this._copyResetTimer) {
                clearTimeout(this._copyResetTimer);
                this._copyResetTimer = null;
            }
            const label = this.elements.copyScriptBtn?.querySelector('.copy-script-label');
            if (label && this._copyLabelDefault != null) label.textContent = this._copyLabelDefault;
        },

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
