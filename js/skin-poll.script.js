// FINAL VERSION with Firebase Integration
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

    // Initialize Firebase
    firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();

    // --- Get HTML elements ---
    const pollContainer = document.getElementById('poll-container');
    let allSkins = [];

    fetch('data/subset_skin_data.json')
        .then(response => response.json())
        .then(jsonData => {
            allSkins = Object.values(jsonData).filter(skin => skin['깔끔한 일러'] && skin['스킨 태그'] && skin['스킨 태그'].includes('L2D'));
            renderPollList(allSkins);
        });

    const renderPollList = (skinsToRender) => {
        pollContainer.innerHTML = '';
        skinsToRender.forEach(skin => {
            const skinId = skin['스킨 ID'];
            const pollBox = document.createElement('div');
            pollBox.className = 'poll-box';
            const hasVoted = localStorage.getItem(`voted_${skinId}`) === 'true';

            pollBox.innerHTML = `...`; // Same as Part 1 JS
            pollContainer.appendChild(pollBox);

            // Fetch and display poll results for this skin
            updatePollResults(skinId);
        });
    };

    // --- Firebase Logic ---
    const submitVote = (skinId, rating) => {
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
            // Disable voting UI and update results
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

    // Add a single event listener to the container for efficiency
    pollContainer.addEventListener('click', (event) => {
        if (event.target.matches('.star-rating input[type="radio"]')) {
            const skinId = event.target.closest('.star-rating').dataset.skinId;
            const rating = parseInt(event.target.value, 10);
            submitVote(skinId, rating);
        }
    });
});