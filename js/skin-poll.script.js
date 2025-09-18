document.addEventListener('DOMContentLoaded', () => {
    // Get HTML elements
    const pollContainer = document.getElementById('poll-container');
    const skinTypeSelect = document.getElementById('skin-type-select');
    const rarityCheckboxes = document.getElementById('rarity-checkboxes');
    const factionSelect = document.getElementById('faction-select');
    
    let allSkins = [];

    // Fetch and process the data
    fetch('data/subset_skin_data.json')
        .then(response => response.json())
        .then(jsonData => {
            allSkins = Object.keys(jsonData).map(key => ({ id: key, ...jsonData[key] }))
                .filter(skin => skin['깔끔한 일러'] && skin['스킨 태그'] && skin['스킨 태그'].includes('L2D'));
            renderPollList(allSkins);
        });

    const renderPollList = (skinsToRender) => {
        pollContainer.innerHTML = '';
        skinsToRender.forEach(skin => {
            const skinId = skin.id;
            const pollBox = document.createElement('div');
            pollBox.className = 'poll-box';
            const hasVoted = localStorage.getItem(`voted_${skinId}`) === 'true';

            pollBox.innerHTML = `
                <img src="${skin['깔끔한 일러']}" class="poll-image" loading="lazy">
                <div class="poll-info">
                    <div class="character-name">${skin['함순이 이름']}</div>
                    <h3>${skin['한글 함순이 + 스킨 이름']}</h3>
                    <div class="info-line">${skin['스킨 카테고리'] || ''}</div>
                    <div class="rating-area ${hasVoted ? 'voted' : ''}">
                        <div class="star-rating" data-skin-id="${skinId}">
                            <input type="radio" id="star5-${skinId}" name="rating-${skinId}" value="5" ${hasVoted ? 'disabled' : ''}><label for="star5-${skinId}">★</label>
                            <input type="radio" id="star4-${skinId}" name="rating-${skinId}" value="4" ${hasVoted ? 'disabled' : ''}><label for="star4-${skinId}">★</label>
                            <input type="radio" id="star3-${skinId}" name="rating-${skinId}" value="3" ${hasVoted ? 'disabled' : ''}><label for="star3-${skinId}">★</label>
                            <input type="radio" id="star2-${skinId}" name="rating-${skinId}" value="2" ${hasVoted ? 'disabled' : ''}><label for="star2-${skinId}">★</label>
                            <input type="radio" id="star1-${skinId}" name="rating-${skinId}" value="1" ${hasVoted ? 'disabled' : ''}><label for="star1-${skinId}">★</label>
                        </div>
                        <div class="poll-results" id="results-${skinId}">
                            Connect to Firebase to see results.
                        </div>
                    </div>
                </div>
            `;
            pollContainer.appendChild(pollBox);
        });
    };

    const applyFilters = () => {
        const selectedType = skinTypeSelect.value;
        const selectedFaction = factionSelect.value;
        const selectedRarities = [...rarityCheckboxes.querySelectorAll('input:checked')].map(cb => cb.value);
        let filteredSkins = allSkins;

        if (selectedType !== 'all') { if (selectedType === '기본') { filteredSkins = filteredSkins.filter(skin => !skin['스킨 타입 - 한글']); } else { filteredSkins = filteredSkins.filter(skin => skin['스킨 타입 - 한글'] === selectedType); } }
        if (selectedFaction !== 'all') { filteredSkins = filteredSkins.filter(skin => skin['진영'] === selectedFaction); }
        if (selectedRarities.length > 0) { filteredSkins = filteredSkins.filter(skin => selectedRarities.includes(skin['레어도'])); }
        renderPollList(filteredSkins);
    };

    [skinTypeSelect, factionSelect].forEach(el => el.addEventListener('change', applyFilters));
    rarityCheckboxes.querySelectorAll('input').forEach(cb => cb.addEventListener('change', applyFilters));
});