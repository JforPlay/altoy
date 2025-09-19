document.addEventListener('DOMContentLoaded', () => {
    const characterSelector = document.getElementById('character-selector');
    const chatSelectionArea = document.getElementById('chat-selection-area');
    const chatDropdown = document.getElementById('chat-dropdown');
    const unlockDesc = document.getElementById('unlock-desc');
    const chatDisplay = document.getElementById('chat-display');

    let chatData = {};
    let selectedCharacter = null;

    // Fetch the chat data from the JSON file
    fetch('data/processed_dorm3d_data.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            chatData = data;
            loadCharacters();
        })
        .catch(error => {
            console.error("Error fetching or parsing chat data:", error);
            characterSelector.innerHTML = '<p>Error loading character data. Please check the console and ensure the JSON file is in the same directory.</p>';
        });

    /**
     * Populates the character selection grid.
     */
    function loadCharacters() {
        characterSelector.innerHTML = ''; // Clear existing content
        for (const characterName in chatData) {
            const character = chatData[characterName];
            // Get the first chat to extract shared info like icon, kr_name, etc.
            const firstChatId = Object.keys(character)[0];
            if (!firstChatId) continue; // Skip if character has no chats
            
            const chatInfo = character[firstChatId];

            const card = document.createElement('div');
            card.className = 'character-card';
            card.dataset.character = characterName;

            card.innerHTML = `
                <img src="${chatInfo.icon}" alt="${chatInfo.kr_name} icon">
                <p class="char-name">${chatInfo.kr_name}</p>
                <p class="ship-name">${chatInfo.ship_name}</p>
            `;

            card.addEventListener('click', handleCharacterClick);
            characterSelector.appendChild(card);
        }
    }

    /**
     * Handles clicking on a character card.
     * @param {Event} event - The click event.
     */
    function handleCharacterClick(event) {
        const selectedCard = event.currentTarget;
        selectedCharacter = selectedCard.dataset.character;

        // Update selected visual state
        document.querySelectorAll('.character-card').forEach(card => {
            card.classList.remove('selected');
        });
        selectedCard.classList.add('selected');

        // Show chat area and populate dropdown
        chatSelectionArea.classList.remove('hidden');
        populateChatDropdown(chatData[selectedCharacter]);
    }

    /**
     * Populates the chat dropdown for the selected character.
     * @param {object} characterChats - The chat data for one character.
     */
    function populateChatDropdown(characterChats) {
        chatDropdown.innerHTML = '';
        for (const chatId in characterChats) {
            const chat = characterChats[chatId];
            const option = document.createElement('option');
            option.value = chatId;
            option.textContent = chat.name;
            chatDropdown.appendChild(option);
        }
        // Automatically load the first chat
        if (chatDropdown.options.length > 0) {
            chatDropdown.value = chatDropdown.options[0].value;
            handleChatChange();
        }
        chatDropdown.removeEventListener('change', handleChatChange); // Prevent multiple listeners
        chatDropdown.addEventListener('change', handleChatChange);
    }
    
    /**
     * Handles changing the selected chat in the dropdown.
     */
    function handleChatChange() {
        const selectedChatId = chatDropdown.value;
        if (!selectedCharacter || !selectedChatId) return;

        const chat = chatData[selectedCharacter][selectedChatId];
        unlockDesc.textContent = `"${chat.unlock_desc}"`;
        displayChat(chat.scripts);
    }

    /**
     * Displays the chat messages for a selected story.
     * @param {Array} scripts - An array of script objects for the chat.
     */
    function displayChat(scripts) {
        chatDisplay.innerHTML = '';
        scripts.forEach(script => {
            // We only display dialogue messages (type 1)
            if (script.type === 1 && script.param) {
                const bubble = document.createElement('div');
                bubble.className = 'chat-bubble';
                // ship_group 0 is the player (commander)
                if (script.ship_group === 0) {
                    bubble.classList.add('player-message');
                } else {
                    bubble.classList.add('character-message');
                }
                bubble.textContent = script.param;
                chatDisplay.appendChild(bubble);
            }
        });
        // Scroll to the top of the chat
        chatDisplay.scrollTop = 0;
    }
});
