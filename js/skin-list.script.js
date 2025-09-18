document.addEventListener('DOMContentLoaded', () => {
    // Get HTML elements
    const skinTypeSelect = document.getElementById('skin-type-select');
    const rarityCheckboxes = document.getElementById('rarity-checkboxes');
    const skinListContainer = document.getElementById('skin-list-container');
    const factionSelect = document.getElementById('faction-select');
    const tagSelect = document.getElementById('tag-select');
    const exDialogueCheckbox = document.getElementById('ex-dialogue-checkbox'); // New element

    let allSkins = [];
    let exChatStatusData = {}; // To store the new status data

    // Fetch all necessary data files
    Promise.all([
        fetch('data/subset_skin_data.json').then(res => res.json()),
        fetch('data/ex_chat_status.json').then(res => res.json())
    ]).then(([skinJson, exChatJson]) => {
        allSkins = Object.values(skinJson).filter(skin => skin['깔끔한 일러']);
        exChatStatusData = exChatJson;
        renderSkinList(allSkins);
    }).catch(error => {
        console.error("Failed to load data:", error);
        skinListContainer.innerHTML = `<p style="color: #f04747; text-align: center;">Error loading data. Please check the data files and console for errors.</p>`;
    });

    // Function to render the list of skin boxes
    const renderSkinList = (skinsToRender) => {
        skinListContainer.innerHTML = '';
        const gemIconHtml = `<img src="assets/60px-Ruby.png" class="gem-icon" alt="Gem">`;

        skinsToRender.forEach(skin => {
            const skinBox = document.createElement('div');
            skinBox.className = 'skin-box';
            let costHtml = skin['재화'] ? `${gemIconHtml} ${skin['재화']}` : 'N/A';

            skinBox.innerHTML = `
                <div class="skin-image-wrapper">
                    <img src="${skin['깔끔한 일러']}" class="skin-image" loading="lazy">
                </div>
                <div class="skin-info">
                    <h3>${skin['함순이 이름']}</h3>
                    <div class="info-line"><strong>타입:</strong> ${skin['스킨 타입 - 한글'] || '기본'}</div>
                    <div class="info-line"><strong>태그:</strong> ${skin['스킨 태그'] || '없음'}</div>
                    <div class="info-line"><strong>진영:</strong> ${skin['진영'] || '없음'}</div>
                    <div class="info-line"><strong>레어도:</strong> ${skin['레어도'] || '없음'}</div>
                    <div class="info-line"><strong>가격:</strong> ${costHtml}</div>
                </div>
            `;
            skinListContainer.appendChild(skinBox);
        });
    };

    // --- MODIFIED: applyFilters now handles all five filters ---
    const applyFilters = () => {
        const selectedType = skinTypeSelect.value;
        const selectedFaction = factionSelect.value;
        const selectedTag = tagSelect.value;
        const selectedRarities = [...rarityCheckboxes.querySelectorAll('input:checked')].map(cb => cb.value);
        const showOnlyEx = exDialogueCheckbox.checked;

        let filteredSkins = allSkins;

        // 1. Filter by EX dialogue status
        if (showOnlyEx) {
            filteredSkins = filteredSkins.filter(skin => {
                const characterName = skin['함순이 이름'];
                return exChatStatusData[characterName] === 1;
            });
        }

        // 2. Filter by skin type
        if (selectedType !== 'all') {
            if (selectedType === '기본') {
                filteredSkins = filteredSkins.filter(skin => !skin['스킨 타입 - 한글']);
            } else {
                filteredSkins = filteredSkins.filter(skin => skin['스킨 타입 - 한글'] === selectedType);
            }
        }

        // 3. Filter by faction
        if (selectedFaction !== 'all') {
            filteredSkins = filteredSkins.filter(skin => skin['진영'] === selectedFaction);
        }

        // 4. Filter by skin tag (contains)
        if (selectedTag !== 'all') {
            filteredSkins = filteredSkins.filter(skin => skin['스킨 태그'] && skin['스킨 태그'].includes(selectedTag));
        }

        // 5. Filter by rarity
        if (selectedRarities.length > 0) {
            filteredSkins = filteredSkins.filter(skin => selectedRarities.includes(skin['레어도']));
        }

        renderSkinList(filteredSkins);
    };

    // Attach event listeners to all filter controls
    skinTypeSelect.addEventListener('change', applyFilters);
    factionSelect.addEventListener('change', applyFilters);
    tagSelect.addEventListener('change', applyFilters);
    exDialogueCheckbox.addEventListener('change', applyFilters);
    rarityCheckboxes.querySelectorAll('input').forEach(checkbox => {
        checkbox.addEventListener('change', applyFilters);
    });
});