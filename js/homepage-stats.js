document.addEventListener("DOMContentLoaded", () => {
    // 1. Firebase Configuration
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

    // 2. Get HTML elements
    const leaderboardContainer = document.getElementById('homepage-leaderboard');
    const mostVotedContainer = document.getElementById('homepage-most-voted');
    const totalVotesEl = document.getElementById('homepage-total-votes');
    const currentDateEl = document.getElementById('current-date');

    // 3. Main function to initialize all stats
    const initializeHomepageStats = async () => {
        if (currentDateEl) {
            const today = new Date();
            currentDateEl.textContent = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        }

        try {
            const [skinDataResponse, top10Snapshot, mostVotedSnapshot, totalVotesDoc] = await Promise.all([
                fetch('data/shipgirl_data.json').then(res => res.json()),
                db.collection("skin_polls").orderBy("average_score", "desc").limit(10).get(),
                db.collection("skin_polls").orderBy("total_votes", "desc").limit(10).get(),
                db.collection("stats").doc("total_votes_counter").get()
            ]);

            const skinIconMap = new Map();
            for (const id in skinDataResponse) {
                const skin = skinDataResponse[id];
                if (skin && skin.name) {
                    skinIconMap.set(skin.name.trim(), skin.icon);
                }
            }

            renderLeaderboard(leaderboardContainer, top10Snapshot, skinIconMap, 'score');
            renderLeaderboard(mostVotedContainer, mostVotedSnapshot, skinIconMap, 'votes');
            renderTotalVotes(totalVotesEl, totalVotesDoc);

        } catch (error) {
            console.error("Error initializing homepage stats:", error);
            if (leaderboardContainer) leaderboardContainer.innerHTML = '<li>데이터를 불러오는 데 실패했습니다.</li>';
            if (mostVotedContainer) mostVotedContainer.innerHTML = '<li>데이터를 불러오는 데 실패했습니다.</li>';
            if (totalVotesEl) totalVotesEl.textContent = 'N/A';
        }
    };

    // 4. Helper rendering functions
    const renderLeaderboard = (container, skins, iconMap, type) => {
        if (!container) return;
        if (!skins || skins.length === 0) {
            container.innerHTML = '<li>데이터가 없습니다.</li>';
            return;
        }

        // Helper to get the display for the rank
        const getRankDisplay = (rank) => {
            if (rank === 1) return '<span class="rank rank-1">🏆</span>';
            if (rank === 2) return '<span class="rank rank-2">🥈</span>';
            if (rank === 3) return '<span class="rank rank-3">🥉</span>';
            return `<span class="rank">#${rank}</span>`;
        };

        container.innerHTML = skins.map((skin, index) => {
            const rank = index + 1;
            const skinName = skin.skin_name || 'Unknown Skin';
            const iconUrl = iconMap.get(skinName.trim());
            const displayValue = type === 'score'
                ? `★ ${(skin.average_score || 0).toFixed(2)}`
                : `${(skin.total_votes || 0).toLocaleString()} 표`;

            return `
            <li class="leaderboard-item-home">
                ${getRankDisplay(rank)}
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

    // 5. Run the main function
    initializeHomepageStats();
});