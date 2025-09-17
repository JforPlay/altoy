document.addEventListener('DOMContentLoaded', () => {
    // Get HTML elements
    const characterSelect = document.getElementById('character-select');
    const skinSelect = document.getElementById('skin-select');
    const contentDisplay = document.getElementById('content-display');
    const skinImage = document.getElementById('skin-image');
    const descriptionList = document.getElementById('description-list');
    const chatLeft = document.getElementById('chat-lines-left');
    const chatRight = document.getElementById('chat-lines-right');

    let skinData = [];

    // --- 1. Fetch and Parse CSV Data ---
    fetch('data/subset_skin_data.csv')
        .then(response => response.text())
        .then(csvText => {
            skinData = parseCSV(csvText);
            populateCharacterSelect();
        });

    // Simple CSV parser function
    const parseCSV = (text) => {
        const lines = text.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            const rowObject = {};
            headers.forEach((header, index) => {
                rowObject[header] = values[index];
            });
            rows.push(rowObject);
        }
        return rows;
    };

    // --- 2. Populate the First Dropdown (Characters) ---
    const populateCharacterSelect = () => {
        const characterNames = [...new Set(skinData.map(row => row['함순이 이름']))];
        characterSelect.innerHTML = '<option value="">-- Select a Character --</option>'; // Reset
        characterNames.sort().forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            characterSelect.appendChild(option);
        });
    };

    // --- 3. Update Skin Dropdown When a Character is Selected ---
    const updateSkinSelect = () => {
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

    // --- 4. Display All Details When a Skin is Selected ---
    const displaySkinDetails = () => {
        const selectedSkinName = skinSelect.value;
        if (!selectedSkinName) {
            contentDisplay.classList.add('hidden');
            return;
        }

        const skin = skinData.find(row => row['한글 함순이 + 스킨 이름'] === selectedSkinName);
        if (!skin) return;

        // Display Image
        skinImage.src = skin['이미지 주소1'] || '';

        // Display Descriptions
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

        // Display Chat Lines
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
    characterSelect.addEventListener('change', updateSkinSelect);
    skinSelect.addEventListener('change', displaySkinDetails);
});