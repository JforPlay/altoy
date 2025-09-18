// FINAL VERSION with Firebase Integration and Bug Fixes
document.addEventListener('DOMContentLoaded', () => {
    // --- Firebase Setup ---
    // PASTE YOUR FIREBASE CONFIG OBJECT HERE
    // Example:
    const firebaseConfig = {
        apiKey: "AIzaSyCmtsfkzlISZDd0totgv3MIrpT9kvLvKLk",
        authDomain: "azurlane-skin-vote.firebaseapp.com",
        projectId: "azurlane-skin-vote",
        storageBucket: "azurlane-skin-vote.firebasestorage.app",
        messagingSenderId: "282702723033",
        appId: "1:282702723033:web:a97b60cb7138bdbbbacbc8"
    };

    // Uncomment the lines below and paste your config above when ready
    firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();

    // --- Get HTML elements ---
    const pollContainer = document.getElementById('poll-container');
    // Note: The filter elements are not used in this version but are kept for future use.

    let allSkins = [];

    fetch('data/subset_skin_data.json')
        .then(response => response.json())
        .then(jsonData => {
            // --- THIS IS THE FIX ---
            // Convert the JSON object to an array, making sure to keep the unique ID for each skin.
            allSkins = Object.keys(jsonData).map(key => {
                return {
                    id: key, // The key (e.g., "10600010") is the unique ID
                    ...jsonData[key]
                };
            }).filter(skin => {
                // Pre-filter the list to only include skins with an L2D tag and an image
                return skin['깔끔한 일러'] && skin['스킨 태그'] && skin['스킨 태그'].includes('L2D');
            });
            
            renderPollList(allSkins);
        });

    const renderPollList = (skinsToRender) => {
        pollContainer.innerHTML = '';
        skinsToRender.forEach(skin => {
            const skinId = skin.id; // Use the 'id' property we added
            const pollBox = document.createElement('div');
            pollBox.className = 'poll-box';
            const hasVoted = localStorage.getItem(`voted_${skinId}`) === 'true';

            pollBox.innerHTML = `
                <img src="${skin['깔끔한 일러']}" class="poll-image" loading="lazy">
                <div class="poll-info">
                    <h3>${skin['한글 함순이 + 스킨 이름']}</h3>
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

            // Fetch and display poll results for this skin (will work after Firebase is connected)
            // updatePollResults(skinId);
        });
    };

    // --- Firebase Logic (uncomment and use after setup) ---
    const submitVote = (skinId, rating) => {
        if (!window.db) { console.error("Firebase not initialized"); return; }
        if (localStorage.getItem(`voted_${skinId}`) === 'true') {
            console.log("You have already voted for this skin.");
            return;
        }

        const pollRef = db.collection('skin_polls').doc(String(skinId));
        db.runTransaction(transaction => {
            return transaction.get(pollRef).then(doc => {
                let newTotalVotes = 1;
                let newTotalScore = rating;

                if (doc.exists) {
                    newTotalVotes = doc.data().total_votes + 1;
                    newTotalScore = doc.data().total_score + rating;
                }
                
                transaction.set(pollRef, { total_votes: newTotalVotes, total_score: newTotalScore });
            });
        }).then(() => {
            console.log("Vote submitted successfully!");
            localStorage.setItem(`voted_${skinId}`, 'true');
            const ratingArea = document.querySelector(`.star-rating[data-skin-id="${skinId}"]`).closest('.rating-area');
            if (ratingArea) {
                ratingArea.classList.add('voted');
                ratingArea.querySelectorAll('input').forEach(input => input.disabled = true);
            }
            updatePollResults(skinId);
        }).catch(error => {
            console.error("Transaction failed: ", error);
        });
    };

    const updatePollResults = (skinId) => {
        if (!window.db) { console.error("Firebase not initialized"); return; }
        const resultsEl = document.getElementById(`results-${skinId}`);
        const pollRef = db.collection('skin_polls').doc(String(skinId));

        pollRef.get().then(doc => {
            if (doc.exists) {
                const data = doc.data();
                const average = (data.total_score / data.total_votes).toFixed(2);
                resultsEl.textContent = `평균 점수: ${average} / 5 (${data.total_votes} 표)`;
            } else {
                resultsEl.textContent = "아직 투표가 없습니다.";
            }
        });
    };

    pollContainer.addEventListener('click', (event) => {
        if (event.target.matches('.star-rating input[type="radio"]')) {
            const skinId = event.target.closest('.star-rating').dataset.skinId;
            const rating = parseInt(event.target.value, 10);
            submitVote(skinId, rating);
        }
    });

});