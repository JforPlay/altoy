document.addEventListener("DOMContentLoaded", () => {
    // Firebase Configuration
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

    // Get HTML elements
    const leaderboardContainer = document.getElementById('homepage-leaderboard');
    const mostVotedContainer = document.getElementById('homepage-most-voted');
    const totalVotesEl = document.getElementById('homepage-total-votes');
    const currentDateEl = document.getElementById('current-date');

    // --- Main function to initialize all stats ---
    const initializeHomepageStats = async () => {
        // Set date immediately
        const today = new Date();
        currentDateEl.textContent = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        try {
            // Fetch local skin data and Firebase data concurrently
            const [skinDataResponse, top10Snapshot, mostVotedSnapshot, totalVotesDoc] = await Promise.all([
                fetch('data/shipgirl_data.json').then(res => res.json()),
                db.collection("skin_polls").orderBy("average_score", "desc").limit(10).get(),
                db.collection("skin_polls").orderBy("total_votes", "desc").limit(10).get(),
                db.collection("stats").doc("total_votes_counter").get()
            ]);

            // Create a quick lookup map for skin icons by name
            const skinIconMap = new Map();
            for (const id in skinDataResponse) {
                skinIconMap.set(skinDataResponse[id].name.trim(), skinDataResponse[id].icon);
            }

            // Render the data
            renderLeaderboard(leaderboardContainer, top10Snapshot, skinIconMap, 'score');
            renderLeaderboard(mostVotedContainer, mostVotedSnapshot, skinIconMap, 'votes');
            renderTotalVotes(totalVotesEl, totalVotesDoc);

        } catch (error) {
            console.error("Error initializing homepage stats:", error);
            leaderboardContainer.innerHTML = '<li>데이터를 불러오는 데 실패했습니다.</li>';
            mostVotedContainer.innerHTML = '<li>데이터를 불러오는 데 실패했습니다.</li>';
            totalVotesEl.textContent = 'N/A';
        }
    };

    // --- Helper rendering functions ---
    const renderLeaderboard = (container, snapshot, iconMap, type) => {
        if (!container) return;
        if (snapshot.empty) {
            container.innerHTML = '<li>데이터가 없습니다.</li>';
            return;
        }

        let rank = 1;
        container.innerHTML = snapshot.docs.map(doc => {
            const skin = doc.data();
            const skinName = skin.skin_name || 'Unknown Skin';
            const iconUrl = iconMap.get(skinName.trim());
            const displayValue = type === 'score'
                ? `★ ${skin.average_score.toFixed(2)}`
                : `${(skin.total_votes || 0).toLocaleString()} 표`;

            return `
                <li class="leaderboard-item-home">
                    <span class="rank">#${rank++}</span>
                    ${iconUrl ? `<img src="${iconUrl}" class="leaderboard-icon" alt="${skinName}" loading="lazy">` : '<div class="leaderboard-icon-placeholder"></div>'}
                    <span class="name">${skinName}</span>
                    <span class="score">${displayValue}</span>
                </li>
            `;
        }).join('');
    };

    const renderTotalVotes = (element, doc) => {
        if (!element) return;
        if (doc.exists) {
            element.textContent = (doc.data().count || 0).toLocaleString();
        } else {
            element.textContent = '0';
        }
    };

    // Run the main function
    initializeHomepageStats();
});