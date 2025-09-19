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
    let selectedCharacterName = null;
    let currentStoryScripts = [];
    let currentScriptIndex = 0;

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
    
    /**
     * MODIFIED: Now checks for trigger_type 2 to display affinity requirements.
     */
    function loadSelectedStory() {
        const storyId = storyDropdown.value;
        if (!selectedCharacterName || !storyId) return;

        const storyData = allData[selectedCharacterName][storyId];
        currentStoryScripts = storyData.scripts;
        
        // Build the flavor text string conditionally
        let flavorHTML = `<strong>해금 조건 :</strong> "${storyData.unlock_desc}"`;

        // If the trigger_type is 2 (affinity), add the required level
        if (storyData.trigger_type === 2 && storyData.trigger_param) {
            flavorHTML += `<br><strong>요구 호감도 :</strong> ${storyData.trigger_param}`;
        }
        
        unlockDescText.innerHTML = flavorHTML;
        
        initializeStory();
    }

    const initializeStory = () => {
        storyContainer.innerHTML = '';
        optionsContainer.innerHTML = '';
        currentScriptIndex = 0;
        showNextLineAfterDelay(100);
    };

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

    const displayBubble = (script) => {
        let speakerName = script.kr_name || '';
        let speakerIcon = script.icon || '';
        let messageClass = '';
        
        if (script.ship_group === 0) {
            messageClass = 'player';
        } else if (speakerName && speakerIcon) {
            messageClass = 'character';
        } else {
            messageClass = 'narrator';
        }
        
        const messageBubble = document.createElement('div');
        messageBubble.classList.add('message-bubble', messageClass);

        if (messageClass === 'character') {
             messageBubble.innerHTML += `<p class="speaker-name">${speakerName}</p>`;
        }
        messageBubble.innerHTML += `<p>${script.param}</p>`;

        let topLevelElement = messageBubble;
        if (messageClass === 'character') {
            const wrapper = document.createElement('div');
            wrapper.className = 'character-line-wrapper';
            
            const portrait = document.createElement('img');
            portrait.className = 'portrait';
            portrait.src = speakerIcon;
            portrait.alt = speakerName;

            wrapper.appendChild(portrait);
            wrapper.appendChild(messageBubble);
            storyContainer.appendChild(wrapper);
            topLevelElement = wrapper;
        } else {
            storyContainer.appendChild(messageBubble);
        }
        
        topLevelElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
    };

    function displaySticker(script) {
        const isPlayer = script.ship_group === 0;
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
            const wrapper = document.createElement('div');
            wrapper.className = 'character-line-wrapper';

            const portrait = document.createElement('img');
            portrait.className = 'portrait';
            portrait.src = script.icon; 
            portrait.alt = script.kr_name;
            
            wrapper.appendChild(portrait);
            wrapper.appendChild(container);
            storyContainer.appendChild(wrapper);
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }

    function displaySystemMessage(script) {
        const message = document.createElement('div');
        message.className = 'system-message';
        message.textContent = script.param;
        storyContainer.appendChild(message);
        message.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

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