document.addEventListener('DOMContentLoaded', () => {
    // URL for the main data file
    const DATA_URL = 'data/processed_dorm3d_data.json';

    // Get HTML elements
    const characterGrid = document.getElementById('character-selector-grid');
    const storyDisplaySection = document.getElementById('story-display-section');
    const storyDropdown = document.getElementById('story-dropdown');
    const unlockDescText = document.getElementById('unlock-desc-text');
    const storyContainer = document.getElementById('story-container');
    const optionsContainer = document.getElementById('options-container');
    const restartButton = document.getElementById('restart-button');

    // Data and state variables
    let allData = {};
    let selectedCharacterName = null;
    let currentStoryScripts = [];
    let currentScriptIndex = 0;

    /**
     * Fetches the main data and populates the character selector.
     */
    fetch(DATA_URL)
        .then(res => res.ok ? res.json() : Promise.reject(res.status))
        .then(data => {
            allData = data;
            populateCharacterSelector();
        })
        .catch(error => {
            console.error('Error fetching story data:', error);
            characterGrid.innerHTML = '<p class="loading-message error">스토리 정보를 불러오는데 실패했어요.</p>';
        });

    /**
     * Creates and displays character cards in the grid.
     */
    function populateCharacterSelector() {
        characterGrid.innerHTML = ''; // Clear loading message
        for (const characterName in allData) {
            const characterData = allData[characterName];
            const firstStoryId = Object.keys(characterData)[0];
            if (!firstStoryId) continue;

            const firstStory = characterData[firstStoryId];
            const card = document.createElement('div');
            card.className = 'character-card';
            card.dataset.characterName = characterName;
            card.innerHTML = `
                <img src="${firstStory.icon}" alt="${firstStory.kr_name}">
                <p class="char-name">${firstStory.kr_name}</p>
                <p class="ship-name">${firstStory.ship_name}</p>
            `;
            card.addEventListener('click', () => handleCharacterClick(characterName));
            characterGrid.appendChild(card);
        }
    }

    /**
     * Handles clicking a character card.
     */
    function handleCharacterClick(characterName) {
        selectedCharacterName = characterName;
        document.querySelectorAll('.character-card').forEach(card => {
            card.classList.toggle('selected', card.dataset.characterName === characterName);
        });
        storyDisplaySection.classList.remove('hidden');
        populateStoryDropdown(allData[characterName]);
    }

    /**
     * Populates the story dropdown menu.
     */
    function populateStoryDropdown(characterStories) {
        storyDropdown.innerHTML = '';
        for (const storyId in characterStories) {
            const story = characterStories[storyId];
            const option = document.createElement('option');
            option.value = storyId;
            option.textContent = story.name;
            storyDropdown.appendChild(option);
        }
        loadSelectedStory();
    }
    
    /**
     * Loads the story selected in the dropdown.
     */
    function loadSelectedStory() {
        const storyId = storyDropdown.value;
        if (!selectedCharacterName || !storyId) return;

        const storyData = allData[selectedCharacterName][storyId];
        currentStoryScripts = storyData.scripts;
        unlockDescText.innerHTML = `<strong>해금 조건 :</strong> "${storyData.unlock_desc}"`;
        
        initializeStory();
    }

    /**
     * Clears the display and starts the current story.
     */
    const initializeStory = () => {
        storyContainer.innerHTML = '';
        optionsContainer.innerHTML = '';
        currentScriptIndex = 0;
        showNextLineAfterDelay();
    };

    /**
     * Main story progression engine.
     */
    const showNextLine = () => {
        if (currentScriptIndex >= currentStoryScripts.length) return;
        const script = currentStoryScripts[currentScriptIndex];

        let processed = false;
        switch (script.type) {
            case 1: // Dialogue
                if (script.param) {
                    displayBubble(script);
                    if (script.option && script.option.length > 0 && Array.isArray(script.option[0])) {
                        const options = script.option.map(opt => ({ flag: opt[0], content: opt[1] }));
                        displayOptions(options);
                    } else {
                        currentScriptIndex++;
                        showNextLineAfterDelay();
                    }
                    processed = true;
                }
                break;
            case 4: // Special Event
                handleSpecialEvent(script);
                currentScriptIndex++;
                showNextLineAfterDelay(100);
                processed = true;
                break;
        }
        if (!processed) {
            currentScriptIndex++;
            showNextLine();
        }
    };
    
    const showNextLineAfterDelay = (delay = 1300) => {
        setTimeout(showNextLine, delay);
    }

    /**
     * Displays a single dialogue bubble, now with portraits.
     */
    const displayBubble = (script) => {
        const currentStoryInfo = allData[selectedCharacterName][storyDropdown.value];
        let speakerName = '', messageClass = '';
        
        if (script.ship_group === 0) {
            speakerName = '지휘관';
            messageClass = 'player';
        } else if (script.ship_group === currentStoryInfo.ship_group) {
            speakerName = currentStoryInfo.kr_name;
            messageClass = 'character';
        } else {
            messageClass = 'narrator';
        }
        
        const messageBubble = document.createElement('div');
        messageBubble.classList.add('message-bubble', messageClass);

        if (speakerName) {
            messageBubble.innerHTML += `<p class="speaker-name">${speakerName}</p>`;
        }
        messageBubble.innerHTML += `<p>${script.param}</p>`;

        let topLevelElement = messageBubble;
        if (messageClass === 'character') {
            const wrapper = document.createElement('div');
            wrapper.className = 'character-line-wrapper';

            const portrait = document.createElement('img');
            portrait.className = 'portrait';
            portrait.src = currentStoryInfo.icon;
            portrait.alt = speakerName;

            wrapper.appendChild(portrait);
            wrapper.appendChild(messageBubble);
            storyContainer.appendChild(wrapper);
            topLevelElement = wrapper;
        } else {
            storyContainer.appendChild(messageBubble);
        }
        
        topLevelElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
        return topLevelElement;
    };


    /**
     * Handles type 4 events from the script.
     */
    function handleSpecialEvent(script) {
        console.log(`Special Event Triggered: Type ${script.type}, Param: ${script.param}`);
        const lastBubble = storyContainer.lastElementChild;
        if (lastBubble) {
            lastBubble.classList.add('shake-effect');
            setTimeout(() => lastBubble.classList.remove('shake-effect'), 700);
        }
    }

    /**
     * Displays choice buttons for the player.
     */
    const displayOptions = (options) => {
        optionsContainer.innerHTML = '';
        options.forEach(option => {
            const button = document.createElement('button');
            button.classList.add('choice-button');
            button.textContent = option.content;
            button.onclick = () => handleChoice(option.flag, option.content);
            optionsContainer.appendChild(button);
        });
        optionsContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
    };
    
    /**
     * Handles the player's choice and finds the next script block.
     */
    const handleChoice = (chosenFlag, chosenText) => {
        displayBubble({ ship_group: 0, param: chosenText });
        optionsContainer.innerHTML = '';
        
        let foundIndex = -1;
        for (let i = currentScriptIndex + 1; i < currentStoryScripts.length; i++) {
            if (currentStoryScripts[i].flag === chosenFlag) {
                foundIndex = i;
                break;
            }
        }

        if (foundIndex !== -1) {
            currentScriptIndex = foundIndex;
        } else {
            currentScriptIndex++;
        }

        showNextLineAfterDelay();
    };

    // Event listeners for controls
    storyDropdown.addEventListener('change', loadSelectedStory);
    restartButton.addEventListener('click', initializeStory);
});