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


    // Initialize Firebase and Firestore
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

    // Fetch local skin data
    fetch('data/subset_skin_data.json')
        .then(response => response.json())
        .then(jsonData => {
            allSkins = jsonData;
            populateDropdowns(allSkins);
            displaySkins(allSkins);
        })
        .catch(error => console.error('Error loading skin data:', error));

    const populateDropdowns = (skins) => {
        const skinTypes = [...new Set(skins.map(skin => skin['스킨 타입 - 한글']))];
        skinTypes.sort();
        skinTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            skinTypeSelect.appendChild(option);
        });

        const characterNames = [...new Set(skins.map(skin => skin['함순이 이름']))];
        characterNames.sort();
        characterNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            characterNameSelect.appendChild(option);
        });

        const skinNames = [...new Set(skins.map(skin => skin['한글 함순이 + 스킨 이름']))];
        skinNames.sort();
        skinNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            skinNameSelect.appendChild(option);
        });
    };

    const displaySkins = (skins) => {
        pollContainer.innerHTML = ''; // Clear existing content
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
        const selectedSkinType = skinTypeSelect.value;
        const selectedRarities = [...rarityCheckboxes.querySelectorAll('input:checked')].map(el => el.value);
        const selectedFaction = factionSelect.value;
        const selectedSkinTag = skinTagSelect.value;
        const selectedCharacterName = characterNameSelect.value;
        const selectedSkinName = skinNameSelect.value;

        const filteredSkins = allSkins.filter(skin => {
            const skinTypeMatch = selectedSkinType === 'All' || skin['스킨 타입 - 한글'] === selectedSkinType;
            const rarityMatch = selectedRarities.length === 0 || selectedRarities.includes(skin['레어도']);
            const factionMatch = selectedFaction === 'All' || skin['진영'] === selectedFaction;
            const skinTagMatch = selectedSkinTag === 'All' || skin['스킨 태그'] === selectedSkinTag;
            const characterNameMatch = selectedCharacterName === 'All' || skin['함순이 이름'] === selectedCharacterName;
            const skinNameMatch = selectedSkinName === 'All' || skin['한글 함순이 + 스킨 이름'] === selectedSkinName;
            return skinTypeMatch && rarityMatch && factionMatch && skinTagMatch && characterNameMatch && skinNameMatch;
        });

        displaySkins(filteredSkins);
    };

    const submitVote = (skinId, rating, skinName, characterName) => {
        const skinRef = db.collection('skins-poll').doc(skinId.toString());
        db.runTransaction((transaction) => {
            return transaction.get(skinRef).then((skinDoc) => {
                if (!skinDoc.exists) {
                    transaction.set(skinRef, { 
                        total_score: rating, 
                        total_votes: 1,
                        skin_name: skinName,
                        character_name: characterName
                    });
                } else {
                    const newTotalScore = skinDoc.data().total_score + rating;
                    const newTotalVotes = skinDoc.data().total_votes + 1;
                    transaction.update(skinRef, { 
                        total_score: newTotalScore, 
                        total_votes: newTotalVotes 
                    });
                }
            });
        }).then(() => {
            console.log("Vote successfully submitted!");
            fetchPollResults(skinId); // Re-fetch to show updated results
        }).catch((error) => {
            console.error("Transaction failed: ", error);
        });
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

    // Event listener for voting
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

    // Attach event listeners to filters
    [skinTypeSelect, factionSelect, skinTagSelect, characterNameSelect, skinNameSelect].forEach(el => el.addEventListener('change', applyFilters));
    rarityCheckboxes.addEventListener('change', applyFilters);
});