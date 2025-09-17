document.addEventListener('DOMContentLoaded', () => {
    // Get HTML elements
    const characterSearch = document.getElementById('character-search');
    const characterSelect = document.getElementById('character-select');
    const skinSelect = document.getElementById('skin-select');
    const contentDisplay = document.getElementById('content-display');
    const skinImage = document.getElementById('skin-image');
    const descriptionList = document.getElementById('description-list');
    const chatLeft = document.getElementById('chat-lines-left');
    const chatRight = document.getElementById('chat-lines-right');

    let skinData = [];
    let allCharacterOptions = []; // Store a copy of all options for filtering

    // --- 1. Fetch and Process JSON Data ---
    fetch('subset_skin_data.json')
        .then(response => response.json())
        .then(jsonData => {
            skinData = Object.values(jsonData);
            populateCharacterSelect();
            // Load first character by default
            if (characterSelect.options.length > 1) {
                characterSelect.selectedIndex = 1;
                updateSkinSelect();
                if (skinSelect.options.length > 1) {
                    skinSelect.selectedIndex = 1;
                    displaySkinDetails();
                }
            }
        })
        .catch(error => {
            console.error('Error fetching or parsing JSON:', error);
            characterSelect.innerHTML = '<option>Error loading data</option>';
        });

    // --- 2. Populate the Character Dropdown ---
    const populateCharacterSelect = () => {
        const characterNames = [...new Set(skinData.map(row => row['함순이 이름']))].filter(name => name);
        characterSelect.innerHTML = '<option value="">-- Select a Character --</option>';
        characterNames.sort().forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            characterSelect.appendChild(option);
        });
        // Store a copy of the options for the search filter
        allCharacterOptions = Array.from(characterSelect.options);
    };

    // --- 3. Filter Character Dropdown based on Search Input ---
    const filterCharacters = () => {
        const searchTerm = characterSearch.value.toLowerCase();
        // Clear current options
        characterSelect.innerHTML = '';
        // Add back the options that match the search term
        allCharacterOptions.forEach(option => {
            const optionText = option.textContent.toLowerCase();
            if (option.value === "" || optionText.includes(searchTerm)) {
                characterSelect.appendChild(option.cloneNode(true));
            }
        });
    };

    // --- 4. Update Skin Dropdown When a Character is Selected ---
    const updateSkinSelect = () => {
        // When a selection is made, sync the search box text
        if (characterSelect.value) {
            characterSearch.value = characterSelect.value;
        }
        
        const selectedCharacter = characterSelect.value;
        skinSelect.innerHTML = '<option value="">-- Select a Skin --</option>';
        contentDisplay.classList.add('hidden');

        if (!selectedCharacter) {
            skinSelect.disabled = true;
            return;
        }

        const characterSkins = skinData.filter(row => row['함순이 이름'] === selectedCharacter);
        characterSkins.forEach(skin => {
            const option = document.createElement('option');
            const skinName = skin['한글 함순이 + 스킨 이름'];
            option.value = skinName;
            option.textContent = skinName;
            skinSelect.appendChild(option);
        });
        skinSelect.disabled = false;
    };

    // --- 5. Display Skin Details ---
    const displaySkinDetails = () => {
        // (This function remains unchanged)
        const selectedSkinName = skinSelect.value;
        if (!selectedSkinName) {
            contentDisplay.classList.add('hidden');
            return;
        }
        const skin = skinData.find(row => row['한글 함순이 + 스킨 이름'] === selectedSkinName);
        if (!skin) return;
        skinImage.src = skin['이미지 주소1'] || '';
        const descriptionKeys = ['획득 대사', '모항 대사', '터치 대사', '터치 대사2', '임무 대사', '임무 완료 대사', '위탁 완료 대사', '강화 성공 대사', '결혼 대사'];
        descriptionList.innerHTML = '';
        descriptionKeys.forEach(key => {
            if (skin[key]) {
                const item = document.createElement('div');
                item.className = 'desc-item';
                item.innerHTML = `<strong>${key.replace(' 대사', '')}:</strong> ${skin[key]}`;
                descriptionList.appendChild(item);
            }
        });
        chatLeft.innerHTML = '';
        chatRight.innerHTML = '';
        Object.keys(skin).forEach(key => {
            if (skin[key] && key.endsWith('대사') && !descriptionKeys.includes(key)) {
                const bubble = document.createElement('div');
                bubble.className = 'chat-bubble';
                bubble.textContent = skin[key];
                if (key.includes('_ex')) {
                    chatRight.appendChild(bubble);
                } else {
                    chatLeft.appendChild(bubble);
                }
            }
        });
        contentDisplay.classList.remove('hidden');
    };

    // Attach event listeners
    characterSearch.addEventListener('input', filterCharacters);
    characterSelect.addEventListener('change', updateSkinSelect);
    skinSelect.addEventListener('change', displaySkinDetails);
});