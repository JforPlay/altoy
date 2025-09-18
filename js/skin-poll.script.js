document.addEventListener('DOMContentLoaded', () => {
    // --- Firebase Setup ---
    const firebaseConfig = {
        apiKey: "AIzaSyCmtsfkzlISZDd0totgv3MIrpT9kvLvKLk",
        authDomain: "azurlane-skin-vote.firebaseapp.com",
        projectId: "azurlane-skin-vote",
        storageBucket: "azurlane-skin-vote.firebasestorage.app",
        messagingSenderId: "282702723033",
        appId: "1:282702723033:web:a97b60cb7138bdbbbacbc8"
    };

    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    const db = firebase.firestore();

    // --- Get HTML elements ---
    const pollContainer = document.getElementById('poll-container');
    const skinTypeSelect = document.getElementById('skin-type-select');
    const rarityCheckboxes = document.getElementById('rarity-checkboxes');
    const factionSelect = document.getElementById('faction-select');
    const skinTagSelect = document.getElementById('skin-tag-select');
    const characterNameSelect = document.getElementById('character-name-select');
    const skinNameSelect = document.getElementById('skin-name-select');
    
    let allSkins = [];
    let characterNameChoices, skinNameChoices, skinTypeChoices, factionChoices, skinTagChoices;

    const defaultChoicesConfig = {
        searchEnabled: true,
        removeItemButton: false,
        itemSelectText: '',
    };

    // Fetch local skin data
    fetch('data/subset_skin_data.json')
        .then(response => response.json())
        .then(jsonData => {
            allSkins = jsonData;
            initializeFilters(allSkins);
            displaySkins(allSkins);
        })
        .catch(error => console.error('Error loading skin data:', error));
    
    const initializeFilters = (skins) => {
        // --- Populate and Initialize Choices.js for each dropdown ---

        // Character Name
        const characterNames = [{ value: '전체', label: '전체' }, ...[...new Set(skins.map(skin => skin['함순이 이름']))].sort().map(name => ({ value: name, label: name }))];
        characterNameChoices = new Choices(characterNameSelect, { ...defaultChoicesConfig, placeholder: true });
        characterNameChoices.setChoices(characterNames, 'value', 'label', true);

        // Skin Name
        const skinNames = [{ value: '전체', label: '전체' }, ...[...new Set(skins.map(skin => skin['한글 함순이 + 스킨 이름']))].sort().map(name => ({ value: name, label: name }))];
        skinNameChoices = new Choices(skinNameSelect, { ...defaultChoicesConfig, placeholder: true });
        skinNameChoices.setChoices(skinNames, 'value', 'label', true);
        
        // Skin Type (with custom order)
        const customSkinTypeOrder = [
            "전체", "크리스마스", "정월", "이스트 글림 스타일", "학교", "수영복", "파티", "할로윈", "사복", "여름 축제", 
            "Live", "특수 훈련", "스포츠", "극속광열", "병원", "카니발", "메이드 타임", "블러드 문", "동화 속 세계", "홈웨어",
            "댄스", "온천 타임", "오피스 타임", "이세계 모험", "웨스턴", "이집트 스타일", "기본", "개조", "서약", "기타"
        ];
        const skinTypes = customSkinTypeOrder.map(type => ({ value: type, label: type }));
        skinTypeChoices = new Choices(skinTypeSelect, { ...defaultChoicesConfig, searchEnabled: false });
        skinTypeChoices.setChoices(skinTypes, 'value', 'label', true);


        // Faction
        const factions = [{ value: '전체', label: '전체' }, ...[...new Set(skins.map(skin => skin['진영']))].sort().map(fac => ({ value: fac, label: fac }))];
        factionChoices = new Choices(factionSelect, { ...defaultChoicesConfig, searchEnabled: false });
        factionChoices.setChoices(factions, 'value', 'label', true);

        // Skin Tag
        skinTagChoices = new Choices(skinTagSelect, { ...defaultChoicesConfig, searchEnabled: false });
        // Set 'All' value to '전체' for consistency
        skinTagChoices.setChoices([
            { value: '전체', label: '전체' },
            { value: 'L2D+', label: 'L2D+' },
            { value: 'L2D', label: 'L2D' },
            { value: '쁘띠모션', label: '쁘띠모션' },
            { value: 'X', label: 'X' },
        ], 'value', 'label', true);


        // --- Add Event Listeners ---
        characterNameSelect.addEventListener('change', handleCharacterChange);
        [skinNameSelect, skinTypeSelect, factionSelect, skinTagSelect].forEach(el => el.addEventListener('change', applyFilters));
        rarityCheckboxes.addEventListener('change', applyFilters);
    };

    const handleCharacterChange = () => {
        const selectedCharacter = characterNameChoices.getValue(true);
        
        let relevantSkins = [];
        if (selectedCharacter === '전체' || !selectedCharacter) {
            relevantSkins = allSkins;
        } else {
            relevantSkins = allSkins.filter(skin => skin['함순이 이름'] === selectedCharacter);
        }
        
        const skinNameOptions = [{ value: '전체', label: '전체' }, ...[...new Set(relevantSkins.map(skin => skin['한글 함순이 + 스킨 이름']))].sort().map(name => ({ value: name, label: name }))];
        
        skinNameChoices.clearStore();
        skinNameChoices.setChoices(skinNameOptions, 'value', 'label', true);

        applyFilters();
    };

    const displaySkins = (skins) => {
        pollContainer.innerHTML = '';
        skins.forEach(skin => {
            const pollItem = document.createElement('div');
            pollItem.className = 'poll-item';
            pollItem.innerHTML = `
                <img src="${skin['깔끔한 일러']}" alt="${skin['한글 함순이 + 스킨 이름']}" loading="lazy">
                <div class="poll-info">
                    <h3>${skin['한글 함순이 + 스킨 이름']}</h3>
                    <p class="character-name">${skin['함순이 이름']}</p>
                    <p class="info-line">타입: ${skin['스킨 타입 - 한글']} | 레어: ${skin['레어도']} | 진영: ${skin['진영']}</p>
                    <div class="rating-area">
                         <div class="star-rating" data-skin-id="${skin['클뜯 id']}" data-skin-name="${skin['한글 함순이 + 스킨 이름']}" data-character-name="${skin['함순이 이름']}">
                            <input type="radio" id="5-stars-${skin['클뜯 id']}" name="rating-${skin['클뜯 id']}" value="5" /><label for="5-stars-${skin['클뜯 id']}">&#9733;</label>
                            <input type="radio" id="4-stars-${skin['클뜯 id']}" name="rating-${skin['클뜯 id']}" value="4" /><label for="4-stars-${skin['클뜯 id']}">&#9733;</label>
                            <input type="radio" id="3-stars-${skin['클뜯 id']}" name="rating-${skin['클뜯 id']}" value="3" /><label for="3-stars-${skin['클뜯 id']}">&#9733;</label>
                            <input type="radio" id="2-stars-${skin['클뜯 id']}" name="rating-${skin['클뜯 id']}" value="2" /><label for="2-stars-${skin['클뜯 id']}">&#9733;</label>
                            <input type="radio" id="1-star-${skin['클뜯 id']}" name="rating-${skin['클뜯 id']}" value="1" /><label for="1-star-${skin['클뜯 id']}">&#9733;</label>
                        </div>
                        <p class="poll-results" id="results-${skin['클뜯 id']}">Loading results...</p>
                    </div>
                </div>
            `;
            pollContainer.appendChild(pollItem);
            fetchPollResults(skin['클뜯 id']);
        });
    };

    const applyFilters = () => {
        const selectedCharacterName = characterNameChoices.getValue(true);
        const selectedSkinName = skinNameChoices.getValue(true);
        const selectedSkinType = skinTypeChoices.getValue(true);
        const selectedFaction = factionChoices.getValue(true);
        const selectedSkinTag = skinTagChoices.getValue(true);
        const selectedRarities = [...rarityCheckboxes.querySelectorAll('input:checked')].map(el => el.value);

        const filteredSkins = allSkins.filter(skin => {
            const characterNameMatch = selectedCharacterName === '전체' || !selectedCharacterName || skin['함순이 이름'] === selectedCharacterName;
            const skinNameMatch = selectedSkinName === '전체' || !selectedSkinName || skin['한글 함순이 + 스킨 이름'] === selectedSkinName;
            const skinTypeMatch = selectedSkinType === '전체' || !selectedSkinType || skin['스킨 타입 - 한글'] === selectedSkinType;
            const factionMatch = selectedFaction === '전체' || !selectedFaction || skin['진영'] === selectedFaction;
            const skinTagMatch = selectedSkinTag === '전체' || !selectedSkinTag || skin['스킨 태그'] === selectedSkinTag;
            const rarityMatch = selectedRarities.length === 0 || selectedRarities.includes(skin['레어도']);
            
            return characterNameMatch && skinNameMatch && skinTypeMatch && rarityMatch && factionMatch && skinTagMatch;
        });

        displaySkins(filteredSkins);
    };

    // --- Firebase and Voting Functions (No changes needed here) ---

    const submitVote = (skinId, rating, skinName, characterName) => {
        const skinRef = db.collection('skins-poll').doc(skinId.toString());
        db.runTransaction((transaction) => {
            return transaction.get(skinRef).then((skinDoc) => {
                if (!skinDoc.exists) {
                    transaction.set(skinRef, { total_score: rating, total_votes: 1, skin_name: skinName, character_name: characterName });
                } else {
                    const newTotalScore = skinDoc.data().total_score + rating;
                    const newTotalVotes = skinDoc.data().total_votes + 1;
                    transaction.update(skinRef, { total_score: newTotalScore, total_votes: newTotalVotes });
                }
            });
        }).then(() => {
            console.log("Vote successfully submitted!");
            fetchPollResults(skinId);
        }).catch((error) => console.error("Transaction failed: ", error));
    };
    
    const fetchPollResults = (skinId) => {
        const resultsEl = document.getElementById(`results-${skinId}`);
        if (!resultsEl) return;
        db.collection('skins-poll').doc(skinId.toString()).get().then(doc => {
            if (doc.exists) {
                const data = doc.data();
                if (data.total_votes > 0) {
                    const average = (data.total_score / data.total_votes).toFixed(2);
                    resultsEl.textContent = `평균 점수: ${average} / 5 (${data.total_votes} 표)`;
                } else {
                     resultsEl.textContent = "아직 투표가 없습니다.";
                }
            } else {
                resultsEl.textContent = "아직 투표가 없습니다.";
            }
        }).catch(error => {
            console.error("Error fetching poll results:", error);
            resultsEl.textContent = "결과를 불러올 수 없습니다.";
        });
    };

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
});