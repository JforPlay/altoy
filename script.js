document.addEventListener('DOMContentLoaded', () => {
    const storyContainer = document.getElementById('story-container');
    const storyHeader = document.getElementById('story-header'); // Get the new header element
    const actorIdToNameMap = {};

    fetch('test.json')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok ' + response.statusText);
            }
            return response.json();
        })
        .then(data => {
            const scripts = data.renqiaijier.scripts;

            // --- New Header Logic ---
            // Process the header from the very first script entry
            if (scripts.length > 0 && scripts[0].sequence) {
                const headerRawText = scripts[0].sequence[0][0];
                const [title, subtitle] = headerRawText.split('\n\n'); // Split into title and subtitle

                if (title) {
                    const titleElement = document.createElement('h1');
                    titleElement.textContent = title;
                    storyHeader.appendChild(titleElement);
                }
                if (subtitle) {
                    // Clean up the subtitle by removing size tags and the leading number
                    const cleanedSubtitle = subtitle.replace(/<size=\d+>|<\/size>/g, '').replace(/^\d+\s*/, '');
                    const subtitleElement = document.createElement('h2');
                    subtitleElement.textContent = cleanedSubtitle;
                    storyHeader.appendChild(subtitleElement);
                }
            }
            
            // --- Updated Dialogue Loop ---
            // Loop through the rest of the scripts, skipping the first (header) entry
            scripts.slice(1).forEach(script => {
                if (!script.say) return;

                const messageBubble = document.createElement('div');
                messageBubble.classList.add('message-bubble');

                let speakerName = '';
                let messageClass = '';
                
                const actorId = script.actor || script.portrait;

                if (actorId && script.actorName) {
                    actorIdToNameMap[actorId] = script.actorName;
                }

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
            });
        })
        .catch(error => {
            console.error('Error loading or parsing story file:', error);
            storyContainer.textContent = 'Failed to load story.';
        });
});
