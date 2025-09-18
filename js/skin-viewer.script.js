document.addEventListener('DOMContentLoaded', () => {
    // Get HTML elements
    const characterSearch = document.getElementById('character-search');
    const characterSelect = document.getElementById('character-select');
    const skinSelect = document.getElementById('skin-select');
    const skinInfoBox = document.getElementById('skin-info-box');
    const imageGallery = document.getElementById('image-gallery');
    const textContentArea = document.getElementById('text-content-area'); // New element

    let skinData = [];
    let allCharacterData = [];

    const debounce = (func, delay) => { let timeoutId; return (...args) => { clearTimeout(timeoutId); timeoutId = setTimeout(() => { func.apply(this, args); }, delay); }; };

    fetch('data/subset_skin_data.json')
        .then(response => response.json())
        .then(jsonData => {
            if (!jsonData || Object.keys(jsonData).length === 0) throw new Error('JSON data is empty or invalid.');
            skinData = Object.values(jsonData);
            populateCharacterSelect();
            if (characterSelect.options.length > 1) {
                characterSelect.value = "앵커리지";
                updateSkinSelect();
                skinSelect.value = "앵커리지";
                displaySkinDetails();
            }
        }).catch(error => {
            console.error('Error loading or parsing JSON:', error);
            characterSelect.innerHTML = '<option>Error: Could not load data.</option>';
        });

    const populateCharacterSelect = () => {
        const characterNames = [...new Set(skinData.map(row => row['함순이 이름']))].filter(name => name);
        allCharacterData = [];
        characterNames.sort().forEach(name => allCharacterData.push({ value: name, text: name }));
        filterCharacters();
    };

    const filterCharacters = () => {
        const searchTerm = characterSearch.value.toLowerCase();
        const currentSelection = characterSelect.value;
        characterSelect.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = ""; placeholder.textContent = "-- Select a Character --";
        characterSelect.appendChild(placeholder);
        let isCurrentSelectionInList = false;
        allCharacterData.forEach(data => {
            if (data.text.toLowerCase().includes(searchTerm)) {
                const option = document.createElement('option');
                option.value = data.value; option.textContent = data.text;
                characterSelect.appendChild(option);
                if (data.value === currentSelection) isCurrentSelectionInList = true;
            }
        });
        if (isCurrentSelectionInList) characterSelect.value = currentSelection;
    };

    const updateSkinSelect = () => {
        if (characterSelect.value) characterSearch.value = characterSelect.value;
        const selectedCharacter = characterSelect.value;
        skinSelect.innerHTML = '<option value="">-- Select a Skin --</option>';
        imageGallery.classList.add('hidden');
        skinInfoBox.classList.add('hidden');
        textContentArea.classList.add('hidden'); // Hide text area
        if (!selectedCharacter) {
            skinSelect.disabled = true;
            return;
        }
        const characterSkins = skinData.filter(row => row['함순이 이름'] === selectedCharacter);
        characterSkins.forEach(skin => {
            const option = document.createElement('option');
            const skinName = skin['한글 함순이 + 스킨 이름'];
            option.value = skinName; option.textContent = skinName;
            skinSelect.appendChild(option);
        });
        skinSelect.disabled = false;
    };
    
    // --- MODIFIED: This function now builds all content sections ---
    const displaySkinDetails = () => {
        const selectedSkinName = skinSelect.value;
        if (!selectedSkinName) {
            imageGallery.classList.add('hidden');
            skinInfoBox.classList.add('hidden');
            textContentArea.classList.add('hidden');
            return;
        }
        const skin = skinData.find(row => row['한글 함순이 + 스킨 이름'] === selectedSkinName);
        if (!skin) return;

        // --- Build Info Box ---
        skinInfoBox.innerHTML = '';
        let infoHtml = '';
        const gemIconHtml = `<img src="assets/60px-Ruby.png" class="gem-icon" alt="Gem">`;
        if (skin['재화'] && skin['재화'] !== 'null') { infoHtml += `<div class="info-item">${gemIconHtml}<span class="info-value">${skin['재화']}</span></div>`; }
        if (skin['기간'] && skin['기간'] !== 'null') { infoHtml += `<div class="info-item"><strong class="info-label">상시여부:</strong><span class="info-value">${skin['기간']}</span></div>`; }
        if (skin['스킨 타입 - 한글'] && skin['스킨 타입 - 한글'] !== 'null') { infoHtml += `<div class="info-item"><strong class="info-label">스킨타입:</strong><span class="info-value">${skin['스킨 타입 - 한글']}</span></div>`; }
        if (skin['스킨 태그'] && skin['스킨 태그'] !== 'null') { infoHtml += `<div class="info-item"><strong class="info-label">스킨태그:</strong><span class="info-value">${skin['스킨 태그']}</span></div>`; }
        skinInfoBox.innerHTML = infoHtml;
        if (infoHtml) skinInfoBox.classList.remove('hidden');

        // --- Build Image Gallery ---
        imageGallery.innerHTML = '';
        // ... (image gallery logic is unchanged) ...
        const topBannerSrc = skin['전체 일러'];
        if (topBannerSrc && topBannerSrc !== 'null') { const topBannerImg = document.createElement('img'); topBannerImg.className = 'gallery-top-banner'; topBannerImg.src = topBannerSrc; imageGallery.appendChild(topBannerImg); }
        const bottomPanel = document.createElement('div'); bottomPanel.className = 'gallery-bottom-panel';
        const bottomLeftPanel = document.createElement('div'); bottomLeftPanel.className = 'bottom-left-panel';
        const secondaryLargeSrc = skin['확대 일러'];
        if (secondaryLargeSrc && secondaryLargeSrc !== 'null') { const secondaryImg = document.createElement('img'); secondaryImg.src = secondaryLargeSrc; bottomLeftPanel.appendChild(secondaryImg); } else { const dummyBox = document.createElement('div'); dummyBox.className = 'dummy-image-box'; dummyBox.textContent = '이 스킨은 확대 일러가 없어요 지휘관님'; bottomLeftPanel.appendChild(dummyBox); }
        bottomPanel.appendChild(bottomLeftPanel);
        const bottomRightPanel = document.createElement('div'); bottomRightPanel.className = 'bottom-right-panel';
        const tallGroup = document.createElement('div'); tallGroup.className = 'thumbnail-group tall-group';
        const tallSources = [skin['깔끔한 일러'], skin['sd 일러']].filter(src => src && src !== 'null');
        tallSources.forEach(src => { const img = document.createElement('img'); img.src = src; img.className = 'tall-thumbnail'; tallGroup.appendChild(img); });
        if(tallGroup.children.length > 0) bottomRightPanel.appendChild(tallGroup);
        const smallGroup = document.createElement('div'); smallGroup.className = 'thumbnail-group small-group';
        const smallSources = [skin['아이콘 일러'], skin['쥬스타 아이콘 일러']].filter(src => src && src !== 'null');
        smallSources.forEach(src => { const img = document.createElement('img'); img.src = src; smallGroup.appendChild(img); });
        if(smallGroup.children.length > 0) bottomRightPanel.appendChild(smallGroup);
        bottomPanel.appendChild(bottomRightPanel);
        imageGallery.appendChild(bottomPanel);
        imageGallery.classList.remove('hidden');

        // --- Build Text Content Area (Descriptions & Chats) ---
        textContentArea.innerHTML = '';
        let textContentHtml = '';

        // Descriptions
        let descriptionsHtml = '';
        if (skin['설명']) {
            descriptionsHtml += `<div class="description-item"><h2>설명</h2><p>${skin['설명']}</p></div>`;
        }
        if (skin['자기소개']) {
            descriptionsHtml += `<div class="description-item"><h2>자기소개</h2><p>${skin['자기소개']}</p></div>`;
        }
        if (descriptionsHtml) {
            textContentHtml += `<div class="descriptions-panel">${descriptionsHtml}</div>`;
        }

        // Voice Lines
        const chatLinesLeft = [];
        const chatLinesRight = [];
        const descriptionKeys = ['설명', '자기소개', '획득 대사', '모항 대사', '터치 대사', '터치 대사2', '임무 대사', '임무 완료 대사', '위탁 완료 대사', '강화 성공 대사', '결혼 대사'];

        Object.keys(skin).forEach(key => {
            if (skin[key] && key.endsWith('대사') && !descriptionKeys.includes(key)) {
                const bubble = `<div class="chat-bubble">${skin[key]}</div>`;
                if (key.includes('_ex')) {
                    chatLinesRight.push(bubble);
                } else {
                    chatLinesLeft.push(bubble);
                }
            }
        });

        if (chatLinesLeft.length > 0 || chatLinesRight.length > 0) {
            textContentHtml += `<h2>대사</h2><div class="chat-container">
                <div class="chat-column">${chatLinesLeft.join('')}</div>
                <div class="chat-column">${chatLinesRight.join('')}</div>
            </div>`;
        }

        textContentArea.innerHTML = textContentHtml;
        if (textContentHtml) textContentArea.classList.remove('hidden');
    };

    characterSearch.addEventListener('input', debounce(filterCharacters, 250));
    characterSelect.addEventListener('change', updateSkinSelect);
    skinSelect.addEventListener('change', displaySkinDetails);
});