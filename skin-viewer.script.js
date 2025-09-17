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
    let allCharacterData = [];

    const debounce = (func, delay) => {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                func.apply(this, args);
            }, delay);
        };
    };

    fetch('data/subset_skin_data.json')
        .then(response => {
            if (!response.ok) {
                // More specific error for network issues
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(jsonData => {
            if (!jsonData || Object.keys(jsonData).length === 0) {
                // More specific error for empty/invalid file
                throw new Error('JSON data is empty or invalid.');
            }
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
            console.error('Error loading or parsing JSON:', error);
            const loadingIndicator = document.getElementById('loading-indicator');
            if (loadingIndicator) {
                // Provide a more helpful error message to the user
                loadingIndicator.textContent = 'Error: Could not load data. Please ensure "subset_skin_data.json" is in the same folder as the HTML file.';
                loadingIndicator.classList.add('error');
            }
        });

    const populateCharacterSelect = () => {
        const characterNames = [...new Set(skinData.map(row => row['함순이 이름']))].filter(name => name);
        allCharacterData = [];
        characterNames.sort().forEach(name => {
            allCharacterData.push({ value: name, text: name });
        });
        filterCharacters(); // Initial population
    };
    
    const filterCharacters = () => {
        const searchTerm = characterSearch.value.toLowerCase();
        const currentSelection = characterSelect.value; // Remember what was selected
        characterSelect.innerHTML = '';
        
        const placeholder = document.createElement('option');
        placeholder.value = "";
        placeholder.textContent = "-- Select a Character --";
        characterSelect.appendChild(placeholder);

        let isCurrentSelectionInList = false;
        allCharacterData.forEach(data => {
            if (data.text.toLowerCase().includes(searchTerm)) {
                const option = document.createElement('option');
                option.value = data.value;
                option.textContent = data.text;
                characterSelect.appendChild(option);
                if (data.value === currentSelection) {
                    isCurrentSelectionInList = true;
                }
            }
        });
        
        // If the selected item still exists in the filtered list, keep it selected
        if (isCurrentSelectionInList) {
             characterSelect.value = currentSelection;
        }
    };
    
    // --- DEBUGGED: Fixed the search/select interaction ---
    const updateSkinSelect = () => {
        // When a selection is made from the dropdown, update the search box text
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

    const displaySkinDetails = () => {
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
    characterSearch.addEventListener('input', debounce(filterCharacters, 250));
    characterSelect.addEventListener('change', updateSkinSelect);
    skinSelect.addEventListener('change', displaySkinDetails);
});
