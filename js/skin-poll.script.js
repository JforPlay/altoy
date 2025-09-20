document.addEventListener("DOMContentLoaded", () => {
  // --- Firebase Setup (unchanged) ---
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

  // --- Get HTML elements (unchanged) ---
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

  // --- State Variables (unchanged) ---
  let allSkins = [];
  let allCharacterNames = [];
  let allPollDataCache = {};
  let currentlyDisplayedSkins = [];
  let isSorting = false;
  let pendingVote = null;

  // --- Helper and Dropdown Functions (unchanged) ---
  const debounce = (func, delay) => { let timeoutId; return (...args) => { clearTimeout(timeoutId); timeoutId = setTimeout(() => { func.apply(this, args); }, delay); }; };
  const populateDropdown = (dropdownEl, items, onSelectCallback) => { dropdownEl.innerHTML = ''; if (items.length === 0) { dropdownEl.innerHTML = `<div class="no-results">검색 결과가 없습니다</div>`; return; } items.forEach(item => { const a = document.createElement('a'); a.textContent = item; a.addEventListener('click', () => onSelectCallback(item)); dropdownEl.appendChild(a); }); };
  const setupDropdown = (inputEl, dropdownEl, getSourceArray, onSelectCallback) => { const handleFilter = () => { const sourceArray = getSourceArray(); const searchTerm = inputEl.value.toLowerCase(); const isExactMatch = sourceArray.some(item => item.toLowerCase() === searchTerm); if (isExactMatch) { populateDropdown(dropdownEl, sourceArray, onSelectCallback); } else { const filteredItems = sourceArray.filter(item => item.toLowerCase().includes(searchTerm)); populateDropdown(dropdownEl, filteredItems, onSelectCallback); } }; inputEl.addEventListener('keyup', debounce(handleFilter, 200)); inputEl.addEventListener('focus', () => { handleFilter(); dropdownEl.style.display = 'block'; }); inputEl.addEventListener('blur', () => { setTimeout(() => { dropdownEl.style.display = 'none'; }, 200); }); };
  const handleCharacterSelect = (characterName) => { characterNameSearch.value = characterName; characterDropdownContent.style.display = 'none'; applyFilters(); };

  // --- NEW: URL State Management Functions ---

  /**
   * Reads the current state of all filters and updates the browser URL.
   */
  const updateURLWithFilters = () => {
    const params = new URLSearchParams();

    // Add character if specified
    if (characterNameSearch.value) {
      params.set('character', characterNameSearch.value);
    }
    // Add other filters if not set to default 'all'
    if (skinTypeSelect.value !== 'all') {
      params.set('type', skinTypeSelect.value);
    }
    if (factionSelect.value !== 'all') {
      params.set('faction', factionSelect.value);
    }
    if (tagSelect.value !== 'all') {
      params.set('tag', tagSelect.value);
    }
    if (sortSelect.value !== 'default') {
      params.set('sort', sortSelect.value);
    }

    // Handle rarities
    const selectedRarities = [...rarityCheckboxes.querySelectorAll("input:checked")].map(cb => cb.value);
    if (selectedRarities.length < 5) { // Only add if not all are selected
      params.set('rarities', selectedRarities.join(','));
    }

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    history.pushState({}, '', newUrl);
  };

  /**
   * Reads filter parameters from the URL and applies them to the page.
   */
  const applyFiltersFromURL = () => {
    const params = new URLSearchParams(window.location.search);

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

    applyFilters();
  };


  // --- Main Data Fetching and Initialization ---
  fetch("data/subset_skin_data.json")
    .then((response) => response.json())
    .then((jsonData) => {
      allSkins = Object.keys(jsonData).map((key) => ({ id: key, ...jsonData[key] })).filter(skin => skin["한글 함순이 + 스킨 이름"] && skin["함순이 이름"]);
      allCharacterNames = [...new Set(allSkins.map((s) => s["함순이 이름"]))].filter(Boolean).sort();

      setupDropdown(characterNameSearch, characterDropdownContent, () => allCharacterNames, handleCharacterSelect);

      pollContainer.innerHTML = `<div class="loading-indicator">스킨 데이터 로딩 중...</div>`;

      fetchAllPollData().then(pollData => {
        allPollDataCache = pollData;
        populateLeaderboard(allPollDataCache);

        // NEW: Apply filters from URL on initial load
        applyFiltersFromURL();
      });
    });

  // --- Core Functions ---
  const applyFilters = () => {
    let filteredSkins = allSkins;
    const selectedCharName = characterNameSearch.value;
    const selectedType = skinTypeSelect.value;
    const selectedFaction = factionSelect.value;
    const selectedTag = tagSelect.value;
    const selectedRarities = [...rarityCheckboxes.querySelectorAll("input:checked")].map(cb => cb.value);

    if (selectedCharName) { filteredSkins = filteredSkins.filter(s => s["함순이 이름"] === selectedCharName); }
    if (selectedType !== "all") { if (selectedType === "기본") { filteredSkins = filteredSkins.filter(s => !s["스킨 타입 - 한글"]); } else { filteredSkins = filteredSkins.filter(s => s["스킨 타입 - 한글"] === selectedType); } }
    if (selectedFaction !== "all") { filteredSkins = filteredSkins.filter(s => s["진영"] === selectedFaction); }
    if (selectedTag !== "all") { if (selectedTag === "X") { filteredSkins = filteredSkins.filter(s => !s["스킨 태그"]); } else { filteredSkins = filteredSkins.filter(s => s["스킨 태그"] && s["스킨 태그"].includes(selectedTag)); } }
    filteredSkins = filteredSkins.filter(s => selectedRarities.includes(s["레어도"]));

    currentlyDisplayedSkins = filteredSkins.map(skin => {
      const data = allPollDataCache[skin.id];
      return { ...skin, total_votes: data?.total_votes || 0, average_score: (data && data.total_votes > 0) ? (data.total_score / data.total_votes) : 0 };
    });

    reSortView();
    // NEW: Update URL whenever filters are applied
    updateURLWithFilters();
  };

  // (renderPollList and submitVote functions are unchanged)
  const renderPollList = (skinsToRender) => { pollContainer.innerHTML = ""; if (skinsToRender.length === 0) { pollContainer.innerHTML = `<div class="no-results">표시할 스킨이 없습니다.</div>`; return; } skinsToRender.forEach((skin) => { const skinId = skin.id; const pollBox = document.createElement("div"); pollBox.className = "poll-box"; pollBox.id = `poll-box-${skinId}`; const hasVoted = localStorage.getItem(`voted_${skinId}`) === "true"; const votedRating = hasVoted ? localStorage.getItem(`rating_${skinId}`) : null; pollBox.innerHTML = ` <img src="${skin["깔끔한 일러"]}" class="poll-image" loading="lazy"> <div class="poll-info"> <div class="character-name">${skin["함순이 이름"]}</div> <h3>${skin["한글 함순이 + 스킨 이름"]}</h3> <div class="info-line"><strong>타입:</strong> ${skin["스킨 타입 - 한글"] || "기본"}</div> <div class="info-line"><strong>태그:</strong> ${skin["스킨 태그"] || "없음"}</div> <div class="info-line"><strong>레어도:</strong> ${skin["레어도"] || "없음"}</div> <div class="rating-area ${hasVoted ? "voted" : ""}" data-skin-id-area="${skinId}"> <div class="vote-widget"> <span class="vote-label">투표:</span> <div class="star-rating" data-skin-id="${skinId}" data-skin-name="${skin["한글 함순이 + 스킨 이름"]}" data-character-name="${skin["함순이 이름"]}"> <input type="radio" id="star5-${skinId}" name="rating-${skinId}" value="5" ${votedRating === '5' ? 'checked' : ''} ${hasVoted ? 'disabled' : ''}><label for="star5-${skinId}">★</label> <input type="radio" id="star4-${skinId}" name="rating-${skinId}" value="4" ${votedRating === '4' ? 'checked' : ''} ${hasVoted ? 'disabled' : ''}><label for="star4-${skinId}">★</label> <input type="radio" id="star3-${skinId}" name="rating-${skinId}" value="3" ${votedRating === '3' ? 'checked' : ''} ${hasVoted ? 'disabled' : ''}><label for="star3-${skinId}">★</label> <input type="radio" id="star2-${skinId}" name="rating-${skinId}" value="2" ${votedRating === '2' ? 'checked' : ''} ${hasVoted ? 'disabled' : ''}><label for="star2-${skinId}">★</label> <input type="radio" id="star1-${skinId}" name="rating-${skinId}" value="1" ${votedRating === '1' ? 'checked' : ''} ${hasVoted ? 'disabled' : ''}><label for="star1-${skinId}">★</label> </div> </div> <div class="confirm-vote-message" id="confirm-msg-${skinId}">다시 클릭하여 확정</div> <div class="poll-results" id="results-${skinId}"></div> </div> </div>`; pollContainer.appendChild(pollBox); updateScoreDisplay(skinId, { total_votes: skin.total_votes, total_score: skin.average_score * skin.total_votes }); }); };
  // REPLACE the old submitVote function in js/skin-poll.script.js with this one

  const submitVote = (skinId, rating, skinName, characterName) => {
    if (localStorage.getItem(`voted_${skinId}`) === "true") {
      return;
    }

    const skinDocRef = db.collection("skin_polls").doc(String(skinId));
    const statsDocRef = db.collection("stats").doc("total_votes_counter");

    // This corrected transaction reads all data first, then performs all writes.
    db.runTransaction(transaction => {
      return Promise.all([transaction.get(skinDocRef), transaction.get(statsDocRef)])
        .then(([skinDoc, statsDoc]) => {

          // Calculate the new values for the specific skin
          const newTotalVotes = (skinDoc.data()?.total_votes || 0) + 1;
          const newTotalScore = (skinDoc.data()?.total_score || 0) + rating;
          const newAverageScore = newTotalScore / newTotalVotes;

          // Calculate the new value for the site-wide vote counter
          const newTotalCount = (statsDoc.data()?.count || 0) + 1;

          // Perform all writes with the correctly calculated values
          transaction.set(skinDocRef, {
            total_votes: newTotalVotes,
            total_score: newTotalScore,
            average_score: newAverageScore,
            skin_name: skinName,
            character_name: characterName
          }, { merge: true });

          transaction.set(statsDocRef, {
            count: newTotalCount
          }, { merge: true });
        });
    }).then(() => {
      // --- Success Handling ---
      localStorage.setItem(`voted_${skinId}`, "true");
      localStorage.setItem(`rating_${skinId}`, rating);

      const ratingArea = document.querySelector(`.rating-area[data-skin-id-area="${skinId}"]`);
      if (ratingArea) {
        ratingArea.classList.remove('pending-vote');
        ratingArea.classList.add("voted", "voted-animation");
        ratingArea.querySelectorAll('input').forEach(input => input.disabled = true);
        setTimeout(() => ratingArea.classList.remove("voted-animation"), 300);
      }

      skinDocRef.get().then(doc => {
        if (doc.exists) {
          const voteData = doc.data();
          allPollDataCache[skinId] = voteData;
          updateScoreDisplay(skinId, voteData);
          const skinInArray = currentlyDisplayedSkins.find(s => s.id === skinId);
          if (skinInArray) {
            skinInArray.total_votes = voteData.total_votes;
            skinInArray.average_score = voteData.average_score;
          }
        }
      });
    }).catch(error => {
      console.error("Firebase transaction failed: ", error);
    });
  };

  // --- Unchanged Functions ---
  const reSortView = () => { if (isSorting) return; isSorting = true; const sortBy = sortSelect.value; const defaultSort = (a, b) => (a["클뜯 id"] || 0) - (b["클뜯 id"] || 0); if (sortBy === 'score_desc') { currentlyDisplayedSkins.sort((a, b) => { const scoreDiff = b.average_score - a.average_score; return scoreDiff !== 0 ? scoreDiff : defaultSort(a, b); }); } else if (sortBy === 'votes_desc') { currentlyDisplayedSkins.sort((a, b) => { const voteDiff = b.total_votes - a.total_votes; return voteDiff !== 0 ? voteDiff : defaultSort(a, b); }); } else { currentlyDisplayedSkins.sort(defaultSort); } const initialPositions = new Map(); Array.from(pollContainer.children).forEach(box => { initialPositions.set(box.id, box.getBoundingClientRect()); }); renderPollList(currentlyDisplayedSkins); Array.from(pollContainer.children).forEach(box => { const oldPos = initialPositions.get(box.id); if (!oldPos) return; const newPos = box.getBoundingClientRect(); const deltaX = oldPos.left - newPos.left; const deltaY = oldPos.top - newPos.top; if (deltaX === 0 && deltaY === 0) return; requestAnimationFrame(() => { box.style.transform = `translate(${deltaX}px, ${deltaY}px)`; box.style.transition = 'transform 0s'; requestAnimationFrame(() => { box.style.transform = ''; box.style.transition = 'transform 0.5s ease-in-out'; }); }); }); setTimeout(() => { isSorting = false; }, 500); };
  const updateScoreDisplay = (skinId, data) => { const resultsEl = document.getElementById(`results-${skinId}`); if (!resultsEl) return; resultsEl.innerHTML = `<div class="score-bar-visual">★★★★★<div class="score-bar-foreground" style="width: 0%;">★★★★★</div></div><div class="score-bar-text"></div>`; const foregroundEl = resultsEl.querySelector('.score-bar-foreground'); const textEl = resultsEl.querySelector('.score-bar-text'); if (data && data.total_votes > 0) { const average = data.total_score / data.total_votes; const percentage = (average / 5) * 100; foregroundEl.style.width = `${percentage}%`; textEl.innerHTML = `평균: <strong>${average.toFixed(2)}</strong> (${data.total_votes}표)`; } else { foregroundEl.style.width = '0%'; textEl.textContent = '투표 없음'; } };
  const fetchAllPollData = async () => { const pollRef = db.collection("skin_polls"); const allPollData = {}; try { const snapshot = await pollRef.get(); snapshot.forEach(doc => { allPollData[doc.id] = doc.data(); }); } catch (error) { console.error("Error fetching all poll data:", error); } return allPollData; };
  const populateLeaderboard = (allPollData) => { if (!allSkins.length || !Object.keys(allPollData).length) return; const MIN_VOTES = 10; const rankedSkins = Object.keys(allPollData).map(skinId => { const poll = allPollData[skinId]; const skinInfo = allSkins.find(s => s.id === skinId); if (!skinInfo || !poll.total_votes || poll.total_votes < MIN_VOTES) { return null; } return { id: skinId, name: skinInfo["한글 함순이 + 스킨 이름"], charName: skinInfo["함순이 이름"], imageUrl: skinInfo["깔끔한 일러"], average_score: poll.total_score / poll.total_votes, total_votes: poll.total_votes, }; }).filter(Boolean); rankedSkins.sort((a, b) => { if (b.average_score !== a.average_score) { return b.average_score - a.average_score; } return b.total_votes - a.total_votes; }); const top10 = rankedSkins.slice(0, 10); if (top10.length === 0) { leaderboardContent.innerHTML = `<p style="text-align: center; color: #b9bbbe;">리더보드에 표시할 스킨이 아직 없습니다. (최소 ${MIN_VOTES}표 필요)</p>`; return; } leaderboardContent.innerHTML = top10.map((skin, index) => `<div class="leaderboard-item"><div class="leaderboard-rank">#${index + 1}</div><img src="${skin.imageUrl}" class="leaderboard-image" loading="lazy"><div class="leaderboard-details"><div class="skin-name">${skin.name || 'Unknown Skin'}</div><div class="char-name">${skin.charName || 'Unknown'}</div></div><div class="leaderboard-score"><div class="avg-score">★ ${skin.average_score.toFixed(2)}</div><div class="total-votes">(${skin.total_votes} 표)</div></div></div>`).join(''); };
  const resetFilters = () => { characterNameSearch.value = ""; skinTypeSelect.value = "all"; factionSelect.value = "all"; tagSelect.value = "all"; sortSelect.value = "default"; rarityCheckboxes.querySelectorAll("input[type='checkbox']").forEach(checkbox => { checkbox.checked = true; }); applyFilters(); };
  const clearPendingVote = () => { if (pendingVote) { const ratingArea = document.querySelector(`.rating-area[data-skin-id-area="${pendingVote.skinId}"]`); if (ratingArea) { ratingArea.classList.remove('pending-vote'); const checkedRadio = ratingArea.querySelector(`input[name="rating-${pendingVote.skinId}"]:checked`); if (checkedRadio) { checkedRadio.checked = false; } } pendingVote = null; } };

  // --- Event Listeners ---
  pollContainer.addEventListener("click", (event) => { const starLabel = event.target.closest('.star-rating label'); if (!starLabel) return; const ratingArea = event.target.closest('.rating-area'); if (ratingArea.classList.contains('voted')) return; event.preventDefault(); const skinId = ratingArea.dataset.skinIdArea; const rating = parseInt(starLabel.htmlFor.split('-')[0].replace('star', ''), 10); const starRatingDiv = ratingArea.querySelector('.star-rating'); const skinName = starRatingDiv.dataset.skinName; const characterName = starRatingDiv.dataset.characterName; if (pendingVote && pendingVote.skinId === skinId && pendingVote.rating === rating) { submitVote(pendingVote.skinId, pendingVote.rating, skinName, characterName); pendingVote = null; } else { clearPendingVote(); pendingVote = { skinId, rating }; ratingArea.classList.add('pending-vote'); document.getElementById(`star${rating}-${skinId}`).checked = true; } });
  document.addEventListener('click', (event) => { if (pendingVote && !event.target.closest(`.rating-area[data-skin-id-area="${pendingVote.skinId}"]`)) { clearPendingVote(); } });
  leaderboardToggleBtn.addEventListener('click', () => { leaderboardContent.classList.toggle('visible'); leaderboardToggleBtn.textContent = leaderboardContent.classList.contains('visible') ? '🔼 리더보드 숨기기' : '🏆 Top 10 스킨 보기'; });
  resetFiltersBtn.addEventListener('click', resetFilters);
  [skinTypeSelect, factionSelect, tagSelect].forEach((el) => { el.addEventListener("change", applyFilters); });
  rarityCheckboxes.querySelectorAll("input").forEach((checkbox) => { checkbox.addEventListener("change", applyFilters); });
  sortSelect.addEventListener('change', () => {
    reSortView();
    updateURLWithFilters(); // Also update URL on sort change
  });

  // NEW: Listen for back/forward navigation
  window.addEventListener('popstate', applyFiltersFromURL);
});