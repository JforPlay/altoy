import { debounce, fetchJSONWithCache, getAllUrlParams, setUrlParams, resolveUrl, normalizeRomanNumerals, createSearchIndex,
    openModal, closeModal, setupModal, showToast, getStorageItem, setStorageItem, IMG_FALLBACKS, DATA_VERSION } from '../utils.js';

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
            exDialogue: document.getElementById('ex-dialogue-checkbox'),
            ownership: document.getElementById('ownership-select')
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

    // === STATE ===
    let allSkins = [];
    let fuse;
    let isLoading = false;
    let releaseDates = {};
    const fuseOptions = { keys: ['name'], threshold: 0.4 };

    // Skin ID → skin data for O(1) lookup
    const skinById = new Map();
    // Skin ID → { wrapper, category } for visibility-toggle filtering
    const skinCardMap = new Map();

    // === COLLECTION STATE ===
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
        SEARCH: 'search',
        OWNERSHIP: 'ownership'
    };

    const TAGS_TO_EXCLUDE = ['듀얼', 'L2D', 'L2D+', '쁘띠모션'];
    const AUTOCOMPLETE_LIMIT = 10;
    const DEBOUNCE_DELAY = 300;

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

    // === TIMER MANAGEMENT ===
    let activeTimers = {
        debounce: null,
        throttle: null,
        progressBar: null
    };

    // === UTILITY FUNCTIONS ===
    const showFilteringState = () => {
        activeTimers.progressBar = setTimeout(() => {
            if (DOM.progressBar) {
                DOM.progressBar.classList.add('visible');
            }
        }, 150);
    };

    const hideFilteringState = () => {
        clearTimeout(activeTimers.progressBar);
        activeTimers.progressBar = null;
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

    // === URL STATE MANAGEMENT ===
    const URLState = {
        getFilters() {
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
                search: DOM.search.value,
                ownership: DOM.filters.ownership.value
            };
        },

        update() {
            const filters = this.getFilters();
            setUrlParams({
                [FILTER_PARAMS.TYPE]: filters.type !== 'all' ? filters.type : null,
                [FILTER_PARAMS.TAG]: filters.tag !== 'all' ? filters.tag : null,
                [FILTER_PARAMS.PERIOD]: filters.period !== 'all' ? filters.period : null,
                [FILTER_PARAMS.FACTION]: filters.faction !== 'all' ? filters.faction : null,
                [FILTER_PARAMS.RARITIES]: filters.rarities.length < 5 ? filters.rarities.join(',') : null,
                [FILTER_PARAMS.EX]: filters.ex ? 'true' : null,
                [FILTER_PARAMS.SEARCH]: filters.search || null,
                [FILTER_PARAMS.OWNERSHIP]: filters.ownership !== 'all' ? filters.ownership : null,
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

            const raritiesParam = params[FILTER_PARAMS.RARITIES];
            if (raritiesParam) {
                const activeRarities = new Set(raritiesParam.split(','));
                cachedRarityCheckboxes.forEach(cb => {
                    cb.checked = activeRarities.has(cb.value);
                });
            }

            DOM.filters.exDialogue.checked = params[FILTER_PARAMS.EX] === 'true';
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

        _checkOwnership(skin, ownershipFilter) {
            if (ownershipFilter === 'all') return true;
            const isOwned = collection.owned.has(skin['클뜯 id']);
            return ownershipFilter === 'owned' ? isOwned : !isOwned;
        },

        apply() {
            if (isLoading || skinCardMap.size === 0) return;

            showFilteringState();

            requestAnimationFrame(() => {
                const searchTerm = DOM.search.value.toLowerCase().trim();
                const filters = URLState.getFilters();
                const selectedRarities = new Set(filters.rarities);

                // Track visible count per section
                const visibleCounts = { new: 0, limited: 0, permanent: 0, other: 0 };

                // Toggle visibility on pre-built cards
                for (const skin of allSkins) {
                    const skinId = skin['클뜯 id'];
                    const entry = skinCardMap.get(skinId);
                    if (!entry) continue;

                    const visible =
                        (!searchTerm || skin['함순이 이름']?.toLowerCase().includes(searchTerm)) &&
                        (!filters.ex || skin['ex_chat_status'] === 1) &&
                        this._checkSkinType(skin, filters.type) &&
                        (filters.faction === 'all' || skin['진영'] === filters.faction) &&
                        this._checkPeriod(skin, filters.period) &&
                        this._checkTag(skin, filters.tag) &&
                        (selectedRarities.size === 0 || selectedRarities.has(skin['레어도'])) &&
                        this._checkOwnership(skin, filters.ownership);

                    entry.wrapper.style.display = visible ? '' : 'none';
                    if (visible) visibleCounts[entry.category]++;
                }

                // Toggle section visibility
                for (const key of Object.keys(DOM.sections)) {
                    DOM.sections[key].style.display = visibleCounts[key] > 0 ? 'block' : 'none';
                }

                requestAnimationFrame(() => hideFilteringState());
            });
        }
    };

    // === COLLECTION MANAGER ===
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
            const card = document.querySelector(`.skin-box[data-skin-id="${skinId}"]`);
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

    // === LIGHTBOX ===
    const Lightbox = {
        _generation: 0,

        open(skin) {
            this._generation++;
            const gen = this._generation;
            const shipyardUrl = skin['깔끔한 일러'] || '';
            const fullUrl = shipyardUrl.replace('/shipyard.png', '/painting.png');

            // Clear old image immediately
            DOM.popup.image.src = '';
            DOM.popup.image.classList.add('loading');

            // Set text and link immediately
            DOM.popup.skinName.textContent = skin['한글 함순이 + 스킨 이름'];
            DOM.popup.charName.textContent = skin['함순이 이름'];

            const characterName = encodeURIComponent(normalizeRomanNumerals(skin['함순이 이름']));
            const skinName = encodeURIComponent(normalizeRomanNumerals(skin['한글 함순이 + 스킨 이름']));
            DOM.popup.detailLink.href = resolveUrl(`skin/skin-detail-viewer/?character=${characterName}&skin=${skinName}`);

            // Show overlay immediately
            DOM.popup.overlay.classList.add('visible');
            document.body.classList.add('no-scroll');

            // Load image with generation check
            DOM.popup.image.addEventListener('load', () => {
                if (gen === this._generation) DOM.popup.image.classList.remove('loading');
            }, { once: true });
            DOM.popup.image.addEventListener('error', () => {
                if (gen === this._generation) DOM.popup.image.src = shipyardUrl;
            }, { once: true });
            DOM.popup.image.src = fullUrl;
        },

        close() {
            DOM.popup.overlay.classList.remove('visible');
            document.body.classList.remove('no-scroll');
            DOM.popup.image.src = '';
            DOM.popup.image.classList.remove('loading');
        }
    };

    // === CART MANAGER ===
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
            const ownedSkins = allSkins.filter(s => collection.owned.has(s['클뜯 id']));

            if (wantedSkins.length === 0 && ownedSkins.length === 0) {
                showToast('공유할 컬렉션이 없습니다.', 'info');
                return;
            }

            let totalGems = 0;
            wantedSkins.forEach(s => { if (s['재화']) totalGems += s['재화']; });
            const totalKrw = Math.round(totalGems * KRW_PER_GEM);
            const trucks = totalGems / GEMS_PER_TRUCK;

            const today = new Date().toLocaleDateString('ko-KR');

            let html = '<div class="share-view">';
            html += `<div class="share-header"><h3>내 스킨 컬렉션</h3><span class="share-date">${today}</span></div>`;

            if (ownedSkins.length > 0) {
                html += `<div class="share-section"><div class="share-section-title"><i class="fas fa-check-circle"></i> 보유 스킨 (${ownedSkins.length}개)</div>`;
                html += '<div class="share-grid">';
                for (const skin of ownedSkins) {
                    html += `<div class="share-item"><img src="${skin['깔끔한 일러'] || IMG_FALLBACKS.CARD}" alt="${skin['함순이 이름']}" loading="lazy"><span>${skin['함순이 이름']}</span></div>`;
                }
                html += '</div></div>';
            }

            if (wantedSkins.length > 0) {
                html += `<div class="share-section"><div class="share-section-title"><i class="fas fa-heart"></i> 찜 목록 (${wantedSkins.length}개) — <img src="${resolveUrl('assets/icon/60px-Ruby.webp')}" class="gem-icon" alt="Gem"> ${totalGems.toLocaleString()} (약 ${totalKrw.toLocaleString()}원 / ${trucks.toFixed(1)} 깡트럭)</div>`;
                html += '<div class="share-grid">';
                for (const skin of wantedSkins) {
                    const cost = skin['재화'] ? skin['재화'].toLocaleString() : '?';
                    html += `<div class="share-item"><img src="${skin['깔끔한 일러'] || IMG_FALLBACKS.CARD}" alt="${skin['함순이 이름']}" loading="lazy"><span>${skin['함순이 이름']}</span><small>${cost}</small></div>`;
                }
                html += '</div></div>';
            }

            html += '</div>';

            DOM.cart.body.innerHTML = html;
            DOM.cart.footer.style.display = 'none';
            this._showShareMode();
            showToast('캡처용 화면입니다. 스크린샷을 찍어주세요!', 'info');
        }
    };

    // === RENDERER ===
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

            const releaseDate = formatReleaseDate(skinId);
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

        // Build all cards once, append to their section containers
        buildAll(skins) {
            // Cache today's date once for all categorizations
            this._today = new Date();
            this._today.setHours(0, 0, 0, 0);

            const fragments = { new: document.createDocumentFragment(), limited: document.createDocumentFragment(), permanent: document.createDocumentFragment(), other: document.createDocumentFragment() };

            for (const skin of skins) {
                const category = this._categorizeSkin(skin);
                const wrapper = this._createSkinBox(skin);

                skinCardMap.set(skin['클뜯 id'], { wrapper, category });
                fragments[category].appendChild(wrapper);
            }

            Object.keys(DOM.containers).forEach(key => {
                DOM.containers[key].innerHTML = '';
                DOM.containers[key].appendChild(fragments[key]);
            });
        }
    };

    // === EVENT DELEGATION for skin cards ===
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

    // === EVENT HANDLERS ===
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
                <p style="text-align: center; padding: 2rem; color: var(--danger-color);">
                    데이터를 불러오는데 실패했습니다.<br>
                    <small style="color: var(--text-muted);">${error.message || 'Unknown error'}</small>
                </p>
            `;
        });
        console.error("Failed to load data:", error);
    };

    showLoadingState();

    Promise.all([
        fetchJSONWithCache(`data/skin/skin_voiceline_data_subset.json?v=${DATA_VERSION}`),
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

            // Build all cards once (no more per-filter DOM recreation)
            Renderer.buildAll(allSkins);

            const uniqueShipNames = [...new Set(allSkins.map(skin => skin['함순이 이름']))].sort();
            fuse = createSearchIndex(uniqueShipNames.map(name => ({ name })), fuseOptions);

            // Initialize cart badge
            CartManager.updateBadge();

            URLState.apply();
        })
        .catch(error => {
            showErrorState(error);
        });

    // === CLEANUP METHOD ===
    const cleanup = () => {
        clearTimeout(activeTimers.debounce);
        clearTimeout(activeTimers.throttle);
        clearTimeout(activeTimers.progressBar);
        activeTimers.debounce = null;
        activeTimers.throttle = null;
        activeTimers.progressBar = null;

        DOM.search.removeEventListener('input', EventHandlers.handleSearch);
        [DOM.filters.skinType, DOM.filters.period, DOM.filters.faction, DOM.filters.tag,
         DOM.filters.exDialogue, DOM.filters.ownership]
            .forEach(el => el.removeEventListener('change', EventHandlers.handleFilterChange));
        cachedRarityCheckboxes.forEach(cb => cb.removeEventListener('change', EventHandlers.handleFilterChange));
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

    // === EVENT LISTENERS ===
    DOM.search.addEventListener('input', EventHandlers.handleSearch);

    [DOM.filters.skinType, DOM.filters.period, DOM.filters.faction, DOM.filters.tag,
     DOM.filters.exDialogue, DOM.filters.ownership]
        .forEach(el => el.addEventListener('change', EventHandlers.handleFilterChange));

    cachedRarityCheckboxes
        .forEach(cb => cb.addEventListener('change', EventHandlers.handleFilterChange));

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
