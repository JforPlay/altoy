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

    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
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

    // --- State Variables ---
    let allSkins = [];
    let allCharacterNamesData = [];

    const debounce = (func, delay) => {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                func.apply(this, args);
            }, delay);
        };
    };

    // --- Main Data Fetching and Initialization ---
    fetch("data/subset_skin_data.json")
        .then((response) => response.json())
        .then((jsonData) => {
            allSkins = Object.keys(jsonData).map((key) => ({ id: key, ...jsonData[key] }));
            populateInitialFilters();
            tagSelect.value = "L2D";
            applyFilters();
            fetchAllPollData().then(allPollData => {
                populateLeaderboard(allPollData);
            });
        });

    // --- LEADERBOARD LOGIC ---
    const fetchAllPollData = async () => {
        const pollRef = db.collection("skin_polls");
        const allPollData = {};
        try {
            const snapshot = await pollRef.get();
            snapshot.forEach(doc => { allPollData[doc.id] = doc.data(); });
        } catch (error) {
            console.error("Error fetching all poll data:", error);
        }
        return allPollData;
    };

    const populateLeaderboard = (allPollData) => {
        if (!allSkins.length || !Object.keys(allPollData).length) return;

        const MIN_VOTES = 5;
        const rankedSkins = Object.keys(allPollData)
            .map(skinId => {
                const poll = allPollData[skinId];
                const skinInfo = allSkins.find(s => s.id === skinId);
                if (!skinInfo || !poll.total_votes || poll.total_votes < MIN_VOTES) {
                    return null;
                }
                return {
                    id: skinId,
                    name: skinInfo["한글 함순이 + 스킨 이름"],
                    charName: skinInfo["함순이 이름"],
                    imageUrl: skinInfo["깔끔한 일러"],
                    average_score: poll.total_score / poll.total_votes,
                    total_votes: poll.total_votes,
                };
            })
            .filter(Boolean);

        rankedSkins.sort((a, b) => {
            if (b.average_score !== a.average_score) {
                return b.average_score - a.average_score;
            }
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
                <div class="skin-name">${skin.name}</div>
                <div class="char-name">${skin.charName}</div>
            </div>
            <div class="leaderboard-score">
                <div class="avg-score">★ ${skin.average_score.toFixed(2)}</div>
                <div class="total-votes">(${skin.total_votes} 표)</div>
            </div>
        </div>
    `).join('');
    };

    leaderboardToggleBtn.addEventListener('click', () => {
        leaderboardContent.classList.toggle('visible');
        leaderboardToggleBtn.textContent = leaderboardContent.classList.contains('visible')
            ? '🔼 리더보드 숨기기'
            : '🏆 Top 10 스킨 보기';
    });

    // --- FILTERING, SORTING, AND RENDERING LOGIC ---
    const populateInitialFilters = () => {
        allCharacterNamesData = [...new Set(allSkins.map((s) => s["함순이 이름"]))]
            .filter(Boolean).sort().map((name) => ({ value: name, text: name }));
        rebuildDropdown(characterNameSelect, allCharacterNamesData);
        rarityCheckboxes.querySelectorAll("input").forEach((checkbox) => {
            checkbox.addEventListener("change", applyFilters);
        });
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

    const applyFilters = async () => {
        const selectedCharName = characterNameSelect.value;
        const selectedType = skinTypeSelect.value;
        const selectedFaction = factionSelect.value;
        const selectedTag = tagSelect.value;
        const selectedRarities = [...rarityCheckboxes.querySelectorAll("input:checked")].map(cb => cb.value);
        const sortBy = sortSelect.value;

        let filteredSkins = allSkins;

        if (selectedCharName !== "all") { filteredSkins = filteredSkins.filter(s => s["함순이 이름"] === selectedCharName); }
        if (selectedType !== "all") {
            if (selectedType === "기본") { filteredSkins = filteredSkins.filter(s => !s["스킨 타입 - 한글"]); }
            else { filteredSkins = filteredSkins.filter(s => s["스킨 타입 - 한글"] === selectedType); }
        }
        if (selectedFaction !== "all") { filteredSkins = filteredSkins.filter(s => s["진영"] === selectedFaction); }

        // --- FIX FOR FILTERING ---
        // Correctly handles the "X" tag to mean "no tag"
        if (selectedTag !== "all") {
            if (selectedTag === "X") {
                filteredSkins = filteredSkins.filter(s => !s["스킨 태그"]); // Checks for null, undefined, or empty string
            } else {
                filteredSkins = filteredSkins.filter(s => s["스킨 태그"]?.includes(selectedTag));
            }
        }

        if (selectedRarities.length > 0) { filteredSkins = filteredSkins.filter(s => selectedRarities.includes(s["레어도"])); }

        const pollData = await fetchPollDataForSkins(filteredSkins.map(s => s.id));
        let skinsWithData = filteredSkins.map(skin => {
            const data = pollData[skin.id];
            return {
                ...skin,
                total_votes: data ? data.total_votes : 0,
                average_score: data && data.total_votes > 0 ? (data.total_score / data.total_votes) : 0,
            };
        });

        // --- FIX FOR SORTING ---
        // Adds a secondary, alphabetical sort to ensure a consistent order when scores or votes are tied.
        const defaultSort = (a, b) => (a["한글 함순이 + 스킨 이름"] || "").localeCompare(b["한글 함순이 + 스킨 이름"] || "");

        if (sortBy === 'score_desc') {
            skinsWithData.sort((a, b) => {
                const scoreDiff = b.average_score - a.average_score;
                return scoreDiff !== 0 ? scoreDiff : defaultSort(a, b); // Tie-breaker
            });
        } else if (sortBy === 'votes_desc') {
            skinsWithData.sort((a, b) => {
                const voteDiff = b.total_votes - a.total_votes;
                return voteDiff !== 0 ? voteDiff : defaultSort(a, b); // Tie-breaker
            });
        } else {
            skinsWithData.sort(defaultSort);
        }

        renderPollList(skinsWithData);
    };

    const fetchPollDataForSkins = async (skinIds) => {
        if (skinIds.length === 0) return {};
        const pollRef = db.collection("skin_polls");
        const promises = [];
        const pollDataMap = {};
        for (let i = 0; i < skinIds.length; i += 30) {
            const chunk = skinIds.slice(i, i + 30);
            promises.push(pollRef.where(firebase.firestore.FieldPath.documentId(), 'in', chunk).get());
        }
        try {
            const snapshots = await Promise.all(promises);
            snapshots.forEach(snapshot => {
                snapshot.forEach(doc => { pollDataMap[doc.id] = doc.data(); });
            });
        } catch (error) { console.error("Error fetching batch poll results:", error); }
        return pollDataMap;
    };

    const renderPollList = (skinsToRender) => {
        pollContainer.innerHTML = "";
        skinsToRender.forEach((skin) => {
            const skinId = skin.id;
            const pollBox = document.createElement("div");
            pollBox.className = "poll-box";
            const hasVoted = localStorage.getItem(`voted_${skinId}`) === "true";
            const resultsText = skin.total_votes > 0
                ? `평균 점수: ${skin.average_score.toFixed(2)} / 5 (${skin.total_votes} 표)`
                : "아직 투표가 없습니다.";

            pollBox.innerHTML = `
        <img src="${skin["깔끔한 일러"]}" class="poll-image" loading="lazy">
        <div class="poll-info">
            <div class="character-name">${skin["함순이 이름"]}</div>
            <h3>${skin["한글 함순이 + 스킨 이름"]}</h3>
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
                <div class="poll-results" id="results-${skinId}">${resultsText}</div>
            </div>
        </div>`;
            pollContainer.appendChild(pollBox);
        });
    };

    // --- VOTING LOGIC ---
    const submitVote = (skinId, rating, skinName, characterName) => {
        if (localStorage.getItem(`voted_${skinId}`) === "true") {
            console.log("해당 스킨에 이미 투표하셨습니다.");
            return;
        }
        const pollRef = db.collection("skin_polls").doc(String(skinId));
        return db.runTransaction((transaction) => {
            return transaction.get(pollRef).then((doc) => {
                const newTotalVotes = (doc.data()?.total_votes || 0) + 1;
                const newTotalScore = (doc.data()?.total_score || 0) + rating;
                transaction.set(pollRef, {
                    total_votes: newTotalVotes, total_score: newTotalScore,
                    skin_name: skinName, character_name: characterName,
                }, { merge: true });
            });
        }).then(() => {
            localStorage.setItem(`voted_${skinId}`, "true");
            const ratingArea = document.querySelector(`.star-rating[data-skin-id="${skinId}"]`).closest(".rating-area");
            if (ratingArea) {
                ratingArea.classList.add("voted");
                ratingArea.querySelectorAll("input").forEach((input) => (input.disabled = true));
            }
            fetchAndDisplayResults(skinId);
        }).catch((error) => console.error("Firebase transaction failed: ", error));
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
            } else {
                resultsEl.textContent = "아직 투표가 없습니다.";
            }
        }).catch((error) => {
            console.error("Error fetching poll results:", error);
            resultsEl.textContent = "결과를 불러올 수 없습니다.";
        });
    };

    // --- EVENT LISTENERS ---
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
        rebuildDropdown(
            characterNameSelect,
            allCharacterNamesData.filter((char) => char.text.toLowerCase().includes(characterNameSearch.value.toLowerCase()))
        );
    }, 250));

    [characterNameSelect, skinTypeSelect, factionSelect, tagSelect, sortSelect].forEach((el) => {
        el.addEventListener("change", applyFilters);
    });
});