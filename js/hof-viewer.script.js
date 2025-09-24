document.addEventListener('DOMContentLoaded', () => {
    // --- Constants ---
    const STORY_DATA_URL = 'data/hof_kr.json';
    const SHIPGIRL_DATA_URL = 'data/shipgirl_data.json';
    const BASE_URL = "https://raw.githubusercontent.com/JforPlay/data_for_toy/main/";
    const BGM_URL_PREFIX = "https://github.com/Fernando2603/AzurLane/raw/refs/heads/main/audio/bgm/";

    // --- DOM Elements ---
    const galleryView = document.getElementById('gallery-view');
    const storyView = document.getElementById('story-view');
    const galleryContainer = document.getElementById('gallery-container');
    const storyContainer = document.getElementById('story-container');
    const optionsContainer = document.getElementById('options-container');
    const storyCharacterTitle = document.getElementById('story-character-title');
    const backToGalleryBtn = document.getElementById('back-to-gallery-btn');
    const themeToggles = document.querySelectorAll('.theme-toggle');
    const storyBackground = document.getElementById('story-background');
    const audioPlayerContainer = document.getElementById('audio-player-container');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const muteBtn = document.getElementById('mute-btn');
    const volumeSlider = document.getElementById('volume-slider');
    const audio = new Audio();

    // --- State & Data ---
    let storyData = {};
    let shipgirlData = {};
    let currentScripts = [];
    let currentScriptIndex = 0;
    let currentBgm = null;

    // --- Core Functions ---
    async function init() {
        try {
            // NEW: Ensure background is clear on initial load
            storyBackground.style.backgroundImage = 'none';
            storyBackground.style.backgroundColor = 'transparent';

            audio.loop = true;
            audio.volume = 0.01;

            const [stories, shipgirls] = await Promise.all([
                fetch(STORY_DATA_URL).then(res => res.json()),
                fetch(SHIPGIRL_DATA_URL).then(res => res.json())
            ]);
            storyData = stories;
            shipgirlData = shipgirls;
            populateGallery();
            setupEventListeners();
            applyTheme(localStorage.getItem('theme') || 'light');
        } catch (error) {
            console.error("Failed to load initial data:", error);
            galleryContainer.innerHTML = `<p>스토리 데이터를 불러오는 데 실패했습니다.</p>`;
        }
    }

    function switchView(viewToShow) {
        galleryView.classList.toggle('hidden', viewToShow !== galleryView);
        storyView.classList.toggle('hidden', viewToShow !== storyView);
        if (viewToShow === galleryView) {
            storyBackground.style.backgroundImage = 'none';
            storyBackground.style.backgroundColor = 'transparent';
            handleBgm(null);
        }
    }

    // --- Audio Logic ---
    function updateAudioPlayerUI() {
        if (!playPauseBtn || !muteBtn || !volumeSlider) return;
        playPauseBtn.querySelector('.material-icons').textContent = audio.paused ? 'play_arrow' : 'pause';
        muteBtn.querySelector('.material-icons').textContent = audio.muted || audio.volume === 0 ? 'volume_off' : 'volume_up';
        volumeSlider.value = audio.muted ? 0 : audio.volume;
    }

    function handleBgm(bgmName) {
        if (bgmName && bgmName !== currentBgm) {
            currentBgm = bgmName;
            audio.src = `${BGM_URL_PREFIX}${bgmName}.ogg`;
            audio.play().catch(e => console.warn("Audio playback failed.", e));
            audioPlayerContainer?.classList.remove('hidden');
        } else if (!bgmName && currentBgm) {
            currentBgm = null;
            audio.pause();
            audioPlayerContainer?.classList.add('hidden');
        }
        updateAudioPlayerUI();
    }

    // --- Theme Management ---
    function applyTheme(theme) {
        document.body.classList.toggle('dark-mode', theme === 'dark');
        themeToggles.forEach(toggle => {
            toggle.querySelector('.theme-icon-sun')?.classList.toggle('hidden', theme === 'dark');
            toggle.querySelector('.theme-icon-moon')?.classList.toggle('hidden', theme !== 'dark');
        });
        localStorage.setItem('theme', theme);
    }

    // --- Gallery Logic ---
    function populateGallery() {
        galleryContainer.innerHTML = '';
        const groups = {
            "2019 Hall of Fame": ["에기르", "체셔", "뉴저지"],
            "2021 Hall of Fame": ["벨파스트", "모나크", "엔터프라이즈"]
        };

        for (const groupTitle in groups) {
            const groupWrapper = document.createElement('div');
            groupWrapper.className = 'gallery-group';

            const titleElement = document.createElement('h2');
            titleElement.className = 'gallery-group-title';
            titleElement.textContent = groupTitle;
            groupWrapper.appendChild(titleElement);

            const grid = document.createElement('div');
            grid.className = 'character-grid-container';

            groups[groupTitle].forEach(characterName => {
                if (storyData[characterName]) {
                    const data = storyData[characterName];
                    const card = document.createElement('div');
                    card.className = 'character-card';
                    card.innerHTML = `
                        <img src="${data.icon}" alt="${data.kr_name}">
                        <p>${data.kr_name}</p>
                    `;
                    card.addEventListener('click', () => selectStory(characterName));
                    grid.appendChild(card);
                }
            });
            
            groupWrapper.appendChild(grid);
            galleryContainer.appendChild(groupWrapper);
        }
    }

    // --- Story Logic ---
    function selectStory(key) {
        currentScripts = storyData[key].scripts;
        storyCharacterTitle.textContent = storyData[key].kr_name;
        switchView(storyView);
        startStory();
    }

    function startStory() {
        storyContainer.innerHTML = '';
        optionsContainer.innerHTML = '';
        currentScriptIndex = 0;

        const firstLine = currentScripts[0];
        if (firstLine && firstLine.sequence && firstLine.sequence[0]) {
            const rawTitle = firstLine.sequence[0][0];
            const [mainTitle, rawSubTitle] = rawTitle.replace(/<.*?>/g, '').split('\n\n');
            
            const subTitle = rawSubTitle ? rawSubTitle.replace(/^\d+\s*/, '') : '';
            
            const titleCard = document.createElement('div');
            titleCard.className = 'story-title-display';
            titleCard.innerHTML = `
                <h1>${mainTitle || ''}</h1>
                <h2>${subTitle}</h2>
            `;
            storyContainer.appendChild(titleCard);
        }

        showNextLine();
    }

    function showNextLine() {
        if (currentScriptIndex >= currentScripts.length) {
            displayBubble({ say: "스토리 끝" });
            handleBgm(null);
            return;
        }
        updateBackground();
        const line = currentScripts[currentScriptIndex];
        
        if (line.stopbgm) { handleBgm(null); }
        else if (line.bgm) { handleBgm(line.bgm); }

        if (line.say) {
            displayBubble(line);
        }
        if (line.options) {
            displayOptions(line.options);
        } else {
            currentScriptIndex++;
            if (line.say) {
                setTimeout(showNextLine, 300);
            } else {
                showNextLine();
            }
        }
    }

    function handleChoice(chosenFlag, chosenText) {
        displayBubble({ actor: 0, say: chosenText });
        optionsContainer.innerHTML = '';
        currentScriptIndex++;

        let nextIndex = currentScripts.findIndex((line, index) => index >= currentScriptIndex && line.optionFlag === chosenFlag);
        
        if (nextIndex !== -1) {
            currentScriptIndex = nextIndex;
        } else {
            while (currentScriptIndex < currentScripts.length && currentScripts[currentScriptIndex].optionFlag) {
                currentScriptIndex++;
            }
        }
        
        setTimeout(showNextLine, 300);
    }

    function displayBubble(line) {
        const bubble = document.createElement('div');
        bubble.classList.add('message-bubble');
    
        const actorId = line.actor || line.portrait;
    
        if (line.actor === 0) {
            bubble.classList.add('player');
            bubble.innerHTML = `<p class="speaker-name">지휘관</p><p class="dialogue-text">${line.say}</p>`;
        } else if (actorId && shipgirlData[actorId]) {
            bubble.classList.add('character');
            const character = shipgirlData[actorId];
            const speakerName = line.actorName || character.name;
            bubble.innerHTML = `
                <div class="bubble-header">
                    <img class="portrait-internal" src="${character.icon}" alt="${speakerName}">
                    <p class="speaker-name">${speakerName}</p>
                </div>
                <p class="dialogue-text">${line.say.replace(/<.*?>/g, '')}</p>
            `;
        } else if (line.actorName) {
            bubble.classList.add('character');
            bubble.innerHTML = `
                <div class="bubble-header">
                    <p class="speaker-name">${line.actorName}</p>
                </div>
                <p class="dialogue-text">${line.say.replace(/<.*?>/g, '')}</p>
            `;
        } else {
            bubble.classList.add('narrator');
            bubble.innerHTML = `<p>${line.say.replace(/<.*?>/g, '')}</p>`;
        }
    
        storyContainer.appendChild(bubble);
        bubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    function displayOptions(options) {
        optionsContainer.innerHTML = '';
        options.forEach(opt => {
            const button = document.createElement('button');
            button.className = 'choice-button';
            button.textContent = opt.content;
            button.onclick = () => handleChoice(opt.flag, opt.content);
            optionsContainer.appendChild(button);
        });
        optionsContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    function updateBackground() {
        let backgroundImageUrl = null;
        let isBlackBackground = false;

        for (let i = currentScriptIndex; i >= 0; i--) {
            const line = currentScripts[i];
            if (line) {
                if (line.blackBg === true) {
                    isBlackBackground = true;
                    break;
                }
                if (line.bgName) {
                    backgroundImageUrl = `url('${BASE_URL}bg/${line.bgName}.png')`;
                    break;
                }
            }
        }

        if (isBlackBackground) {
            storyBackground.style.backgroundColor = 'black';
            storyBackground.style.backgroundImage = 'none';
        } else {
            storyBackground.style.backgroundColor = 'transparent';
            storyBackground.style.backgroundImage = backgroundImageUrl || 'none';
        }
    }

    function setupEventListeners() {
        backToGalleryBtn.addEventListener('click', () => switchView(galleryView));
        themeToggles.forEach(toggle => {
            toggle.addEventListener('click', () => {
                const newTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
                applyTheme(newTheme);
            });
        });
        playPauseBtn.addEventListener('click', () => audio.paused ? audio.play() : audio.pause());
        muteBtn.addEventListener('click', () => { audio.muted = !audio.muted; updateAudioPlayerUI(); });
        volumeSlider.addEventListener('input', (e) => { audio.volume = e.target.value; audio.muted = e.target.value == 0; updateAudioPlayerUI(); });
        audio.addEventListener('play', updateAudioPlayerUI);
        audio.addEventListener('pause', updateAudioPlayerUI);
    }

    // --- Initial Load ---
    init();
});