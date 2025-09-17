document.addEventListener('DOMContentLoaded', () => {
    const storyContainer = document.getElementById('story-container');
    const optionsContainer = document.getElementById('options-container');
    const storyHeader = document.getElementById('story-header');

    let allScripts = [];
    let currentScriptIndex = 0;
    const actorIdToNameMap = {};

    const startStory = (data) => {
        allScripts = data.renqiaijier.scripts;
        processHeader();
        currentScriptIndex = 1;
        showNextLine();
    };

    const showNextLine = () => {
        if (currentScriptIndex >= allScripts.length) {
            return;
        }

        const script = allScripts[currentScriptIndex];

        if (script.options) {
            displayBubble(script);
            displayOptions(script.options);
        } else if (script.say) {
            displayBubble(script);
            currentScriptIndex++;
            // MODIFICATION: Changed delay from 800ms to 400ms for faster pacing
            setTimeout(showNextLine, 400);
        } else {
            currentScriptIndex++;
            showNextLine();
        }
    };
    
    // MODIFICATION: Function now accepts 'chosenText' to display the choice
    const handleChoice = (chosenFlag, chosenText) => {
        // --- New Feature: Display the selected option ---
        const choiceBubble = document.createElement('div');
        choiceBubble.classList.add('message-bubble', 'player');
        choiceBubble.innerHTML = `<p class="speaker-name">Commander</p><p>${chosenText}</p>`;
        storyContainer.appendChild(choiceBubble);
        // --- End of New Feature ---

        // Auto-scroll to the choice you made
        choiceBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });

        optionsContainer.innerHTML = '';
        currentScriptIndex++;

        while (currentScriptIndex < allScripts.length && allScripts[currentScriptIndex].optionFlag) {
            if (allScripts[currentScriptIndex].optionFlag === chosenFlag) {
                displayBubble(allScripts[currentScriptIndex]);
            }
            currentScriptIndex++;
        }
        
        // MODIFICATION: Changed delay from 800ms to 400ms
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

        // Auto-scroll to the new message
        messageBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
    };

    const displayOptions = (options) => {
        options.forEach(option => {
            const button = document.createElement('button');
            button.classList.add('choice-button');
            button.textContent = option.content;
            // MODIFICATION: Pass the option's text content to handleChoice
            button.onclick = () => handleChoice(option.flag, option.content);
            optionsContainer.appendChild(button);
            // Auto-scroll to show the options
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

    fetch('test.json')
        .then(response => response.json())
        .then(startStory)
        .catch(error => {
            console.error('Error loading or parsing story file:', error);
            storyContainer.textContent = 'Failed to load story.';
        });
});
