/**
 * skin.list.viewer.js
 * Skin list/browse page controller for the skin module group.
 * Renders all skins grouped by availability (new/limited/permanent/other) with multi-filter,
 * search autocomplete, collection tracking (owned/wanted), a wishlist cart modal, and image lightbox.
 * Cards are built once at load time; filtering rebuilds visible sets and appends in chunks of 50 via IntersectionObserver.
 */
import { debounce, fetchJSONWithCache, getAllUrlParams, setUrlParams, resolveUrl, normalizeRomanNumerals, createSearchIndex,
    openModal, closeModal, setupModal, showToast, getStorageItem, setStorageItem, toggleElement, IMG_FALLBACKS } from '../utils.js';

document.addEventListener('DOMContentLoaded', () => {
    // ===== DOM Element References =====
    const DOM = {
        search: document.getElementById('search-input'),
        filters: {
            skinType: document.getElementById('skin-type-select'),
            period: document.getElementById('period-select'),
            faction: document.getElementById('faction-select'),
            tag: document.getElementById('tag-select'),
            rarities: document.getElementById('rarity-checkboxes'),
            exDialogue: document.getElementById('ex-dialogue-checkbox'),
            ownership: document.getElementById('ownership-select'),
            sort: document.getElementById('sort-select')
        },
        buttons: {
            clearAll: document.getElementById('clear-all-btn'),
            filterToggle: document.getElementById('filter-toggle-btn')
        },
        progressBar: document.getElementById('progress-bar'),
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
        filterContainer: document.getElementById('filter-container'),
        resultCount: document.getElementById('result-count'),
        owned: {
            fab: document.getElementById('owned-fab'),
            badge: document.getElementById('owned-badge'),
            body: document.getElementById('owned-body'),
            footer: document.getElementById('owned-footer'),
            count: document.getElementById('owned-count'),
            totalGems: document.getElementById('owned-total-gems'),
            toggleBtns: document.querySelectorAll('.owned-toggle-btn')
        },
        cart: {
            fab: document.getElementById('cart-fab'),
            badge: document.getElementById('cart-badge'),
            body: document.getElementById('cart-body'),
            footer: document.getElementById('cart-footer'),
            count: document.getElementById('cart-count'),
            totalGems: document.getElementById('cart-total-gems'),
            totalKrw: document.getElementById('cart-total-krw'),
            totalTruck: document.getElementById('cart-total-truck'),
            shareBtn: document.getElementById('cart-share-btn'),
            buyAllBtn: document.getElementById('cart-buyall-btn'),
            backBtn: document.getElementById('cart-back-btn')
        },
        popup: {
            overlay: document.getElementById('image-popup'),
            image: document.getElementById('popup-full-image'),
            skinName: document.getElementById('popup-skin-name'),
            charName: document.getElementById('popup-char-name'),
            detailLink: document.getElementById('popup-detail-link'),
            closeBtn: document.querySelector('.close-image-popup-btn')
        }
    };

    // ===== State =====
    let allSkins = [];
    let fuse;
    let isLoading = false;
    let releaseDates = {};
    const fuseOptions = { keys: ['name'], threshold: 0.4 };

    // Skin ID → skin data for O(1) lookup
    const skinById = new Map();
    // Skin ID → { wrapper, category } for visibility-toggle filtering
    const skinCardMap = new Map();

    // ===== Collection State =====
    const COLLECTION_KEY = 'skinCollection';
    let collection = loadCollection();

    function loadCollection() {
        const raw = getStorageItem(COLLECTION_KEY, null);
        if (raw) {
            try {
                const saved = JSON.parse(raw);
                return {
                    owned: new Set(saved.owned || []),
                    wanted: new Set(saved.wanted || [])
                };
            } catch (e) {
                // Corrupted data, start fresh
            }
        }
        return { owned: new Set(), wanted: new Set() };
    }

    function saveCollection() {
        setStorageItem(COLLECTION_KEY, JSON.stringify({
            owned: [...collection.owned],
            wanted: [...collection.wanted]
        }));
    }

    // ===== Cached Queries & Constants =====
    const allRarityInputs = Array.from(DOM.filters.rarities.querySelectorAll('input'));
    const rarityAllCheckbox = allRarityInputs.find(cb => cb.value === 'all');
    const cachedRarityCheckboxes = allRarityInputs.filter(cb => cb.value !== 'all');
    const allSkinContainers = Object.values(DOM.containers);

    const FILTER_PARAMS = {
        TYPE: 'type',
        TAG: 'tag',
        PERIOD: 'period',
        FACTION: 'faction',
        RARITIES: 'rarities',
        EX: 'ex',
        SEARCH: 'search',
        OWNERSHIP: 'ownership',
        SORT: 'sort'
    };

    const TAGS_TO_EXCLUDE = ['듀얼', 'L2D', 'L2D+', '쁘띠모션'];
    const AUTOCOMPLETE_LIMIT = 10;
    const DEBOUNCE_DELAY = 300;
    const CHUNK_SIZE = 50;

    // Faction normalization for current data (before re-processing)
    const FACTION_NORMALIZE = {
        'FFNF': 'FFNF (FF, iris libre)',
        11: 'HNLMS',
        111: 'ToLove',
        112: 'BRS',
        113: 'YUMIA',
        114: 'DanMachi',
        115: 'DateALive'
    };

    // Gem to KRW conversion: 9900 gems = 121000 KRW = 1 깡트럭
    const GEMS_PER_TRUCK = 9900;
    const KRW_PER_TRUCK = 121000;
    const KRW_PER_GEM = KRW_PER_TRUCK / GEMS_PER_TRUCK;

    // Tag display order for cart grouping
    const TAG_ORDER = ['듀얼', 'L2D+', 'L2D', '쁘띠모션', '기타'];

    // ===== Timer Management =====
    let progressBarTimer = null;

    // ===== Chunk Controller =====
    // Manages progressive DOM appending per section. Cards are created once and stored
    // in skinCardMap; this controller decides which are currently in the DOM.
    const ChunkController = {
        _sections: {},

        init(sectionKeys) {
            for (const key of sectionKeys) {
                const sentinel = document.createElement('div');
                sentinel.className = 'chunk-sentinel';
                sentinel.setAttribute('aria-hidden', 'true');

                const observer = new IntersectionObserver((observed) => {
                    if (observed[0].isIntersecting) {
                        this._appendNextChunk(key);
                    }
                }, { rootMargin: '300px' });

                this._sections[key] = {
                    entries: [],
                    appendIndex: 0,
                    observer,
                    sentinel
                };
            }
        },

        /** Replace a section's content with a new set of entries, rendered in chunks. */
        load(key, entries) {
            const section = this._sections[key];
            section.entries = entries;
            section.appendIndex = 0;
            section.observer.disconnect();

            const container = DOM.containers[key];
            container.innerHTML = '';

            if (entries.length > 0) {
                this._appendNextChunk(key);
            }
        },

        _appendNextChunk(key) {
            const section = this._sections[key];
            const container = DOM.containers[key];
            const end = Math.min(section.appendIndex + CHUNK_SIZE, section.entries.length);

            if (section.appendIndex >= section.entries.length) return;

            const fragment = document.createDocumentFragment();
            for (let i = section.appendIndex; i < end; i++) {
                fragment.appendChild(section.entries[i].wrapper);
            }

            // Remove sentinel before appending new batch
            if (section.sentinel.parentNode) {
                section.sentinel.remove();
            }
            container.appendChild(fragment);
            section.appendIndex = end;

            // If more entries remain, place sentinel and observe it
            if (section.appendIndex < section.entries.length) {
                container.appendChild(section.sentinel);
                section.observer.observe(section.sentinel);
            } else {
                section.observer.disconnect();
            }
        },

        cleanup() {
            for (const section of Object.values(this._sections)) {
                section.observer.disconnect();
            }
        }
    };

    // ===== Utility Functions =====
    const showFilteringState = () => {
        progressBarTimer = setTimeout(() => {
            if (DOM.progressBar) {
                DOM.progressBar.classList.add('visible');
            }
        }, 150);
    };

    const hideFilteringState = () => {
        clearTimeout(progressBarTimer);
        progressBarTimer = null;
        if (DOM.progressBar) {
            DOM.progressBar.classList.remove('visible');
        }
    };

    function formatReleaseDate(skinId) {
        const date = releaseDates[String(skinId)];
        if (!date) return null;
        if (date === '2021-08-14') return '2021-08-14 이전';
        return date;
    }

    function normalizeFactions(skins) {
        for (const skin of skins) {
            const faction = skin['진영'];
            if (faction in FACTION_NORMALIZE) {
                skin['진영'] = FACTION_NORMALIZE[faction];
            }
        }
    }

    // ===== URL State Management =====
    const URLState = {
        getFilters() {
            // If "전체보기" is checked, treat as all rarities (empty array = no filter)
            const selectedRarities = rarityAllCheckbox.checked
                ? []
                : cachedRarityCheckboxes.filter(cb => cb.checked).map(cb => cb.value);

            return {
                type: DOM.filters.skinType.value,
                tag: DOM.filters.tag.value,
                period: DOM.filters.period.value,
                faction: DOM.filters.faction.value,
                rarities: selectedRarities,
                ex: DOM.filters.exDialogue.checked,
                search: DOM.search.value,
                ownership: DOM.filters.ownership.value,
                sort: DOM.filters.sort.value
            };
        },

        update() {
            const filters = this.getFilters();
            setUrlParams({
                [FILTER_PARAMS.TYPE]: filters.type !== 'all' ? filters.type : null,
                [FILTER_PARAMS.TAG]: filters.tag !== 'all' ? filters.tag : null,
                [FILTER_PARAMS.PERIOD]: filters.period !== 'all' ? filters.period : null,
                [FILTER_PARAMS.FACTION]: filters.faction !== 'all' ? filters.faction : null,
                [FILTER_PARAMS.RARITIES]: filters.rarities.length > 0 ? filters.rarities.join(',') : null,
                [FILTER_PARAMS.EX]: filters.ex ? 'true' : null,
                [FILTER_PARAMS.SEARCH]: filters.search || null,
                [FILTER_PARAMS.OWNERSHIP]: filters.ownership !== 'all' ? filters.ownership : null,
                [FILTER_PARAMS.SORT]: filters.sort !== 'default' ? filters.sort : null,
            }, { clear: true });
        },

        apply() {
            const params = getAllUrlParams();

            DOM.filters.skinType.value = params[FILTER_PARAMS.TYPE] || 'all';
            DOM.filters.tag.value = params[FILTER_PARAMS.TAG] || 'all';
            DOM.filters.period.value = params[FILTER_PARAMS.PERIOD] || 'all';
            DOM.filters.faction.value = params[FILTER_PARAMS.FACTION] || 'all';
            DOM.search.value = params[FILTER_PARAMS.SEARCH] || '';
            DOM.filters.ownership.value = params[FILTER_PARAMS.OWNERSHIP] || 'all';
            DOM.filters.sort.value = params[FILTER_PARAMS.SORT] || 'default';

            const raritiesParam = params[FILTER_PARAMS.RARITIES];
            if (raritiesParam) {
                const activeRarities = new Set(raritiesParam.split(','));
                rarityAllCheckbox.checked = false;
                cachedRarityCheckboxes.forEach(cb => {
                    cb.checked = activeRarities.has(cb.value);
                });
            } else {
                rarityAllCheckbox.checked = true;
                cachedRarityCheckboxes.forEach(cb => { cb.checked = false; });
            }

            DOM.filters.exDialogue.checked = params[FILTER_PARAMS.EX] === 'true';
            FilterEngine.apply();
        }
    };

    // ===== Autocomplete =====
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

    // ===== Filter Engine =====
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

        _checkOwnership(skin, ownershipFilter) {
            if (ownershipFilter === 'all') return true;
            const skinId = skin['클뜯 id'];
            if (ownershipFilter === 'owned') return collection.owned.has(skinId);
            if (ownershipFilter === 'wanted') return collection.wanted.has(skinId);
            if (ownershipFilter === 'not-owned') return !collection.owned.has(skinId);
            return true;
        },

        _parseRerunDate(period) {
            if (!period) return null;
            const match = period.match(/(\d{4})\/(\d{2})\/(\d{2})/);
            return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
        },

        _makeDateComparator(getDate, descending) {
            return (a, b) => {
                const dateA = getDate(a);
                const dateB = getDate(b);
                if (!dateA && !dateB) return 0;
                if (!dateA) return 1;
                if (!dateB) return -1;
                return descending ? dateB.localeCompare(dateA) : dateA.localeCompare(dateB);
            };
        },

        _getSortComparator(sortMode) {
            const releaseDate = (entry) => releaseDates[String(entry.skin['클뜯 id'])] || '';
            const rerunDate = (entry) => this._parseRerunDate(entry.skin['기간']) || '';

            if (sortMode === 'release-desc') return this._makeDateComparator(releaseDate, true);
            if (sortMode === 'release-asc') return this._makeDateComparator(releaseDate, false);
            if (sortMode === 'rerun-desc') return this._makeDateComparator(rerunDate, true);
            if (sortMode === 'rerun-asc') return this._makeDateComparator(rerunDate, false);
            return null;
        },

        /**
         * Compute visible card sets per section, then delegate to ChunkController.
         * Cards are either in the DOM (via chunks) or not — no display toggling.
         */
        apply() {
            if (isLoading || skinCardMap.size === 0) return;

            showFilteringState();

            requestAnimationFrame(() => {
                const searchTerm = DOM.search.value.toLowerCase().trim();
                const filters = URLState.getFilters();
                const selectedRarities = new Set(filters.rarities);

                const visibleBySection = { new: [], limited: [], permanent: [], other: [] };

                for (const [, entry] of skinCardMap) {
                    const skin = entry.skin;

                    const visible =
                        (!searchTerm || skin['함순이 이름']?.toLowerCase().includes(searchTerm) || skin['한글 함순이 + 스킨 이름']?.toLowerCase().includes(searchTerm)) &&
                        (!filters.ex || skin['ex_chat_status'] === 1) &&
                        this._checkSkinType(skin, filters.type) &&
                        (filters.faction === 'all' || skin['진영'] === filters.faction) &&
                        this._checkPeriod(skin, filters.period) &&
                        this._checkTag(skin, filters.tag) &&
                        (selectedRarities.size === 0 || selectedRarities.has(skin['레어도'])) &&
                        this._checkOwnership(skin, filters.ownership);

                    if (visible) {
                        visibleBySection[entry.category].push(entry);
                    }
                }

                // Sort within each section if a sort mode is active
                const sortMode = filters.sort || 'default';
                const comparator = this._getSortComparator(sortMode);
                if (comparator) {
                    for (const entries of Object.values(visibleBySection)) {
                        entries.sort(comparator);
                    }
                }

                // Re-chunk each section
                for (const key of Object.keys(DOM.sections)) {
                    ChunkController.load(key, visibleBySection[key]);
                    toggleElement(DOM.sections[key], visibleBySection[key].length > 0);
                }

                // Update result count
                const totalVisible = Object.values(visibleBySection).reduce((sum, arr) => sum + arr.length, 0);
                DOM.resultCount.textContent = `전체 ${allSkins.length.toLocaleString()}개 중 ${totalVisible.toLocaleString()}개 표시`;

                requestAnimationFrame(() => hideFilteringState());
            });
        }
    };

    // ===== Collection Manager =====
    const CollectionManager = {
        toggleOwned(skinId) {
            if (collection.owned.has(skinId)) {
                collection.owned.delete(skinId);
            } else {
                collection.owned.add(skinId);
                // Owning removes from wanted
                if (collection.wanted.has(skinId)) {
                    collection.wanted.delete(skinId);
                    CartManager.updateBadge();
                }
            }
            saveCollection();
            this._updateCardState(skinId);
            OwnedShowcase.updateBadge();
        },

        toggleWanted(skinId) {
            // Can't want a skin you already own
            if (collection.owned.has(skinId)) return;

            if (collection.wanted.has(skinId)) {
                collection.wanted.delete(skinId);
            } else {
                collection.wanted.add(skinId);
            }
            saveCollection();
            this._updateCardState(skinId);
            CartManager.updateBadge();
        },

        _updateCardState(skinId) {
            const entry = skinCardMap.get(skinId);
            if (!entry) return;
            const card = entry.wrapper.querySelector('.skin-box');
            if (!card) return;

            const isOwned = collection.owned.has(skinId);
            const isWanted = collection.wanted.has(skinId);

            card.classList.toggle('is-owned', isOwned);
            card.classList.toggle('is-wanted', isWanted);

            const ownedBtn = card.querySelector('.owned-btn');
            const wantedBtn = card.querySelector('.wanted-btn');
            if (ownedBtn) ownedBtn.classList.toggle('active', isOwned);
            if (wantedBtn) {
                wantedBtn.classList.toggle('active', isWanted);
                wantedBtn.classList.toggle('disabled', isOwned);
            }
        }
    };

    // ===== Lightbox =====
    const Lightbox = {
        _generation: 0,
        _errorHandler: null,

        open(skin) {
            // Remove stale error handler from previous open
            if (this._errorHandler) {
                DOM.popup.image.removeEventListener('error', this._errorHandler);
                this._errorHandler = null;
            }

            this._generation++;
            const gen = this._generation;
            const shipyardUrl = skin['깔끔한 일러'] || '';
            const fullUrl = shipyardUrl.replace('/shipyard.png', '/painting.png');
            const asmrUrl = skin['ASMR 일러'] || '';

            DOM.popup.image.src = '';
            DOM.popup.image.classList.add('loading');

            DOM.popup.skinName.textContent = skin['한글 함순이 + 스킨 이름'];
            DOM.popup.charName.textContent = skin['함순이 이름'];

            const characterName = encodeURIComponent(normalizeRomanNumerals(skin['함순이 이름']));
            const skinDisplayName = encodeURIComponent(normalizeRomanNumerals(skin['한글 함순이 + 스킨 이름']));
            DOM.popup.detailLink.href = resolveUrl(`skin/skin-detail-viewer/?character=${characterName}&skin=${skinDisplayName}`);

            DOM.popup.overlay.classList.add('visible');
            document.body.classList.add('no-scroll');

            DOM.popup.image.addEventListener('load', () => {
                if (gen === this._generation) DOM.popup.image.classList.remove('loading');
            }, { once: true });

            const fallbacks = [asmrUrl, shipyardUrl].filter(Boolean);
            const handleError = () => {
                if (gen !== this._generation) return;
                const next = fallbacks.shift();
                if (next) {
                    this._errorHandler = handleError;
                    DOM.popup.image.addEventListener('error', handleError, { once: true });
                    DOM.popup.image.src = next;
                } else {
                    this._errorHandler = null;
                }
            };
            this._errorHandler = handleError;
            DOM.popup.image.addEventListener('error', handleError, { once: true });
            DOM.popup.image.src = fullUrl;
        },

        close() {
            DOM.popup.overlay.classList.remove('visible');
            document.body.classList.remove('no-scroll');
            if (this._errorHandler) {
                DOM.popup.image.removeEventListener('error', this._errorHandler);
                this._errorHandler = null;
            }
            DOM.popup.image.src = '';
            DOM.popup.image.classList.remove('loading');
        }
    };

    // ===== Cart Manager =====
    const CartManager = {
        updateBadge() {
            const count = collection.wanted.size;
            DOM.cart.badge.textContent = count;
            DOM.cart.fab.classList.toggle('has-items', count > 0);
        },

        open() {
            this._showCartMode();
            this.render();
            openModal('cart-modal');
        },

        render() {
            const wantedSkins = allSkins.filter(s => collection.wanted.has(s['클뜯 id']));

            if (wantedSkins.length === 0) {
                DOM.cart.body.innerHTML = '<div class="cart-empty"><i class="fas fa-shopping-cart"></i><p>찜한 스킨이 없습니다</p><p class="cart-empty-hint">스킨 카드의 <i class="fas fa-heart"></i> 버튼으로 찜해보세요!</p></div>';
                DOM.cart.footer.style.display = 'none';
                return;
            }

            DOM.cart.footer.style.display = '';

            // Group by tag — pick the highest-priority tag found in the comma-separated string
            // Order: L2D+ before L2D to avoid substring false match
            const TAG_GROUP_ORDER = ['듀얼', 'L2D+', 'L2D', '쁘띠모션'];
            const groups = {};
            for (const skin of wantedSkins) {
                const rawTag = skin['스킨 태그'] || '';
                let tag = '기타';
                for (const candidate of TAG_GROUP_ORDER) {
                    if (rawTag.includes(candidate)) {
                        tag = candidate;
                        break;
                    }
                }
                if (!groups[tag]) groups[tag] = [];
                groups[tag].push(skin);
            }

            const fragment = document.createDocumentFragment();

            for (const tagName of TAG_ORDER) {
                const skins = groups[tagName];
                if (!skins || skins.length === 0) continue;

                const group = document.createElement('div');
                group.className = 'cart-group';

                const header = document.createElement('div');
                header.className = 'cart-group-header';
                header.innerHTML = `<span class="cart-group-tag">${tagName}</span><span class="cart-group-count">${skins.length}개</span>`;
                group.appendChild(header);

                const grid = document.createElement('div');
                grid.className = 'cart-grid';

                for (const skin of skins) {
                    const item = document.createElement('div');
                    item.className = 'cart-item';
                    item.dataset.skinId = skin['클뜯 id'];

                    const img = document.createElement('img');
                    img.src = skin['깔끔한 일러'] || IMG_FALLBACKS.CARD;
                    img.alt = skin['함순이 이름'];
                    img.loading = 'lazy';
                    img.className = 'cart-item-img';

                    const info = document.createElement('div');
                    info.className = 'cart-item-info';

                    const name = document.createElement('div');
                    name.className = 'cart-item-name';
                    name.textContent = skin['한글 함순이 + 스킨 이름'];

                    const price = document.createElement('div');
                    price.className = 'cart-item-price';
                    if (skin['재화']) {
                        price.innerHTML = `<img src="${resolveUrl('assets/icon/60px-Ruby.webp')}" class="gem-icon" alt="Gem"> ${skin['재화'].toLocaleString()}`;
                    } else {
                        price.textContent = '가격 미정';
                    }

                    const actions = document.createElement('div');
                    actions.className = 'cart-item-actions';

                    const buyBtn = document.createElement('button');
                    buyBtn.className = 'cart-item-buy';
                    buyBtn.innerHTML = '<i class="fas fa-check"></i>';
                    buyBtn.title = '보유표시';

                    const removeBtn = document.createElement('button');
                    removeBtn.className = 'cart-item-remove';
                    removeBtn.innerHTML = '<i class="fas fa-times"></i>';
                    removeBtn.title = '찜 해제';

                    actions.appendChild(buyBtn);
                    actions.appendChild(removeBtn);

                    info.appendChild(name);
                    info.appendChild(price);
                    item.appendChild(img);
                    item.appendChild(info);
                    item.appendChild(actions);
                    grid.appendChild(item);
                }

                group.appendChild(grid);
                fragment.appendChild(group);
            }

            DOM.cart.body.innerHTML = '';
            DOM.cart.body.appendChild(fragment);

            // Update summary
            let totalGems = 0;
            let unknownCount = 0;
            for (const skin of wantedSkins) {
                if (skin['재화']) {
                    totalGems += skin['재화'];
                } else {
                    unknownCount++;
                }
            }

            const totalKrw = Math.round(totalGems * KRW_PER_GEM);
            const trucks = totalGems / GEMS_PER_TRUCK;

            DOM.cart.count.textContent = `${wantedSkins.length}개`;
            DOM.cart.totalGems.textContent = totalGems.toLocaleString() + (unknownCount > 0 ? ` (+${unknownCount}개 미정)` : '');
            DOM.cart.totalKrw.textContent = `약 ${totalKrw.toLocaleString()}원`;
            DOM.cart.totalTruck.textContent = trucks < 0.01 ? '0 깡트럭' :
                `${trucks < 1 ? trucks.toFixed(2) : trucks.toFixed(1)} 깡트럭`;
        },

        buyAll() {
            const wantedIds = [...collection.wanted];
            if (wantedIds.length === 0) return;

            for (const skinId of wantedIds) {
                collection.owned.add(skinId);
                collection.wanted.delete(skinId);
                CollectionManager._updateCardState(skinId);
            }
            saveCollection();
            this.updateBadge();
            OwnedShowcase.updateBadge();
            this.render();
            FilterEngine.apply();
            showToast(`${wantedIds.length}개 스킨을 보유 표시했습니다.`, 'success');
        },

        _showCartMode() {
            DOM.cart.shareBtn.style.display = '';
            DOM.cart.buyAllBtn.style.display = '';
            DOM.cart.backBtn.style.display = 'none';
        },

        _showShareMode() {
            DOM.cart.shareBtn.style.display = 'none';
            DOM.cart.buyAllBtn.style.display = 'none';
            DOM.cart.backBtn.style.display = '';
        },

        renderShareView() {
            const wantedSkins = allSkins.filter(s => collection.wanted.has(s['클뜯 id']));

            if (wantedSkins.length === 0) {
                showToast('찜한 스킨이 없습니다.', 'info');
                return;
            }

            let totalGems = 0;
            wantedSkins.forEach(s => { if (s['재화']) totalGems += s['재화']; });
            const totalKrw = Math.round(totalGems * KRW_PER_GEM);
            const trucks = totalGems / GEMS_PER_TRUCK;
            const today = new Date().toLocaleDateString('ko-KR');

            const view = document.createElement('div');
            view.className = 'share-view';

            // Header
            const header = document.createElement('div');
            header.className = 'share-header';
            const h3 = document.createElement('h3');
            h3.textContent = '내 찜 목록';
            const dateSpan = document.createElement('span');
            dateSpan.className = 'share-date';
            dateSpan.textContent = today;
            header.appendChild(h3);
            header.appendChild(dateSpan);
            view.appendChild(header);

            // Summary
            const summaryTitle = document.createElement('div');
            summaryTitle.className = 'share-section-title';
            const heartIcon = document.createElement('i');
            heartIcon.className = 'fas fa-heart';
            summaryTitle.appendChild(heartIcon);
            summaryTitle.appendChild(document.createTextNode(` ${wantedSkins.length}개 — `));
            const gemImg = document.createElement('img');
            gemImg.src = resolveUrl('assets/icon/60px-Ruby.webp');
            gemImg.className = 'gem-icon';
            gemImg.alt = 'Gem';
            summaryTitle.appendChild(gemImg);
            summaryTitle.appendChild(document.createTextNode(` ${totalGems.toLocaleString()} (약 ${totalKrw.toLocaleString()}원 / ${trucks.toFixed(1)} 깡트럭)`));
            view.appendChild(summaryTitle);

            // Grid
            const grid = document.createElement('div');
            grid.className = 'share-grid';
            for (const skin of wantedSkins) {
                const item = document.createElement('div');
                item.className = 'share-item';
                const img = document.createElement('img');
                img.src = skin['깔끔한 일러'] || IMG_FALLBACKS.CARD;
                img.alt = skin['함순이 이름'];
                img.loading = 'lazy';
                const nameSpan = document.createElement('span');
                nameSpan.textContent = skin['함순이 이름'];
                const priceEl = document.createElement('small');
                priceEl.textContent = skin['재화'] ? skin['재화'].toLocaleString() : '?';
                item.appendChild(img);
                item.appendChild(nameSpan);
                item.appendChild(priceEl);
                grid.appendChild(item);
            }
            view.appendChild(grid);

            DOM.cart.body.innerHTML = '';
            DOM.cart.body.appendChild(view);
            DOM.cart.footer.style.display = 'none';
            this._showShareMode();
            showToast('캡처용 화면입니다. 스크린샷을 찍어주세요!', 'info');
        }
    };

    // ===== Owned Showcase =====
    const OwnedShowcase = {
        _groupMode: 'type',

        updateBadge() {
            const count = collection.owned.size;
            DOM.owned.badge.textContent = count;
            DOM.owned.fab.classList.toggle('has-items', count > 0);
        },

        open() {
            this.render();
            openModal('owned-modal');
        },

        render() {
            const ownedSkins = allSkins.filter(s => collection.owned.has(s['클뜯 id']));

            if (ownedSkins.length === 0) {
                DOM.owned.body.innerHTML = '<div class="cart-empty"><i class="fas fa-shirt"></i><p>보유 스킨이 없습니다</p><p class="cart-empty-hint">스킨 카드의 <i class="fas fa-check"></i> 버튼으로 보유 표시해보세요!</p></div>';
                DOM.owned.footer.style.display = 'none';
                return;
            }

            DOM.owned.footer.style.display = '';

            // Group skins
            const groups = this._groupMode === 'type'
                ? this._groupByType(ownedSkins)
                : this._groupByTag(ownedSkins);

            const fragment = document.createDocumentFragment();

            for (const [groupName, skins] of groups) {
                const section = document.createElement('div');
                section.className = 'share-section';

                const title = document.createElement('div');
                title.className = 'share-section-title';
                title.textContent = `${groupName} (${skins.length}개)`;
                section.appendChild(title);

                const grid = document.createElement('div');
                grid.className = 'share-grid';

                for (const skin of skins) {
                    const item = document.createElement('div');
                    item.className = 'share-item';

                    const img = document.createElement('img');
                    img.src = skin['깔끔한 일러'] || IMG_FALLBACKS.CARD;
                    img.alt = skin['함순이 이름'];
                    img.loading = 'lazy';

                    const nameSpan = document.createElement('span');
                    nameSpan.textContent = skin['함순이 이름'] || '';

                    item.appendChild(img);
                    item.appendChild(nameSpan);
                    grid.appendChild(item);
                }

                section.appendChild(grid);
                fragment.appendChild(section);
            }

            DOM.owned.body.innerHTML = '';
            DOM.owned.body.appendChild(fragment);

            // Update footer
            let totalGems = 0;
            for (const skin of ownedSkins) {
                if (skin['재화']) totalGems += skin['재화'];
            }
            DOM.owned.count.textContent = `${ownedSkins.length}개`;
            DOM.owned.totalGems.textContent = totalGems.toLocaleString();
        },

        _groupByType(skins) {
            const groups = new Map();
            for (const skin of skins) {
                const type = skin['스킨 타입 - 한글'] || '기본';
                if (!groups.has(type)) groups.set(type, []);
                groups.get(type).push(skin);
            }
            // Sort groups: 기본 first, then alphabetically
            return [...groups.entries()].sort((a, b) => {
                if (a[0] === '기본') return -1;
                if (b[0] === '기본') return 1;
                return a[0].localeCompare(b[0], 'ko');
            });
        },

        _groupByTag(skins) {
            const TAG_GROUP_ORDER = ['듀얼', 'L2D+', 'L2D', '쁘띠모션'];
            const TAG_DISPLAY_ORDER = ['듀얼', 'L2D+', 'L2D', '쁘띠모션', '기타'];
            const groups = new Map();
            for (const skin of skins) {
                const rawTag = skin['스킨 태그'] || '';
                let tag = '기타';
                for (const candidate of TAG_GROUP_ORDER) {
                    if (rawTag.includes(candidate)) {
                        tag = candidate;
                        break;
                    }
                }
                if (!groups.has(tag)) groups.set(tag, []);
                groups.get(tag).push(skin);
            }
            // Sort by display order
            return TAG_DISPLAY_ORDER
                .filter(tag => groups.has(tag))
                .map(tag => [tag, groups.get(tag)]);
        },

        setGroupMode(mode) {
            this._groupMode = mode;
            DOM.owned.toggleBtns.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.group === mode);
            });
            this.render();
        }
    };

    // ===== Renderer =====
    const Renderer = {
        _createSkinBox(skin) {
            const skinId = skin['클뜯 id'];

            const costHtml = skin['재화']
                ? `<img src="${resolveUrl('assets/icon/60px-Ruby.webp')}" class="gem-icon" alt="Gem"> ${skin['재화']}`
                : 'N/A';

            const wrapper = document.createElement('div');
            wrapper.className = 'skin-box-link';

            const skinBox = document.createElement('div');
            skinBox.className = 'skin-box';
            skinBox.dataset.skinId = skinId;

            // Apply owned/wanted state
            if (collection.owned.has(skinId)) skinBox.classList.add('is-owned');
            if (collection.wanted.has(skinId)) skinBox.classList.add('is-wanted');

            const imageWrapper = document.createElement('div');
            imageWrapper.className = 'skin-image-wrapper';

            // Action buttons (no per-card listeners — handled by event delegation)
            const actions = document.createElement('div');
            actions.className = 'skin-actions';

            const isOwned = collection.owned.has(skinId);

            const ownedBtn = document.createElement('button');
            ownedBtn.className = 'skin-action-btn owned-btn' + (isOwned ? ' active' : '');
            ownedBtn.innerHTML = '<i class="fas fa-check"></i>';
            ownedBtn.title = '보유중 표시';

            const wantedBtn = document.createElement('button');
            wantedBtn.className = 'skin-action-btn wanted-btn'
                + (collection.wanted.has(skinId) ? ' active' : '')
                + (isOwned ? ' disabled' : '');
            wantedBtn.innerHTML = '<i class="fas fa-heart"></i>';
            wantedBtn.title = isOwned ? '보유중인 스킨' : '찜하기';

            actions.appendChild(ownedBtn);
            actions.appendChild(wantedBtn);
            imageWrapper.appendChild(actions);

            if (skin.isSold) {
                const badge = document.createElement('div');
                badge.className = 'new-badge';
                badge.textContent = '판매중';
                imageWrapper.appendChild(badge);
            }

            const img = document.createElement('img');
            img.src = skin['깔끔한 일러'] || IMG_FALLBACKS.CARD;
            img.className = 'skin-image';
            img.loading = 'lazy';
            img.alt = skin['함순이 이름'];
            img.addEventListener('error', () => {
                img.style.opacity = '0.3';
                img.alt = '이미지를 불러올 수 없습니다';
            }, { once: true });

            imageWrapper.appendChild(img);
            skinBox.appendChild(imageWrapper);

            // Extract skin-specific name (remove character name prefix)
            const fullName = skin['한글 함순이 + 스킨 이름'] || '';
            const charName = skin['함순이 이름'] || '';
            const skinOnlyName = fullName.startsWith(charName) ? fullName.slice(charName.length).trim() : fullName;
            // Skin name is the heading; character name is a small chip below it
            const charChipHtml = `<div class="char-name-chip" title="${charName}">${charName}</div>`;

            const releaseDate = formatReleaseDate(skinId);
            const skinInfo = document.createElement('div');
            skinInfo.className = 'skin-info';
            skinInfo.innerHTML = `
                <h3>${skinOnlyName || charName}</h3>
                ${skinOnlyName ? charChipHtml : ''}
                <div class="info-line"><strong>타입:</strong> ${skin['스킨 타입 - 한글'] || '기본'}</div>
                <div class="info-line"><strong>태그:</strong> ${skin['스킨 태그'] || '없음'}</div>
                <div class="info-line"><strong>진영:</strong> ${skin['진영'] || '없음'}</div>
                <div class="info-line"><strong>레어도:</strong> ${skin['레어도'] || '없음'}</div>
                <div class="info-line"><strong>가격:</strong> ${costHtml}</div>
                <div class="info-line"><strong>기간:</strong> ${skin['기간'] || '정보 없음'}</div>
                ${releaseDate ? `<div class="info-line"><strong>출시:</strong> ${releaseDate}</div>` : ''}
            `;

            skinBox.appendChild(skinInfo);
            wrapper.appendChild(skinBox);

            return wrapper;
        },

        _categorizeSkin(skin) {
            const period = skin['기간'];
            if (!period) { skin.isSold = false; return 'other'; }

            if (period === '상시') {
                skin.isSold = true;
                return 'permanent';
            }

            const dateMatch = period.match(/(\d{4})\/(\d{2})\/(\d{2})/);
            if (dateMatch) {
                const skinDate = new Date(dateMatch[1], dateMatch[2] - 1, dateMatch[3]);
                skin.isSold = skinDate >= this._today;
            } else {
                skin.isSold = false;
            }

            if (period.includes('한정')) {
                return skin.isSold ? 'new' : 'limited';
            }
            return 'other';
        },

        /**
         * Create all card wrappers and populate skinCardMap.
         * Does NOT append to DOM — ChunkController handles that via FilterEngine.apply().
         */
        buildAll(skins) {
            this._today = new Date();
            this._today.setHours(0, 0, 0, 0);

            for (const skin of skins) {
                const category = this._categorizeSkin(skin);
                const wrapper = this._createSkinBox(skin);
                skinCardMap.set(skin['클뜯 id'], { wrapper, category, skin });
            }
        }
    };

    // ===== Event Delegation =====
    // Single listener per container handles all card interactions
    const handleContainerClick = (e) => {
        const ownedBtn = e.target.closest('.owned-btn');
        if (ownedBtn) {
            e.stopPropagation();
            const skinId = parseInt(ownedBtn.closest('.skin-box').dataset.skinId);
            CollectionManager.toggleOwned(skinId);
            return;
        }

        const wantedBtn = e.target.closest('.wanted-btn');
        if (wantedBtn) {
            e.stopPropagation();
            const skinId = parseInt(wantedBtn.closest('.skin-box').dataset.skinId);
            CollectionManager.toggleWanted(skinId);
            return;
        }

        const card = e.target.closest('.skin-box');
        if (card) {
            const skinId = parseInt(card.dataset.skinId);
            const skin = skinById.get(skinId);
            if (skin) Lightbox.open(skin);
        }
    };

    // Cart body delegation for buy and remove buttons
    const handleCartClick = (e) => {
        const item = e.target.closest('.cart-item');
        if (!item) return;
        const skinId = parseInt(item.dataset.skinId);

        if (e.target.closest('.cart-item-buy')) {
            // Buy = mark owned (auto-removes from wanted via toggleOwned logic)
            CollectionManager.toggleOwned(skinId);
            CartManager.updateBadge();
            CartManager.render();
            FilterEngine.apply();
        } else if (e.target.closest('.cart-item-remove')) {
            CollectionManager.toggleWanted(skinId);
            CartManager.render();
        }
    };

    // ===== Event Handlers =====
    const debouncedAutocomplete = debounce((searchTerm) => {
        if (fuse && searchTerm.trim()) {
            Autocomplete.render(fuse.search(searchTerm));
        } else {
            Autocomplete.close();
        }
    }, 100);

    const EventHandlers = {
        handleSearch() {
            debouncedAutocomplete(DOM.search.value);
            debouncedFilterUpdate();
        },

        resetFilters() {
            DOM.search.value = '';
            DOM.filters.skinType.value = 'all';
            DOM.filters.period.value = 'all';
            DOM.filters.faction.value = 'all';
            DOM.filters.tag.value = 'all';
            DOM.filters.exDialogue.checked = false;
            DOM.filters.ownership.value = 'all';
            DOM.filters.sort.value = 'default';
            rarityAllCheckbox.checked = true;
            cachedRarityCheckboxes.forEach(cb => cb.checked = false);

            FilterEngine.apply();
            URLState.update();
        },

        handleFilterChange() {
            FilterEngine.apply();
            URLState.update();
        },

        handleRarityAllChange() {
            if (rarityAllCheckbox.checked) {
                cachedRarityCheckboxes.forEach(cb => { cb.checked = false; });
            } else {
                // Don't allow unchecking 전체보기 directly — if nothing else is checked, re-check it
                const anyChecked = cachedRarityCheckboxes.some(cb => cb.checked);
                if (!anyChecked) rarityAllCheckbox.checked = true;
            }
            FilterEngine.apply();
            URLState.update();
        },

        handleRarityChange() {
            const anyChecked = cachedRarityCheckboxes.some(cb => cb.checked);
            rarityAllCheckbox.checked = !anyChecked;
            FilterEngine.apply();
            URLState.update();
        },

        toggleFilters() {
            DOM.filterContainer.classList.toggle('visible');
            DOM.buttons.filterToggle.classList.toggle('active');
        }
    };

    // ===== Debounced/Throttled Functions =====
    const debouncedFilterUpdate = debounce(() => {
        FilterEngine.apply();
        URLState.update();
    }, DEBOUNCE_DELAY);

    // ===== Data Initialization =====
    const showLoadingState = () => {
        isLoading = true;
        allSkinContainers.forEach(container => {
            container.innerHTML = '<p class="loading-message">데이터 불러오는 중...</p>';
        });
    };

    const showErrorState = (error) => {
        isLoading = false;
        const msg = error.message || 'Unknown error';
        allSkinContainers.forEach(container => {
            const p = document.createElement('p');
            p.className = 'error-message';
            p.textContent = '데이터를 불러오는데 실패했습니다.';
            p.appendChild(document.createElement('br'));
            const small = document.createElement('small');
            small.textContent = msg;
            p.appendChild(small);
            container.innerHTML = '';
            container.appendChild(p);
        });
        console.error("Failed to load data:", error);
    };

    showLoadingState();

    Promise.all([
        fetchJSONWithCache('data/skin/skin_voiceline_data_subset.json'),
        fetchJSONWithCache('data/skin/skin_release_dates.json').catch(() => ({}))
    ])
        .then(([skinJson, releaseDateJson]) => {
            allSkins = skinJson;
            releaseDates = releaseDateJson || {};
            isLoading = false;

            // Normalize faction values for current data
            normalizeFactions(allSkins);

            // Build ID→skin lookup map
            for (const skin of allSkins) {
                skinById.set(skin['클뜯 id'], skin);
            }

            // Create all card wrappers (not yet in DOM)
            Renderer.buildAll(allSkins);

            // Initialize chunked rendering
            ChunkController.init(Object.keys(DOM.sections));

            const uniqueNames = [...new Set(allSkins.map(skin => skin['한글 함순이 + 스킨 이름']))].sort();
            fuse = createSearchIndex(uniqueNames.map(name => ({ name })), fuseOptions);

            // Initialize cart badge
            CartManager.updateBadge();
            OwnedShowcase.updateBadge();

            URLState.apply();
        })
        .catch(error => {
            showErrorState(error);
        });

    // ===== Cleanup =====
    const cleanup = () => {
        ChunkController.cleanup();
        clearTimeout(progressBarTimer);
        progressBarTimer = null;

        DOM.search.removeEventListener('input', EventHandlers.handleSearch);
        [DOM.filters.skinType, DOM.filters.period, DOM.filters.faction, DOM.filters.tag,
         DOM.filters.exDialogue, DOM.filters.ownership, DOM.filters.sort]
            .forEach(el => el.removeEventListener('change', EventHandlers.handleFilterChange));
        rarityAllCheckbox.removeEventListener('change', EventHandlers.handleRarityAllChange);
        cachedRarityCheckboxes.forEach(cb => cb.removeEventListener('change', EventHandlers.handleRarityChange));
        DOM.buttons.clearAll.removeEventListener('click', EventHandlers.resetFilters);
        DOM.buttons.filterToggle.removeEventListener('click', EventHandlers.toggleFilters);
        window.removeEventListener('popstate', URLState.apply);
        window.removeEventListener('storage', handleStorageSync);
        document.removeEventListener('click', handleDocumentClick);
        document.removeEventListener('keydown', handleEscape);

        // Remove delegated listeners
        Object.values(DOM.containers).forEach(c => c.removeEventListener('click', handleContainerClick));
        DOM.cart.body.removeEventListener('click', handleCartClick);

        Autocomplete.close();

        if (DOM.progressBar) {
            DOM.progressBar.classList.remove('visible');
        }

        console.log('Skin list viewer cleaned up successfully');
    };

    window.skinListViewerCleanup = cleanup;

    // ===== Event Listeners =====
    DOM.search.addEventListener('input', EventHandlers.handleSearch);

    [DOM.filters.skinType, DOM.filters.period, DOM.filters.faction, DOM.filters.tag,
     DOM.filters.exDialogue, DOM.filters.ownership, DOM.filters.sort]
        .forEach(el => el.addEventListener('change', EventHandlers.handleFilterChange));

    rarityAllCheckbox.addEventListener('change', EventHandlers.handleRarityAllChange);
    cachedRarityCheckboxes
        .forEach(cb => cb.addEventListener('change', EventHandlers.handleRarityChange));

    DOM.buttons.clearAll.addEventListener('click', EventHandlers.resetFilters);
    DOM.buttons.filterToggle.addEventListener('click', EventHandlers.toggleFilters);

    const handleDocumentClick = (e) => {
        if (!DOM.search.parentNode.contains(e.target)) Autocomplete.close();
    };

    const handleStorageSync = (e) => {
        if (e.key !== COLLECTION_KEY) return;
        try {
            const newData = JSON.parse(e.newValue || '{}');
            collection.owned = new Set(newData.owned || []);
            collection.wanted = new Set(newData.wanted || []);
            CartManager.updateBadge();
            OwnedShowcase.updateBadge();
            FilterEngine.apply();
        } catch (err) {
            console.error('Failed to sync collection from storage event:', err);
        }
    };

    document.addEventListener("click", handleDocumentClick);
    window.addEventListener('popstate', URLState.apply);
    window.addEventListener('storage', handleStorageSync);

    // Event delegation on skin card containers (4 listeners instead of ~9000)
    Object.values(DOM.containers).forEach(c => c.addEventListener('click', handleContainerClick));

    // Cart body delegation
    DOM.cart.body.addEventListener('click', handleCartClick);

    // Owned showcase FAB + toggle
    DOM.owned.fab.addEventListener('click', () => OwnedShowcase.open());
    DOM.owned.toggleBtns.forEach(btn => {
        btn.addEventListener('click', () => OwnedShowcase.setGroupMode(btn.dataset.group));
    });

    setupModal('owned-modal', {
        closeButtonSelector: '#owned-modal .cart-close-btn',
        closeOnEscape: true,
        closeOnBackdrop: true
    });

    // Cart FAB + header buttons
    DOM.cart.fab.addEventListener('click', () => CartManager.open());
    DOM.cart.shareBtn.addEventListener('click', () => CartManager.renderShareView());
    DOM.cart.buyAllBtn.addEventListener('click', () => CartManager.buyAll());
    DOM.cart.backBtn.addEventListener('click', () => {
        CartManager._showCartMode();
        CartManager.render();
    });

    setupModal('cart-modal', {
        closeButtonSelector: '.cart-close-btn',
        closeOnEscape: true,
        closeOnBackdrop: true
    });

    // Lightbox events
    DOM.popup.closeBtn.addEventListener('click', () => Lightbox.close());
    DOM.popup.overlay.addEventListener('click', (e) => {
        // Close unless clicking directly on image, info panel, or detail link
        if (!e.target.closest('.popup-image, .popup-skin-info')) {
            Lightbox.close();
        }
    });

    const handleEscape = (e) => {
        if (e.key === 'Escape' && DOM.popup.overlay.classList.contains('visible')) {
            Lightbox.close();
        }
    };
    document.addEventListener('keydown', handleEscape);
});
