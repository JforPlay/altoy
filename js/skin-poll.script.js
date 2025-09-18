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
    // Check if Firebase is already initialized to avoid errors
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    const db = firebase.firestore();

    // --- Get HTML elements ---
    const pollContainer = document.getElementById('poll-container');
    const skinTypeSelect = document.getElementById('skin-type-select');
    const rarityCheckboxes = document.getElementById('rarity-checkboxes');
    const factionSelect = document.getElementById('faction-select');
    
    let allSkins = [];

    // Fetch local skin data
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
                    <div class="rating-area ${hasVoted ? 'voted' : ''}">
                        <div class="star-rating" data-skin-id="${skinId}" data-skin-name="${skin['한글 함순이 + 스킨 이름']}" data-character-name="${skin['함순이 이름']}">
                            <input type="radio" id="star5-${skinId}" name="rating-${skinId}" value="5" ${hasVoted ? 'disabled' : ''}><label for="star5-${skinId}">★</label>
                            <input type="radio" id="star4-${skinId}" name="rating-${skinId}" value="4" ${hasVoted ? 'disabled' : ''}><label for="star4-${skinId}">★</label>
                            <input type="radio" id="star3-${skinId}" name="rating-${skinId}" value="3" ${hasVoted ? 'disabled' : ''}><label for="star3-${skinId}">★</label>
                            <input type="radio" id="star2-${skinId}" name="rating-${skinId}" value="2" ${hasVoted ? 'disabled' : ''}><label for="star2-${skinId}">★</label>
                            <input type="radio" id="star1-${skinId}" name="rating-${skinId}" value="1" ${hasVoted ? 'disabled' : ''}><label for="star1-${skinId}">★</label>
                        </div>
                        <div class="poll-results" id="results-${skinId}">
                            Loading results...
                        </div>
                    </div>
                </div>
            `;
            pollContainer.appendChild(pollBox);
            fetchAndDisplayResults(skinId);
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


    // --- Firebase Logic ---
    const submitVote = (skinId, rating, skinName) => {
        if (localStorage.getItem(`voted_${skinId}`) === 'true') return;

        const pollRef = db.collection('skin_polls').doc(String(skinId));

        db.runTransaction(transaction => {
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
    [skinTypeSelect, factionSelect].forEach(el => el.addEventListener('change', applyFilters));
    rarityCheckboxes.querySelectorAll('input').forEach(cb => cb.addEventListener('change', applyFilters));
});