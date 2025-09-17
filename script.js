document.addEventListener('DOMContentLoaded', () => {
    // Get HTML elements
    const storyContainer = document.getElementById('story-container');
    const optionsContainer = document.getElementById('options-container');
    const storyHeader = document.getElementById('story-header');
    const restartButton = document.getElementById('restart-button');

    // Story state variables
    let allScripts = [];
    let currentScriptIndex = 0;
    let actorIdToNameMap = {};

    // --- New: Main Function to Initialize or Restart the Story ---
    const initializeStory = () => {
        // 1. Clear all dynamic content
        storyHeader.innerHTML = '';
        storyContainer.innerHTML = '';
        optionsContainer.innerHTML = '';
        
        // 2. Reset state variables
        currentScriptIndex = 0;
        actorIdToNameMap = {};

        // 3. Re-build the story from the beginning
        processHeader();
        currentScriptIndex = 1; 
        showNextLine();
    };

    const showNextLine = () => {
        if (currentScriptIndex >= allScripts.length) return;
        const script = allScripts[currentScriptIndex];

        if (script.options) {
            displayBubble(script);
            displayOptions(script.options);
        } else if (script.say) {
            displayBubble(script);
            currentScriptIndex++;
            setTimeout(showNextLine, 400);
        } else {
            currentScriptIndex++;
            showNextLine();
        }
    };
    
    const handleChoice = (chosenFlag, chosenText) => {
        const choiceBubble = document.createElement('div');
        choiceBubble.classList.add('message-bubble', 'player');
        choiceBubble.innerHTML = `<p class="speaker-name">Commander</p><p>${chosenText}</p>`;
        storyContainer.appendChild(choiceBubble);
        choiceBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });

        optionsContainer.innerHTML = '';
        currentScriptIndex++;

        while (currentScriptIndex < allScripts.length && allScripts[currentScriptIndex].optionFlag) {
            if (allScripts[currentScriptIndex].optionFlag === chosenFlag) {
                displayBubble(allScripts[currentScriptIndex]);
            }
            currentScriptIndex++;
        }
        
        setTimeout(showNextLine, 400);
    };

    const displayBubble = (script) => {
        const messageBubble = document.createElement('div');
        messageBubble.classList.add('message-bubble');
        
        let speakerName = '';
        let messageClass = '';
        const actorId = script.actor || script.portrait;

        if (actorId && script.actorName) actorIdToNameMap[actorId] = script.actorName;

        if (script.actor === 0) {
            speakerName = 'Commander';
            messageClass = 'player';
        } else if (actorId && actorIdToNameMap[actorId]) {
            speakerName = actorIdToNameMap[actorId];
            messageClass = 'character';
        } else if (script.actorName) {
            speakerName = script.actorName;
            messageClass = 'character';
        } else {
            messageClass = 'narrator';
        }

        messageBubble.classList.add(messageClass);

        if (speakerName) {
            messageBubble.innerHTML += `<p class="speaker-name">${speakerName}</p>`;
        }
        
        const dialogueText = script.say.replace(/<size=\d+>|<\/size>/g, '');
        messageBubble.innerHTML += `<p>${dialogueText}</p>`;
        storyContainer.appendChild(messageBubble);
        messageBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
    };

    const displayOptions = (options) => {
        options.forEach(option => {
            const button = document.createElement('button');
            button.classList.add('choice-button');
            button.textContent = option.content;
            button.onclick = () => handleChoice(option.flag, option.content);
            optionsContainer.appendChild(button);
            button.scrollIntoView({ behavior: 'smooth', block: 'end' });
        });
    };

    const processHeader = () => {
        if (allScripts.length > 0 && allScripts[0].sequence) {
            const headerRawText = allScripts[0].sequence[0][0];
            const [title, subtitle] = headerRawText.split('\n\n');
            if (title) storyHeader.innerHTML += `<h1>${title}</h1>`;
            if (subtitle) {
                const cleanedSubtitle = subtitle.replace(/<size=\d+>|<\/size>/g, '').replace(/^\d+\s*/, '');
                storyHeader.innerHTML += `<h2>${cleanedSubtitle}</h2>`;
            }
        }
    };

    // --- Fetch Data and Attach Event Listeners ---
    fetch('test.json')
        .then(response => response.json())
        .then(data => {
            allScripts = data.renqiaijier.scripts; // Store script data globally
            initializeStory(); // Run the story for the first time
            restartButton.addEventListener('click', initializeStory); // Attach restart logic
        })
        .catch(error => {
            console.error('Error loading or parsing story file:', error);
            storyContainer.textContent = 'Failed to load story.';
        });
});
