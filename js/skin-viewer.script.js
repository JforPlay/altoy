document.addEventListener('DOMContentLoaded', () => {
    // Get HTML elements
    const characterSearch = document.getElementById('character-search');
    const characterSelect = document.getElementById('character-select');
    const skinSelect = document.getElementById('skin-select');
    const imageGallery = document.getElementById('image-gallery');

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
        .then(response => response.json())
        .then(jsonData => {
            if (!jsonData || Object.keys(jsonData).length === 0) {
                throw new Error('JSON data is empty or invalid.');
            }
            skinData = Object.values(jsonData);
            populateCharacterSelect();
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
            characterSelect.innerHTML = '<option>Error: Could not load data.</option>';
        });

    const populateCharacterSelect = () => {
        const characterNames = [...new Set(skinData.map(row => row['함순이 이름']))].filter(name => name);
        allCharacterData = [];
        characterNames.sort().forEach(name => {
            allCharacterData.push({ value: name, text: name });
        });
        filterCharacters();
    };
    
    const filterCharacters = () => {
        const searchTerm = characterSearch.value.toLowerCase();
        const currentSelection = characterSelect.value;
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

    // --- MODIFIED: This function now adds specific classes to thumbnails ---
    const displaySkinDetails = () => {
        const selectedSkinName = skinSelect.value;
        if (!selectedSkinName) {
            imageGallery.classList.add('hidden');
            return;
        }
        const skin = skinData.find(row => row['한글 함순이 + 스킨 이름'] === selectedSkinName);
        if (!skin) return;

        imageGallery.innerHTML = '';

        const mainImageSrc = skin['전체 일러'];
        // Define thumbnails with their types for specific styling
        const thumbnailData = [
            { type: 'enlarged', src: skin['확대 일러'] },
            { type: 'tall',     src: skin['깔끔한 일러'] },
            { type: 'small',    src: skin['sd 일러'] },
            { type: 'small',    src: skin['아이콘 일러'] },
            { type: 'small',    src: skin['쥬스타 아이콘 일러'] }
        ].filter(item => item.src && item.src !== 'null'); // Filter out empty image fields

        const leftPanel = document.createElement('div');
        leftPanel.className = 'gallery-left-panel';
        if (mainImageSrc && mainImageSrc !== 'null') {
            const mainImage = document.createElement('img');
            mainImage.src = mainImageSrc;
            leftPanel.appendChild(mainImage);
        }
        
        const rightPanel = document.createElement('div');
        rightPanel.className = 'gallery-right-panel';
        thumbnailData.forEach(item => {
            const thumbImage = document.createElement('img');
            thumbImage.src = item.src;
            // Add the base class and the type-specific class
            thumbImage.classList.add('thumbnail-image', `thumbnail-${item.type}`);
            rightPanel.appendChild(thumbImage);
        });

        imageGallery.appendChild(leftPanel);
        imageGallery.appendChild(rightPanel);
        imageGallery.classList.remove('hidden');
    };

    // Attach event listeners
    characterSearch.addEventListener('input', debounce(filterCharacters, 250));
    characterSelect.addEventListener('change', updateSkinSelect);
    skinSelect.addEventListener('change', displaySkinDetails);
});