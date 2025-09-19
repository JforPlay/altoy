document.addEventListener("DOMContentLoaded", () => {
  // --- Firebase Setup ---
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

  // --- Get HTML elements ---
  const pollContainer = document.getElementById("poll-container");
  const characterNameSearch = document.getElementById("character-name-search");
  const characterNameSelect = document.getElementById("character-name-select");
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
  let allCharacterNamesData = [];
  let currentlyDisplayedSkins = [];
  let currentRequestId = 0;
  let isSorting = false;
  let pendingVote = null; // NEW: To track vote waiting for confirmation

  // --- Helper Functions ---
  const debounce = (func, delay) => {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => { func.apply(this, args); }, delay);
    };
  };

  // --- Main Data Fetching and Initialization ---
  fetch("data/subset_skin_data.json")
    .then((response) => response.json())
    .then((jsonData) => {
      allSkins = Object.keys(jsonData)
        .map((key) => ({ id: key, ...jsonData[key] }))
        .filter(skin => skin["한글 함순이 + 스킨 이름"] && skin["함순이 이름"]);
      
      populateInitialFilters();
      tagSelect.value = 'L2D';
      applyFilters();
      fetchAllPollData().then(populateLeaderboard);
    });


  const renderPollList = (skinsToRender) => {
    pollContainer.innerHTML = "";
    if (skinsToRender.length === 0) {
        pollContainer.innerHTML = `<div class="no-results">표시할 스킨이 없습니다.</div>`;
        return;
    }
    skinsToRender.forEach((skin) => {
      if (!skin || !skin.id) return;
      const skinId = skin.id;
      const pollBox = document.createElement("div");
      pollBox.className = "poll-box";
      pollBox.id = `poll-box-${skinId}`;
      const hasVoted = localStorage.getItem(`voted_${skinId}`) === "true";
      pollBox.innerHTML = `
        <img src="${skin["깔끔한 일러"]}" class="poll-image" loading="lazy">
        <div class="poll-info">
            <div class="character-name">${skin["함순이 이름"]}</div>
            <h3>${skin["한글 함순이 + 스킨 이름"]}</h3>
            <div class="info-line"><strong>타입:</strong> ${skin["스킨 타입 - 한글"] || "기본"}</div>
            <div class="info-line"><strong>태그:</strong> ${skin["스킨 태그"] || "없음"}</div>
            <div class="info-line"><strong>레어도:</strong> ${skin["레어도"] || "없음"}</div>
            <div class="rating-area ${hasVoted ? "voted" : ""}" data-skin-id-area="${skinId}">
                <div class="star-rating" data-skin-id="${skinId}" data-skin-name="${skin["한글 함순이 + 스킨 이름"]}" data-character-name="${skin["함순이 이름"]}">
                     <input type="radio" id="star5-${skinId}" name="rating-${skinId}" value="5"><label for="star5-${skinId}">★</label>
                     <input type="radio" id="star4-${skinId}" name="rating-${skinId}" value="4"><label for="star4-${skinId}">★</label>
                     <input type="radio" id="star3-${skinId}" name="rating-${skinId}" value="3"><label for="star3-${skinId}">★</label>
                     <input type="radio" id="star2-${skinId}" name="rating-${skinId}" value="2"><label for="star2-${skinId}">★</label>
                     <input type="radio" id="star1-${skinId}" name="rating-${skinId}" value="1"><label for="star1-${skinId}">★</label>
                </div>
                <div class="confirm-vote-message" id="confirm-msg-${skinId}">다시 클릭하여 확정</div>
                <div class="poll-results" id="results-${skinId}">결과 불러오는 중...</div>
            </div>
        </div>`;
      pollContainer.appendChild(pollBox);
    });
  };

  // --- PASTE OF UNCHANGED FUNCTIONS FOR COMPLETENESS ---
  const applyFilters = () => {
    currentRequestId++;
    let filteredSkins = allSkins;
    const selectedCharName = characterNameSelect.value;
    const selectedType = skinTypeSelect.value;
    const selectedFaction = factionSelect.value;
    const selectedTag = tagSelect.value;
    const selectedRarities = [...rarityCheckboxes.querySelectorAll("input:checked")].map(cb => cb.value);
    if (selectedCharName !== "all") { filteredSkins = filteredSkins.filter(s => s["함순이 이름"] === selectedCharName); }
    if (selectedType !== "all") {
      if (selectedType === "기본") { filteredSkins = filteredSkins.filter(s => !s["스킨 타입 - 한글"]); }
      else { filteredSkins = filteredSkins.filter(s => s["스킨 타입 - 한글"] === selectedType); }
    }
    if (selectedFaction !== "all") { filteredSkins = filteredSkins.filter(s => s["진영"] === selectedFaction); }
    if (selectedTag !== "all") {
      if (selectedTag === "X") { filteredSkins = filteredSkins.filter(s => !s["스킨 태그"]); }
      else { filteredSkins = filteredSkins.filter(s => s["스킨 태그"] && s["스킨 태그"].includes(selectedTag)); }
    }
    filteredSkins = filteredSkins.filter(s => selectedRarities.includes(s["레어도"]));
    filteredSkins.sort((a, b) => (a["클뜯 id"] || 0) - (b["클뜯 id"] || 0));
    renderPollList(filteredSkins);
    fetchScoresAndSort(filteredSkins, currentRequestId);
  };

  const fetchScoresAndSort = async (skins, requestId) => {
    const skinIds = skins.map(s => s.id);
    if (!skinIds || skinIds.length === 0) {
        currentlyDisplayedSkins = [...skins];
        return;
    }
    const pollRef = db.collection("skin_polls");
    const pollDataMap = {};
    const foundIds = new Set();
    for (let i = 0; i < skinIds.length; i += 10) {
        if (requestId !== currentRequestId) { return; }
        const chunk = skinIds.slice(i, i + 10);
        if (chunk.length === 0) continue;
        try {
            const query = pollRef.where(firebase.firestore.FieldPath.documentId(), 'in', chunk);
            const snapshot = await query.get();
            if (requestId !== currentRequestId) { return; }
            snapshot.forEach(doc => {
                const skinId = doc.id;
                foundIds.add(skinId);
                pollDataMap[skinId] = doc.data();
                const resultsEl = document.getElementById(`results-${skinId}`);
                if (resultsEl) {
                    const data = doc.data();
                    resultsEl.textContent = (data.total_votes > 0)
                        ? `평균 점수: ${(data.total_score / data.total_votes).toFixed(2)} / 5 (${data.total_votes} 표)`
                        : "아직 투표가 없습니다.";
                }
            });
        } catch (error) {
            console.error("A batch of poll results failed to load:", error);
            chunk.forEach(skinId => {
                const resultsEl = document.getElementById(`results-${skinId}`);
                if (resultsEl) resultsEl.textContent = "결과 로딩 실패";
            });
        }
    }
    skinIds.forEach(skinId => {
        if (!foundIds.has(skinId)) {
            const resultsEl = document.getElementById(`results-${skinId}`);
            if (resultsEl && resultsEl.textContent === '결과 불러오는 중...') {
                 resultsEl.textContent = "아직 투표가 없습니다.";
            }
        }
    });
    if (requestId !== currentRequestId) { return; }
    currentlyDisplayedSkins = skins.map(skin => {
        const data = pollDataMap[skin.id];
        return {
            ...skin,
            total_votes: data?.total_votes || 0,
            average_score: (data && data.total_votes > 0) ? (data.total_score / data.total_votes) : 0,
        };
    });
    reSortView();
  };

  const reSortView = async () => {
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
    const allPollBoxes = Array.from(pollContainer.children);
    allPollBoxes.forEach(box => {
        const initialPos = box.getBoundingClientRect();
        box.dataset.initialTop = initialPos.top;
        box.dataset.initialLeft = initialPos.left;
    });
    currentlyDisplayedSkins.forEach(skin => {
        const pollBox = document.getElementById(`poll-box-${skin.id}`);
        if (pollBox) {
            pollContainer.appendChild(pollBox);
        }
    });
    allPollBoxes.forEach(box => {
        const newPos = box.getBoundingClientRect();
        const deltaX = parseFloat(box.dataset.initialLeft) - newPos.left;
        const deltaY = parseFloat(box.dataset.initialTop) - newPos.top;
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

  const fetchAndDisplayResults = (skinId) => {
    const resultsEl = document.getElementById(`results-${skinId}`);
    if (!resultsEl) return;
    const pollRef = db.collection("skin_polls").doc(String(skinId));
    pollRef.get().then((doc) => {
      if (doc.exists) {
        const data = doc.data();
        resultsEl.textContent = (data.total_votes > 0)
          ? `평균 점수: ${(data.total_score / data.total_votes).toFixed(2)} / 5 (${data.total_votes} 표)`
          : "아직 투표가 없습니다.";
      } else { resultsEl.textContent = "아직 투표가 없습니다."; }
    }).catch((error) => {
      console.error("Error fetching poll results:", error);
      resultsEl.textContent = "결과를 불러올 수 없습니다.";
    });
  };
  const submitVote = (skinId, rating, skinName, characterName) => {
    if (localStorage.getItem(`voted_${skinId}`) === "true") { return; }
    const pollRef = db.collection("skin_polls").doc(String(skinId));
    const increment = firebase.firestore.FieldValue.increment(1);
    const ratingIncrement = firebase.firestore.FieldValue.increment(rating);
    pollRef.set({
        total_votes: increment,
        total_score: ratingIncrement,
        skin_name: skinName,
        character_name: characterName
    }, { merge: true })
    .then(() => {
        localStorage.setItem(`voted_${skinId}`, "true");
        const ratingArea = document.querySelector(`.rating-area[data-skin-id-area="${skinId}"]`);
        if (ratingArea) {
            ratingArea.classList.add("voted");
        }
        fetchAndDisplayResults(skinId);
    })
    .catch((error) => { console.error("Firebase vote submission failed: ", error); });
  };
  const rebuildDropdown = (selectElement, optionsData) => {
    const currentVal = selectElement.value;
    selectElement.innerHTML = '<option value="all">전체</option>';
    optionsData.forEach((data) => {
      const option = document.createElement("option");
      option.value = data.value;
      option.textContent = data.text;
      selectElement.appendChild(option);
    });
    selectElement.value = optionsData.some((d) => d.value === currentVal) ? currentVal : "all";
  };
  const populateInitialFilters = () => {
    allCharacterNamesData = [...new Set(allSkins.map((s) => s["함순이 이름"]))].filter(Boolean).sort().map((name) => ({ value: name, text: name }));
    rebuildDropdown(characterNameSelect, allCharacterNamesData);
    rarityCheckboxes.querySelectorAll("input").forEach((checkbox) => { checkbox.addEventListener("change", applyFilters); });
    sortSelect.querySelector('option[value="score_desc"]').disabled = false;
    sortSelect.querySelector('option[value="votes_desc"]').disabled = false;
    sortSelect.addEventListener('change', reSortView);
  };
  const fetchAllPollData = async () => {
    const pollRef = db.collection("skin_polls");
    const allPollData = {};
    try {
      const snapshot = await pollRef.get();
      snapshot.forEach(doc => { allPollData[doc.id] = doc.data(); });
    } catch (error) { console.error("Error fetching all poll data:", error); }
    return allPollData;
  };
  const populateLeaderboard = (allPollData) => { /* ... same as before ... */ };
  const resetFilters = () => { /* ... same as before ... */ };
  
  // --- Event Listeners ---
  const clearPendingVote = () => {
      if (pendingVote) {
          const ratingArea = document.querySelector(`.rating-area[data-skin-id-area="${pendingVote.skinId}"]`);
          if (ratingArea) {
              ratingArea.classList.remove('pending-vote');
              // Uncheck the radio button
              const checkedRadio = ratingArea.querySelector(`input[name="rating-${pendingVote.skinId}"]:checked`);
              if (checkedRadio) {
                  checkedRadio.checked = false;
              }
          }
          pendingVote = null;
      }
  };

  pollContainer.addEventListener("click", (event) => {
    const starLabel = event.target.closest('.star-rating label');
    if (!starLabel) return;

    const ratingArea = event.target.closest('.rating-area');
    if (ratingArea.classList.contains('voted')) return;
    
    event.preventDefault(); // Prevent default label behavior

    const skinId = ratingArea.dataset.skinIdArea;
    const rating = parseInt(starLabel.htmlFor.split('-')[0].replace('star', ''), 10);
    const starRatingDiv = ratingArea.querySelector('.star-rating');
    const skinName = starRatingDiv.dataset.skinName;
    const characterName = starRatingDiv.dataset.characterName;

    // If this click is a confirmation of the pending vote
    if (pendingVote && pendingVote.skinId === skinId && pendingVote.rating === rating) {
        submitVote(pendingVote.skinId, pendingVote.rating, skinName, characterName);
        clearPendingVote();
    } else { // If this is a new, first click
        clearPendingVote(); // Clear any other pending vote first
        pendingVote = { skinId, rating };
        ratingArea.classList.add('pending-vote');
        document.getElementById(`star${rating}-${skinId}`).checked = true;
    }
  });

  document.addEventListener('click', (event) => {
      if (pendingVote && !event.target.closest(`.rating-area[data-skin-id-area="${pendingVote.skinId}"]`)) {
          clearPendingVote();
      }
  });

  leaderboardToggleBtn.addEventListener('click', () => { /* ... same as before ... */ });
  resetFiltersBtn.addEventListener('click', resetFilters);
  characterNameSearch.addEventListener("input", debounce(() => {
    rebuildDropdown(characterNameSelect, allCharacterNamesData.filter((char) => char.text.toLowerCase().includes(characterNameSearch.value.toLowerCase())));
    applyFilters();
  }, 250));
  [characterNameSelect, skinTypeSelect, factionSelect, tagSelect].forEach((el) => {
    el.addEventListener("change", applyFilters);
  });
});