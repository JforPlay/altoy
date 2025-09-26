document.addEventListener('DOMContentLoaded', () => {
    // Get HTML elements
    const searchInput = document.getElementById('search-input');
    const skinTypeSelect = document.getElementById('skin-type-select');
    const periodSelect = document.getElementById('period-select');
    const rarityCheckboxes = document.getElementById('rarity-checkboxes');
    const factionSelect = document.getElementById('faction-select');
    const tagSelect = document.getElementById('tag-select');
    const exDialogueCheckbox = document.getElementById('ex-dialogue-checkbox');

    // Section wrappers
    const newSkinsSection = document.getElementById('new-skins-section');
    const limitedSkinsSection = document.getElementById('limited-skins-section');
    const permanentSkinsSection = document.getElementById('permanent-skins-section');
    const otherSkinsSection = document.getElementById('other-skins-section');

    // Skin containers
    const newSkinsContainer = document.getElementById('new-skins-container');
    const limitedSkinsContainer = document.getElementById('limited-skins-container');
    const permanentSkinsContainer = document.getElementById('permanent-skins-container');
    const otherSkinsContainer = document.getElementById('other-skins-container');

    let allSkins = [];
    let uniqueShipNames = [];

    /**
     * Debounce function to delay execution, improving performance.
     */
    function debounce(func, delay) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    // --- URL State Management Functions (Unchanged) ---
    const updateURLWithFilters = () => {
        const params = new URLSearchParams();
        if (skinTypeSelect.value !== 'all') params.set('type', skinTypeSelect.value);
        if (tagSelect.value !== 'all') params.set('tag', tagSelect.value);
        if (periodSelect.value !== 'all') params.set('period', periodSelect.value);
        if (factionSelect.value !== 'all') params.set('faction', factionSelect.value);
        const selectedRarities = [...rarityCheckboxes.querySelectorAll("input:checked")].map(cb => cb.value);
        if (selectedRarities.length < 5) {
            params.set('rarities', selectedRarities.join(','));
        }
        if (exDialogueCheckbox.checked) params.set('ex', 'true');
        const newUrl = `${window.location.pathname}?${params.toString()}`;
        history.pushState({}, '', newUrl);
    };

    const applyFiltersFromURL = () => {
        const params = new URLSearchParams(window.location.search);
        skinTypeSelect.value = params.get('type') || 'all';
        tagSelect.value = params.get('tag') || 'all';
        periodSelect.value = params.get('period') || 'all';
        factionSelect.value = params.get('faction') || 'all';
        const raritiesParam = params.get('rarities');
        if (raritiesParam) {
            const activeRarities = raritiesParam.split(',');
            rarityCheckboxes.querySelectorAll('input').forEach(cb => {
                cb.checked = activeRarities.includes(cb.value);
            });
        }
        exDialogueCheckbox.checked = params.get('ex') === 'true';
        applyFilters();
    };


    // Fetch and process data
    Promise.all([
        fetch('data/subset_skin_data.json').then(res => res.json())
    ]).then(([skinJson]) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const processedSkins = Object.values(skinJson).map(skin => {
            if (skin['기간'] === null) {
                const skinType = skin['스킨 타입 - 한글'];
                if (skinType === null || skinType === '개조' || skinType === '서약') {
                    skin['기간'] = '상시';
                }
            }
            if (skin['기간'] && skin['기간'].includes('한정')) {
                skin.isNew = false;
                try {
                    const dateString = skin['기간'].substring(skin['기간'].indexOf('['));
                    const [year, month, day] = JSON.parse(dateString);
                    const skinDate = new Date(year, month - 1, day);
                    if (skinDate >= today) {
                        skin.isNew = true;
                    }
                } catch (e) {
                    console.warn(`Could not parse date for skin: ${skin['함순이 이름']}`, skin['기간']);
                }
            }
            return skin;
        });

        allSkins = processedSkins.filter(skin => skin['깔끔한 일러']);

        // Create a sorted list of unique names for autocomplete
        const names = new Set(allSkins.map(skin => skin['함순이 이름']));
        uniqueShipNames = Array.from(names).sort();

        applyFiltersFromURL();

    }).catch(error => {
        console.error("Failed to load data:", error);
    });

    const formatPeriodString = (periodString) => {
        if (!periodString) return '정보 없음';
        if (periodString.includes('한정')) {
            try {
                const dateString = periodString.substring(periodString.indexOf('['));
                const [year, month, day] = JSON.parse(dateString);
                const mm = String(month).padStart(2, '0');
                const dd = String(day).padStart(2, '0');
                return `한정 (${year}/${mm}/${dd})`;
            } catch (e) {
                return periodString;
            }
        }
        return periodString;
    };

    const createSkinBoxHtml = (skin) => {
        const gemIconHtml = `<img src="assets/icon/60px-Ruby.png" class="gem-icon" alt="Gem">`;
        let costHtml = skin['재화'] ? `${gemIconHtml} ${skin['재화']}` : 'N/A';
        let periodHtml = formatPeriodString(skin['기간']);
        const badgeHtml = skin.isNew ? '<div class="new-badge">New</div>' : '';

        return `
            <div class="skin-box">
                <div class="skin-image-wrapper">
                    ${badgeHtml}
                    <img src="${skin['깔끔한 일러']}" class="skin-image" loading="lazy">
                </div>
                <div class="skin-info">
                    <h3>${skin['함순이 이름']}</h3>
                    <div class="info-line"><strong>타입:</strong> ${skin['스킨 타입 - 한글'] || '기본'}</div>
                    <div class="info-line"><strong>태그:</strong> ${skin['스킨 태그'] || '없음'}</div>
                    <div class="info-line"><strong>진영:</strong> ${skin['진영'] || '없음'}</div>
                    <div class="info-line"><strong>레어도:</strong> ${skin['레어도'] || '없음'}</div>
                    <div class="info-line"><strong>가격:</strong> ${costHtml}</div>
                    <div class="info-line"><strong>기간:</strong> ${periodHtml}</div>
                </div>
            </div>
        `;
    };

    const renderSkinsBySection = (skinsToRender) => {
        newSkinsContainer.innerHTML = '';
        limitedSkinsContainer.innerHTML = '';
        permanentSkinsContainer.innerHTML = '';
        otherSkinsContainer.innerHTML = '';
        const newFragment = document.createDocumentFragment();
        const limitedFragment = document.createDocumentFragment();
        const permanentFragment = document.createDocumentFragment();
        const otherFragment = document.createDocumentFragment();

        skinsToRender.forEach(skin => {
            const skinBoxHtml = createSkinBoxHtml(skin);
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = skinBoxHtml.trim();
            const skinNode = tempDiv.firstChild;
            if (skin.isNew) {
                newFragment.appendChild(skinNode);
            } else {
                const skinPeriod = skin['기간'];
                if (skinPeriod && skinPeriod.includes('한정')) {
                    limitedFragment.appendChild(skinNode);
                } else if (skinPeriod === '상시') {
                    permanentFragment.appendChild(skinNode);
                } else {
                    otherFragment.appendChild(skinNode);
                }
            }
        });

        newSkinsContainer.appendChild(newFragment);
        limitedSkinsContainer.appendChild(limitedFragment);
        permanentSkinsContainer.appendChild(permanentFragment);
        otherSkinsContainer.appendChild(otherFragment);
        newSkinsSection.style.display = newSkinsContainer.hasChildNodes() ? 'block' : 'none';
        limitedSkinsSection.style.display = limitedSkinsContainer.hasChildNodes() ? 'block' : 'none';
        permanentSkinsSection.style.display = permanentSkinsContainer.hasChildNodes() ? 'block' : 'none';
        otherSkinsSection.style.display = otherSkinsContainer.hasChildNodes() ? 'block' : 'none';
    };

    function closeAllLists() {
        const items = document.getElementsByClassName("autocomplete-items");
        for (let i = 0; i < items.length; i++) {
            items[i].parentNode.removeChild(items[i]);
        }
    }

    const applyFilters = () => {
        const searchTerm = searchInput.value.toLowerCase().trim();

        // --- Autocomplete Logic ---
        closeAllLists();
        if (searchTerm) {
            const autocompleteList = document.createElement("div");
            autocompleteList.setAttribute("id", "autocomplete-list");
            autocompleteList.setAttribute("class", "autocomplete-items");
            searchInput.parentNode.appendChild(autocompleteList);

            for (const name of uniqueShipNames) {
                if (name.toLowerCase().includes(searchTerm)) {
                    const suggestionDiv = document.createElement("div");
                    // Bold the matching part of the name
                    const matchIndex = name.toLowerCase().indexOf(searchTerm);
                    suggestionDiv.innerHTML = name.substring(0, matchIndex);
                    suggestionDiv.innerHTML += `<strong>${name.substring(matchIndex, matchIndex + searchTerm.length)}</strong>`;
                    suggestionDiv.innerHTML += name.substring(matchIndex + searchTerm.length);

                    suggestionDiv.addEventListener("click", function () {
                        searchInput.value = name;
                        closeAllLists();
                        applyFilters(); // Re-run filters with the full name
                    });
                    autocompleteList.appendChild(suggestionDiv);
                }
            }
        }
        // --- End Autocomplete Logic ---

        const selectedType = skinTypeSelect.value;
        const selectedTag = tagSelect.value;
        const selectedPeriod = periodSelect.value;
        const selectedFaction = factionSelect.value;
        const selectedRarities = [...rarityCheckboxes.querySelectorAll('input:checked')].map(cb => cb.value);
        const showOnlyEx = exDialogueCheckbox.checked;

        let filteredSkins = allSkins;

        // Apply search filter first
        if (searchTerm) {
            filteredSkins = filteredSkins.filter(skin =>
                skin['함순이 이름'].toLowerCase().includes(searchTerm)
            );
        }

        // --- Period Filter Logic ---
        if (selectedPeriod !== 'all') {
            if (selectedPeriod === '한정') {
                filteredSkins = filteredSkins.filter(skin => skin['기간'] && skin['기간'].includes('한정'));
            } else if (selectedPeriod === '상시') {
                filteredSkins = filteredSkins.filter(skin => skin['기간'] === '상시');
            }
        }

        if (showOnlyEx) {
            filteredSkins = filteredSkins.filter(skin => skin['ex_chat_status'] === 1);
        }
        if (selectedType !== 'all') {
            if (selectedType === '기본') {
                filteredSkins = filteredSkins.filter(skin => !skin['스킨 타입 - 한글']);
            } else {
                filteredSkins = filteredSkins.filter(skin => skin['스킨 타입 - 한글'] === selectedType);
            }
        }
        if (selectedFaction !== 'all') {
            filteredSkins = filteredSkins.filter(skin => skin['진영'] === selectedFaction);
        }
        if (selectedTag !== 'all') {
            if (selectedTag === "X") {
                const tagsToExclude = ['듀얼', 'L2D', 'L2D+', '쁘띠모션'];
                filteredSkins = filteredSkins.filter(skin => {
                    if (!skin['스킨 태그']) return true;
                    return !tagsToExclude.some(excludedTag => skin['스킨 태그'].includes(excludedTag));
                });
            } else {
                filteredSkins = filteredSkins.filter(s => s["스킨 태그"] && s["스킨 태그"].includes(selectedTag));
            }
        }
        if (selectedRarities.length > 0) {
            filteredSkins = filteredSkins.filter(skin => selectedRarities.includes(skin['레어도']));
        }

        renderSkinsBySection(filteredSkins);
        updateURLWithFilters();
    };

    // Attach event listeners
    searchInput.addEventListener('input', debounce(applyFilters, 300));
    skinTypeSelect.addEventListener('change', applyFilters);
    periodSelect.addEventListener('change', applyFilters);
    factionSelect.addEventListener('change', applyFilters);
    tagSelect.addEventListener('change', applyFilters);
    exDialogueCheckbox.addEventListener('change', applyFilters);
    rarityCheckboxes.querySelectorAll('input').forEach(checkbox => {
        checkbox.addEventListener('change', applyFilters);
    });
    window.addEventListener('popstate', applyFiltersFromURL);

    // Close the autocomplete dropdown if the user clicks elsewhere
    document.addEventListener("click", function (e) {
        if (e.target !== searchInput) {
            closeAllLists();
        }
    });
});