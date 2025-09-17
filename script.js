// Wait until the HTML document is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // Find the container element where the story will be displayed
    const storyContainer = document.getElementById('story-container');

    // Fetch the JSON file containing the story data
    fetch('test.json')
        .then(response => {
            // Check if the file was fetched successfully
            if (!response.ok) {
                throw new Error('Network response was not ok ' + response.statusText);
            }
            return response.json(); // Parse the JSON data
        })
        .then(data => {
            // Access the array of scripts from the JSON data
            const scripts = data.renqiaijier.scripts;

            // Loop through each script entry in the array
            scripts.forEach(script => {
                // We only process scripts that have a 'say' field
                if (script.say) {
                    const messageBubble = document.createElement('div');
                    messageBubble.classList.add('message-bubble');

                    let speakerName = '';
                    let messageClass = '';

                    // Determine the speaker and assign the correct style
                    if (script.actorName && script.actorName !== '？？？') {
                        speakerName = script.actorName;
                        messageClass = 'character';
                    } else if (script.actor === 0) {
                        speakerName = 'Commander'; // This is you!
                        messageClass = 'player';
                    } else {
                        // This is for narrative lines without a specific speaker
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
                    // The script uses '<size=45>...</size>' which is not standard HTML. We'll strip it out.
                    textElement.textContent = script.say.replace(/<size=\d+>|<\/size>/g, '');
                    messageBubble.appendChild(textElement);
                    
                    // Add the completed message bubble to the story container
                    storyContainer.appendChild(messageBubble);
                }
            });
        })
        .catch(error => {
            // Log any errors to the console
            console.error('Error loading or parsing story file:', error);
            storyContainer.textContent = 'Failed to load story.';
        });
});
