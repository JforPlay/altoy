document.addEventListener('DOMContentLoaded', () => {
    const DATA_URL = 'data/processed_ins_chat_data.json';

    const characterGrid = document.getElementById('character-selector-grid');
    const storyDisplaySection = document.getElementById('story-display-section');
    const storyDropdown = document.getElementById('story-dropdown');
    const unlockDescText = document.getElementById('unlock-desc-text');
    const storyContainer = document.getElementById('story-container');
    const optionsContainer = document.getElementById('options-container');
    const restartButton = document.getElementById('restart-button');

    let allData = {};
    let shipGroupToCharacterMap = {};
    let selectedCharacterName = null;
    let currentStoryScripts = [];
    let currentScriptIndex = 0;

    fetch(DATA_URL)
        .then(res => res.ok ? res.json() : Promise.reject(res.status))
        .then(data => {
            allData = data;
            buildShipGroupMap();
            populateCharacterSelector();
        })
        .catch(error => {
            console.error('Error fetching story data:', error);
            characterGrid.innerHTML = '<p class="loading-message error">스토리 정보를 불러오는데 실패했어요.</p>';
        });

    /**
     * Creates a map for quick lookup of character info by ship_group ID.
     * This is essential for handling group chats efficiently.
     */
    function buildShipGroupMap() {
        for (const characterName in allData) {
            const stories = allData[characterName];
            const firstStoryId = Object.keys(stories)[0];
            if (firstStoryId && stories[firstStoryId].ship_group) {
                const charInfo = stories[firstStoryId];
                shipGroupToCharacterMap[charInfo.ship_group] = {
                    kr_name: charInfo.kr_name,
                    icon: charInfo.icon
                };
            }
        }
    }
    
    function populateCharacterSelector() {
        characterGrid.innerHTML = '';
        for (const characterName in allData) {
            const characterData = allData[characterName];
            const firstStoryId = Object.keys(characterData)[0];
            if (!firstStoryId) continue;

            const firstStory = characterData[firstStoryId];
            const card = document.createElement('div');
            card.className = 'character-card';
            card.dataset.characterName = characterName;
            
            // Handle group chats that might not have a specific icon
            const iconSrc = firstStory.icon || 'https://via.placeholder.com/80';
            const shipName = firstStory.ship_name || '';

            card.innerHTML = `
                <img src="${iconSrc}" alt="${firstStory.kr_name}">
                <p class="char-name">${firstStory.kr_name}</p>
                <p class="ship-name">${shipName}</p>
            `;
            card.addEventListener('click', () => handleCharacterClick(characterName));
            characterGrid.appendChild(card);
        }
    }

    function handleCharacterClick(characterName) {
        selectedCharacterName = characterName;
        document.querySelectorAll('.character-card').forEach(card => {
            card.classList.toggle('selected', card.dataset.characterName === characterName);
        });
        storyDisplaySection.classList.remove('hidden');
        populateStoryDropdown(allData[characterName]);
        storyContainer.innerHTML = ''; 
        optionsContainer.innerHTML = '';
    }

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
    
    function loadSelectedStory() {
        const storyId = storyDropdown.value;
        if (!selectedCharacterName || !storyId) return;

        const storyData = allData[selectedCharacterName][storyId];
        currentStoryScripts = storyData.scripts;
        unlockDescText.innerHTML = `<strong>해금 조건 :</strong> "${storyData.unlock_desc}"`;
        
        initializeStory();
    }

    const initializeStory = () => {
        storyContainer.innerHTML = '';
        optionsContainer.innerHTML = '';
        currentScriptIndex = 0;
        showNextLineAfterDelay(100);
    };

    /**
     * Main story progression engine with support for new script types.
     */
    const showNextLine = () => {
        if (currentScriptIndex >= currentStoryScripts.length) return;
        const script = currentStoryScripts[currentScriptIndex];

        let processed = false;
        switch (script.type) {
            case 1: // Dialogue
                if (script.param) {
                    displayBubble(script);
                    if (script.option && Array.isArray(script.option[0])) {
                        const options = script.option.map(opt => ({ flag: opt[0], content: opt[1] }));
                        displayOptions(options);
                    } else {
                        currentScriptIndex++;
                        showNextLineAfterDelay();
                    }
                    processed = true;
                }
                break;
            case 3: // Red Envelope
                displayRedEnvelope(script);
                currentScriptIndex++;
                showNextLineAfterDelay();
                processed = true;
                break;
            case 4: // Sticker/Emoji
                displaySticker(script);
                currentScriptIndex++;
                showNextLineAfterDelay();
                processed = true;
                break;
            case 5: // System Message
                displaySystemMessage(script);
                currentScriptIndex++;
                showNextLineAfterDelay();
                processed = true;
                break;
        }
        if (!processed) {
            currentScriptIndex++;
            showNextLine();
        }
    };
    
    const showNextLineAfterDelay = (delay = 400) => {
        setTimeout(showNextLine, delay);
    }

    /**
     * Displays a dialogue bubble, now with group chat support.
     */
    const displayBubble = (script) => {
        const currentStoryInfo = allData[selectedCharacterName][storyDropdown.value];
        const isGroupChat = currentStoryInfo.ship_name === "그룹 채팅방";
        
        let speakerInfo = { name: '', icon: '', messageClass: 'narrator' };

        if (script.ship_group === 0) {
            speakerInfo = { name: '지휘관', icon: '', messageClass: 'player' };
        } else if (shipGroupToCharacterMap[script.ship_group]) {
            const speakerData = shipGroupToCharacterMap[script.ship_group];
            speakerInfo = {
                name: speakerData.kr_name,
                icon: speakerData.icon,
                messageClass: isGroupChat || script.ship_group === currentStoryInfo.ship_group ? 'character' : 'narrator'
            };
        }
        
        const messageBubble = document.createElement('div');
        messageBubble.classList.add('message-bubble', speakerInfo.messageClass);

        if (speakerInfo.name && speakerInfo.messageClass !== 'player') {
            messageBubble.innerHTML += `<p class="speaker-name">${speakerInfo.name}</p>`;
        }
        messageBubble.innerHTML += `<p>${script.param}</p>`;

        let topLevelElement = messageBubble;
        if (speakerInfo.messageClass === 'character' && speakerInfo.icon) {
            const wrapper = document.createElement('div');
            wrapper.className = 'character-line-wrapper';
            
            const portrait = document.createElement('img');
            portrait.className = 'portrait';
            portrait.src = speakerInfo.icon;
            portrait.alt = speakerInfo.name;

            wrapper.appendChild(portrait);
            wrapper.appendChild(messageBubble);
            storyContainer.appendChild(wrapper);
            topLevelElement = wrapper;
        } else {
            storyContainer.appendChild(messageBubble);
        }
        
        topLevelElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
    };

    /**
     * Displays a sticker/emoji from type 4 events.
     */
    function displaySticker(script) {
        const isPlayer = script.ship_group === 0;
        // NOTE: The sticker URL is an assumption based on common game asset patterns.
        const stickerUrl = `https://raw.githubusercontent.com/AzurLaneTools/AzurLaneMytools/main/page/azur-lane/data/sticker/${script.param}.png`;

        const container = document.createElement('div');
        container.className = 'sticker-container';

        const sticker = document.createElement('img');
        sticker.src = stickerUrl;
        sticker.className = 'sticker-image';
        sticker.alt = 'Sticker';
        
        container.appendChild(sticker);

        if (isPlayer) {
            const wrapper = document.createElement('div');
            wrapper.className = 'player';
            wrapper.style.background = 'transparent';
            wrapper.appendChild(container);
            storyContainer.appendChild(wrapper);
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'end' });
        } else {
            storyContainer.appendChild(container);
            container.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }

    /**
     * Displays a system message from type 5 events.
     */
    function displaySystemMessage(script) {
        const message = document.createElement('div');
        message.className = 'system-message';
        message.textContent = script.param;
        storyContainer.appendChild(message);
        message.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

     /**
     * Displays a red envelope from type 3 events.
     */
    function displayRedEnvelope(script) {
        const envelope = document.createElement('div');
        envelope.className = 'red-envelope-bubble';
        envelope.textContent = '세뱃돈을 탭하여 확인';
        storyContainer.appendChild(envelope);
        envelope.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

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
    
    const handleChoice = (chosenFlag, chosenText) => {
        displayBubble({ ship_group: 0, param: chosenText });
        optionsContainer.innerHTML = '';
        
        const foundIndex = currentStoryScripts.findIndex((script, index) => 
            index > currentScriptIndex && script.flag === chosenFlag
        );

        currentScriptIndex = (foundIndex !== -1) ? foundIndex : currentScriptIndex + 1;
        showNextLineAfterDelay();
    };

    storyDropdown.addEventListener('change', loadSelectedStory);
    restartButton.addEventListener('click', initializeStory);
});