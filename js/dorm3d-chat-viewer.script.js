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
            initialMessage.textContent = '채팅 데이터를 불러오지 못했습니다. Live Server를 사용하고 있는지 확인해주세요.';
        });

    // Main function to initialize the app after data is loaded
    function initializeApp(data) {
        populateCharacterList(data);
        storySelect.addEventListener('change', () => startStory(storySelect.value));
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
        
        document.querySelectorAll('.character-selector').forEach(el => {
            el.classList.toggle('active', el.dataset.characterName === charName);
        });
        
        initialMessage.style.display = 'none';
        chatHeader.style.display = 'flex';

        const characterStories = chatData[charName];
        const firstStoryKey = Object.keys(characterStories)[0];
        const firstStoryData = characterStories[firstStoryKey];

        chatHeaderIcon.src = firstStoryData.icon;
        chatHeaderName.textContent = charName;

        storySelect.innerHTML = '';
        for (const storyKey in characterStories) {
            const storyData = characterStories[storyKey];
            const option = document.createElement('option');
            option.value = storyKey;
            option.textContent = storyData.unlock_desc;
            storySelect.appendChild(option);
        }

        startStory(storySelect.value);
    }

    // 3. Start a new story, resetting the chat
    function startStory(storyKey) {
        currentStoryKey = storyKey;
        currentScripts = chatData[currentCharacter][currentStoryKey].scripts;
        chatContent.innerHTML = '';
        optionsContainer.innerHTML = '';
        
        // Start processing the story from the very first line
        processScripts(0);
    }

    // 4. Process scripts sequentially from a given index
    function processScripts(startIndex) {
        if (startIndex >= currentScripts.length) return;

        const script = currentScripts[startIndex];
        const isPlayer = script.ship_group === 0;

        // Create and show the message bubble, unless it's a player choice that is handled by selectOption
        if (!isPlayer) {
             const speakerName = currentCharacter;
             const characterIcon = chatData[currentCharacter][currentStoryKey].icon;
             createBubble(speakerName, script.param, characterIcon, false);
        }
       
        // If the character presents options, show buttons and stop
        if (!isPlayer && Array.isArray(script.option) && script.option.length > 0) {
            createOptionButtons(script.option, startIndex);
            return; 
        }

        // If it's a simple line, move to the next one
        const nextIndex = findNextSequentialIndex(startIndex, script.flag);
        if (nextIndex !== -1) {
            // Use a small delay for a more natural chat flow
            setTimeout(() => processScripts(nextIndex), 200);
        }
    }

    // 5. Create interactive choice buttons
    function createOptionButtons(options, scriptIndex) {
        optionsContainer.innerHTML = '';
        options.forEach(optionData => {
            const [flag, text] = optionData;
            const button = document.createElement('button');
            button.className = 'choice-button';
            button.textContent = text;
            button.addEventListener('click', () => selectOption(flag, text, scriptIndex));
            optionsContainer.appendChild(button);
        });
        scrollToBottom();
    }

    // 6. Handle player's choice selection
    function selectOption(flag, text, previousScriptIndex) {
        createBubble('지휘관', text, commanderIcon, true);
        optionsContainer.innerHTML = '';

        const nextIndex = currentScripts.findIndex((script, index) => index > previousScriptIndex && script.flag === flag);
        if (nextIndex !== -1) {
            setTimeout(() => processScripts(nextIndex), 400);
        }
    }
    
    // Find the next logical script index in a non-branching conversation
    function findNextSequentialIndex(currentIndex, currentFlag) {
        const nextScript = currentScripts[currentIndex + 1];
        if (nextScript && nextScript.flag === currentFlag) {
            return currentIndex + 1;
        }
        return -1; // End of this branch
    }

    // Helper function to create a message bubble
    function createBubble(name, text, icon, isPlayer) {
         if (typeof text !== 'string' || !text.trim()) return; // Don't show empty bubbles
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
    
    function scrollToBottom() {
        chatContent.scrollTop = chatContent.scrollHeight;
    }
});