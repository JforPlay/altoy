document.addEventListener('DOMContentLoaded', () => {
    // Firebase Setup Placeholder
    // const firebaseConfig = { ... };
    // if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
    // const db = firebase.firestore();

    // Get HTML elements
    const pollContainer = document.getElementById('poll-container');
    const characterNameSearch = document.getElementById('character-name-search');
    const characterNameSelect = document.getElementById('character-name-select');
    const skinNameSearch = document.getElementById('skin-name-search');
    const skinNameSelect = document.getElementById('skin-name-select');
    const skinTypeSelect = document.getElementById('skin-type-select');
    const rarityCheckboxes = document.getElementById('rarity-checkboxes');
    const factionSelect = document.getElementById('faction-select');
    // const tagSelect = document.getElementById('tag-select'); // REMOVED

    // State Variables
    let allSkins = [];
    let allCharacterNamesData = [];
    let allSkinNamesData = [];

    const debounce = (func, delay) => { let timeoutId; return (...args) => { clearTimeout(timeoutId); timeoutId = setTimeout(() => { func.apply(this, args); }, delay); }; };

    fetch('data/subset_skin_data.json')
        .then(response => response.json())
        .then(jsonData => {
            allSkins = Object.keys(jsonData).map(key => ({ id: key, ...jsonData[key] }));
            populateInitialFilters();
            applyFilters();
        }).catch(error => {
             console.error("Failed to load or process data:", error);
             pollContainer.innerHTML = `<p style="color: #f04747; text-align: center;">Error loading data. Please check console.</p>`;
        });

    const populateInitialFilters = () => {
        allCharacterNamesData = [...new Set(allSkins.map(s => s['함순이 이름']))].filter(Boolean).sort().map(name => ({ value: name, text: name }));
        allSkinNamesData = allSkins.map(s => ({ 
            charName: s['함순이 이름'], 
            skinName: s['한글 함순이 + 스킨 이름'] 
        })).sort((a, b) => a.skinName.localeCompare(b.skinName));
        
        rebuildDropdown(characterNameSelect, allCharacterNamesData);
        rebuildDropdown(skinNameSelect, allSkinNamesData.map(s => ({ value: s.skinName, text: s.skinName })));

        const rarities = [...new Set(allSkins.map(s => s['레어도']))].filter(Boolean).sort();
        rarityCheckboxes.innerHTML = '';
        rarities.forEach(rarity => {
            const label = document.createElement('label');
            label.innerHTML = `<input type="checkbox" value="${rarity}" checked> ${rarity}`;
            rarityCheckboxes.appendChild(label);
            label.querySelector('input').addEventListener('change', applyFilters);
        });
    };

    const rebuildDropdown = (selectElement, optionsData) => {
        const currentVal = selectElement.value;
        selectElement.innerHTML = '<option value="all">전체</option>';
        optionsData.forEach(data => {
            const option = document.createElement('option');
            option.value = data.value;
            option.textContent = data.text;
            selectElement.appendChild(option);
        });
        if (optionsData.some(d => d.value === currentVal)) {
            selectElement.value = currentVal;
        } else {
            selectElement.value = 'all';
        }
    };
    
    const renderPollList = (skinsToRender) => {
        pollContainer.innerHTML = '';
        skinsToRender.forEach(skin => {
            const skinId = skin.id;
            const pollBox = document.createElement('div');
            pollBox.className = 'poll-box';
            const hasVoted = localStorage.getItem(`voted_${skinId}`) === 'true';

            pollBox.innerHTML = `
                <img src="${skin['깔끔한 일러'] || ''}" class="poll-image" loading="lazy">
                <div class="poll-info">
                    <div class="character-name">${skin['함순이 이름']}</div>
                    <h3>${skin['한글 함순이 + 스킨 이름']}</h3>
                    <div class="rating-area ${hasVoted ? 'voted' : ''}">
                        <div class="star-rating" data-skin-id="${skinId}" data-skin-name="${skin['한글 함순이 + 스킨 이름']}" data-character-name="${skin['함순이 이름']}">
                             <input type="radio" id="star5-${skinId}" name="rating-${skinId}" value="5" ${hasVoted ? 'disabled' : ''}><label for="star5-${skinId}">★</label>
                             <input type="radio" id="star4-${skinId}" name="rating-${skinId}" value="4" ${hasVoted ? 'disabled' : ''}><label for="star4-${skinId}">★</label>
                             <input type="radio" id="star3-${skinId}" name="rating-${skinId}" value="3" ${hasVoted ? 'disabled' : ''}><label for="star3-${skinId}">★</label>
                             <input type="radio" id="star2-${skinId}" name="rating-${skinId}" value="2" ${hasVoted ? 'disabled' : ''}><label for="star2-${skinId}">★</label>
                             <input type="radio" id="star1-${skinId}" name="rating-${skinId}" value="1" ${hasVoted ? 'disabled' : ''}><label for="star1-${skinId}">★</label>
                        </div>
                        <div class="poll-results" id="results-${skinId}">Loading results...</div>
                    </div>
                </div>
            `;
            pollContainer.appendChild(pollBox);
            // fetchAndDisplayResults(skinId); // Uncomment when Firebase is active
        });
    };

    const applyFilters = () => {
        const selectedCharName = characterNameSelect.value;
        const selectedSkinName = skinNameSelect.value;
        const selectedType = skinTypeSelect.value;
        const selectedFaction = factionSelect.value;
        // const selectedTag = tagSelect.value; // REMOVED
        const selectedRarities = [...rarityCheckboxes.querySelectorAll('input:checked')].map(cb => cb.value);
        let filteredSkins = allSkins;

        if (selectedCharName !== 'all') { filteredSkins = filteredSkins.filter(skin => skin['함순이 이름'] === selectedCharName); }
        if (selectedSkinName !== 'all') { filteredSkins = filteredSkins.filter(skin => skin['한글 함순이 + 스킨 이름'] === selectedSkinName); }
        if (selectedType !== 'all') { if (selectedType === '기본') { filteredSkins = filteredSkins.filter(skin => !skin['스킨 타입 - 한글']); } else { filteredSkins = filteredSkins.filter(skin => skin['스킨 타입 - 한글'] === selectedType); } }
        if (selectedFaction !== 'all') { filteredSkins = filteredSkins.filter(skin => skin['진영'] === selectedFaction); }
        // if (selectedTag !== 'all') { filteredSkins = filteredSkins.filter(skin => skin['스킨 태그'] && skin['스킨 태그'].includes(selectedTag));} // REMOVED
        if (selectedRarities.length > 0) { filteredSkins = filteredSkins.filter(skin => selectedRarities.includes(skin['레어도'])); }
        
        renderPollList(filteredSkins);
    };
    
    // Event Listeners
    characterSearch.addEventListener('input', debounce(() => {
        const searchTerm = characterSearch.value.toLowerCase();
        const filteredData = allCharacterNamesData.filter(char => char.text.toLowerCase().includes(searchTerm));
        rebuildDropdown(characterNameSelect, filteredData);
    }, 250));

    skinNameSearch.addEventListener('input', debounce(() => {
        const searchTerm = skinNameSearch.value.toLowerCase();
        const selectedChar = characterNameSelect.value;
        let filteredData = allSkinNamesData;
        if (selectedChar !== 'all') {
            filteredData = filteredData.filter(skin => skin.charName === selectedChar);
        }
        filteredData = filteredData.filter(skin => skin.skinName.toLowerCase().includes(searchTerm));
        rebuildDropdown(skinNameSelect, filteredData.map(s => ({ value: s.skinName, text: s.skinName })));
    }, 250));

    characterNameSelect.addEventListener('change', () => {
        skinNameSearch.value = '';
        const selectedChar = characterNameSelect.value;
        let filteredSkins = (selectedChar === 'all') ? allSkinNamesData : allSkinNamesData.filter(skin => skin.charName === selectedChar);
        rebuildDropdown(skinNameSelect, filteredSkins.map(s => ({ value: s.skinName, text: s.skinName })));
        applyFilters();
    });
    
    // REMOVED tagSelect from this list
    [skinNameSelect, skinTypeSelect, factionSelect].forEach(el => el.addEventListener('change', applyFilters));
});