document.addEventListener('DOMContentLoaded', () => {
    // Get HTML elements (unchanged)
    const characterSearchInput = document.getElementById('character-search-input');
    const characterDropdownContent = document.getElementById('character-dropdown-content');
    const skinSearchInput = document.getElementById('skin-search-input');
    const skinDropdownContent = document.getElementById('skin-dropdown-content');
    const skinInfoBox = document.getElementById('skin-info-box');
    const imageGallery = document.getElementById('image-gallery');
    const textContentArea = document.getElementById('text-content-area');
    const oathTableArea = document.getElementById('oath-table-area');

    // Data storage (unchanged)
    let skinData = [];
    let allCharacterNames = [];
    let currentCharacterSkins = [];

    // Helper and Dropdown Functions (unchanged)
    const debounce = (func, delay) => { let timeoutId; return (...args) => { clearTimeout(timeoutId); timeoutId = setTimeout(() => { func.apply(this, args); }, delay); }; };
    const populateDropdown = (dropdownEl, items, onSelectCallback) => { dropdownEl.innerHTML = ''; if (items.length === 0) { dropdownEl.innerHTML = `<div class="no-results">검색 결과가 없습니다</div>`; return; } items.forEach(item => { const a = document.createElement('a'); a.textContent = item; a.addEventListener('click', () => { onSelectCallback(item); }); dropdownEl.appendChild(a); }); };
    const setupDropdown = (inputEl, dropdownEl, getSourceArray, onSelectCallback) => { const handleFilter = () => { const sourceArray = getSourceArray(); const searchTerm = inputEl.value.toLowerCase(); const isExactMatch = sourceArray.some(item => item.toLowerCase() === searchTerm); if (isExactMatch) { populateDropdown(dropdownEl, sourceArray, onSelectCallback); } else { const filteredItems = sourceArray.filter(item => item.toLowerCase().includes(searchTerm)); populateDropdown(dropdownEl, filteredItems, onSelectCallback); } }; inputEl.addEventListener('keyup', debounce(handleFilter, 200)); inputEl.addEventListener('focus', () => { handleFilter(); dropdownEl.style.display = 'block'; }); inputEl.addEventListener('blur', () => { setTimeout(() => { dropdownEl.style.display = 'none'; }, 200); }); };

    // --- NEW: URL State Management Functions ---

    /**
     * Reads the current selections and updates the browser URL.
     */
    const updateURLWithFilters = () => {
        const params = new URLSearchParams();
        if (characterSearchInput.value) {
            params.set('character', characterSearchInput.value);
        }
        if (skinSearchInput.value) {
            params.set('skin', skinSearchInput.value);
        }
        const newUrl = `${window.location.pathname}?${params.toString()}`;
        // Use replaceState to avoid cluttering history for every minor change
        history.replaceState({ path: newUrl }, '', newUrl);
    };

    /**
     * Reads filter parameters from the URL and applies them to the page.
     */
    const applyFiltersFromURL = () => {
        const params = new URLSearchParams(window.location.search);
        const character = params.get('character');
        const skin = params.get('skin');

        if (character) {
            // Check if the character from the URL is valid
            if (allCharacterNames.includes(character)) {
                handleCharacterSelect(character, false); // Select without clearing the next input
                if (skin) {
                    // Check if the skin belongs to the character
                    if (currentCharacterSkins.includes(skin)) {
                        handleSkinSelect(skin);
                    }
                }
            }
        }
    };

    // --- Main Data Fetching and Initialization ---
    fetch('data/subset_skin_data.json')
        .then(response => response.json())
        .then(jsonData => {
            if (!jsonData || Object.keys(jsonData).length === 0) throw new Error('JSON data is empty or invalid.');
            skinData = Object.values(jsonData);
            allCharacterNames = [...new Set(skinData.map(row => row['함순이 이름']))].filter(name => name).sort();
            
            // Setup dropdowns
            setupDropdown(characterSearchInput, characterDropdownContent, () => allCharacterNames, handleCharacterSelect);
            setupDropdown(skinSearchInput, skinDropdownContent, () => currentCharacterSkins, handleSkinSelect);
            
            // NEW: Apply filters from URL on load instead of a hardcoded default
            applyFiltersFromURL();
            
        }).catch(error => {
            console.error('Error loading or parsing JSON:', error);
            characterSearchInput.placeholder = 'Error: Could not load data.';
        });

    // --- Event Handlers and Core Logic ---

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
            
        if (clearSkin) {
            clearSkinDetails();
        }
        updateURLWithFilters(); // Update URL with selected character
    }

    function handleSkinSelect(skinName) {
        skinSearchInput.value = skinName;
        skinDropdownContent.style.display = 'none';
        displaySkinDetails();
        updateURLWithFilters(); // Update URL with selected skin
    }

    function clearSkinDetails() {
        skinInfoBox.classList.add('hidden');
        imageGallery.classList.add('hidden');
        textContentArea.classList.add('hidden');
        oathTableArea.classList.add('hidden');
    }

    // Unchanged display function
    const displaySkinDetails = () => { const selectedSkinName = skinSearchInput.value; if (!selectedSkinName) { clearSkinDetails(); return; } const skin = skinData.find(row => row['한글 함순이 + 스킨 이름'] === selectedSkinName); if (!skin) return; skinInfoBox.innerHTML = ''; let infoHtml = ''; const gemIconHtml = `<img src="assets/icon/60px-Ruby.png" class="gem-icon" alt="Gem">`; if (skin['재화'] && skin['재화'] !== 'null') { infoHtml += `<div class="info-item">${gemIconHtml}<span class="info-value">${skin['재화']}</span></div>`; } if (skin['기간'] && skin['기간'] !== 'null') { infoHtml += `<div class="info-item"><strong class="info-label">상시여부:</strong><span class="info-value">${skin['기간']}</span></div>`; } if (skin['스킨 타입 - 한글'] && skin['스킨 타입 - 한글'] !== 'null') { infoHtml += `<div class="info-item"><strong class="info-label">스킨타입:</strong><span class="info-value">${skin['스킨 타입 - 한글']}</span></div>`; } if (skin['스킨 태그'] && skin['스킨 태그'] !== 'null') { infoHtml += `<div class="info-item"><strong class="info-label">스킨태그:</strong><span class="info-value">${skin['스킨 태그']}</span></div>`; } skinInfoBox.innerHTML = infoHtml; if (infoHtml) skinInfoBox.classList.remove('hidden'); imageGallery.innerHTML = ''; const topBannerSrc = skin['전체 일러']; if (topBannerSrc && topBannerSrc !== 'null') { const topBannerImg = document.createElement('img'); topBannerImg.className = 'gallery-top-banner'; topBannerImg.src = topBannerSrc; imageGallery.appendChild(topBannerImg); } const bottomPanel = document.createElement('div'); bottomPanel.className = 'gallery-bottom-panel'; const bottomLeftPanel = document.createElement('div'); bottomLeftPanel.className = 'bottom-left-panel'; const secondaryLargeSrc = skin['확대 일러']; if (secondaryLargeSrc && secondaryLargeSrc !== 'null') { const secondaryImg = document.createElement('img'); secondaryImg.src = secondaryLargeSrc; bottomLeftPanel.appendChild(secondaryImg); } else { const dummyBox = document.createElement('div'); dummyBox.className = 'dummy-image-box'; dummyBox.textContent = '이 스킨은 확대 일러가 없어요 지휘관님'; bottomLeftPanel.appendChild(dummyBox); } bottomPanel.appendChild(bottomLeftPanel); const bottomRightPanel = document.createElement('div'); bottomRightPanel.className = 'bottom-right-panel'; const tallGroup = document.createElement('div'); tallGroup.className = 'thumbnail-group tall-group'; const tallSources = [skin['깔끔한 일러'], skin['sd 일러']].filter(src => src && src !== 'null'); tallSources.forEach(src => { const img = document.createElement('img'); img.src = src; img.className = 'tall-thumbnail'; tallGroup.appendChild(img); }); if(tallGroup.children.length > 0) bottomRightPanel.appendChild(tallGroup); const smallGroup = document.createElement('div'); smallGroup.className = 'thumbnail-group small-group'; const smallSources = [skin['아이콘 일러'], skin['쥬스타 아이콘 일러']].filter(src => src && src !== 'null'); smallSources.forEach(src => { const img = document.createElement('img'); img.src = src; smallGroup.appendChild(img); }); if(smallGroup.children.length > 0) bottomRightPanel.appendChild(smallGroup); bottomPanel.appendChild(bottomRightPanel); imageGallery.appendChild(bottomPanel); imageGallery.classList.remove('hidden'); textContentArea.innerHTML = ''; let textContentHtml = ''; let descriptionsHtml = ''; let leftGroupHtml = ''; if (skin['설명']) { leftGroupHtml += `<div class="description-item"><h2>설명</h2><p>${skin['설명']}</p></div>`; } if (skin['드랍 설명']) { leftGroupHtml += `<div class="description-item"><h2>드랍 설명</h2><p>${skin['드랍 설명']}</p></div>`; } if (leftGroupHtml) { descriptionsHtml += `<div class="description-group">${leftGroupHtml}</div>`; } if (skin['자기소개']) { descriptionsHtml += `<div class="description-item"><h2>자기소개</h2><p>${skin['자기소개']}</p></div>`; } if (descriptionsHtml) { textContentHtml += `<div class="descriptions-panel">${descriptionsHtml}</div>`; } const firstTableFields = ["전투개시", "상세확인", "의뢰 완료", "실망", "낯섦", "호감", "기쁨", "사랑", "터치3", "모항귀환", "hp 경고", "로그인", "실패", "우편", "메인1~5", "임무", "임무완료", "서약", "스킬", "터치1", "터치2", "입수시", "강화성공", "vote", "승리"]; let firstTableBodyHtml = ''; firstTableFields.forEach(field => { if (skin[field]) { let value = skin[field].replace(/\"/g, ''); if (field === "메인1~5") { value = value.replace(/\\n/g, '\n'); } firstTableBodyHtml += `<tr><td>${field}</td><td>${value}</td></tr>`; } }); if (firstTableBodyHtml) { textContentHtml += `<table class="voice-line-table"><thead><tr><th colspan="2">선택한 함순이의 대사 모음</th></tr></thead><tbody>${firstTableBodyHtml}</tbody></table>`; } textContentArea.innerHTML = textContentHtml; if (textContentHtml) textContentArea.classList.remove('hidden'); oathTableArea.innerHTML = ''; const oathTableFields = ["전투개시_ex", "상세확인_ex", "의뢰 완료_ex", "사랑_ex", "터치3_ex", "모항귀환_ex", "hp 경고_ex", "로그인_ex", "실패_ex", "우편_ex", "메인1~5_ex", "임무_ex", "임무완료_ex", "스킬_ex", "터치1_ex", "터치2_ex", "입수시_ex", "강화성공_ex", "승리_ex"]; let oathTableBodyHtml = ''; oathTableFields.forEach(field => { if (skin[field] && skin[field] !== '""') { let value = skin[field].replace(/\"/g, ''); value = value.replace(/\\n/g, '\n'); oathTableBodyHtml += `<tr><td>${field}</td><td>${value}</td></tr>`; } }); if (oathTableBodyHtml) { const fullOathTableHtml = `<table class="voice-line-table"><thead><tr><th colspan="2">선택한 함순이의 서약대사 모음</th></tr></thead><tbody>${oathTableBodyHtml}</tbody></table>`; oathTableArea.innerHTML = fullOathTableHtml; oathTableArea.classList.remove('hidden'); } };

    // NEW: Listen for back/forward navigation
    window.addEventListener('popstate', applyFiltersFromURL);
});