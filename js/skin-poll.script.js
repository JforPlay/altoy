// Helper function for notifications
const showNotification = (message, type = "info") => {
  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 20px;
    background: ${type === 'error' ? '#e74c3c' : type === 'success' ? '#27ae60' : '#3498db'};
    color: white;
    border-radius: 5px;
    z-index: 10000;
    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    animation: slideIn 0.3s ease-out;
    font-weight: 500;
  `;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = "slideOut 0.3s ease-out";
    setTimeout(() => notification.remove(), 300);
  }, 3000);
};

document.addEventListener("DOMContentLoaded", async () => {
  const CACHE_VERSION = "v2.2-optimized"; // NEW VERSION
  const CACHE_DURATION_MS = 1000 * 60 * 60 * 1; // 1 hour cache

  // --- Firebase Setup ---
  const firebaseConfig = {
    apiKey: "AIzaSyCmtsfkzlISZDd0totgv3MIrpT9kvLvKLk",
    authDomain: "azurlane-skin-vote.firebaseapp.com",
    projectId: "azurlane-skin-vote",
    storageBucket: "azurlane-skin-vote.firebasestorage.app",
    messagingSenderId: "282702723033",
    appId: "1:282702723033:web:a97b60cb7138bdbbbacbc8",
  };

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  const db = firebase.firestore();
  const auth = firebase.auth();

  // Sign in anonymously
  let currentUserId = null;
  try {
    const userCredential = await auth.signInAnonymously();
    currentUserId = userCredential.user.uid;
    console.log("✅ Signed in anonymously:", currentUserId);
  } catch (error) {
    console.error("❌ Anonymous sign-in failed:", error);
    showNotification("인증에 실패했습니다. 페이지를 새로고침하세요.", "error");
    return;
  }

  // --- Get HTML elements ---
  const pollContainer = document.getElementById("poll-container");
  const characterNameSearch = document.getElementById("character-name-search");
  const characterDropdownContent = document.getElementById("character-dropdown-content");
  const skinTypeSelect = document.getElementById("skin-type-select");
  const rarityCheckboxes = document.getElementById("rarity-checkboxes");
  const factionSelect = document.getElementById("faction-select");
  const tagSelect = document.getElementById("tag-select");
  const sortSelect = document.getElementById("sort-select");
  const leaderboardToggleBtn = document.getElementById('leaderboard-toggle-btn');
  const leaderboardContent = document.getElementById('leaderboard-content');
  const resetFiltersBtn = document.getElementById('reset-filters-btn');

  // --- State Variables ---
  let allSkins = [];
  let allCharacterNames = [];
  let allPollDataCache = {};
  let skinIdToClientIdMap = {};
  let clientIdToSkinMap = {};
  let currentlyDisplayedSkins = [];
  let isSorting = false;
  let pendingVote = null;
  let cachedTotalVotes = 0;
  let cachedLeaderboard = [];
  let userVotesCache = new Set();

  // --- NEW: Cache Management Functions ---

  /**
   * Saves poll data to localStorage with timestamp
   */
  const savePollDataToCache = (pollData) => {
    try {
      localStorage.setItem('poll_data_cache', JSON.stringify({
        data: pollData,
        timestamp: Date.now(),
        version: CACHE_VERSION
      }));
      console.log(`💾 Saved ${Object.keys(pollData).length} poll entries to cache`);
    } catch (e) {
      console.warn("Cache save failed:", e);
    }
  };

  /**
   * Loads poll data from localStorage if valid
   */
  const loadPollDataFromCache = () => {
    try {
      const cached = localStorage.getItem('poll_data_cache');
      if (!cached) return null;

      const { data, timestamp, version } = JSON.parse(cached);

      // Check version
      if (version !== CACHE_VERSION) {
        console.log("🔄 Cache version mismatch, invalidating...");
        return null;
      }

      // Check age
      const age = Date.now() - timestamp;
      if (age > CACHE_DURATION_MS) {
        console.log("⏰ Cache expired (age: " + Math.round(age / 1000 / 60) + " minutes)");
        return null;
      }

      console.log(`✅ Loaded ${Object.keys(data).length} poll entries from cache (age: ${Math.round(age / 1000)}s)`);
      return data;
    } catch (e) {
      console.warn("Cache load failed:", e);
      return null;
    }
  };

  /**
   * Saves leaderboard to localStorage
   */
  const saveLeaderboardToCache = (leaderboard, totalVotes) => {
    try {
      localStorage.setItem('leaderboard_cache', JSON.stringify({
        leaderboard,
        totalVotes,
        timestamp: Date.now(),
        version: CACHE_VERSION
      }));
    } catch (e) {
      console.warn("Leaderboard cache save failed:", e);
    }
  };

  /**
   * Loads leaderboard from localStorage
   */
  const loadLeaderboardFromCache = () => {
    try {
      const cached = localStorage.getItem('leaderboard_cache');
      if (!cached) return null;

      const { leaderboard, totalVotes, timestamp, version } = JSON.parse(cached);

      if (version !== CACHE_VERSION) return null;

      const age = Date.now() - timestamp;
      if (age > CACHE_DURATION_MS) return null;

      console.log(`✅ Loaded leaderboard from cache`);
      return { leaderboard, totalVotes };
    } catch (e) {
      return null;
    }
  };

  /**
   * Saves user votes to localStorage
   */
  const saveUserVotesToCache = (votesSet) => {
    try {
      localStorage.setItem('user_votes_cache', JSON.stringify({
        votes: Array.from(votesSet),
        timestamp: Date.now(),
        userId: currentUserId,
        version: CACHE_VERSION
      }));
    } catch (e) {
      console.warn("User votes cache save failed:", e);
    }
  };

  /**
   * Loads user votes from localStorage
   */
  const loadUserVotesFromCache = () => {
    try {
      const cached = localStorage.getItem('user_votes_cache');
      if (!cached) return null;

      const { votes, timestamp, userId, version } = JSON.parse(cached);

      if (version !== CACHE_VERSION || userId !== currentUserId) return null;

      const age = Date.now() - timestamp;
      if (age > CACHE_DURATION_MS) return null;

      console.log(`✅ Loaded ${votes.length} user votes from cache`);
      return new Set(votes);
    } catch (e) {
      return null;
    }
  };

  // --- Cache Version Management ---
  const currentVersion = localStorage.getItem("cache_version");
  if (currentVersion !== CACHE_VERSION) {
    console.log("🔄 Cache version updated. Clearing old data...");

    // Clear old caches
    ['poll_data_cache', 'leaderboard_cache', 'user_votes_cache'].forEach(key => {
      localStorage.removeItem(key);
    });

    Object.keys(localStorage).forEach(key => {
      if (key.startsWith("voted_") || key.startsWith("rating_")) {
        localStorage.removeItem(key);
      }
    });

    localStorage.setItem("cache_version", CACHE_VERSION);
    showNotification("데이터가 업데이트되었습니다.", "info");
  }

  // --- Helper Functions ---
  const debounce = (func, delay) => {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => { func.apply(this, args); }, delay);
    };
  };

  const populateDropdown = (dropdownEl, items, onSelectCallback) => {
    dropdownEl.innerHTML = '';
    if (items.length === 0) {
      dropdownEl.innerHTML = `<div class="no-results">검색 결과가 없습니다</div>`;
      return;
    }
    items.forEach(item => {
      const a = document.createElement('a');
      a.textContent = item;
      a.addEventListener('click', () => onSelectCallback(item));
      dropdownEl.appendChild(a);
    });
  };

  const setupDropdown = (inputEl, dropdownEl, getSourceArray, onSelectCallback) => { 
    const handleFilter = () => { 
      const sourceArray = getSourceArray(); 
      const searchTerm = inputEl.value.toLowerCase(); 
      
      // REMOVED: Exact match check - now always filters
      const filteredItems = sourceArray.filter(item => item.toLowerCase().includes(searchTerm)); 
      populateDropdown(dropdownEl, filteredItems, onSelectCallback); 
    }; 
    
    inputEl.addEventListener('keyup', debounce(handleFilter, 200)); 
    inputEl.addEventListener('focus', () => { 
      handleFilter(); 
      dropdownEl.style.display = 'block'; 
    }); 
    inputEl.addEventListener('blur', () => { 
      setTimeout(() => { 
        dropdownEl.style.display = 'none'; 
      }, 200); 
    }); 
  };

  const handleCharacterSelect = (characterName) => {
    characterNameSearch.value = characterName;
    characterDropdownContent.style.display = 'none';
    applyFilters();
  };

  // --- URL State Management ---
  const updateURLWithFilters = () => {
    const params = new URLSearchParams();
    if (characterNameSearch.value) params.set('character', characterNameSearch.value);
    if (skinTypeSelect.value !== 'all') params.set('type', skinTypeSelect.value);
    if (factionSelect.value !== 'all') params.set('faction', factionSelect.value);
    if (tagSelect.value !== 'all') params.set('tag', tagSelect.value);
    if (sortSelect.value !== 'default') params.set('sort', sortSelect.value);
    const selectedRarities = [...rarityCheckboxes.querySelectorAll("input:checked")].map(cb => cb.value);
    if (selectedRarities.length < 5) params.set('rarities', selectedRarities.join(','));
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    history.pushState({}, '', newUrl);
  };

  const applyFiltersFromURL = () => {
    const params = new URLSearchParams(window.location.search);
    if (params.toString() === '') {
      skinTypeSelect.value = '수영복';
      tagSelect.value = 'L2D';
    } else {
      characterNameSearch.value = params.get('character') || '';
      skinTypeSelect.value = params.get('type') || 'all';
      factionSelect.value = params.get('faction') || 'all';
      tagSelect.value = params.get('tag') || 'all';
      sortSelect.value = params.get('sort') || 'default';
      const raritiesParam = params.get('rarities');
      if (raritiesParam) {
        const activeRarities = raritiesParam.split(',');
        rarityCheckboxes.querySelectorAll('input').forEach(cb => {
          cb.checked = activeRarities.includes(cb.value);
        });
      }
    }
    applyFilters();
  };

  // --- OPTIMIZED: Firestore Functions ---

  /**
   * NEW: Fetches only user's votes (much smaller query)
   */
  const fetchUserVotes = async (userId) => {
    // Try cache first
    const cachedVotes = loadUserVotesFromCache();
    if (cachedVotes) return cachedVotes;

    // Fetch from Firestore
    const userVotesRef = db.collection("user_votes").where("userId", "==", userId);
    const votedClientIds = new Set();

    try {
      const snapshot = await userVotesRef.get();
      console.log(`📥 Fetched ${snapshot.size} user votes from Firestore (${snapshot.size} reads)`);

      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.clientId) votedClientIds.add(data.clientId);
      });

      // Save to cache
      saveUserVotesToCache(votedClientIds);
    } catch (error) {
      console.error("Error fetching user votes:", error);
    }

    return votedClientIds;
  };

  /**
   * OPTIMIZED: Fetches leaderboard with caching
   */
  const fetchLeaderboardAndStats = async () => {
    // Try cache first
    const cached = loadLeaderboardFromCache();
    if (cached) return cached;

    // Fetch from Firestore
    const leaderboardRef = db.collection("metadata").doc("leaderboard");
    try {
      const doc = await leaderboardRef.get();
      console.log(`📥 Fetched leaderboard from Firestore (1 read)`);

      if (doc.exists) {
        const data = doc.data();
        saveLeaderboardToCache(data.leaderboard || [], data.totalVotes || 0);
        return data;
      }
      return { leaderboard: [], totalVotes: 0 };
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
      return { leaderboard: [], totalVotes: 0 };
    }
  };

  /**
   * OPTIMIZED: Only fetches poll data that's not in cache
   */
  const fetchAllPollData = async () => {
    // Try cache first
    const cachedData = loadPollDataFromCache();
    if (cachedData) {
      console.log(`✅ Using cached poll data (0 reads saved!)`);
      return cachedData;
    }

    // Full fetch on first load or cache miss
    console.log(`📥 Fetching all poll data from Firestore...`);
    const pollRef = db.collection("skin_polls");
    const allPollData = {};

    try {
      const snapshot = await pollRef.get();
      console.log(`📥 Fetched ${snapshot.size} poll entries (${snapshot.size} reads)`);

      snapshot.forEach(doc => {
        allPollData[doc.id] = doc.data();
      });

      // Save to cache
      savePollDataToCache(allPollData);
    } catch (error) {
      console.error("Error fetching poll data:", error);
    }

    return allPollData;
  };

  /**
   * OPTIMIZED: Fetches only a single skin's vote data
   */
  const fetchSingleSkinData = async (clientId) => {
    const skinDocRef = db.collection("skin_polls").doc(clientId);
    try {
      const doc = await skinDocRef.get();
      console.log(`📥 Fetched single skin data for ${clientId} (1 read)`);

      if (doc.exists) {
        return doc.data();
      }
      return null;
    } catch (error) {
      console.error(`Error fetching skin ${clientId}:`, error);
      return null;
    }
  };

  /**
   * Updates leaderboard in Firestore
   */
  const updateLeaderboardInFirestore = async (newLeaderboard, newTotalVotes) => {
    const leaderboardRef = db.collection("metadata").doc("leaderboard");
    try {
      await leaderboardRef.set({
        leaderboard: newLeaderboard,
        totalVotes: newTotalVotes,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      });
      console.log("✅ Leaderboard updated in Firestore (1 write)");

      // Update cache
      saveLeaderboardToCache(newLeaderboard, newTotalVotes);
    } catch (error) {
      console.error("Error updating leaderboard:", error);
    }
  };

  /**
   * Recalculates leaderboard locally
   */
  const recalculateLeaderboard = () => {
    const MIN_VOTES = 10;
    const rankedSkins = Object.keys(allPollDataCache).map(clientId => {
      const poll = allPollDataCache[clientId];
      const skinInfo = clientIdToSkinMap[clientId];
      if (!skinInfo || !poll.total_votes || poll.total_votes < MIN_VOTES) return null;

      return {
        id: clientId,
        name: skinInfo["한글 함순이 + 스킨 이름"],
        charName: skinInfo["함순이 이름"],
        imageUrl: skinInfo["깔끔한 일러"],
        average_score: poll.total_score / poll.total_votes,
        total_votes: poll.total_votes,
      };
    }).filter(Boolean);

    rankedSkins.sort((a, b) => {
      if (b.average_score !== a.average_score) return b.average_score - a.average_score;
      return b.total_votes - a.total_votes;
    });

    const top10 = rankedSkins.slice(0, 10);
    cachedLeaderboard = top10;

    updateLeaderboardInFirestore(top10, cachedTotalVotes);
    return top10;
  };

  // --- Main Initialization ---
  fetch("data/skin_voiceline_data.json")
    .then((response) => response.json())
    .then((jsonData) => {
      allSkins = Object.keys(jsonData).map((key) => ({ id: key, ...jsonData[key] }))
        .filter(skin => skin["한글 함순이 + 스킨 이름"] && skin["함순이 이름"] && skin["클뜯 id"]);

      allSkins.forEach(skin => {
        const clientId = String(skin["클뜯 id"]);
        skinIdToClientIdMap[skin.id] = clientId;
        clientIdToSkinMap[clientId] = skin;
      });

      allCharacterNames = [...new Set(allSkins.map((s) => s["함순이 이름"]))].filter(Boolean).sort();
      setupDropdown(characterNameSearch, characterDropdownContent, () => allCharacterNames, handleCharacterSelect);
      displaySkeletonLoader();

      // OPTIMIZED: Parallel fetch with caching
      Promise.all([
        fetchLeaderboardAndStats(),
        fetchAllPollData(),
        fetchUserVotes(currentUserId)
      ]).then(([leaderboardData, pollData, userVotes]) => {
        allPollDataCache = pollData;
        cachedLeaderboard = leaderboardData.leaderboard || [];
        cachedTotalVotes = leaderboardData.totalVotes || 0;
        userVotesCache = userVotes;

        console.log(`📊 Total reads this session: ~${Object.keys(pollData).length > 0 ? Object.keys(pollData).length + userVotes.size + 1 : '3 (all from cache!)'}`);

        populateLeaderboard(cachedLeaderboard);
        applyFiltersFromURL();
      });
    });

  const displaySkeletonLoader = (count = 18) => {
    pollContainer.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const skeletonBox = document.createElement("div");
      skeletonBox.className = "skeleton-card";
      skeletonBox.innerHTML = `
        <div class="skeleton-image skeleton-element"></div>
        <div class="skeleton-info">
          <div class="skeleton-line skeleton-element"></div>
          <div class="skeleton-line short skeleton-element"></div>
        </div>
      `;
      pollContainer.appendChild(skeletonBox);
    }
  };

  // --- Core Functions ---
  const applyFilters = () => {
    let filteredSkins = allSkins;
    const selectedCharName = characterNameSearch.value;
    const selectedType = skinTypeSelect.value;
    const selectedFaction = factionSelect.value;
    const selectedTag = tagSelect.value;
    const selectedRarities = [...rarityCheckboxes.querySelectorAll("input:checked")].map(cb => cb.value);

    if (selectedCharName) filteredSkins = filteredSkins.filter(s => s["함순이 이름"] === selectedCharName);
    if (selectedType !== "all") {
      if (selectedType === "기본") {
        filteredSkins = filteredSkins.filter(s => !s["스킨 타입 - 한글"]);
      } else {
        filteredSkins = filteredSkins.filter(s => s["스킨 타입 - 한글"] === selectedType);
      }
    }
    if (selectedFaction !== "all") filteredSkins = filteredSkins.filter(s => s["진영"] === selectedFaction);
    if (selectedTag !== "all") {
      if (selectedTag === "X") {
        filteredSkins = filteredSkins.filter(s => !s["스킨 태그"]);
      } else {
        filteredSkins = filteredSkins.filter(s => s["스킨 태그"] && s["스킨 태그"].includes(selectedTag));
      }
    }
    filteredSkins = filteredSkins.filter(s => selectedRarities.includes(s["레어도"]));

    currentlyDisplayedSkins = filteredSkins.map(skin => {
      const clientId = String(skin["클뜯 id"]);
      const data = allPollDataCache[clientId];
      return {
        ...skin,
        total_votes: data?.total_votes || 0,
        average_score: (data && data.total_votes > 0) ? (data.total_score / data.total_votes) : 0
      };
    });

    reSortView();
    updateURLWithFilters();
  };

  const renderPollList = (skinsToRender) => {
    pollContainer.innerHTML = "";
    if (skinsToRender.length === 0) {
      pollContainer.innerHTML = `<div class="no-results">표시할 스킨이 없습니다.</div>`;
      return;
    }

    skinsToRender.forEach((skin) => {
      const skinId = skin.id;
      const clientId = String(skin["클뜯 id"]);
      const pollBox = document.createElement("div");
      pollBox.className = "poll-box";
      pollBox.id = `poll-box-${skinId}`;

      const hasVotedLocal = localStorage.getItem(`voted_${clientId}`) === "true";
      const hasVotedFirestore = userVotesCache.has(clientId);
      const hasVoted = hasVotedLocal || hasVotedFirestore;
      const votedRating = hasVoted ? localStorage.getItem(`rating_${clientId}`) : null;

      pollBox.innerHTML = ` 
        <img src="${skin["깔끔한 일러"]}" class="poll-image" loading="lazy"> 
        <div class="poll-info"> 
          <div class="character-name">${skin["함순이 이름"]}</div> 
          <h3>${skin["한글 함순이 + 스킨 이름"]}</h3> 
          <div class="info-line"><strong>타입:</strong> ${skin["스킨 타입 - 한글"] || "기본"}</div> 
          <div class="info-line"><strong>태그:</strong> ${skin["스킨 태그"] || "없음"}</div> 
          <div class="info-line"><strong>레어도:</strong> ${skin["레어도"] || "없음"}</div> 
          <div class="rating-area ${hasVoted ? "voted" : ""}" data-skin-id-area="${skinId}" data-client-id="${clientId}"> 
            <div class="vote-widget"> 
              <span class="vote-label">투표:</span> 
              <div class="star-rating" data-skin-id="${skinId}" data-client-id="${clientId}" data-skin-name="${skin["한글 함순이 + 스킨 이름"]}" data-character-name="${skin["함순이 이름"]}"> 
                <input type="radio" id="star5-${skinId}" name="rating-${skinId}" value="5" ${votedRating === '5' ? 'checked' : ''} ${hasVoted ? 'disabled' : ''}><label for="star5-${skinId}">★</label> 
                <input type="radio" id="star4-${skinId}" name="rating-${skinId}" value="4" ${votedRating === '4' ? 'checked' : ''} ${hasVoted ? 'disabled' : ''}><label for="star4-${skinId}">★</label> 
                <input type="radio" id="star3-${skinId}" name="rating-${skinId}" value="3" ${votedRating === '3' ? 'checked' : ''} ${hasVoted ? 'disabled' : ''}><label for="star3-${skinId}">★</label> 
                <input type="radio" id="star2-${skinId}" name="rating-${skinId}" value="2" ${votedRating === '2' ? 'checked' : ''} ${hasVoted ? 'disabled' : ''}><label for="star2-${skinId}">★</label> 
                <input type="radio" id="star1-${skinId}" name="rating-${skinId}" value="1" ${votedRating === '1' ? 'checked' : ''} ${hasVoted ? 'disabled' : ''}><label for="star1-${skinId}">★</label> 
              </div> 
            </div> 
            <div class="confirm-vote-message" id="confirm-msg-${skinId}">다시 클릭하여 확정</div> 
            <div class="poll-results" id="results-${clientId}"></div> 
          </div> 
        </div>`;
      pollContainer.appendChild(pollBox);

      updateScoreDisplay(clientId, {
        total_votes: skin.total_votes,
        total_score: skin.average_score * skin.total_votes
      });
    });
  };

  /**
   * OPTIMIZED: Vote submission with cache updates
   */
  const submitVote = async (clientId, rating, skinName, characterName, displaySkinId) => {
    const userId = currentUserId;

    if (userVotesCache.has(clientId)) {
      showNotification("이미 이 스킨에 투표하셨습니다!", "error");
      return;
    }

    if (localStorage.getItem(`voted_${clientId}`) === "true") {
      showNotification("이미 이 스킨에 투표하셨습니다!", "error");
      return;
    }

    const skinDocRef = db.collection("skin_polls").doc(clientId);
    const statsDocRef = db.collection("stats").doc("total_votes_counter");
    const userVoteDocRef = db.collection("user_votes").doc(`${userId}_${clientId}`);

    console.log(`🗳️ Submitting vote: User=${userId}, Skin=${clientId}, Rating=${rating}`);

    try {
      await db.runTransaction(async (transaction) => {
        const skinDoc = await transaction.get(skinDocRef);
        const statsDoc = await transaction.get(statsDocRef);
        const userVoteDoc = await transaction.get(userVoteDocRef);

        if (userVoteDoc.exists) throw new Error("ALREADY_VOTED");

        const currentTotalVotes = skinDoc.data()?.total_votes || 0;
        const currentTotalScore = skinDoc.data()?.total_score || 0;
        const siteTotalVotes = statsDoc.data()?.count || 0;

        const newTotalVotes = currentTotalVotes + 1;
        const newTotalScore = currentTotalScore + rating;
        const newAverageScore = newTotalScore / newTotalVotes;
        const newTotalCount = siteTotalVotes + 1;

        transaction.set(skinDocRef, {
          total_votes: newTotalVotes,
          total_score: newTotalScore,
          average_score: newAverageScore,
          skin_name: skinName,
          character_name: characterName,
          client_id: clientId,
          last_updated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        transaction.set(statsDocRef, {
          count: newTotalCount,
          last_updated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        transaction.set(userVoteDocRef, {
          userId: userId,
          clientId: clientId,
          rating: rating,
          skinName: skinName,
          characterName: characterName,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
      });

      console.log("✅ Vote saved (3 writes)");

      localStorage.setItem(`voted_${clientId}`, "true");
      localStorage.setItem(`rating_${clientId}`, rating);
      userVotesCache.add(clientId);
      saveUserVotesToCache(userVotesCache); // Update cache

      const ratingArea = document.querySelector(`.rating-area[data-client-id="${clientId}"]`);
      if (ratingArea) {
        ratingArea.classList.remove('pending-vote');
        ratingArea.classList.add("voted", "voted-animation");
        ratingArea.querySelectorAll('input').forEach(input => input.disabled = true);
        setTimeout(() => ratingArea.classList.remove("voted-animation"), 300);
      }

      // OPTIMIZED: Update local cache immediately instead of refetching
      const currentTotalVotes = allPollDataCache[clientId]?.total_votes || 0;
      const currentTotalScore = allPollDataCache[clientId]?.total_score || 0;

      allPollDataCache[clientId] = {
        ...allPollDataCache[clientId],
        total_votes: currentTotalVotes + 1,
        total_score: currentTotalScore + rating,
        average_score: (currentTotalScore + rating) / (currentTotalVotes + 1),
        skin_name: skinName,
        character_name: characterName,
        client_id: clientId
      };

      // Save updated cache
      savePollDataToCache(allPollDataCache);

      cachedTotalVotes++;

      updateScoreDisplay(clientId, allPollDataCache[clientId]);

      const skinInArray = currentlyDisplayedSkins.find(s => String(s["클뜯 id"]) === clientId);
      if (skinInArray) {
        skinInArray.total_votes = allPollDataCache[clientId].total_votes;
        skinInArray.average_score = allPollDataCache[clientId].average_score;
      }

      const newLeaderboard = recalculateLeaderboard();
      populateLeaderboard(newLeaderboard);

      showNotification("투표가 성공적으로 저장되었습니다! 🎉", "success");

    } catch (error) {
      if (error.message === "ALREADY_VOTED") {
        console.warn("⚠️ User already voted");
        showNotification("이미 이 스킨에 투표하셨습니다!", "error");

        userVotesCache.add(clientId);
        localStorage.setItem(`voted_${clientId}`, "true");

        const ratingArea = document.querySelector(`.rating-area[data-client-id="${clientId}"]`);
        if (ratingArea) {
          ratingArea.classList.add("voted");
          ratingArea.querySelectorAll('input').forEach(input => input.disabled = true);
        }
      } else {
        console.error("❌ Transaction failed:", error);

        if (error.code === 'permission-denied') {
          showNotification("권한이 없습니다. Firestore 규칙을 확인하세요.", "error");
        } else if (error.code === 'unavailable') {
          showNotification("네트워크 오류입니다. 인터넷 연결을 확인하세요.", "error");
        } else {
          showNotification("투표를 저장하는 데 실패했습니다. 다시 시도해 주세요.", "error");
        }
      }

      const ratingArea = document.querySelector(`.rating-area[data-client-id="${clientId}"]`);
      if (ratingArea) {
        ratingArea.classList.remove('pending-vote');
        const checkedRadio = ratingArea.querySelector(`input[name="rating-${displaySkinId}"]:checked`);
        if (checkedRadio) checkedRadio.checked = false;
      }
    }
  };

  const reSortView = () => {
    if (isSorting) return;
    isSorting = true;
    const sortBy = sortSelect.value;
    const defaultSort = (a, b) => (a["클뜯 id"] || 0) - (b["클뜯 id"] || 0);

    if (sortBy === 'score_desc') {
      currentlyDisplayedSkins.sort((a, b) => {
        const scoreDiff = b.average_score - a.average_score;
        return scoreDiff !== 0 ? scoreDiff : defaultSort(a, b);
      });
    } else if (sortBy === 'votes_desc') {
      currentlyDisplayedSkins.sort((a, b) => {
        const voteDiff = b.total_votes - a.total_votes;
        return voteDiff !== 0 ? voteDiff : defaultSort(a, b);
      });
    } else {
      currentlyDisplayedSkins.sort(defaultSort);
    }

    const initialPositions = new Map();
    Array.from(pollContainer.children).forEach(box => {
      initialPositions.set(box.id, box.getBoundingClientRect());
    });

    renderPollList(currentlyDisplayedSkins);

    Array.from(pollContainer.children).forEach(box => {
      const oldPos = initialPositions.get(box.id);
      if (!oldPos) return;
      const newPos = box.getBoundingClientRect();
      const deltaX = oldPos.left - newPos.left;
      const deltaY = oldPos.top - newPos.top;
      if (deltaX === 0 && deltaY === 0) return;

      requestAnimationFrame(() => {
        box.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        box.style.transition = 'transform 0s';
        requestAnimationFrame(() => {
          box.style.transform = '';
          box.style.transition = 'transform 0.5s ease-in-out';
        });
      });
    });

    setTimeout(() => { isSorting = false; }, 500);
  };

  const updateScoreDisplay = (clientId, data) => {
    const resultsEl = document.getElementById(`results-${clientId}`);
    if (!resultsEl) return;

    resultsEl.innerHTML = `<div class="score-bar-visual">★★★★★<div class="score-bar-foreground" style="width: 0%;">★★★★★</div></div><div class="score-bar-text"></div>`;
    const foregroundEl = resultsEl.querySelector('.score-bar-foreground');
    const textEl = resultsEl.querySelector('.score-bar-text');

    if (data && data.total_votes > 0) {
      const average = data.total_score / data.total_votes;
      const percentage = (average / 5) * 100;
      foregroundEl.style.width = `${percentage}%`;
      textEl.innerHTML = `평균: <strong>${average.toFixed(2)}</strong> (${data.total_votes}표)`;
    } else {
      foregroundEl.style.width = '0%';
      textEl.textContent = '투표 없음';
    }
  };

  const populateLeaderboard = (leaderboardData) => {
    if (!leaderboardData || leaderboardData.length === 0) {
      leaderboardContent.innerHTML = `<p style="text-align: center; color: #b9bbbe;">리더보드에 표시할 스킨이 아직 없습니다. (최소 10표 필요)</p>`;
      return;
    }

    leaderboardContent.innerHTML = leaderboardData.map((skin, index) => `
      <div class="leaderboard-item">
        <div class="leaderboard-rank">#${index + 1}</div>
        <img src="${skin.imageUrl}" class="leaderboard-image" loading="lazy">
        <div class="leaderboard-details">
          <div class="skin-name">${skin.name || 'Unknown Skin'}</div>
          <div class="char-name">${skin.charName || 'Unknown'}</div>
        </div>
        <div class="leaderboard-score">
          <div class="avg-score">★ ${skin.average_score.toFixed(2)}</div>
          <div class="total-votes">(${skin.total_votes} 표)</div>
        </div>
      </div>
    `).join('');
  };

  const resetFilters = () => {
    characterNameSearch.value = "";
    skinTypeSelect.value = "all";
    factionSelect.value = "all";
    tagSelect.value = "all";
    sortSelect.value = "default";
    rarityCheckboxes.querySelectorAll("input[type='checkbox']").forEach(checkbox => {
      checkbox.checked = true;
    });
    applyFilters();
  };

  const clearPendingVote = () => {
    if (pendingVote) {
      const ratingArea = document.querySelector(`.rating-area[data-client-id="${pendingVote.clientId}"]`);
      if (ratingArea) {
        ratingArea.classList.remove('pending-vote');
        const checkedRadio = ratingArea.querySelector(`input[name="rating-${pendingVote.displaySkinId}"]:checked`);
        if (checkedRadio) checkedRadio.checked = false;
      }
      pendingVote = null;
    }
  };

  // --- Event Listeners ---
  pollContainer.addEventListener("click", (event) => {
    const starLabel = event.target.closest('.star-rating label');
    if (!starLabel) return;

    const ratingArea = event.target.closest('.rating-area');
    if (ratingArea.classList.contains('voted')) return;

    event.preventDefault();

    const displaySkinId = ratingArea.dataset.skinIdArea;
    const clientId = ratingArea.dataset.clientId;
    const rating = parseInt(starLabel.htmlFor.split('-')[0].replace('star', ''), 10);
    const starRatingDiv = ratingArea.querySelector('.star-rating');
    const skinName = starRatingDiv.dataset.skinName;
    const characterName = starRatingDiv.dataset.characterName;

    if (pendingVote && pendingVote.clientId === clientId && pendingVote.rating === rating) {
      submitVote(pendingVote.clientId, pendingVote.rating, skinName, characterName, displaySkinId);
      pendingVote = null;
    } else {
      clearPendingVote();
      pendingVote = { clientId, rating, displaySkinId };
      ratingArea.classList.add('pending-vote');
      document.getElementById(`star${rating}-${displaySkinId}`).checked = true;
    }
  });

  document.addEventListener('click', (event) => {
    if (pendingVote && !event.target.closest(`.rating-area[data-client-id="${pendingVote.clientId}"]`)) {
      clearPendingVote();
    }
  });

  leaderboardToggleBtn.addEventListener('click', () => {
    leaderboardContent.classList.toggle('visible');
    leaderboardToggleBtn.textContent = leaderboardContent.classList.contains('visible') ? '🔼 리더보드 숨기기' : '🏆 Top 10 스킨 보기';
  });

  resetFiltersBtn.addEventListener('click', resetFilters);

  [skinTypeSelect, factionSelect, tagSelect].forEach((el) => {
    el.addEventListener("change", applyFilters);
  });

  rarityCheckboxes.querySelectorAll("input").forEach((checkbox) => {
    checkbox.addEventListener("change", applyFilters);
  });

  sortSelect.addEventListener('change', () => {
    reSortView();
    updateURLWithFilters();
  });

  window.addEventListener('popstate', applyFiltersFromURL);

  // --- NEW: Info Pop-up Event Listeners ---
  const infoButton = document.getElementById('info-button');
  const infoPopup = document.getElementById('info-popup');
  const closePopupBtn = infoPopup.querySelector('.close-popup-btn');

  const closeInfoPopup = () => {
    infoPopup.classList.remove('visible');
    document.body.classList.remove('no-scroll');
  };

  infoButton.addEventListener('click', () => {
    infoPopup.classList.add('visible');
    document.body.classList.add('no-scroll');
  });

  closePopupBtn.addEventListener('click', closeInfoPopup);

  infoPopup.addEventListener('click', (event) => {
    if (event.target === infoPopup) {
      closeInfoPopup();
    }
  });
});