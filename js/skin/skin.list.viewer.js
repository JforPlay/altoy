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
            // scrollToTop handled globally by global.script.js
        },
        progressBar: document.getElementById('progress-bar'),
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
    let isLoading = false;
    const fuseOptions = {
        includeScore: true,
        includeMatches: true,
        threshold: 0.4,
        keys: ['name']
    };

    // === CACHED QUERIES ===
    const cachedRarityCheckboxes = Array.from(DOM.filters.rarities.querySelectorAll('input'));
    const allSkinContainers = Object.values(DOM.containers);

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

    // === TIMER MANAGEMENT ===
    let activeTimers = {
        debounce: null,
        throttle: null,
        progressBar: null
    };

    // === UTILITY FUNCTIONS ===
    const debounce = (func, delay) => {
        return (...args) => {
            clearTimeout(activeTimers.debounce);
            activeTimers.debounce = setTimeout(() => func.apply(this, args), delay);
        };
    };

    const throttle = (func, limit) => {
        let inThrottle;
        return (...args) => {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                activeTimers.throttle = setTimeout(() => inThrottle = false, limit);
            }
        };
    };

    const showFilteringState = () => {
        // Only show progress bar if filtering takes longer than 150ms
        activeTimers.progressBar = setTimeout(() => {
            if (DOM.progressBar) {
                DOM.progressBar.classList.add('visible');
            }
        }, 150);
    };

    const hideFilteringState = () => {
        // Cancel the delayed progress bar if it hasn't shown yet
        clearTimeout(activeTimers.progressBar);
        activeTimers.progressBar = null;

        // Hide progress bar if it was shown
        if (DOM.progressBar) {
            DOM.progressBar.classList.remove('visible');
        }
    };

    // === URL STATE MANAGEMENT ===
    const URLState = {
        getFilters() {
            // Use cached checkboxes instead of querying every time
            const selectedRarities = cachedRarityCheckboxes
                .filter(cb => cb.checked)
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
                // Use cached checkboxes
                cachedRarityCheckboxes.forEach(cb => {
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
            if (isLoading) return; // Don't filter while loading data

            // Show visual feedback
            showFilteringState();

            // Use requestAnimationFrame for smooth UI update
            requestAnimationFrame(() => {
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

                // Hide visual feedback after render
                requestAnimationFrame(() => hideFilteringState());
            });
        }
    };

    // === RENDERER ===
    const Renderer = {
        _createSkinBox(skin) {
            const characterName = encodeURIComponent(skin['함순이 이름']);
            const skinName = encodeURIComponent(skin['한글 함순이 + 스킨 이름']);
            const linkUrl = `pages/skin/skin-detail-viewer.html?character=${characterName}&skin=${skinName}`;

            const link = document.createElement('a');
            link.href = linkUrl;
            link.className = 'skin-box-link';

            const costHtml = skin['재화']
                ? `<img src="assets/icon/60px-Ruby.png" class="gem-icon" alt="Gem"> ${skin['재화']}`
                : 'N/A';

            // Create image element with error handling
            const skinBox = document.createElement('div');
            skinBox.className = 'skin-box';

            const imageWrapper = document.createElement('div');
            imageWrapper.className = 'skin-image-wrapper';

            if (skin.isSold) {
                const badge = document.createElement('div');
                badge.className = 'new-badge';
                badge.textContent = '판매중';
                imageWrapper.appendChild(badge);
            }

            const img = document.createElement('img');
            img.src = skin['깔끔한 일러'];
            img.className = 'skin-image';
            img.loading = 'lazy';
            img.alt = skin['함순이 이름'];
            // Add error handling for images
            img.addEventListener('error', () => {
                img.style.opacity = '0.3';
                img.alt = '이미지를 불러올 수 없습니다';
            }, { once: true });

            imageWrapper.appendChild(img);
            skinBox.appendChild(imageWrapper);

            const skinInfo = document.createElement('div');
            skinInfo.className = 'skin-info';
            skinInfo.innerHTML = `
                <h3>${skin['함순이 이름']}</h3>
                <div class="info-line"><strong>타입:</strong> ${skin['스킨 타입 - 한글'] || '기본'}</div>
                <div class="info-line"><strong>태그:</strong> ${skin['스킨 태그'] || '없음'}</div>
                <div class="info-line"><strong>진영:</strong> ${skin['진영'] || '없음'}</div>
                <div class="info-line"><strong>레어도:</strong> ${skin['레어도'] || '없음'}</div>
                <div class="info-line"><strong>가격:</strong> ${costHtml}</div>
                <div class="info-line"><strong>기간:</strong> ${skin['기간'] || '정보 없음'}</div>
            `;

            skinBox.appendChild(skinInfo);
            link.appendChild(skinBox);

            return link;
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
                const skinBox = this._createSkinBox(skin);
                fragments[category].appendChild(skinBox);
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
            // Use cached checkboxes
            cachedRarityCheckboxes.forEach(cb => cb.checked = true);

            FilterEngine.apply();
            URLState.update();
        },

        handleFilterChange() {
            FilterEngine.apply();
            URLState.update();
        },

        toggleFilters() {
            DOM.filterContainer.classList.toggle('visible');
            DOM.buttons.filterToggle.classList.toggle('active');
        }

        // Info popup and scrollToTop are now handled globally by global.script.js
    };

    // === DEBOUNCED/THROTTLED FUNCTIONS ===
    const debouncedFilterUpdate = debounce(() => {
        FilterEngine.apply();
        URLState.update();
    }, DEBOUNCE_DELAY);

    // === DATA INITIALIZATION ===
    const showLoadingState = () => {
        isLoading = true;
        allSkinContainers.forEach(container => {
            container.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--text-secondary);">데이터 불러오는 중...</p>';
        });
    };

    const showErrorState = (error) => {
        isLoading = false;
        allSkinContainers.forEach(container => {
            container.innerHTML = `
                <p style="text-align: center; padding: 2rem; color: #f04747;">
                    데이터를 불러오는데 실패했습니다.<br>
                    <small style="color: var(--text-muted);">${error.message || 'Unknown error'}</small>
                </p>
            `;
        });
        console.error("Failed to load data:", error);
    };

    showLoadingState();

    fetch('data/skin/skin_voiceline_data_subset.json')
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            return res.json();
        })
        .then(skinJson => {
            allSkins = skinJson;
            isLoading = false;

            const uniqueShipNames = [...new Set(allSkins.map(skin => skin['함순이 이름']))].sort();
            fuse = new Fuse(uniqueShipNames.map(name => ({ name })), fuseOptions);

            URLState.apply();
        })
        .catch(error => {
            showErrorState(error);
        });

    // === CLEANUP METHOD ===
    const cleanup = () => {
        // Clear all active timers
        clearTimeout(activeTimers.debounce);
        clearTimeout(activeTimers.throttle);
        clearTimeout(activeTimers.progressBar);
        activeTimers.debounce = null;
        activeTimers.throttle = null;
        activeTimers.progressBar = null;

        // Remove event listeners
        DOM.search.removeEventListener('input', EventHandlers.handleSearch);
        [DOM.filters.skinType, DOM.filters.period, DOM.filters.faction, DOM.filters.tag, DOM.filters.exDialogue]
            .forEach(el => el.removeEventListener('change', EventHandlers.handleFilterChange));
        cachedRarityCheckboxes.forEach(cb => cb.removeEventListener('change', EventHandlers.handleFilterChange));
        DOM.buttons.clearAll.removeEventListener('click', EventHandlers.resetFilters);
        DOM.buttons.filterToggle.removeEventListener('click', EventHandlers.toggleFilters);
        window.removeEventListener('popstate', URLState.apply);
        // Info popup and scrollToTop event listeners handled globally by global.script.js

        // Close autocomplete
        Autocomplete.close();

        // Hide progress bar
        if (DOM.progressBar) {
            DOM.progressBar.classList.remove('visible');
        }

        console.log('Skin list viewer cleaned up successfully');
    };

    // Expose cleanup method for external use (e.g., before page navigation)
    window.skinListViewerCleanup = cleanup;

    // === EVENT LISTENERS ===
    DOM.search.addEventListener('input', EventHandlers.handleSearch);

    [DOM.filters.skinType, DOM.filters.period, DOM.filters.faction, DOM.filters.tag, DOM.filters.exDialogue]
        .forEach(el => el.addEventListener('change', EventHandlers.handleFilterChange));

    cachedRarityCheckboxes
        .forEach(cb => cb.addEventListener('change', EventHandlers.handleFilterChange));

    DOM.buttons.clearAll.addEventListener('click', EventHandlers.resetFilters);
    DOM.buttons.filterToggle.addEventListener('click', EventHandlers.toggleFilters);
    // Info popup and scrollToTop handled globally by global.script.js

    document.addEventListener("click", (e) => {
        if (!DOM.search.parentNode.contains(e.target)) Autocomplete.close();
    });

    window.addEventListener('popstate', URLState.apply);
    // scroll event listener for scrollToTop handled globally by global.script.js
});