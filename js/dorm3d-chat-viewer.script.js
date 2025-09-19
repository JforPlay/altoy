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
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP error! Status: ${res.status}`);
            }
            return res.json();
        })
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
            if (!firstStoryId) continue; // Skip if character has no stories

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
     * @param {string} characterName - The name of the selected character.
     */
    function handleCharacterClick(characterName) {
        selectedCharacterName = characterName;

        // Update visual selection
        document.querySelectorAll('.character-card').forEach(card => {
            card.classList.toggle('selected', card.dataset.characterName === characterName);
        });

        storyDisplaySection.classList.remove('hidden');
        populateStoryDropdown(allData[characterName]);
    }

    /**
     * Populates the story dropdown menu for the selected character.
     * @param {object} characterStories - The collection of stories for the character.
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
        // Load the first story by default
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
        unlockDescText.textContent = `"${storyData.unlock_desc}"`;
        
        initializeStory();
    }

    /**
     * Clears the display and starts showing the current story.
     */
    const initializeStory = () => {
        storyContainer.innerHTML = '';
        optionsContainer.innerHTML = '';
        currentScriptIndex = 0;
        showNextLineAfterDelay();
    };

    /**
     * Main story progression function.
     */
    const showNextLine = () => {
        if (currentScriptIndex >= currentStoryScripts.length) return;
        const script = currentStoryScripts[currentScriptIndex];

        // Skip non-dialogue or empty lines automatically
        if (script.type !== 1 || !script.param) {
            currentScriptIndex++;
            showNextLine();
            return;
        }

        displayBubble(script);

        // If there are options, wait for user input. Otherwise, proceed.
        if (script.option && script.option.length > 0 && Array.isArray(script.option[0])) {
             // The format in this JSON is [[flag, content]]
            const options = script.option.map(opt => ({ flag: opt[0], content: opt[1] }));
            displayOptions(options);
        } else {
            currentScriptIndex++;
            showNextLineAfterDelay();
        }
    };
    
    const showNextLineAfterDelay = (delay = 400) => {
        setTimeout(showNextLine, delay);
    }

    /**
     * Displays a single dialogue bubble.
     * @param {object} script - The script object for the current line.
     */
    const displayBubble = (script) => {
        let speakerName = '', messageClass = '';
        const firstStory = allData[selectedCharacterName][storyDropdown.value];

        if (script.ship_group === 0) {
            speakerName = '지휘관';
            messageClass = 'player';
        } else if (script.ship_group === firstStory.ship_group) {
            speakerName = firstStory.kr_name;
            messageClass = 'character';
        } else {
            messageClass = 'narrator'; // Fallback for narrator/system text
        }
        
        const messageBubble = document.createElement('div');
        messageBubble.classList.add('message-bubble', messageClass);

        if (speakerName) {
            messageBubble.innerHTML += `<p class="speaker-name">${speakerName}</p>`;
        }
        messageBubble.innerHTML += `<p>${script.param}</p>`;

        storyContainer.appendChild(messageBubble);
        messageBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
    };

    /**
     * Displays choice buttons for the player.
     * @param {Array} options - An array of option objects.
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
     * Handles the player's choice.
     * @param {number} chosenFlag - The flag associated with the chosen option.
     * @param {string} chosenText - The text of the chosen option.
     */
    const handleChoice = (chosenFlag, chosenText) => {
        // Display the user's choice as a bubble
        const choiceBubble = { ship_group: 0, param: chosenText };
        displayBubble(choiceBubble);
        
        optionsContainer.innerHTML = '';
        currentScriptIndex++; // Move past the line that contained the options

        // Find the next line that matches the chosen flag
        while (currentScriptIndex < currentStoryScripts.length) {
            if (currentStoryScripts[currentScriptIndex].flag === chosenFlag) {
                break; // Found the start of the chosen path
            }
            currentScriptIndex++;
        }

        showNextLineAfterDelay();
    };

    // Event listeners for controls
    storyDropdown.addEventListener('change', loadSelectedStory);
    restartButton.addEventListener('click', initializeStory);
});