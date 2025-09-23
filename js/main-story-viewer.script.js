document.addEventListener('DOMContentLoaded', () => {
    // --- State Variables ---
    let storylineData = {};
    let shipgirlData = {};
    let shipgirlNameMap = {};
    let currentEventId = null;
    let currentMemoryId = null;
    let currentStoryScript = [];
    let scriptIndex = 0;
    let lastActorId = null;
    let nextMemory = null;

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
    const nextStoryBtn = document.getElementById('next-story-btn');
    const returnBtn = document.getElementById('return-btn');


    // --- Dark Mode ---
    const applyTheme = (theme) => {
        document.body.classList.toggle('dark-mode', theme === 'dark');
        const mainNavbar = document.querySelector('#navbar-placeholder .navbar');
        if (mainNavbar) {
            if (theme === 'dark') {
                mainNavbar.classList.remove('navbar-light');
            } else {
                mainNavbar.classList.add('navbar-light');
            }
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
    };

    // --- Data Loading ---
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

    function handleUrlParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const eventId = urlParams.get('eventId') || urlParams.get('eventid') || urlParams.get('event_id');
        const storyId = urlParams.get('story');

        if (eventId) {
            if (storylineData[eventId]) {
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
            } else {
                showError(`Event with ID '${eventId}' not found.`);
            }
        }
    }

    // --- UI Population ---
    function populateEventGrid(searchTerm = '') {
        eventGrid.innerHTML = '';
        const filteredEvents = Object.values(storylineData)
            .filter(event => event.name.toLowerCase().includes(searchTerm.toLowerCase()));

        filteredEvents.forEach(event => {
            // MODIFIED: Corrected the image path for event cards
            const card = createCard(event.name, event.description, event.icon, 'img/memorystoryline/', () => selectEvent(event.id));
            eventGrid.appendChild(card);
        });
    }

    function createCard(title, subtitle, icon, pathPrefix, onClick) {
        const card = document.createElement('div');
        card.className = 'grid-card';
        card.innerHTML = `
            <div class="card-thumbnail" style="background-image: url('${pathPrefix}${icon}.png')"></div>
            <div class="card-content">
                <h3 class="card-title">${title}</h3>
                <p class="card-subtitle">${subtitle}</p>
            </div>
        `;
        card.addEventListener('click', onClick);
        return card;
    }

    // --- View Navigation ---
    function selectEvent(eventId, updateUrl = true) {
        currentEventId = eventId;
        const eventData = storylineData[eventId];
        memoryViewTitle.textContent = eventData.name;
        memoryGrid.innerHTML = '';
        if (eventData.memory_id && Array.isArray(eventData.memory_id)) {
            eventData.memory_id.forEach(memory => {
                // MODIFIED: Corrected the image path for memory cards
                const card = createCard(memory.title, memory.condition, memory.icon, 'img/memoryicon/', () => startStory(memory));
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

    function returnToMemorySelection() {
        const urlParams = new URLSearchParams();
        urlParams.set('eventid', currentEventId);
        window.history.pushState({ eventId: currentEventId }, '', `?${urlParams.toString()}`);
        switchView(memorySelectionView);
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

        // Find the next memory
        const event = storylineData[currentEventId];
        const index = event.memory_id.findIndex(mem => mem.id == memory.id);
        nextMemory = (index >= 0 && index < event.memory_id.length - 1) ? event.memory_id[index + 1] : null;

        const eventName = storylineData[currentEventId]?.name || 'Event';
        const memoryTitleText = memory.title || 'Chapter';
        storyTitle.textContent = `${eventName} - ${memoryTitleText}`;

        if (updateUrl) {
            const urlParams = new URLSearchParams();
            urlParams.set('eventid', currentEventId);
            urlParams.set('story', memory.id);
            window.history.pushState({ eventId: currentEventId, storyId: memory.id }, '', `?${urlParams.toString()}`);
        }

        renderScriptLine();
        switchView(storyViewerView);
    }

    // --- Story Viewer Logic ---
    function advanceStory() {
        if (scriptIndex >= currentStoryScript.length - 1) {
            returnToMemorySelection();
            return;
        }
        scriptIndex++;
        renderScriptLine();
    }

    function goBackStory() {
        if (scriptIndex <= 0) return;
        scriptIndex--;
        renderScriptLine();
    }

    function getActorInfo(line) {
        let actorId = null;
        if (typeof line.actor === 'number') actorId = line.actor;
        else if (typeof line.actor === 'string') actorId = shipgirlNameMap[line.actor] || null;
        else if (line.actorName && !isNaN(parseInt(line.actorName, 10))) actorId = parseInt(line.actorName, 10);

        if (actorId === 0 || line.portrait === 'zhihuiguan') return { id: 0, name: '지휘관', icon: null };
        const character = shipgirlData[actorId];
        if (character) return { id: actorId, name: character.name, icon: character.icon };
        if (line.actorName && isNaN(parseInt(line.actorName, 10))) return { id: line.actorName, name: line.actorName, icon: null };
        return { id: 'unknown', name: '', icon: null };
    }

    function updateBackground() {
        // Find the target element for the background
        const backgroundElement = viewerContainer.querySelector('.story-background');
        if (!backgroundElement) return; // Exit if the element isn't found

        let backgroundImageUrl = null;
        let isBlackBackground = false;

        // 1. Scan backwards from the current script line to find the last instruction for background
        for (let i = scriptIndex; i >= 0; i--) {
            const line = currentStoryScript[i];
            if (line) {
                // Check for a black background command. This takes priority.
                if (line.blackBg === true) {
                    isBlackBackground = true;
                    break; // Found the most recent instruction, stop searching
                }
                // Check for a specific background image name
                if (line.bgName) {
                    backgroundImageUrl = `url('img/bg/${line.bgName}.png')`;
                    break; // Found the most recent instruction, stop searching
                }
            }
        }

        // 2. Apply the black background if it was found
        if (isBlackBackground) {
            backgroundElement.style.backgroundColor = 'black';
            backgroundElement.style.backgroundImage = 'none'; // Clear any existing image
            return; // We're done
        }

        // If not a black background, ensure background color is cleared
        backgroundElement.style.backgroundColor = 'transparent';

        // 3. Apply the specific background image if one was found in the script
        if (backgroundImageUrl) {
            backgroundElement.style.backgroundImage = backgroundImageUrl;
            return; // We're done
        }

        // 4. If no instruction was found in the script, fall back to the memory's default 'mask'
        const event = storylineData[currentEventId];
        const memory = event?.memory_id.find(mem => mem.id == currentMemoryId);
        if (memory && memory.mask) {
            // The path is constructed as img/{mask value}.png as per the request
            const defaultBgUrl = `url('img/${memory.mask}.png')`;
            backgroundElement.style.backgroundImage = defaultBgUrl;
        } else {
            // 5. Final fallback if no default mask is available either
            backgroundElement.style.backgroundImage = 'none';
        }
    }


    function renderScriptLine() {
        if (scriptIndex >= currentStoryScript.length) return;
        const line = currentStoryScript[scriptIndex];

        optionsBox.innerHTML = '';
        dialogueBox.classList.add('hidden');
        infoScreen.classList.add('hidden');

        updateBackground();

        if (line.effects) handleEffect(line.effects);

        const infoText = line.sequence?.[0]?.[0] || line.signDate?.[0];

        if (infoText && infoText.trim() !== "") {
            infoScreen.classList.remove('hidden');
            infoScreenText.textContent = infoText;

        } else if (line.say) {
            dialogueBox.classList.remove('hidden');
            dialogueText.textContent = line.say.replace(/<.*?>/g, '');
            const actorInfo = getActorInfo(line);
            if (actorInfo.id !== lastActorId) {
                actorName.textContent = actorInfo.name;
                actorPortrait.innerHTML = '';
                if (actorInfo.icon) {
                    actorPortrait.classList.remove('hidden');
                    const img = document.createElement('img');
                    img.src = actorInfo.icon;
                    img.alt = actorInfo.name;
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

        if (scriptIndex >= currentStoryScript.length - 1) {
            // Hide the "Next" button
            nextLineBtn.classList.add('hidden');

            // Show "Return to Chapter Selection" always
            returnBtn.classList.remove('hidden');

            // Show "Next Story" only if available
            if (nextMemory) {
                nextStoryBtn.classList.remove('hidden');
            } else {
                nextStoryBtn.classList.add('hidden');
            }
        } else {
            // Normal progression
            nextLineBtn.textContent = '다음 →';
            nextLineBtn.classList.remove('hidden');
            nextStoryBtn.classList.add('hidden');
            returnBtn.classList.add('hidden');
        }

        prevLineBtn.disabled = (scriptIndex <= 0);
        nextPageIndicator.classList.toggle('hidden', scriptIndex >= currentStoryScript.length - 1);
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

    function hideFullScript() {
        scriptModalOverlay.classList.add('hidden');
    }

    // --- Event Listeners ---
    searchBar?.addEventListener('input', (e) => populateEventGrid(e.target.value));
    storyViewerView?.addEventListener('click', (e) => {
        if (e.target.closest('.option-button, .nav-button, .story-nav-btn')) return;
        // Disable click progression at last line
        if (scriptIndex < currentStoryScript.length - 1) {
            advanceStory();
        }
    });
    nextStoryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (nextMemory) startStory(nextMemory);
    });
    prevLineBtn.addEventListener('click', (e) => { e.stopPropagation(); goBackStory(); });
    nextLineBtn.addEventListener('click', (e) => { e.stopPropagation(); advanceStory(); });
    backToEventBtn.addEventListener('click', (e) => { e.preventDefault(); switchView(eventSelectionView); window.history.pushState({}, '', 'main-story-viewer.html'); });
    returnBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        returnToMemorySelection();
    });
    backToMemoryBtn.addEventListener('click', (e) => { e.preventDefault(); returnToMemorySelection(); });
    viewScriptBtn.addEventListener('click', showFullScript);
    closeModalBtn.addEventListener('click', hideFullScript);
    scriptModalOverlay.addEventListener('click', (e) => {
        if (e.target === scriptModalOverlay) {
            hideFullScript();
        }
    });

    // --- Initial Load ---
    applyTheme(localStorage.getItem('theme') || 'light');
    init();
});
