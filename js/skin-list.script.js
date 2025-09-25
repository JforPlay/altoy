document.addEventListener('DOMContentLoaded', () => {
    // Get HTML elements
    const skinTypeSelect = document.getElementById('skin-type-select');
    const rarityCheckboxes = document.getElementById('rarity-checkboxes');
    const skinListContainer = document.getElementById('skin-list-container');
    const factionSelect = document.getElementById('faction-select');
    const tagSelect = document.getElementById('tag-select');
    const exDialogueCheckbox = document.getElementById('ex-dialogue-checkbox');

    let allSkins = [];

    // --- NEW: URL State Management Functions ---

    /**
     * Reads the current state of all filters and updates the browser URL.
     */
    const updateURLWithFilters = () => {
        const params = new URLSearchParams();

        // Add select values if they are not the default 'all'
        if (skinTypeSelect.value !== 'all') params.set('type', skinTypeSelect.value);
        if (factionSelect.value !== 'all') params.set('faction', factionSelect.value);
        if (tagSelect.value !== 'all') params.set('tag', tagSelect.value);

        // Add ex-dialogue status only if the box is checked
        if (exDialogueCheckbox.checked) params.set('ex', 'true');

        // Handle rarities - only add if not all 5 are selected
        const selectedRarities = [...rarityCheckboxes.querySelectorAll("input:checked")].map(cb => cb.value);
        if (selectedRarities.length < 5) {
            params.set('rarities', selectedRarities.join(','));
        }

        // Use pushState to update the URL without reloading the page
        const newUrl = `${window.location.pathname}?${params.toString()}`;
        history.pushState({}, '', newUrl);
    };

    /**
     * Reads filter parameters from the URL and applies them to the page controls.
     */
    const applyFiltersFromURL = () => {
        const params = new URLSearchParams(window.location.search);

        skinTypeSelect.value = params.get('type') || 'all';
        factionSelect.value = params.get('faction') || 'all';
        tagSelect.value = params.get('tag') || 'all';
        exDialogueCheckbox.checked = params.get('ex') === 'true';

        const raritiesParam = params.get('rarities');
        if (raritiesParam) {
            const activeRarities = raritiesParam.split(',');
            rarityCheckboxes.querySelectorAll('input').forEach(cb => {
                cb.checked = activeRarities.includes(cb.value);
            });
        }

        // After setting controls, apply the filters to the list
        applyFilters();
    };


    // Fetch all necessary data files
    Promise.all([
        fetch('data/subset_skin_data.json').then(res => res.json())
    ]).then(([skinJson]) => {
        allSkins = Object.values(skinJson).filter(skin => skin['깔끔한 일러']);
        
        // MODIFIED: Apply filters from URL on load instead of rendering all skins
        applyFiltersFromURL();

    }).catch(error => {
        console.error("Failed to load data:", error);
        skinListContainer.innerHTML = `<p style="color: #f04747; text-align: center;">Error loading data. Please check the data files and console for errors.</p>`;
    });

    // Function to render the list of skin boxes (unchanged)
    const renderSkinList = (skinsToRender) => {
        skinListContainer.innerHTML = '';
        const gemIconHtml = `<img src="assets/icon/60px-Ruby.png" class="gem-icon" alt="Gem">`;

        skinsToRender.forEach(skin => {
            const skinBox = document.createElement('div');
            skinBox.className = 'skin-box';
            let costHtml = skin['재화'] ? `${gemIconHtml} ${skin['재화']}` : 'N/A';

            skinBox.innerHTML = `
                <div class="skin-image-wrapper">
                    <img src="${skin['깔끔한 일러']}" class="skin-image" loading="lazy">
                </div>
                <div class="skin-info">
                    <h3>${skin['함순이 이름']}</h3>
                    <div class="info-line"><strong>타입:</strong> ${skin['스킨 타입 - 한글'] || '기본'}</div>
                    <div class="info-line"><strong>태그:</strong> ${skin['스킨 태그'] || '없음'}</div>
                    <div class="info-line"><strong>진영:</strong> ${skin['진영'] || '없음'}</div>
                    <div class="info-line"><strong>레어도:</strong> ${skin['레어도'] || '없음'}</div>
                    <div class="info-line"><strong>가격:</strong> ${costHtml}</div>
                </div>
            `;
            skinListContainer.appendChild(skinBox);
        });
    };

    // MODIFIED: applyFilters now calls updateURLWithFilters at the end
    const applyFilters = () => {
        const selectedType = skinTypeSelect.value;
        const selectedFaction = factionSelect.value;
        const selectedTag = tagSelect.value;
        const selectedRarities = [...rarityCheckboxes.querySelectorAll('input:checked')].map(cb => cb.value);
        const showOnlyEx = exDialogueCheckbox.checked;

        let filteredSkins = allSkins;

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
             if (selectedTag === "X") { filteredSkins = filteredSkins.filter(s => !s["스킨 태그"]); }
             else { filteredSkins = filteredSkins.filter(s => s["스킨 태그"] && s["스킨 태그"].includes(selectedTag)); }
        }
        if (selectedRarities.length > 0) {
            filteredSkins = filteredSkins.filter(skin => selectedRarities.includes(skin['레어도']));
        }

        renderSkinList(filteredSkins);
        
        // This is the key addition that syncs the URL to the filters.
        updateURLWithFilters();
    };

    // Attach event listeners to all filter controls (unchanged)
    skinTypeSelect.addEventListener('change', applyFilters);
    factionSelect.addEventListener('change', applyFilters);
    tagSelect.addEventListener('change', applyFilters);
    exDialogueCheckbox.addEventListener('change', applyFilters);
    rarityCheckboxes.querySelectorAll('input').forEach(checkbox => {
        checkbox.addEventListener('change', applyFilters);
    });

    // NEW: Add event listener for browser back/forward buttons
    window.addEventListener('popstate', applyFiltersFromURL);
});