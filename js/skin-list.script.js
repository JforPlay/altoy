document.addEventListener('DOMContentLoaded', () => {
    // Get HTML elements
    const searchInput = document.getElementById('search-input');
    const skinTypeSelect = document.getElementById('skin-type-select');
    const periodSelect = document.getElementById('period-select');
    const rarityCheckboxes = document.getElementById('rarity-checkboxes');
    const factionSelect = document.getElementById('faction-select');
    const tagSelect = document.getElementById('tag-select');
    const exDialogueCheckbox = document.getElementById('ex-dialogue-checkbox');
    const clearAllBtn = document.getElementById('clear-all-btn');

    // Pop-up elements
    const infoButton = document.getElementById('info-button');
    const infoPopup = document.getElementById('info-popup');
    const closePopupBtn = infoPopup.querySelector('.close-popup-btn');

    // Section wrappers and containers
    const sections = {
        new: document.getElementById('new-skins-section'),
        limited: document.getElementById('limited-skins-section'),
        permanent: document.getElementById('permanent-skins-section'),
        other: document.getElementById('other-skins-section')
    };
    const containers = {
        new: document.getElementById('new-skins-container'),
        limited: document.getElementById('limited-skins-container'),
        permanent: document.getElementById('permanent-skins-container'),
        other: document.getElementById('other-skins-container')
    };

    let allSkins = [];
    let fuse; // Fuse.js instance for fuzzy search
    const fuseOptions = {
        includeMatches: true,
        threshold: 0.4,
        keys: ['name']
    };

    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    // --- URL State Management ---
    const updateURLWithFilters = () => {
        const params = new URLSearchParams();
        if (skinTypeSelect.value !== 'all') params.set('type', skinTypeSelect.value);
        if (tagSelect.value !== 'all') params.set('tag', tagSelect.value);
        if (periodSelect.value !== 'all') params.set('period', periodSelect.value);
        if (factionSelect.value !== 'all') params.set('faction', factionSelect.value);
        const selectedRarities = [...rarityCheckboxes.querySelectorAll("input:checked")].map(cb => cb.value);
        if (selectedRarities.length < 5) params.set('rarities', selectedRarities.join(','));
        if (exDialogueCheckbox.checked) params.set('ex', 'true');
        if (searchInput.value) params.set('search', searchInput.value);
        
        const newUrl = `${window.location.pathname}?${params.toString()}`;
        history.replaceState({}, '', newUrl);
    };

    const applyFiltersFromURL = () => {
        const params = new URLSearchParams(window.location.search);
        skinTypeSelect.value = params.get('type') || 'all';
        tagSelect.value = params.get('tag') || 'all';
        periodSelect.value = params.get('period') || 'all';
        factionSelect.value = params.get('faction') || 'all';
        searchInput.value = params.get('search') || '';
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

    // --- Data Fetching and Processing ---
    fetch('data/skin_voiceline_data.json')
        .then(res => res.json())
        .then(skinJson => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const processedSkins = Object.values(skinJson).map(skin => {
                if (skin['기간'] === null) {
                    const skinType = skin['스킨 타입 - 한글'];
                    if (skinType === null || skinType === '개조' || skinType === '서약') skin['기간'] = '상시';
                }
                if (skin['기간'] && skin['기간'].includes('한정')) {
                    skin.isNew = false;
                    try {
                        const dateString = skin['기간'].substring(skin['기간'].indexOf('['));
                        const [year, month, day] = JSON.parse(dateString);
                        const skinDate = new Date(year, month - 1, day);
                        if (skinDate >= today) skin.isNew = true;
                    } catch (e) { /* Ignore parsing errors */ }
                }
                return skin;
            });

            allSkins = processedSkins.filter(skin => skin['깔끔한 일러']);

            const uniqueShipNames = [...new Set(allSkins.map(skin => skin['함순이 이름']))].sort();
            fuse = new Fuse(uniqueShipNames.map(name => ({ name })), fuseOptions);

            applyFiltersFromURL();
        }).catch(error => {
            console.error("Failed to load data:", error);
        });

    // --- Rendering Functions ---
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
        // Construct the dynamic URL for the skin viewer page
        const characterName = encodeURIComponent(skin['함순이 이름']);
        const skinName = encodeURIComponent(skin['한글 함순이 + 스킨 이름']);
        const linkUrl = `pages/skin/skin-viewer.html?character=${characterName}&skin=${skinName}`;

        const gemIconHtml = `<img src="assets/icon/60px-Ruby.png" class="gem-icon" alt="Gem">`;
        let costHtml = skin['재화'] ? `${gemIconHtml} ${skin['재화']}` : 'N/A';
        let periodHtml = formatPeriodString(skin['기간']);
        const badgeHtml = skin.isNew ? '<div class="new-badge">New</div>' : '';

        // Wrap the entire skin box in an anchor tag
        return `
            <a href="${linkUrl}" class="skin-box-link">
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
            </a>
        `;
    };

    const renderSkinsBySection = (skinsToRender) => {
        Object.values(containers).forEach(c => c.innerHTML = '');
        
        const fragments = {
            new: document.createDocumentFragment(),
            limited: document.createDocumentFragment(),
            permanent: document.createDocumentFragment(),
            other: document.createDocumentFragment()
        };

        skinsToRender.forEach(skin => {
            const skinBoxHtml = createSkinBoxHtml(skin);
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = skinBoxHtml.trim();
            const skinNode = tempDiv.firstChild;
            if (skin.isNew) {
                fragments.new.appendChild(skinNode);
            } else {
                const skinPeriod = skin['기간'];
                if (skinPeriod && skinPeriod.includes('한정')) fragments.limited.appendChild(skinNode);
                else if (skinPeriod === '상시') fragments.permanent.appendChild(skinNode);
                else fragments.other.appendChild(skinNode);
            }
        });
        
        for (const key in containers) {
            containers[key].appendChild(fragments[key]);
            sections[key].style.display = containers[key].hasChildNodes() ? 'block' : 'none';
        }
    };

    // --- Autocomplete & Filtering Logic (Unchanged from previous version) ---
    function closeAutocomplete() {
        const list = document.getElementById("autocomplete-list");
        if (list) list.remove();
    }

    function renderAutocomplete(results) {
        closeAutocomplete();
        if (results.length === 0) return;

        const autocompleteList = document.createElement("div");
        autocompleteList.id = "autocomplete-list";
        autocompleteList.className = "autocomplete-items";
        searchInput.parentNode.appendChild(autocompleteList);

        results.slice(0, 10).forEach(result => {
            const item = result.item;
            const matches = result.matches;
            const suggestionDiv = document.createElement("div");

            if (matches && matches.length > 0 && matches[0].indices) {
                let highlightedName = '';
                let lastIndex = 0;
                matches[0].indices.forEach(([start, end]) => {
                    highlightedName += item.name.substring(lastIndex, start);
                    highlightedName += `<mark>${item.name.substring(start, end + 1)}</mark>`;
                    lastIndex = end + 1;
                });
                highlightedName += item.name.substring(lastIndex);
                suggestionDiv.innerHTML = highlightedName;
            } else {
                suggestionDiv.textContent = item.name;
            }

            suggestionDiv.addEventListener("click", () => {
                searchInput.value = item.name;
                closeAutocomplete();
                applyFilters();
                updateURLWithFilters();
            });
            autocompleteList.appendChild(suggestionDiv);
        });
    }
    
    const applyFilters = () => {
        const searchTerm = searchInput.value.toLowerCase().trim();
        const selectedType = skinTypeSelect.value;
        const selectedTag = tagSelect.value;
        const selectedPeriod = periodSelect.value;
        const selectedFaction = factionSelect.value;
        const selectedRarities = [...rarityCheckboxes.querySelectorAll('input:checked')].map(cb => cb.value);
        const showOnlyEx = exDialogueCheckbox.checked;

        let filteredSkins = allSkins;

        if (searchTerm) filteredSkins = filteredSkins.filter(skin => skin['함순이 이름'].toLowerCase().includes(searchTerm));
        if (selectedPeriod !== 'all') {
            if (selectedPeriod === '한정') filteredSkins = filteredSkins.filter(s => s['기간'] && s['기간'].includes('한정'));
            else if (selectedPeriod === '상시') filteredSkins = filteredSkins.filter(s => s['기간'] === '상시');
        }
        if (showOnlyEx) filteredSkins = filteredSkins.filter(s => s['ex_chat_status'] === 1);
        if (selectedType !== 'all') {
            if (selectedType === '기본') filteredSkins = filteredSkins.filter(s => !s['스킨 타입 - 한글']);
            else filteredSkins = filteredSkins.filter(s => s['스킨 타입 - 한글'] === selectedType);
        }
        if (selectedFaction !== 'all') filteredSkins = filteredSkins.filter(s => s['진영'] === selectedFaction);
        if (selectedTag !== 'all') {
            if (selectedTag === "X") {
                const tagsToExclude = ['듀얼', 'L2D', 'L2D+', '쁘띠모션'];
                filteredSkins = filteredSkins.filter(s => !s['스킨 태그'] || !tagsToExclude.some(tag => s['스킨 태그'].includes(tag)));
            } else {
                filteredSkins = filteredSkins.filter(s => s["스킨 태그"] && s["스킨 태그"].includes(selectedTag));
            }
        }
        if (selectedRarities.length > 0) filteredSkins = filteredSkins.filter(s => selectedRarities.includes(s['레어도']));

        renderSkinsBySection(filteredSkins);
    };
    
    const debouncedApplyFiltersAndUpdateURL = debounce(() => {
        applyFilters();
        updateURLWithFilters();
    }, 300);

    const handleSearchInput = () => {
        const searchTerm = searchInput.value;
        if (fuse && searchTerm.trim() !== '') {
            const results = fuse.search(searchTerm);
            renderAutocomplete(results);
        } else {
            closeAutocomplete();
        }
        debouncedApplyFiltersAndUpdateURL();
    }
    
    function resetFilters() {
        searchInput.value = '';
        skinTypeSelect.value = 'all';
        periodSelect.value = 'all';
        factionSelect.value = 'all';
        tagSelect.value = 'all';
        exDialogueCheckbox.checked = false;
        rarityCheckboxes.querySelectorAll('input').forEach(cb => cb.checked = true);
        applyFilters();
        updateURLWithFilters();
    }

    // --- Attach Event Listeners ---
    searchInput.addEventListener('input', handleSearchInput);
    
    const filterElements = [skinTypeSelect, periodSelect, factionSelect, tagSelect, exDialogueCheckbox];
    filterElements.forEach(el => el.addEventListener('change', () => {
        applyFilters();
        updateURLWithFilters();
    }));
    rarityCheckboxes.querySelectorAll('input').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            applyFilters();
            updateURLWithFilters();
        });
    });

    window.addEventListener('popstate', applyFiltersFromURL);
    
    clearAllBtn.addEventListener('click', resetFilters);

    document.addEventListener("click", (e) => {
        if (!searchInput.parentNode.contains(e.target)) {
            closeAutocomplete();
        }
    });

    // Pop-up functionality
    infoButton.addEventListener('click', () => {
        infoPopup.classList.add('visible');
        document.body.classList.add('no-scroll');
    });

    const closeInfoPopup = () => {
        infoPopup.classList.remove('visible');
        document.body.classList.remove('no-scroll');
    };

    closePopupBtn.addEventListener('click', closeInfoPopup);
    infoPopup.addEventListener('click', (event) => {
        if (event.target === infoPopup) {
            closeInfoPopup();
        }
    });
});