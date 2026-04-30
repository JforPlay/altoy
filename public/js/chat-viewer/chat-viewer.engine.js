/**
 * chat-viewer.engine.js
 * Shared chat playback engine for Juustagram and Dorm3D viewers.
 * Accepts a config object from the page-specific init script (juus.js / dorm3d.js)
 * that provides the data URL, timing, group chat icons, and optional type-4 handler.
 * Renders a character selector grid, story dropdown, and auto-advancing message bubbles.
 */
import { fetchJSON, showElement, createImgElement } from '../utils.js';

const PLACEHOLDER_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23e0e0e0'/%3E%3C/svg%3E";

function clearElement(element) {
    if (element) element.textContent = '';
}

function appendLoadingMessage(container, message, isError = false) {
    if (!container) return;
    clearElement(container);
    const p = document.createElement('p');
    p.className = `loading-message${isError ? ' error' : ''}`;
    p.textContent = message;
    container.appendChild(p);
}

export class ChatViewerEngine {
    /**
     * Create and immediately start a chat viewer instance.
     * @param {Object} config
     * @param {string} config.dataUrl - URL to fetch chat data JSON
     * @param {string} [config.shipGroupIdUrl] - External source for @username handles
     * @param {Object<string, string>} [config.groupChatIcons] - Group chat name → icon URL
     * @param {number} [config.defaultDelay=1300] - Delay between messages (ms)
     * @param {number} [config.initialDelay=100] - Delay before first message (ms)
     * @param {Object} [config.customHandlers] - Optional overrides for script type handlers
     */
    constructor(config) {
        this.dataUrl = config.dataUrl;
        this.shipGroupIdUrl = config.shipGroupIdUrl || null;
        this.groupChatIcons = config.groupChatIcons || {};
        this.defaultDelay = config.defaultDelay || 1300;
        this.initialDelay = config.initialDelay || 100;

        // DOM elements cached at construction time
        this.characterGrid = document.getElementById('character-selector-grid');
        this.characterSelectionSection = document.getElementById('character-selection-section');
        this.selectedCharacterNameDisplay = document.getElementById('selected-character-name');
        this.storyDisplaySection = document.getElementById('story-display-section');
        this.storyDropdown = document.getElementById('story-dropdown');
        this.unlockDescText = document.getElementById('unlock-desc-text');
        this.storyContainer = document.getElementById('story-container');
        this.optionsContainer = document.getElementById('options-container');
        this.restartButton = document.getElementById('restart-button');

        this.allData = {};
        this.shipGroupIdData = {};
        this.selectedCharacterName = null;
        this.currentStoryScripts = [];
        this.currentScriptIndex = 0;

        // NodeList cached after grid population for faster per-click queries
        this.characterCards = null;

        // All setTimeout IDs tracked here so clearTimers() can cancel them atomically
        this.activeTimers = [];

        this.customHandlers = config.customHandlers || {};

        // Bind so removeEventListener gets the same reference
        this.handleStoryChange = this.loadSelectedStory.bind(this);
        this.handleRestart = this.initializeStory.bind(this);
        this.handleSectionToggle = () => {
            const collapsed = this.characterSelectionSection.classList.toggle('collapsed');
            this.sectionHeader?.setAttribute('aria-expanded', String(!collapsed));
        };
        this.handleSectionToggleKeydown = (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            this.handleSectionToggle();
        };

        this.initialize();
    }
    
    // ===== Data Loading =====

    /**
     * Fetch chat data (and optional ship group IDs) in parallel, then
     * populate the character grid and attach event listeners.
     */
    async initialize() {
        try {
            const fetchPromises = [fetchJSON(this.dataUrl)];

            if (this.shipGroupIdUrl) {
                fetchPromises.push(fetchJSON(this.shipGroupIdUrl));
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
            appendLoadingMessage(this.characterGrid, '스토리 정보를 불러오는데 실패했어요.', true);
        }
    }
    
    // ===== Message Rendering =====

    // ===== Character Selection =====

    /**
     * Build and insert character cards into the grid.
     * Uses a DocumentFragment for a single DOM insertion, then caches the NodeList.
     */
    populateCharacterSelector() {
        clearElement(this.characterGrid);
        const fragment = document.createDocumentFragment();

        for (const characterName in this.allData) {
            const characterData = this.allData[characterName];
            const firstStoryId = Object.keys(characterData)[0];
            if (!firstStoryId) continue;

            const firstStory = characterData[firstStoryId];
            const card = document.createElement('div');
            card.className = 'character-card';
            card.dataset.characterName = characterName;
            card.setAttribute('role', 'button');
            card.setAttribute('aria-pressed', 'false');
            card.tabIndex = 0;

            let iconSrc = firstStory.icon;
            if (!iconSrc && this.groupChatIcons[firstStory.kr_name]) {
                iconSrc = this.groupChatIcons[firstStory.kr_name];
            } else if (!iconSrc) {
                iconSrc = PLACEHOLDER_ICON;
            }

            const shipName = firstStory.ship_name || '';

            const img = createImgElement(iconSrc, firstStory.kr_name, {
                fallback: PLACEHOLDER_ICON,
            });

            const charNameP = document.createElement('p');
            charNameP.className = 'char-name';
            charNameP.textContent = firstStory.kr_name;

            const shipNameP = document.createElement('p');
            shipNameP.className = 'ship-name';
            shipNameP.textContent = shipName;

            card.appendChild(img);
            card.appendChild(charNameP);
            card.appendChild(shipNameP);

            const activate = (event) => {
                event.preventDefault();
                this.handleCharacterClick(characterName);
            };
            card.addEventListener('click', activate);
            card.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') activate(event);
            });
            fragment.appendChild(card);
        }

        if (!fragment.childElementCount) {
            appendLoadingMessage(this.characterGrid, '표시할 채팅 데이터가 없습니다.');
            return;
        }

        this.characterGrid.appendChild(fragment);
        this.characterCards = this.characterGrid.querySelectorAll('.character-card');
    }
    
    /**
     * Select a character: highlight their card, collapse the selector,
     * reveal the story section, and load their first story.
     */
    handleCharacterClick(characterName) {
        this.selectedCharacterName = characterName;

        if (this.characterCards) {
            this.characterCards.forEach(card => {
                const selected = card.dataset.characterName === characterName;
                card.classList.toggle('selected', selected);
                card.setAttribute('aria-pressed', String(selected));
            });
        }

        const characterData = this.allData[characterName];
        const firstStoryId = Object.keys(characterData)[0];
        const displayName = characterData[firstStoryId]?.kr_name || characterName;

        if (this.selectedCharacterNameDisplay) {
            this.selectedCharacterNameDisplay.textContent = `(${displayName})`;
        }

        this.characterSelectionSection.classList.add('collapsed');
        this.sectionHeader?.setAttribute('aria-expanded', 'false');

        showElement(this.storyDisplaySection);
        this.populateStoryDropdown(this.allData[characterName]);
        clearElement(this.storyContainer);
        clearElement(this.optionsContainer);

        this.setTrackedTimeout(() => {
            this.storyDisplaySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
    
    // ===== Story Playback =====

    /** Fill the dropdown with all stories for the selected character, then auto-load the first. */
    populateStoryDropdown(characterStories) {
        clearElement(this.storyDropdown);
        
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
     * Read the dropdown selection, set the unlock condition text,
     * and reset playback to the beginning of the chosen story.
     */
    loadSelectedStory() {
        const storyId = this.storyDropdown.value;
        if (!this.selectedCharacterName || !storyId) return;
        
        const storyData = this.allData[this.selectedCharacterName][storyId];
        this.currentStoryScripts = Array.isArray(storyData.scripts) ? storyData.scripts : [];
        
        clearElement(this.unlockDescText);
        const conditionLabel = document.createElement('strong');
        conditionLabel.textContent = '해금 조건 :';
        this.unlockDescText.append(conditionLabel, document.createTextNode(` "${storyData.unlock_desc || ''}"`));

        if (storyData.trigger_type === 2 && storyData.trigger_param) {
            this.unlockDescText.appendChild(document.createElement('br'));
            const affectionLabel = document.createElement('strong');
            affectionLabel.textContent = '요구 호감도 :';
            this.unlockDescText.append(affectionLabel, document.createTextNode(` ${storyData.trigger_param}`));
        }

        this.initializeStory();
    }
    
    /** Cancel pending timers, clear the message container, and begin message playback. */
    initializeStory() {
        // Clear any pending timers
        this.clearTimers();

        clearElement(this.storyContainer);
        clearElement(this.optionsContainer);
        this.currentScriptIndex = 0;
        this.showNextLineAfterDelay(this.initialDelay);
    }
    
    /**
     * Scroll the story container to the bottom after a new message is appended,
     * but only if the user is already near the bottom (within 150px). This lets
     * users scroll up to re-read earlier messages without being yanked back down.
     */
    scrollToLatest(element) {
        // Double rAF ensures the element is in the layout before measuring.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const container = this.storyContainer;

                const scrolledFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
                const isNearBottom = scrolledFromBottom < 150 || container.scrollHeight <= container.clientHeight;

                // Only auto-scroll if user hasn't scrolled up to read old messages
                if (isNearBottom) {
                    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
                }
            });
        });
    }

    /**
     * Advance to the next script entry. Dispatches by type:
     * 1=dialogue, 3=red envelope, 4=sticker/special event, 5=system message.
     * Unknown types are silently skipped. Stops when all scripts are consumed.
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
    
    /** Schedule the next script line after `delay` ms; tracks the timer for cleanup. */
    showNextLineAfterDelay(delay = this.defaultDelay) {
        this.setTrackedTimeout(() => this.showNextLine(), delay);
    }
    
    /**
     * Render a dialogue bubble for one script line.
     * Determines speaker role (player / character / narrator), resolves icon and
     * @username, then wraps in a character-line-wrapper when a portrait is needed.
     */
    displayBubble(script) {
        const currentStoryInfo = this.allData[this.selectedCharacterName][this.storyDropdown.value];
        let speakerName = script.kr_name || '';
        let speakerIcon = script.icon || '';
        let speakerUsername = '';
        let messageClass = '';
        
        // ship_group === 0 → player; named icon present → character; otherwise → narrator
        if (script.ship_group === 0) {
            speakerName = '지휘관';
            messageClass = 'player';
        } else if (speakerName && speakerIcon) {
            messageClass = 'character';
            // Guest characters may have an @username from the ship group ID source
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
        
        if (messageClass === 'character') {
            const speakerNameElement = document.createElement('p');
            speakerNameElement.className = 'speaker-name';
            speakerNameElement.textContent = speakerName;
            
            if (speakerUsername) {
                const speakerId = document.createElement('span');
                speakerId.className = 'speaker-id';
                speakerId.textContent = ` @${speakerUsername}`;
                speakerNameElement.appendChild(speakerId);
            }
            
            messageBubble.appendChild(speakerNameElement);
        } else if (speakerName && messageClass !== 'player') {
            const speakerNameElement = document.createElement('p');
            speakerNameElement.className = 'speaker-name';
            speakerNameElement.textContent = speakerName;
            messageBubble.appendChild(speakerNameElement);
        }
        
        const messageText = document.createElement('p');
        messageText.textContent = script.param;
        messageBubble.appendChild(messageText);
        
        let topLevelElement = messageBubble;
        
        if (messageClass === 'character') {
            const wrapper = document.createElement('div');
            wrapper.className = 'character-line-wrapper';

            const portrait = createImgElement(speakerIcon, speakerName, {
                className: 'portrait',
                fallback: PLACEHOLDER_ICON,
            });

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
    
    /** Render a sticker image fetched from the emoji asset repo. Wraps in player or character layout. */
    displaySticker(script) {
        const isPlayer = script.ship_group === 0;
        const stickerUrl = `https://raw.githubusercontent.com/JforPlay/data_for_toy/main/emoji/${script.param}.webp`;

        const container = document.createElement('div');
        container.className = 'sticker-container';

        const sticker = createImgElement(stickerUrl, '움짤은 아직 안돼요..', {
            className: 'sticker-image',
            onError: () => {
                sticker.alt = '이미지를 불러올 수 없습니다';
                sticker.style.display = 'none';
            },
        });

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

            const portrait = createImgElement(script.icon, script.kr_name, {
                className: 'portrait',
                fallback: PLACEHOLDER_ICON,
            });

            wrapper.appendChild(portrait);
            wrapper.appendChild(container);
            this.storyContainer.appendChild(wrapper);
            this.scrollToLatest(wrapper);
        }
    }
    
    /** Render a system/notification message (Juustagram only, script type 5). */
    displaySystemMessage(script) {
        const message = document.createElement('div');
        message.className = 'system-message';
        message.textContent = script.param;
        this.storyContainer.appendChild(message);
        this.scrollToLatest(message);
    }

    /** Render the red envelope element (Juustagram only, script type 3). */
    displayRedEnvelope(script) {
        const envelope = document.createElement('div');
        envelope.className = 'red-envelope-bubble';
        envelope.textContent = '세뱃돈을 탭하여 확인';
        this.storyContainer.appendChild(envelope);
        this.scrollToLatest(envelope);
    }
    
    /**
     * Render choice buttons and force-scroll to the bottom so they're immediately visible
     * (they push earlier bubbles upward and can be clipped without the scroll).
     */
    displayOptions(options) {
        clearElement(this.optionsContainer);

        options.forEach(option => {
            const button = document.createElement('button');
            button.type = 'button';
            button.classList.add('choice-button');
            button.textContent = option.content;
            button.addEventListener('click', () => this.handleChoice(option.flag, option.content));
            this.optionsContainer.appendChild(button);
        });

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
     * Record the player's choice: show it as a bubble, clear options,
     * then jump to the first script entry tagged with the chosen flag.
     * Falls back to the line immediately after the options if no match.
     */
    handleChoice(chosenFlag, chosenText) {
        this.displaySelectedChoice(chosenText);
        clearElement(this.optionsContainer);
        
        const foundIndex = this.currentStoryScripts.findIndex((script, index) => 
            index > this.currentScriptIndex && script.flag === chosenFlag
        );
        
        this.currentScriptIndex = (foundIndex !== -1) ? foundIndex : this.currentScriptIndex + 1;
        this.showNextLineAfterDelay();
    }
    
    /** Render the chosen option as a player bubble so the choice appears in the chat history. */
    displaySelectedChoice(chosenText) {
        const choiceBubble = document.createElement('div');
        choiceBubble.classList.add('message-bubble', 'player', 'selected-choice');
        const p = document.createElement('p');
        p.textContent = chosenText;
        choiceBubble.appendChild(p);

        this.storyContainer.appendChild(choiceBubble);
        this.scrollToLatest(choiceBubble);
    }

    // ===== Controls & Cleanup =====

    /** Append the end-of-conversation marker to signal no more messages. */
    displayEndOfConversation() {
        const endMessage = document.createElement('div');
        endMessage.className = 'end-of-conversation';
        endMessage.textContent = '대화 종료';
        this.storyContainer.appendChild(endMessage);
        this.scrollToLatest(endMessage);
    }
    
    /** Wire dropdown change, restart button, and collapsible section header. */
    attachEventListeners() {
        this.storyDropdown.addEventListener('change', this.handleStoryChange);
        this.restartButton.addEventListener('click', this.handleRestart);

        // Toggle character selection section
        this.sectionHeader = this.characterSelectionSection.querySelector('h3');
        if (this.sectionHeader) {
            this.sectionHeader.setAttribute('role', 'button');
            this.sectionHeader.tabIndex = 0;
            this.sectionHeader.setAttribute('aria-expanded', String(!this.characterSelectionSection.classList.contains('collapsed')));
            this.sectionHeader.addEventListener('click', this.handleSectionToggle);
            this.sectionHeader.addEventListener('keydown', this.handleSectionToggleKeydown);
        }
    }

    /**
     * Schedule a timeout and remove it from activeTimers once it fires, keeping
     * long conversations from accumulating stale timer IDs.
     */
    setTrackedTimeout(callback, delay) {
        const timer = setTimeout(() => {
            this.activeTimers = this.activeTimers.filter(activeTimer => activeTimer !== timer);
            callback();
        }, delay);
        this.activeTimers.push(timer);
        return timer;
    }

    /** Cancel all queued setTimeout calls so switching stories doesn't produce stale messages. */
    clearTimers() {
        this.activeTimers.forEach(timer => clearTimeout(timer));
        this.activeTimers = [];
    }

    /**
     * Full teardown: cancel timers, remove all event listeners, and clear cached data.
     * Call when navigating away or before re-initializing the viewer.
     */
    destroy() {
        this.clearTimers();

        if (this.storyDropdown) {
            this.storyDropdown.removeEventListener('change', this.handleStoryChange);
        }

        if (this.restartButton) {
            this.restartButton.removeEventListener('click', this.handleRestart);
        }

        if (this.sectionHeader) {
            this.sectionHeader.removeEventListener('click', this.handleSectionToggle);
            this.sectionHeader.removeEventListener('keydown', this.handleSectionToggleKeydown);
        }

        // Replace card nodes to strip their per-card click listeners without tracking each one
        if (this.characterCards) {
            this.characterCards.forEach(card => {
                card.replaceWith(card.cloneNode(true));
            });
        }

        this.characterCards = null;
        this.allData = {};
        this.shipGroupIdData = {};

        console.log('[ChatViewerEngine] destroyed');
    }
}
