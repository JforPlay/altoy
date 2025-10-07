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

// Add animation styles
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(400px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(400px); opacity: 0; }
  }
`;
document.head.appendChild(style);

document.addEventListener("DOMContentLoaded", async () => {
  const CACHE_VERSION = "v2.3-realtime";
  const CACHE_DURATION_MS = 1000 * 60 * 60; // 1 hour cache

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

  // Image popup elements
  const imagePopup = document.getElementById('image-popup');
  const popupFullImage = document.getElementById('popup-full-image');
  const popupSkinName = document.getElementById('popup-skin-name');
  const popupCharName = document.getElementById('popup-char-name');
  const closeImagePopupBtn = document.querySelector('.close-image-popup-btn');

  // REMOVED: Unused dataAgeIndicator variable
  // const dataAgeIndicator = document.getElementById('data-age-indicator');

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

  // Refresh cooldown state
  let refreshCooldownTimer = null;
  let lastRefreshTime = 0;
  const REFRESH_COOLDOWN_MS = 60000; // 60 seconds

  // --- Image Popup Functions ---
  const openImagePopup = (fullImageUrl, skinName, charName) => {
    popupFullImage.src = fullImageUrl;
    popupSkinName.textContent = skinName;
    popupCharName.textContent = charName;
    imagePopup.classList.add('visible');
    document.body.classList.add('no-scroll');
  };

  const closeImagePopup = () => {
    imagePopup.classList.remove('visible');
    document.body.classList.remove('no-scroll');
    setTimeout(() => {
      popupFullImage.src = '';
    }, 300);
  };

  // --- Cache Management Functions ---

  const savePollDataToCache = (pollData) => {
    try {
      localStorage.setItem(`${CACHE_VERSION}_pollDataCache`, JSON.stringify({
        data: pollData,
        timestamp: Date.now(),
        version: CACHE_VERSION
      }));
      localStorage.setItem(`${CACHE_VERSION}_pollDataTimestamp`, String(Date.now()));
      console.log(`💾 Saved ${Object.keys(pollData).length} poll entries to cache`);
    } catch (e) {
      console.warn("Cache save failed:", e);
    }
  };

  const loadPollDataFromCache = () => {
    try {
      const cached = localStorage.getItem(`${CACHE_VERSION}_pollDataCache`);
      if (!cached) return { data: null, timestamp: null };

      const { data, timestamp, version } = JSON.parse(cached);

      if (version !== CACHE_VERSION) {
        console.log("🔄 Cache version mismatch, invalidating...");
        return { data: null, timestamp: null };
      }

      const age = Date.now() - timestamp;
      if (age > CACHE_DURATION_MS) {
        console.log("⏰ Cache expired (age: " + Math.round(age / 1000 / 60) + " minutes)");
        return { data: null, timestamp };
      }

      console.log(`✅ Loaded ${Object.keys(data).length} poll entries from cache (age: ${Math.round(age / 1000)}s)`);
      return { data, timestamp };
    } catch (e) {
      console.warn("Cache load failed:", e);
      return { data: null, timestamp: null };
    }
  };

  const saveLeaderboardToCache = (leaderboard, totalVotes) => {
    try {
      localStorage.setItem(`${CACHE_VERSION}_leaderboardCache`, JSON.stringify({
        leaderboard,
        totalVotes,
        timestamp: Date.now(),
        version: CACHE_VERSION
      }));
    } catch (e) {
      console.warn("Leaderboard cache save failed:", e);
    }
  };

  const loadLeaderboardFromCache = () => {
    try {
      const cached = localStorage.getItem(`${CACHE_VERSION}_leaderboardCache`);
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

  const saveUserVotesToCache = (votesSet) => {
    try {
      localStorage.setItem(`${CACHE_VERSION}_userVotesCache`, JSON.stringify({
        votes: Array.from(votesSet),
        timestamp: Date.now(),
        userId: currentUserId,
        version: CACHE_VERSION
      }));
    } catch (e) {
      console.warn("User votes cache save failed:", e);
    }
  };

  const loadUserVotesFromCache = () => {
    try {
      const cached = localStorage.getItem(`${CACHE_VERSION}_userVotesCache`);
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

    Object.keys(localStorage).forEach(key => {
      if (key.includes('pollDataCache') ||
        key.includes('leaderboardCache') ||
        key.includes('userVotesCache') ||
        key.includes('pollDataTimestamp') ||
        key.startsWith("voted_") ||
        key.startsWith("rating_")) {
        localStorage.removeItem(key);
      }
    });

    localStorage.setItem("cache_version", CACHE_VERSION);
    showNotification("데이터가 업데이트되었습니다.", "info");
  }

  /**
   * Connection status tracking
   */
  let connectionStatus = {
    isConnected: true,
    lastError: null,
    errorCount: 0
  };

  /**
   * Update data age indicator with connection status
   */
  const updateDataAgeIndicator = () => {
    const cacheTimestamp = localStorage.getItem(`${CACHE_VERSION}_pollDataTimestamp`);
    const indicator = document.getElementById('data-age-indicator');

    if (!indicator) return;

    // Check connection status first
    if (!connectionStatus.isConnected) {
      indicator.innerHTML = `<i class="fas fa-exclamation-circle"></i> 서버 연결 실패`;
      indicator.style.backgroundColor = 'rgba(231, 76, 60, 0.2)';
      indicator.style.borderLeft = '3px solid #e74c3c';
      return;
    }

    if (connectionStatus.lastError) {
      if (connectionStatus.lastError.code === 'resource-exhausted') {
        indicator.innerHTML = `<i class="fas fa-ban"></i> 일일 한도 초과 (내일 재시도)`;
        indicator.style.backgroundColor = 'rgba(231, 76, 60, 0.2)';
        indicator.style.borderLeft = '3px solid #e74c3c';
      } else if (connectionStatus.lastError.code === 'permission-denied') {
        indicator.innerHTML = `<i class="fas fa-lock"></i> 권한 오류`;
        indicator.style.backgroundColor = 'rgba(231, 76, 60, 0.2)';
        indicator.style.borderLeft = '3px solid #e74c3c';
      } else {
        indicator.innerHTML = `<i class="fas fa-exclamation-triangle"></i> 연결 불안정`;
        indicator.style.backgroundColor = 'rgba(243, 156, 18, 0.2)';
        indicator.style.borderLeft = '3px solid #f39c12';
      }
      return;
    }

    if (!cacheTimestamp) {
      indicator.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 데이터 로딩 중...`;
      indicator.style.backgroundColor = 'rgba(52, 152, 219, 0.2)';
      indicator.style.borderLeft = '3px solid #3498db';
      return;
    }

    const cacheAge = Date.now() - parseInt(cacheTimestamp);
    const ageMinutes = Math.floor(cacheAge / 60000);

    // Reset styles for normal operation
    indicator.style.backgroundColor = 'rgba(47, 49, 54, 0.5)';
    indicator.style.borderLeft = 'none';

    if (ageMinutes < 2) {
      indicator.innerHTML = `<i class="fas fa-circle" style="color: #27ae60;"></i> 실시간 동기화 중`;
    } else if (ageMinutes < 30) {
      indicator.innerHTML = `<i class="fas fa-clock" style="color: #f39c12;"></i> 데이터: ${ageMinutes}분 전`;
    } else {
      indicator.innerHTML = `<i class="fas fa-exclamation-triangle" style="color: #e74c3c;"></i> 데이터: ${ageMinutes}분 전`;
    }
  };

  // --- Real-Time Sync Functions ---
  const handleRealtimeUpdate = (snapshot) => {
    let updatedCount = 0;

    snapshot.docChanges().forEach(change => {
      const clientId = change.doc.id;
      const data = change.doc.data();

      if (change.type === "added" || change.type === "modified") {
        allPollDataCache[clientId] = data;
        updateScoreDisplay(clientId, data);
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      console.log(`📡 Real-time update: ${updatedCount} skins updated`);

      const newLeaderboard = recalculateLeaderboard();
      populateLeaderboard(newLeaderboard);

      savePollDataToCache(allPollDataCache);
      updateDataAgeIndicator();
    }
  };

  /**
   * Smart real-time sync with error detection
   */
  const setupSmartVoteSync = () => {
    let isTabActive = !document.hidden;
    let realtimeUnsubscribe = null;

    const startRealtimeSync = () => {
      if (realtimeUnsubscribe) return;

      console.log("🔴 Starting real-time sync...");

      realtimeUnsubscribe = db.collection("skin_polls").onSnapshot(
        // Success callback
        (snapshot) => {
          connectionStatus.isConnected = true;
          connectionStatus.lastError = null;
          connectionStatus.errorCount = 0;

          handleRealtimeUpdate(snapshot);
          updateDataAgeIndicator();
        },
        // Error callback
        (error) => {
          console.error("❌ Real-time listener error:", error);

          connectionStatus.isConnected = false;
          connectionStatus.lastError = error;
          connectionStatus.errorCount++;

          updateDataAgeIndicator();

          if (error.code === 'resource-exhausted') {
            showNotification("⚠️ Firestore 일일 한도 초과. 내일 다시 시도하세요.", "error");
          } else if (error.code === 'permission-denied') {
            showNotification("🔒 권한 오류. 페이지를 새로고침하세요.", "error");
          } else if (error.code === 'unavailable') {
            showNotification("📡 서버 연결 불안정. 잠시 후 재시도합니다.", "error");
          } else {
            showNotification(`실시간 동기화 오류: ${error.message}`, "error");
          }

          const retryDelay = Math.min(5000 * Math.pow(2, connectionStatus.errorCount - 1), 60000);
          console.log(`🔄 Retrying in ${retryDelay / 1000}s...`);

          setTimeout(() => {
            if (isTabActive && !realtimeUnsubscribe) {
              startRealtimeSync();
            }
          }, retryDelay);
        }
      );
    };

    const stopRealtimeSync = () => {
      if (!realtimeUnsubscribe) return;

      console.log("⏸️ Pausing real-time sync (tab inactive)");
      realtimeUnsubscribe();
      realtimeUnsubscribe = null;
    };

    document.addEventListener('visibilitychange', () => {
      isTabActive = !document.hidden;

      if (isTabActive) {
        startRealtimeSync();
        console.log("👁️ Tab is now visible");
      } else {
        stopRealtimeSync();
        console.log("👁️‍🗨️ Tab is now hidden");
      }
    });

    if (isTabActive) {
      startRealtimeSync();
    }

    window.addEventListener('beforeunload', () => {
      if (realtimeUnsubscribe) {
        realtimeUnsubscribe();
      }
    });
  };

  // --- Refresh Button with Cooldown ---
  const startRefreshCooldown = () => {
    const btn = document.getElementById('refresh-data-btn');
    if (!btn) return;

    let secondsLeft = Math.ceil(REFRESH_COOLDOWN_MS / 1000);
    btn.disabled = true;

    const updateButtonText = () => {
      if (secondsLeft > 0) {
        btn.innerHTML = `<i class="fas fa-clock"></i> ${secondsLeft}초`;
      } else {
        clearInterval(refreshCooldownTimer);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-sync-alt"></i>'; // FIXED: Removed "새로고침" text
      }
    };

    updateButtonText();
    refreshCooldownTimer = setInterval(() => {
      secondsLeft--;
      updateButtonText();
    }, 1000);
  };

  /**
   * Refresh with error detection
   */
  const refreshVoteData = async () => {
    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshTime;

    if (timeSinceLastRefresh < REFRESH_COOLDOWN_MS) {
      const remainingSeconds = Math.ceil((REFRESH_COOLDOWN_MS - timeSinceLastRefresh) / 1000);
      showNotification(`⏳ ${remainingSeconds}초 후에 다시 시도하세요`, "error");
      return;
    }

    const btn = document.getElementById('refresh-data-btn');
    if (btn) {
      btn.classList.add('loading');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-sync-alt"></i>';
    }

    showNotification("투표 데이터 업데이트 중...", "info");

    try {
      lastRefreshTime = now;

      await fetchAllPollData();

      connectionStatus.isConnected = true;
      connectionStatus.lastError = null;
      connectionStatus.errorCount = 0;

      applyFilters();

      const newLeaderboard = recalculateLeaderboard();
      populateLeaderboard(newLeaderboard);
      updateDataAgeIndicator();

      showNotification("✅ 최신 데이터로 업데이트되었습니다!", "success");

      if (btn) {
        btn.classList.remove('loading');
        startRefreshCooldown();
      }

    } catch (error) {
      console.error("Error refreshing data:", error);

      connectionStatus.isConnected = false;
      connectionStatus.lastError = error;
      connectionStatus.errorCount++;

      updateDataAgeIndicator();

      if (error.code === 'resource-exhausted') {
        showNotification("⚠️ Firestore 일일 한도 초과. 내일 다시 시도하세요.", "error");
      } else if (error.code === 'permission-denied') {
        showNotification("🔒 권한 오류가 발생했습니다.", "error");
      } else if (error.code === 'unavailable') {
        showNotification("📡 서버에 연결할 수 없습니다.", "error");
      } else {
        showNotification(`데이터 새로고침 실패: ${error.message}`, "error");
      }

      lastRefreshTime = 0;

      if (btn) {
        btn.classList.remove('loading');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-sync-alt"></i>';
      }
    }
  };

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

  // --- Firestore Functions ---

  const fetchUserVotes = async (userId) => {
    const cachedVotes = loadUserVotesFromCache();
    if (cachedVotes) return cachedVotes;

    const userVotesRef = db.collection("user_votes").where("userId", "==", userId);
    const votedClientIds = new Set();

    try {
      const snapshot = await userVotesRef.get();
      console.log(`📥 Fetched ${snapshot.size} user votes from Firestore (${snapshot.size} reads)`);

      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.clientId) votedClientIds.add(data.clientId);
      });

      saveUserVotesToCache(votedClientIds);
    } catch (error) {
      console.error("Error fetching user votes:", error);
      // ADDED: Update connection status on error
      if (error.code) {
        connectionStatus.lastError = error;
        updateDataAgeIndicator();
      }
    }

    return votedClientIds;
  };

  const fetchLeaderboardAndStats = async () => {
    const cached = loadLeaderboardFromCache();
    if (cached) return cached;

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
      // ADDED: Update connection status on error
      if (error.code) {
        connectionStatus.lastError = error;
        updateDataAgeIndicator();
      }
      return { leaderboard: [], totalVotes: 0 };
    }
  };

  const fetchAllPollData = async () => {
    const cachedData = loadPollDataFromCache();
    if (cachedData.data) {
      console.log(`✅ Using cached poll data (0 reads saved!)`);
      return cachedData.data;
    }

    console.log(`📥 Fetching all poll data from Firestore...`);
    const pollRef = db.collection("skin_polls");
    const allPollData = {};

    try {
      const snapshot = await pollRef.get();
      console.log(`📥 Fetched ${snapshot.size} poll entries (${snapshot.size} reads)`);

      snapshot.forEach(doc => {
        allPollData[doc.id] = doc.data();
      });

      savePollDataToCache(allPollData);
    } catch (error) {
      console.error("Error fetching poll data:", error);
      // ADDED: Throw error to be caught by refresh function
      throw error;
    }

    return allPollData;
  };

  const updateLeaderboardInFirestore = async (newLeaderboard, newTotalVotes) => {
    const leaderboardRef = db.collection("metadata").doc("leaderboard");
    try {
      await leaderboardRef.set({
        leaderboard: newLeaderboard,
        totalVotes: newTotalVotes,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      });
      console.log("✅ Leaderboard updated in Firestore (1 write)");

      saveLeaderboardToCache(newLeaderboard, newTotalVotes);
    } catch (error) {
      console.error("Error updating leaderboard:", error);
      // ADDED: Update connection status on error
      if (error.code) {
        connectionStatus.lastError = error;
        updateDataAgeIndicator();
      }
    }
  };

  const recalculateLeaderboard = (votedClientId = null) => {
    const MIN_VOTES = 10;

    if (votedClientId) {
      const votedSkinData = allPollDataCache[votedClientId];
      const currentTop10Ids = new Set(cachedLeaderboard.map(s => s.id));

      if (votedSkinData && votedSkinData.total_votes < MIN_VOTES && !currentTop10Ids.has(votedClientId)) {
        console.log(`⏭️ Skipping leaderboard recalculation (skin has ${votedSkinData.total_votes} votes)`);
        return cachedLeaderboard;
      }
    }

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
    const leaderboardChanged = JSON.stringify(top10.map(s => s.id)) !== JSON.stringify(cachedLeaderboard.map(s => s.id));

    if (leaderboardChanged) {
      console.log("🔄 Leaderboard changed, updating Firestore...");
      cachedLeaderboard = top10;
      const leaderboardTotalVotes = rankedSkins.reduce((sum, skin) => sum + skin.total_votes, 0);
      updateLeaderboardInFirestore(top10, leaderboardTotalVotes);
    } else {
      console.log("✅ Leaderboard unchanged, skipping Firestore write");
      cachedLeaderboard = top10;
    }

    return top10;
  };

  // --- Main Initialization ---
  fetch("data/skin_voiceline_data.json")
    .then((response) => response.json())
    .then(async (jsonData) => {
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

      const cached = loadPollDataFromCache();
      if (cached.data && Object.keys(cached.data).length > 0) {
        console.log("✅ Loaded cached poll data");
        allPollDataCache = cached.data;
      } else {
        console.log("📥 No cache found, fetching initial data...");
        // ADDED: Try-catch for initial fetch
        try {
          allPollDataCache = await fetchAllPollData();
        } catch (error) {
          console.error("Failed to fetch initial data:", error);
          showNotification("초기 데이터 로드 실패. 새로고침 버튼을 눌러주세요.", "error");
        }
      }

      setupSmartVoteSync();

      updateDataAgeIndicator();
      setInterval(updateDataAgeIndicator, 60000);

      const [leaderboardData, userVotes] = await Promise.all([
        fetchLeaderboardAndStats(),
        fetchUserVotes(currentUserId)
      ]);

      cachedTotalVotes = leaderboardData.totalVotes || 0;
      cachedLeaderboard = leaderboardData.leaderboard || [];
      userVotesCache = userVotes;

      populateLeaderboard(cachedLeaderboard);
      applyFiltersFromURL();
    })
    .catch((error) => {
      console.error("Error loading skin data:", error);
      showNotification("스킨 데이터 로드 실패", "error");
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
    const selectedCharName = characterNameSearch.value;
    const selectedType = skinTypeSelect.value;
    const selectedFaction = factionSelect.value;
    const selectedTag = tagSelect.value;
    const selectedRarities = [...rarityCheckboxes.querySelectorAll("input:checked")].map(cb => cb.value);

    const filteredSkins = allSkins.filter(skin => {
      if (selectedCharName && skin["함순이 이름"] !== selectedCharName) return false;
      if (selectedType !== "all") {
        if (selectedType === "기본" && skin["스킨 타입 - 한글"]) return false;
        if (selectedType !== "기본" && skin["스킨 타입 - 한글"] !== selectedType) return false;
      }
      if (selectedFaction !== "all" && skin["진영"] !== selectedFaction) return false;
      if (selectedTag !== "all") {
        if (selectedTag === "X" && skin["스킨 태그"]) return false;
        if (selectedTag !== "X" && (!skin["스킨 태그"] || !skin["스킨 태그"].includes(selectedTag))) return false;
      }
      if (!selectedRarities.includes(skin["레어도"])) return false;
      return true;
    });

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
        <img src="${skin["깔끔한 일러"]}" 
             class="poll-image" 
             loading="lazy"
             data-full-image="${skin["전체 일러"] || skin["깔끔한 일러"]}"
             data-skin-name="${skin["한글 함순이 + 스킨 이름"]}"
             data-char-name="${skin["함순이 이름"]}"
             title="클릭하여 전체 일러스트 보기"> 
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
          last_updated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        if (currentTotalVotes === 0) {
          transaction.update(skinDocRef, {
            skin_name: skinName,
            character_name: characterName,
            client_id: clientId
          });
        }

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
      localStorage.setItem(`rating_${clientId}`, String(rating));
      userVotesCache.add(clientId);
      saveUserVotesToCache(userVotesCache);

      const ratingArea = document.querySelector(`.rating-area[data-client-id="${clientId}"]`);
      if (ratingArea) {
        ratingArea.classList.remove('pending-vote');
        ratingArea.classList.add("voted", "voted-animation");
        ratingArea.querySelectorAll('input').forEach(input => input.disabled = true);
        setTimeout(() => ratingArea.classList.remove("voted-animation"), 300);
      }

      const currentTotalVotes = allPollDataCache[clientId]?.total_votes || 0;
      const currentTotalScore = allPollDataCache[clientId]?.total_score || 0;

      allPollDataCache[clientId] = {
        ...allPollDataCache[clientId],
        total_votes: currentTotalVotes + 1,
        total_score: currentTotalScore + rating,
        average_score: (currentTotalScore + rating) / (currentTotalVotes + 1),
        skin_name: skinName,
        character_name: characterName,
        client_id: clientId,
        last_updated: new Date()
      };

      savePollDataToCache(allPollDataCache);
      cachedTotalVotes++;

      updateScoreDisplay(clientId, allPollDataCache[clientId]);

      const skinInArray = currentlyDisplayedSkins.find(s => String(s["클뜯 id"]) === clientId);
      if (skinInArray) {
        skinInArray.total_votes = allPollDataCache[clientId].total_votes;
        skinInArray.average_score = allPollDataCache[clientId].average_score;
      }

      const newLeaderboard = recalculateLeaderboard(clientId);
      populateLeaderboard(newLeaderboard);

      updateDataAgeIndicator();

      showNotification(`✅ ${skinName}에 ${rating}점 투표 완료!`, "success");

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
        showNotification("투표를 저장하는 데 실패했습니다. 다시 시도해 주세요.", "error");
        
        // ADDED: Update connection status
        if (error.code) {
          connectionStatus.lastError = error;
          updateDataAgeIndicator();
        }
      }

      clearPendingVote();
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

    const foregroundEl = resultsEl.querySelector('.score-bar-foreground');
    const textEl = resultsEl.querySelector('.score-bar-text');

    if (!foregroundEl || !textEl) {
      resultsEl.innerHTML = `<div class="score-bar-visual">★★★★★<div class="score-bar-foreground" style="width: 0%;">★★★★★</div></div><div class="score-bar-text"></div>`;
    }

    const fg = resultsEl.querySelector('.score-bar-foreground');
    const txt = resultsEl.querySelector('.score-bar-text');

    if (data && data.total_votes > 0) {
      const average = data.total_score / data.total_votes;
      const percentage = (average / 5) * 100;

      const newWidth = `${percentage}%`;
      const newText = `평균: <strong>${average.toFixed(2)}</strong> (${data.total_votes}표)`;

      if (fg.style.width !== newWidth) fg.style.width = newWidth;
      if (txt.innerHTML !== newText) txt.innerHTML = newText;
    } else {
      if (fg.style.width !== '0%') fg.style.width = '0%';
      if (txt.textContent !== '투표 없음') txt.textContent = '투표 없음';
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
    const clickedImage = event.target.closest('.poll-image');
    if (clickedImage) {
      const fullImageUrl = clickedImage.dataset.fullImage;
      const skinName = clickedImage.dataset.skinName;
      const charName = clickedImage.dataset.charName;

      if (fullImageUrl && fullImageUrl !== 'null' && fullImageUrl !== 'undefined') {
        openImagePopup(fullImageUrl, skinName, charName);
      }
      return;
    }

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

  const refreshDataBtn = document.getElementById('refresh-data-btn');
  if (refreshDataBtn) {
    refreshDataBtn.addEventListener('click', refreshVoteData);
  }

  leaderboardToggleBtn.addEventListener('click', () => {
    leaderboardContent.classList.toggle('visible');
    leaderboardToggleBtn.textContent = leaderboardContent.classList.contains('visible') ? '🔼 리더보드 숨기기' : '🏆 Top 10 스킨 보기';
  });

  resetFiltersBtn.addEventListener('click', resetFilters);

  const applyFiltersDebounced = debounce(applyFilters, 150);

  [skinTypeSelect, factionSelect, tagSelect].forEach((el) => {
    el.addEventListener("change", applyFiltersDebounced);
  });

  rarityCheckboxes.querySelectorAll("input").forEach((checkbox) => {
    checkbox.addEventListener("change", applyFiltersDebounced);
  });

  sortSelect.addEventListener('change', () => {
    reSortView();
    updateURLWithFilters();
  });

  window.addEventListener('popstate', applyFiltersFromURL);

  closeImagePopupBtn.addEventListener('click', closeImagePopup);

  imagePopup.addEventListener('click', (event) => {
    if (event.target === imagePopup) {
      closeImagePopup();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && imagePopup.classList.contains('visible')) {
      closeImagePopup();
    }
  });

  const infoButton = document.getElementById('info-button');
  const infoPopup = document.getElementById('info-popup');

  if (infoButton && infoPopup) {
    const closePopupBtn = infoPopup.querySelector('.close-popup-btn');

    const closeInfoPopup = () => {
      infoPopup.classList.remove('visible');
      document.body.classList.remove('no-scroll');
    };

    infoButton.addEventListener('click', () => {
      infoPopup.classList.add('visible');
      document.body.classList.add('no-scroll');
    });

    if (closePopupBtn) {
      closePopupBtn.addEventListener('click', closeInfoPopup);
    }

    infoPopup.addEventListener('click', (event) => {
      if (event.target === infoPopup) {
        closeInfoPopup();
      }
    });
  }

});