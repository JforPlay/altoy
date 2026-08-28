/**
 * skin.list.viewer.js
 * Skin list/browse page controller for the skin module group.
 * Renders all skins grouped by availability (new/limited/permanent/other) with multi-filter,
 * search autocomplete, collection tracking (owned/wanted), a wishlist cart modal, and image lightbox.
 * Cards are built once at load time; filtering rebuilds visible sets and appends in chunks of 50 via IntersectionObserver.
 */
import { debounce, fetchJSONWithCache, getAllUrlParams, setUrlParams, resolveUrl, normalizeRomanNumerals, createSearchIndex, ensureFuse,
    openModal, setupModal, showToast, toggleElement, IMG_FALLBACKS,
    createIcon, createGemIconImg, lockBodyScroll, unlockBodyScroll, syncedStorage, renderStatus, loadPageData } from '../utils.js';
import { loadReleaseDates } from './skin.data.js';
import { formatReleaseDate, releaseSortKey } from './skin.dates.js';
import { composeDefaultPainting } from './skin.expression.js';
import { ensureExpressionManifest } from '../expression-manifest.js';

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

    const parseCollection = (raw) => ({
        owned: new Set(raw && Array.isArray(raw.owned) ? raw.owned : []),
        wanted: new Set(raw && Array.isArray(raw.wanted) ? raw.wanted : []),
    });

    const collectionStore = syncedStorage(COLLECTION_KEY, {
        parse: parseCollection,
        onRemoteChange: (next) => {
            collection = next;
            CartManager.updateBadge();
            OwnedShowcase.updateBadge();
            FilterEngine.apply();
        },
    });

    let collection = collectionStore.load();

    function saveCollection() {
        collectionStore.save({
            owned: [...collection.owned],
            wanted: [...collection.wanted],
        });
    }

    // ===== Cached Queries & Constants =====
    const allRarityInputs = Array.from(DOM.filters.rarities.querySelectorAll('input'));
    const rarityAllCheckbox = allRarityInputs.find(cb => cb.value === 'all');
    const cachedRarityCheckboxes = allRarityInputs.filter(cb => cb.value !== 'all');

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

    // Gem to KRW conversion: 9900 gems = 121000 KRW = 1 깡트럭
    const GEMS_PER_TRUCK = 9900;
    const KRW_PER_TRUCK = 121000;
    const KRW_PER_GEM = KRW_PER_TRUCK / GEMS_PER_TRUCK;

    // Tag display order for cart/owned grouping. '기타' is the catch-all and is
    // never matched against the raw tag string, so priority is TAG_ORDER minus it.
    // L2D+ must precede L2D — the raw tag is a comma-joined string and `includes`
    // would otherwise match the substring first.
    const TAG_ORDER = ['듀얼', 'L2D+', 'L2D', '쁘띠모션', '기타'];
    const TAG_PRIORITY = TAG_ORDER.filter(t => t !== '기타');

    /** The single tag a skin is grouped under. */
    function primaryTag(skin) {
        const rawTag = skin['스킨 태그'] || '';
        return TAG_PRIORITY.find(t => rawTag.includes(t)) || '기타';
    }

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
            container.replaceChildren();

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
                const entry = section.entries[i];
                // Built here, not in buildAll: only what has actually been
                // scrolled to needs to exist (2,421 cards ≈ 60k nodes otherwise,
                // all of it before first paint for the 50 a chunk shows).
                entry.wrapper ??= Renderer._createSkinBox(entry.skin);
                fragment.appendChild(entry.wrapper);
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

    function createGemPrice(value) {
        const fragment = document.createDocumentFragment();
        fragment.append(createGemIconImg(), document.createTextNode(` ${Number(value).toLocaleString()}`));
        return fragment;
    }

    function createInfoLine(labelText, valueContent) {
        const line = document.createElement('div');
        line.className = 'info-line';

        const label = document.createElement('strong');
        label.textContent = labelText;
        line.append(label, document.createTextNode(' '));

        if (valueContent instanceof Node) {
            line.appendChild(valueContent);
        } else {
            line.appendChild(document.createTextNode(valueContent));
        }

        return line;
    }

    // Empty state for the cart / owned-showcase modal bodies. Uses the canonical
    // .page-status component (renderStatus), then appends the action hint as a
    // second message line so it inherits the same styling.
    function createEmptyState(container, message, hintFragment) {
        const status = renderStatus(container, message, 'empty');
        if (!status) return;
        const hint = document.createElement('p');
        hint.className = 'page-status-msg';
        hint.append(...hintFragment);
        status.appendChild(hint);
    }

    function createIconButton(className, iconClass, title) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.appendChild(createIcon(iconClass));
        return button;
    }

    function setSelectValue(select, value, fallback) {
        const nextValue = value || fallback;
        const hasOption = Array.from(select.options).some(option => option.value === nextValue || option.textContent === nextValue);
        select.value = hasOption ? nextValue : fallback;
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

            setSelectValue(DOM.filters.skinType, params[FILTER_PARAMS.TYPE], 'all');
            setSelectValue(DOM.filters.tag, params[FILTER_PARAMS.TAG], 'all');
            setSelectValue(DOM.filters.period, params[FILTER_PARAMS.PERIOD], 'all');
            setSelectValue(DOM.filters.faction, params[FILTER_PARAMS.FACTION], 'all');
            DOM.search.value = params[FILTER_PARAMS.SEARCH] || '';
            setSelectValue(DOM.filters.ownership, params[FILTER_PARAMS.OWNERSHIP], 'all');
            setSelectValue(DOM.filters.sort, params[FILTER_PARAMS.SORT], 'default');

            const raritiesParam = params[FILTER_PARAMS.RARITIES];
            if (raritiesParam) {
                const activeRarities = new Set(raritiesParam.split(','));
                rarityAllCheckbox.checked = false;
                cachedRarityCheckboxes.forEach(cb => {
                    cb.checked = activeRarities.has(cb.value);
                });
                if (!cachedRarityCheckboxes.some(cb => cb.checked)) {
                    rarityAllCheckbox.checked = true;
                }
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
            list.setAttribute('role', 'listbox');

            results.slice(0, AUTOCOMPLETE_LIMIT).forEach(result => {
                const item = result.item;
                const matches = result.matches;
                const div = document.createElement("div");
                div.setAttribute('role', 'option');
                div.tabIndex = 0;

                if (matches?.[0]?.indices) {
                    this._appendHighlightedText(div, item.name, matches[0].indices);
                } else {
                    div.textContent = item.name;
                }

                const selectItem = () => {
                    DOM.search.value = item.name;
                    this.close();
                    FilterEngine.apply();
                    URLState.update();
                };

                div.addEventListener("click", selectItem);
                div.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectItem();
                    }
                });

                list.appendChild(div);
            });

            DOM.search.parentNode.appendChild(list);
        },

        _appendHighlightedText(container, text, indices) {
            let lastIndex = 0;

            indices.forEach(([start, end]) => {
                if (start > lastIndex) {
                    container.appendChild(document.createTextNode(text.substring(lastIndex, start)));
                }
                const mark = document.createElement('mark');
                mark.textContent = text.substring(start, end + 1);
                container.appendChild(mark);
                lastIndex = end + 1;
            });

            if (lastIndex < text.length) {
                container.appendChild(document.createTextNode(text.substring(lastIndex)));
            }
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
            const releaseDate = (entry) => releaseSortKey(releaseDates[String(entry.skin['클뜯 id'])]);
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
            if (DOM.filters.ownership.value !== 'all') {
                FilterEngine.apply();
            }
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
            if (DOM.filters.ownership.value !== 'all') {
                FilterEngine.apply();
            }
        },

        _updateCardState(skinId) {
            const entry = skinCardMap.get(skinId);
            if (!entry?.wrapper) return; // never scrolled to — built already owned/wanted
            const card = entry.wrapper.querySelector('.skin-box');
            if (!card) return;

            const isOwned = collection.owned.has(skinId);
            const isWanted = collection.wanted.has(skinId);

            card.classList.toggle('is-owned', isOwned);
            card.classList.toggle('is-wanted', isWanted);

            const ownedBtn = card.querySelector('.owned-btn');
            const wantedBtn = card.querySelector('.wanted-btn');
            if (ownedBtn) {
                ownedBtn.classList.toggle('active', isOwned);
                ownedBtn.setAttribute('aria-pressed', String(isOwned));
            }
            if (wantedBtn) {
                wantedBtn.classList.toggle('active', isWanted);
                wantedBtn.classList.toggle('disabled', isOwned);
                wantedBtn.disabled = isOwned;
                wantedBtn.title = isOwned ? '보유중인 스킨' : '찜하기';
                wantedBtn.setAttribute('aria-label', wantedBtn.title);
                wantedBtn.setAttribute('aria-pressed', String(isWanted));
            }
        }
    };

    // ===== Lightbox =====
    const Lightbox = {
        _generation: 0,
        _compositeUrl: null,
        _errorHandler: null,

        async open(skin) {
            // Remove stale error handler from previous open
            if (this._errorHandler) {
                DOM.popup.image.removeEventListener('error', this._errorHandler);
                this._errorHandler = null;
            }

            this._generation++;
            const gen = this._generation;
            const skinId = skin['클뜯 id'];
            const shipyardUrl = skin['깔끔한 일러'] || '';
            // Full painting lives at output_expressions/<id>/painting.png; the card thumb is
            // skin_shipyard/<id>.webp (since the 2026-05 skin-images migration). Derive one from
            // the other. Skins without a painting 404 → handled by the fallback chain below.
            const paintingUrl = shipyardUrl
                ? shipyardUrl.replace(/\/skin_shipyard\/(\d+)\.webp$/, '/output_expressions/$1/painting.png')
                : IMG_FALLBACKS.CARD;
            const asmrUrl = skin['ASMR 일러'] || '';

            DOM.popup.image.src = '';
            DOM.popup.image.classList.add('loading');

            DOM.popup.skinName.textContent = skin['한글 함순이 + 스킨 이름'];
            DOM.popup.charName.textContent = skin['함순이 이름'];

            const characterName = encodeURIComponent(normalizeRomanNumerals(skin['함순이 이름']));
            const skinDisplayName = encodeURIComponent(skin['한글 함순이 + 스킨 이름']);
            // Link by stable gid (clientId = shipGroup*10 + skinIndex → gid = ⌊clientId/10⌋)
            // so the viewer resolves the exact ship even when the name has drifted across
            // data sources (the Admiral Hipper 럴/랄 bug). See skin.gid.js / reference_gid_linking.
            const gid = Math.floor(Number(skinId) / 10);
            const gidParam = Number.isFinite(gid) ? `&gid=${encodeURIComponent(gid)}` : '';
            DOM.popup.detailLink.href = resolveUrl(`skin/skin-detail-viewer/?character=${characterName}&skin=${skinDisplayName}${gidParam}`);

            DOM.popup.overlay.classList.add('visible');
            DOM.popup.overlay.setAttribute('aria-hidden', 'false');
            lockBodyScroll();

            DOM.popup.image.addEventListener('load', () => {
                if (gen === this._generation) DOM.popup.image.classList.remove('loading');
            }, { once: true });

            // painting.png has a transparent face hole — composite the skin's default
            // expression onto it (same machinery as the detail viewer). The shared manifest
            // loader runs on first open, never at page init. Falls through to the plain-URL
            // path below when the skin has no expression entry or compositing fails.
            const manifest = (await ensureExpressionManifest()) || {};
            if (gen !== this._generation) return; // superseded by a newer open()
            const manifestEntry = manifest[skinId];
            if (manifestEntry) {
                const composited = await composeDefaultPainting(skinId, manifestEntry);
                if (gen !== this._generation) return;
                if (composited) {
                    this._releaseComposite();
                    this._compositeUrl = composited;
                    DOM.popup.image.src = composited;
                    return;
                }
            }

            // No expression overlay (or it failed): show the plain painting, falling
            // back to the ASMR/shipyard art if it 404s.
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
            DOM.popup.image.src = paintingUrl;
        },

        close() {
            // Bump generation so any in-flight composite from open() aborts on its
            // gen guard instead of painting into the now-closed popup.
            this._generation++;
            DOM.popup.overlay.classList.remove('visible');
            DOM.popup.overlay.setAttribute('aria-hidden', 'true');
            unlockBodyScroll();
            if (this._errorHandler) {
                DOM.popup.image.removeEventListener('error', this._errorHandler);
                this._errorHandler = null;
            }
            DOM.popup.image.src = '';
            DOM.popup.image.classList.remove('loading');
            this._releaseComposite();
        },

        /** Free the composited painting's object URL (composeDefaultPainting's contract). */
        _releaseComposite() {
            if (!this._compositeUrl) return;
            URL.revokeObjectURL(this._compositeUrl);
            this._compositeUrl = null;
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
            openModal('cart-modal', { onOpen: m => m.setAttribute('aria-hidden', 'false') });
        },

        render() {
            const wantedSkins = allSkins.filter(s => collection.wanted.has(s['클뜯 id']));

            if (wantedSkins.length === 0) {
                createEmptyState(
                    DOM.cart.body,
                    '찜한 스킨이 없습니다',
                    [
                        document.createTextNode('스킨 카드의 '),
                        createIcon('fas fa-heart'),
                        document.createTextNode(' 버튼으로 찜해보세요!')
                    ]
                );
                DOM.cart.footer.style.display = 'none';
                return;
            }

            DOM.cart.footer.style.display = '';

            const groups = {};
            for (const skin of wantedSkins) {
                const tag = primaryTag(skin);
                (groups[tag] ||= []).push(skin);
            }

            const fragment = document.createDocumentFragment();

            for (const tagName of TAG_ORDER) {
                const skins = groups[tagName];
                if (!skins || skins.length === 0) continue;

                const group = document.createElement('div');
                group.className = 'cart-group';

                const header = document.createElement('div');
                header.className = 'cart-group-header';
                const tag = document.createElement('span');
                tag.className = 'cart-group-tag';
                tag.textContent = tagName;
                const count = document.createElement('span');
                count.className = 'cart-group-count';
                count.textContent = `${skins.length}개`;
                header.append(tag, count);
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
                        price.appendChild(createGemPrice(skin['재화']));
                    } else {
                        price.textContent = '가격 미정';
                    }

                    const actions = document.createElement('div');
                    actions.className = 'cart-item-actions';

                    const buyBtn = document.createElement('button');
                    buyBtn.type = 'button';
                    buyBtn.className = 'cart-item-buy';
                    buyBtn.title = '보유표시';
                    buyBtn.setAttribute('aria-label', '보유표시');
                    buyBtn.appendChild(createIcon('fas fa-check'));

                    const removeBtn = document.createElement('button');
                    removeBtn.type = 'button';
                    removeBtn.className = 'cart-item-remove';
                    removeBtn.title = '찜 해제';
                    removeBtn.setAttribute('aria-label', '찜 해제');
                    removeBtn.appendChild(createIcon('fas fa-times'));

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

            DOM.cart.body.replaceChildren(fragment);

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
            summaryTitle.className = 'share-section-title section-title section-title--sm';
            summaryTitle.append(
                createIcon('fas fa-heart'),
                document.createTextNode(` ${wantedSkins.length}개 — `),
                createGemIconImg(),
                document.createTextNode(` ${totalGems.toLocaleString()} (약 ${totalKrw.toLocaleString()}원 / ${trucks.toFixed(1)} 깡트럭)`)
            );
            view.appendChild(summaryTitle);

            // Grid
            const grid = document.createElement('div');
            grid.className = 'share-grid card-grid';
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

            DOM.cart.body.replaceChildren(view);
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
            openModal('owned-modal', { onOpen: m => m.setAttribute('aria-hidden', 'false') });
        },

        render() {
            const ownedSkins = allSkins.filter(s => collection.owned.has(s['클뜯 id']));

            if (ownedSkins.length === 0) {
                createEmptyState(
                    DOM.owned.body,
                    '보유 스킨이 없습니다',
                    [
                        document.createTextNode('스킨 카드의 '),
                        createIcon('fas fa-check'),
                        document.createTextNode(' 버튼으로 보유 표시해보세요!')
                    ]
                );
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
                title.className = 'share-section-title section-title section-title--sm';
                title.textContent = `${groupName} (${skins.length}개)`;
                section.appendChild(title);

                const grid = document.createElement('div');
                grid.className = 'share-grid card-grid';

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

            DOM.owned.body.replaceChildren(fragment);

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
            const groups = new Map();
            for (const skin of skins) {
                const tag = primaryTag(skin);
                if (!groups.has(tag)) groups.set(tag, []);
                groups.get(tag).push(skin);
            }
            return TAG_ORDER.filter(tag => groups.has(tag)).map(tag => [tag, groups.get(tag)]);
        },

        setGroupMode(mode) {
            this._groupMode = mode;
            DOM.owned.toggleBtns.forEach(btn => {
                const isActive = btn.dataset.group === mode;
                btn.classList.toggle('is-active', isActive);
                btn.setAttribute('aria-pressed', String(isActive));
            });
            this.render();
        }
    };

    // ===== Renderer =====
    const Renderer = {
        _createSkinBox(skin) {
            const skinId = skin['클뜯 id'];

            const wrapper = document.createElement('div');
            wrapper.className = 'skin-box-link';

            const skinBox = document.createElement('div');
            skinBox.className = 'skin-box';
            skinBox.dataset.skinId = skinId;
            skinBox.setAttribute('role', 'button');
            skinBox.tabIndex = 0;
            skinBox.setAttribute('aria-label', `${skin['한글 함순이 + 스킨 이름'] || skin['함순이 이름']} 상세 이미지 보기`);

            // Apply owned/wanted state
            if (collection.owned.has(skinId)) skinBox.classList.add('is-owned');
            if (collection.wanted.has(skinId)) skinBox.classList.add('is-wanted');

            const imageWrapper = document.createElement('div');
            imageWrapper.className = 'skin-image-wrapper';

            // Action buttons (no per-card listeners — handled by event delegation)
            const actions = document.createElement('div');
            actions.className = 'skin-actions';

            const isOwned = collection.owned.has(skinId);

            const ownedBtn = createIconButton(
                'skin-action-btn owned-btn' + (isOwned ? ' active' : ''),
                'fas fa-check',
                '보유중 표시'
            );
            const wantedBtn = createIconButton(
                'skin-action-btn wanted-btn'
                    + (collection.wanted.has(skinId) ? ' active' : '')
                    + (isOwned ? ' disabled' : ''),
                'fas fa-heart',
                isOwned ? '보유중인 스킨' : '찜하기'
            );

            ownedBtn.setAttribute('aria-pressed', String(isOwned));
            wantedBtn.setAttribute('aria-pressed', String(collection.wanted.has(skinId)));
            wantedBtn.disabled = isOwned;

            actions.appendChild(ownedBtn);
            actions.appendChild(wantedBtn);
            imageWrapper.appendChild(actions);

            if (skin.isSold) {
                const badge = document.createElement('div');
                badge.className = 'badge badge--success new-badge';
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

            const releaseDate = formatReleaseDate(releaseDates[String(skinId)]);
            const skinInfo = document.createElement('div');
            skinInfo.className = 'skin-info';

            const title = document.createElement('h3');
            title.textContent = skinOnlyName || charName;
            skinInfo.appendChild(title);

            if (skinOnlyName) {
                const charChip = document.createElement('div');
                charChip.className = 'badge badge--info char-name-chip';
                charChip.title = charName;
                charChip.textContent = charName;
                skinInfo.appendChild(charChip);
            }

            skinInfo.appendChild(createInfoLine('타입:', skin['스킨 타입 - 한글'] || '기본'));
            skinInfo.appendChild(createInfoLine('태그:', skin['스킨 태그'] || '없음'));
            skinInfo.appendChild(createInfoLine('진영:', skin['진영'] || '없음'));
            skinInfo.appendChild(createInfoLine('레어도:', skin['레어도'] || '없음'));
            skinInfo.appendChild(createInfoLine('가격:', skin['재화'] ? createGemPrice(skin['재화']) : 'N/A'));
            skinInfo.appendChild(createInfoLine('기간:', skin['기간'] || '정보 없음'));
            if (releaseDate) skinInfo.appendChild(createInfoLine('출시:', releaseDate));

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
         * Categorize every skin and populate skinCardMap. `wrapper` stays null
         * until ChunkController appends the entry — _categorizeSkin also stamps
         * `skin.isSold`, which FilterEngine needs for every record, but the card
         * DOM is only ever needed for what is on screen.
         */
        buildAll(skins) {
            this._today = new Date();
            this._today.setHours(0, 0, 0, 0);

            for (const skin of skins) {
                const category = this._categorizeSkin(skin);
                skinCardMap.set(skin['클뜯 id'], { wrapper: null, category, skin });
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

    const handleContainerKeydown = (e) => {
        if (e.target.closest('button')) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;

        const card = e.target.closest('.skin-box');
        if (!card) return;

        e.preventDefault();
        const skinId = parseInt(card.dataset.skinId);
        const skin = skinById.get(skinId);
        if (skin) Lightbox.open(skin);
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
            const isVisible = DOM.filterContainer.classList.toggle('visible');
            DOM.buttons.filterToggle.classList.toggle('active', isVisible);
            DOM.buttons.filterToggle.setAttribute('aria-expanded', String(isVisible));
        }
    };

    // ===== Debounced/Throttled Functions =====
    const debouncedFilterUpdate = debounce(() => {
        FilterEngine.apply();
        URLState.update();
    }, DEBOUNCE_DELAY);

    // ===== Data Initialization =====
    // Status goes to #list-status, not the four section containers: those boot
    // `.hidden` for CLS, so anything rendered inside them is invisible.
    isLoading = true;
    loadPageData(
        () => Promise.all([
            fetchJSONWithCache('data/skin/skin_voiceline_data_subset.json'),
            loadReleaseDates(),
        ]),
        document.getElementById('list-status'),
        { contextLabel: 'Skin list', loadingMessage: '데이터 불러오는 중...' },
    ).then(async (result) => {
        if (!result) return;
        const [skinJson, releaseDateJson] = result;
        allSkins = skinJson;
        releaseDates = releaseDateJson || {};
        isLoading = false;

        // Build ID→skin lookup map
        for (const skin of allSkins) {
            skinById.set(skin['클뜯 id'], skin);
        }

        // Create all card wrappers (not yet in DOM)
        Renderer.buildAll(allSkins);

        // Initialize chunked rendering
        ChunkController.init(Object.keys(DOM.sections));

        const uniqueNames = [...new Set(allSkins.map(skin => skin['한글 함순이 + 스킨 이름']))].sort();
        await ensureFuse();
        fuse = createSearchIndex(uniqueNames.map(name => ({ name })), fuseOptions);

        // Initialize cart badge
        CartManager.updateBadge();
        OwnedShowcase.updateBadge();

        URLState.apply();
    });

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

    document.addEventListener("click", handleDocumentClick);
    window.addEventListener('popstate', URLState.apply);
    // Cross-tab collection sync is wired by collectionStore (syncedStorage).

    // Event delegation on skin card containers (4 listeners instead of ~9000)
    Object.values(DOM.containers).forEach(c => c.addEventListener('click', handleContainerClick));
    Object.values(DOM.containers).forEach(c => c.addEventListener('keydown', handleContainerKeydown));

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
        closeOnBackdrop: true,
        restoreFocus: true,
        setAriaHidden: false,
        onClose: (modal) => modal.setAttribute('aria-hidden', 'true')
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
        closeOnBackdrop: true,
        restoreFocus: true,
        setAriaHidden: false,
        onClose: (modal) => modal.setAttribute('aria-hidden', 'true')
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
