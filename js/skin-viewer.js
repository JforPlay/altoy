document.addEventListener('DOMContentLoaded', () => {
    // Get HTML elements
    const characterSearchInput = document.getElementById('character-search-input');
    const characterDropdownContent = document.getElementById('character-dropdown-content');
    const skinSearchInput = document.getElementById('skin-search-input');
    const skinDropdownContent = document.getElementById('skin-dropdown-content');
    const skinInfoBox = document.getElementById('skin-info-box');
    const imageGallery = document.getElementById('image-gallery');
    const textContentArea = document.getElementById('text-content-area');
    const oathTableArea = document.getElementById('oath-table-area');

    // Info Pop-up & Clear Button elements
    const infoButton = document.getElementById('info-button');
    const infoPopup = document.getElementById('info-popup');
    const closePopupBtn = infoPopup.querySelector('.close-popup-btn');
    const clearFiltersBtn = document.getElementById('clear-filters-btn');

    // Data storage & state
    let skinData = [];
    let allCharacterNames = [];
    let currentCharacterSkins = [];
    window.currentAudio = null;
    window.currentPlayButton = null;
    window.globalVolume = 0.3; // Add global volume state (30% default)

    // Fuzzy Search Instances
    let characterFuse, skinFuse;
    const fuseOptions = {
        includeScore: true,
        includeMatches: true,
        threshold: 0.4,
        keys: ['name']
    };

    // Custom Sorting Function
    const getCategory = (str) => {
        if (!str) return 4;
        if (/^[가-힣]/.test(str)) return 1; // Korean
        if (/^[a-zA-Z]/.test(str)) return 2; // English
        if (/^[0-9]/.test(str)) return 3; // Numeric
        return 4; // Other
    };

    const customSort = (a, b) => {
        const categoryA = getCategory(a);
        const categoryB = getCategory(b);
        if (categoryA !== categoryB) {
            return categoryA - categoryB;
        }
        return a.localeCompare(b, 'ko');
    };

    // Helper and Dropdown Functions
    const debounce = (func, delay) => { let timeoutId; return (...args) => { clearTimeout(timeoutId); timeoutId = setTimeout(() => { func.apply(this, args); }, delay); }; };
    
    const populateDropdown = (dropdownEl, results, onSelectCallback) => {
        dropdownEl.innerHTML = '';
        if (results.length === 0) {
            dropdownEl.innerHTML = `<div class="no-results">검색 결과가 없습니다</div>`;
            return;
        }

        results.forEach(result => {
            const item = result.item;
            const matches = result.matches;
            const a = document.createElement('a');

            if (matches && matches.length > 0 && matches[0].indices) {
                let highlightedName = '';
                let lastIndex = 0;
                matches[0].indices.forEach(([start, end]) => {
                    highlightedName += item.name.substring(lastIndex, start);
                    highlightedName += `<mark>${item.name.substring(start, end + 1)}</mark>`;
                    lastIndex = end + 1;
                });
                highlightedName += item.name.substring(lastIndex);
                a.innerHTML = highlightedName;
            } else {
                a.textContent = item.name;
            }
            
            a.addEventListener('click', () => { onSelectCallback(item.name); });
            dropdownEl.appendChild(a);
        });
    };

    // Modified function for skin dropdown that always shows all options
    const populateSkinDropdown = (dropdownEl, skinNames, onSelectCallback) => {
        dropdownEl.innerHTML = '';
        if (skinNames.length === 0) {
            dropdownEl.innerHTML = `<div class="no-results">스킨이 없습니다</div>`;
            return;
        }

        skinNames.forEach(skinName => {
            const a = document.createElement('a');
            a.textContent = skinName;
            a.addEventListener('click', () => { onSelectCallback(skinName); });
            dropdownEl.appendChild(a);
        });
    };

    const setupDropdown = (inputEl, dropdownEl, getFuseInstance, onSelectCallback) => {
        const handleFilter = () => {
            const fuse = getFuseInstance();
            if (!fuse) return;

            const searchTerm = inputEl.value;
            if (searchTerm.trim() === '') {
                const allItems = fuse.getIndex().docs.map(doc => ({ item: doc, matches: [] }));
                populateDropdown(dropdownEl, allItems, onSelectCallback);
            } else {
                const results = fuse.search(searchTerm);
                populateDropdown(dropdownEl, results, onSelectCallback);
            }
        };

        inputEl.addEventListener('keyup', debounce(handleFilter, 200));
        inputEl.addEventListener('focus', () => {
            handleFilter();
            dropdownEl.style.display = 'block';
        });
        inputEl.addEventListener('blur', () => { setTimeout(() => { dropdownEl.style.display = 'none'; }, 200); });
    };

    // Special setup for skin dropdown that always shows all options
    const setupSkinDropdown = (inputEl, dropdownEl, onSelectCallback) => {
        const showAllSkins = () => {
            if (currentCharacterSkins.length === 0) {
                dropdownEl.innerHTML = `<div class="no-results">함순이를 먼저 선택해주세요</div>`;
                return;
            }
            populateSkinDropdown(dropdownEl, currentCharacterSkins, onSelectCallback);
        };

        inputEl.addEventListener('focus', () => {
            showAllSkins();
            dropdownEl.style.display = 'block';
        });
        inputEl.addEventListener('blur', () => { setTimeout(() => { dropdownEl.style.display = 'none'; }, 200); });
    };

    // URL State Management Functions
    const updateURLWithFilters = () => { const params = new URLSearchParams(); if (characterSearchInput.value) { params.set('character', characterSearchInput.value); } if (skinSearchInput.value) { params.set('skin', skinSearchInput.value); } const newUrl = `${window.location.pathname}?${params.toString()}`; history.replaceState({ path: newUrl }, '', newUrl); };
    const applyFiltersFromURL = () => { const params = new URLSearchParams(window.location.search); const character = params.get('character'); const skin = params.get('skin'); if (character) { if (allCharacterNames.includes(character)) { handleCharacterSelect(character, false); if (skin) { if (currentCharacterSkins.includes(skin)) { handleSkinSelect(skin); } } } } };

    // Main Data Fetching and Initialization
    fetch('data/skin_voiceline_data.json')
        .then(response => response.json())
        .then(jsonData => {
            if (!jsonData || Object.keys(jsonData).length === 0) throw new Error('JSON data is empty or invalid.');
            skinData = Object.values(jsonData);
            
            allCharacterNames = [...new Set(skinData.map(row => row['함순이 이름']))].filter(name => name).sort(customSort);
            
            const characterDataForFuse = allCharacterNames.map(name => ({ name }));
            characterFuse = new Fuse(characterDataForFuse, fuseOptions);

            setupDropdown(characterSearchInput, characterDropdownContent, () => characterFuse, handleCharacterSelect);
            setupSkinDropdown(skinSearchInput, skinDropdownContent, handleSkinSelect);
            
            applyFiltersFromURL();
            
        }).catch(error => {
            console.error('Error loading or parsing JSON:', error);
            characterSearchInput.placeholder = 'Error: Could not load data.';
        });

    // Event Handlers and Core Logic
    function handleCharacterSelect(characterName, clearSkin = true) {
        characterSearchInput.value = characterName;
        characterDropdownContent.style.display = 'none';
        
        if (clearSkin) {
            skinSearchInput.value = '';
        }
        skinSearchInput.disabled = false;
        skinSearchInput.placeholder = '스킨을 검색/선택해주세요';
        
        currentCharacterSkins = skinData
            .filter(row => row['함순이 이름'] === characterName)
            .map(skin => skin['한글 함순이 + 스킨 이름']);

        // Remove the skinFuse creation since we're not using fuzzy search for skins anymore
            
        if (clearSkin) {
            clearSkinDetails();
        }
        updateURLWithFilters();
    }

    function handleSkinSelect(skinName) {
        skinSearchInput.value = skinName;
        skinDropdownContent.style.display = 'none';
        displaySkinDetails();
        updateURLWithFilters();
    }
    
    const stopCurrentAudio = () => {
        if (window.currentAudio) {
            window.currentAudio.pause();
            window.currentAudio = null;
        }
        if (window.currentPlayButton) {
            window.currentPlayButton.textContent = '▶';
            window.currentPlayButton.classList.remove('playing');
            window.currentPlayButton = null;
        }
    };

    const handlePlayClick = (event) => {
        const button = event.target;
        if (!button.matches('.play-voice-btn')) return;

        const src = button.getAttribute('data-src');
        if (!src) return;

        if (button === window.currentPlayButton) {
            stopCurrentAudio();
        } else {
            stopCurrentAudio();
            window.currentPlayButton = button;
            window.currentAudio = new Audio(src);
            window.currentAudio.volume = window.globalVolume; // Set volume from global state
            window.currentAudio.play().catch(e => console.error("Error playing audio:", e));
            button.textContent = '■';
            button.classList.add('playing');
            window.currentAudio.addEventListener('ended', stopCurrentAudio);
        }
    };

    // Add volume control handler
    const handleVolumeChange = (event) => {
        window.globalVolume = event.target.value / 100;
        
        // Update current playing audio if any
        if (window.currentAudio) {
            window.currentAudio.volume = window.globalVolume;
        }
        
        // Sync all volume controls
        const allVolumeSliders = document.querySelectorAll('.volume-slider');
        const allVolumePercentages = document.querySelectorAll('.volume-percentage');
        
        allVolumeSliders.forEach(slider => {
            if (slider !== event.target) {
                slider.value = Math.round(window.globalVolume * 100);
            }
        });
        
        allVolumePercentages.forEach(percentage => {
            percentage.textContent = `${Math.round(window.globalVolume * 100)}%`;
        });
    };

    // Create volume control HTML
    const createVolumeControl = () => {
        const volumePercentage = Math.round(window.globalVolume * 100);
        return `
            <div class="volume-control-container">
                <i class="fas fa-volume-up volume-icon"></i>
                <input type="range" class="volume-slider" min="0" max="100" value="${volumePercentage}">
                <span class="volume-percentage">${volumePercentage}%</span>
            </div>
        `;
    };

    function clearSkinDetails() {
        skinInfoBox.classList.add('hidden');
        imageGallery.classList.add('hidden');
        textContentArea.classList.add('hidden');
        oathTableArea.classList.add('hidden');
        stopCurrentAudio();
    }

    const displaySkinDetails = () => {
        const selectedSkinName = skinSearchInput.value;
        if (!selectedSkinName) {
            clearSkinDetails();
            return;
        }
        const skin = skinData.find(row => row['한글 함순이 + 스킨 이름'] === selectedSkinName);
        if (!skin) return;

        skinInfoBox.innerHTML = '';
        let infoHtml = '';
        const gemIconHtml = `<img src="assets/icon/60px-Ruby.png" class="gem-icon" alt="Gem">`;
        if (skin['재화']) infoHtml += `<div class="info-item">${gemIconHtml}<span class="info-value">${skin['재화']}</span></div>`;
        if (skin['기간']) infoHtml += `<div class="info-item"><strong class="info-label">상시여부:</strong><span class="info-value">${skin['기간']}</span></div>`;
        if (skin['스킨 타입 - 한글']) infoHtml += `<div class="info-item"><strong class="info-label">스킨타입:</strong><span class="info-value">${skin['스킨 타입 - 한글']}</span></div>`;
        if (skin['스킨 태그']) infoHtml += `<div class="info-item"><strong class="info-label">스킨태그:</strong><span class="info-value">${skin['스킨 태그']}</span></div>`;
        skinInfoBox.innerHTML = infoHtml;
        infoHtml ? skinInfoBox.classList.remove('hidden') : skinInfoBox.classList.add('hidden');
        imageGallery.innerHTML = '';
        let galleryHtml = '';
        if (skin['전체 일러']) galleryHtml += `<img class="gallery-top-banner" src="${skin['전체 일러']}">`;
        let bottomPanelHtml = '';
        let bottomLeftHtml = '<div class="bottom-left-panel">';
        if (skin['확대 일러']) {
            bottomLeftHtml += `<img src="${skin['확대 일러']}">`;
        } else {
            bottomLeftHtml += `<div class="dummy-image-box">이 스킨은 확대 일러가 없어요 지휘관님</div>`;
        }
        bottomLeftHtml += '</div>';
        let bottomRightHtml = '<div class="bottom-right-panel">';
        const tallSources = [skin['깔끔한 일러'], skin['sd 일러']].filter(Boolean);
        if (tallSources.length > 0) {
            bottomRightHtml += '<div class="thumbnail-group tall-group">';
            tallSources.forEach(src => { bottomRightHtml += `<img src="${src}" class="tall-thumbnail">`; });
            bottomRightHtml += '</div>';
        }
        const smallSources = [skin['아이콘 일러'], skin['쥬스타 아이콘 일러']].filter(Boolean);
        if (smallSources.length > 0) {
            bottomRightHtml += '<div class="thumbnail-group small-group">';
            smallSources.forEach(src => { bottomRightHtml += `<img src="${src}">`; });
            bottomRightHtml += '</div>';
        }
        bottomRightHtml += '</div>';
        if (skin['확대 일러'] || tallSources.length > 0 || smallSources.length > 0) {
            bottomPanelHtml = `<div class="gallery-bottom-panel">${bottomLeftHtml}${bottomRightHtml}</div>`;
        }
        imageGallery.innerHTML = galleryHtml + bottomPanelHtml;
        (galleryHtml + bottomPanelHtml) ? imageGallery.classList.remove('hidden') : imageGallery.classList.add('hidden');
        textContentArea.innerHTML = '';
        oathTableArea.innerHTML = '';
        let textContentHtml = '';
        let descriptionsHtml = '';
        if (skin['설명'] || (skin['드랍 설명'] && skin['드랍 설명'].voiceline)) {
            descriptionsHtml += `<div class="description-group">`;
            if(skin['설명']) descriptionsHtml += `<div class="description-item"><h2>설명</h2><p>${skin['설명']}</p></div>`;
            if(skin['드랍 설명'] && skin['드랍 설명'].voiceline) descriptionsHtml += `<div class="description-item"><h2>드랍 설명</h2><p>${skin['드랍 설명'].voiceline}</p></div>`;
            descriptionsHtml += `</div>`;
        }
        if (skin['자기소개'] && skin['자기소개'].voiceline) {
            const intro = skin['자기소개'];
            const playButton = intro.voicelink ? `<button class="play-voice-btn" data-src="${intro.voicelink}">▶</button>` : '';
            descriptionsHtml += `<div class="description-item self-intro"><h2>자기소개</h2><p>${intro.voiceline}${playButton}</p></div>`;
        }
        if (descriptionsHtml) textContentHtml += `<div class="descriptions-panel">${descriptionsHtml}</div>`;
        const nonVoiceKeys = new Set(['함순이 이름', '한글 함순이 + 스킨 이름', '영문 함순이 + 스킨 이름', '스킨 타입', '전체 일러', '확대 일러', 'sd 일러', '아이콘 일러', '쥬스타 아이콘 일러', '깔끔한 일러', '설명', '자기소개', '클뜯 id', '클뜯 함순이 id', '드랍 설명', '스킨 타입 - 한글', '상점 id', '상점 카테고리 id', '스킨 태그', '입수 영상', '재화', '기간', '진영', '레어도', 'ex_chat_status']);
        let normalTableBodyHtml = '';
        let oathTableBodyHtml = '';
        if (skin['함대 특수대사'] && Array.isArray(skin['함대 특수대사'])) {
            skin['함대 특수대사'].forEach(line => {
                if (line && line.voiceline) {
                    const playButton = line.voicelink ? `<button class="play-voice-btn" data-src="${line.voicelink}">▶</button>` : `<button class="play-voice-btn" disabled>▶</button>`;
                    normalTableBodyHtml += `<tr><td>함대 특수대사</td><td><div>${line.voiceline}${playButton}</div></td></tr>`;
                }
            });
        }
        const priorityOrder = ["입수시", "상세확인", "실망", "낯섦", "호감", "기쁨", "사랑", "서약"];
        const lastItem = "hp 경고";
        const normalVoiceKeys = [];
        const oathVoiceKeys = [];
        for (const key of Object.keys(skin)) {
            const value = skin[key];
            if (!value || nonVoiceKeys.has(key) || key === '함대 특수대사' || typeof value !== 'object' || !value.hasOwnProperty('voiceline')) continue;
            if (key.endsWith('_ex')) oathVoiceKeys.push(key);
            else normalVoiceKeys.push(key);
        }
        oathVoiceKeys.sort();
        const priorityKeysInOrder = priorityOrder.filter(key => normalVoiceKeys.includes(key));
        const restKeysSorted = normalVoiceKeys
            .filter(key => !priorityOrder.includes(key) && key !== lastItem)
            .sort();
        let finalNormalKeys = [...priorityKeysInOrder, ...restKeysSorted];
        if (normalVoiceKeys.includes(lastItem)) {
            finalNormalKeys.push(lastItem);
        }
        const createRow = (key, displayName) => {
            const value = skin[key];
            const playButton = value.voicelink ? `<button class="play-voice-btn" data-src="${value.voicelink}">▶</button>` : `<button class="play-voice-btn" disabled>▶</button>`;
            return `<tr><td>${displayName}</td><td><div>${value.voiceline}${playButton}</div></td></tr>`;
        };
        finalNormalKeys.forEach(key => normalTableBodyHtml += createRow(key, key));
        oathVoiceKeys.forEach(key => oathTableBodyHtml += createRow(key, key.replace('_ex', ' EX')));
        
        if (normalTableBodyHtml) {
            const tableHeaderHtml = `
                <div class="table-header-with-volume">
                    <span>선택한 함순이의 대사 모음</span>
                    ${createVolumeControl()}
                </div>
            `;
            textContentHtml += `<table class="voice-line-table"><thead><tr><th colspan="2">${tableHeaderHtml}</th></tr></thead><tbody>${normalTableBodyHtml}</tbody></table>`;
        }
        
        textContentArea.innerHTML = textContentHtml;
        
        if (oathTableBodyHtml && skin['ex_chat_status'] === 1) {
            const oathTableHeaderHtml = `
                <div class="table-header-with-volume">
                    <span>선택한 함순이의 서약대사 모음</span>
                    ${createVolumeControl()}
                </div>
            `;
            const fullOathTableHtml = `<table class="voice-line-table"><thead><tr><th colspan="2">${oathTableHeaderHtml}</th></tr></thead><tbody>${oathTableBodyHtml}</tbody></table>`;
            oathTableArea.innerHTML = fullOathTableHtml;
            oathTableArea.classList.remove('hidden');
        } else {
            oathTableArea.classList.add('hidden');
        }
        
        textContentHtml ? textContentArea.classList.remove('hidden') : textContentArea.classList.add('hidden');
        
        // Add event listeners for both play buttons and volume controls
        textContentArea.addEventListener('click', handlePlayClick);
        oathTableArea.addEventListener('click', handlePlayClick);
        
        // Add volume control event listeners
        const volumeSliders = document.querySelectorAll('.volume-slider');
        volumeSliders.forEach(slider => {
            slider.addEventListener('input', handleVolumeChange);
        });
    };

    window.addEventListener('popstate', applyFiltersFromURL);

    // --- NEW: Event Listeners for Pop-up and Clear Button ---

    // Pop-up functionality
    infoButton.addEventListener('click', () => {
        infoPopup.classList.add('visible');
        document.body.classList.add('no-scroll');
    });

    const closeInfoPopup = () => {
        infoPopup.classList.remove('visible');
        document.body.classList.remove('no-scroll');
    };

    closePopupBtn.addEventListener('click', closeInfoPopup);
    infoPopup.addEventListener('click', (event) => {
        if (event.target === infoPopup) {
            closeInfoPopup();
        }
    });

    // Clear filters functionality
    clearFiltersBtn.addEventListener('click', () => {
        characterSearchInput.value = '';
        skinSearchInput.value = '';
        skinSearchInput.placeholder = '함순이를 먼저 선택해주세요...';
        skinSearchInput.disabled = true;
        clearSkinDetails();
        updateURLWithFilters();
    });
});