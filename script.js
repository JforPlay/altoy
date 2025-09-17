// Wait until the HTML document is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // Find the container element where the story will be displayed
    const storyContainer = document.getElementById('story-container');
    
    // This object will store actor IDs and their corresponding names
    const actorIdToNameMap = {}; 

    // Fetch the JSON file containing the story data
    fetch('test.json')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok ' + response.statusText);
            }
            return response.json(); // Parse the JSON data
        })
        .then(data => {
            const scripts = data.renqiaijier.scripts;

            scripts.forEach(script => {
                // We only process scripts that have a 'say' field
                if (!script.say) return;

                const messageBubble = document.createElement('div');
                messageBubble.classList.add('message-bubble');

                let speakerName = '';
                let messageClass = '';
                
                // An actor ID can be in the 'actor' or 'portrait' field
                const actorId = script.actor || script.portrait;

                // If this line has an actorName and an ID, we save it for later
                if (actorId && script.actorName) {
                    actorIdToNameMap[actorId] = script.actorName;
                }

                // Determine the speaker and assign the correct style
                if (script.actor === 0) {
                    speakerName = 'Commander';
                    messageClass = 'player';
                } else if (actorId && actorIdToNameMap[actorId]) {
                    // This is a character whose name we've already saved
                    speakerName = actorIdToNameMap[actorId];
                    messageClass = 'character';
                } else if (script.actorName) {
                    // A character speaking for the first time
                    speakerName = script.actorName;
                    messageClass = 'character';
                } else {
                    // Narrative line
                    messageClass = 'narrator';
                }

                messageBubble.classList.add(messageClass);

                // Add speaker name element if a speaker exists
                if (speakerName) {
                    const speakerElement = document.createElement('p');
                    speakerElement.classList.add('speaker-name');
                    speakerElement.textContent = speakerName;
                    messageBubble.appendChild(speakerElement);
                }
                
                // Add the dialogue text
                const textElement = document.createElement('p');
                textElement.textContent = script.say.replace(/<size=\d+>|<\/size>/g, '');
                messageBubble.appendChild(textElement);
                
                // Add the completed message bubble to the story container
                storyContainer.appendChild(messageBubble);
            });
        })
        .catch(error => {
            console.error('Error loading or parsing story file:', error);
            storyContainer.textContent = 'Failed to load story.';
        });
});
