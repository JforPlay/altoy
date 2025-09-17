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
            if (!jsonData || Object.keys(jsonData).length === 0) throw new Error('JSON data is empty or invalid.');
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

    // --- MODIFIED: This function now builds the new complex gallery layout ---
    const displaySkinDetails = () => {
        const selectedSkinName = skinSelect.value;
        if (!selectedSkinName) {
            imageGallery.classList.add('hidden');
            return;
        }
        const skin = skinData.find(row => row['한글 함순이 + 스킨 이름'] === selectedSkinName);
        if (!skin) return;

        imageGallery.innerHTML = ''; // Clear previous content

        // Create and append top banner image
        const topBannerSrc = skin['전체 일러'];
        if (topBannerSrc && topBannerSrc !== 'null') {
            const topBannerImg = document.createElement('img');
            topBannerImg.className = 'gallery-top-banner';
            topBannerImg.src = topBannerSrc;
            imageGallery.appendChild(topBannerImg);
        }

        // Create container for the bottom row
        const bottomPanel = document.createElement('div');
        bottomPanel.className = 'gallery-bottom-panel';

        // Create and append left column image
        const bottomLeftPanel = document.createElement('div');
        bottomLeftPanel.className = 'bottom-left-panel';
        const secondaryLargeSrc = skin['확대 일러'];
        if (secondaryLargeSrc && secondaryLargeSrc !== 'null') {
            const secondaryImg = document.createElement('img');
            secondaryImg.src = secondaryLargeSrc;
            bottomLeftPanel.appendChild(secondaryImg);
        }
        bottomPanel.appendChild(bottomLeftPanel);
        
        // Create right column and its content
        const bottomRightPanel = document.createElement('div');
        bottomRightPanel.className = 'bottom-right-panel';

        // Group 1: Tall thumbnails
        const tallGroup = document.createElement('div');
        tallGroup.className = 'thumbnail-group';
        const tallSources = [skin['깔끔한 일러'], skin['sd 일러']].filter(src => src && src !== 'null');
        tallSources.forEach(src => {
            const img = document.createElement('img');
            img.src = src;
            img.className = 'tall-thumbnail';
            tallGroup.appendChild(img);
        });
        if(tallGroup.children.length > 0) bottomRightPanel.appendChild(tallGroup);

        // Group 2: Small thumbnails
        const smallGroup = document.createElement('div');
        smallGroup.className = 'thumbnail-group';
        const smallSources = [skin['아이콘 일러'], skin['쥬스타 아이콘 일러']].filter(src => src && src !== 'null');
        smallSources.forEach(src => {
            const img = document.createElement('img');
            img.src = src;
            smallGroup.appendChild(img);
        });
        if(smallGroup.children.length > 0) bottomRightPanel.appendChild(smallGroup);

        bottomPanel.appendChild(bottomRightPanel);
        imageGallery.appendChild(bottomPanel);
        imageGallery.classList.remove('hidden');
    };

    // Attach event listeners
    characterSearch.addEventListener('input', debounce(filterCharacters, 250));
    characterSelect.addEventListener('change', updateSkinSelect);
    skinSelect.addEventListener('change', displaySkinDetails);
});