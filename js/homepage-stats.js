document.addEventListener("DOMContentLoaded", () => {
    // 1. Firebase Configuration (no changes here)
    const firebaseConfig = {
        apiKey: "AIzaSyCmtsfkzlISZDd0totgv3MIrpT9kvLvKLk",
        authDomain: "azurlane-skin-vote.firebaseapp.com",
        projectId: "azurlane-skin-vote",
        storageBucket: "azurlane-skin-vote.firebasestorage.app",
        messagingSenderId: "282702723033",
        appId: "1:282702723033:web:a97b60cb7138bdbbbacbc8",
    };
    if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
    const db = firebase.firestore();

    // 2. Get HTML elements (add the new container)
    const leaderboardContainer = document.getElementById('homepage-leaderboard');
    const mostVotedContainer = document.getElementById('homepage-most-voted'); // <-- Add this
    const totalVotesEl = document.getElementById('homepage-total-votes');

    // 3. Function to fetch Top 10 (no changes here)
    const fetchTop10 = async () => { /* ... your existing function ... */ };

    // 4. Add this new function to fetch the most voted skins
    const fetchMostVoted = async () => {
        if (!mostVotedContainer) return;
        try {
            const query = db.collection("skin_polls")
                .orderBy("total_votes", "desc") // Order by total votes
                .limit(10);

            const snapshot = await query.get();
            if (snapshot.empty) {
                mostVotedContainer.innerHTML = '<li>데이터가 없습니다.</li>';
                return;
            }

            let rank = 1;
            let leaderboardHtml = '';
            snapshot.forEach(doc => {
                const skin = doc.data();
                leaderboardHtml += `
                    <li class="leaderboard-item-home">
                        <span class="rank">#${rank++}</span>
                        <span class="name">${skin.skin_name || 'Unknown Skin'}</span>
                        <span class="score">${(skin.total_votes || 0).toLocaleString()} 표</span>
                    </li>
                `;
            });
            mostVotedContainer.innerHTML = leaderboardHtml;
        } catch (error) {
            console.error("Error fetching most voted:", error);
            mostVotedContainer.innerHTML = '<li>데이터를 불러오는 데 실패했습니다.</li>';
        }
    };

    // 5. Function to fetch total votes (no changes here)
    const fetchTotalVotes = async () => { /* ... your existing function ... */ };

    // 6. Run all the functions
    fetchTop10();
    fetchMostVoted(); // <-- Call the new function
    fetchTotalVotes();
});