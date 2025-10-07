/**
 * Unified Chat Viewer Engine
 * Supports both Instagram-style chats and Dorm3D conversations
 */
class ChatViewerEngine {
    constructor(config) {
        // Configuration
        this.dataUrl = config.dataUrl;
        this.shipGroupIdUrl = config.shipGroupIdUrl || null;
        this.groupChatIcons = config.groupChatIcons || {};
        this.defaultDelay = config.defaultDelay || 1300;
        this.initialDelay = config.initialDelay || 100;
        
        // DOM Elements
        this.characterGrid = document.getElementById('character-selector-grid');
        this.storyDisplaySection = document.getElementById('story-display-section');
        this.storyDropdown = document.getElementById('story-dropdown');
        this.unlockDescText = document.getElementById('unlock-desc-text');
        this.storyContainer = document.getElementById('story-container');
        this.optionsContainer = document.getElementById('options-container');
        this.restartButton = document.getElementById('restart-button');
        
        // Data and state
        this.allData = {};
        this.shipGroupIdData = {};
        this.selectedCharacterName = null;
        this.currentStoryScripts = [];
        this.currentScriptIndex = 0;
        
        // Custom handlers
        this.customHandlers = config.customHandlers || {};
        
        // Initialize
        this.initialize();
    }
    
    /**
     * Fetches data and initializes the viewer
     */
    async initialize() {
        try {
            const fetchPromises = [
                fetch(this.dataUrl).then(res => 
                    res.ok ? res.json() : Promise.reject(`Failed to load main data: ${res.status}`)
                )
            ];
            
            if (this.shipGroupIdUrl) {
                fetchPromises.push(
                    fetch(this.shipGroupIdUrl).then(res => 
                        res.ok ? res.json() : Promise.reject(`Failed to load ID data: ${res.status}`)
                    )
                );
            }
            
            const results = await Promise.all(fetchPromises);
            this.allData = results[0];
            if (results[1]) {
                this.shipGroupIdData = results[1];
            }
            
            this.populateCharacterSelector();
            this.attachEventListeners();
        } catch (error) {
            console.error('Error fetching story data:', error);
            this.characterGrid.innerHTML = '<p class="loading-message error">스토리 정보를 불러오는데 실패했어요.</p>';
        }
    }
    
    /**
     * Creates and displays character cards in the grid
     */
    populateCharacterSelector() {
        this.characterGrid.innerHTML = '';
        
        for (const characterName in this.allData) {
            const characterData = this.allData[characterName];
            const firstStoryId = Object.keys(characterData)[0];
            if (!firstStoryId) continue;
            
            const firstStory = characterData[firstStoryId];
            const card = document.createElement('div');
            card.className = 'character-card';
            card.dataset.characterName = characterName;
            
            let iconSrc = firstStory.icon;
            if (!iconSrc && this.groupChatIcons[firstStory.kr_name]) {
                iconSrc = this.groupChatIcons[firstStory.kr_name];
            } else if (!iconSrc) {
                iconSrc = 'https://via.placeholder.com/80';
            }
            
            const shipName = firstStory.ship_name || '';
            
            card.innerHTML = `
                <img src="${iconSrc}" alt="${firstStory.kr_name}">
                <p class="char-name">${firstStory.kr_name}</p>
                <p class="ship-name">${shipName}</p>
            `;
            
            card.addEventListener('click', () => this.handleCharacterClick(characterName));
            this.characterGrid.appendChild(card);
        }
    }
    
    /**
     * Handles clicking a character card
     */
    handleCharacterClick(characterName) {
        this.selectedCharacterName = characterName;
        
        document.querySelectorAll('.character-card').forEach(card => {
            card.classList.toggle('selected', card.dataset.characterName === characterName);
        });
        
        this.storyDisplaySection.classList.remove('hidden');
        this.populateStoryDropdown(this.allData[characterName]);
        this.storyContainer.innerHTML = '';
        this.optionsContainer.innerHTML = '';
    }
    
    /**
     * Populates the story dropdown menu
     */
    populateStoryDropdown(characterStories) {
        this.storyDropdown.innerHTML = '';
        
        for (const storyId in characterStories) {
            const story = characterStories[storyId];
            const option = document.createElement('option');
            option.value = storyId;
            option.textContent = story.name;
            this.storyDropdown.appendChild(option);
        }
        
        this.loadSelectedStory();
    }
    
    /**
     * Loads the story selected in the dropdown
     */
    loadSelectedStory() {
        const storyId = this.storyDropdown.value;
        if (!this.selectedCharacterName || !storyId) return;
        
        const storyData = this.allData[this.selectedCharacterName][storyId];
        this.currentStoryScripts = storyData.scripts;
        
        let flavorHTML = `<strong>해금 조건 :</strong> "${storyData.unlock_desc}"`;
        
        if (storyData.trigger_type === 2 && storyData.trigger_param) {
            flavorHTML += `<br><strong>요구 호감도 :</strong> ${storyData.trigger_param}`;
        }
        
        this.unlockDescText.innerHTML = flavorHTML;
        this.initializeStory();
    }
    
    /**
     * Clears the display and starts the current story
     */
    initializeStory() {
        this.storyContainer.innerHTML = '';
        this.optionsContainer.innerHTML = '';
        this.currentScriptIndex = 0;
        this.showNextLineAfterDelay(this.initialDelay);
    }
    
    /**
     * Main story progression engine
     */
    showNextLine() {
        if (this.currentScriptIndex >= this.currentStoryScripts.length) return;
        
        const script = this.currentStoryScripts[this.currentScriptIndex];
        let processed = false;
        
        switch (script.type) {
            case 1: // Dialogue
                if (script.param) {
                    this.displayBubble(script);
                    if (script.option && Array.isArray(script.option[0])) {
                        const options = script.option.map(opt => ({ flag: opt[0], content: opt[1] }));
                        this.displayOptions(options);
                    } else {
                        this.currentScriptIndex++;
                        this.showNextLineAfterDelay();
                    }
                    processed = true;
                }
                break;
                
            case 3: // Red Envelope (Instagram only)
                this.displayRedEnvelope(script);
                this.currentScriptIndex++;
                this.showNextLineAfterDelay();
                processed = true;
                break;
                
            case 4: // Sticker/Emoji or Special Event
                if (this.customHandlers.handleType4) {
                    this.customHandlers.handleType4.call(this, script);
                } else {
                    this.displaySticker(script);
                }
                this.currentScriptIndex++;
                this.showNextLineAfterDelay(this.initialDelay);
                processed = true;
                break;
                
            case 5: // System Message (Instagram only)
                this.displaySystemMessage(script);
                this.currentScriptIndex++;
                this.showNextLineAfterDelay();
                processed = true;
                break;
        }
        
        if (!processed) {
            this.currentScriptIndex++;
            this.showNextLine();
        }
    }
    
    /**
     * Delays before showing next line
     */
    showNextLineAfterDelay(delay = this.defaultDelay) {
        setTimeout(() => this.showNextLine(), delay);
    }
    
    /**
     * Displays a single dialogue bubble with portraits
     */
    displayBubble(script) {
        const currentStoryInfo = this.allData[this.selectedCharacterName][this.storyDropdown.value];
        let speakerName = script.kr_name || '';
        let speakerIcon = script.icon || '';
        let messageClass = '';
        
        // Determine message type
        if (script.ship_group === 0) {
            speakerName = '지휘관';
            messageClass = 'player';
        } else if (speakerName && speakerIcon) {
            messageClass = 'character';
        } else if (script.ship_group === currentStoryInfo.ship_group) {
            speakerName = currentStoryInfo.kr_name;
            speakerIcon = currentStoryInfo.icon;
            messageClass = 'character';
        } else {
            messageClass = 'narrator';
        }
        
        const messageBubble = document.createElement('div');
        messageBubble.classList.add('message-bubble', messageClass);
        
        // Add speaker name with optional ID
        if (messageClass === 'character') {
            const idEntry = this.shipGroupIdData[script.ship_group];
            let displayName = speakerName;
            if (idEntry && idEntry.name) {
                displayName += ` <span class="speaker-id">@${idEntry.name}</span>`;
            }
            messageBubble.innerHTML += `<p class="speaker-name">${displayName}</p>`;
        } else if (speakerName && messageClass !== 'player') {
            messageBubble.innerHTML += `<p class="speaker-name">${speakerName}</p>`;
        }
        
        messageBubble.innerHTML += `<p>${script.param}</p>`;
        
        let topLevelElement = messageBubble;
        
        // Add portrait for character messages
        if (messageClass === 'character') {
            const wrapper = document.createElement('div');
            wrapper.className = 'character-line-wrapper';
            
            const portrait = document.createElement('img');
            portrait.className = 'portrait';
            portrait.src = speakerIcon;
            portrait.alt = speakerName;
            
            wrapper.appendChild(portrait);
            wrapper.appendChild(messageBubble);
            this.storyContainer.appendChild(wrapper);
            topLevelElement = wrapper;
        } else {
            this.storyContainer.appendChild(messageBubble);
        }
        
        topLevelElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
        return topLevelElement;
    }
    
    /**
     * Displays a sticker/emoji
     */
    displaySticker(script) {
        const isPlayer = script.ship_group === 0;
        const stickerUrl = `https://raw.githubusercontent.com/JforPlay/data_for_toy/main/emoji/${script.param}.png`;
        
        const container = document.createElement('div');
        container.className = 'sticker-container';
        
        const sticker = document.createElement('img');
        sticker.src = stickerUrl;
        sticker.className = 'sticker-image';
        sticker.alt = '움짤은 아직 안돼요..';
        
        container.appendChild(sticker);
        
        if (isPlayer) {
            const wrapper = document.createElement('div');
            wrapper.className = 'player';
            wrapper.style.background = 'transparent';
            wrapper.appendChild(container);
            this.storyContainer.appendChild(wrapper);
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
            this.storyContainer.appendChild(wrapper);
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }
    
    /**
     * Displays a system message
     */
    displaySystemMessage(script) {
        const message = document.createElement('div');
        message.className = 'system-message';
        message.textContent = script.param;
        this.storyContainer.appendChild(message);
        message.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    
    /**
     * Displays a red envelope
     */
    displayRedEnvelope(script) {
        const envelope = document.createElement('div');
        envelope.className = 'red-envelope-bubble';
        envelope.textContent = '세뱃돈을 탭하여 확인';
        this.storyContainer.appendChild(envelope);
        envelope.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    
    /**
     * Displays choice buttons for the player
     */
    displayOptions(options) {
        this.optionsContainer.innerHTML = '';
        
        options.forEach(option => {
            const button = document.createElement('button');
            button.classList.add('choice-button');
            button.textContent = option.content;
            button.onclick = () => this.handleChoice(option.flag, option.content);
            this.optionsContainer.appendChild(button);
        });
        
        this.optionsContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    
    /**
     * Handles the player's choice and finds the next script block
     */
    handleChoice(chosenFlag, chosenText) {
        this.displayBubble({ ship_group: 0, param: chosenText });
        this.optionsContainer.innerHTML = '';
        
        const foundIndex = this.currentStoryScripts.findIndex((script, index) => 
            index > this.currentScriptIndex && script.flag === chosenFlag
        );
        
        this.currentScriptIndex = (foundIndex !== -1) ? foundIndex : this.currentScriptIndex + 1;
        this.showNextLineAfterDelay();
    }
    
    /**
     * Attaches event listeners to controls
     */
    attachEventListeners() {
        this.storyDropdown.addEventListener('change', () => this.loadSelectedStory());
        this.restartButton.addEventListener('click', () => this.initializeStory());
    }
}