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

    // 2. Get required HTML elements
    const totalVotesEl = document.getElementById('homepage-total-votes');
    const statsTitleEl = document.getElementById('stats-title-with-date');

    // 3. Main function to initialize stats
    const initializeHomepageStats = async () => {
        // Create the new title string with the current date
        if (statsTitleEl) {
            const today = new Date();
            const dateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            statsTitleEl.textContent = `재미로 보는 현재 (${dateString}) 까지의 총 스킨투표 수`;
        }
        
        try {
            const pollSnapshot = await db.collection("skin_polls").get();
            
            let grandTotalVotes = 0;
            pollSnapshot.forEach(doc => {
                grandTotalVotes += (doc.data().total_votes || 0);
            });

            if (totalVotesEl) {
                totalVotesEl.textContent = grandTotalVotes.toLocaleString() + ' 표';
            }

        } catch (error) {
            console.error("Error fetching total votes:", error);
            if (totalVotesEl) totalVotesEl.textContent = 'N/A';
        }
    };

    // 4. Run the main function
    initializeHomepageStats();
});