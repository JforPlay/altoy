document.addEventListener('DOMContentLoaded', () => {
    // --- State Variables ---
    let storylineData = {};
    let shipgirlData = {};
    let shipgirlNameMap = {};
    let currentEventId = null;
    let currentStoryScript = [];
    let scriptIndex = 0;
    let lastActorId = null;

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

    // --- Dark Mode ---
    const applyTheme = (theme) => {
        document.body.classList.toggle('dark-mode', theme === 'dark');
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
    
    // UPDATED: Handles new URL parameters: event_id and story
    function handleUrlParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const eventId = urlParams.get('event_id');
        const storyId = urlParams.get('story');
        
        if (eventId && storylineData[eventId]) {
            selectEvent(eventId, false); // Go to event screen without updating URL
            if (storyId) {
                const eventData = storylineData[eventId];
                const memoryData = eventData?.memory_id?.find(mem => mem.id == storyId);
                if (memoryData) {
                    startStory(memoryData, false); // Start story without updating URL
                }
            }
        }
    }

    // --- UI Population ---
    function populateEventGrid(searchTerm = '') {
        eventGrid.innerHTML = '';
        const filteredEvents = Object.values(storylineData)
            .filter(event => event.name.toLowerCase().includes(searchTerm.toLowerCase()));

        filteredEvents.forEach(event => {
            const card = createCard(event.name, event.description, event.icon, () => selectEvent(event.id));
            eventGrid.appendChild(card);
        });
    }

    function createCard(title, subtitle, icon, onClick) {
        const card = document.createElement('div');
        card.className = 'grid-card';
        card.innerHTML = `
            <div class="card-thumbnail" style="background-image: url('https://raw.githubusercontent.com/Fernando2603/AzurLane/main/images/chapter/${icon}.png')"></div>
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
                // UPDATED: Pass the entire memory object to startStory
                const card = createCard(memory.title, memory.condition, memory.icon, () => startStory(memory));
                memoryGrid.appendChild(card);
            });
        }
        
        if (updateUrl) {
            const urlParams = new URLSearchParams();
            urlParams.set('eventid', currentEventId);
            window.history.pushState({eventId: currentEventId}, '', `?${urlParams.toString()}`);
        }
        
        switchView(memorySelectionView);
    }
    
    function returnToMemorySelection() {
        const urlParams = new URLSearchParams();
        urlParams.set('event_id', currentEventId);
        window.history.pushState({eventId: currentEventId}, '', `?${urlParams.toString()}`);
        switchView(memorySelectionView);
    }

    // UPDATED: Accepts the full memory object now
    function startStory(memory, updateUrl = true) {
        if (!memory?.story?.scripts) {
            showError("This story is not available.");
            return;
        }
        currentStoryScript = memory.story.scripts;
        scriptIndex = 0;
        lastActorId = null;
        storyTitle.textContent = storylineData[currentEventId]?.name || 'Story';
        
        if (updateUrl) {
            const urlParams = new URLSearchParams();
            urlParams.set('event_id', currentEventId);
            urlParams.set('story', memory.id); // Use memory.id for the story parameter
            window.history.pushState({eventId: currentEventId, storyId: memory.id}, '', `?${urlParams.toString()}`);
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

    function renderScriptLine() {
        if (scriptIndex >= currentStoryScript.length) return;
        const line = currentStoryScript[scriptIndex];
        optionsBox.innerHTML = '';

        if (line.bgName) viewerContainer.querySelector('.story-background').style.backgroundImage = `url('https://raw.githubusercontent.com/Fernando2603/AzurLane/main/images/bg/${line.bgName}.png')`;
        if (line.effects) handleEffect(line.effects);

        if (!line.say) {
            dialogueBox.classList.add('hidden');
        } else {
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
            nextLineBtn.textContent = 'Return to Chapter Selection';
        } else {
            nextLineBtn.textContent = 'Next →';
        }
        
        prevLineBtn.disabled = (scriptIndex <= 0);
        nextPageIndicator.classList.toggle('hidden', scriptIndex >= currentStoryScript.length - 1);
    }
    
    function handleEffect(effects) {
        // This function remains the same
    }

    // --- Event Listeners ---
    searchBar?.addEventListener('input', (e) => populateEventGrid(e.target.value));
    storyViewerView?.addEventListener('click', (e) => {
        if (e.target.closest('.option-button, .nav-button, .story-nav-btn')) return;
        advanceStory();
    });
    prevLineBtn.addEventListener('click', (e) => { e.stopPropagation(); goBackStory(); });
    nextLineBtn.addEventListener('click', (e) => { e.stopPropagation(); advanceStory(); });
    backToEventBtn.addEventListener('click', (e) => { e.preventDefault(); switchView(eventSelectionView); window.history.pushState({}, '', 'main-story-viewer.html'); });
    backToMemoryBtn.addEventListener('click', (e) => { e.preventDefault(); returnToMemorySelection(); });

    // --- Initial Load ---
    applyTheme(localStorage.getItem('theme') || 'light');
    init();
});