document.addEventListener('DOMContentLoaded', () => {

    // --- CONSTANTS & CONFIG ---
    const DATA_URL = 'processed_dorm3d_data.json';

    // --- STATE MANAGEMENT ---
    let dormData = {};
    let groupedData = {};
    let currentScripts = [];
    let currentScriptIndex = 0;
    let currentFlag = 0;
    let currentCharacterInfo = {};
    let activeCharacterName = null;

    // --- DOM ELEMENTS ---
    const characterListEl = document.getElementById('character-list');
    const chatContentEl = document.getElementById('chat-content');
    const optionsContainerEl = document.getElementById('options-container');
    const chatTitleEl = document.getElementById('chat-title');
    const chatUnlockEl = document.getElementById('chat-unlock');
    const topicSelectorContainerEl = document.getElementById('topic-selector-container');

    // --- INITIALIZATION ---
    async function init() {
        try {
            const response = await fetch(DATA_URL);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            dormData = await response.json();
            processAndGroupData();
            populateCharacterList();
        } catch (error) {
            console.error("Failed to load and initialize chat data:", error);
            chatContentEl.innerHTML = `<div class="flex justify-center items-center h-full"><p class="text-red-400 text-center">채팅 데이터를 불러오는 데 실패했습니다. 콘솔을 확인하고 'processed_dorm3d_data.json' 파일에 접근 가능한지 확인해주세요.</p></div>`;
        }
    }

    // --- DATA PROCESSING ---
    function processAndGroupData() {
        // This function processes a flat JSON object where each key is a chat ID.
        for (const chatId in dormData) {
            const chat = dormData[chatId];
            const charName = chat.kr_name;
            if (!groupedData[charName]) {
                groupedData[charName] = {
                    icon: chat.icon,
                    chats: []
                };
            }
            groupedData[charName].chats.push({
                id: chat.id,
                name: chat.name
            });
        }
    }

    // --- UI POPULATION & RENDERING ---
    function populateCharacterList() {
        characterListEl.innerHTML = '';
        const fragment = document.createDocumentFragment();
        const sortedCharNames = Object.keys(groupedData).sort((a, b) => a.localeCompare(b));
        
        for (const charName of sortedCharNames) {
            const charData = groupedData[charName];
            const button = document.createElement('button');
            button.className = 'w-full flex items-center p-2 space-x-3 rounded-md hover:bg-[#40444b] transition-colors duration-200 focus:outline-none';
            button.dataset.charName = charName;
            button.innerHTML = `
                <img src="${charData.icon}" alt="${charName}" class="w-10 h-10 rounded-full flex-shrink-0 object-cover" onerror="this.onerror=null;this.src='https://placehold.co/40x40/2f3136/dcddde?text=?';">
                <span class="font-medium text-white truncate">${charName}</span>
            `;
            button.addEventListener('click', handleCharacterSelect);
            fragment.appendChild(button);
        }
        characterListEl.appendChild(fragment);
    }

    function populateTopicSelector(charName) {
        const charData = groupedData[charName];
        if (!charData || charData.chats.length === 0) {
            topicSelectorContainerEl.innerHTML = '';
            return;
        }

        const select = document.createElement('select');
        select.className = 'bg-[#2f3136] border border-black/20 text-white text-sm rounded-md focus:ring-indigo-500 focus:border-indigo-500 block w-full p-2';
        select.addEventListener('change', handleTopicChange);

        charData.chats.forEach(chat => {
            const option = document.createElement('option');
            option.value = chat.id;
            option.textContent = chat.name;
            select.appendChild(option);
        });

        topicSelectorContainerEl.innerHTML = '';
        topicSelectorContainerEl.appendChild(select);
        displayChat(charData.chats[0].id);
    }

    function displayChat(chatId) {
        activeChatId = chatId;
        const chatData = dormData[chatId];
        if (!chatData) return;

        currentScripts = chatData.scripts;
        currentCharacterInfo = { name: chatData.kr_name, icon: chatData.icon };
        currentScriptIndex = 0;
        currentFlag = 0;

        chatContentEl.innerHTML = '';
        optionsContainerEl.innerHTML = '';
        chatTitleEl.textContent = chatData.name;
        chatUnlockEl.textContent = chatData.unlock_desc;

        renderChat();
    }
    
    function renderChat() {
        optionsContainerEl.innerHTML = '';
        while (currentScriptIndex < currentScripts.length) {
            const script = currentScripts[currentScriptIndex];

            if (script.flag === currentFlag) {
                if (script.type === 1 && script.param) {
                    createBubble(script);
                }
                if (script.option && Array.isArray(script.option) && script.option.length > 0) {
                    displayOptions(script.option);
                    currentScriptIndex++;
                    return; 
                }
            }
            currentScriptIndex++;
        }
    }

    function createBubble(script) {
        const isPlayer = script.ship_group === 0;

        const wrapper = document.createElement('div');
        const bubble = document.createElement('div');
        const nameEl = document.createElement('p');
        const textEl = document.createElement('p');

        wrapper.className = `flex items-start gap-3 message-bubble ${isPlayer ? 'justify-end' : 'justify-start'}`;
        bubble.className = `p-3 rounded-lg max-w-xs md:max-w-md ${isPlayer ? 'bg-[#7289da] text-white' : 'bg-[#40444b]'}`;
        nameEl.className = 'font-bold mb-1';
        textEl.className = 'break-words';

        nameEl.textContent = isPlayer ? '지휘관' : currentCharacterInfo.name;
        textEl.textContent = script.param;

        bubble.appendChild(nameEl);
        bubble.appendChild(textEl);

        if (isPlayer) {
            wrapper.appendChild(bubble);
        } else {
            const icon = document.createElement('img');
            icon.src = currentCharacterInfo.icon;
            icon.alt = currentCharacterInfo.name;
            icon.className = 'w-10 h-10 rounded-full flex-shrink-0 object-cover';
            icon.onerror = () => { icon.src = 'https://placehold.co/40x40/2f3136/dcddde?text=?'; };
            wrapper.appendChild(icon);
            wrapper.appendChild(bubble);
        }

        chatContentEl.appendChild(wrapper);
        chatContentEl.scrollTop = chatContentEl.scrollHeight;
    }

    function displayOptions(options) {
        optionsContainerEl.innerHTML = '';
        const fragment = document.createDocumentFragment();
        options.forEach(optionData => {
            const [flag, text] = optionData;
            const button = document.createElement('button');
            button.className = 'bg-[#5865f2] hover:bg-[#4752c4] text-white font-bold py-2 px-4 rounded-lg transition-colors duration-200 self-end max-w-xs md:max-w-md text-right';
            button.textContent = text;
            button.onclick = () => handleChoice(flag, text);
            fragment.appendChild(button);
        });
        optionsContainerEl.appendChild(fragment);
    }

    // --- EVENT HANDLERS & ACTIONS ---
    function handleCharacterSelect(event) {
        const button = event.currentTarget;
        const charName = button.dataset.charName;

        if (activeCharacterName === charName) return;
        activeCharacterName = charName;

        document.querySelectorAll('#character-list button').forEach(btn => {
            btn.classList.remove('bg-[#4f545c]', 'font-semibold');
        });
        button.classList.add('bg-[#4f545c]', 'font-semibold');

        populateTopicSelector(charName);
    }
    
    function handleTopicChange(event) {
        displayChat(event.target.value);
    }
    
    function handleChoice(flag, text) {
        createBubble({ ship_group: 0, param: text });
        optionsContainerEl.innerHTML = '';
        currentFlag = flag;
        renderChat();
    }

    // --- START THE APP ---
    init();
});