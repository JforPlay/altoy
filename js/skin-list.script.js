document.addEventListener('DOMContentLoaded', () => {
    // Get HTML elements
    const skinTypeSelect = document.getElementById('skin-type-select');
    const rarityCheckboxes = document.getElementById('rarity-checkboxes');
    const skinListContainer = document.getElementById('skin-list-container');

    let allSkins = [];

    // Fetch and process the data
    fetch('data/subset_skin_data.json')
        .then(response => response.json())
        .then(jsonData => {
            // Convert object to array and filter out items without a main image
            allSkins = Object.values(jsonData).filter(skin => skin['깔끔한 일러']);
            renderSkinList(allSkins); // Initial render
        });

    // Function to render the list of skin boxes
    const renderSkinList = (skinsToRender) => {
        skinListContainer.innerHTML = ''; // Clear previous results
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

    // Function to apply all active filters
    const applyFilters = () => {
        const selectedType = skinTypeSelect.value;
        const selectedRarities = [...rarityCheckboxes.querySelectorAll('input:checked')].map(cb => cb.value);

        let filteredSkins = allSkins;

        // 1. Filter by skin type
        if (selectedType !== 'all') {
            filteredSkins = filteredSkins.filter(skin => skin['스킨 타입 - 한글'] === selectedType);
        }

        // 2. Filter by rarity
        if (selectedRarities.length > 0) {
            filteredSkins = filteredSkins.filter(skin => selectedRarities.includes(skin['레어도']));
        }

        renderSkinList(filteredSkins);
    };

    // Attach event listeners to all filter controls
    skinTypeSelect.addEventListener('change', applyFilters);
    rarityCheckboxes.querySelectorAll('input').forEach(checkbox => {
        checkbox.addEventListener('change', applyFilters);
    });
});