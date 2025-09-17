document.addEventListener('DOMContentLoaded', () => {
    // --- MODIFIED: URLs now point to the story and the new consolidated data file ---
    const STORY_URL = 'test.json';
    const SHIPGIRL_DATA_URL = 'shipgirl_data.json';

    // --- Get HTML elements ---
    const storyContainer = document.getElementById('story-container');
    const optionsContainer = document.getElementById('options-container');
    const storyHeader = document.getElementById('story-header');
    const restartButton = document.getElementById('restart-button');
    const vfxOverlay = document.getElementById('vfx-overlay');
    const flashOverlay = document.getElementById('flash-overlay');

    // --- Story state and data maps ---
    let allScripts = [];
    let currentScriptIndex = 0;
    let shipgirlData = {}; // This will now hold all character name/icon data

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
                displayBubble(script, () => displayOptions(script.options));
            } else if (script.say) {
                displayBubble(script, () => {
                    currentScriptIndex++;
                    setTimeout(showNextLine, 400);
                });
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

    // --- MODIFIED: displayBubble now uses the new single `shipgirlData` object ---
    const displayBubble = (script, onCompleteCallback) => {
        const actorId = script.actor || script.portrait;
        let speakerName = '';
        let messageClass = '';
        let iconUrl = '';

        // Determine speaker type
        if (script.actor === 0) {
            speakerName = 'Commander';
            messageClass = 'player';
        } else if (actorId && shipgirlData[actorId]) {
            // It's a character, look up their info in the new data object
            const character = shipgirlData[actorId];
            speakerName = character.name || 'Character'; // Use the name from the file
            iconUrl = character.icon; // Use the icon from the file
            messageClass = 'character';
        } else {
            messageClass = 'narrator';
        }

        const messageBubble = document.createElement('div');
        messageBubble.classList.add('message-bubble', messageClass);

        if (speakerName) {
            messageBubble.innerHTML += `<p class="speaker-name">${speakerName}</p>`;
        }

        const dialogueP = document.createElement('p');
        messageBubble.appendChild(dialogueP);

        const dialogueText = script.say.replace(/<size=\d+>|<\/size>/g, '');
        
        // Append elements to the DOM
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
        } else {
            storyContainer.appendChild(messageBubble);
            messageBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
        
        typeText(dialogueP, dialogueText, onCompleteCallback);
    };
    
    // All other functions remain the same...
    const typeText = (element, text, callback) => { let i = 0; element.textContent = ""; const typeWriter = () => { if (i < text.length) { element.textContent += text.charAt(i); i++; setTimeout(typeWriter, 30); } else if (callback) { callback(); } }; typeWriter(); };
    const handleChoice = (chosenFlag, chosenText) => { const choiceBubble = document.createElement('div'); choiceBubble.classList.add('message-bubble', 'player'); choiceBubble.innerHTML = `<p class="speaker-name">Commander</p><p>${chosenText}</p>`; storyContainer.appendChild(choiceBubble); choiceBubble.scrollIntoView({ behavior: 'smooth', block: 'end' }); optionsContainer.innerHTML = ''; currentScriptIndex++; while (currentScriptIndex < allScripts.length && allScripts[currentScriptIndex].optionFlag) { if (allScripts[currentScriptIndex].optionFlag === chosenFlag) displayBubble(allScripts[currentScriptIndex]); currentScriptIndex++; } setTimeout(showNextLine, 400); };
    const handleFlash = (flashData, onCompleteCallback) => { const { delay = 0, dur, black, alpha } = flashData; const [startAlpha, endAlpha] = alpha; flashOverlay.style.backgroundColor = black ? 'black' : 'white'; flashOverlay.style.transition = 'none'; flashOverlay.style.opacity = startAlpha; setTimeout(() => { flashOverlay.style.transition = `opacity ${dur}s ease-in-out`; flashOverlay.style.opacity = endAlpha; }, delay * 1000); setTimeout(onCompleteCallback, (delay + dur) * 1000); };
    const processEffects = (effects) => { effects.forEach(effect => { if (effect.name === 'juqing_xiayu') vfxOverlay.classList.toggle('rain-effect', effect.active); }); };
    const displayOptions = (options) => { options.forEach(option => { const button = document.createElement('button'); button.classList.add('choice-button'); button.textContent = option.content; button.onclick = () => handleChoice(option.flag, option.content); optionsContainer.appendChild(button); button.scrollIntoView({ behavior: 'smooth', block: 'end' }); }); };
    const processHeader = () => { if (allScripts.length > 0 && allScripts[0].sequence) { const headerRawText = allScripts[0].sequence[0][0]; const [title, subtitle] = headerRawText.split('\n\n'); if (title) storyHeader.innerHTML += `<h1>${title}</h1>`; if (subtitle) { const cleanedSubtitle = subtitle.replace(/<size=\d+>|<\/size>/g, '').replace(/^\d+\s*/, ''); storyHeader.innerHTML += `<h2>${cleanedSubtitle}</h2>`; } } };

    // --- MODIFIED: Fetch logic now only loads two files ---
    Promise.all([
        fetch(STORY_URL).then(res => res.json()),
        fetch(SHIPGIRL_DATA_URL).then(res => res.json())
    ]).then(([storyJson, shipgirlJson]) => {
        allScripts = storyJson.renqiaijier.scripts;
        shipgirlData = shipgirlJson; // Store the new combined data

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
