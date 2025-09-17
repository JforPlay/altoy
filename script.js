document.addEventListener('DOMContentLoaded', () => {
    // Get HTML elements
    const storyContainer = document.getElementById('story-container');
    const optionsContainer = document.getElementById('options-container');
    const storyHeader = document.getElementById('story-header');

    // Story state variables
    let allScripts = [];
    let currentScriptIndex = 0;
    const actorIdToNameMap = {};

    // --- Main Function to Start the Story ---
    const startStory = (data) => {
        allScripts = data.renqiaijier.scripts;
        processHeader();
        currentScriptIndex = 1; // Start from the script after the header
        showNextLine();
    };

    // --- Process the Story Step-by-Step ---
    const showNextLine = () => {
        // Check if the story is over
        if (currentScriptIndex >= allScripts.length) {
            console.log("End of story.");
            return;
        }

        const script = allScripts[currentScriptIndex];

        if (script.options) {
            // If the script has choices, display them and wait for user input
            displayBubble(script);
            displayOptions(script.options);
        } else if (script.say) {
            // If it's a regular dialogue line, display it
            displayBubble(script);
            currentScriptIndex++;
            // Show the next line after a short delay
            setTimeout(showNextLine, 800);
        } else {
            // Skip non-dialogue entries and continue
            currentScriptIndex++;
            showNextLine();
        }
    };
    
    // --- Handle User's Choice ---
    const handleChoice = (chosenFlag) => {
        // Remove the choice buttons from the screen
        optionsContainer.innerHTML = '';
        currentScriptIndex++; // Move index past the options block

        // Find and show all script lines that match the chosen flag
        while (currentScriptIndex < allScripts.length && allScripts[currentScriptIndex].optionFlag) {
            if (allScripts[currentScriptIndex].optionFlag === chosenFlag) {
                displayBubble(allScripts[currentScriptIndex]);
            }
            currentScriptIndex++;
        }
        
        // Continue the main story flow
        setTimeout(showNextLine, 800);
    };

    // --- Helper Functions ---
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
            const speakerElement = document.createElement('p');
            speakerElement.classList.add('speaker-name');
            speakerElement.textContent = speakerName;
            messageBubble.appendChild(speakerElement);
        }
        
        const textElement = document.createElement('p');
        textElement.textContent = script.say.replace(/<size=\d+>|<\/size>/g, '');
        messageBubble.appendChild(textElement);
        
        storyContainer.appendChild(messageBubble);
    };

    const displayOptions = (options) => {
        options.forEach(option => {
            const button = document.createElement('button');
            button.classList.add('choice-button');
            button.textContent = option.content;
            button.onclick = () => handleChoice(option.flag);
            optionsContainer.appendChild(button);
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

    // --- Fetch Data and Start ---
    fetch('test.json')
        .then(response => response.json())
        .then(startStory)
        .catch(error => {
            console.error('Error loading or parsing story file:', error);
            storyContainer.textContent = 'Failed to load story.';
        });
});
