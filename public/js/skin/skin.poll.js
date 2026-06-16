/**
 * skin.poll.js
 * Skin poll/voting page controller. Lets users rate skins 1–5 stars.
 * Uses Firebase Firestore (anonymous auth) with an aggregate-doc architecture:
 * all vote results in one document (metadata/all_poll_results) for minimal reads.
 * Votes are written to vote_queue; a Cloud Function processes them asynchronously.
 * Real-time sync via Firestore onSnapshot, paused when the tab is hidden.
 * Virtual scroll (skin.poll.virtual-scroll.js) keeps DOM light across hundreds of cards.
 * Part of the skin module group.
 */
import {
  debounce, fetchJSONWithCache, getAllUrlParams, setUrlParams,
  getStorageItem, setStorageItem, showToast, createSearchIndex, ensureFuse,
  lockBodyScroll, unlockBodyScroll, renderStatus
} from '../utils.js';
import { createVirtualScroll } from './skin.poll.virtual-scroll.js';

// ===== Constants & Configuration =====

const CACHE_VERSION = 'v3.1-aggregate';
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

// ===== Utility Functions =====

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

const createIcon = (className) => {
  const icon = document.createElement('i');
  icon.className = className;
  icon.setAttribute('aria-hidden', 'true');
  return icon;
};

const setStatusIndicator = (indicator, iconClass, text, state = '') => {
  indicator.replaceChildren(createIcon(iconClass), document.createTextNode(text));
  indicator.classList.remove('status-error', 'status-warning', 'status-loading');
  if (state) indicator.classList.add(`status-${state}`);
};

const appendTextWithMark = (parent, text, ranges = []) => {
  let lastIndex = 0;
  ranges.forEach(([start, end]) => {
    if (start > lastIndex) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex, start)));
    }

    const mark = document.createElement('mark');
    mark.textContent = text.slice(start, end + 1);
    parent.appendChild(mark);
    lastIndex = end + 1;
  });

  if (lastIndex < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
};

const createTextLine = (label, value) => {
  const line = document.createElement('div');
  line.className = 'info-line';

  const strong = document.createElement('strong');
  strong.textContent = label;

  line.append(strong, document.createTextNode(` ${value}`));
  return line;
};

const setButtonIconText = (button, iconClass, text = '') => {
  button.replaceChildren(createIcon(iconClass));
  if (text) button.appendChild(document.createTextNode(` ${text}`));
};

// ===== DOM Ready — Main Initialization =====

document.addEventListener("DOMContentLoaded", async () => {

  // ===== DOM Elements =====

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

  // ===== State Variables =====

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
  let realtimeSyncCleanup = null;

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
    refreshCooldown: null,
    realtimeRetry: null
  };

  // ===== Firebase Initialization =====

  if (typeof firebase === 'undefined') {
    pollContainer.replaceChildren();
    showToast("Firebase SDK를 불러오지 못했습니다. 네트워크 또는 CSP 설정을 확인하세요.", "error");
    return;
  }

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

  // ===== Cache Management =====

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

  // ===== Data Age Indicator =====

  /**
   * Update data age indicator with connection status
   */
  const updateDataAgeIndicator = () => {
    const cacheTimestamp = getStorageItem(`${CACHE_VERSION}_pollDataTimestamp`, null);
    const indicator = document.getElementById('data-age-indicator');

    if (!indicator) return;

    // Check connection status first
    if (!connectionStatus.isConnected) {
      setStatusIndicator(indicator, 'fas fa-exclamation-circle', '서버 연결 실패', 'error');
      return;
    }

    if (connectionStatus.lastError) {
      if (connectionStatus.lastError.code === 'resource-exhausted') {
        setStatusIndicator(indicator, 'fas fa-ban', '일일 한도 초과 (내일 재시도)', 'error');
      } else if (connectionStatus.lastError.code === 'permission-denied') {
        setStatusIndicator(indicator, 'fas fa-lock', '권한 오류', 'error');
      } else {
        setStatusIndicator(indicator, 'fas fa-exclamation-triangle', '연결 불안정', 'warning');
      }
      return;
    }

    if (!cacheTimestamp) {
      setStatusIndicator(indicator, 'fas fa-spinner fa-spin', '데이터 로딩 중...', 'loading');
      return;
    }

    const cacheAge = Date.now() - parseInt(cacheTimestamp);
    const ageMinutes = Math.floor(cacheAge / 60000);

    // Reset styles for normal operation
    indicator.classList.remove('status-error', 'status-warning', 'status-loading');

    if (ageMinutes < 2) {
      setStatusIndicator(indicator, 'fas fa-circle status-icon-success', '실시간 동기화 중');
    } else if (ageMinutes < 30) {
      setStatusIndicator(indicator, 'fas fa-clock status-icon-warning', `데이터: ${ageMinutes}분 전`);
    } else {
      setStatusIndicator(indicator, 'fas fa-exclamation-triangle status-icon-error', `데이터: ${ageMinutes}분 전`);
    }
  };

  // ===== Firestore Operations (Aggregate-doc) =====

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

  // ===== Vote Submission =====

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
      // Single write to vote_queue — Cloud Function handles the rest.
      // Deterministic doc ID {uid}_{clientId}: security rules only allow `create`
      // on exactly this ID, so duplicate votes for the same skin are rejected at
      // the rules layer (no Cloud Function invocation, no quota cost).
      await db.collection('vote_queue').doc(`${userId}_${clientId}`).set({
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
        ratingArea.querySelectorAll('.star-rating label').forEach(label => {
          label.tabIndex = -1;
        });
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
      // permission-denied on this path = the {uid}_{clientId} queue doc already
      // exists (double-submit racing the Cloud Function) — i.e. already voted.
      if (error.code === 'permission-denied') {
        showToast("이미 이 스킨에 투표하셨습니다!", "error");
      } else {
        showToast("투표를 저장하는 데 실패했습니다. 다시 시도해 주세요.", "error");
      }

      if (error.code) {
        connectionStatus.lastError = error;
        updateDataAgeIndicator();
      }

      clearPendingVote();
    }
  };

  // ===== Real-time Sync =====

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

          if (activeTimers.realtimeRetry) {
            clearTimeout(activeTimers.realtimeRetry);
          }

          activeTimers.realtimeRetry = setTimeout(() => {
            activeTimers.realtimeRetry = null;
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
    const handleVisibilityChange = () => {
      isTabActive = !document.hidden;

      if (isTabActive) {
        startRealtimeSync();
      } else {
        stopRealtimeSync();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (isTabActive) {
      startRealtimeSync();
    }

    const cleanupRealtimeSync = () => {
      window.removeEventListener('beforeunload', cleanupRealtimeSync);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (activeTimers.realtimeRetry) {
        clearTimeout(activeTimers.realtimeRetry);
        activeTimers.realtimeRetry = null;
      }
      if (realtimeUnsubscribe) {
        realtimeUnsubscribe();
        realtimeUnsubscribe = null;
      }
    };

    window.addEventListener('beforeunload', cleanupRealtimeSync, { once: true });
    return cleanupRealtimeSync;
  };

  // ===== Leaderboard Logic (local only) =====

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
    leaderboardContent.replaceChildren();

    if (!leaderboardData || leaderboardData.length === 0) {
      renderStatus(leaderboardContent, '리더보드에 표시할 스킨이 아직 없습니다. (최소 10표 필요)', 'empty');
      return;
    }

    const fragment = document.createDocumentFragment();

    leaderboardData.forEach((skin, index) => {
      // Resolve display values — handle both CF format and local format
      const cid = skin.clientId || skin.id;
      const localSkin = cid ? clientIdToSkinMap[cid] : null;

      const displayName = skin.skin_name || skin.name || localSkin?.["한글 함순이 + 스킨 이름"] || 'Unknown Skin';
      const charName = skin.character_name || skin.charName || localSkin?.["함순이 이름"] || 'Unknown';
      const imageUrl = skin.imageUrl || localSkin?.["깔끔한 일러"] || '';
      const avgScore = skin.average_score ?? 0;
      const totalVotes = skin.total_votes ?? 0;

      const item = document.createElement('div');
      item.className = 'leaderboard-item';

      const rank = document.createElement('div');
      rank.className = 'leaderboard-rank';
      rank.textContent = `#${index + 1}`;

      const img = document.createElement('img');
      img.src = imageUrl;
      img.className = 'leaderboard-image';
      img.loading = 'lazy';
      img.alt = displayName;
      img.addEventListener('error', createImageErrorHandler());

      const details = document.createElement('div');
      details.className = 'leaderboard-details';

      const skinName = document.createElement('div');
      skinName.className = 'skin-name';
      skinName.textContent = displayName;

      const characterName = document.createElement('div');
      characterName.className = 'char-name';
      characterName.textContent = charName;

      details.append(skinName, characterName);

      const score = document.createElement('div');
      score.className = 'leaderboard-score';

      const avg = document.createElement('div');
      avg.className = 'avg-score';
      avg.textContent = `★ ${avgScore.toFixed(2)}`;

      const votes = document.createElement('div');
      votes.className = 'total-votes';
      votes.textContent = `(${totalVotes} 표)`;

      score.append(avg, votes);
      item.append(rank, img, details, score);
      fragment.appendChild(item);
    });

    leaderboardContent.appendChild(fragment);
  };

  // ===== UI Rendering =====

  /**
   * Display skeleton loader
   */
  const displaySkeletonLoader = (count = 18) => {
    pollContainer.replaceChildren();
    for (let i = 0; i < count; i++) {
      const skeletonBox = document.createElement("div");
      skeletonBox.className = "skeleton-card";

      const image = document.createElement('div');
      image.className = 'skeleton-image skeleton-element';

      const info = document.createElement('div');
      info.className = 'skeleton-info';

      const line = document.createElement('div');
      line.className = 'skeleton-line skeleton-element';

      const shortLine = document.createElement('div');
      shortLine.className = 'skeleton-line short skeleton-element';

      info.append(line, shortLine);
      skeletonBox.append(image, info);
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
    const skinName = skin["한글 함순이 + 스킨 이름"];
    const characterName = skin["함순이 이름"];

    const hasVoted = userVotesCache[clientId] !== undefined;
    const votedRating = hasVoted ? String(userVotesCache[clientId].rating) : null;

    const pollBox = document.createElement("div");
    pollBox.className = "poll-box";
    pollBox.id = `poll-box-${skinId}`;

    const imageButton = document.createElement('button');
    imageButton.type = 'button';
    imageButton.className = 'poll-image-button';
    imageButton.dataset.fullImage = skin["전체 일러"] || skin["ASMR 일러"] || skin["깔끔한 일러"] || '';
    imageButton.dataset.skinName = skinName;
    imageButton.dataset.charName = characterName;
    imageButton.title = '클릭하여 전체 일러스트 보기';
    imageButton.setAttribute('aria-label', `${skinName} 전체 일러스트 보기`);

    const pollImage = document.createElement('img');
    pollImage.src = skin["깔끔한 일러"];
    pollImage.className = 'poll-image';
    pollImage.loading = 'lazy';
    pollImage.alt = skinName;
    pollImage.addEventListener('error', createImageErrorHandler());
    imageButton.appendChild(pollImage);

    const pollInfo = document.createElement('div');
    pollInfo.className = 'poll-info';

    const charName = document.createElement('div');
    charName.className = 'character-name';
    charName.textContent = characterName;

    const title = document.createElement('h3');
    title.textContent = skinName;

    const ratingArea = document.createElement('div');
    ratingArea.className = hasVoted ? 'rating-area voted' : 'rating-area';
    ratingArea.dataset.skinIdArea = skinId;
    ratingArea.dataset.clientId = clientId;

    const voteWidget = document.createElement('div');
    voteWidget.className = 'vote-widget';

    const voteLabel = document.createElement('span');
    voteLabel.className = 'vote-label';
    voteLabel.textContent = '투표:';

    const starRating = document.createElement('div');
    starRating.className = 'star-rating';
    starRating.dataset.skinId = skinId;
    starRating.dataset.clientId = clientId;
    starRating.dataset.skinName = skinName;
    starRating.dataset.characterName = characterName;

    for (let rating = 5; rating >= 1; rating--) {
      const input = document.createElement('input');
      input.type = 'radio';
      input.id = `star${rating}-${skinId}`;
      input.name = `rating-${skinId}`;
      input.value = String(rating);
      input.checked = votedRating === String(rating);
      input.disabled = hasVoted;

      const label = document.createElement('label');
      label.htmlFor = input.id;
      label.textContent = '★';
      label.setAttribute('aria-label', `${rating}점`);
      label.setAttribute('role', 'button');
      label.tabIndex = hasVoted ? -1 : 0;

      starRating.append(input, label);
    }

    voteWidget.append(voteLabel, starRating);

    const confirm = document.createElement('div');
    confirm.className = 'confirm-vote-message';
    confirm.id = `confirm-msg-${skinId}`;
    confirm.textContent = '다시 클릭하여 확정';

    const results = document.createElement('div');
    results.className = 'poll-results';
    results.id = `results-${clientId}`;

    ratingArea.append(voteWidget, confirm, results);
    pollInfo.append(
      charName,
      title,
      createTextLine('타입:', skin["스킨 타입 - 한글"] || '기본'),
      createTextLine('태그:', skin["스킨 태그"] || '없음'),
      createTextLine('레어도:', skin["레어도"] || '없음'),
      ratingArea
    );

    pollBox.append(imageButton, pollInfo);

    updateScoreDisplay(clientId, allPollDataCache[clientId], results);

    return pollBox;
  };

  /**
   * Update score display for a skin (used by real-time updates on already-rendered cards)
   */
  const updateScoreDisplay = (clientId, data, targetEl = null) => {
    const resultsEl = targetEl || document.getElementById(`results-${clientId}`);
    if (!resultsEl) return;

    let fg = resultsEl.querySelector('.score-bar-foreground');
    let txt = resultsEl.querySelector('.score-bar-text');
    if (!fg || !txt) {
      resultsEl.replaceChildren(createScoreBar());
      fg = resultsEl.querySelector('.score-bar-foreground');
      txt = resultsEl.querySelector('.score-bar-text');
    }

    if (data && data.total_votes > 0) {
      const average = data.total_score / data.total_votes;
      const percentage = (average / 5) * 100;

      const newWidth = `${percentage}%`;

      if (fg.style.width !== newWidth) fg.style.width = newWidth;
      txt.replaceChildren(
        document.createTextNode('평균: '),
        Object.assign(document.createElement('strong'), { textContent: average.toFixed(2) }),
        document.createTextNode(` (${data.total_votes}표)`)
      );
    } else {
      if (fg.style.width !== '0%') fg.style.width = '0%';
      if (txt.textContent !== '투표 없음') txt.textContent = '투표 없음';
    }
  };

  const createScoreBar = () => {
    const fragment = document.createDocumentFragment();

    const visual = document.createElement('div');
    visual.className = 'score-bar-visual';
    visual.appendChild(document.createTextNode('★★★★★'));

    const foreground = document.createElement('div');
    foreground.className = 'score-bar-foreground';
    foreground.style.width = '0%';
    foreground.textContent = '★★★★★';
    visual.appendChild(foreground);

    const text = document.createElement('div');
    text.className = 'score-bar-text';

    fragment.append(visual, text);
    return fragment;
  };

  // ===== Filtering & Sorting =====

  /**
   * Apply filters, sort, and push to virtual scroll
   */
  const applyFilters = ({ updateUrl = true } = {}) => {
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
    if (updateUrl) updateURLWithFilters();
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

  // ===== URL State Management =====

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
    }, { replace: true, clear: true });
  };

  const setSelectValue = (selectEl, value, fallback) => {
    const candidate = value || fallback;
    const hasOption = Array.from(selectEl.options).some(option => option.value === candidate);
    selectEl.value = hasOption ? candidate : fallback;
  };

  const setDropdownVisible = (dropdownEl, inputEl, isVisible) => {
    dropdownEl.style.display = isVisible ? 'block' : 'none';
    inputEl.setAttribute('aria-expanded', String(isVisible));
  };

  /**
   * Apply filters from URL parameters.
   * If no URL parameters exist (first visit), showcase featured event skins.
   */
  const applyFiltersFromURL = () => {
    const params = getAllUrlParams();

    if (Object.keys(params).length === 0) {
      // First visit with no URL params - showcase featured event
      characterNameSearch.value = '';
      skinTypeSelect.value = FEATURED_SKIN_TYPE;
      factionSelect.value = 'all';
      tagSelect.value = 'all';
      sortSelect.value = 'default';
      cachedRarityCheckboxes.forEach(cb => {
        cb.checked = true;
      });
    } else {
      // Returning visit or shared link - respect URL parameters
      characterNameSearch.value = params.character || '';
      setSelectValue(skinTypeSelect, params.type, 'all');
      setSelectValue(factionSelect, params.faction, 'all');
      setSelectValue(tagSelect, params.tag, 'all');
      setSelectValue(sortSelect, params.sort, 'default');
      const raritiesParam = params.rarities;
      if (raritiesParam) {
        const validRarities = new Set(cachedRarityCheckboxes.map(cb => cb.value));
        const activeRarities = raritiesParam.split(',').filter(rarity => validRarities.has(rarity));
        cachedRarityCheckboxes.forEach(cb => {
          cb.checked = activeRarities.includes(cb.value);
        });
      } else {
        cachedRarityCheckboxes.forEach(cb => {
          cb.checked = true;
        });
      }
    }
    applyFilters({ updateUrl: false });
  };

  // ===== Dropdown Helpers =====

  /**
   * Populate dropdown with Fuse.js results (with highlighting)
   */
  const populateDropdown = (dropdownEl, results, onSelectCallback) => {
    dropdownEl.replaceChildren();
    if (results.length === 0) {
      renderStatus(dropdownEl, '검색 결과가 없습니다', 'empty', { compact: true });
      return;
    }

    results.forEach((result) => {
      const item = result.item;
      const matches = result.matches;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dropdown-option';
      button.setAttribute('role', 'option');

      // Highlight matches if available
      if (matches && matches.length > 0 && matches[0].indices) {
        appendTextWithMark(button, item.name, matches[0].indices);
      } else {
        button.textContent = item.name;
      }

      button.addEventListener('click', () => onSelectCallback(item.name));
      dropdownEl.appendChild(button);
    });
  };

  /**
   * Setup dropdown with Fuse.js fuzzy search
   */
  const setupDropdown = (inputEl, dropdownEl, getFuseInstance, onSelectCallback) => {
    const handleFilter = () => {
      const fuse = getFuseInstance();
      const searchTerm = inputEl.value;

      if (!fuse) {
        const normalizedTerm = searchTerm.trim().toLowerCase();
        const results = allCharacterNames
          .filter(name => !normalizedTerm || name.toLowerCase().includes(normalizedTerm))
          .map(name => ({ item: { name }, matches: [] }));
        populateDropdown(dropdownEl, results, onSelectCallback);
      } else if (searchTerm.trim() === '') {
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
      setDropdownVisible(dropdownEl, inputEl, true);
    });
    inputEl.addEventListener('blur', () => {
      setTimeout(() => {
        setDropdownVisible(dropdownEl, inputEl, false);
      }, 200);
    });
  };

  /**
   * Handle character selection from dropdown
   */
  const handleCharacterSelect = (characterName) => {
    characterNameSearch.value = characterName;
    setDropdownVisible(characterDropdownContent, characterNameSearch, false);
    applyFilters();
  };

  // ===== Popup Handlers =====

  /**
   * Open image popup
   */
  const openImagePopup = (fullImageUrl, skinName, charName) => {
    popupFullImage.addEventListener('error', createImageErrorHandler(), { once: true });

    popupFullImage.src = fullImageUrl;
    popupFullImage.alt = skinName ? `${skinName} 전체 일러스트` : '전체 일러스트';
    popupSkinName.textContent = skinName;
    popupCharName.textContent = charName;
    imagePopup.classList.add('visible');
    imagePopup.setAttribute('aria-hidden', 'false');
    lockBodyScroll();
    closeImagePopupBtn.focus();
  };

  /**
   * Close image popup
   */
  const closeImagePopup = () => {
    imagePopup.classList.remove('visible');
    imagePopup.setAttribute('aria-hidden', 'true');
    unlockBodyScroll();
    setTimeout(() => {
      popupFullImage.src = '';
    }, 300);
  };

  // ===== Voting Logic =====

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

  // ===== Refresh Data =====

  /**
   * Start refresh cooldown timer
   */
  const startRefreshCooldown = () => {
    if (!refreshDataBtn) return;

    let secondsLeft = Math.ceil(REFRESH_COOLDOWN_MS / 1000);
    refreshDataBtn.disabled = true;

    const updateButtonText = () => {
      if (secondsLeft > 0) {
        setButtonIconText(refreshDataBtn, 'fas fa-clock', `${secondsLeft}초`);
      } else {
        clearInterval(refreshCooldownTimer);
        refreshDataBtn.disabled = false;
        setButtonIconText(refreshDataBtn, 'fas fa-sync-alt');
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
      setButtonIconText(refreshDataBtn, 'fas fa-sync-alt');
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
        setButtonIconText(refreshDataBtn, 'fas fa-sync-alt');
      }
    }
  };

  // ===== Event Listeners =====

  // Poll container click handling (voting & image popup) — delegated
  pollContainer.addEventListener("click", (event) => {
    // Image popup handler
    const imageButton = event.target.closest('.poll-image-button');
    if (imageButton) {
      const fullImageUrl = imageButton.dataset.fullImage;
      const skinName = imageButton.dataset.skinName;
      const charName = imageButton.dataset.charName;

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
    const isVisible = leaderboardContent.classList.toggle('visible');
    leaderboardToggleBtn.textContent = isVisible ? '리더보드 숨기기' : 'Top 10 스킨 보기';
    leaderboardToggleBtn.setAttribute('aria-expanded', String(isVisible));
  });

  pollContainer.addEventListener('keydown', (event) => {
    const starLabel = event.target.closest('.star-rating label');
    if (!starLabel || (event.key !== 'Enter' && event.key !== ' ')) return;

    event.preventDefault();
    starLabel.click();
  });

  // Reset filters button
  resetFiltersBtn.addEventListener('click', resetFilters);

  // Mobile filter toggle
  if (filterToggleBtn && filterContainer) {
    filterToggleBtn.addEventListener('click', () => {
      const isVisible = filterContainer.classList.toggle('visible');
      filterToggleBtn.classList.toggle('active', isVisible);
      filterToggleBtn.setAttribute('aria-expanded', String(isVisible));
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

  // ===== Main Init Sequence =====

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
    await ensureFuse();
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
    realtimeSyncCleanup = setupRealtimeSync();

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

  // ===== Cleanup =====

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

    if (activeTimers.realtimeRetry) {
      clearTimeout(activeTimers.realtimeRetry);
      activeTimers.realtimeRetry = null;
    }

    if (realtimeSyncCleanup) {
      realtimeSyncCleanup();
      realtimeSyncCleanup = null;
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
