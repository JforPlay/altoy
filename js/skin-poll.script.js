document.addEventListener('DOMContentLoaded', () => {
    // --- Firebase Setup ---
    const firebaseConfig = {
        apiKey: "AIzaSyCmtsfkzlISZDd0totgv3MIrpT9kvLvKLk",
        authDomain: "azurlane-skin-vote.firebaseapp.com",
        projectId: "azurlane-skin-vote",
        storageBucket: "azurlane-skin-vote.appspot.com",
        messagingSenderId: "282702723033",
        appId: "1:282702723033:web:a97b60cb7138bdbbbacbc8"
    };

    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    const db = firebase.firestore();

    // --- Get HTML elements ---
    const pollContainer = document.getElementById('poll-container');
    const characterNameSearch = document.getElementById('character-name-search');
    const characterNameSelect = document.getElementById('character-name-select');
    const skinTypeSelect = document.getElementById('skin-type-select');
    const rarityCheckboxes = document.getElementById('rarity-checkboxes');
    const factionSelect = document.getElementById('faction-select');
    const tagSelect = document.getElementById('tag-select');

    // --- State Variables ---
    let allSkins = [];
    let allCharacterNamesData = [];

    const debounce = (func, delay) => { let timeoutId; return (...args) => { clearTimeout(timeoutId); timeoutId = setTimeout(() => { func.apply(this, args); }, delay); }; };

    fetch('data/subset_skin_data.json')
        .then(response => response.json())
        .then(jsonData => {
            allSkins = Object.keys(jsonData).map(key => ({ id: key, ...jsonData[key] }));
            populateInitialFilters();
            tagSelect.value = 'L2D';
            applyFilters();
            renderPollList(filteredSkins);
        });

    const populateInitialFilters = () => {
        allCharacterNamesData = [...new Set(allSkins.map(s => s['함순이 이름']))].filter(Boolean).sort().map(name => ({ value: name, text: name }));
        rebuildDropdown(characterNameSelect, allCharacterNamesData);
        
        rarityCheckboxes.querySelectorAll('input').forEach(checkbox => {
            checkbox.addEventListener('change', applyFilters);
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
                <img src="${skin['깔끔한 일러']}" class="poll-image" loading="lazy">
                <div class="poll-info">
                    <div class="character-name">${skin['함순이 이름']}</div>
                    <h3>${skin['한글 함순이 + 스킨 이름']}</h3>
                    <div class="info-line"><strong>타입:</strong> ${skin['스킨 타입 - 한글'] || '기본'}</div>
                    <div class="info-line"><strong>태그:</strong> ${skin['스킨 태그'] || '없음'}</div>
                    <div class="info-line"><strong>레어도:</strong> ${skin['레어도'] || '없음'}</div>
                    <div class="rating-area ${hasVoted ? 'voted' : ''}">
                        <div class="star-rating" data-skin-id="${skinId}" data-skin-name="${skin['한글 함순이 + 스킨 이름']}" data-character-name="${skin['함순이 이름']}">
                            <input type="radio" id="star5-${skinId}" name="rating-${skinId}" value="5" ${hasVoted ? 'disabled' : ''}><label for="star5-${skinId}">★</label>
                            <input type="radio" id="star4-${skinId}" name="rating-${skinId}" value="4" ${hasVoted ? 'disabled' : ''}><label for="star4-${skinId}">★</label>
                            <input type="radio" id="star3-${skinId}" name="rating-${skinId}" value="3" ${hasVoted ? 'disabled' : ''}><label for="star3-${skinId}">★</label>
                            <input type="radio" id="star2-${skinId}" name="rating-${skinId}" value="2" ${hasVoted ? 'disabled' : ''}><label for="star2-${skinId}">★</label>
                            <input type="radio" id="star1-${skinId}" name="rating-${skinId}" value="1" ${hasVoted ? 'disabled' : ''}><label for="star1-${skinId}">★</label>
                        </div>
                        <div class="poll-results" id="results-${skinId}">
                            결과 불러오는 중...
                        </div>
                    </div>
                </div>
            `;
            pollContainer.appendChild(pollBox);
            fetchAndDisplayResults(skinId);
        });
    };

    const applyFilters = () => {
        const selectedCharName = characterNameSelect.value;
        const selectedType = skinTypeSelect.value;
        const selectedFaction = factionSelect.value;
        const selectedTag = tagSelect.value;
        const selectedRarities = [...rarityCheckboxes.querySelectorAll('input:checked')].map(cb => cb.value);
        let filteredSkins = allSkins;

        if (selectedCharName !== 'all') { filteredSkins = filteredSkins.filter(skin => skin['함순이 이름'] === selectedCharName); }
        if (selectedType !== 'all') { if (selectedType === '기본') { filteredSkins = filteredSkins.filter(skin => !skin['스킨 타입 - 한글']); } else { filteredSkins = filteredSkins.filter(skin => skin['스킨 타입 - 한글'] === selectedType); } }
        if (selectedFaction !== 'all') { filteredSkins = filteredSkins.filter(skin => skin['진영'] === selectedFaction); }
        if (selectedTag !== 'all') { filteredSkins = filteredSkins.filter(skin => skin['스킨 태그'] && skin['스킨 태그'].includes(selectedTag));}
        if (selectedRarities.length > 0) { filteredSkins = filteredSkins.filter(skin => selectedRarities.includes(skin['레어도'])); }
        
        renderPollList(filteredSkins);
    };

    // --- Firebase Logic ---
    const submitVote = (skinId, rating, skinName, characterName) => {
        if (localStorage.getItem(`voted_${skinId}`) === 'true') {
            console.log("해당 스킨에 이미 투표하셨습니다.");
            return;
        }

        const pollRef = db.collection('skin_polls').doc(String(skinId));

        return db.runTransaction(transaction => {
            return transaction.get(pollRef).then(doc => {
                let newTotalVotes = 1;
                let newTotalScore = rating;

                if (doc.exists) {
                    newTotalVotes = doc.data().total_votes + 1;
                    newTotalScore = doc.data().total_score + rating;
                }
                
                transaction.set(pollRef, { 
                    total_votes: newTotalVotes, 
                    total_score: newTotalScore,
                    skin_name: skinName,
                    character_name: characterName
                });
            });
        }).then(() => {
            localStorage.setItem(`voted_${skinId}`, 'true');
            const ratingArea = document.querySelector(`.star-rating[data-skin-id="${skinId}"]`).closest('.rating-area');
            if (ratingArea) {
                ratingArea.classList.add('voted');
                ratingArea.querySelectorAll('input').forEach(input => input.disabled = true);
            }
            fetchAndDisplayResults(skinId);
        }).catch(error => {
            console.error("Firebase transaction failed: ", error);
        });
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

    characterNameSearch.addEventListener('input', debounce(() => {
        rebuildDropdown(characterNameSelect, allCharacterNamesData.filter(char => char.text.toLowerCase().includes(characterNameSearch.value.toLowerCase())));
    }, 250));

    // --- THIS IS THE FIX ---
    // The call to applyFilters() was missing from this event listener.
    characterNameSelect.addEventListener('change', () => {
        applyFilters();
    });
    
    [skinTypeSelect, factionSelect, tagSelect].forEach(el => el.addEventListener('change', applyFilters));
});