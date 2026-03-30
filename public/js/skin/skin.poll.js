import {
  debounce, fetchJSONWithCache, getAllUrlParams, setUrlParams,
  getStorageItem, setStorageItem, showToast, createSearchIndex
} from '../utils.js';
import { createVirtualScroll } from './skin.poll.virtual-scroll.js';

/* ====================================
   SKIN POLL - MAIN SCRIPT
   (Aggregate-doc architecture)
   ==================================== */

// ====================================
// CONSTANTS & CONFIGURATION
// ====================================

const CACHE_VERSION = 'v3.0-aggregate';
const CACHE_DURATION_MS = 1000 * 60 * 60; // 1 hour
const REFRESH_COOLDOWN_MS = 60000; // 60 seconds
const MIN_VOTES_FOR_LEADERBOARD = 10;

// Featured Event Showcase
const FEATURED_SKIN_TYPE = '메이드 타임';

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCmtsfkzlISZDd0totgv3MIrpT9kvLvKLk",
  authDomain: "azurlane-skin-vote.firebaseapp.com",
  projectId: "azurlane-skin-vote",
  storageBucket: "azurlane-skin-vote.firebasestorage.app",
  messagingSenderId: "282702723033",
  appId: "1:282702723033:web:a97b60cb7138bdbbbacbc8",
};

// ====================================
// UTILITY FUNCTIONS
// ====================================

/**
 * Create SVG placeholder for broken images
 */
const createImageErrorHandler = () => {
  return (event) => {
    const img = event.target;
    if (img.dataset.errorHandled) return;
    img.dataset.errorHandled = 'true';

    const svgPlaceholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%2340444b'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23dcddde' font-family='sans-serif' font-size='14'%3E이미지 없음%3C/text%3E%3C/svg%3E";
    img.src = svgPlaceholder;
  };
};

// ====================================
// DOM READY - MAIN INITIALIZATION
// ====================================

document.addEventListener("DOMContentLoaded", async () => {

  // ====================================
  // DOM ELEMENTS
  // ====================================

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
  const refreshDataBtn = document.getElementById('refresh-data-btn');
  const filterToggleBtn = document.getElementById('filter-toggle-btn');
  const filterContainer = document.getElementById('filter-container');

  // Cache rarity checkboxes for performance
  const cachedRarityCheckboxes = Array.from(rarityCheckboxes.querySelectorAll('input'));

  // Image popup elements
  const imagePopup = document.getElementById('image-popup');
  const popupFullImage = document.getElementById('popup-full-image');
  const popupSkinName = document.getElementById('popup-skin-name');
  const popupCharName = document.getElementById('popup-char-name');
  const closeImagePopupBtn = document.querySelector('.close-image-popup-btn');

  // ====================================
  // STATE VARIABLES
  // ====================================

  let allSkins = [];                 // Array of skin objects from skin_poll_data.json
  let allCharacterNames = [];        // Unique character names (sorted)
  let characterFuse;                 // Fuse.js instance for fuzzy character search
  let allPollDataCache = {};         // { clientId: { total_votes, total_score, average_score, ... } }
  let clientIdToSkinMap = {};        // clientId → skin object (from allSkins)
  let currentlyDisplayedSkins = [];  // Filtered+sorted array fed to virtual scroll
  let pendingVote = null;
  let cachedTotalVotes = 0;
  let cachedLeaderboard = [];
  let userVotesCache = {};           // { clientId: { rating, skin_name, character_name, voted_at } }
  let currentUserId = null;
  let virtualScroll = null;

  // Fuse.js options for character search
  const fuseOptions = { keys: ['name'], threshold: 0.4 };

  // Refresh cooldown state
  let refreshCooldownTimer = null;
  let lastRefreshTime = 0;

  // Connection status tracking
  const connectionStatus = {
    isConnected: true,
    lastError: null,
    errorCount: 0
  };

  // Timer tracking for cleanup
  const activeTimers = {
    dataAgeInterval: null,
    refreshCooldown: null
  };

  // ====================================
  // FIREBASE INITIALIZATION
  // ====================================

  if (!firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
  }

  const db = firebase.firestore();
  const auth = firebase.auth();

  // Sign in anonymously
  try {
    const userCredential = await auth.signInAnonymously();
    currentUserId = userCredential.user.uid;
    console.log("Signed in anonymously:", currentUserId);
  } catch (error) {
    console.error("Anonymous sign-in failed:", error);
    showToast("인증에 실패했습니다. 페이지를 새로고침하세요.", "error");
    return;
  }

  // ====================================
  // CACHE MANAGEMENT
  // ====================================

  /**
   * Check and update cache version — clears stale localStorage entries
   */
  const initializeCacheVersion = () => {
    const currentVersion = getStorageItem("cache_version", null);
    if (currentVersion !== CACHE_VERSION) {
      console.log("Cache version updated. Clearing old data...");

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

      setStorageItem("cache_version", CACHE_VERSION);
      showToast("데이터가 업데이트되었습니다.", "info");
    }
  };

  /**
   * Save poll data (aggregate doc) to localStorage
   */
  const savePollDataToCache = (pollData) => {
    try {
      setStorageItem(`${CACHE_VERSION}_pollDataCache`, JSON.stringify({
        data: pollData,
        timestamp: Date.now(),
        version: CACHE_VERSION
      }));
      setStorageItem(`${CACHE_VERSION}_pollDataTimestamp`, String(Date.now()));
      console.log(`Saved ${Object.keys(pollData).length} poll entries to cache`);
    } catch (e) {
      console.warn("Cache save failed:", e);
    }
  };

  /**
   * Load poll data from localStorage
   */
  const loadPollDataFromCache = () => {
    try {
      const cached = getStorageItem(`${CACHE_VERSION}_pollDataCache`, null);
      if (!cached) return { data: null, timestamp: null };

      const { data, timestamp, version } = JSON.parse(cached);

      if (version !== CACHE_VERSION) {
        console.log("Cache version mismatch, invalidating...");
        return { data: null, timestamp: null };
      }

      const age = Date.now() - timestamp;
      if (age > CACHE_DURATION_MS) {
        console.log("Cache expired (age: " + Math.round(age / 1000 / 60) + " minutes)");
        return { data: null, timestamp };
      }

      console.log(`Loaded ${Object.keys(data).length} poll entries from cache (age: ${Math.round(age / 1000)}s)`);
      return { data, timestamp };
    } catch (e) {
      console.warn("Cache load failed:", e);
      return { data: null, timestamp: null };
    }
  };

  /**
   * Save leaderboard to localStorage
   */
  const saveLeaderboardToCache = (leaderboard, totalVotes) => {
    try {
      setStorageItem(`${CACHE_VERSION}_leaderboardCache`, JSON.stringify({
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
   * Load leaderboard from localStorage
   */
  const loadLeaderboardFromCache = () => {
    try {
      const cached = getStorageItem(`${CACHE_VERSION}_leaderboardCache`, null);
      if (!cached) return null;

      const { leaderboard, totalVotes, timestamp, version } = JSON.parse(cached);

      if (version !== CACHE_VERSION) return null;

      const age = Date.now() - timestamp;
      if (age > CACHE_DURATION_MS) return null;

      console.log("Loaded leaderboard from cache");
      return { leaderboard, totalVotes };
    } catch (e) {
      return null;
    }
  };

  /**
   * Save user votes to localStorage
   * userVotesCache is an Object: { clientId: { rating, skin_name, character_name, voted_at } }
   */
  const saveUserVotesToCache = (votesObj) => {
    try {
      setStorageItem(`${CACHE_VERSION}_userVotesCache`, JSON.stringify({
        votes: votesObj,
        timestamp: Date.now(),
        userId: currentUserId,
        version: CACHE_VERSION
      }));
    } catch (e) {
      console.warn("User votes cache save failed:", e);
    }
  };

  /**
   * Load user votes from localStorage
   */
  const loadUserVotesFromCache = () => {
    try {
      const cached = getStorageItem(`${CACHE_VERSION}_userVotesCache`, null);
      if (!cached) return null;

      const { votes, timestamp, userId, version } = JSON.parse(cached);

      if (version !== CACHE_VERSION || userId !== currentUserId) return null;

      const age = Date.now() - timestamp;
      if (age > CACHE_DURATION_MS) return null;

      console.log(`Loaded ${Object.keys(votes).length} user votes from cache`);
      return votes;
    } catch (e) {
      return null;
    }
  };

  // ====================================
  // DATA AGE INDICATOR
  // ====================================

  /**
   * Update data age indicator with connection status
   */
  const updateDataAgeIndicator = () => {
    const cacheTimestamp = getStorageItem(`${CACHE_VERSION}_pollDataTimestamp`, null);
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

  // ====================================
  // FIRESTORE OPERATIONS (Aggregate-doc)
  // ====================================

  /**
   * Load initial data from Firestore: poll data, leaderboard, user votes.
   * Uses localStorage cache where available; fetches only what's missing.
   * All three sources are single-document reads.
   */
  const loadInitialData = async () => {
    // Check caches first
    const cachedPoll = loadPollDataFromCache();
    const cachedLB = loadLeaderboardFromCache();
    const cachedVotes = loadUserVotesFromCache();

    // Build list of fetches needed
    const fetches = {};

    if (cachedPoll.data && Object.keys(cachedPoll.data).length > 0) {
      allPollDataCache = cachedPoll.data;
      console.log("Using cached poll data (0 reads)");
    } else {
      fetches.poll = db.doc('metadata/all_poll_results').get();
    }

    if (cachedLB) {
      cachedTotalVotes = cachedLB.totalVotes || 0;
      cachedLeaderboard = cachedLB.leaderboard || [];
      console.log("Using cached leaderboard (0 reads)");
    } else {
      fetches.leaderboard = db.doc('metadata/leaderboard').get();
    }

    if (cachedVotes) {
      userVotesCache = cachedVotes;
      console.log("Using cached user votes (0 reads)");
    } else {
      fetches.userVotes = db.doc(`user_votes/${currentUserId}`).get();
    }

    // Fetch only what's needed (parallel)
    const fetchKeys = Object.keys(fetches);
    if (fetchKeys.length === 0) return;

    try {
      const results = await Promise.all(fetchKeys.map(k => fetches[k]));
      const fetchMap = {};
      fetchKeys.forEach((k, i) => { fetchMap[k] = results[i]; });

      // Process poll data
      if (fetchMap.poll) {
        const doc = fetchMap.poll;
        if (doc.exists) {
          allPollDataCache = doc.data() || {};
          console.log(`Fetched ${Object.keys(allPollDataCache).length} poll entries from aggregate doc (1 read)`);
        } else {
          allPollDataCache = {};
          console.log("Aggregate poll doc does not exist yet");
        }
        savePollDataToCache(allPollDataCache);
      }

      // Process leaderboard
      if (fetchMap.leaderboard) {
        const doc = fetchMap.leaderboard;
        if (doc.exists) {
          const data = doc.data();
          cachedTotalVotes = data.totalVotes || 0;
          cachedLeaderboard = data.leaderboard || [];
          saveLeaderboardToCache(cachedLeaderboard, cachedTotalVotes);
          console.log("Fetched leaderboard (1 read)");
        }
      }

      // Process user votes
      if (fetchMap.userVotes) {
        const doc = fetchMap.userVotes;
        if (doc.exists) {
          // Cloud Function stores: { clientId: { rating, skin_name, character_name, voted_at } }
          userVotesCache = doc.data() || {};
          console.log(`Fetched ${Object.keys(userVotesCache).length} user votes (1 read)`);
        } else {
          userVotesCache = {};
        }
        saveUserVotesToCache(userVotesCache);
      }

      // Clear connection errors on success
      connectionStatus.isConnected = true;
      connectionStatus.lastError = null;
      connectionStatus.errorCount = 0;

    } catch (error) {
      console.error("Error during loadInitialData:", error);
      connectionStatus.isConnected = false;
      connectionStatus.lastError = error;
      connectionStatus.errorCount++;
      updateDataAgeIndicator();

      if (error.code === 'resource-exhausted') {
        showToast("Firestore 일일 한도 초과. 내일 다시 시도하세요.", "error");
      } else if (error.code === 'permission-denied') {
        showToast("권한 오류가 발생했습니다.", "error");
      } else {
        showToast("초기 데이터 로드 실패. 새로고침 버튼을 눌러주세요.", "error");
      }
    }
  };

  // ====================================
  // VOTE SUBMISSION (queue write)
  // ====================================

  /**
   * Submit vote via vote_queue collection.
   * Zero reads, one write. Cloud Function processes the queue asynchronously.
   */
  const submitVote = async (clientId, rating, skinName, characterName, displaySkinId) => {
    const userId = currentUserId;

    // Check if already voted
    if (userVotesCache[clientId] !== undefined) {
      showToast("이미 이 스킨에 투표하셨습니다!", "error");
      return;
    }

    console.log(`Submitting vote: User=${userId}, Skin=${clientId}, Rating=${rating}`);

    try {
      // Single write to vote_queue — Cloud Function handles the rest
      await db.collection('vote_queue').add({
        userId: userId,
        clientId: clientId,
        rating: rating,
        skinName: skinName,
        characterName: characterName,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

      console.log("Vote queued (1 write)");

      // Optimistic update: mark as voted locally
      userVotesCache[clientId] = {
        rating: rating,
        skin_name: skinName,
        character_name: characterName,
        voted_at: new Date().toISOString()
      };
      saveUserVotesToCache(userVotesCache);

      // Update rating area UI
      const ratingArea = document.querySelector(`.rating-area[data-client-id="${clientId}"]`);
      if (ratingArea) {
        ratingArea.classList.remove('pending-vote');
        ratingArea.classList.add("voted", "voted-animation");
        ratingArea.querySelectorAll('input').forEach(input => input.disabled = true);
        setTimeout(() => ratingArea.classList.remove("voted-animation"), 300);
      }

      // Optimistic update: update poll data cache
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

      // Update the skin in currentlyDisplayedSkins so sort order reflects new data
      const skinInArray = currentlyDisplayedSkins.find(s => String(s["클뜯 id"]) === clientId);
      if (skinInArray) {
        skinInArray.total_votes = allPollDataCache[clientId].total_votes;
        skinInArray.average_score = allPollDataCache[clientId].average_score;
      }

      // Update leaderboard locally (no Firestore write — Cloud Function does it)
      const newLeaderboard = recalculateLeaderboardLocal(clientId);
      populateLeaderboard(newLeaderboard);

      updateDataAgeIndicator();
      showToast(`${skinName}에 ${rating}점 투표 완료!`, "success");

    } catch (error) {
      console.error("Vote submission failed:", error);
      showToast("투표를 저장하는 데 실패했습니다. 다시 시도해 주세요.", "error");

      if (error.code) {
        connectionStatus.lastError = error;
        updateDataAgeIndicator();
      }

      clearPendingVote();
    }
  };

  // ====================================
  // REAL-TIME SYNC (single-doc listener)
  // ====================================

  /**
   * Setup real-time listener on the single aggregate document.
   * Pauses when tab is hidden; resumes when visible.
   */
  const setupRealtimeSync = () => {
    let isTabActive = !document.hidden;
    let realtimeUnsubscribe = null;

    const startRealtimeSync = () => {
      if (realtimeUnsubscribe) return;

      console.log("Starting real-time sync on aggregate doc...");

      realtimeUnsubscribe = db.doc('metadata/all_poll_results').onSnapshot(
        // Success callback
        (doc) => {
          connectionStatus.isConnected = true;
          connectionStatus.lastError = null;
          connectionStatus.errorCount = 0;

          if (doc.exists) {
            const newData = doc.data() || {};
            let updatedCount = 0;

            // Diff: find changed entries and update score displays
            for (const [clientId, pollEntry] of Object.entries(newData)) {
              const old = allPollDataCache[clientId];
              if (!old || old.total_votes !== pollEntry.total_votes ||
                  old.average_score !== pollEntry.average_score) {
                updatedCount++;
                updateScoreDisplay(clientId, pollEntry);
              }
            }

            allPollDataCache = newData;

            if (updatedCount > 0) {
              console.log(`Real-time update: ${updatedCount} skins changed`);

              const newLeaderboard = recalculateLeaderboardLocal();
              populateLeaderboard(newLeaderboard);

              savePollDataToCache(allPollDataCache);
            }
          }

          updateDataAgeIndicator();
        },
        // Error callback
        (error) => {
          console.error("Real-time listener error:", error);

          connectionStatus.isConnected = false;
          connectionStatus.lastError = error;
          connectionStatus.errorCount++;

          // Clean up the broken listener
          if (realtimeUnsubscribe) {
            realtimeUnsubscribe();
            realtimeUnsubscribe = null;
          }

          updateDataAgeIndicator();

          if (error.code === 'resource-exhausted') {
            showToast("Firestore 일일 한도 초과. 내일 다시 시도하세요.", "error");
          } else if (error.code === 'permission-denied') {
            showToast("권한 오류. 페이지를 새로고침하세요.", "error");
          } else if (error.code === 'unavailable') {
            showToast("서버 연결 불안정. 잠시 후 재시도합니다.", "error");
          } else {
            showToast(`실시간 동기화 오류: ${error.message}`, "error");
          }

          // Exponential backoff retry
          const retryDelay = Math.min(5000 * Math.pow(2, connectionStatus.errorCount - 1), 60000);
          console.log(`Retrying in ${retryDelay / 1000}s...`);

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

      console.log("Pausing real-time sync (tab inactive)");
      realtimeUnsubscribe();
      realtimeUnsubscribe = null;
    };

    // Tab visibility handling
    document.addEventListener('visibilitychange', () => {
      isTabActive = !document.hidden;

      if (isTabActive) {
        startRealtimeSync();
      } else {
        stopRealtimeSync();
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

  // ====================================
  // LEADERBOARD LOGIC (local only)
  // ====================================

  /**
   * Recalculate leaderboard locally from allPollDataCache.
   * No Firestore write — the Cloud Function maintains the server copy.
   */
  const recalculateLeaderboardLocal = (votedClientId = null) => {
    if (votedClientId) {
      const votedSkinData = allPollDataCache[votedClientId];
      const currentTop10Ids = new Set(cachedLeaderboard.map(s => s.clientId || s.id));

      if (votedSkinData && votedSkinData.total_votes < MIN_VOTES_FOR_LEADERBOARD &&
          !currentTop10Ids.has(votedClientId)) {
        console.log(`Skipping leaderboard recalculation (skin has ${votedSkinData.total_votes} votes)`);
        return cachedLeaderboard;
      }
    }

    const rankedSkins = Object.keys(allPollDataCache).map(clientId => {
      const poll = allPollDataCache[clientId];
      const skinInfo = clientIdToSkinMap[clientId];
      if (!poll || !poll.total_votes || poll.total_votes < MIN_VOTES_FOR_LEADERBOARD) return null;

      return {
        clientId: clientId,
        skin_name: skinInfo ? skinInfo["한글 함순이 + 스킨 이름"] : (poll.skin_name || 'Unknown Skin'),
        character_name: skinInfo ? skinInfo["함순이 이름"] : (poll.character_name || 'Unknown'),
        imageUrl: skinInfo ? skinInfo["깔끔한 일러"] : null,
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

    return top10;
  };

  /**
   * Populate leaderboard UI.
   * Handles both Cloud Function format (clientId, skin_name, character_name, average_score, total_votes)
   * and locally-computed format (which additionally has imageUrl from allSkins).
   */
  const populateLeaderboard = (leaderboardData) => {
    if (!leaderboardData || leaderboardData.length === 0) {
      leaderboardContent.innerHTML = `<p style="text-align: center; color: #b9bbbe;">리더보드에 표시할 스킨이 아직 없습니다. (최소 10표 필요)</p>`;
      return;
    }

    leaderboardContent.innerHTML = leaderboardData.map((skin, index) => {
      // Resolve display values — handle both CF format and local format
      const cid = skin.clientId || skin.id;
      const localSkin = cid ? clientIdToSkinMap[cid] : null;

      const displayName = skin.skin_name || skin.name || localSkin?.["한글 함순이 + 스킨 이름"] || 'Unknown Skin';
      const charName = skin.character_name || skin.charName || localSkin?.["함순이 이름"] || 'Unknown';
      const imageUrl = skin.imageUrl || localSkin?.["깔끔한 일러"] || '';
      const avgScore = skin.average_score ?? 0;
      const totalVotes = skin.total_votes ?? 0;

      return `
      <div class="leaderboard-item">
        <div class="leaderboard-rank">#${index + 1}</div>
        <img src="${imageUrl}" class="leaderboard-image" loading="lazy">
        <div class="leaderboard-details">
          <div class="skin-name">${displayName}</div>
          <div class="char-name">${charName}</div>
        </div>
        <div class="leaderboard-score">
          <div class="avg-score">★ ${avgScore.toFixed(2)}</div>
          <div class="total-votes">(${totalVotes} 표)</div>
        </div>
      </div>`;
    }).join('');

    // Add image error handlers to leaderboard images
    leaderboardContent.querySelectorAll('.leaderboard-image').forEach(img => {
      img.addEventListener('error', createImageErrorHandler());
    });
  };

  // ====================================
  // UI RENDERING
  // ====================================

  /**
   * Display skeleton loader
   */
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

  /**
   * Create a single poll card DOM element.
   * Used as the renderCard callback for virtual scroll.
   */
  const createPollCard = (skin) => {
    const skinId = skin.id;
    const clientId = String(skin["클뜯 id"]);

    const hasVoted = userVotesCache[clientId] !== undefined;
    const votedRating = hasVoted ? String(userVotesCache[clientId].rating) : null;

    const pollBox = document.createElement("div");
    pollBox.className = "poll-box";
    pollBox.id = `poll-box-${skinId}`;

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

    // Add image error handler
    const pollImage = pollBox.querySelector('.poll-image');
    if (pollImage) {
      pollImage.addEventListener('error', createImageErrorHandler());
    }

    // Initialize score display in the newly created card
    const pollData = allPollDataCache[clientId];
    if (pollData) {
      const resultsEl = pollBox.querySelector(`#results-${clientId}`);
      if (resultsEl) {
        const average = pollData.total_votes > 0
          ? pollData.total_score / pollData.total_votes
          : 0;
        const percentage = (average / 5) * 100;

        resultsEl.innerHTML = `<div class="score-bar-visual">★★★★★<div class="score-bar-foreground" style="width: ${percentage}%;">★★★★★</div></div><div class="score-bar-text">${
          pollData.total_votes > 0
            ? `평균: <strong>${average.toFixed(2)}</strong> (${pollData.total_votes}표)`
            : '투표 없음'
        }</div>`;
      }
    } else {
      const resultsEl = pollBox.querySelector(`#results-${clientId}`);
      if (resultsEl) {
        resultsEl.innerHTML = `<div class="score-bar-visual">★★★★★<div class="score-bar-foreground" style="width: 0%;">★★★★★</div></div><div class="score-bar-text">투표 없음</div>`;
      }
    }

    return pollBox;
  };

  /**
   * Update score display for a skin (used by real-time updates on already-rendered cards)
   */
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

  // ====================================
  // FILTERING & SORTING
  // ====================================

  /**
   * Apply filters, sort, and push to virtual scroll
   */
  const applyFilters = () => {
    const selectedCharName = characterNameSearch.value;
    const selectedType = skinTypeSelect.value;
    const selectedFaction = factionSelect.value;
    const selectedTag = tagSelect.value;
    const selectedRarities = cachedRarityCheckboxes.filter(cb => cb.checked).map(cb => cb.value);

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

    // Enrich with poll data for sorting
    currentlyDisplayedSkins = filteredSkins.map(skin => {
      const clientId = String(skin["클뜯 id"]);
      const data = allPollDataCache[clientId];
      return {
        ...skin,
        total_votes: data?.total_votes || 0,
        average_score: (data && data.total_votes > 0) ? (data.total_score / data.total_votes) : 0
      };
    });

    applySorting();
    updateURLWithFilters();
  };

  /**
   * Sort currentlyDisplayedSkins and update virtual scroll
   */
  const applySorting = () => {
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

    if (virtualScroll) {
      virtualScroll.setItems(currentlyDisplayedSkins);
    }
  };

  /**
   * Reset all filters
   */
  const resetFilters = () => {
    characterNameSearch.value = "";
    skinTypeSelect.value = "all";
    factionSelect.value = "all";
    tagSelect.value = "all";
    sortSelect.value = "default";
    cachedRarityCheckboxes.forEach(checkbox => {
      checkbox.checked = true;
    });
    applyFilters();
  };

  // ====================================
  // URL STATE MANAGEMENT
  // ====================================

  /**
   * Update URL with current filter state
   */
  const updateURLWithFilters = () => {
    const selectedRarities = cachedRarityCheckboxes.filter(cb => cb.checked).map(cb => cb.value);
    setUrlParams({
      character: characterNameSearch.value || null,
      type: skinTypeSelect.value !== 'all' ? skinTypeSelect.value : null,
      faction: factionSelect.value !== 'all' ? factionSelect.value : null,
      tag: tagSelect.value !== 'all' ? tagSelect.value : null,
      sort: sortSelect.value !== 'default' ? sortSelect.value : null,
      rarities: selectedRarities.length < 5 ? selectedRarities.join(',') : null,
    }, { replace: false, clear: true });
  };

  /**
   * Apply filters from URL parameters.
   * If no URL parameters exist (first visit), showcase featured event skins.
   */
  const applyFiltersFromURL = () => {
    const params = getAllUrlParams();

    if (Object.keys(params).length === 0) {
      // First visit with no URL params - showcase featured event
      skinTypeSelect.value = FEATURED_SKIN_TYPE;
    } else {
      // Returning visit or shared link - respect URL parameters
      characterNameSearch.value = params.character || '';
      skinTypeSelect.value = params.type || 'all';
      factionSelect.value = params.faction || 'all';
      tagSelect.value = params.tag || 'all';
      sortSelect.value = params.sort || 'default';
      const raritiesParam = params.rarities;
      if (raritiesParam) {
        const activeRarities = raritiesParam.split(',');
        cachedRarityCheckboxes.forEach(cb => {
          cb.checked = activeRarities.includes(cb.value);
        });
      }
    }
    applyFilters();
  };

  // ====================================
  // DROPDOWN HELPERS
  // ====================================

  /**
   * Populate dropdown with Fuse.js results (with highlighting)
   */
  const populateDropdown = (dropdownEl, results, onSelectCallback) => {
    dropdownEl.innerHTML = '';
    if (results.length === 0) {
      dropdownEl.innerHTML = `<div class="no-results">검색 결과가 없습니다</div>`;
      return;
    }

    results.forEach((result) => {
      const item = result.item;
      const matches = result.matches;
      const a = document.createElement('a');
      a.setAttribute('role', 'option');
      a.setAttribute('tabindex', '0');

      // Highlight matches if available
      if (matches && matches.length > 0 && matches[0].indices) {
        let highlightedName = '';
        let lastIndex = 0;
        matches[0].indices.forEach(([start, end]) => {
          highlightedName += item.name.substring(lastIndex, start);
          highlightedName += `<mark>${item.name.substring(start, end + 1)}</mark>`;
          lastIndex = end + 1;
        });
        highlightedName += item.name.substring(lastIndex);
        a.innerHTML = highlightedName;
      } else {
        a.textContent = item.name;
      }

      a.addEventListener('click', () => onSelectCallback(item.name));
      a.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') onSelectCallback(item.name);
      });
      dropdownEl.appendChild(a);
    });
  };

  /**
   * Setup dropdown with Fuse.js fuzzy search
   */
  const setupDropdown = (inputEl, dropdownEl, getFuseInstance, onSelectCallback) => {
    const handleFilter = () => {
      const fuse = getFuseInstance();
      if (!fuse) return;

      const searchTerm = inputEl.value;
      if (searchTerm.trim() === '') {
        // Show all items when empty
        const allItems = fuse.getIndex().docs.map(doc => ({ item: doc, matches: [] }));
        populateDropdown(dropdownEl, allItems, onSelectCallback);
      } else {
        // Fuzzy search with highlighting
        const results = fuse.search(searchTerm);
        populateDropdown(dropdownEl, results, onSelectCallback);
      }
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

  /**
   * Handle character selection from dropdown
   */
  const handleCharacterSelect = (characterName) => {
    characterNameSearch.value = characterName;
    characterDropdownContent.style.display = 'none';
    applyFilters();
  };

  // ====================================
  // POPUP HANDLERS
  // ====================================

  /**
   * Open image popup
   */
  const openImagePopup = (fullImageUrl, skinName, charName) => {
    popupFullImage.addEventListener('error', createImageErrorHandler(), { once: true });

    popupFullImage.src = fullImageUrl;
    popupSkinName.textContent = skinName;
    popupCharName.textContent = charName;
    imagePopup.classList.add('visible');
    document.body.classList.add('no-scroll');
  };

  /**
   * Close image popup
   */
  const closeImagePopup = () => {
    imagePopup.classList.remove('visible');
    document.body.classList.remove('no-scroll');
    setTimeout(() => {
      popupFullImage.src = '';
    }, 300);
  };

  // ====================================
  // VOTING LOGIC
  // ====================================

  /**
   * Clear pending vote state
   */
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

  // ====================================
  // REFRESH DATA
  // ====================================

  /**
   * Start refresh cooldown timer
   */
  const startRefreshCooldown = () => {
    if (!refreshDataBtn) return;

    let secondsLeft = Math.ceil(REFRESH_COOLDOWN_MS / 1000);
    refreshDataBtn.disabled = true;

    const updateButtonText = () => {
      if (secondsLeft > 0) {
        refreshDataBtn.innerHTML = `<i class="fas fa-clock"></i> ${secondsLeft}초`;
      } else {
        clearInterval(refreshCooldownTimer);
        refreshDataBtn.disabled = false;
        refreshDataBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
      }
    };

    updateButtonText();
    refreshCooldownTimer = setInterval(() => {
      secondsLeft--;
      updateButtonText();
    }, 1000);
    activeTimers.refreshCooldown = refreshCooldownTimer;
  };

  /**
   * Refresh vote data from Firestore (manual refresh button)
   */
  const refreshVoteData = async () => {
    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshTime;

    if (timeSinceLastRefresh < REFRESH_COOLDOWN_MS) {
      const remainingSeconds = Math.ceil((REFRESH_COOLDOWN_MS - timeSinceLastRefresh) / 1000);
      showToast(`${remainingSeconds}초 후에 다시 시도하세요`, "error");
      return;
    }

    if (refreshDataBtn) {
      refreshDataBtn.classList.add('loading');
      refreshDataBtn.disabled = true;
      refreshDataBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
    }

    showToast("투표 데이터 업데이트 중...", "info");

    try {
      lastRefreshTime = now;

      // Fetch fresh aggregate doc (1 read)
      const doc = await db.doc('metadata/all_poll_results').get();
      if (doc.exists) {
        allPollDataCache = doc.data() || {};
        savePollDataToCache(allPollDataCache);
        console.log(`Refreshed ${Object.keys(allPollDataCache).length} poll entries (1 read)`);
      }

      connectionStatus.isConnected = true;
      connectionStatus.lastError = null;
      connectionStatus.errorCount = 0;

      applyFilters();

      const newLeaderboard = recalculateLeaderboardLocal();
      populateLeaderboard(newLeaderboard);
      updateDataAgeIndicator();

      showToast("최신 데이터로 업데이트되었습니다!", "success");

      if (refreshDataBtn) {
        refreshDataBtn.classList.remove('loading');
        startRefreshCooldown();
      }

    } catch (error) {
      console.error("Error refreshing data:", error);

      connectionStatus.isConnected = false;
      connectionStatus.lastError = error;
      connectionStatus.errorCount++;

      updateDataAgeIndicator();

      if (error.code === 'resource-exhausted') {
        showToast("Firestore 일일 한도 초과. 내일 다시 시도하세요.", "error");
      } else if (error.code === 'permission-denied') {
        showToast("권한 오류가 발생했습니다.", "error");
      } else if (error.code === 'unavailable') {
        showToast("서버에 연결할 수 없습니다.", "error");
      } else {
        showToast(`데이터 새로고침 실패: ${error.message}`, "error");
      }

      lastRefreshTime = 0;

      if (refreshDataBtn) {
        refreshDataBtn.classList.remove('loading');
        refreshDataBtn.disabled = false;
        refreshDataBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
      }
    }
  };

  // ====================================
  // EVENT LISTENERS
  // ====================================

  // Poll container click handling (voting & image popup) — delegated
  pollContainer.addEventListener("click", (event) => {
    // Image popup handler
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

    // Voting handler
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

  // Click outside to clear pending vote
  document.addEventListener('click', (event) => {
    if (pendingVote && !event.target.closest(`.rating-area[data-client-id="${pendingVote.clientId}"]`)) {
      clearPendingVote();
    }
  });

  // Refresh button
  if (refreshDataBtn) {
    refreshDataBtn.addEventListener('click', refreshVoteData);
  }

  // Leaderboard toggle
  leaderboardToggleBtn.addEventListener('click', () => {
    leaderboardContent.classList.toggle('visible');
    leaderboardToggleBtn.textContent = leaderboardContent.classList.contains('visible') ? '리더보드 숨기기' : 'Top 10 스킨 보기';
  });

  // Reset filters button
  resetFiltersBtn.addEventListener('click', resetFilters);

  // Mobile filter toggle
  if (filterToggleBtn && filterContainer) {
    filterToggleBtn.addEventListener('click', () => {
      filterContainer.classList.toggle('visible');
      filterToggleBtn.classList.toggle('active');
    });
  }

  // Filter change listeners
  const applyFiltersDebounced = debounce(applyFilters, 150);

  [skinTypeSelect, factionSelect, tagSelect].forEach((el) => {
    el.addEventListener("change", applyFiltersDebounced);
  });

  cachedRarityCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", applyFiltersDebounced);
  });

  sortSelect.addEventListener('change', () => {
    applySorting();
    updateURLWithFilters();
  });

  // URL state management
  window.addEventListener('popstate', applyFiltersFromURL);

  // Image popup close handlers
  closeImagePopupBtn.addEventListener('click', closeImagePopup);
  imagePopup.addEventListener('click', (event) => {
    if (event.target === imagePopup) {
      closeImagePopup();
    }
  });

  // Keyboard handler for image popup
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && imagePopup.classList.contains('visible')) {
      closeImagePopup();
    }
  });

  // ====================================
  // MAIN INIT SEQUENCE
  // ====================================

  // 1. Initialize cache version
  initializeCacheVersion();

  // 2. Show skeleton loader
  displaySkeletonLoader();

  try {
    // 3. Fetch lightweight skin poll data (~750KB instead of 20MB)
    const jsonData = await fetchJSONWithCache("data/skin/skin_poll_data.json");

    // 4. Build allSkins, maps, character search
    allSkins = Object.keys(jsonData).map((key) => ({ id: key, ...jsonData[key] }))
      .filter(skin => skin["한글 함순이 + 스킨 이름"] && skin["함순이 이름"] && skin["클뜯 id"]);

    allSkins.forEach(skin => {
      const clientId = String(skin["클뜯 id"]);
      clientIdToSkinMap[clientId] = skin;
    });

    allCharacterNames = [...new Set(allSkins.map((s) => s["함순이 이름"]))].filter(Boolean).sort();

    // Initialize Fuse.js for character search
    const characterDataForFuse = allCharacterNames.map(name => ({ name }));
    characterFuse = createSearchIndex(characterDataForFuse, fuseOptions);

    // Setup character search dropdown with Fuse.js
    setupDropdown(characterNameSearch, characterDropdownContent, () => characterFuse, handleCharacterSelect);

    // 5. Load initial Firestore data (poll results, leaderboard, user votes)
    await loadInitialData();

    // 6. Create virtual scroll
    virtualScroll = createVirtualScroll({
      container: pollContainer,
      renderCard: createPollCard,
      buffer: 10,
    });

    // 7. Setup real-time sync on aggregate doc
    setupRealtimeSync();

    // 8. Data age indicator + interval
    updateDataAgeIndicator();
    activeTimers.dataAgeInterval = setInterval(updateDataAgeIndicator, 60000);

    // 9. Populate leaderboard
    populateLeaderboard(cachedLeaderboard);

    // 10. Apply filters from URL (or featured event on first visit)
    applyFiltersFromURL();

  } catch (error) {
    console.error("Error loading skin data:", error);
    showToast("스킨 데이터 로드 실패", "error");
  }

  // ====================================
  // CLEANUP
  // ====================================

  /**
   * Cleanup function to prevent memory leaks
   */
  const cleanup = () => {
    console.log("Cleaning up skin-poll resources...");

    // Clear all intervals
    if (activeTimers.dataAgeInterval) {
      clearInterval(activeTimers.dataAgeInterval);
      activeTimers.dataAgeInterval = null;
    }

    if (activeTimers.refreshCooldown) {
      clearInterval(activeTimers.refreshCooldown);
      activeTimers.refreshCooldown = null;
    }

    // Destroy virtual scroll (removes scroll/resize listeners)
    if (virtualScroll) {
      virtualScroll.destroy();
      virtualScroll = null;
    }

    console.log("Cleanup complete");
  };

  // Expose cleanup method globally for manual cleanup if needed
  window.skinPollCleanup = cleanup;

  // Auto-cleanup on page unload
  window.addEventListener('beforeunload', cleanup);
});
