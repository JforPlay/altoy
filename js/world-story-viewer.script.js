document.addEventListener('DOMContentLoaded', () => {
    // --- State Variables ---
    let storylineData = {};
    let storylineSummaryData = {};
    let shipgirlData = {};
    let shipgirlNameMap = {};
    let currentEventId = null;
    let currentMemoryId = null;
    let currentStoryScript = [];
    let scriptIndex = 0;
    let lastActorId = null;
    let nextMemory = null;
    let currentBgm = null;

    // --- Constants ---
    const BASE_URL = "https://raw.githubusercontent.com/JforPlay/data_for_toy/main/";
    const BGM_URL_PREFIX = "https://github.com/Fernando2603/AzurLane/raw/refs/heads/main/audio/bgm/";

    // --- DOM Elements ---
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
    const summaryModalOverlay = document.getElementById('summary-modal-overlay');
    const closeSummaryModalBtn = document.getElementById('close-summary-modal-btn');
    const summaryModalContent = document.getElementById('summary-modal-content');
    const audioPlayerContainer = document.getElementById('audio-player-container');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const muteBtn = document.getElementById('mute-btn');
    const volumeSlider = document.getElementById('volume-slider');
    const bgmNameSpan = document.getElementById('bgm-name');
    const audio = new Audio();
    audio.loop = true;
    audio.volume = 0.01;

    // --- Dark Mode ---
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

    themeToggles.forEach(toggle => {
        toggle.addEventListener('click', () => {
            const newTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
            localStorage.setItem('theme', newTheme);
            applyTheme(newTheme);
        });
    });

    // --- Utility Functions ---
    const showError = (message) => {
        errorContainer.textContent = message;
        errorContainer.classList.remove('hidden');
        setTimeout(() => errorContainer.classList.add('hidden'), 5000);
    };

    const switchView = (viewToShow) => {
        [eventSelectionView, memorySelectionView, storyViewerView].forEach(view => {
            view.classList.toggle('hidden', view !== viewToShow);
        });
        if (viewToShow !== storyViewerView) {
            audio.pause();
            if (audioPlayerContainer) audioPlayerContainer.classList.add('hidden');
        }
    };

    // --- Audio Logic ---
    function updateAudioPlayerUI() {
        if (!playPauseBtn || !muteBtn || !volumeSlider) return;
        playPauseBtn.querySelector('.material-icons').textContent = audio.paused ? 'play_arrow' : 'pause';
        muteBtn.querySelector('.material-icons').textContent = audio.muted || audio.volume === 0 ? 'volume_off' : 'volume_up';
        volumeSlider.value = audio.muted ? 0 : audio.volume;
    }

    /** Handles starting, stopping, or changing the background music. */
    function handleBgm(bgmName) {
        // 1. Handle Visibility: This part runs every time.
        // If a BGM name is provided, the player is shown. Otherwise, it's hidden.
        if (bgmName) {
            audioPlayerContainer?.classList.remove('hidden');
        } else {
            audioPlayerContainer?.classList.add('hidden');
        }

        // 2. Handle Audio Source: This part only runs when the track changes.
        // This is efficient and prevents reloading the same song.
        if (bgmName && bgmName !== currentBgm) {
            currentBgm = bgmName;
            audio.src = `${BGM_URL_PREFIX}${bgmName}.ogg`;
            audio.play().catch(e => console.warn("Audio playback failed.", e));
        } else if (!bgmName && currentBgm) {
            // This stops the music when handleBgm(null) is called.
            currentBgm = null;
            audio.pause();
        }

        // 3. Update UI Text: This keeps the displayed name in sync.
        if (bgmNameSpan) {
            bgmNameSpan.textContent = bgmName || ''; // Sets the track name or clears it.
        }
        updateAudioPlayerUI();
    }


    // --- Data Loading ---
    async function init() {
        try {
            const [storyResponse, summaryResponse, shipgirlResponse] = await Promise.all([
                fetch('data/processed_world_storyline.json'),
                fetch('data/world_storyline_summary.json'),
                fetch('data/shipgirl_data.json')
            ]);

            if (!storyResponse.ok || !summaryResponse.ok || !shipgirlResponse.ok) throw new Error('Network response was not ok.');

            storylineData = await storyResponse.json();
            storylineSummaryData = await summaryResponse.json();
            shipgirlData = await shipgirlResponse.json();

            for (const id in shipgirlData) shipgirlNameMap[shipgirlData[id].name] = id;

            populateEventGrid();
            handleUrlParameters();

        } catch (error) {
            console.error('Failed to load data:', error);
            showError('Failed to load story data. Please refresh the page.');
        }
    }

    function handleUrlParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const eventId = urlParams.get('eventId') || urlParams.get('eventid') || urlParams.get('event_id');
        const storyId = urlParams.get('story');

        if (eventId && storylineData[eventId]) {
            selectEvent(eventId, false);
            if (storyId) {
                const eventData = storylineData[eventId];
                const numericStoryId = parseInt(storyId, 10);
                const memoryData = eventData?.child?.find(mem => mem.id === numericStoryId);
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

    // --- UI Population ---
    function populateEventGrid(searchTerm = '') {
        eventGrid.innerHTML = '';
        const lowercasedTerm = searchTerm.toLowerCase();
        const filteredEvents = Object.keys(storylineData)
            .filter(key => storylineData[key].name.toLowerCase().includes(lowercasedTerm));

        filteredEvents.forEach(key => {
            const event = storylineData[key];
            const card = createCard(
                event.name,
                `Chapter: ${event.name.replace(/[^0-9]/g, '')}`,
                null,
                null,
                () => selectEvent(key)
            );
            eventGrid.appendChild(card);
        });
    }

    /** MODIFIED FUNCTION **/
    function createCard(title, subtitle, icon, pathPrefix, onClick, id = null) {
        const card = document.createElement('div');
        card.className = 'grid-card';
        if (id) {
            card.dataset.id = id; // Add data-id for querying
        }
        let thumbnailHtml = '';
        if (icon) {
            let imageUrl = '';
            if (icon.startsWith('http') || icon.startsWith('data:image') || icon.includes('assets/')) {
                imageUrl = icon;
            } else {
                imageUrl = `${pathPrefix}${icon}.png`;
            }
            thumbnailHtml = `<div class="card-thumbnail" style="background-image: url('${imageUrl}')"></div>`;
        } else {
            thumbnailHtml = `<div class="card-thumbnail" style="background-color: #34495e;"></div>`;
        }
        card.innerHTML = `
            ${thumbnailHtml}
            <div class="card-content">
                <h3 class="card-title">${title}</h3>
                <p class="card-subtitle">${subtitle}</p>
            </div>
        `;
        card.addEventListener('click', onClick);
        return card;
    }

    // --- View Navigation & Summary Modal Logic ---
    function showSummaryModal(eventId) {
        const data = storylineSummaryData[eventId];
        if (!data) return;
        let keycharHtml = '';
        if (data.keychar && Array.isArray(data.keychar)) {
            keycharHtml = `<h3>${data.keychar[0]}</h3><ul>` +
                data.keychar.slice(1).map(item => `<li>${item}</li>`).join('') +
                `</ul>`;
        }
        summaryModalContent.innerHTML = `
            <h2>${data.title}</h2>
            <p>${data.summary}</p>
            ${keycharHtml}
        `;
        summaryModalOverlay.classList.remove('hidden');
    }

    function hideSummaryModal() {
        summaryModalOverlay.classList.add('hidden');
    }

    /** MODIFIED FUNCTION **/
    function selectEvent(eventId, updateUrl = true) {
        currentEventId = eventId;
        const eventData = storylineData[eventId];
        memoryViewTitle.textContent = eventData.name;
        memoryGrid.innerHTML = '';

        if (storylineSummaryData[eventId]) {
            const summaryData = storylineSummaryData[eventId];
            const summaryCard = createCard(
                `${summaryData.title} 줄거리`,
                "하나즈키가 작성한 이 챕터의 전체적인 줄거리와 핵심 정보를 확인합니다.",
                'assets/img/hanazuki.png',
                null,
                () => showSummaryModal(eventId)
                // No ID needed for summary card
            );
            memoryGrid.appendChild(summaryCard);
        }

        if (eventData.child && Array.isArray(eventData.child)) {
            eventData.child.forEach(memory => {
                const card = createCard(
                    memory.name,
                    memory.condition,
                    memory.icon,
                    `${BASE_URL}memoryicon/`,
                    () => startStory(memory),
                    memory.id // Pass the memory ID here
                );
                memoryGrid.appendChild(card);
            });
        }

        if (updateUrl) {
            const urlParams = new URLSearchParams();
            urlParams.set('eventid', currentEventId);
            window.history.pushState({ eventId: currentEventId }, '', `${window.location.pathname}?${urlParams.toString()}`);
        }

        switchView(memorySelectionView);
    }

    /** MODIFIED FUNCTION **/
    function returnToMemorySelection() {
        const urlParams = new URLSearchParams();
        urlParams.set('eventid', currentEventId);
        window.history.pushState({ eventId: currentEventId }, '', `${window.location.pathname}?${urlParams.toString()}`);
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

    function startStory(memory, updateUrl = true) {
        if (!memory?.story?.scripts) {
            showError("This story is not available.");
            return;
        }
        currentStoryScript = memory.story.scripts;
        currentMemoryId = memory.id;
        scriptIndex = 0;
        lastActorId = null;
        currentBgm = null;
        const event = storylineData[currentEventId];
        const index = event.child.findIndex(mem => mem.id === memory.id);
        nextMemory = (index >= 0 && index < event.child.length - 1) ? event.child[index + 1] : null;
        const eventName = storylineData[currentEventId]?.name || 'Event';
        const memoryTitleText = memory.name || 'Chapter';
        storyTitle.textContent = `${eventName} - ${memoryTitleText}`;
        if (updateUrl) {
            const urlParams = new URLSearchParams();
            urlParams.set('eventid', currentEventId);
            urlParams.set('story', memory.id);
            window.history.pushState({ eventId: currentEventId, storyId: memory.id }, '', `${window.location.pathname}?${urlParams.toString()}`);
        }
        switchView(storyViewerView);
        // On starting a story, jump to the first displayable line
        if (!isLineDisplayable(currentStoryScript[0]) && currentStoryScript.length > 1) {
            advanceStory();
        } else {
            renderScriptLine();
        }
    }

    // --- Story Viewer Logic ---
    function isLineDisplayable(line) {
        if (!line) return false;
        return line.say ||
            (line.sequence && line.sequence[0] && line.sequence[0][0]) ||
            (line.signDate && line.signDate[0]) ||
            (line.options && line.options.length > 0);
    }

    function advanceStory() {
        if (scriptIndex >= currentStoryScript.length - 1) return;

        let nextDisplayableIndex = -1;
        for (let i = scriptIndex + 1; i < currentStoryScript.length; i++) {
            if (isLineDisplayable(currentStoryScript[i])) {
                nextDisplayableIndex = i;
                break;
            }
        }

        if (nextDisplayableIndex !== -1) {
            scriptIndex = nextDisplayableIndex;
        } else {
            scriptIndex = currentStoryScript.length - 1;
        }
        renderScriptLine();
    }

    function goBackStory() {
        if (scriptIndex <= 0) return;

        let prevDisplayableIndex = -1;
        for (let i = scriptIndex - 1; i >= 0; i--) {
            if (isLineDisplayable(currentStoryScript[i])) {
                prevDisplayableIndex = i;
                break;
            }
        }

        if (prevDisplayableIndex !== -1) {
            scriptIndex = prevDisplayableIndex;
        } else {
            scriptIndex = 0;
        }
        renderScriptLine();
    }

    /** Making sure that the actor name handling is done properly **/
    function getActorInfo(line) {
        let actorInfo = { id: null, name: 'Narrator', icon: null };
        let iconId = null;

        if (typeof line.actor === 'number') {
            iconId = line.actor;
        } else if (typeof line.actor === 'string') {
            iconId = shipgirlNameMap[line.actor] || null;
        }

        if (iconId !== null) {
            const character = shipgirlData[iconId];
            if (character) {
                actorInfo.id = iconId;
                actorInfo.icon = character.icon;
                actorInfo.name = character.name;
            }
        }

        // Explicit actorName from data overrides everything else
        if (line.actorName) {
            actorInfo.name = line.actorName;
        }

        // Special handling for dialogue lines with no actor specified
        if (line.say && !line.actor && !line.actorName) {
            const isNarratorLine = (line.say.includes('·') && line.say.length < 40) || line.say.includes('————');
            if (isNarratorLine) {
                actorInfo.name = 'Narrator';
                actorInfo.id = -1; // Special ID for narrator
            } else {
                actorInfo.name = '지휘관'; // Commander
                actorInfo.id = 0; // Special ID for commander
            }
            actorInfo.icon = null;
        }

        // Fallback for when actor is a string but not found in shipgirl map
        if (!actorInfo.name && typeof line.actor === 'string') {
            actorInfo.name = line.actor;
        }

        // Final check to remove icon for specific non-character speakers
        if (['통신기', '분석기', '모두들'].includes(actorInfo.name) || actorInfo.name?.includes('?')) {
            actorInfo.icon = null;
        }

        return actorInfo;
    }


    function updateBackground() {
        const backgroundElement = viewerContainer.querySelector('.story-background');
        if (!backgroundElement) return;
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
            return;
        }
        backgroundElement.style.backgroundColor = 'transparent';
        const event = storylineData[currentEventId];
        const memory = event?.child.find(mem => mem.id === currentMemoryId);
        if (memory && memory.mask && !backgroundImageUrl) {
            backgroundElement.style.backgroundImage = `url('${BASE_URL}${memory.mask}.png')`;
        } else if (backgroundImageUrl) {
            backgroundElement.style.backgroundImage = backgroundImageUrl;
        } else {
            backgroundElement.style.backgroundImage = 'none';
        }
    }

    function handleOptionSelect(chosenFlag) {
        let nextIndex = -1;
        for (let i = scriptIndex + 1; i < currentStoryScript.length; i++) {
            if (currentStoryScript[i].optionFlag === chosenFlag) { nextIndex = i; break; }
        }
        if (nextIndex !== -1) { scriptIndex = nextIndex; renderScriptLine(); }
        else { advanceStory(); }
    }

    /** UPDATED FUNCTION **/
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

        const hasOptions = line.options && line.options.length > 0;
        const isAtEnd = scriptIndex >= currentStoryScript.length - 1;

        if (infoText && infoText.trim() !== "") {
            infoScreen.classList.remove('hidden');
            infoScreenText.textContent = infoText;
        } else if (line.say) {
            dialogueBox.classList.remove('hidden');
            const actorInfo = getActorInfo(line);

            // If subActors are present, create a combined name string
            let displayedName = actorInfo.name;
            if (line.subActors) {
                const subActorNames = line.subActors.map(sub => getActorInfo({ actor: sub.actor }).name);
                displayedName = subActorNames.join(' & ');
            }

            // For the main dialogue box, Narrator name should be hidden
            if (displayedName === 'Narrator') {
                displayedName = '';
            }

            actorName.textContent = displayedName;
            dialogueBox.classList.toggle('no-actor', !displayedName);
            dialogueText.textContent = line.say.replace(/<.*?>/g, '');

            if (actorInfo.id !== lastActorId) {
                actorPortrait.innerHTML = '';
                actorPortrait.classList.toggle('actor-shadow', !!line.actorShadow);
                if (actorInfo.icon) {
                    actorPortrait.classList.remove('hidden');
                    const img = document.createElement('img');
                    img.src = actorInfo.icon;
                    img.alt = displayedName;
                    img.onload = () => actorPortrait.style.opacity = 1;
                    img.onerror = () => actorPortrait.classList.add('hidden');
                    actorPortrait.style.opacity = 0;
                    actorPortrait.appendChild(img);
                } else {
                    actorPortrait.classList.add('hidden');
                }
            }
            lastActorId = actorInfo.id;
        }

        prevLineBtn.disabled = (scriptIndex <= 0);
        nextLineBtn.classList.toggle('hidden', hasOptions || isAtEnd);

        if (!isAtEnd && !hasOptions) nextLineBtn.textContent = '다음 →';
        returnBtn.classList.toggle('hidden', !isAtEnd);
        nextStoryBtn.classList.toggle('hidden', !(isAtEnd && nextMemory));

        if (hasOptions) {
            line.options.forEach(opt => {
                const button = document.createElement('button');
                button.className = 'option-button';
                button.textContent = opt.content.replace(/<.*?>/g, '');
                button.onclick = (e) => { e.stopPropagation(); handleOptionSelect(opt.flag); };
                optionsBox.appendChild(button);
            });
        }
        nextPageIndicator.classList.toggle('hidden', isAtEnd || hasOptions);
    }

    function handleEffect(effects) {
        if (!effects) return;
        effects.forEach(effect => {
            if (effect.type === "shake") {
                viewerContainer.classList.add('shake');
                setTimeout(() => viewerContainer.classList.remove('shake'), effect.duration * 1000 || 500);
            }
            if (effect.type === "flash") {
                const flashEl = document.createElement('div');
                flashEl.className = 'flash';
                document.body.appendChild(flashEl);
                setTimeout(() => document.body.removeChild(flashEl), 300);
            }
        });
    }

    /** UPDATED FUNCTION **/
    function showFullScript() {
        if (!currentStoryScript || currentStoryScript.length === 0) return;
        const scriptHtml = currentStoryScript
            .filter(line => line.say && line.say.trim() !== "")
            .map(line => {
                const actorInfo = getActorInfo(line);
                const actorNameText = actorInfo.name; // This is now the single source of truth
                const dialogue = line.say.replace(/<.*?>/g, '');
                return `<p><strong>${actorNameText}:</strong> ${dialogue}</p>`;
            })
            .join('');
        fullScriptContent.innerHTML = scriptHtml;
        scriptModalOverlay.classList.remove('hidden');
    }

    function hideFullScript() {
        scriptModalOverlay.classList.add('hidden');
    }

    // --- Event Listeners ---
    searchBar?.addEventListener('input', (e) => populateEventGrid(e.target.value));
    storyViewerView?.addEventListener('click', (e) => {
        if (e.target.closest('.option-button, .nav-button, .story-nav-btn, .audio-player-container')) return;
        if (optionsBox.children.length > 0) return;
        if (scriptIndex < currentStoryScript.length - 1) advanceStory();
    });
    prevLineBtn.addEventListener('click', (e) => { e.stopPropagation(); goBackStory(); });
    nextLineBtn.addEventListener('click', (e) => { e.stopPropagation(); advanceStory(); });
    nextStoryBtn.addEventListener('click', (e) => { e.stopPropagation(); if (nextMemory) startStory(nextMemory); });
    returnBtn.addEventListener('click', (e) => { e.stopPropagation(); returnToMemorySelection(); });
    backToEventBtn.addEventListener('click', (e) => { e.preventDefault(); switchView(eventSelectionView); window.history.pushState({}, '', window.location.pathname); });
    backToMemoryBtn.addEventListener('click', (e) => { e.preventDefault(); returnToMemorySelection(); });
    viewScriptBtn.addEventListener('click', showFullScript);
    closeModalBtn.addEventListener('click', hideFullScript);
    scriptModalOverlay.addEventListener('click', (e) => { if (e.target === scriptModalOverlay) hideFullScript(); });
    closeSummaryModalBtn.addEventListener('click', hideSummaryModal);
    summaryModalOverlay.addEventListener('click', (e) => { if (e.target === summaryModalOverlay) hideSummaryModal(); });
    playPauseBtn.addEventListener('click', (e) => { e.stopPropagation(); if (audio.paused) { audio.play().catch(e => console.warn("Audio failed.", e)); } else { audio.pause(); } });
    muteBtn.addEventListener('click', (e) => { e.stopPropagation(); audio.muted = !audio.muted; updateAudioPlayerUI(); });
    volumeSlider.addEventListener('input', (e) => { e.stopPropagation(); audio.volume = e.target.value; audio.muted = e.target.value == 0; updateAudioPlayerUI(); });
    audio.addEventListener('play', updateAudioPlayerUI);
    audio.addEventListener('pause', updateAudioPlayerUI);

    // --- Initial Load ---
    applyTheme(localStorage.getItem('theme') || 'light');
    init();
});