import { fetchJSON, fetchJSONWithCache, getStorageItem, setStorageItem, debounce, createImg, IMG_FALLBACKS } from '../utils.js';

document.addEventListener('DOMContentLoaded', () => {
    const SAVE_KEY = 'shipgirlTrackerProgress';

    const PERMANENT_PATTERNS = [
        /^메인 스테이지 해역/,
        /^추천 획득 해역/,
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

    const SOURCE_GROUPS = [
        {
            key: 'map',
            label: '해역 드랍',
            icon: 'sailing',
            test: d => /^메인 스테이지 해역/.test(d) || /^추천 획득 해역/.test(d)
        },
        {
            key: 'build',
            label: '상시 건조',
            icon: 'construction',
            test: d => /건조/.test(d) && !/한정/.test(d) && !/이벤트/.test(d) && !/기간/.test(d)
        },
        {
            key: 'other',
            label: '기타 획득',
            icon: 'storefront',
            test: d => {
                if (/^메인 스테이지 해역/.test(d) || /^추천 획득 해역/.test(d)) return false;
                if (/건조/.test(d) && !/한정/.test(d) && !/이벤트/.test(d) && !/기간/.test(d)) return false;
                return PERMANENT_PATTERNS.some(p => p.test(d));
            }
        },
        {
            key: 'archive',
            label: '작전 문서',
            icon: 'menu_book',
            test: d => /^작전 파일/.test(d) || /^작전 문서/.test(d)
        }
    ];

    let shipData = null;
    let nationalityData = null;
    let shipTypeData = null;
    let fleetTechGoalData = null;
    let progress = {};
    let activeFaction = null;
    const activeRarities = new Set(['ur', 'ssr', 'sr', 'r', 'n']);
    const activeStatuses = new Set(['missing', 'owned']);

    const tabsContainer = document.getElementById('faction-tabs');
    const contentContainer = document.getElementById('faction-content');
    const extraContainer = document.getElementById('faction-extra');

    async function loadData() {
        try {
            [shipData, nationalityData, shipTypeData, fleetTechGoalData] = await Promise.all([
                fetchJSONWithCache('data/ship_group_data.json'),
                fetchJSONWithCache('data/mapping/nationality_mapping.json'),
                fetchJSONWithCache('data/mapping/ship_type_mapping.json'),
                fetchJSONWithCache('data/shipgirl/fleet_tech_goal.json'),
            ]);
            progress = JSON.parse(getStorageItem(SAVE_KEY, null) || '{}');
            init();
        } catch (error) {
            console.error('Failed to load data:', error);
            contentContainer.innerHTML = '<p class="rt-error">데이터를 불러오는 데 실패했습니다.</p>';
        }
    }

    function isPermanentShip(ship) {
        if (!ship.description || !Array.isArray(ship.description)) return false;
        return ship.description.some(d => PERMANENT_PATTERNS.some(p => p.test(d)));
    }

    function getSourceGroups(ship) {
        if (!ship.description || !Array.isArray(ship.description)) return [];
        const groups = new Set();
        for (const d of ship.description) {
            for (const sg of SOURCE_GROUPS) {
                if (sg.test(d)) groups.add(sg.key);
            }
        }
        return [...groups];
    }

    function getFirstSourceGroup(ship) {
        if (!ship.description || !Array.isArray(ship.description)) return null;
        for (const d of ship.description) {
            for (const sg of SOURCE_GROUPS) {
                if (sg.test(d)) return sg.key;
            }
        }
        return null;
    }

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
            if (ship.nationality === natId && isPermanentShip(ship)) {
                ships.push({ ...ship, gid });
            }
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
            const tab = document.createElement('button');
            tab.className = 'rt-tab';
            tab.dataset.faction = factionName;
            const abbr = FACTION_ABBR[factionName];
            const nameHtml = `<span class="rt-tab-name">${factionName}</span>${abbr ? `<span class="rt-tab-abbr">(${abbr})</span>` : ''}`;
            tab.innerHTML = natInfo
                ? `<img src="${natInfo.image}" alt="${factionName}" class="rt-tab-icon">${nameHtml}`
                : nameHtml;
            tab.addEventListener('click', () => switchTab(factionName));
            tabsContainer.appendChild(tab);
        }
    }

    function switchTab(factionName) {
        activeFaction = factionName;
        tabsContainer.querySelectorAll('.rt-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.faction === factionName);
        });
        renderFactionContent(factionName);
    }

    function renderFactionContent(factionName) {
        contentContainer.innerHTML = '';
        extraContainer.innerHTML = '';
        const natId = getNationalityIdByName(factionName);
        if (natId === null) {
            contentContainer.innerHTML = '<p class="rt-error">진영 정보를 찾을 수 없습니다.</p>';
            return;
        }

        // Panel body: summary + research ships
        const panelFragment = document.createDocumentFragment();
        panelFragment.appendChild(renderFactionSummary(factionName, natId));
        panelFragment.appendChild(renderResearchShips(factionName));
        contentContainer.appendChild(panelFragment);

        // Below panel: filter bar + source groups
        const extraFragment = document.createDocumentFragment();
        extraFragment.appendChild(renderFilterBar());
        extraFragment.appendChild(renderSourceGroups(natId));
        extraContainer.appendChild(extraFragment);

        applyProgress();
        applyFilters();
    }

    function renderFilterBar() {
        const bar = document.createElement('div');
        bar.className = 'rt-filters';

        const rarities = ['ur', 'ssr', 'sr', 'r', 'n'];
        const rarityBtns = rarities.map(r => {
            const active = activeRarities.has(r) ? ' active' : '';
            return `<button class="rt-rarity-btn${active}" data-rarity="${r}"><span class="rt-btn-check">&#10003;</span> ${r.toUpperCase()}</button>`;
        }).join('');

        const statuses = [
            { key: 'missing', label: '미획득' },
            { key: 'owned', label: '획득' }
        ];
        const statusBtns = statuses.map(s => {
            const active = activeStatuses.has(s.key) ? ' active' : '';
            return `<button class="rt-status-btn${active}" data-status="${s.key}"><span class="rt-btn-check">&#10003;</span> ${s.label}</button>`;
        }).join('');

        bar.innerHTML = `
            <div class="rt-filters-title">
                <span class="material-symbols-outlined">tune</span>
                필터
            </div>
            <div class="rt-filters-row">
                <div class="rt-filter-group">
                    <span class="rt-filter-label">레어도</span>
                    <div class="rt-rarity-toggles">${rarityBtns}</div>
                </div>
                <div class="rt-filter-group">
                    <span class="rt-filter-label">상태</span>
                    <div class="rt-status-toggles">${statusBtns}</div>
                </div>
            </div>
        `;

        // Event delegation for filter clicks
        bar.addEventListener('click', (e) => {
            const rarityBtn = e.target.closest('.rt-rarity-btn');
            const statusBtn = e.target.closest('.rt-status-btn');

            if (rarityBtn) {
                const rarity = rarityBtn.dataset.rarity;
                rarityBtn.classList.toggle('active');
                if (activeRarities.has(rarity)) activeRarities.delete(rarity);
                else activeRarities.add(rarity);
                applyFilters();
            }

            if (statusBtn) {
                const status = statusBtn.dataset.status;
                statusBtn.classList.toggle('active');
                if (activeStatuses.has(status)) activeStatuses.delete(status);
                else activeStatuses.add(status);
                applyFilters();
            }
        });

        return bar;
    }

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

    function renderResearchShips(factionName) {
        const section = document.createElement('div');
        section.className = 'rt-research-panel';

        const ships = [];
        for (const [name, goal] of Object.entries(fleetTechGoalData)) {
            // Check if this faction appears in any unlock requirement
            let matchesFaction = false;
            for (let i = 1; i <= 3; i++) {
                if (goal[`unlock_${i}`] === factionName) {
                    matchesFaction = true;
                    break;
                }
            }
            if (!matchesFaction) continue;

            // Collect ALL requirements for this ship (not just the matching faction)
            const requirements = [];
            for (let i = 1; i <= 3; i++) {
                if (goal[`unlock_${i}`]) {
                    requirements.push({
                        faction: goal[`unlock_${i}`],
                        type: goal[`unlock_${i}_req_type`],
                        value: goal[`unlock_${i}_req_type_value`]
                    });
                }
            }
            ships.push({ name, goal, requirements });
        }

        if (ships.length === 0) {
            section.innerHTML = '<p class="rt-empty">이 진영에 해당하는 개발함이 없습니다.</p>';
            return section;
        }

        const title = document.createElement('h3');
        title.className = 'rt-section-title';
        title.innerHTML = '<span class="material-symbols-outlined">science</span> 개발함';
        section.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'rt-research-grid';

        for (const { name, goal, requirements } of ships) {
            const card = document.createElement('div');
            const rarityClass = goal.rarity_type === 'DR' ? 'dr' : 'pr';
            card.className = `rt-research-card ${rarityClass}`;

            const allMet = requirements.every(req => {
                if (req.type === '점수') {
                    const reqNatId = getNationalityIdByName(req.faction);
                    if (reqNatId === null) return false;
                    const { earned } = getFactionTotalPoints(reqNatId);
                    return earned >= parseInt(req.value, 10);
                }
                return false;
            });

            const iconUrl = getShipIconByName(name);
            card.innerHTML = `
                <div class="rt-research-card-top">
                    ${iconUrl ? createImg(iconUrl, name, { className: 'rt-research-icon', fallback: IMG_FALLBACKS.CARD }) : ''}
                    <div class="rt-research-card-info">
                        <div class="rt-research-name">${name}</div>
                        <span class="rt-research-rarity ${rarityClass}">${goal.rarity_type}</span>
                        ${goal.project ? `<span class="rt-research-project">${goal.project}기</span>` : ''}
                    </div>
                </div>
                <div class="rt-research-reqs">
                    ${requirements.map(req => {
                        let met = false;
                        let current = 0;
                        const reqValue = parseInt(req.value, 10);
                        if (req.type === '점수') {
                            const reqNatId = getNationalityIdByName(req.faction);
                            if (reqNatId !== null) {
                                current = getFactionTotalPoints(reqNatId).earned;
                                met = current >= reqValue;
                            }
                        }
                        return `<span class="rt-req ${met ? 'met' : ''}">${req.faction} ${req.type} ${current}/${req.value}</span>`;
                    }).join('')}
                </div>
                ${allMet ? '<span class="rt-research-status unlocked">해금 완료</span>' : ''}
            `;
            grid.appendChild(card);
        }
        section.appendChild(grid);
        return section;
    }

    function renderSourceGroups(natId) {
        const section = document.createElement('div');
        section.className = 'rt-source-groups';

        const ships = getPermanentShipsForNationality(natId);

        const grouped = {};
        for (const sg of SOURCE_GROUPS) {
            grouped[sg.key] = [];
        }
        for (const ship of ships) {
            // Assign to first matching group only
            const firstGroup = getFirstSourceGroup(ship);
            if (firstGroup && grouped[firstGroup]) grouped[firstGroup].push(ship);
        }

        const rarityOrder = { UR: 0, SSR: 1, SR: 2, R: 3, N: 4 };
        for (const key of Object.keys(grouped)) {
            grouped[key].sort((a, b) => {
                const ra = rarityOrder[a.rarity] ?? 5;
                const rb = rarityOrder[b.rarity] ?? 5;
                if (ra !== rb) return ra - rb;
                return a.name.localeCompare(b.name);
            });
        }

        for (const sg of SOURCE_GROUPS) {
            const groupShips = grouped[sg.key];
            if (groupShips.length === 0 && sg.key !== 'archive') continue;

            const totalPts = groupShips.reduce((sum, s) => sum + (s.pt_get || 0) + (s.pt_level || 0) + (s.pt_upgrage || 0), 0);

            const group = document.createElement('div');
            group.className = 'rt-group';

            const header = document.createElement('button');
            header.className = 'rt-group-header';
            header.innerHTML = `
                <span class="rt-group-label">
                    <span class="material-symbols-outlined">${sg.icon}</span>
                    ${sg.label}
                    <span class="rt-group-count">${groupShips.length}척</span>
                    <span class="rt-group-pts">${totalPts}pts</span>
                </span>
                <span class="material-symbols-outlined rt-group-chevron">expand_more</span>
            `;

            const body = document.createElement('div');
            body.className = 'rt-group-body';

            if (sg.key === 'archive' && groupShips.length === 0) {
                body.innerHTML = '<p class="rt-placeholder">작전 문서 데이터는 추후 추가 예정입니다.</p>';
            } else {
                const grid = document.createElement('div');
                grid.className = 'rt-ship-grid';
                for (const ship of groupShips) {
                    grid.appendChild(createShipCard(ship));
                }
                body.appendChild(grid);
            }

            header.addEventListener('click', () => {
                const isOpen = group.classList.toggle('open');
                header.querySelector('.rt-group-chevron').textContent = isOpen ? 'expand_less' : 'expand_more';
            });

            if (groupShips.length > 0) {
                group.classList.add('open');
            }

            group.appendChild(header);
            group.appendChild(body);
            section.appendChild(group);
        }

        return section;
    }

    function createShipCard(ship) {
        const card = document.createElement('div');
        card.className = `rt-ship-card rarity-border-${ship.rarity.toLowerCase()}`;
        card.dataset.shipId = ship.gid;
        card.dataset.rarity = ship.rarity.toLowerCase();

        const ptGet = ship.pt_get || 0;
        const ptLevel = ship.pt_level || 0;
        const ptUpgrade = ship.pt_upgrage || 0;
        const ptTotal = ptGet + ptLevel + ptUpgrade;

        const typeInfo = shipTypeData[ship.type];
        const typeName = typeInfo ? typeInfo.type_name : '';
        const typeIcon = typeInfo ? typeInfo.icon : '';

        // Build description list from permanent sources only
        const descHtml = (ship.description || [])
            .filter(d => PERMANENT_PATTERNS.some(p => p.test(d)) || /^작전 (파일|문서)/.test(d))
            .map(d => `<li>${d}</li>`)
            .join('');

        card.innerHTML = `
            <div class="rt-card-top">
                <img src="${ship.icon}" alt="${ship.name}" class="rt-card-icon" loading="lazy">
                <div class="rt-card-info">
                    <span class="rt-card-name">${ship.name}</span>
                    <span class="rt-card-meta">
                        ${typeIcon ? `<img src="${typeIcon}" alt="${typeName}" class="rt-card-type-icon">` : ''}
                        <span class="rt-card-rarity rarity-${ship.rarity.toLowerCase()}">${ship.rarity}</span>
                    </span>
                </div>
                <span class="rt-card-pts">${ptTotal}pts</span>
            </div>
            ${descHtml ? `<ul class="rt-card-desc">${descHtml}</ul>` : ''}
            <div class="rt-card-tracker">
                <label class="rt-check">
                    <input type="checkbox" data-type="get" data-pts="${ptGet}">
                    <span>입수 <em>+${ptGet}</em></span>
                </label>
                <label class="rt-check">
                    <input type="checkbox" data-type="level" data-pts="${ptLevel}">
                    <span>Lv120 <em>+${ptLevel}</em></span>
                </label>
                <label class="rt-check">
                    <input type="checkbox" data-type="upgrade" data-pts="${ptUpgrade}">
                    <span>풀돌 <em>+${ptUpgrade}</em></span>
                </label>
            </div>
        `;

        return card;
    }

    function applyProgress() {
        contentContainer.querySelectorAll('.rt-ship-card').forEach(card => {
            const shipId = card.dataset.shipId;
            const state = progress[shipId] || 0;
            const getBox = card.querySelector('[data-type="get"]');
            const levelBox = card.querySelector('[data-type="level"]');
            const upgradeBox = card.querySelector('[data-type="upgrade"]');
            if (getBox) getBox.checked = (state & 1) > 0;
            if (levelBox) levelBox.checked = (state & 2) > 0;
            if (upgradeBox) upgradeBox.checked = (state & 4) > 0;

            const allChecked = (state & 7) === 7;
            card.classList.toggle('completed', allChecked);
        });
    }

    function saveProgress() {
        // Serialize in-memory progress directly — don't re-derive from DOM
        // (DOM only shows current faction's ships; rebuilding would lose other factions)
        setStorageItem(SAVE_KEY, JSON.stringify(progress));
    }

    function applyFilters() {
        extraContainer.querySelectorAll('.rt-ship-card').forEach(card => {
            const rarity = card.dataset.rarity;
            const isOwned = !!(progress[card.dataset.shipId] & 1);
            const status = isOwned ? 'owned' : 'missing';
            const show = activeRarities.has(rarity) && activeStatuses.has(status);
            card.classList.toggle('filter-hidden', !show);
        });

        // Update group counts
        extraContainer.querySelectorAll('.rt-group').forEach(group => {
            const visible = group.querySelectorAll('.rt-ship-card:not(.filter-hidden)').length;
            const countEl = group.querySelector('.rt-group-count');
            if (countEl) countEl.textContent = `${visible}척`;
        });
    }

    const debouncedSave = debounce(saveProgress, 300);

    extraContainer.addEventListener('change', (e) => {
        if (!e.target.matches('.rt-card-tracker input[type="checkbox"]')) return;
        const checkbox = e.target;
        const card = checkbox.closest('.rt-ship-card');
        if (!card) return;

        const getBox = card.querySelector('[data-type="get"]');
        const levelBox = card.querySelector('[data-type="level"]');
        const upgradeBox = card.querySelector('[data-type="upgrade"]');

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
        const shipId = card.dataset.shipId;
        const state = ((getBox?.checked ? 1 : 0) | (levelBox?.checked ? 2 : 0) | (upgradeBox?.checked ? 4 : 0));
        if (state > 0) {
            progress[shipId] = state;
        } else {
            delete progress[shipId];
        }

        card.classList.toggle('completed', state === 7);

        // Sync all other cards for the same ship
        extraContainer.querySelectorAll(`.rt-ship-card[data-ship-id="${shipId}"]`).forEach(other => {
            if (other === card) return;
            const g = other.querySelector('[data-type="get"]');
            const l = other.querySelector('[data-type="level"]');
            const u = other.querySelector('[data-type="upgrade"]');
            if (g) g.checked = !!(state & 1);
            if (l) l.checked = !!(state & 2);
            if (u) u.checked = !!(state & 4);
            other.classList.toggle('completed', state === 7);
        });

        debouncedSave();

        if (activeFaction) {
            const natId = getNationalityIdByName(activeFaction);
            if (natId !== null) {
                const oldSummary = contentContainer.querySelector('.rt-summary');
                const oldResearch = contentContainer.querySelector('.rt-research-panel');
                if (oldSummary) {
                    const newSummary = renderFactionSummary(activeFaction, natId);
                    oldSummary.replaceWith(newSummary);
                }
                if (oldResearch) {
                    const newResearch = renderResearchShips(activeFaction);
                    oldResearch.replaceWith(newResearch);
                }
            }
        }

        applyFilters();
    });

    loadData();
});
