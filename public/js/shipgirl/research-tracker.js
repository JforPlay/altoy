/**
 * research-tracker.js
 * Fleet tech point tracker for research ship unlock requirements.
 * Displays permanent-acquisition ships by faction, tracks get/level/upgrade progress,
 * and shows research ship unlock progress bars.
 * Shares progress with shipgirl-tracker.js via localStorage (SAVE_KEY = 'shipgirlTrackerProgress').
 * The storage event keeps both pages in sync across tabs without circular triggering.
 */

import { fetchJSONWithCache, createImg, IMG_FALLBACKS, createSearchIndex, ensureFuse, debounce, syncedStorage, RARITY_ORDER as rarityOrder, renderStatus } from '../utils.js';
import { ShipgirlTrackerUtils } from './shipgirl-tracker-utils.js';

const { parseProgress } = ShipgirlTrackerUtils;

document.addEventListener('DOMContentLoaded', () => {
    const SAVE_KEY = 'shipgirlTrackerProgress';
    const PINNED_KEY = 'researchTrackerPinned';

    // buildNationSearchIndex below is called from sync render paths. Kick off
    // the lazy Fuse load now so the index is ready by the time the user opens
    // a nation tab. If Fuse hasn't loaded yet, createSearchIndex returns null
    // and the quick-add widget shows no results until the next user input.
    ensureFuse();

    // Descriptions that are NOT map-drops or archive-drops but still grant the ship permanently.
    // Map drops and archive drops are detected via ship_info_lite.json and map_data_full.json
    // (same lookup path as the map viewer) rather than by parsing description strings.
    const NON_DROP_PERMANENT_PATTERNS = [
        /^소형함 건조/,
        /^중형함 건조/,
        /^대형함 건조/,
        /^특형함 건조/,
        /^훈장/,
        /^코어/,
        /^군수 상점/,
        /^원형 상점/,
        /^함대 상점/,
        /^연습 상점/,
        /^지원 신청/,
        /^특별 ?보급/,
        /^상설 UR/,
        /^UR Exchange/,
        /^상점의 대함대/,
        /^주간 임무/,
        /^도감 업적/,
        /^출석 스탬프/,
        /^히든 임무/,
        /^연구 ?도크/,
    ];

    const SHOP_PATTERNS = [
        /^원형 상점 교환/,
        /^군수 상점 교환/,
        /^상점의 대함대 보급에서 획득/,
        /^코어 상점/,
        /^코어 교환/,
        /^특별 ?보급/,
        /^함대 상점 교환/,
        /^훈장 상점 교환/,
        /^훈장 교환/,
    ];

    // NOTE: the 상시 건조 group is driven by buildPoolGids (MrLar), not this test.
    // BUILD_TEST now only guards OTHER_TEST so a construction-described ship is never
    // mislabeled as 기타 획득.
    const BUILD_TEST = d => /건조/.test(d) && !/한정/.test(d) && !/이벤트/.test(d) && !/기간/.test(d);
    const SHOP_TEST = d => SHOP_PATTERNS.some(p => p.test(d));
    const OTHER_TEST = d => {
        if (BUILD_TEST(d)) return false;
        if (SHOP_TEST(d)) return false;
        return NON_DROP_PERMANENT_PATTERNS.some(p => p.test(d));
    };

    // Map a description prefix to the shop name shown under the ship card.
    // Order matters: more specific patterns first so "훈장 상점 교환" takes precedence
    // over a hypothetical bare "훈장" prefix. Each rule must cover at least one entry
    // in SHOP_PATTERNS so every shop-group ship resolves to a label.
    //
    // Hardcoded rollups:
    //   군수 상점  + 특별 보급       → 연습전 상점 (both use 공훈치 from 연습전/PvP)
    //   함대 상점  + 대함대 보급     → 대함대 상점 (unified guild/grand-fleet storefront)
    const SHOP_LABEL_RULES = [
        { pattern: /^원형 상점/, label: '원형 상점' },
        { pattern: /^군수 상점/, label: '연습전 상점' },
        { pattern: /^코어/, label: '코어 상점' },
        { pattern: /^함대 상점/, label: '대함대 상점' },
        { pattern: /^훈장 상점/, label: '훈장 상점' },
        { pattern: /^훈장 교환/, label: '훈장 상점' },
        { pattern: /^상점의 대함대/, label: '대함대 상점' },
        { pattern: /^특별 ?보급/, label: '연습전 상점' },
    ];

    function getShopLabelForShip(ship) {
        const labels = new Set();
        for (const d of ship.description || []) {
            for (const rule of SHOP_LABEL_RULES) {
                if (rule.pattern.test(d)) {
                    labels.add(rule.label);
                    break;
                }
            }
        }
        return [...labels].join(', ');
    }

    const FACTION_ABBR = {
        '로열 네이비': 'HMS',
        '사쿠라 엠파이어': 'IJN',
        '메탈 블러드': 'KMS',
        '이글 유니온': 'USS',
        '이스트 글림': 'ROC',
        '사르데냐': 'RN',
        '아이리스 리브레': 'FFNF',
        '비시아 성좌': 'MNF',
        '노스 유니온': 'SN',
    };

    // Single-assignment priority order: map drops → archive drops → build → shop → other.
    // Ships are grouped in this order; the first matching group wins, so a ship that drops in
    // a map stage is never also shown under build/shop even if its description mentions them.
    const SOURCE_GROUPS = [
        {
            key: 'map',
            label: '해역 드랍',
            icon: 'sailing',
            test: ship => mapDropGids.has(ship.gid),
        },
        {
            key: 'archive',
            label: '작전문서 드랍',
            icon: 'menu_book',
            test: ship => archiveDropGids.has(ship.gid),
        },
        {
            // 상시 건조 membership comes from MrLar's live build-pool flags
            // (buildPoolGids), NOT the ship_data_group description. The game's
            // description is frozen at a ship's debut event, so it misses every
            // 상시편입 ship (event-debut → later added to permanent construction,
            // e.g. 지엔우/무사시/로마) and wrongly keeps limited-event builds.
            key: 'build',
            label: '상시 건조',
            icon: 'construction',
            test: ship => buildPoolGids.has(ship.gid),
        },
        {
            key: 'shop',
            label: '상점 교환',
            icon: 'shopping_cart',
            test: ship => (ship.description || []).some(SHOP_TEST),
        },
        {
            key: 'other',
            label: '기타 획득',
            icon: 'storefront',
            test: ship => (ship.description || []).some(OTHER_TEST),
        },
    ];

    let shipData = null;
    let nationalityData = null;
    let shipTypeData = null;
    let fleetTechGoalData = null;
    // Set<string> gids + parallel Map<gid, shortLabel>. Built once in loadData() from
    // ship_info_lite.json and map_data_full.json (same authoritative sources the map viewer
    // uses) so drop-based grouping no longer depends on acquireTip description strings.
    // The label is a brief hint rendered under the ship name — e.g. "1-4, 3-2" for map drops,
    // "홍염의 방문자" for archive drops.
    let mapDropGids = new Set();
    let archiveDropGids = new Set();
    // 상시 건조 (permanent construction) pool, sourced from MrLar's light/heavy/special
    // flags in ship_info_lite.json — see the build group in SOURCE_GROUPS for why the
    // game's ship_data_group description can't drive this.
    const buildPoolGids = new Set();
    const mapDropLabel = new Map();
    const archiveDropLabel = new Map();
    const shopDropLabel = new Map();

    const MAX_MAP_STAGES_IN_LABEL = 3;
    const MAX_ARCHIVE_EVENTS_IN_LABEL = 2;
    let progress = {};
    let pinned = new Set();
    let activeFaction = null;
    const activeRarities = new Set(['ur', 'ssr', 'sr', 'r', 'n']);
    const activeStatuses = new Set(['missing', 'owned']);

    const tabsContainer = document.getElementById('faction-tabs');
    const sidebarBody = document.getElementById('sidebar-content');
    const rightPane = document.getElementById('right-pane');

    // SAVE_KEY is shared with shipgirl-tracker.js; both pages must share the
    // same parse contract (parseProgress) so cross-tab writes round-trip cleanly.
    const progressStore = syncedStorage(SAVE_KEY, {
        parse: parseProgress,
        onRemoteChange: (next) => {
            progress = next;
            if (activeFaction) {
                applyProgress();
                updateSidebarOnChange();
                refreshGroupHeaders();
                applyFilters();
            }
        },
    });

    const pinnedStore = syncedStorage(PINNED_KEY, {
        parse: (v) => new Set(Array.isArray(v) ? v : []),
        onRemoteChange: (next) => {
            pinned = next;
            if (activeFaction) renderFactionContent(activeFaction);
        },
    });

    function showLoadError() {
        renderStatus(sidebarBody, '데이터를 불러오는 데 실패했습니다.', 'error');
        renderStatus(rightPane, '데이터를 불러오는 데 실패했습니다.', 'error');
    }

    /**
     * Load all data sources in parallel and build authoritative drop gid sets.
     *
     * Map drops come from ship_info_lite.json (each ship has a `maps` array of
     * main-story areas; any non-empty entry means the ship drops somewhere).
     * The 상시 건조 build pool also comes from ship_info_lite.json via MrLar's
     * light/heavy/special flags (→ buildPoolGids).
     * Archive drops come from map_data_full.json archive chapters (keys prefixed
     * "a_"), using `ship_drops_archive` (ship.id) and `special_drop` (type 4).
     * Both sources use the same approach as the map viewer in map.data.js.
     */
    async function loadData() {
        try {
            let shipInfoLite, mapDataFull;
            [shipData, nationalityData, shipTypeData, fleetTechGoalData, shipInfoLite, mapDataFull] = await Promise.all([
                fetchJSONWithCache('data/ship_group_data.json'),
                fetchJSONWithCache('data/mapping/nationality_mapping.json'),
                fetchJSONWithCache('data/mapping/ship_type_mapping.json'),
                fetchJSONWithCache('data/shipgirl/fleet_tech_goal.json'),
                fetchJSONWithCache('data/ship_info_lite.json'),
                fetchJSONWithCache('data/maps/map_data_full.json'),
            ]);

            // ship_info_lite.json is an array. Each entry has numeric id + gid.
            // Build the id→gid reverse lookup, the map-drop gid set, and the
            // per-gid stage label ("1-4, 3-2, …") in one pass.
            const idToGid = new Map();
            for (const ship of shipInfoLite || []) {
                if (ship.gid != null) idToGid.set(ship.id, String(ship.gid));
                // 상시 건조 pool: MrLar light/heavy/special. Must run before the maps
                // early-continue below, since construction-only ships have empty maps.
                if (ship.gid != null && (ship.light || ship.heavy || ship.special)) {
                    buildPoolGids.add(String(ship.gid));
                }
                const maps = ship.maps;
                if (!Array.isArray(maps) || ship.gid == null) continue;
                const stages = [];
                maps.forEach((area, chapterIdx) => {
                    if (!Array.isArray(area) || area.length === 0) return;
                    const chapter = chapterIdx + 1;
                    for (const d of area) stages.push(`${chapter}-${d.map}`);
                });
                if (stages.length > 0) {
                    const gidStr = String(ship.gid);
                    mapDropGids.add(gidStr);
                    const label = stages.length <= MAX_MAP_STAGES_IN_LABEL
                        ? stages.join(', ')
                        : `${stages.slice(0, MAX_MAP_STAGES_IN_LABEL).join(', ')} +${stages.length - MAX_MAP_STAGES_IN_LABEL}`;
                    mapDropLabel.set(gidStr, label);
                }
            }

            // Archive drops: iterate only `a_`-prefixed chapters in map_data_full.
            // ship_drops_archive entries reference ship.id (not gid), so translate via idToGid.
            // special_drop may be either a ship.id or a gid (matching map.detail.js fallback).
            // Collect per-gid event name set so we can render a short list under the ship name.
            const gidToEvents = new Map();
            const addEvent = (gid, eventName) => {
                if (!eventName) return;
                if (!gidToEvents.has(gid)) gidToEvents.set(gid, new Set());
                gidToEvents.get(gid).add(eventName);
            };
            if (mapDataFull) {
                for (const [key, chapter] of Object.entries(mapDataFull)) {
                    if (!key.startsWith('a_')) continue;
                    const eventName = chapter.event_name || '';
                    const drops = chapter.ship_drops_archive;
                    if (Array.isArray(drops)) {
                        for (const drop of drops) {
                            const gid = idToGid.get(drop.id);
                            if (!gid) continue;
                            archiveDropGids.add(gid);
                            addEvent(gid, eventName);
                        }
                    }
                    const sd = chapter.special_drop;
                    if (sd && sd.type === 4 && sd.id != null) {
                        let gidStr = String(sd.id);
                        if (!shipData[gidStr]) {
                            const viaId = idToGid.get(sd.id);
                            gidStr = viaId || null;
                        }
                        if (gidStr) {
                            archiveDropGids.add(gidStr);
                            addEvent(gidStr, eventName);
                        }
                    }
                }
            }
            for (const [gid, events] of gidToEvents) {
                const arr = [...events];
                const label = arr.length <= MAX_ARCHIVE_EVENTS_IN_LABEL
                    ? arr.join(', ')
                    : `${arr.slice(0, MAX_ARCHIVE_EVENTS_IN_LABEL).join(', ')} +${arr.length - MAX_ARCHIVE_EVENTS_IN_LABEL}`;
                archiveDropLabel.set(gid, label);
            }

            // Shop labels are derived from each ship's description strings (no map data needed).
            // We compute them for every ship, but they're only displayed by createShipRow when
            // the ship doesn't have a higher-priority map or archive label.
            for (const [gid, ship] of Object.entries(shipData)) {
                const label = getShopLabelForShip(ship);
                if (label) shopDropLabel.set(gid, label);
            }

            progress = progressStore.load();
            pinned = pinnedStore.load();
            init();
        } catch (error) {
            console.error('Failed to load data:', error);
            showLoadError();
        }
    }

    /**
     * Returns true if the ship can be obtained via any permanent (non-limited) source.
     * Delegates to SOURCE_GROUPS so the grouping logic and the permanence check can never
     * drift apart — if a ship qualifies for any group, it is permanent.
     */
    function isPermanentShip(ship) {
        return SOURCE_GROUPS.some(sg => sg.test(ship));
    }

    /**
     * Ships that grant zero fleet tech points (e.g. 부린, 꼬마 chibi ships, μ장비 retrofits)
     * are hidden across the tracker — they're meaningless in a fleet-tech-points UI.
     */
    function hasTechPoints(ship) {
        return ((ship.pt_get || 0) + (ship.pt_level || 0) + (ship.pt_upgrage || 0)) > 0;
    }

    /**
     * Calculate earned vs. total fleet tech points for a single ship.
     * Progress bitmask: bit 0 = get (+pt_get), bit 1 = level (+pt_level), bit 2 = upgrade (+pt_upgrage).
     */
    function getShipTechPoints(shipId) {
        const state = progress[shipId] || 0;
        const ship = shipData[shipId];
        if (!ship) return { earned: 0, total: 0 };
        const ptGet = ship.pt_get || 0;
        const ptLevel = ship.pt_level || 0;
        const ptUpgrade = ship.pt_upgrage || 0;
        const earned = ((state & 1) ? ptGet : 0) + ((state & 2) ? ptLevel : 0) + ((state & 4) ? ptUpgrade : 0);
        return { earned, total: ptGet + ptLevel + ptUpgrade };
    }

    function getShipIconByName(name) {
        for (const ship of Object.values(shipData)) {
            if (ship.name === name) return ship.icon || null;
        }
        return null;
    }

    /**
     * Build a Map of faction name → Set of research ship names that require that faction.
     * Drives the tab order and content for the faction selector.
     */
    function getRequiredFactions() {
        const factions = new Map();
        for (const [name, goal] of Object.entries(fleetTechGoalData)) {
            for (let i = 1; i <= 3; i++) {
                const factionName = goal[`unlock_${i}`];
                if (factionName) {
                    if (!factions.has(factionName)) factions.set(factionName, new Set());
                    factions.get(factionName).add(name);
                }
            }
        }
        return factions;
    }

    // Memoized nationality name → ID lookup (built once in init)
    let nationalityNameToId = null;
    function getNationalityIdByName(name) {
        if (!nationalityNameToId) {
            nationalityNameToId = {};
            for (const [id, data] of Object.entries(nationalityData)) {
                nationalityNameToId[data.name] = parseInt(id, 10);
            }
        }
        return nationalityNameToId[name] ?? null;
    }

    function getPermanentShipsForNationality(natId) {
        const ships = [];
        for (const [gid, ship] of Object.entries(shipData)) {
            if (ship.nationality !== natId) continue;
            if (!hasTechPoints(ship)) continue;
            // SOURCE_GROUPS tests reference ship.gid for mapDropGids/archiveDropGids lookup,
            // so attach the gid before the permanence check.
            const withGid = { ...ship, gid };
            if (isPermanentShip(withGid)) ships.push(withGid);
        }
        return ships;
    }

    function getFactionTotalPoints(natId) {
        let earned = 0;
        let total = 0;
        for (const [gid, ship] of Object.entries(shipData)) {
            if (ship.nationality !== natId) continue;
            const pts = getShipTechPoints(gid);
            earned += pts.earned;
            total += pts.total;
        }
        return { earned, total };
    }

    /**
     * Count owned vs total ships of a nation by position (전열/후열/잠수).
     * Returns { '전열': {owned, total}, '후열': {owned, total}, '잠수': {owned, total} }.
     * "owned" means bit 0 of progress is set. "total" includes ALL ships (event/limited too)
     * so owned can never exceed total.
     */
    function buildPositionCounts(natId) {
        const counts = {
            '전열': { owned: 0, total: 0 },
            '후열': { owned: 0, total: 0 },
            '잠수': { owned: 0, total: 0 },
        };
        for (const [gid, ship] of Object.entries(shipData)) {
            if (ship.nationality !== natId) continue;
            const typeInfo = shipTypeData[ship.type];
            const position = typeInfo?.position;
            if (!position || !(position in counts)) continue;
            counts[position].total += 1;
            if (progress[gid] & 1) counts[position].owned += 1;
        }
        return counts;
    }

    /**
     * Build a search index of all ships belonging to a nation.
     * Each entry is { gid, name, rarity, typeName, position, icon, isPermanent }.
     *
     * Returns a wrapper with a `search(query)` method that mirrors Fuse's
     * `[{ item }]` shape. If Fuse.js has not finished loading yet, the wrapper
     * falls back to substring matching and lazily swaps in the real Fuse index
     * once it resolves — so `renderQuickAdd` callers never see a null index
     * even if the user opens a tab before the deferred Fuse fetch completes.
     */
    function buildNationSearchIndex(natId) {
        const entries = [];
        for (const [gid, ship] of Object.entries(shipData)) {
            if (ship.nationality !== natId) continue;
            if (!hasTechPoints(ship)) continue;
            const typeInfo = shipTypeData[ship.type];
            entries.push({
                gid,
                name: ship.name,
                rarity: ship.rarity,
                typeName: typeInfo?.type_name || '',
                position: typeInfo?.position || '',
                icon: ship.icon,
                isPermanent: isPermanentShip({ ...ship, gid }),
            });
        }

        const indexOptions = { keys: ['name', 'typeName'], threshold: 0.3 };
        let fuseIndex = createSearchIndex(entries, indexOptions);
        if (!fuseIndex) {
            ensureFuse().then(() => {
                fuseIndex = createSearchIndex(entries, indexOptions);
            });
        }

        return {
            search(query) {
                if (fuseIndex) return fuseIndex.search(query);
                const needle = String(query || '').toLowerCase();
                if (!needle) return [];
                return entries
                    .filter(e =>
                        (e.name && e.name.toLowerCase().includes(needle)) ||
                        (e.typeName && e.typeName.toLowerCase().includes(needle))
                    )
                    .map(item => ({ item }));
            },
        };
    }

    /**
     * Render the quick-add search widget.
     * Search across all ships of the active nation. Clicking "+ 추가" marks 입수.
     * Ships that already have progress show a muted "이미 체크됨" label.
     */
    function renderQuickAdd(natId) {
        const wrap = document.createElement('div');
        wrap.className = 'rt-quickadd';
        wrap.innerHTML = `
            <div class="rt-section-title">보유 함순이 빠른 추가</div>
            <input type="search" class="rt-quickadd-input" placeholder="함순이 이름 검색…" autocomplete="off">
            <div class="rt-quickadd-results"></div>
            <p class="rt-quickadd-hint">이벤트·한정 함순이도 검색됩니다.<br>추가하면 오른쪽에 표시됩니다.</p>
        `;

        const input = wrap.querySelector('.rt-quickadd-input');
        const results = wrap.querySelector('.rt-quickadd-results');
        const index = buildNationSearchIndex(natId);

        const renderMatches = (query) => {
            results.innerHTML = '';
            if (!query || query.length < 1) return;
            const matches = index.search(query).slice(0, 8);
            if (matches.length === 0) {
                renderStatus(results, '일치하는 함순이가 없습니다.', 'empty', { compact: true });
                return;
            }
            for (const { item } of matches) {
                const row = document.createElement('div');
                row.className = 'rt-quickadd-match';
                const isPinned = pinned.has(item.gid);
                row.innerHTML = `
                    ${createImg(item.icon, item.name, { className: 'rt-quickadd-icon', fallback: IMG_FALLBACKS.CARD })}
                    <div class="rt-quickadd-info">
                        <span class="rt-quickadd-name">${item.name}</span>
                        <span class="rt-quickadd-meta">${item.position || ''} · ${item.rarity}</span>
                    </div>
                    ${isPinned
                        ? '<span class="rt-quickadd-pinned">목록에 있음</span>'
                        : `<button class="rt-quickadd-add" data-gid="${item.gid}">+ 추가</button>`}
                `;
                results.appendChild(row);
            }
        };

        input.addEventListener('input', debounce((e) => renderMatches(e.target.value.trim()), 150));
        results.addEventListener('click', (e) => {
            const btn = e.target.closest('.rt-quickadd-add');
            if (!btn) return;
            const gid = btn.dataset.gid;
            pinned.add(gid);
            savePinned();
            // Convenience: also mark 입수 since the typical case is "I own this ship, pin + track it".
            // Users can still uncheck 체 afterward if they want to pin without marking owned.
            progress[gid] = (progress[gid] || 0) | 1;
            saveProgress();
            input.value = '';
            results.innerHTML = '';
            if (activeFaction) renderFactionContent(activeFaction);
        });

        return wrap;
    }

    function init() {
        const factions = getRequiredFactions();
        renderTabs(factions);
        const firstFaction = factions.keys().next().value;
        if (firstFaction) switchTab(firstFaction);
    }

    function renderTabs(factions) {
        tabsContainer.innerHTML = '';
        for (const [factionName] of factions) {
            const natId = getNationalityIdByName(factionName);
            const natInfo = natId !== null ? nationalityData[natId] : null;
            const abbr = FACTION_ABBR[factionName] || factionName;
            const tab = document.createElement('button');
            tab.className = 'rt-tab';
            tab.type = 'button';
            tab.dataset.faction = factionName;
            tab.title = factionName;
            tab.innerHTML = natInfo
                ? `<img src="${natInfo.image}" alt="" class="rt-tab-icon"><span class="rt-tab-abbr">${abbr}</span>`
                : `<span class="rt-tab-abbr">${abbr}</span>`;
            tab.addEventListener('click', () => switchTab(factionName));
            tabsContainer.appendChild(tab);
        }
    }

    function switchTab(factionName) {
        activeFaction = factionName;
        tabsContainer.querySelectorAll('.rt-tab').forEach(t => {
            const isActive = t.dataset.faction === factionName;
            t.classList.toggle('active', isActive);
            t.setAttribute('aria-pressed', String(isActive));
        });
        renderFactionContent(factionName);
    }

    /**
     * Render the full panel for a faction: sidebar (summary + research ships)
     * and right pane (filter bar + source groups).
     */
    function renderFactionContent(factionName) {
        sidebarBody.innerHTML = '';
        rightPane.innerHTML = '';
        const natId = getNationalityIdByName(factionName);
        if (natId === null) {
            renderStatus(rightPane, '진영 정보를 찾을 수 없습니다.', 'error');
            return;
        }

        // Sidebar: summary + research list + quick-add
        const sidebarFragment = document.createDocumentFragment();
        sidebarFragment.appendChild(renderFactionSummary(factionName, natId));
        sidebarFragment.appendChild(renderResearchShips(factionName));
        sidebarFragment.appendChild(renderQuickAdd(natId));
        sidebarBody.appendChild(sidebarFragment);

        // Right pane: filter bar + source groups
        const rightFragment = document.createDocumentFragment();
        rightFragment.appendChild(renderFilterBar());
        rightFragment.appendChild(renderSourceGroups(natId));
        rightPane.appendChild(rightFragment);

        applyProgress();
        applyFilters();
    }

    function renderFilterBar() {
        const bar = document.createElement('div');
        bar.className = 'rt-filters';

        const rarities = ['ur', 'ssr', 'sr', 'r', 'n'];
        const rarityBtns = rarities.map(r => {
            const active = activeRarities.has(r) ? ' active' : '';
            const pressed = activeRarities.has(r) ? 'true' : 'false';
            return `<button type="button" class="rt-rarity-btn${active}" data-rarity="${r}" aria-pressed="${pressed}">${r.toUpperCase()}</button>`;
        }).join('');

        const statuses = [
            { key: 'missing', label: '미획득' },
            { key: 'owned', label: '획득' },
        ];
        const statusBtns = statuses.map(s => {
            const active = activeStatuses.has(s.key) ? ' active' : '';
            const pressed = activeStatuses.has(s.key) ? 'true' : 'false';
            return `<button type="button" class="rt-status-btn${active}" data-status="${s.key}" aria-pressed="${pressed}">${s.label}</button>`;
        }).join('');

        bar.innerHTML = `
            <div class="rt-filter-group">${rarityBtns}</div>
            <div class="rt-filter-sep"></div>
            <div class="rt-filter-group">${statusBtns}</div>
            <span class="rt-filter-hint">체크해제로 필터</span>
        `;

        bar.addEventListener('click', (e) => {
            const rarityBtn = e.target.closest('.rt-rarity-btn');
            const statusBtn = e.target.closest('.rt-status-btn');
            if (rarityBtn) {
                const rarity = rarityBtn.dataset.rarity;
                rarityBtn.classList.toggle('active');
                if (activeRarities.has(rarity)) activeRarities.delete(rarity);
                else activeRarities.add(rarity);
                rarityBtn.setAttribute('aria-pressed', String(activeRarities.has(rarity)));
                applyFilters();
            }
            if (statusBtn) {
                const status = statusBtn.dataset.status;
                statusBtn.classList.toggle('active');
                if (activeStatuses.has(status)) activeStatuses.delete(status);
                else activeStatuses.add(status);
                statusBtn.setAttribute('aria-pressed', String(activeStatuses.has(status)));
                applyFilters();
            }
        });

        return bar;
    }

    /**
     * Render the progress bar header for a faction.
     * Markers on the bar indicate each research ship's required score; the bar fills to the next goal.
     */
    function renderFactionSummary(factionName, natId) {
        const { earned, total } = getFactionTotalPoints(natId);
        const natInfo = nationalityData[natId];

        const researchShips = [];
        for (const [name, goal] of Object.entries(fleetTechGoalData)) {
            for (let i = 1; i <= 3; i++) {
                if (goal[`unlock_${i}`] === factionName && goal[`unlock_${i}_req_type`] === '점수') {
                    researchShips.push({
                        name,
                        required: parseInt(goal[`unlock_${i}_req_type_value`], 10),
                        rarity: goal.rarity_type
                    });
                }
            }
        }
        researchShips.sort((a, b) => a.required - b.required);

        const nextGoal = researchShips.find(r => r.required > earned);
        const maxGoal = researchShips.length > 0 ? researchShips[researchShips.length - 1].required : total;
        const barMax = nextGoal ? nextGoal.required : maxGoal;
        const percentage = barMax > 0 ? Math.min(100, (earned / barMax) * 100) : 0;

        const section = document.createElement('div');
        section.className = 'rt-summary';
        section.innerHTML = `
            <div class="rt-summary-header">
                ${natInfo ? `<img src="${natInfo.image}" alt="${factionName}" class="rt-summary-icon">` : ''}
                <div class="rt-summary-info">
                    <h2>${factionName}</h2>
                    <span class="rt-summary-points">${earned} / ${barMax} pts${nextGoal ? ` (다음: ${nextGoal.name})` : ' (최대)'}</span>
                </div>
            </div>
            <div class="rt-progress-bar">
                <div class="rt-progress-fill" style="width: ${percentage}%"></div>
                ${researchShips.map(r => {
                    const pos = barMax > 0 ? Math.min(100, (r.required / barMax) * 100) : 0;
                    const unlocked = earned >= r.required;
                    return `<div class="rt-progress-marker ${unlocked ? 'unlocked' : ''}" style="left: ${pos}%" title="${r.name} (${r.required}pts)"></div>`;
                }).join('')}
            </div>
        `;

        return section;
    }

    /**
     * Render the research ship list for a faction as compact rows.
     * Each row shows icon, name, a chip per requirement, and a ✓ when all are met.
     * Requirement chips cover both score (점수) and position (전열/후열/잠수) requirements.
     */
    function renderResearchShips(factionName) {
        const section = document.createElement('div');
        section.className = 'rt-research-panel';

        const ships = [];
        for (const [name, goal] of Object.entries(fleetTechGoalData)) {
            let matchesFaction = false;
            for (let i = 1; i <= 3; i++) {
                if (goal[`unlock_${i}`] === factionName) {
                    matchesFaction = true;
                    break;
                }
            }
            if (!matchesFaction) continue;

            const requirements = [];
            for (let i = 1; i <= 3; i++) {
                if (goal[`unlock_${i}`]) {
                    requirements.push({
                        faction: goal[`unlock_${i}`],
                        type: goal[`unlock_${i}_req_type`],
                        value: goal[`unlock_${i}_req_type_value`],
                    });
                }
            }
            ships.push({ name, goal, requirements });
        }

        if (ships.length === 0) {
            renderStatus(section, '이 진영에 해당하는 개발함이 없습니다.', 'empty', { compact: true });
            return section;
        }

        const title = document.createElement('h3');
        title.className = 'rt-section-title';
        title.textContent = '개발함';
        section.appendChild(title);

        const list = document.createElement('div');
        list.className = 'rt-research-list';

        for (const { name, goal, requirements } of ships) {
            const row = document.createElement('div');
            const rarityClass = goal.rarity_type === 'DR' ? 'dr' : 'pr';
            row.className = `rt-research-row ${rarityClass}`;

            const iconUrl = getShipIconByName(name);

            const chipHtml = requirements.map(req => {
                const chip = evaluateRequirement(req);
                return `<span class="rt-req-chip${chip.met ? ' met' : ''}">${chip.label}</span>`;
            }).join('');

            const allMet = requirements.every(req => evaluateRequirement(req).met);

            row.innerHTML = `
                ${iconUrl ? createImg(iconUrl, name, { className: 'rt-research-icon', fallback: IMG_FALLBACKS.CARD }) : '<div class="rt-research-icon placeholder"></div>'}
                <div class="rt-research-body">
                    <div class="rt-research-name">${name}${goal.project ? ` <span class="rt-research-project">${goal.project}기</span>` : ''}</div>
                    <div class="rt-research-reqs">${chipHtml}</div>
                </div>
                <div class="rt-research-status">${allMet ? '<span class="material-symbols-outlined">check_circle</span>' : ''}</div>
            `;
            list.appendChild(row);
        }
        section.appendChild(list);
        return section;
    }

    /**
     * Evaluate a single unlock requirement against the current progress state.
     * Supports 점수 (score) and 전열/후열/잠수 (position count).
     * Returns { met: boolean, label: string }.
     */
    function evaluateRequirement(req) {
        const reqNatId = getNationalityIdByName(req.faction);
        const abbr = FACTION_ABBR[req.faction] || req.faction;
        const target = parseInt(req.value, 10) || 0;

        if (req.type === '점수') {
            const current = reqNatId !== null ? getFactionTotalPoints(reqNatId).earned : 0;
            return { met: current >= target, label: `${abbr} 점수 ${current}/${target}` };
        }

        if (req.type === '전열' || req.type === '후열' || req.type === '잠수') {
            const current = reqNatId !== null ? (buildPositionCounts(reqNatId)[req.type]?.owned ?? 0) : 0;
            return { met: current >= target, label: `${abbr} ${req.type} ${current}/${target}` };
        }

        return { met: false, label: `${abbr} ${req.type} ${req.value}` };
    }

    /**
     * Render collapsible source groups for a faction.
     * Each group header shows label, ship count, mini progress bar, and earned/max pts.
     * Group bodies render ships as dense 2-column rows.
     */
    function renderSourceGroups(natId) {
        const section = document.createElement('div');
        section.className = 'rt-source-groups';

        const ships = getPermanentShipsForNationality(natId);

        const grouped = {};
        for (const sg of SOURCE_GROUPS) grouped[sg.key] = [];
        // Single-assignment: first matching group wins. SOURCE_GROUPS is ordered
        // map → archive → build → shop → other, so drops take priority over
        // build/shop/other when a ship has multiple acquisition paths.
        for (const ship of ships) {
            for (const sg of SOURCE_GROUPS) {
                if (sg.test(ship)) {
                    grouped[sg.key].push(ship);
                    break;
                }
            }
        }

        for (const key of Object.keys(grouped)) {
            grouped[key].sort((a, b) => {
                const ra = rarityOrder[a.rarity] ?? 5;
                const rb = rarityOrder[b.rarity] ?? 5;
                if (ra !== rb) return ra - rb;
                return a.name.localeCompare(b.name);
            });
        }

        const manual = renderManualGroup(natId);
        if (manual) section.appendChild(manual);

        for (const sg of SOURCE_GROUPS) {
            const groupShips = grouped[sg.key];
            if (groupShips.length === 0) continue;
            section.appendChild(createShipGroup(sg, groupShips));
        }

        if (!section.querySelector('.rt-group')) {
            renderStatus(section, '표시할 상시 획득 함순이가 없습니다.', 'empty', { compact: true });
            return section;
        }

        // Filter-empty notice: a canonical status element kept as a sibling of the
        // groups and toggled via the .rt-filter-empty hook in applyFilters().
        // Built off-DOM by renderStatus, then tagged + hidden before append so it
        // coexists with the rendered groups instead of replacing them.
        const filterEmptyHost = document.createElement('div');
        const filterEmpty = renderStatus(filterEmptyHost, '현재 필터와 일치하는 함순이가 없습니다.', 'empty', { compact: true });
        filterEmpty.classList.add('rt-filter-empty');
        filterEmpty.hidden = true;
        section.appendChild(filterEmpty);

        return section;
    }

    /**
     * Build a single source group: header with earned/max pts + 2-col ship row grid.
     */
    function createShipGroup(sg, groupShips) {
        let earned = 0;
        let max = 0;
        for (const s of groupShips) {
            const pts = getShipTechPoints(s.gid);
            earned += pts.earned;
            max += pts.total;
        }
        const pct = max > 0 ? Math.min(100, (earned / max) * 100) : 0;

        const group = document.createElement('div');
        group.className = 'rt-group';
        group.dataset.groupKey = sg.key;

        const header = document.createElement('button');
        header.className = 'rt-group-header';
        header.type = 'button';
        header.setAttribute('aria-expanded', 'true');
        header.innerHTML = `
            <span class="material-symbols-outlined rt-group-icon">${sg.icon}</span>
            <span class="rt-group-label">${sg.label}</span>
            <span class="rt-group-count">${groupShips.length}척</span>
            <span class="rt-group-minibar"><span class="rt-group-minibar-fill" style="width:${pct}%"></span></span>
            <span class="rt-group-pts"><b>${earned}</b> / ${max}pts</span>
            <span class="material-symbols-outlined rt-group-chevron">expand_less</span>
        `;

        const body = document.createElement('div');
        body.className = 'rt-group-body';
        const grid = document.createElement('div');
        grid.className = 'rt-ship-grid';
        for (const ship of groupShips) {
            grid.appendChild(createShipRow(ship));
        }
        body.appendChild(grid);

        header.addEventListener('click', () => {
            const isOpen = group.classList.toggle('open');
            header.setAttribute('aria-expanded', String(isOpen));
            header.querySelector('.rt-group-chevron').textContent = isOpen ? 'expand_less' : 'expand_more';
        });

        group.classList.add('open');
        group.appendChild(header);
        group.appendChild(body);
        return group;
    }

    /**
     * Build the manual pinned group for the given nation.
     * Contents = all pinned ships whose nationality matches natId.
     * Returns null if no pinned ships apply to this nation.
     */
    function renderManualGroup(natId) {
        const ships = [];
        for (const gid of pinned) {
            const ship = shipData[gid];
            if (!ship) continue;
            if (ship.nationality !== natId) continue;
            if (!hasTechPoints(ship)) continue;
            ships.push({ ...ship, gid });
        }
        if (ships.length === 0) return null;

        ships.sort((a, b) => {
            const ra = rarityOrder[a.rarity] ?? 5;
            const rb = rarityOrder[b.rarity] ?? 5;
            if (ra !== rb) return ra - rb;
            return a.name.localeCompare(b.name);
        });

        const sg = { key: 'manual', label: '내 목록 (수동 추가)', icon: 'bookmark' };
        const group = createShipGroup(sg, ships);
        group.classList.add('rt-group-manual');

        // Add ✕ remove button to every row in this group.
        group.querySelectorAll('.rt-ship-row').forEach(row => {
            const gid = row.dataset.shipId;
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'rt-row-remove';
            removeBtn.title = '내 목록에서 제거';
            removeBtn.setAttribute('aria-label', '내 목록에서 제거');
            removeBtn.textContent = '✕';
            removeBtn.dataset.gid = gid;
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                pinned.delete(gid);
                savePinned();
                if (activeFaction) renderFactionContent(activeFaction);
            });
            row.appendChild(removeBtn);
        });

        return group;
    }

    /**
     * Build a single dense ship row for the right-pane grid.
     * Layout: [icon] [name + type + rarity  /  drop location] [3 toggles] [pts]
     * Name, type badge, and rarity badge share a header line inside the main column;
     * map/archive ships get a small second-line drop label ("1-4, 3-2" or event name).
     */
    function createShipRow(ship) {
        const row = document.createElement('div');
        row.className = `rt-ship-row rarity-border-${ship.rarity.toLowerCase()}`;
        row.dataset.shipId = ship.gid;
        row.dataset.rarity = ship.rarity.toLowerCase();

        const ptGet = ship.pt_get || 0;
        const ptLevel = ship.pt_level || 0;
        const ptUpgrade = ship.pt_upgrage || 0;
        const ptTotal = ptGet + ptLevel + ptUpgrade;

        const typeInfo = shipTypeData[ship.type];
        const typeIcon = typeInfo ? typeInfo.icon : '';
        const typeName = typeInfo ? typeInfo.type_name : '';

        const earnedNow = getShipTechPoints(ship.gid).earned;

        // Priority matches SOURCE_GROUPS order: map > archive > shop.
        // Each kind picks its own icon and color in the CSS via .rt-row-location-{kind}.
        let dropLabel = '';
        let dropLabelKind = '';
        if (mapDropGids.has(ship.gid)) {
            dropLabel = mapDropLabel.get(ship.gid) || '';
            dropLabelKind = 'map';
        } else if (archiveDropGids.has(ship.gid)) {
            dropLabel = archiveDropLabel.get(ship.gid) || '';
            dropLabelKind = 'archive';
        } else if (shopDropLabel.has(ship.gid)) {
            dropLabel = shopDropLabel.get(ship.gid);
            dropLabelKind = 'shop';
        }

        const LOCATION_ICONS = { map: 'sailing', archive: 'menu_book', shop: 'shopping_cart' };
        const dropLabelHtml = dropLabel
            ? `<div class="rt-row-location rt-row-location-${dropLabelKind}" title="${dropLabel}">
                   <span class="material-symbols-outlined rt-row-location-icon">${LOCATION_ICONS[dropLabelKind]}</span>
                   <span class="rt-row-location-text">${dropLabel}</span>
               </div>`
            : '';

        row.innerHTML = `
            ${createImg(ship.icon, ship.name, { className: 'rt-row-icon', fallback: IMG_FALLBACKS.CARD })}
            <div class="rt-row-main">
                <div class="rt-row-header">
                    <span class="rt-row-name" title="${ship.name}">${ship.name}</span>
                    ${typeIcon ? `<img src="${typeIcon}" alt="${typeName}" class="rt-row-type" title="${typeName}">` : ''}
                    <span class="rt-row-rarity rarity-${ship.rarity.toLowerCase()}">${ship.rarity}</span>
                </div>
                ${dropLabelHtml}
            </div>
            <div class="rt-row-toggles">
                <label class="rt-toggle rt-toggle-get" title="입수 +${ptGet}">
                    <input type="checkbox" data-type="get" data-pts="${ptGet}">
                    <span>입수</span>
                </label>
                <label class="rt-toggle rt-toggle-level" title="Lv.120 +${ptLevel}">
                    <input type="checkbox" data-type="level" data-pts="${ptLevel}">
                    <span>120</span>
                </label>
                <label class="rt-toggle rt-toggle-upgrade" title="풀돌 +${ptUpgrade}">
                    <input type="checkbox" data-type="upgrade" data-pts="${ptUpgrade}">
                    <span>풀돌</span>
                </label>
            </div>
            <span class="rt-row-pts" title="현재 점수 / 최대 점수">
                <b class="rt-row-pts-current">${earnedNow}</b><span class="rt-row-pts-sep">/</span><span class="rt-row-pts-total">${ptTotal}</span>
            </span>
        `;

        return row;
    }

    /** Sync a row's current/total points text with the in-memory progress state. */
    function updateRowPts(row) {
        const shipId = row.dataset.shipId;
        const { earned } = getShipTechPoints(shipId);
        const el = row.querySelector('.rt-row-pts-current');
        if (el) el.textContent = String(earned);
    }

    /** Restore checkbox states on all visible ship rows from in-memory progress. */
    function applyProgress() {
        rightPane.querySelectorAll('.rt-ship-row').forEach(row => {
            const shipId = row.dataset.shipId;
            const state = progress[shipId] || 0;
            const getBox = row.querySelector('[data-type="get"]');
            const levelBox = row.querySelector('[data-type="level"]');
            const upgradeBox = row.querySelector('[data-type="upgrade"]');
            if (getBox) getBox.checked = (state & 1) > 0;
            if (levelBox) levelBox.checked = (state & 2) > 0;
            if (upgradeBox) upgradeBox.checked = (state & 4) > 0;
            row.classList.toggle('completed', (state & 7) === 7);
            updateRowPts(row);
        });
    }

    function saveProgress() {
        // Serialize in-memory progress directly — don't re-derive from DOM
        // (DOM only shows current faction's ships; rebuilding would lose other factions)
        progressStore.save(progress);
    }

    /**
     * Lightweight sidebar update: replace only the summary and research-ship sections,
     * leaving the quick-add widget (and its event listeners / search index) intact.
     */
    function updateSidebarOnChange() {
        if (!activeFaction) return;
        const natId = getNationalityIdByName(activeFaction);
        if (natId === null) return;

        const oldSummary = sidebarBody.querySelector('.rt-summary');
        if (oldSummary) {
            oldSummary.replaceWith(renderFactionSummary(activeFaction, natId));
        }

        const oldResearch = sidebarBody.querySelector('.rt-research-panel');
        if (oldResearch) {
            oldResearch.replaceWith(renderResearchShips(activeFaction));
        }
    }

    function savePinned() {
        pinnedStore.save([...pinned]);
    }

    /** Show/hide ship rows based on active rarity and ownership status filters. */
    function applyFilters() {
        rightPane.querySelectorAll('.rt-ship-row').forEach(row => {
            const rarity = row.dataset.rarity;
            const isOwned = !!(progress[row.dataset.shipId] & 1);
            const status = isOwned ? 'owned' : 'missing';
            const show = activeRarities.has(rarity) && activeStatuses.has(status);
            row.classList.toggle('filter-hidden', !show);
        });
        let totalVisible = 0;
        rightPane.querySelectorAll('.rt-group').forEach(group => {
            const visible = group.querySelectorAll('.rt-ship-row:not(.filter-hidden)').length;
            totalVisible += visible;
            group.hidden = visible === 0;
            const countEl = group.querySelector('.rt-group-count');
            if (countEl) countEl.textContent = `${visible}척`;
        });
        const filterEmpty = rightPane.querySelector('.rt-filter-empty');
        if (filterEmpty) filterEmpty.hidden = totalVisible > 0;
    }

    /**
     * Recompute earned/max pts for group headers in the right pane.
     * @param {Iterable<Element>} [groups] — only update these groups; omit to update all.
     */
    function refreshGroupHeaders(groups) {
        (groups || rightPane.querySelectorAll('.rt-group')).forEach(group => {
            let earned = 0;
            let max = 0;
            group.querySelectorAll('.rt-ship-row').forEach(row => {
                const pts = getShipTechPoints(row.dataset.shipId);
                earned += pts.earned;
                max += pts.total;
            });
            const pct = max > 0 ? Math.min(100, (earned / max) * 100) : 0;
            const ptsEl = group.querySelector('.rt-group-pts');
            if (ptsEl) ptsEl.innerHTML = `<b>${earned}</b> / ${max}pts`;
            const fill = group.querySelector('.rt-group-minibar-fill');
            if (fill) fill.style.width = `${pct}%`;
        });
    }

    rightPane.addEventListener('change', (e) => {
        if (!e.target.matches('.rt-row-toggles input[type="checkbox"]')) return;
        const checkbox = e.target;
        const row = checkbox.closest('.rt-ship-row');
        if (!row) return;

        const getBox = row.querySelector('[data-type="get"]');
        const levelBox = row.querySelector('[data-type="level"]');
        const upgradeBox = row.querySelector('[data-type="upgrade"]');

        if (checkbox.checked) {
            if (checkbox.dataset.type === 'level' || checkbox.dataset.type === 'upgrade') {
                if (getBox) getBox.checked = true;
            }
        } else {
            if (checkbox.dataset.type === 'get') {
                if (levelBox) levelBox.checked = false;
                if (upgradeBox) upgradeBox.checked = false;
            }
        }

        // Update in-memory progress
        const shipId = row.dataset.shipId;
        const state = ((getBox?.checked ? 1 : 0) | (levelBox?.checked ? 2 : 0) | (upgradeBox?.checked ? 4 : 0));
        if (state > 0) {
            progress[shipId] = state;
        } else {
            delete progress[shipId];
        }

        row.classList.toggle('completed', state === 7);
        updateRowPts(row);

        // Collect affected groups for targeted header refresh
        const affectedGroups = new Set();
        const changedGroup = row.closest('.rt-group');
        if (changedGroup) affectedGroups.add(changedGroup);

        // Sync all other rows for the same ship (duplicates across source groups)
        rightPane.querySelectorAll(`.rt-ship-row[data-ship-id="${shipId}"]`).forEach(other => {
            if (other === row) return;
            const g = other.querySelector('[data-type="get"]');
            const l = other.querySelector('[data-type="level"]');
            const u = other.querySelector('[data-type="upgrade"]');
            if (g) g.checked = !!(state & 1);
            if (l) l.checked = !!(state & 2);
            if (u) u.checked = !!(state & 4);
            other.classList.toggle('completed', state === 7);
            updateRowPts(other);
            const otherGroup = other.closest('.rt-group');
            if (otherGroup) affectedGroups.add(otherGroup);
        });

        saveProgress();

        updateSidebarOnChange();

        refreshGroupHeaders(affectedGroups);
        applyFilters();
    });

    loadData();
});
