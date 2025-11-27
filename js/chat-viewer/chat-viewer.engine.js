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

        // DOM Elements (cached for performance)
        this.characterGrid = document.getElementById('character-selector-grid');
        this.characterSelectionSection = document.getElementById('character-selection-section');
        this.selectedCharacterNameDisplay = document.getElementById('selected-character-name');
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

        // Cached character cards for efficient queries
        this.characterCards = null;

        // Timer management for cleanup
        this.activeTimers = [];

        // Custom handlers
        this.customHandlers = config.customHandlers || {};

        // Bind event handlers
        this.handleStoryChange = this.loadSelectedStory.bind(this);
        this.handleRestart = this.initializeStory.bind(this);
        this.handleSectionToggle = () => {
            this.characterSelectionSection.classList.toggle('collapsed');
        };

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
        const fragment = document.createDocumentFragment();

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
                // SVG fallback placeholder (no external dependency)
                iconSrc = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23e0e0e0'/%3E%3C/svg%3E";
            }

            const shipName = firstStory.ship_name || '';

            // Create image element with error handling
            const img = document.createElement('img');
            img.src = iconSrc;
            img.alt = firstStory.kr_name;
            img.onerror = () => {
                // Fallback to placeholder on error
                img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23e0e0e0'/%3E%3C/svg%3E";
            };

            const charNameP = document.createElement('p');
            charNameP.className = 'char-name';
            charNameP.textContent = firstStory.kr_name;

            const shipNameP = document.createElement('p');
            shipNameP.className = 'ship-name';
            shipNameP.textContent = shipName;

            card.appendChild(img);
            card.appendChild(charNameP);
            card.appendChild(shipNameP);

            card.addEventListener('click', () => this.handleCharacterClick(characterName));
            fragment.appendChild(card);
        }

        this.characterGrid.appendChild(fragment);
        // Cache character cards for efficient queries
        this.characterCards = this.characterGrid.querySelectorAll('.character-card');
    }
    
    /**
     * Handles clicking a character card
     */
    handleCharacterClick(characterName) {
        this.selectedCharacterName = characterName;

        // Use cached character cards for better performance
        if (this.characterCards) {
            this.characterCards.forEach(card => {
                card.classList.toggle('selected', card.dataset.characterName === characterName);
            });
        }

        // Get character display name
        const characterData = this.allData[characterName];
        const firstStoryId = Object.keys(characterData)[0];
        const displayName = characterData[firstStoryId]?.kr_name || characterName;

        // Update collapsed state display
        if (this.selectedCharacterNameDisplay) {
            this.selectedCharacterNameDisplay.textContent = `(${displayName})`;
        }

        // Collapse character selection section
        this.characterSelectionSection.classList.add('collapsed');

        this.storyDisplaySection.classList.remove('hidden');
        this.populateStoryDropdown(this.allData[characterName]);
        this.storyContainer.innerHTML = '';
        this.optionsContainer.innerHTML = '';

        // Smooth scroll to show the chat section
        const scrollTimer = setTimeout(() => {
            this.storyDisplaySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
        this.activeTimers.push(scrollTimer);
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
        // Clear any pending timers
        this.clearTimers();

        this.storyContainer.innerHTML = '';
        this.optionsContainer.innerHTML = '';
        this.currentScriptIndex = 0;
        this.showNextLineAfterDelay(this.initialDelay);
    }
    
    /**
     * Modern chat-style auto-scroll with smart behavior
     * Only scrolls if user is near the bottom (not reading old messages)
     * Adds comfortable spacing for better readability
     */
    scrollToLatest(element) {
        // Small delay to ensure element is rendered and CSS transitions applied
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const container = this.storyContainer;

                // For initial messages or when at bottom, always scroll
                // Check if user is near the bottom (within 150px) or container is very short
                const scrolledFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
                const isNearBottom = scrolledFromBottom < 150 || container.scrollHeight <= container.clientHeight;

                // Only auto-scroll if user hasn't scrolled up to read old messages
                if (isNearBottom) {
                    // Modern approach: scroll container to bottom with smooth animation
                    container.scrollTo({
                        top: container.scrollHeight,
                        behavior: 'smooth'
                    });
                }
            });
        });
    }

    /**
     * Main story progression engine
     */
    showNextLine() {
        if (this.currentScriptIndex >= this.currentStoryScripts.length) {
            // Display end of conversation message
            this.displayEndOfConversation();
            return;
        }
        
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
        const timer = setTimeout(() => this.showNextLine(), delay);
        this.activeTimers.push(timer);
    }
    
    /**
     * Displays a single dialogue bubble with portraits
     */
    displayBubble(script) {
        const currentStoryInfo = this.allData[this.selectedCharacterName][this.storyDropdown.value];
        let speakerName = script.kr_name || '';
        let speakerIcon = script.icon || '';
        let speakerUsername = '';
        let messageClass = '';
        
        // Determine message type
        if (script.ship_group === 0) {
            speakerName = '지휘관';
            messageClass = 'player';
        } else if (speakerName && speakerIcon) {
            messageClass = 'character';
            // For guest characters, check if we have their username
            if (this.shipGroupIdData && script.ship_group) {
                const idEntry = this.shipGroupIdData[script.ship_group];
                if (idEntry && idEntry.name) {
                    speakerUsername = idEntry.name;
                }
            }
        } else if (script.ship_group === currentStoryInfo.ship_group) {
            speakerName = currentStoryInfo.kr_name;
            speakerIcon = currentStoryInfo.icon;
            speakerUsername = currentStoryInfo.ship_name || '';
            messageClass = 'character';
        } else {
            messageClass = 'narrator';
        }
        
        const messageBubble = document.createElement('div');
        messageBubble.classList.add('message-bubble', messageClass);
        
        // Add speaker name with optional ID
        if (messageClass === 'character') {
            const speakerNameElement = document.createElement('p');
            speakerNameElement.className = 'speaker-name';
            speakerNameElement.textContent = speakerName;
            
            // Append @username if available
            if (speakerUsername) {
                const speakerId = document.createElement('span');
                speakerId.className = 'speaker-id';
                speakerId.textContent = ` @${speakerUsername}`;
                speakerNameElement.appendChild(speakerId);
            }
            
            messageBubble.appendChild(speakerNameElement);
        } else if (speakerName && messageClass !== 'player') {
            messageBubble.innerHTML += `<p class="speaker-name">${speakerName}</p>`;
        }
        
        const messageText = document.createElement('p');
        messageText.textContent = script.param;
        messageBubble.appendChild(messageText);
        
        let topLevelElement = messageBubble;
        
        // Add portrait for character messages
        if (messageClass === 'character') {
            const wrapper = document.createElement('div');
            wrapper.className = 'character-line-wrapper';

            const portrait = document.createElement('img');
            portrait.className = 'portrait';
            portrait.src = speakerIcon;
            portrait.alt = speakerName;
            // Add error handling for portrait images
            portrait.onerror = () => {
                portrait.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23e0e0e0'/%3E%3C/svg%3E";
            };

            wrapper.appendChild(portrait);
            wrapper.appendChild(messageBubble);
            this.storyContainer.appendChild(wrapper);
            topLevelElement = wrapper;
        } else {
            this.storyContainer.appendChild(messageBubble);
        }

        this.scrollToLatest(topLevelElement);
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
        // Add error handling for sticker images
        sticker.onerror = () => {
            sticker.alt = '이미지를 불러올 수 없습니다';
            sticker.style.display = 'none';
        };

        container.appendChild(sticker);

        if (isPlayer) {
            const wrapper = document.createElement('div');
            wrapper.className = 'player';
            wrapper.style.background = 'transparent';
            wrapper.appendChild(container);
            this.storyContainer.appendChild(wrapper);
            this.scrollToLatest(wrapper);
        } else {
            const wrapper = document.createElement('div');
            wrapper.className = 'character-line-wrapper';

            const portrait = document.createElement('img');
            portrait.className = 'portrait';
            portrait.src = script.icon;
            portrait.alt = script.kr_name;
            // Add error handling for portrait images
            portrait.onerror = () => {
                portrait.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23e0e0e0'/%3E%3C/svg%3E";
            };

            wrapper.appendChild(portrait);
            wrapper.appendChild(container);
            this.storyContainer.appendChild(wrapper);
            this.scrollToLatest(wrapper);
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
        this.scrollToLatest(message);
    }

    /**
     * Displays a red envelope
     */
    displayRedEnvelope(script) {
        const envelope = document.createElement('div');
        envelope.className = 'red-envelope-bubble';
        envelope.textContent = '세뱃돈을 탭하여 확인';
        this.storyContainer.appendChild(envelope);
        this.scrollToLatest(envelope);
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

        // Force scroll to bottom when options appear (they push content up)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const container = this.storyContainer;
                container.scrollTo({
                    top: container.scrollHeight,
                    behavior: 'smooth'
                });
            });
        });
    }
    
    /**
     * Handles the player's choice and finds the next script block
     */
    handleChoice(chosenFlag, chosenText) {
        // Display the selected choice as a small option bubble
        this.displaySelectedChoice(chosenText);
        this.optionsContainer.innerHTML = '';
        
        const foundIndex = this.currentStoryScripts.findIndex((script, index) => 
            index > this.currentScriptIndex && script.flag === chosenFlag
        );
        
        this.currentScriptIndex = (foundIndex !== -1) ? foundIndex : this.currentScriptIndex + 1;
        this.showNextLineAfterDelay();
    }
    
    /**
     * Displays the selected choice as a small option bubble
     */
    displaySelectedChoice(chosenText) {
        const choiceBubble = document.createElement('div');
        choiceBubble.classList.add('message-bubble', 'player', 'selected-choice');
        choiceBubble.innerHTML = `<p>${chosenText}</p>`;

        this.storyContainer.appendChild(choiceBubble);
        this.scrollToLatest(choiceBubble);
    }

    /**
     * Displays end of conversation message
     */
    displayEndOfConversation() {
        const endMessage = document.createElement('div');
        endMessage.className = 'end-of-conversation';
        endMessage.textContent = '대화 종료';
        this.storyContainer.appendChild(endMessage);
        this.scrollToLatest(endMessage);
    }
    
    /**
     * Attaches event listeners to controls
     */
    attachEventListeners() {
        this.storyDropdown.addEventListener('change', this.handleStoryChange);
        this.restartButton.addEventListener('click', this.handleRestart);

        // Toggle character selection section
        const sectionHeader = this.characterSelectionSection.querySelector('h3');
        if (sectionHeader) {
            sectionHeader.addEventListener('click', this.handleSectionToggle);
        }
    }

    /**
     * Clears all active timers
     */
    clearTimers() {
        this.activeTimers.forEach(timer => clearTimeout(timer));
        this.activeTimers = [];
    }

    /**
     * Cleanup method for proper resource management
     * Call this when navigating away or before re-initializing
     */
    destroy() {
        // Clear all pending timers
        this.clearTimers();

        // Remove event listeners
        if (this.storyDropdown) {
            this.storyDropdown.removeEventListener('change', this.handleStoryChange);
        }

        if (this.restartButton) {
            this.restartButton.removeEventListener('click', this.handleRestart);
        }

        const sectionHeader = this.characterSelectionSection?.querySelector('h3');
        if (sectionHeader) {
            sectionHeader.removeEventListener('click', this.handleSectionToggle);
        }

        // Clear character card event listeners (if needed for re-initialization)
        if (this.characterCards) {
            this.characterCards.forEach(card => {
                card.replaceWith(card.cloneNode(true));
            });
        }

        // Clear cached references
        this.characterCards = null;
        this.allData = {};
        this.shipGroupIdData = {};

        console.log('ChatViewerEngine cleaned up successfully');
    }
}