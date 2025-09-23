document.addEventListener('DOMContentLoaded', () => {
    // =========================================================================
    // STATE & CONSTANTS
    // =========================================================================
    let storylineData = {};
    let shipgirlData = {};
    let shipgirlNameMap = {};
    let currentEventId = null;
    let currentMemoryId = null;
    let currentStoryScript = [];
    let scriptIndex = 0;
    let lastActorId = null;
    let nextMemory = null;
    let currentBgm = null;

    const BASE_URL = "https://raw.githubusercontent.com/JforPlay/data_for_toy/main/";
    const BGM_URL_PREFIX = "https://github.com/Fernando2603/AzurLane/raw/refs/heads/main/audio/bgm/";
    // const SFX_URL_PREFIX = "https://github.com/Fernando2603/AzurLane/raw/refs/heads/main/audio/bgm/";

    // =========================================================================
    // DOM ELEMENTS
    // =========================================================================
    const eventSelectionView = document.getElementById('event-selection-view');
    const memorySelectionView = document.getElementById('memory-selection-view');
    const storyViewerView = document.getElementById('story-viewer-view');
    const eventGrid = document.getElementById('event-grid');
    const memoryGrid = document.getElementById('memory-grid');
    const searchBar = document.getElementById('search-bar');
    const backToEventBtn = document.getElementById('back-to-event-selection');
    const backToMemoryBtn = document.getElementById('back-to-memory-selection');
    const storyTitle = document.getElementById('story-title');
    const dialogueBox = document.getElementById('dialogue-box');
    const actorPortrait = document.getElementById('actor-portrait');
    const actorName = document.getElementById('actor-name');
    const dialogueText = document.getElementById('dialogue-text');
    const optionsBox = document.getElementById('options-box');
    const nextPageIndicator = document.getElementById('next-page-indicator');
    const prevLineBtn = document.getElementById('prev-line-btn');
    const nextLineBtn = document.getElementById('next-line-btn');
    const nextStoryBtn = document.getElementById('next-story-btn');
    const returnBtn = document.getElementById('return-btn');
    const viewerContainer = document.getElementById('viewer-container');
    const errorContainer = document.getElementById('error-container');
    const memoryViewTitle = document.getElementById('memory-view-title');
    const themeToggles = document.querySelectorAll('.theme-toggle');
    const viewScriptBtn = document.getElementById('view-script-btn');
    const scriptModalOverlay = document.getElementById('script-modal-overlay');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const fullScriptContent = document.getElementById('full-script-content');
    const infoScreen = document.getElementById('info-screen');
    const infoScreenText = document.getElementById('info-screen-text');
    const fadeOverlay = document.getElementById('fade-overlay');

    // Audio Player Elements
    const audioPlayerContainer = document.getElementById('audio-player-container');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const muteBtn = document.getElementById('mute-btn');
    const volumeSlider = document.getElementById('volume-slider');
    const audio = new Audio();
    audio.loop = true;
    audio.volume = 0.01;

    // =========================================================================
    // CORE LOGIC
    // =========================================================================

    /** Applies light or dark theme to the document. */
    const applyTheme = (theme) => {
        document.body.classList.toggle('dark-mode', theme === 'dark');
        const mainNavbar = document.querySelector('#navbar-placeholder .navbar');
        if (mainNavbar) {
            mainNavbar.classList.toggle('navbar-light', theme !== 'dark');
        }
        themeToggles.forEach(toggle => {
            toggle.querySelector('.theme-icon-sun')?.classList.toggle('hidden', theme === 'dark');
            toggle.querySelector('.theme-icon-moon')?.classList.toggle('hidden', theme !== 'dark');
        });
    };

    /** Displays an error message for 5 seconds. */
    const showError = (message) => {
        errorContainer.textContent = message;
        errorContainer.classList.remove('hidden');
        setTimeout(() => errorContainer.classList.add('hidden'), 5000);
    };

    /** Switches between the main application views. */
    const switchView = (viewToShow) => {
        [eventSelectionView, memorySelectionView, storyViewerView].forEach(view => {
            view.classList.toggle('hidden', view !== viewToShow);
        });
        if (viewToShow !== storyViewerView) {
            window.scrollTo(0, 0);
            audio.pause();
            if (audioPlayerContainer) audioPlayerContainer.classList.add('hidden');
        }
    };

    /** Main data loading and initialization function. */
    async function init() {
        try {
            const [storyResponse, shipgirlResponse] = await Promise.all([
                fetch('data/processed_storyline_data.json'),
                fetch('data/shipgirl_data.json')
            ]);

            if (!storyResponse.ok || !shipgirlResponse.ok) throw new Error('Network response was not ok.');

            storylineData = await storyResponse.json();
            shipgirlData = await shipgirlResponse.json();

            for (const id in shipgirlData) shipgirlNameMap[shipgirlData[id].name] = id;

            populateEventGrid();
            handleUrlParameters();

        } catch (error) {
            console.error('Failed to load data:', error);
            showError('Failed to load story data. Please refresh the page.');
        }
    }

    /** Reads URL parameters to deep-link into a story. */
    function handleUrlParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const eventId = urlParams.get('eventId') || urlParams.get('eventid') || urlParams.get('event_id');
        const storyId = urlParams.get('story');

        if (eventId && storylineData[eventId]) {
            selectEvent(eventId, false);
            if (storyId) {
                const eventData = storylineData[eventId];
                const memoryData = eventData?.memory_id?.find(mem => mem.id == storyId);
                if (memoryData) {
                    startStory(memoryData, false);
                } else {
                    showError(`Story with ID '${storyId}' not found in this event.`);
                }
            }
        } else if (eventId) {
            showError(`Event with ID '${eventId}' not found.`);
        }
    }

    // =========================================================================
    // UI POPULATION & NAVIGATION
    // =========================================================================

    /** Populates the event selection grid, optionally filtering by a search term. */
    function populateEventGrid(searchTerm = '') {
        eventGrid.innerHTML = '';
        const filteredEvents = Object.values(storylineData)
            .filter(event => event.name.toLowerCase().includes(searchTerm.toLowerCase()));

        filteredEvents.forEach(event => {
            const card = createCard(
                event.name,
                event.description,
                event.icon,
                `${BASE_URL}memorystoryline/`,
                () => selectEvent(event.id)
            );
            eventGrid.appendChild(card);
        });
    }

    /** Creates a generic card element for the grids. */
    function createCard(title, subtitle, icon, pathPrefix, onClick, id = null) {
        const card = document.createElement('div');
        card.className = 'grid-card';
        if (id) {
            card.dataset.id = id; // Add a data-id attribute
        }

        let imageUrl = '';
        if (icon) {
            imageUrl = icon.startsWith('http') ? icon : `${pathPrefix}${icon}.png`;
        }

        card.innerHTML = `
        <div class="card-thumbnail" style="background-image: url('${imageUrl}')"></div>
        <div class="card-content">
            <h3 class="card-title">${title}</h3>
            <p class="card-subtitle">${subtitle}</p>
        </div>
    `;
        card.addEventListener('click', onClick);
        return card;
    }

    /** Handles selecting an event and showing the memory grid. */
    function selectEvent(eventId, updateUrl = true) {
        currentEventId = eventId;
        const eventData = storylineData[eventId];
        memoryViewTitle.textContent = eventData.name;
        memoryGrid.innerHTML = '';

        if (eventData.memory_id && Array.isArray(eventData.memory_id)) {
            eventData.memory_id.forEach(memory => {
                const card = createCard(
                    memory.title,
                    memory.condition,
                    memory.icon,
                    `${BASE_URL}memoryicon/`,
                    () => startStory(memory),
                    memory.id
                );
                memoryGrid.appendChild(card);
            });
        }

        if (updateUrl) {
            const urlParams = new URLSearchParams();
            urlParams.set('eventid', currentEventId);
            window.history.pushState({ eventId: currentEventId }, '', `?${urlParams.toString()}`);
        }

        switchView(memorySelectionView);
    }

    /** Returns from the story viewer to the memory selection grid. */
    function returnToMemorySelection() {
        const urlParams = new URLSearchParams();
        urlParams.set('eventid', currentEventId);
        window.history.pushState({ eventId: currentEventId }, '', `?${urlParams.toString()}`);

        switchView(memorySelectionView);

        // Remove any previously highlighted card
        const previouslyHighlighted = memoryGrid.querySelector('.highlighted-card');
        if (previouslyHighlighted) {
            previouslyHighlighted.classList.remove('highlighted-card');
        }

        // If a "next memory" was identified, find its card and highlight it
        if (nextMemory && nextMemory.id) {
            const nextCard = memoryGrid.querySelector(`.grid-card[data-id='${nextMemory.id}']`);
            if (nextCard) {
                nextCard.classList.add('highlighted-card');
                // Scroll the new card into the middle of the screen
                nextCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }

    // =========================================================================
    // STORY VIEWER LOGIC
    // =========================================================================

    /** Initializes and starts a story view session. */
    function startStory(memory, updateUrl = true) {
        if (!memory?.story?.scripts) {
            showError("This story is not available.");
            return;
        }
        fadeOverlay.classList.remove('visible');
        currentStoryScript = memory.story.scripts;
        currentMemoryId = memory.id;
        scriptIndex = 0;
        lastActorId = null;
        currentBgm = null;

        const event = storylineData[currentEventId];
        const index = event.memory_id.findIndex(mem => mem.id == memory.id);
        nextMemory = (index >= 0 && index < event.memory_id.length - 1) ? event.memory_id[index + 1] : null;

        const eventName = storylineData[currentEventId]?.name || 'Event';
        storyTitle.textContent = `${eventName} - ${memory.title || 'Chapter'}`;

        if (updateUrl) {
            const urlParams = new URLSearchParams();
            urlParams.set('eventid', currentEventId);
            urlParams.set('story', memory.id);
            window.history.pushState({ eventId: currentEventId, storyId: memory.id }, '', `?${urlParams.toString()}`);
        }

        renderScriptLine();
        switchView(storyViewerView);
    }

    /** Advances to the next line in the story script. */
    function advanceStory() {
        if (scriptIndex < currentStoryScript.length - 1) {
            scriptIndex++;
            renderScriptLine();
        }
    }

    /** Goes back to the previous line in the story script. */
    function goBackStory() {
        if (scriptIndex > 0) {
            scriptIndex--;
            renderScriptLine();
        }
    }

    /** Renders the current line of the story script to the UI. */
    function renderScriptLine() {
        if (scriptIndex >= currentStoryScript.length) return;
        const line = currentStoryScript[scriptIndex];

        optionsBox.innerHTML = '';
        dialogueBox.classList.add('hidden');
        infoScreen.classList.add('hidden');

        updateBackground();
        if (line.effects) handleEffect(line.effects);
        if (line.stopbgm) { handleBgm(null); }
        else if (line.bgm) { handleBgm(line.bgm); }

        const infoText = line.sequence?.[0]?.[0] || line.signDate?.[0];

        if (infoText && infoText.trim() !== "") {
            infoScreen.classList.remove('hidden');
            infoScreenText.textContent = infoText;
        } else if (line.say) {
            dialogueBox.classList.remove('hidden');
            // --- START of CHANGE ---
            // Convert color tags (e.g., <color=#ff0000>...</color>) into styled <span> elements
            const formattedDialogue = line.say.replace(
                /<color=(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})>(.*?)<\/color>/gi,
                '<span style="color: $1;">$2</span>'
            );
            // Use innerHTML to render the styled text, stripping any other potential tags
            dialogueText.innerHTML = formattedDialogue.replace(/<\/?[^>]+(>|$)/g, (match) => {
                return (match.startsWith('<span') || match.startsWith('</span')) ? match : '';
            });
            const actorInfo = getActorInfo(line);
            if (actorInfo.id !== lastActorId) {
                actorName.textContent = actorInfo.name;
                actorPortrait.innerHTML = actorInfo.icon ? `<img src="${actorInfo.icon}" alt="${actorInfo.name}">` : '';
                actorPortrait.classList.toggle('hidden', !actorInfo.icon);
            }
            lastActorId = actorInfo.id;
        }

        // Update navigation buttons
        const isAtEnd = scriptIndex >= currentStoryScript.length - 1;
        prevLineBtn.disabled = (scriptIndex <= 0);
        nextLineBtn.classList.toggle('hidden', isAtEnd);
        returnBtn.classList.toggle('hidden', !isAtEnd);
        nextStoryBtn.classList.toggle('hidden', !(isAtEnd && nextMemory));
        nextPageIndicator.classList.toggle('hidden', isAtEnd);
    }

    // =========================================================================
    // HELPER FUNCTIONS
    // =========================================================================

    /** Retrieves actor information based on the script line. */
    function getActorInfo(line) {
        // Handle the Commander as a special case first
        if (line.actor === 0 || line.portrait === 'zhihuiguan') {
            return { id: 0, name: '지휘관', icon: null };
        }

        // Determine the initial actor ID from the 'actor' field
        let actorId = null;
        if (typeof line.actor === 'number') {
            actorId = line.actor;
        } else if (typeof line.actor === 'string') {
            actorId = shipgirlNameMap[line.actor] || null;
        }

        const initialCharacter = shipgirlData[actorId];

        // Set default values based on the initial character
        let displayName = initialCharacter ? initialCharacter.name : '';
        let displayIcon = initialCharacter ? initialCharacter.icon : null;
        let displayId = initialCharacter ? actorId : 'unknown';

        // Check if 'actorName' exists to override name and/or icon
        if (line.actorName) {
            const actorNameId = parseInt(line.actorName, 10);

            // Check if actorName is a valid ID for a known shipgirl
            if (!isNaN(actorNameId) && shipgirlData[actorNameId]) {
                const overrideCharacter = shipgirlData[actorNameId];
                // If yes, override BOTH the name and the icon
                displayName = overrideCharacter.name;
                displayIcon = overrideCharacter.icon;
            } else {
                // Otherwise, use it as a literal string name and keep the initial icon
                displayName = line.actorName;
            }

            if (displayId === 'unknown') {
                displayId = line.actorName;
            }
        }

        return { id: displayId, name: displayName, icon: displayIcon };
    }


    /** Updates the story background based on the current script position. */
    function updateBackground() {
        const backgroundElement = storyViewerView.querySelector('.story-background');
        let backgroundImageUrl = null;
        let isBlackBackground = false;

        for (let i = scriptIndex; i >= 0; i--) {
            const line = currentStoryScript[i];
            if (line) {
                if (line.blackBg === true) { isBlackBackground = true; break; }
                if (line.bgName) { backgroundImageUrl = `url('${BASE_URL}bg/${line.bgName}.png')`; break; }
            }
        }

        if (isBlackBackground) {
            backgroundElement.style.backgroundColor = 'black';
            backgroundElement.style.backgroundImage = 'none';
        } else {
            backgroundElement.style.backgroundColor = 'transparent';
            backgroundElement.style.backgroundImage = backgroundImageUrl || 'none';
        }
    }

    /** Handles special effects like screen shakes and flashes. */
    function handleEffect(effects) {
        if (!effects) return;
        effects.forEach(effect => {
            // Use a default duration of 0.5 seconds if none is provided
            const duration = (effect.duration || 0.5) * 1000;

            switch (effect.type) {
                case "shake":
                    viewerContainer.classList.add('shake');
                    setTimeout(() => viewerContainer.classList.remove('shake'), duration);
                    break;
                case "flash":
                    const flashEl = document.createElement('div');
                    flashEl.className = 'flash';
                    document.body.appendChild(flashEl);
                    setTimeout(() => document.body.removeChild(flashEl), 300); // Flash is usually brief
                    break;
                case "fadeout":
                    fadeOverlay.style.transitionDuration = `${duration / 1000}s`;
                    fadeOverlay.classList.add('visible');
                    break;
                case "fadein":
                    fadeOverlay.style.transitionDuration = `${duration / 1000}s`;
                    fadeOverlay.classList.remove('visible');
                    break;
                case "se": // Sound Effect
                    if (effect.audio) {
                        const sfx = new Audio(`${SFX_URL_PREFIX}${effect.audio}.ogg`);
                        // Use the same volume as the BGM for consistency
                        sfx.volume = audio.volume;
                        sfx.play().catch(e => console.warn("SFX playback failed.", e));
                    }
                    break;
            }
        });
    }

    // =========================================================================
    // AUDIO LOGIC
    // =========================================================================

    /** Updates the audio player UI based on the audio object's state. */
    function updateAudioPlayerUI() {
        if (!playPauseBtn || !muteBtn || !volumeSlider) return;
        playPauseBtn.querySelector('.material-icons').textContent = audio.paused ? 'play_arrow' : 'pause';
        muteBtn.querySelector('.material-icons').textContent = audio.muted || audio.volume === 0 ? 'volume_off' : 'volume_up';
        volumeSlider.value = audio.muted ? 0 : audio.volume;
    }

    /** Handles starting, stopping, or changing the background music. */
    function handleBgm(bgmName) {
        if (bgmName && bgmName !== currentBgm) {
            currentBgm = bgmName;
            audio.src = `${BGM_URL_PREFIX}${bgmName}.ogg`;
            audio.play().catch(e => console.warn("Audio playback failed.", e));
            audioPlayerContainer?.classList.remove('hidden');
        } else if (!bgmName && currentBgm) {
            currentBgm = null;
            audio.pause();
            audioPlayerContainer?.classList.add('hidden');
        }
        updateAudioPlayerUI();
    }

    // =========================================================================
    // MODAL LOGIC
    // =========================================================================

    /** Generates and displays the full story script in a modal. */
    function showFullScript() {
        if (!currentStoryScript || currentStoryScript.length === 0) return;
        const scriptHtml = currentStoryScript
            .filter(line => line.say && line.say.trim() !== "")
            .map(line => {
                const actorInfo = getActorInfo(line);
                const actorName = actorInfo.name || 'Narrator';
                const dialogue = line.say.replace(/<.*?>/g, '');
                return `<p><strong>${actorName}:</strong> ${dialogue}</p>`;
            })
            .join('');

        fullScriptContent.innerHTML = scriptHtml;
        scriptModalOverlay.classList.remove('hidden');
    }

    /** Hides the full script modal. */
    function hideFullScript() {
        scriptModalOverlay.classList.add('hidden');
    }

    // =========================================================================
    // EVENT LISTENERS
    // =========================================================================
    searchBar?.addEventListener('input', (e) => populateEventGrid(e.target.value));

    storyViewerView?.addEventListener('click', (e) => {
        if (e.target.closest('.option-button, .nav-button, .story-nav-btn, .audio-player-container')) return;
        if (scriptIndex < currentStoryScript.length - 1) {
            advanceStory();
        }
    });

    prevLineBtn.addEventListener('click', (e) => { e.stopPropagation(); goBackStory(); });
    nextLineBtn.addEventListener('click', (e) => { e.stopPropagation(); advanceStory(); });
    nextStoryBtn.addEventListener('click', (e) => { e.stopPropagation(); if (nextMemory) startStory(nextMemory); });
    returnBtn.addEventListener('click', (e) => { e.stopPropagation(); returnToMemorySelection(); });
    backToEventBtn.addEventListener('click', (e) => { e.preventDefault(); switchView(eventSelectionView); window.history.pushState({}, '', 'main-story-viewer.html'); });
    backToMemoryBtn.addEventListener('click', (e) => { e.preventDefault(); returnToMemorySelection(); });

    // Modal Listeners
    viewScriptBtn.addEventListener('click', showFullScript);
    closeModalBtn.addEventListener('click', hideFullScript);
    scriptModalOverlay.addEventListener('click', (e) => {
        if (e.target === scriptModalOverlay) hideFullScript();
    });

    // Audio Player Listeners
    playPauseBtn.addEventListener('click', (e) => { e.stopPropagation(); audio.paused ? audio.play().catch(console.warn) : audio.pause(); });
    muteBtn.addEventListener('click', (e) => { e.stopPropagation(); audio.muted = !audio.muted; updateAudioPlayerUI(); });
    volumeSlider.addEventListener('input', (e) => { e.stopPropagation(); audio.volume = e.target.value; audio.muted = e.target.value == 0; updateAudioPlayerUI(); });
    audio.addEventListener('play', updateAudioPlayerUI);
    audio.addEventListener('pause', updateAudioPlayerUI);

    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    applyTheme(localStorage.getItem('theme') || 'light');
    init();
});