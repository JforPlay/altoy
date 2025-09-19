document.addEventListener("DOMContentLoaded", () => {
    // --- Get HTML Elements ---
    const characterSelector = document.getElementById("character-selector");
    const chatInterface = document.getElementById("chat-interface");
    const chatGroupSelect = document.getElementById("chat-group-select");
    const flavorTextBox = document.getElementById("flavor-text-box");
    const chatDisplay = document.getElementById("chat-display");

    let processedData = [];
    let activeCharacter = null;

    // --- Placeholder images - REPLACE with your actual image paths ---
    const characterPortraits = {
        10117: 'https://azurlane.netojuu.com/images/1/13/Z23.png', // Z23
        10209: 'https://azurlane.netojuu.com/images/a/a3/Laffey.png', // Laffey
        10703: 'https://azurlane.netojuu.com/images/5/52/Javelin.png', // Javelin
        30105: 'https://azurlane.netojuu.com/images/a/a2/Ayanami.png', // Ayanami
    };

    // --- Data Fetching and Processing ---
    const fetchData = async () => {
        try {
            const [charRes, groupRes, langRes] = await Promise.all([
                fetch('data/dorm3d_characters.json'),
                fetch('data/dorm3d_chat_groups.json'),
                fetch('data/dorm3d_chat_language.json')
            ]);

            const characters = await charRes.json();
            const chatGroups = await groupRes.json();
            const chatLanguage = await langRes.json();
            
            // Create a quick-lookup map for language content
            const langMap = new Map(Object.entries(chatLanguage).map(([id, data]) => [parseInt(id, 10), data.content]));

            // Process and merge all data into a clean structure
            processedData = Object.values(characters).map(char => {
                const charId = char.id;
                const shipGroup = char.ship_group;

                const associatedChats = Object.values(chatGroups)
                    .filter(group => group.ship_group === shipGroup)
                    .map(group => ({
                        id: group.id,
                        unlock_desc: group.unlock_desc,
                        messages: group.content.map(msgId => ({
                            id: msgId,
                            content: langMap.get(msgId) || '...'
                        }))
                    }));

                return {
                    id: charId,
                    ship_group: shipGroup,
                    name: char.name,
                    chats: associatedChats,
                    portrait: characterPortraits[shipGroup] || ''
                };
            });
            
            initialize();
        } catch (error) {
            console.error("Failed to load or process chat data:", error);
            characterSelector.innerHTML = '<p>채팅 데이터를 불러오는데 실패했습니다.</p>';
        }
    };

    // --- UI Initialization ---
    const initialize = () => {
        characterSelector.innerHTML = '';
        processedData.forEach(char => {
            const portraitDiv = document.createElement('div');
            portraitDiv.className = 'character-portrait';
            portraitDiv.style.backgroundImage = `url(${char.portrait})`;
            portraitDiv.dataset.shipGroup = char.ship_group;
            portraitDiv.title = char.name;
            
            portraitDiv.addEventListener('click', () => selectCharacter(char.ship_group));
            characterSelector.appendChild(portraitDiv);
        });
        
        chatGroupSelect.addEventListener('change', displaySelectedChat);
    };

    const selectCharacter = (shipGroup) => {
        activeCharacter = processedData.find(c => c.ship_group === shipGroup);
        if (!activeCharacter) return;
        
        // Update active portrait
        document.querySelectorAll('.character-portrait').forEach(el => {
            el.classList.toggle('active', el.dataset.shipGroup == shipGroup);
        });

        chatInterface.classList.remove('hidden');
        
        // Populate dropdown
        chatGroupSelect.innerHTML = '';
        activeCharacter.chats.forEach(chatGroup => {
            const option = document.createElement('option');
            option.value = chatGroup.id;
            option.textContent = chatGroup.unlock_desc;
            chatGroupSelect.appendChild(option);
        });
        
        // Trigger the first chat to display
        displaySelectedChat();
    };

    const displaySelectedChat = () => {
        const selectedChatId = parseInt(chatGroupSelect.value, 10);
        const selectedChat = activeCharacter.chats.find(c => c.id === selectedChatId);
        
        if (!selectedChat) return;
        
        flavorTextBox.textContent = selectedChat.unlock_desc;
        typeOutMessages(selectedChat.messages);
    };

    // --- Typewriter Effect ---
    const typeOutMessages = async (messages) => {
        chatDisplay.innerHTML = ''; // Clear previous chat
        
        for (const message of messages) {
            await typeMessage(message);
            await new Promise(resolve => setTimeout(resolve, 800)); // Pause between messages
        }
    };

    const typeMessage = (message) => {
        return new Promise(resolve => {
            const bubble = document.createElement('div');
            bubble.className = 'chat-bubble';
            bubble.innerHTML = `
                <div class="portrait" style="background-image: url(${activeCharacter.portrait})"></div>
                <div class="message-content">
                    <div class="speaker-name">${activeCharacter.name}</div>
                    <div class="message-text"></div>
                </div>
            `;
            chatDisplay.appendChild(bubble);
            chatDisplay.parentElement.scrollTop = chatDisplay.parentElement.scrollHeight;

            const textEl = bubble.querySelector('.message-text');
            let charIndex = 0;
            const typingSpeed = 30; // Milliseconds per character

            const typeChar = () => {
                if (charIndex < message.content.length) {
                    textEl.textContent += message.content[charIndex];
                    charIndex++;
                    setTimeout(typeChar, typingSpeed);
                } else {
                    resolve();
                }
            };
            typeChar();
        });
    };

    // --- Start the application ---
    fetchData();
});