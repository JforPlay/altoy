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
            // This line now creates the skin list AND filters out entries with missing names
            allSkins = Object.keys(jsonData)
                .map((key) => ({ id: key, ...jsonData[key] }))
                .filter(skin => skin["한글 함순이 + 스킨 이름"] && skin["함순이 이름"]);

            sortSelect.value = 'default';
            sortSelect.querySelector('option[value="score_desc"]').disabled = true;
            sortSelect.querySelector('option[value="votes_desc"]').disabled = true;

            populateInitialFilters();
            applyFilters();
            fetchAllPollData().then(populateLeaderboard);
        });

    // --- Core Functions ---
    const applyFilters = () => {
        const selectedCharName = characterNameSelect.value;
        const selectedType = skinTypeSelect.value;
        const selectedFaction = factionSelect.value;
        const selectedTag = tagSelect.value;
        const selectedRarities = [...rarityCheckboxes.querySelectorAll("input:checked")].map(cb => cb.value);

        let filteredSkins = allSkins;

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

        // --- CHANGE: Default sort is now by skin ID ---
        filteredSkins.sort((a, b) => (a.id || "").localeCompare(b.id || ""));

        renderPollList(filteredSkins);
    };

    const renderPollList = (skinsToRender) => {
        pollContainer.innerHTML = "";
        const skinIdsToFetch = [];

        skinsToRender.forEach((skin) => {
            if (!skin || !skin.id) return; // Guard against bad data
            skinIdsToFetch.push(skin.id);

            const skinId = skin.id;
            const pollBox = document.createElement("div");
            pollBox.className = "poll-box";
            const hasVoted = localStorage.getItem(`voted_${skinId}`) === "true";
            pollBox.innerHTML = `
        <img src="${skin["깔끔한 일러"]}" class="poll-image" loading="lazy">
        <div class="poll-info">
            <div class="character-name">${skin["함순이 이름"] || 'Unknown'}</div>
            <h3>${skin["한글 함순이 + 스킨 이름"] || 'Unknown Skin'}</h3>
            <div class="info-line"><strong>타입:</strong> ${skin["스킨 타입 - 한글"] || "기본"}</div>
            <div class="info-line"><strong>태그:</strong> ${skin["스킨 태그"] || "없음"}</div>
            <div class="info-line"><strong>레어도:</strong> ${skin["레어도"] || "없음"}</div>
            <div class="rating-area ${hasVoted ? "voted" : ""}">
                <div class="star-rating" data-skin-id="${skinId}" data-skin-name="${skin["한글 함순이 + 스킨 이름"]}" data-character-name="${skin["함순이 이름"]}">
                     <input type="radio" id="star5-${skinId}" name="rating-${skinId}" value="5" ${hasVoted ? "disabled" : ""}><label for="star5-${skinId}">★</label>
                     <input type="radio" id="star4-${skinId}" name="rating-${skinId}" value="4" ${hasVoted ? "disabled" : ""}><label for="star4-${skinId}">★</label>
                     <input type="radio" id="star3-${skinId}" name="rating-${skinId}" value="3" ${hasVoted ? "disabled" : ""}><label for="star3-${skinId}">★</label>
                     <input type="radio" id="star2-${skinId}" name="rating-${skinId}" value="2" ${hasVoted ? "disabled" : ""}><label for="star2-${skinId}">★</label>
                     <input type="radio" id="star1-${skinId}" name="rating-${skinId}" value="1" ${hasVoted ? "disabled" : ""}><label for="star1-${skinId}">★</label>
                </div>
                <div class="poll-results" id="results-${skinId}">결과 불러오는 중...</div>
            </div>
        </div>`;
            pollContainer.appendChild(pollBox);
        });

        if (skinIdsToFetch.length > 0) {
            fetchAllResultsAndDisplay(skinIdsToFetch);
        }
    };

    
    const fetchAllResultsAndDisplay = async (skinIds) => {
        if (!skinIds || skinIds.length === 0) return;

        const pollRef = db.collection("skin_polls");
        const batchJobs = [];

        // Prepare all the batch requests
        for (let i = 0; i < skinIds.length; i += 30) {
            const chunk = skinIds.slice(i, i + 30);
            if (chunk.length > 0) {
                batchJobs.push({
                    ids: chunk,
                    promise: pollRef.where(firebase.firestore.FieldPath.documentId(), 'in', chunk).get()
                });
            }
        }

        const foundIds = new Set();
        // Run all batch requests in parallel and wait for all to complete (either success or failure)
        const results = await Promise.allSettled(batchJobs.map(job => job.promise));

        // Process the results of each batch
        results.forEach((result, index) => {
            const correspondingBatch = batchJobs[index];
            if (result.status === 'fulfilled') {
                const snapshot = result.value;
                snapshot.forEach(doc => {
                    const skinId = doc.id;
                    foundIds.add(skinId);
                    const resultsEl = document.getElementById(`results-${skinId}`);
                    if (resultsEl) {
                        const data = doc.data();
                        resultsEl.textContent = (data.total_votes > 0)
                            ? `평균 점수: ${(data.total_score / data.total_votes).toFixed(2)} / 5 (${data.total_votes} 표)`
                            : "아직 투표가 없습니다.";
                    }
                });
            } else {
                console.error("A batch of poll results failed to load:", result.reason);
                // If a batch failed, update its skins with an error message
                correspondingBatch.ids.forEach(skinId => {
                    const resultsEl = document.getElementById(`results-${skinId}`);
                    if (resultsEl) resultsEl.textContent = "결과 로딩 실패";
                });
            }
        });

        // Update any remaining skins that had no vote data in the database
        skinIds.forEach(skinId => {
            if (!foundIds.has(skinId)) {
                const resultsEl = document.getElementById(`results-${skinId}`);
                if (resultsEl && resultsEl.textContent === '결과 불러오는 중...') {
                    resultsEl.textContent = "아직 투표가 없습니다.";
                }
            }
        });
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


    // 투표 결과 통신용 - 데이터베이스 관련
    const submitVote = (skinId, rating, skinName, characterName) => {
        if (localStorage.getItem(`voted_${skinId}`) === "true") { return; }

        const pollRef = db.collection("skin_polls").doc(String(skinId));

        // Use Firestore's atomic increment operation for efficiency
        const increment = firebase.firestore.FieldValue.increment(1);
        const ratingIncrement = firebase.firestore.FieldValue.increment(rating);

        // Use .set with { merge: true } to create or update the document
        pollRef.set({
            total_votes: increment,
            total_score: ratingIncrement,
            skin_name: skinName,
            character_name: characterName
        }, { merge: true })
            .then(() => {
                localStorage.setItem(`voted_${skinId}`, "true");
                const ratingArea = document.querySelector(`.star-rating[data-skin-id="${skinId}"]`).closest(".rating-area");
                if (ratingArea) {
                    ratingArea.classList.add("voted");
                    ratingArea.querySelectorAll("input").forEach((input) => (input.disabled = true));
                }
                // Re-fetch the single result to show the new average
                fetchAndDisplayResults(skinId);
            })
            .catch((error) => {
                console.error("Firebase vote submission failed: ", error);
            });
    };


    // 수정_또 수정된 드랍다운 함수
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


    // 초기 필터 옵션 채우기
    const populateInitialFilters = () => {
        allCharacterNamesData = [...new Set(allSkins.map((s) => s["함순이 이름"]))].filter(Boolean).sort().map((name) => ({ value: name, text: name }));
        rebuildDropdown(characterNameSelect, allCharacterNamesData);
        rarityCheckboxes.querySelectorAll("input").forEach((checkbox) => { checkbox.addEventListener("change", applyFilters); });
    };


    // 리더보드 생성을 위한 모든 투표 데이터 가져오기
    const fetchAllPollData = async () => {
        const pollRef = db.collection("skin_polls");
        const allPollData = {};
        try {
            const snapshot = await pollRef.get();
            snapshot.forEach(doc => { allPollData[doc.id] = doc.data(); });
        } catch (error) { console.error("Error fetching all poll data:", error); }
        return allPollData;
    };


    // 리더보드 업데이트 함수
    const populateLeaderboard = (allPollData) => {
        if (!allSkins.length || !Object.keys(allPollData).length) return;
        const MIN_VOTES = 5;
        const rankedSkins = Object.keys(allPollData).map(skinId => {
            const poll = allPollData[skinId];
            const skinInfo = allSkins.find(s => s.id === skinId);
            if (!skinInfo || !poll.total_votes || poll.total_votes < MIN_VOTES) { return null; }
            return {
                id: skinId, name: skinInfo["한글 함순이 + 스킨 이름"], charName: skinInfo["함순이 이름"],
                imageUrl: skinInfo["깔끔한 일러"], average_score: poll.total_score / poll.total_votes, total_votes: poll.total_votes,
            };
        }).filter(Boolean);
        rankedSkins.sort((a, b) => {
            if (b.average_score !== a.average_score) { return b.average_score - a.average_score; }
            return b.total_votes - a.total_votes;
        });
        const top10 = rankedSkins.slice(0, 10);
        if (top10.length === 0) {
            leaderboardContent.innerHTML = `<p style="text-align: center; color: #b9bbbe;">리더보드에 표시할 스킨이 아직 없습니다. (최소 ${MIN_VOTES}표 필요)</p>`;
            return;
        }
        leaderboardContent.innerHTML = top10.map((skin, index) => `
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
        </div>`).join('');
    };


    // 필터 초기화 함수
    const resetFilters = () => {
        characterNameSearch.value = "";
        characterNameSelect.value = "all";
        skinTypeSelect.value = "all";
        factionSelect.value = "all";
        tagSelect.value = "all";
        sortSelect.value = "default";
        rarityCheckboxes.querySelectorAll("input[type='checkbox']").forEach(checkbox => { checkbox.checked = true; });
        rebuildDropdown(characterNameSelect, allCharacterNamesData);
        applyFilters();
    };


    // 필터/버튼 반응 함수들
    leaderboardToggleBtn.addEventListener('click', () => {
        leaderboardContent.classList.toggle('visible');
        leaderboardToggleBtn.textContent = leaderboardContent.classList.contains('visible') ? '🔼 리더보드 숨기기' : '🏆 Top 10 스킨 보기';
    });

    resetFiltersBtn.addEventListener('click', resetFilters);
    
    pollContainer.addEventListener("change", (event) => {
        if (event.target.matches('.star-rating input[type="radio"]')) {
            const starRatingDiv = event.target.closest(".star-rating");
            const skinId = starRatingDiv.dataset.skinId;
            const skinName = starRatingDiv.dataset.skinName;
            const characterName = starRatingDiv.dataset.characterName;
            const rating = parseInt(event.target.value, 10);
            submitVote(skinId, rating, skinName, characterName);
        }
    });

    characterNameSearch.addEventListener("input", debounce(() => {
        rebuildDropdown(characterNameSelect, allCharacterNamesData.filter((char) => char.text.toLowerCase().includes(characterNameSearch.value.toLowerCase())));
    }, 250));

    [characterNameSelect, skinTypeSelect, factionSelect, tagSelect, sortSelect].forEach((el) => {
        el.addEventListener("change", applyFilters);
    });
});