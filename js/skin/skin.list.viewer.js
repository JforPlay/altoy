document.addEventListener('DOMContentLoaded', () => {
    // === DOM ELEMENT REFERENCES ===
    const DOM = {
        search: document.getElementById('search-input'),
        filters: {
            skinType: document.getElementById('skin-type-select'),
            period: document.getElementById('period-select'),
            faction: document.getElementById('faction-select'),
            tag: document.getElementById('tag-select'),
            rarities: document.getElementById('rarity-checkboxes'),
            exDialogue: document.getElementById('ex-dialogue-checkbox')
        },
        buttons: {
            clearAll: document.getElementById('clear-all-btn'),
            info: document.getElementById('info-button'),
            filterToggle: document.getElementById('filter-toggle-btn')
        },
        popup: {
            container: document.getElementById('info-popup'),
            closeBtn: document.getElementById('info-popup').querySelector('.close-popup-btn')
        },
        sections: {
            new: document.getElementById('new-skins-section'),
            limited: document.getElementById('limited-skins-section'),
            permanent: document.getElementById('permanent-skins-section'),
            other: document.getElementById('other-skins-section')
        },
        containers: {
            new: document.getElementById('new-skins-container'),
            limited: document.getElementById('limited-skins-container'),
            permanent: document.getElementById('permanent-skins-container'),
            other: document.getElementById('other-skins-container')
        },
        filterContainer: document.getElementById('filter-container')
    };

    // === STATE ===
    let allSkins = [];
    let fuse;
    const fuseOptions = {
        includeMatches: true,
        threshold: 0.4,
        keys: ['name']
    };

    // === CONSTANTS ===
    const FILTER_PARAMS = {
        TYPE: 'type',
        TAG: 'tag',
        PERIOD: 'period',
        FACTION: 'faction',
        RARITIES: 'rarities',
        EX: 'ex',
        SEARCH: 'search'
    };

    const TAGS_TO_EXCLUDE = ['듀얼', 'L2D', 'L2D+', '쁘띠모션'];
    const AUTOCOMPLETE_LIMIT = 10;
    const DEBOUNCE_DELAY = 300;

    // === UTILITY FUNCTIONS ===
    const debounce = (func, delay) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    };

    // === URL STATE MANAGEMENT ===
    const URLState = {
        getFilters() {
            const selectedRarities = [...DOM.filters.rarities.querySelectorAll("input:checked")]
                .map(cb => cb.value);

            return {
                type: DOM.filters.skinType.value,
                tag: DOM.filters.tag.value,
                period: DOM.filters.period.value,
                faction: DOM.filters.faction.value,
                rarities: selectedRarities,
                ex: DOM.filters.exDialogue.checked,
                search: DOM.search.value
            };
        },

        update() {
            const params = new URLSearchParams();
            const filters = this.getFilters();

            if (filters.type !== 'all') params.set(FILTER_PARAMS.TYPE, filters.type);
            if (filters.tag !== 'all') params.set(FILTER_PARAMS.TAG, filters.tag);
            if (filters.period !== 'all') params.set(FILTER_PARAMS.PERIOD, filters.period);
            if (filters.faction !== 'all') params.set(FILTER_PARAMS.FACTION, filters.faction);
            if (filters.rarities.length < 5) params.set(FILTER_PARAMS.RARITIES, filters.rarities.join(','));
            if (filters.ex) params.set(FILTER_PARAMS.EX, 'true');
            if (filters.search) params.set(FILTER_PARAMS.SEARCH, filters.search);

            history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
        },

        apply() {
            const params = new URLSearchParams(window.location.search);
            
            DOM.filters.skinType.value = params.get(FILTER_PARAMS.TYPE) || 'all';
            DOM.filters.tag.value = params.get(FILTER_PARAMS.TAG) || 'all';
            DOM.filters.period.value = params.get(FILTER_PARAMS.PERIOD) || 'all';
            DOM.filters.faction.value = params.get(FILTER_PARAMS.FACTION) || 'all';
            DOM.search.value = params.get(FILTER_PARAMS.SEARCH) || '';

            const raritiesParam = params.get(FILTER_PARAMS.RARITIES);
            if (raritiesParam) {
                const activeRarities = new Set(raritiesParam.split(','));
                DOM.filters.rarities.querySelectorAll('input').forEach(cb => {
                    cb.checked = activeRarities.has(cb.value);
                });
            }

            DOM.filters.exDialogue.checked = params.get(FILTER_PARAMS.EX) === 'true';
            FilterEngine.apply();
        }
    };

    // === AUTOCOMPLETE ===
    const Autocomplete = {
        close() {
            document.getElementById("autocomplete-list")?.remove();
        },

        render(results) {
            this.close();
            if (results.length === 0) return;

            const list = document.createElement("div");
            list.id = "autocomplete-list";
            list.className = "autocomplete-items";

            results.slice(0, AUTOCOMPLETE_LIMIT).forEach(result => {
                const item = result.item;
                const matches = result.matches;
                const div = document.createElement("div");

                if (matches?.[0]?.indices) {
                    div.innerHTML = this._highlightMatches(item.name, matches[0].indices);
                } else {
                    div.textContent = item.name;
                }

                div.addEventListener("click", () => {
                    DOM.search.value = item.name;
                    this.close();
                    FilterEngine.apply();
                    URLState.update();
                });

                list.appendChild(div);
            });

            DOM.search.parentNode.appendChild(list);
        },

        _highlightMatches(text, indices) {
            let highlighted = '';
            let lastIndex = 0;

            indices.forEach(([start, end]) => {
                highlighted += text.substring(lastIndex, start);
                highlighted += `<mark>${text.substring(start, end + 1)}</mark>`;
                lastIndex = end + 1;
            });

            highlighted += text.substring(lastIndex);
            return highlighted;
        }
    };

    // === FILTER ENGINE ===
    const FilterEngine = {
        _checkSkinType(skin, selectedType) {
            if (selectedType === 'all') return true;
            if (selectedType === '기본') return !skin['스킨 타입 - 한글'];
            return skin['스킨 타입 - 한글'] === selectedType;
        },

        _checkPeriod(skin, selectedPeriod) {
            if (selectedPeriod === 'all') return true;
            if (selectedPeriod === '한정') return skin['기간']?.includes('한정');
            if (selectedPeriod === '상시') return skin['기간'] === '상시';
            return true;
        },

        _checkTag(skin, selectedTag) {
            if (selectedTag === 'all') return true;
            if (selectedTag === 'X') {
                return !skin['스킨 태그'] || !TAGS_TO_EXCLUDE.some(tag => skin['스킨 태그'].includes(tag));
            }
            return skin['스킨 태그']?.includes(selectedTag);
        },

        apply() {
            const searchTerm = DOM.search.value.toLowerCase().trim();
            const filters = URLState.getFilters();
            const selectedRarities = new Set(filters.rarities);

            const filteredSkins = allSkins.filter(skin => {
                if (searchTerm && !skin['함순이 이름'].toLowerCase().includes(searchTerm)) return false;
                if (filters.ex && skin['ex_chat_status'] !== 1) return false;
                if (!this._checkSkinType(skin, filters.type)) return false;
                if (filters.faction !== 'all' && skin['진영'] !== filters.faction) return false;
                if (!this._checkPeriod(skin, filters.period)) return false;
                if (!this._checkTag(skin, filters.tag)) return false;
                if (selectedRarities.size > 0 && !selectedRarities.has(skin['레어도'])) return false;

                return true;
            });

            Renderer.renderSections(filteredSkins);
        }
    };

    // === RENDERER ===
    const Renderer = {
        _createSkinBoxHtml(skin) {
            const characterName = encodeURIComponent(skin['함순이 이름']);
            const skinName = encodeURIComponent(skin['한글 함순이 + 스킨 이름']);
            const linkUrl = `pages/skin/skin-viewer.html?character=${characterName}&skin=${skinName}`;

            const gemIconHtml = `<img src="assets/icon/60px-Ruby.png" class="gem-icon" alt="Gem">`;
            const costHtml = skin['재화'] ? `${gemIconHtml} ${skin['재화']}` : 'N/A';
            const periodHtml = skin['기간'] || '정보 없음';
            const badgeHtml = skin.isSold ? '<div class="new-badge">판매중</div>' : '';

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
        },

        _isSkinCurrentlySold(skin) {
            const period = skin['기간'];
            if (!period) return false;
            
            // Permanent skins are always sold
            if (period === '상시') return true;
            
            // Extract date from "한정 (YYYY/MM/DD)" format
            const dateMatch = period.match(/(\d{4})\/(\d{2})\/(\d{2})/);
            if (!dateMatch) return false;
            
            const [_, year, month, day] = dateMatch;
            const skinDate = new Date(year, month - 1, day);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            // Check if skin date is today or in the future
            return skinDate >= today;
        },

        _categorizeSkin(skin) {
            skin.isSold = this._isSkinCurrentlySold(skin);
            
            if (skin.isSold && skin['기간']?.includes('한정')) return 'new';
            
            const period = skin['기간'];
            if (period?.includes('한정')) return 'limited';
            if (period === '상시') return 'permanent';
            return 'other';
        },

        renderSections(skins) {
            // Clear all containers
            Object.values(DOM.containers).forEach(c => c.innerHTML = '');

            // Create document fragments for better performance
            const fragments = {
                new: document.createDocumentFragment(),
                limited: document.createDocumentFragment(),
                permanent: document.createDocumentFragment(),
                other: document.createDocumentFragment()
            };

            // Categorize and append skins
            skins.forEach(skin => {
                const category = this._categorizeSkin(skin);
                const skinBoxHtml = this._createSkinBoxHtml(skin);
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = skinBoxHtml.trim();
                fragments[category].appendChild(tempDiv.firstChild);
            });

            // Append fragments and toggle section visibility
            Object.keys(DOM.containers).forEach(key => {
                DOM.containers[key].appendChild(fragments[key]);
                DOM.sections[key].style.display = DOM.containers[key].hasChildNodes() ? 'block' : 'none';
            });
        }
    };

    // === EVENT HANDLERS ===
    const EventHandlers = {
        handleSearch() {
            const searchTerm = DOM.search.value;
            
            if (fuse && searchTerm.trim()) {
                const results = fuse.search(searchTerm);
                Autocomplete.render(results);
            } else {
                Autocomplete.close();
            }
            
            debouncedFilterUpdate();
        },

        resetFilters() {
            DOM.search.value = '';
            DOM.filters.skinType.value = 'all';
            DOM.filters.period.value = 'all';
            DOM.filters.faction.value = 'all';
            DOM.filters.tag.value = 'all';
            DOM.filters.exDialogue.checked = false;
            DOM.filters.rarities.querySelectorAll('input').forEach(cb => cb.checked = true);
            
            FilterEngine.apply();
            URLState.update();
        },

        handleFilterChange() {
            FilterEngine.apply();
            URLState.update();
        },

        openPopup() {
            DOM.popup.container.classList.add('visible');
            document.body.classList.add('no-scroll');
        },

        closePopup() {
            DOM.popup.container.classList.remove('visible');
            document.body.classList.remove('no-scroll');
        },

        toggleFilters() {
            DOM.filterContainer.classList.toggle('visible');
            DOM.buttons.filterToggle.classList.toggle('active');
        }
    };

    // === DEBOUNCED FUNCTIONS ===
    const debouncedFilterUpdate = debounce(() => {
        FilterEngine.apply();
        URLState.update();
    }, DEBOUNCE_DELAY);

    // === DATA INITIALIZATION ===
    fetch('data/skin/skin_voiceline_data_subset.json')
        .then(res => res.json())
        .then(skinJson => {
            allSkins = skinJson;

            const uniqueShipNames = [...new Set(allSkins.map(skin => skin['함순이 이름']))].sort();
            fuse = new Fuse(uniqueShipNames.map(name => ({ name })), fuseOptions);

            URLState.apply();
        })
        .catch(error => {
            console.error("Failed to load data:", error);
        });

    // === EVENT LISTENERS ===
    DOM.search.addEventListener('input', EventHandlers.handleSearch);

    [DOM.filters.skinType, DOM.filters.period, DOM.filters.faction, DOM.filters.tag, DOM.filters.exDialogue]
        .forEach(el => el.addEventListener('change', EventHandlers.handleFilterChange));

    DOM.filters.rarities.querySelectorAll('input')
        .forEach(cb => cb.addEventListener('change', EventHandlers.handleFilterChange));

    DOM.buttons.clearAll.addEventListener('click', EventHandlers.resetFilters);
    DOM.buttons.info.addEventListener('click', EventHandlers.openPopup);
    DOM.buttons.filterToggle.addEventListener('click', EventHandlers.toggleFilters);
    DOM.popup.closeBtn.addEventListener('click', EventHandlers.closePopup);

    DOM.popup.container.addEventListener('click', (event) => {
        if (event.target === DOM.popup.container) EventHandlers.closePopup();
    });

    document.addEventListener("click", (e) => {
        if (!DOM.search.parentNode.contains(e.target)) Autocomplete.close();
    });

    window.addEventListener('popstate', URLState.apply);
});