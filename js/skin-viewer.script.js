document.addEventListener('DOMContentLoaded', () => {
    // Get HTML elements
    const characterSearch = document.getElementById('character-search');
    const characterSelect = document.getElementById('character-select');
    const skinSelect = document.getElementById('skin-select');
    const skinInfoBox = document.getElementById('skin-info-box');
    const imageGallery = document.getElementById('image-gallery');
    const textContentArea = document.getElementById('text-content-area');
    const voiceLineTableArea = document.getElementById('voice-line-table-area'); // New element

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
        textContentArea.classList.add('hidden');
        voiceLineTableArea.classList.add('hidden'); // Hide table area
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
    
    // --- MODIFIED: This function now builds the new table ---
    const displaySkinDetails = () => {
        const selectedSkinName = skinSelect.value;
        if (!selectedSkinName) {
            imageGallery.classList.add('hidden');
            skinInfoBox.classList.add('hidden');
            textContentArea.classList.add('hidden');
            voiceLineTableArea.classList.add('hidden');
            return;
        }
        const skin = skinData.find(row => row['한글 함순이 + 스킨 이름'] === selectedSkinName);
        if (!skin) return;

        // Build Info Box (unchanged)
        skinInfoBox.innerHTML = '';
        let infoHtml = '';
        const gemIconHtml = `<img src="assets/60px-Ruby.png" class="gem-icon" alt="Gem">`;
        if (skin['재화'] && skin['재화'] !== 'null') { infoHtml += `<div class="info-item">${gemIconHtml}<span class="info-value">${skin['재화']}</span></div>`; }
        if (skin['기간'] && skin['기간'] !== 'null') { infoHtml += `<div class="info-item"><strong class="info-label">상시여부:</strong><span class="info-value">${skin['기간']}</span></div>`; }
        if (skin['스킨 타입 - 한글'] && skin['스킨 타입 - 한글'] !== 'null') { infoHtml += `<div class="info-item"><strong class="info-label">스킨타입:</strong><span class="info-value">${skin['스킨 타입 - 한글']}</span></div>`; }
        if (skin['스킨 태그'] && skin['스킨 태그'] !== 'null') { infoHtml += `<div class="info-item"><strong class="info-label">스킨태그:</strong><span class="info-value">${skin['스킨 태그']}</span></div>`; }
        skinInfoBox.innerHTML = infoHtml;
        if (infoHtml) skinInfoBox.classList.remove('hidden');

        // Build Image Gallery (unchanged)
        imageGallery.innerHTML = '';
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

        // Build Text Content Area (unchanged)
        textContentArea.innerHTML = '';
        let textContentHtml = '';
        let descriptionsHtml = '';
        let leftGroupHtml = '';
        if (skin['설명']) { leftGroupHtml += `<div class="description-item"><h2>설명</h2><p>${skin['설명']}</p></div>`; }
        if (skin['드랍 설명']) { leftGroupHtml += `<div class="description-item"><h2>드랍 설명</h2><p>${skin['드랍 설명']}</p></div>`; }
        if (leftGroupHtml) { descriptionsHtml += `<div class="description-group">${leftGroupHtml}</div>`; }
        if (skin['자기소개']) { descriptionsHtml += `<div class="description-item"><h2>자기소개</h2><p>${skin['자기소개']}</p></div>`; }
        if (descriptionsHtml) { textContentHtml += `<div class="descriptions-panel">${descriptionsHtml}</div>`; }
        if (skin['함대 특수대사'] && skin['함대 특수대사'] !== 'null') { const formattedText = skin['함대 특수대사'].replace(/\\n/g, '<br>'); textContentHtml += `<div class="special-dialogue-panel"><h2>해당 함순이의 유대 특수대사</h2><p>${formattedText}</p></div>`; }
        textContentArea.innerHTML = textContentHtml;
        if (textContentHtml) textContentArea.classList.remove('hidden');

        // --- Build Voice Line Table ---
        voiceLineTableArea.innerHTML = '';
        const tableFields = ["전투개시", "상세확인", "의뢰 완료", "실망", "낯섦", "호감", "기쁨", "사랑", "터치3", "모항귀환", "hp 경고", "로그인", "실패", "우편", "메인1~5", "임무", "임무완료", "서약", "스킬", "터치1", "터치2", "입수시", "강화성공", "vote", "승리"];
        let tableBodyHtml = '';
        tableFields.forEach(field => {
            if (skin[field]) { // Only create a row if the field has a value
                let value = skin[field];
                // Handle line breaks for specific fields
                if (field === "메인1~5" || field === "함대 특수대사") {
                    value = value.replace(/\\n/g, '\n');
                }
                tableBodyHtml += `<tr><td>${field}</td><td>${value}</td></tr>`;
            }
        });

        if (tableBodyHtml) {
            const fullTableHtml = `<table class="voice-line-table">
                <thead><tr><th colspan="2">선택한 함순이의 대사 모음</th></tr></thead>
                <tbody>${tableBodyHtml}</tbody>
            </table>`;
            voiceLineTableArea.innerHTML = fullTableHtml;
            voiceLineTableArea.classList.remove('hidden');
        }
    };

    characterSearch.addEventListener('input', debounce(filterCharacters, 250));
    characterSelect.addEventListener('change', updateSkinSelect);
    skinSelect.addEventListener('change', displaySkinDetails);
});