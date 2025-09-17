document.addEventListener('DOMContentLoaded', () => {
    // URLs for external data
    const STORY_URL = 'test.json';
    const SHIPGIRL_DATA_URL = 'shipgirl_data.json';

    // Get HTML elements
    const storyContainer = document.getElementById('story-container');
    const optionsContainer = document.getElementById('options-container');
    const storyHeader = document.getElementById('story-header');
    const restartButton = document.getElementById('restart-button');
    const vfxOverlay = document.getElementById('vfx-overlay');
    const flashOverlay = document.getElementById('flash-overlay');

    // Story state and data maps
    let allScripts = [];
    let currentScriptIndex = 0;
    let shipgirlData = {};

    const initializeStory = () => {
        storyHeader.innerHTML = '';
        storyContainer.innerHTML = '';
        optionsContainer.innerHTML = '';
        vfxOverlay.className = '';
        flashOverlay.style.opacity = 0;
        currentScriptIndex = 0;
        processHeader();
        currentScriptIndex = 1;
        showNextLine();
    };

    const showNextLine = () => {
        if (currentScriptIndex >= allScripts.length) return;
        const script = allScripts[currentScriptIndex];

        const continueAfterEffect = () => {
            if (script.effects) processEffects(script.effects);

            if (script.options) {
                const bubbleElement = displayBubble(script);
                if (script.action) handleAction(script.action, bubbleElement);
                displayOptions(script.options);
            } else if (script.say) {
                const bubbleElement = displayBubble(script);
                if (script.action) handleAction(script.action, bubbleElement);
                currentScriptIndex++;
                setTimeout(showNextLine, 400);
            } else {
                currentScriptIndex++;
                showNextLine();
            }
        };

        const flashData = script.flashin || script.flashout;
        if (flashData) {
            handleFlash(flashData, continueAfterEffect);
        } else {
            continueAfterEffect();
        }
    };

    // --- MODIFIED: displayBubble now returns the created element ---
    const displayBubble = (script) => {
        const actorId = script.actor || script.portrait;
        let speakerName = '', messageClass = '', iconUrl = '';
        let topLevelElement; // This will be the element we return

        if (script.actor === 0) {
            speakerName = 'Commander';
            messageClass = 'player';
        } else if (actorId && shipgirlData[actorId]) {
            const character = shipgirlData[actorId];
            speakerName = character.name || 'Character';
            iconUrl = character.icon;
            messageClass = 'character';
        } else {
            messageClass = 'narrator';
        }

        const messageBubble = document.createElement('div');
        messageBubble.classList.add('message-bubble', messageClass);

        if (speakerName) {
            messageBubble.innerHTML += `<p class="speaker-name">${speakerName}</p>`;
        }

        const dialogueText = script.say.replace(/<size=\d+>|<\/size>/g, '');
        messageBubble.innerHTML += `<p>${dialogueText}</p>`;

        if (messageClass === 'character' && iconUrl) {
            const wrapper = document.createElement('div');
            wrapper.className = 'character-line-wrapper';
            const portrait = document.createElement('img');
            portrait.className = 'portrait';
            portrait.src = iconUrl;
            wrapper.appendChild(portrait);
            wrapper.appendChild(messageBubble);
            storyContainer.appendChild(wrapper);
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'end' });
            topLevelElement = wrapper; // The wrapper is the target for effects
        } else {
            storyContainer.appendChild(messageBubble);
            messageBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
            topLevelElement = messageBubble; // The bubble is the target
        }
        return topLevelElement; // Return the element so we can apply actions to it
    };
    
    // --- New Function to Handle Actions like Shake ---
    const handleAction = (actions, targetElement) => {
        actions.forEach(action => {
            if (action.type === 'shake' && targetElement) {
                targetElement.classList.add('shake-effect');
                // Remove the class after the animation finishes so it can be re-triggered
                setTimeout(() => {
                    targetElement.classList.remove('shake-effect');
                }, 400); // Must match the total duration of the CSS animation
            }
        });
    };
    
    // All other functions remain the same...
    const handleChoice = (chosenFlag, chosenText) => { const choiceBubble = document.createElement('div'); choiceBubble.classList.add('message-bubble', 'player'); choiceBubble.innerHTML = `<p class="speaker-name">Commander</p><p>${chosenText}</p>`; storyContainer.appendChild(choiceBubble); choiceBubble.scrollIntoView({ behavior: 'smooth', block: 'end' }); optionsContainer.innerHTML = ''; currentScriptIndex++; while (currentScriptIndex < allScripts.length && allScripts[currentScriptIndex].optionFlag) { const bubbleElement = displayBubble(allScripts[currentScriptIndex]); if (allScripts[currentScriptIndex].action) handleAction(allScripts[currentScriptIndex].action, bubbleElement); currentScriptIndex++; } setTimeout(showNextLine, 400); };
    const handleFlash = (flashData, onCompleteCallback) => { const { delay = 0, dur, black, alpha } = flashData; const [startAlpha, endAlpha] = alpha; flashOverlay.style.backgroundColor = black ? 'black' : 'white'; flashOverlay.style.transition = 'none'; flashOverlay.style.opacity = startAlpha; setTimeout(() => { flashOverlay.style.transition = `opacity ${dur}s ease-in-out`; flashOverlay.style.opacity = endAlpha; }, delay * 1000); setTimeout(onCompleteCallback, (delay + dur) * 1000); };
    const processEffects = (effects) => { effects.forEach(effect => { if (effect.name === 'juqing_xiayu') vfxOverlay.classList.toggle('rain-effect', effect.active); }); };
    const displayOptions = (options) => { options.forEach(option => { const button = document.createElement('button'); button.classList.add('choice-button'); button.textContent = option.content; button.onclick = () => handleChoice(option.flag, option.content); optionsContainer.appendChild(button); button.scrollIntoView({ behavior: 'smooth', block: 'end' }); }); };
    const processHeader = () => { if (allScripts.length > 0 && allScripts[0].sequence) { const headerRawText = allScripts[0].sequence[0][0]; const [title, subtitle] = headerRawText.split('\n\n'); if (title) storyHeader.innerHTML += `<h1>${title}</h1>`; if (subtitle) { const cleanedSubtitle = subtitle.replace(/<size=\d+>|<\/size>/g, '').replace(/^\d+\s*/, ''); storyHeader.innerHTML += `<h2>${cleanedSubtitle}</h2>`; } } };

    // Fetch all data sources at once before starting
    Promise.all([
        fetch(STORY_URL).then(res => res.json()),
        fetch(SHIPGIRL_DATA_URL).then(res => res.json())
    ]).then(([storyJson, shipgirlJson]) => {
        allScripts = storyJson.renqiaijier.scripts;
        shipgirlData = shipgirlJson;
        initializeStory();
        restartButton.addEventListener('click', initializeStory);
    }).catch(error => {
        console.error('Error loading story data:', error);
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.textContent = 'Failed to load story data. Please try again later.';
            loadingIndicator.classList.add('error');
        }
    });
});
