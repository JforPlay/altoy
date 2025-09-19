document.addEventListener('DOMContentLoaded', () => {
    // Get references to DOM elements
    const characterList = document.getElementById('character-list');
    const chatHeader = document.getElementById('chat-header');
    const chatHeaderIcon = document.getElementById('chat-header-icon');
    const chatHeaderName = document.getElementById('chat-header-name');
    const storySelect = document.getElementById('story-select');
    const chatContent = document.getElementById('chat-content');
    const initialMessage = document.getElementById('initial-message');
    const optionsContainer = document.getElementById('options-container');
    
    // Global state variables
    let chatData = null; 
    let currentCharacter = null;
    let currentStoryKey = null;
    let currentScripts = [];

    const commanderIcon = 'https://i.imgur.com/b25S6Sj.png';

    // Fetch chat data from the JSON file
    fetch('data/processed_dorm3d_data.json')
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            chatData = data;
            initializeApp(chatData);
        })
        .catch(error => {
            console.error('채팅 데이터를 불러오는 데 실패했습니다:', error);
            initialMessage.textContent = '채팅 데이터를 불러오지 못했습니다. 콘솔을 확인해주세요.';
        });

    // Main function to initialize the app after data is loaded
    function initializeApp(data) {
        populateCharacterList(data);
        storySelect.addEventListener('change', (e) => startStory(e.target.value));
    }

    // 1. Populate Character List in the sidebar
    function populateCharacterList(data) {
        for (const charName in data) {
            const firstStoryKey = Object.keys(data[charName])[0];
            const firstStoryData = data[charName][firstStoryKey];

            const selectorDiv = document.createElement('div');
            selectorDiv.className = 'character-selector';
            selectorDiv.dataset.characterName = charName;
            selectorDiv.innerHTML = `
                <img src="${firstStoryData.icon}" alt="${charName}" class="character-icon">
                <span class="character-name-label">${charName.trim()}</span>
            `;
            selectorDiv.addEventListener('click', () => selectCharacter(charName));
            characterList.appendChild(selectorDiv);
        }
    }

    // 2. Handle Character Selection
    function selectCharacter(charName) {
        currentCharacter = charName;
        
        // Highlight active character
        document.querySelectorAll('.character-selector').forEach(el => {
            el.classList.toggle('active', el.dataset.characterName === charName);
        });
        
        // Show chat UI
        initialMessage.style.display = 'none';
        chatHeader.style.display = 'flex';

        const characterStories = chatData[charName];
        const firstStoryKey = Object.keys(characterStories)[0];
        const firstStoryData = characterStories[firstStoryKey];

        // Update header
        chatHeaderIcon.src = firstStoryData.icon;
        chatHeaderName.textContent = charName;

        // Populate story dropdown
        storySelect.innerHTML = '';
        for (const storyKey in characterStories) {
            const storyData = characterStories[storyKey];
            const option = document.createElement('option');
            option.value = storyKey;
            option.textContent = storyData.unlock_desc;
            storySelect.appendChild(option);
        }

        // Start the first story automatically
        startStory(storySelect.value);
    }

    // 3. Start a new story, resetting the chat
    function startStory(storyKey) {
        currentStoryKey = storyKey;
        currentScripts = chatData[currentCharacter][currentStoryKey].scripts;
        chatContent.innerHTML = '';
        optionsContainer.innerHTML = '';
        
        // Find the first script entry (usually flag 0)
        const startIndex = currentScripts.findIndex(script => script.flag === 0);
        processScripts(startIndex !== -1 ? startIndex : 0);
    }

    // 4. Process scripts sequentially from a given index
    function processScripts(startIndex) {
        let currentIndex = startIndex;
        
        while (currentIndex < currentScripts.length) {
            const script = currentScripts[currentIndex];

            // Ignore control-code type scripts
            if (script.type === 4) {
                currentIndex++;
                continue;
            }

            // Check if the script belongs to the current conversation branch
            const previousScript = currentIndex > 0 ? currentScripts[currentIndex - 1] : null;
            if (previousScript && previousScript.flag !== script.flag && script.flag !== 0) {
                 // This logic might need adjustment if flags are not sequential
            }
            
            // Create and show the message bubble
            const isPlayer = script.ship_group === 0;
            const speakerName = isPlayer ? '지휘관' : currentCharacter;
            const characterIcon = chatData[currentCharacter][currentStoryKey].icon;
            const speakerIcon = isPlayer ? commanderIcon : characterIcon;
            createBubble(speakerName, script.param, speakerIcon, isPlayer);

            // If the character presents options, stop processing and show buttons
            if (!isPlayer && Array.isArray(script.option) && script.option.length > 0) {
                createOptionButtons(script.option);
                return; // Stop the loop and wait for user input
            }
            
            currentIndex++;
        }
    }

    // 5. Create interactive choice buttons for the player
    function createOptionButtons(options) {
        optionsContainer.innerHTML = ''; // Clear previous options
        options.forEach(optionData => {
            const [flag, text] = optionData;
            const button = document.createElement('button');
            button.className = 'choice-button';
            button.textContent = text;
            button.addEventListener('click', () => selectOption(flag, text));
            optionsContainer.appendChild(button);
        });
        scrollToBottom();
    }

    // 6. Handle player's choice selection
    function selectOption(flag, text) {
        // Display the chosen option as a player bubble
        createBubble('지휘관', text, commanderIcon, true);
        optionsContainer.innerHTML = ''; // Remove buttons after selection

        // Find the next script entry that matches the chosen flag
        const nextIndex = currentScripts.findIndex(script => script.flag === flag);
        if (nextIndex !== -1) {
            processScripts(nextIndex);
        }
    }

    // Helper function to create and append a message bubble
    function createBubble(name, text, icon, isPlayer) {
        const bubble = document.createElement('div');
        bubble.className = `message-bubble ${isPlayer ? 'player' : 'character'}`;
        bubble.innerHTML = `
            <img src="${icon}" alt="Speaker Icon" class="message-icon">
            <div class="bubble-content">
                <div class="speaker-name">${name.trim()}</div>
                <p>${text}</p>
            </div>
        `;
        chatContent.appendChild(bubble);
        scrollToBottom();
    }
    
    // Helper function to keep the chat scrolled to the latest message
    function scrollToBottom() {
        chatContent.scrollTop = chatContent.scrollHeight;
    }
});
