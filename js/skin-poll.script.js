document.addEventListener('DOMContentLoaded', () => {
    // --- Firebase Setup ---
    // PASTE YOUR FIREBASE CONFIG OBJECT HERE
    const firebaseConfig = {
        apiKey: "AIzaSyCmtsfkzlISZDd0totgv3MIrpT9kvLvKLk",
        authDomain: "azurlane-skin-vote.firebaseapp.com",
        projectId: "azurlane-skin-vote",
        storageBucket: "azurlane-skin-vote.firebasestorage.app",
        messagingSenderId: "282702723033",
        appId: "1:282702723033:web:a97b60cb7138bdbbbacbc8"
    };

    // Initialize Firebase and Firestore
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    const db = firebase.firestore();

    // --- Get HTML elements ---
    const pollContainer = document.getElementById('poll-container');
    const characterNameSearch = document.getElementById('character-name-search');
    const characterNameSelect = document.getElementById('character-name-select');
    const skinNameSearch = document.getElementById('skin-name-search');
    const skinNameSelect = document.getElementById('skin-name-select');
    const skinTypeSelect = document.getElementById('skin-type-select');
    const rarityCheckboxes = document.getElementById('rarity-checkboxes');
    const factionSelect = document.getElementById('faction-select');

    // --- State Variables ---
    let allSkins = [];
    let allCharacterNameOptions = [];
    let allSkinNameOptions = [];

    // --- Helper Functions ---
    const debounce = (func, delay) => { let timeoutId; return (...args) => { clearTimeout(timeoutId); timeoutId = setTimeout(() => { func.apply(this, args); }, delay); }; };

    // --- Data Loading ---
    fetch('data/subset_skin_data.json')
        .then(response => response.json())
        .then(jsonData => {
            allSkins = Object.keys(jsonData).map(key => ({ id: key, ...jsonData[key] }))
                .filter(skin => skin['깔끔한 일러'] && skin['스킨 태그'] && skin['스킨 태그'].includes('L2D'));
            
            populateInitialFilters();
            applyFilters();
        });

    // --- Filter Population and Logic ---
    const populateInitialFilters = () => {
        const characterNames = [...new Set(allSkins.map(s => s['함순이 이름']))].sort();
        characterNameSelect.innerHTML = '<option value="all">전체</option>';
        characterNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name; option.textContent = name;
            characterNameSelect.appendChild(option);
        });
        allCharacterNameOptions = Array.from(characterNameSelect.querySelectorAll('option'));

        const skinNames = allSkins.map(s => s['한글 함순이 + 스킨 이름']).sort();
        skinNameSelect.innerHTML = '<option value="all">전체</option>';
        skinNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name; option.textContent = name;
            skinNameSelect.appendChild(option);
        });
        allSkinNameOptions = Array.from(skinNameSelect.querySelectorAll('option'));

        const rarities = [...new Set(allSkins.map(s => s['레어도']))].filter(r => r).sort();
        rarityCheckboxes.innerHTML = '';
        rarities.forEach(rarity => {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox'; checkbox.value = rarity; checkbox.checked = true;
            checkbox.addEventListener('change', applyFilters);
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(` ${rarity}`));
            rarityCheckboxes.appendChild(label);
        });
    };

    const filterDropdownOptions = (input, options) => {
        const searchTerm = input.value.toLowerCase();
        options.forEach(option => {
            if (option.value === 'all') return;
            const optionText = option.textContent.toLowerCase();
            option.style.display = optionText.includes(searchTerm) ? '' : 'none';
        });
    };
    
    const cascadeSkinFilter = () => {
        const selectedChar = characterNameSelect.value;
        const skinSearchTerm = skinNameSearch.value.toLowerCase();
        
        allSkinNameOptions.forEach(option => {
            if (option.value === 'all') {
                option.style.display = '';
                return;
            };
            
            const skinData = allSkins.find(s => s['한글 함순이 + 스킨 이름'] === option.value);
            const matchesCharacter = (selectedChar === 'all' || (skinData && skinData['함순이 이름'] === selectedChar));
            const matchesSearch = option.textContent.toLowerCase().includes(skinSearchTerm);

            option.style.display = (matchesCharacter && matchesSearch) ? '' : 'none';
        });
    };

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
            fetchAndDisplayResults(skinId);
        });
    };

    const applyFilters = () => {
        const selectedCharName = characterNameSelect.value;
        const selectedSkinName = skinNameSelect.value;
        const selectedType = skinTypeSelect.value;
        const selectedFaction = factionSelect.value;
        const selectedRarities = [...rarityCheckboxes.querySelectorAll('input:checked')].map(cb => cb.value);
        let filteredSkins = allSkins;

        if (selectedCharName !== 'all') { filteredSkins = filteredSkins.filter(skin => skin['함순이 이름'] === selectedCharName); }
        if (selectedSkinName !== 'all') { filteredSkins = filteredSkins.filter(skin => skin['한글 함순이 + 스킨 이름'] === selectedSkinName); }
        if (selectedType !== 'all') { if (selectedType === '기본') { filteredSkins = filteredSkins.filter(skin => !skin['스킨 타입 - 한글']); } else { filteredSkins = filteredSkins.filter(skin => skin['스킨 타입 - 한글'] === selectedType); } }
        if (selectedFaction !== 'all') { filteredSkins = filteredSkins.filter(skin => skin['진영'] === selectedFaction); }
        if (selectedRarities.length > 0) { filteredSkins = filteredSkins.filter(skin => selectedRarities.includes(skin['레어도'])); }
        
        renderPollList(filteredSkins);
    };

    const submitVote = (skinId, rating, skinName, characterName) => {
        if (localStorage.getItem(`voted_${skinId}`) === 'true') return;
        const pollRef = db.collection('skin_polls').doc(String(skinId));
        return db.runTransaction(transaction => {
            return transaction.get(pollRef).then(doc => {
                let newTotalVotes = 1; let newTotalScore = rating;
                if (doc.exists) {
                    newTotalVotes = doc.data().total_votes + 1;
                    newTotalScore = doc.data().total_score + rating;
                }
                transaction.set(pollRef, { total_votes: newTotalVotes, total_score: newTotalScore, skin_name: skinName, character_name: characterName });
            });
        }).then(() => {
            localStorage.setItem(`voted_${skinId}`, 'true');
            const ratingArea = document.querySelector(`.star-rating[data-skin-id="${skinId}"]`).closest('.rating-area');
            if (ratingArea) {
                ratingArea.classList.add('voted');
                ratingArea.querySelectorAll('input').forEach(input => input.disabled = true);
            }
            fetchAndDisplayResults(skinId);
        }).catch(error => { console.error("Firebase transaction failed: ", error); });
    };

    const fetchAndDisplayResults = (skinId) => {
        const resultsEl = document.getElementById(`results-${skinId}`);
        if (!resultsEl) return;
        const pollRef = db.collection('skin_polls').doc(String(skinId));
        pollRef.get().then(doc => {
            if (doc.exists) {
                const data = doc.data();
                if (data.total_votes > 0) {
                    const average = (data.total_score / data.total_votes).toFixed(2);
                    resultsEl.textContent = `평균 점수: ${average} / 5 (${data.total_votes} 표)`;
                } else { resultsEl.textContent = "아직 투표가 없습니다."; }
            } else { resultsEl.textContent = "아직 투표가 없습니다."; }
        }).catch(error => {
            console.error("Error fetching poll results:", error);
            resultsEl.textContent = "결과를 불러올 수 없습니다.";
        });
    };

    // --- Event Listeners ---
    pollContainer.addEventListener('change', (event) => {
        if (event.target.matches('.star-rating input[type="radio"]')) {
            const starRatingDiv = event.target.closest('.star-rating');
            const skinId = starRatingDiv.dataset.skinId;
            const skinName = starRatingDiv.dataset.skinName;
            const characterName = starRatingDiv.dataset.characterName;
            const rating = parseInt(event.target.value, 10);
            submitVote(skinId, rating, skinName, characterName);
        }
    });

    characterNameSelect.addEventListener('change', () => {
        skinNameSearch.value = '';
        skinNameSelect.value = 'all';
        cascadeSkinFilter();
        applyFilters();
    });
    
    [skinNameSelect, skinTypeSelect, factionSelect].forEach(el => el.addEventListener('change', applyFilters));
    
    characterNameSearch.addEventListener('input', debounce(() => filterDropdownOptions(characterNameSearch, allCharacterNameOptions), 250));
    skinNameSearch.addEventListener('input', debounce(() => {
        cascadeSkinFilter();
        // Don't apply main filter while typing, let user select from the filtered list
    }, 250));
});