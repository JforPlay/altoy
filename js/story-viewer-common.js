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
            softPopup: document.getElementById('soft-popup'),
            summaryModalOverlay: document.getElementById('summary-modal-overlay'),
            closeSummaryModalBtn: document.getElementById('close-summary-modal-btn'),
            summaryModalContent: document.getElementById('summary-modal-content'),
            audioPlayerContainer: document.getElementById('audio-player-container'),
            playPauseBtn: document.getElementById('play-pause-btn'),
            muteBtn: document.getElementById('mute-btn'),
            volumeSlider: document.getElementById('volume-slider'),
            bgmNameSpan: document.getElementById('bgm-name'),
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
            el.searchBar?.addEventListener('input', (e) => this.populateEventGrid(e.target.value));
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
            this.audio.addEventListener('play', () => this.updateAudioPlayerUI());
            this.audio.addEventListener('pause', () => this.updateAudioPlayerUI());
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
            const eventId = urlParams.get('eventId') || urlParams.get('eventid');
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

        switchView(viewToShow) {
            [this.elements.eventSelectionView, this.elements.memorySelectionView, this.elements.storyViewerView].forEach(view => {
                if (view) view.classList.toggle('hidden', view !== viewToShow);
            });
            if (viewToShow !== this.elements.storyViewerView) {
                window.scrollTo(0, 0);
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
            if (this.config.viewerType === 'main') {
                this.showSoftPopup("스토리 재생시 브금자동재생에 주의하세요.");
            }
        },

        returnToMemorySelection() {
            this.updateUrl(this.currentEventId);
            this.switchView(this.elements.memorySelectionView);

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

            if (this.config.viewerType === 'main' && memory.mask) {
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

            this.renderScriptLine();
            this.switchView(this.elements.storyViewerView);
        },

        isLineDisplayable(line) {
            if (!line) return false;
            return line.say || (line.sequence && line.sequence[0] && line.sequence[0][0]) || (line.signDate && line.signDate[0]) || (line.options && line.options.length > 0);
        },

        advanceStory() {
            if (this.scriptIndex >= this.currentStoryScript.length - 1) return;
            let nextIndex = this.scriptIndex + 1;
            // For world viewer, skip non-displayable lines
            if (this.config.viewerType === 'world') {
                for (let i = this.scriptIndex + 1; i < this.currentStoryScript.length; i++) {
                    if (this.isLineDisplayable(this.currentStoryScript[i])) {
                        nextIndex = i;
                        break;
                    }
                    if (i === this.currentStoryScript.length - 1) nextIndex = i; // last line
                }
            }
            this.scriptIndex = nextIndex;
            this.renderScriptLine();
        },

        goBackStory() {
            if (this.scriptIndex <= 0) return;
            let prevIndex = this.scriptIndex - 1;
            // For world viewer, skip non-displayable lines
            if (this.config.viewerType === 'world') {
                for (let i = this.scriptIndex - 1; i >= 0; i--) {
                    if (this.isLineDisplayable(this.currentStoryScript[i])) {
                        prevIndex = i;
                        break;
                    }
                    if (i === 0) prevIndex = i; // first line
                }
            }
            this.scriptIndex = prevIndex;
            this.renderScriptLine();
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
                this.lastActorId = actorInfo.id;
            }

            // Update navigation buttons
            const hasOptions = line.options && line.options.length > 0;
            const isAtEnd = this.scriptIndex >= this.currentStoryScript.length - 1;
            el.prevLineBtn.disabled = (this.scriptIndex <= 0);
            el.nextLineBtn.classList.toggle('hidden', isAtEnd || hasOptions);
            el.returnBtn.classList.toggle('hidden', !isAtEnd);
            el.nextStoryBtn.classList.toggle('hidden', !(isAtEnd && this.nextMemory));
            el.nextPageIndicator.classList.toggle('hidden', isAtEnd || hasOptions);

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
            let nextIndex = -1;
            for (let i = this.scriptIndex + 1; i < this.currentStoryScript.length; i++) {
                if (this.currentStoryScript[i].optionFlag === chosenFlag) { nextIndex = i; break; }
            }
            if (nextIndex !== -1) { this.scriptIndex = nextIndex; this.renderScriptLine(); }
            else { this.advanceStory(); }
        },

        // =========================================================================
        // HELPERS (VISUAL & AUDIO)
        // =========================================================================
        getActorInfo(line) {
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
                    actorInfo.name = overrideChar.name;
                    actorInfo.icon = overrideChar.icon;
                } else {
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
            const backgroundElement = this.elements.storyViewerView.querySelector('.story-background');
            let backgroundImageUrl = null;
            let isBlackBackground = false;

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

            if (isBlackBackground) {
                backgroundElement.style.backgroundColor = 'black';
                backgroundElement.style.backgroundImage = 'none';
            } else {
                backgroundElement.style.backgroundColor = 'transparent';
                backgroundElement.style.backgroundImage = backgroundImageUrl || 'none';
            }
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
                        setTimeout(() => document.body.removeChild(flashEl), 300);
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
                            const sfx = new Audio(`${this.BGM_URL_PREFIX}${effect.audio}.ogg`);
                            sfx.volume = this.audio.volume;
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
            el.playPauseBtn.querySelector('.material-icons').textContent = this.audio.paused ? 'play_arrow' : 'pause';
            el.muteBtn.querySelector('.material-icons').textContent = this.audio.muted || this.audio.volume === 0 ? 'volume_off' : 'volume_up';
            el.volumeSlider.value = this.audio.muted ? 0 : this.audio.volume;
        },

        showError(message) {
            this.elements.errorContainer.textContent = message;
            this.elements.errorContainer.classList.remove('hidden');
            setTimeout(() => this.elements.errorContainer.classList.add('hidden'), 5000);
        },

        showSoftPopup(message, duration = 3000) {
            const popup = this.elements.softPopup;
            if (!popup) return;
            clearTimeout(this.popupTimeout);
            popup.textContent = message;
            popup.classList.remove('hidden');
            setTimeout(() => popup.classList.add('show'), 10);
            this.popupTimeout = setTimeout(() => {
                popup.classList.remove('show');
                setTimeout(() => popup.classList.add('hidden'), 500);
            }, duration);
        },

        // =========================================================================
        // MODALS
        // =========================================================================
        showFullScript() {
            if (!this.currentStoryScript || this.currentStoryScript.length === 0) return;
            const scriptHtml = this.currentStoryScript
                .filter(line => line.say && line.say.trim() !== "")
                .map(line => {
                    const actorInfo = this.getActorInfo(line);
                    const dialogue = line.say.replace(/<.*?>/g, '');
                    return `<p><strong>${actorInfo.name || 'Narrator'}:</strong> ${dialogue}</p>`;
                }).join('');
            this.elements.fullScriptContent.innerHTML = scriptHtml;
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
