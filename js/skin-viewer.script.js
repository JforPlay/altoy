document.addEventListener('DOMContentLoaded', () => {
    // Get HTML elements for both dropdowns
    const characterSearchInput = document.getElementById('character-search-input');
    const characterDropdownContent = document.getElementById('character-dropdown-content');
    const skinSearchInput = document.getElementById('skin-search-input');
    const skinDropdownContent = document.getElementById('skin-dropdown-content');
    
    // Other page elements
    const skinInfoBox = document.getElementById('skin-info-box');
    const imageGallery = document.getElementById('image-gallery');
    const textContentArea = document.getElementById('text-content-area');
    const oathTableArea = document.getElementById('oath-table-area');

    // Data storage
    let skinData = [];
    let allCharacterNames = [];
    let currentCharacterSkins = [];

    // --- Data Fetching and Initialization ---
    fetch('data/subset_skin_data.json')
        .then(response => response.json())
        .then(jsonData => {
            if (!jsonData || Object.keys(jsonData).length === 0) throw new Error('JSON data is empty or invalid.');
            skinData = Object.values(jsonData);
            allCharacterNames = [...new Set(skinData.map(row => row['함순이 이름']))].filter(name => name).sort();
            
            // Populate the character dropdown initially
            populateDropdown(characterDropdownContent, allCharacterNames, handleCharacterSelect);
            
            // Set an initial state for demonstration
            characterSearchInput.value = "앵커리지";
            handleCharacterSelect("앵커리지"); // Manually trigger select
            skinSearchInput.value = "앵커리지";
            displaySkinDetails();
            
        }).catch(error => {
            console.error('Error loading or parsing JSON:', error);
            characterSearchInput.placeholder = 'Error: Could not load data.';
        });

    // --- Reusable Dropdown Functions ---

    /**
     * Populates a dropdown content div with clickable anchor tags.
     * @param {HTMLElement} dropdownEl - The div to populate.
     * @param {string[]} items - An array of strings to display.
     * @param {function} onSelectCallback - The function to call when an item is clicked.
     */
    const populateDropdown = (dropdownEl, items, onSelectCallback) => {
        dropdownEl.innerHTML = '';
        if (items.length === 0) {
            dropdownEl.innerHTML = `<div class="no-results">No matches found</div>`;
            return;
        }
        items.forEach(item => {
            const a = document.createElement('a');
            a.textContent = item;
            a.addEventListener('click', () => {
                onSelectCallback(item);
            });
            dropdownEl.appendChild(a);
        });
    };
    
    /**
     * Sets up the interactive behavior for a searchable dropdown.
     * @param {HTMLInputElement} inputEl - The search input field.
     * @param {HTMLElement} dropdownEl - The dropdown content div.
     * @param {string[]} sourceArray - The original array of items to filter from.
     * @param {function} onSelectCallback - The function to call when an item is selected.
     */
    const setupDropdown = (inputEl, dropdownEl, sourceArray, onSelectCallback) => {
        inputEl.addEventListener('keyup', () => {
            const searchTerm = inputEl.value.toLowerCase();
            const filteredItems = sourceArray.filter(item => item.toLowerCase().includes(searchTerm));
            populateDropdown(dropdownEl, filteredItems, onSelectCallback);
        });

        inputEl.addEventListener('focus', () => {
            // Repopulate with all items on focus before filtering
            populateDropdown(dropdownEl, sourceArray, onSelectCallback);
            dropdownEl.style.display = 'block';
        });

        inputEl.addEventListener('blur', () => {
            setTimeout(() => { dropdownEl.style.display = 'none'; }, 200); // Delay to allow click
        });
    };

    // --- Event Handlers and Core Logic ---

    /**
     * Handles the selection of a character.
     * @param {string} characterName - The name of the selected character.
     */
    function handleCharacterSelect(characterName) {
        characterSearchInput.value = characterName;
        characterDropdownContent.style.display = 'none';
        
        // Reset and populate the skin dropdown
        skinSearchInput.value = '';
        skinSearchInput.disabled = false;
        skinSearchInput.placeholder = 'Search for a skin...';
        
        currentCharacterSkins = skinData
            .filter(row => row['함순이 이름'] === characterName)
            .map(skin => skin['한글 함순이 + 스킨 이름']);
            
        populateDropdown(skinDropdownContent, currentCharacterSkins, handleSkinSelect);
        
        // Hide details until a skin is selected
        clearSkinDetails();
    }

    /**
     * Handles the selection of a skin.
     * @param {string} skinName - The name of the selected skin.
     */
    function handleSkinSelect(skinName) {
        skinSearchInput.value = skinName;
        skinDropdownContent.style.display = 'none';
        displaySkinDetails();
    }

    function clearSkinDetails() {
        skinInfoBox.classList.add('hidden');
        imageGallery.classList.add('hidden');
        textContentArea.classList.add('hidden');
        oathTableArea.classList.add('hidden');
    }

    // This function is mostly unchanged, but now gets its value from the input field
    const displaySkinDetails = () => {
        const selectedSkinName = skinSearchInput.value; // CHANGED
        if (!selectedSkinName) {
            clearSkinDetails();
            return;
        }
        const skin = skinData.find(row => row['한글 함순이 + 스킨 이름'] === selectedSkinName);
        if (!skin) return;

        // Build Info Box & Image Gallery (This part is correct and unchanged)
        skinInfoBox.innerHTML = ''; let infoHtml = ''; const gemIconHtml = `<img src="assets/60px-Ruby.png" class="gem-icon" alt="Gem">`; if (skin['재화'] && skin['재화'] !== 'null') { infoHtml += `<div class="info-item">${gemIconHtml}<span class="info-value">${skin['재화']}</span></div>`; } if (skin['기간'] && skin['기간'] !== 'null') { infoHtml += `<div class="info-item"><strong class="info-label">상시여부:</strong><span class="info-value">${skin['기간']}</span></div>`; } if (skin['스킨 타입 - 한글'] && skin['스킨 타입 - 한글'] !== 'null') { infoHtml += `<div class="info-item"><strong class="info-label">스킨타입:</strong><span class="info-value">${skin['스킨 타입 - 한글']}</span></div>`; } if (skin['스킨 태그'] && skin['스킨 태그'] !== 'null') { infoHtml += `<div class="info-item"><strong class="info-label">스킨태그:</strong><span class="info-value">${skin['스킨 태그']}</span></div>`; } skinInfoBox.innerHTML = infoHtml; if (infoHtml) skinInfoBox.classList.remove('hidden');
        imageGallery.innerHTML = ''; const topBannerSrc = skin['전체 일러']; if (topBannerSrc && topBannerSrc !== 'null') { const topBannerImg = document.createElement('img'); topBannerImg.className = 'gallery-top-banner'; topBannerImg.src = topBannerSrc; imageGallery.appendChild(topBannerImg); } const bottomPanel = document.createElement('div'); bottomPanel.className = 'gallery-bottom-panel'; const bottomLeftPanel = document.createElement('div'); bottomLeftPanel.className = 'bottom-left-panel'; const secondaryLargeSrc = skin['확대 일러']; if (secondaryLargeSrc && secondaryLargeSrc !== 'null') { const secondaryImg = document.createElement('img'); secondaryImg.src = secondaryLargeSrc; bottomLeftPanel.appendChild(secondaryImg); } else { const dummyBox = document.createElement('div'); dummyBox.className = 'dummy-image-box'; dummyBox.textContent = '이 스킨은 확대 일러가 없어요 지휘관님'; bottomLeftPanel.appendChild(dummyBox); } bottomPanel.appendChild(bottomLeftPanel); const bottomRightPanel = document.createElement('div'); bottomRightPanel.className = 'bottom-right-panel'; const tallGroup = document.createElement('div'); tallGroup.className = 'thumbnail-group tall-group'; const tallSources = [skin['깔끔한 일러'], skin['sd 일러']].filter(src => src && src !== 'null'); tallSources.forEach(src => { const img = document.createElement('img'); img.src = src; img.className = 'tall-thumbnail'; tallGroup.appendChild(img); }); if(tallGroup.children.length > 0) bottomRightPanel.appendChild(tallGroup); const smallGroup = document.createElement('div'); smallGroup.className = 'thumbnail-group small-group'; const smallSources = [skin['아이콘 일러'], skin['쥬스타 아이콘 일러']].filter(src => src && src !== 'null'); smallSources.forEach(src => { const img = document.createElement('img'); img.src = src; smallGroup.appendChild(img); }); if(smallGroup.children.length > 0) bottomRightPanel.appendChild(smallGroup); bottomPanel.appendChild(bottomRightPanel); imageGallery.appendChild(bottomPanel); imageGallery.classList.remove('hidden');

        // Build Descriptions and Tables (Unchanged)
        textContentArea.innerHTML = ''; let textContentHtml = ''; let descriptionsHtml = ''; let leftGroupHtml = ''; if (skin['설명']) { leftGroupHtml += `<div class="description-item"><h2>설명</h2><p>${skin['설명']}</p></div>`; } if (skin['드랍 설명']) { leftGroupHtml += `<div class="description-item"><h2>드랍 설명</h2><p>${skin['드랍 설명']}</p></div>`; } if (leftGroupHtml) { descriptionsHtml += `<div class="description-group">${leftGroupHtml}</div>`; } if (skin['자기소개']) { descriptionsHtml += `<div class="description-item"><h2>자기소개</h2><p>${skin['자기소개']}</p></div>`; } if (descriptionsHtml) { textContentHtml += `<div class="descriptions-panel">${descriptionsHtml}</div>`; }
        const firstTableFields = ["전투개시", "상세확인", "의뢰 완료", "실망", "낯섦", "호감", "기쁨", "사랑", "터치3", "모항귀환", "hp 경고", "로그인", "실패", "우편", "메인1~5", "임무", "임무완료", "서약", "스킬", "터치1", "터치2", "입수시", "강화성공", "vote", "승리"];
        let firstTableBodyHtml = '';
        firstTableFields.forEach(field => { if (skin[field]) { let value = skin[field].replace(/\"/g, ''); if (field === "메인1~5") { value = value.replace(/\\n/g, '\n'); } firstTableBodyHtml += `<tr><td>${field}</td><td>${value}</td></tr>`; } });
        if (firstTableBodyHtml) { textContentHtml += `<table class="voice-line-table"><thead><tr><th colspan="2">선택한 함순이의 대사 모음</th></tr></thead><tbody>${firstTableBodyHtml}</tbody></table>`; }
        textContentArea.innerHTML = textContentHtml;
        if (textContentHtml) textContentArea.classList.remove('hidden');

        oathTableArea.innerHTML = '';
        const oathTableFields = ["전투개시_ex", "상세확인_ex", "의뢰 완료_ex", "사랑_ex", "터치3_ex", "모항귀환_ex", "hp 경고_ex", "로그인_ex", "실패_ex", "우편_ex", "메인1~5_ex", "임무_ex", "임무완료_ex", "스킬_ex", "터치1_ex", "터치2_ex", "입수시_ex", "강화성공_ex", "승리_ex"];
        let oathTableBodyHtml = '';
        oathTableFields.forEach(field => { if (skin[field] && skin[field] !== '""') { let value = skin[field].replace(/\"/g, ''); value = value.replace(/\\n/g, '\n'); oathTableBodyHtml += `<tr><td>${field}</td><td>${value}</td></tr>`; } });
        if (oathTableBodyHtml) { const fullOathTableHtml = `<table class="voice-line-table"><thead><tr><th colspan="2">선택한 함순이의 서약대사 모음</th></tr></thead><tbody>${oathTableBodyHtml}</tbody></table>`; oathTableArea.innerHTML = fullOathTableHtml; oathTableArea.classList.remove('hidden'); }
    };
    
    // --- Initialize Dropdown Behaviors ---
    setupDropdown(characterSearchInput, characterDropdownContent, allCharacterNames, handleCharacterSelect);
    setupDropdown(skinSearchInput, skinDropdownContent, currentCharacterSkins, handleSkinSelect);

    // Special handling for the skin dropdown source array, which changes dynamically
    skinSearchInput.addEventListener('focus', () => {
        // When the skin input is focused, its source of truth is the current character's skins
        setupDropdown(skinSearchInput, skinDropdownContent, currentCharacterSkins, handleSkinSelect);
    });
});
