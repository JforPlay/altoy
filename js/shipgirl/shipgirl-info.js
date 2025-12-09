// ===== Application State =====
let shipgirlData = [];
let fullShipData = null; // Store full detailed data
let fullShipDataPromise = null; // Promise for background loading
let filteredData = [];
let currentShip = null;
let currentLevel = 100;
let currentLimitBreak = '';
let currentFavorability = 'love';
let currentEnhancement = 'complete'; // 'none' or 'complete'
let nationalityData = {};
let attrTypeData = {};
let shipTypeData = {};
let skillIconData = {};
let skillDataTemplate = {};
let viewMode = 'grid';

// Construction-specific filters
let currentConstructionType = 'all';
let currentTimerFilter = 'all';

// ===== DOM Elements =====
const mainView = document.getElementById('mainView');
const detailView = document.getElementById('detailView');
const shipgirls = document.getElementById('shipgirls');
const searchInput = document.getElementById('searchInput');
const rarityFilter = document.getElementById('rarityFilter');
const backButton = document.getElementById('backButton');
const loading = document.getElementById('loading');
const errorDiv = document.getElementById('error');

// ===== Constants =====
const FAVORABILITY_BONUSES = {
    'other': 1.0,
    'friendly': 1.01,
    'crush': 1.03,
    'love': 1.06,
    'oath': 1.09,
    'oath200': 1.12
};

const ARMOR_TYPES = {
    1: '경장갑',
    2: '중형장갑',
    3: '중장갑'
};

const LIMIT_BREAK_NAMES = ['기본', '한계돌파 1', '한계돌파 2', '한계돌파 3'];

const UNAFFECTED_STATS = ['speed', 'luck'];

// ===== Data Loading =====
async function loadData() {
    // Load lite data for fast initial render
    shipgirlData = await fetchJSON('data/ship_info_lite.json');
    filteredData = [...shipgirlData];

    // Start loading full data in background
    fullShipDataPromise = loadFullData();
}

async function loadFullData() {
    try {
        console.log("Starting background load of full ship data...");
        fullShipData = await fetchJSON('data/ship_info_data.json');
        console.log("Full ship data loaded successfully.");
        return fullShipData;
    } catch (error) {
        console.warn("Background loading of full data failed:", error);
    }
    return null;
}

async function loadNationalityData() {
    nationalityData = await fetchJSON('data/mapping/nationality_mapping.json');
}

async function loadAttrTypeData() {
    attrTypeData = await fetchJSON('data/mapping/attr_type_mapping.json');
}

async function loadShipTypeData() {
    shipTypeData = await fetchJSON('data/mapping/ship_type_mapping.json');
}

async function loadSkillIconData() {
    try {
        skillIconData = await fetchJSON('data/skill_icon_mapping.json');
        console.log('Loaded local skill icon data:', Object.keys(skillIconData).length, 'icons');
        return;
    } catch (error) {
        console.warn('Local skill icon data not found, fetching from remote...');
    }

    try {
        skillIconData = await fetchJSON('https://raw.githubusercontent.com/Fernando2603/AzurLane/refs/heads/main/skill_icon.json');
        console.log('Loaded remote skill icon data:', Object.keys(skillIconData).length, 'icons');
    } catch (error) {
        console.error('Failed to fetch skill icon data from remote:', error);
    }
}

async function loadSkillDataTemplate() {
    try {
        const data = await fetchJSON('data/sim/skill_data_template.json');
        
        if (Array.isArray(data)) {
            skillDataTemplate = Object.fromEntries(
                data.map(skill => [skill.id, skill])
            );
        } else if (typeof data === 'object') {
            skillDataTemplate = data;
        } else {
            throw new Error('Invalid skill data format');
        }

        console.log('Loaded local skill data template:', Object.keys(skillDataTemplate).length, 'skills');
        return;
    } catch (error) {
        console.warn('Local skill data not found, fetching from remote...', error);
    }

    try {
        const data = await fetchJSON('https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/skill_data_template.json');
        
        if (Array.isArray(data)) {
            skillDataTemplate = Object.fromEntries(
                data.map(skill => [skill.id, skill])
            );
        } else if (typeof data === 'object') {
            skillDataTemplate = data;
        } else {
            throw new Error('Invalid skill data format from remote');
        }

        console.log('Loaded remote skill data template:', Object.keys(skillDataTemplate).length, 'skills');
    } catch (error) {
        console.error('Failed to fetch skill data template from remote:', error);
    }
}

// ===== Initialization =====
async function init() {
    try {
        loading.style.display = 'block';

        // Prevent browser from restoring scroll position
        if ('scrollRestoration' in history) {
            history.scrollRestoration = 'manual';
        }

        await Promise.all([
            loadData(),
            loadNationalityData(),
            loadAttrTypeData(),
            loadShipTypeData(),
            loadSkillIconData(),
            loadSkillDataTemplate()
        ]);
        loading.style.display = 'none';

        // Populate filter options BEFORE setting up event listeners
        populateFilterOptions();

        // Initialize stats counter
        updateFilterStats();

        handleRoute();
        setupEventListeners();
        window.addEventListener('popstate', handleRoute);
    } catch (error) {
        loading.style.display = 'none';
        showToast(message, 'error');
        console.error('Initialization error:', error);
    }
}

// ===== Skill Helper Functions =====

function getSkillIconUrl(skillId) {
    const iconUrl = skillIconData[String(skillId)];
    if (!iconUrl) {
        console.log('No icon found for skill:', skillId);
        return null;
    }
    console.log('Skill icon URL:', skillId, '->', iconUrl);
    return iconUrl;
}

function processSkillDescription(desc, descGetAdd) {
    if (!desc) return '설명 없음';
    if (!descGetAdd || descGetAdd.length === 0) return desc;

    let processed = desc;
    descGetAdd.forEach((params, index) => {
        const placeholder = `$${index + 1}`;
        const value = Array.isArray(params) ? params.join('/') : params;
        processed = processed.replace(new RegExp(`\\${placeholder}`, 'g'), value);
    });

    return processed;
}

function getSkillInfo(skillId) {
    const skill = skillDataTemplate[String(skillId)];

    if (!skill) {
        console.warn('Skill not found:', skillId);
        return {
            name: `스킬 ${skillId}`,
            description: '정보 없음',
            iconUrl: getSkillIconUrl(skillId)
        };
    }

    return {
        name: skill.name || `스킬 ${skillId}`,
        description: processSkillDescription(skill.desc, skill.desc_get_add),
        iconUrl: getSkillIconUrl(skillId)
    };
}

// ===== Helper Functions =====
function getAttrKoreanName(attrName) {
    if (!attrName) return '';
    const lowerAttrName = attrName.toLowerCase();

    // Try to find by 'name' first, then by 'name2'
    const attr = Object.values(attrTypeData).find(a =>
        a.name === lowerAttrName || a.name2 === lowerAttrName
    );

    return attr ? attr.condition : attrName;
}

function getShipType(type) {
    const shipType = shipTypeData[String(type)];
    if (shipType) {
        return `
            ${shipType.icon ? `<img src="${shipType.icon}" alt="${shipType.type_name}" style="height: 20px; vertical-align: middle; margin-right: 5px;">` : ''}
            ${shipType.type_name}
        `;
    }
    return `함종 ${type}`;
}

// showError replaced by global showToast

// ===== Event Listeners =====
function setupEventListeners() {
    searchInput.addEventListener('input', filterShipgirls);
    rarityFilter.addEventListener('change', filterShipgirls);
    document.getElementById('shipTypeFilter').addEventListener('change', filterShipgirls);
    document.getElementById('nationalityFilter').addEventListener('change', filterShipgirls);

    // Construction filter
    const constructionFilter = document.getElementById('constructionFilter');
    if (constructionFilter) {
        constructionFilter.addEventListener('change', (e) => {
            currentConstructionType = e.target.value;
            filterShipgirls();
        });
    }

    // Info popup is handled globally by global.script.js

    backButton.addEventListener('click', () => history.back());

    const homeButton = document.getElementById('homeButton');
    if (homeButton) {
        homeButton.addEventListener('click', () => {
            // Update the URL to the main page and re-run the router
            history.pushState(null, '', 'pages/shipgirl/shipgirl-info.html');
            handleRoute();
        });
    }

    const gridViewBtn = document.getElementById('gridViewBtn');
    const listViewBtn = document.getElementById('listViewBtn');

    if (gridViewBtn && listViewBtn) {
        gridViewBtn.addEventListener('click', () => {
            viewMode = 'grid';
            shipgirls.className = 'shipgirl-grid';
            gridViewBtn.classList.add('active');
            listViewBtn.classList.remove('active');
            localStorage.setItem('shipgirl-view-mode', 'grid');
            renderShipgirls(); // Re-render with grid layout
        });

        listViewBtn.addEventListener('click', () => {
            viewMode = 'list';
            shipgirls.className = 'shipgirl-grid list-view';
            listViewBtn.classList.add('active');
            gridViewBtn.classList.remove('active');
            localStorage.setItem('shipgirl-view-mode', 'list');
            renderShipgirls(); // Re-render with list layout
        });

        const savedView = localStorage.getItem('shipgirl-view-mode') || 'grid';
        if (savedView === 'list') {
            listViewBtn.click();
        }
    }
}

// ===== Populate Filter Options =====
function populateFilterOptions() {
    // Populate ship type filter
    const shipTypeFilter = document.getElementById('shipTypeFilter');
    const uniqueShipTypes = [...new Set(shipgirlData.map(ship => String(ship.type)))].sort((a, b) => parseInt(a) - parseInt(b));

    shipTypeFilter.innerHTML = '<option value="">모든 함종</option>' +
        uniqueShipTypes.map(type => {
            const shipType = shipTypeData[type];
            return `<option value="${type}">${shipType ? shipType.type_name : `함종 ${type}`}</option>`;
        }).join('');

    // Populate nationality filter
    const nationalityFilter = document.getElementById('nationalityFilter');
    const uniqueNationalities = [...new Set(shipgirlData.map(ship => String(ship.nationality)))].sort((a, b) => parseInt(a) - parseInt(b));

    nationalityFilter.innerHTML = '<option value="">모든 진영</option>' +
        uniqueNationalities.map(nationality => {
            const nationalityInfo = nationalityData[nationality];
            return `<option value="${nationality}">${nationalityInfo ? nationalityInfo.name : `진영 ${nationality}`}</option>`;
        }).join('');
}

// ===== Filtering and Rendering =====
function filterShipgirls() {
    const searchTerm = searchInput.value.toLowerCase();
    const selectedRarity = rarityFilter.value;
    const selectedShipType = document.getElementById('shipTypeFilter').value;
    const selectedNationality = document.getElementById('nationalityFilter').value;

    filteredData = shipgirlData.filter(ship => {
        // Add safety checks for undefined values
        const matchesSearch = !searchTerm || (ship.name && ship.name.toLowerCase().includes(searchTerm));
        const matchesRarity = !selectedRarity || ship.rarity === selectedRarity;
        const matchesShipType = !selectedShipType || String(ship.type) === selectedShipType;
        const matchesNationality = !selectedNationality || String(ship.nationality) === selectedNationality;

        // Construction type filter
        const matchesConstruction = currentConstructionType === 'all' || ship[currentConstructionType] === true;

        // Timer filter
        const matchesTimer = currentTimerFilter === 'all' || ship.timer === currentTimerFilter;

        return matchesSearch && matchesRarity && matchesShipType && matchesNationality && matchesConstruction && matchesTimer;
    });

    renderShipgirls();
    updateFilterStats();
}

function renderShipgirls() {
    if (filteredData.length === 0) {
        shipgirls.innerHTML = '<p style="color: var(--text-primary); text-align: center; grid-column: 1/-1;">함선을 찾을 수 없습니다.</p>';
        return;
    }

    shipgirls.innerHTML = filteredData.map(ship => createShipgirlCard(ship)).join('');

    document.querySelectorAll('.shipgirl-card').forEach((card, index) => {
        card.addEventListener('click', () => navigateToDetail(filteredData[index].name));
    });
}

function createShipgirlCard(ship) {
    if (viewMode === 'list') {
        return createListCard(ship);
    } else {
        return createGridCard(ship);
    }
}

function createGridCard(ship) {
    const nationalityInfo = nationalityData[String(ship.nationality)] || {
        name: ship.nationality,
        code: ship.nationality,
        image: ''
    };
    const shipTypeInfo = shipTypeData[String(ship.type)] || {
        type_name: `함종 ${ship.type}`,
        icon: ''
    };

    const hasValidIcon = shipTypeInfo.icon && shipTypeInfo.icon !== 'undefined';

    // Construction badges for overlay
    let constructionBadges = '';
    if (ship.limited) {
        constructionBadges += '<span class="construction-badge limited-badge">★ 한정</span>';
    }
    if (ship.light) {
        constructionBadges += '<span class="construction-badge">소형</span>';
    }
    if (ship.medium) {
        constructionBadges += '<span class="construction-badge">중형</span>';
    }
    if (ship.heavy) {
        constructionBadges += '<span class="construction-badge">특형</span>';
    }

    const timerDisplay = ship.timer ? `<span class="timer-badge">${formatTimer(ship.timer)}</span>` : '';

    return `
        <div class="shipgirl-card">
            <img src="${ship.shipyard || ''}" alt="${ship.name || '알 수 없음'}" class="shipgirl-image"
                 onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22250%22 height=%22200%22%3E%3Crect fill=%22%23ddd%22 width=%22250%22 height=%22200%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22%3E이미지 없음%3C/text%3E%3C/svg%3E'">
            ${constructionBadges ? `<div class="construction-badges-overlay">${constructionBadges}</div>` : ''}
            <div class="shipgirl-info">
                <div class="shipgirl-name">${ship.name || '이름 없음'}</div>
                <div class="shipgirl-meta">
                    <span class="nationality-code" title="${nationalityInfo.name}">${nationalityInfo.code || nationalityInfo.name}</span>
                    ${hasValidIcon ?
            `<img src="${shipTypeInfo.icon}" alt="${shipTypeInfo.type_name}" class="ship-type-icon" title="${shipTypeInfo.type_name}">` :
            `<span class="ship-type-text">${shipTypeInfo.type_name}</span>`
        }
                    <span class="rarity-badge rarity-${ship.rarity}">${ship.rarity}</span>
                </div>
                ${timerDisplay}
            </div>
        </div>
    `;
}

function createListCard(ship) {
    const nationalityInfo = nationalityData[String(ship.nationality)] || {
        name: ship.nationality,
        code: ship.nationality,
        image: ''
    };
    const shipTypeInfo = shipTypeData[String(ship.type)] || {
        type_name: `함종 ${ship.type}`,
        icon: ''
    };

    const hasValidIcon = shipTypeInfo.icon && shipTypeInfo.icon !== 'undefined';

    // Construction badges for inline display
    let constructionBadges = '';
    if (ship.limited) {
        constructionBadges += '<span class="construction-badge limited-badge">★ 한정</span>';
    }
    if (ship.light) {
        constructionBadges += '<span class="construction-badge">소형</span>';
    }
    if (ship.medium) {
        constructionBadges += '<span class="construction-badge">중형</span>';
    }
    if (ship.heavy) {
        constructionBadges += '<span class="construction-badge">특형</span>';
    }

    const timerDisplay = ship.timer ? `<span class="timer-badge">${formatTimer(ship.timer)}</span>` : '';

    return `
        <div class="shipgirl-card">
            <img src="${ship.shipyard || ''}" alt="${ship.name || '알 수 없음'}" class="shipgirl-image"
                 onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22250%22 height=%22200%22%3E%3Crect fill=%22%23ddd%22 width=%22250%22 height=%22200%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22%3E이미지 없음%3C/text%3E%3C/svg%3E'">
            <div class="shipgirl-info">
                <div class="left-info">
                    <div class="shipgirl-name">${ship.name || '이름 없음'}</div>
                    ${constructionBadges}
                    ${timerDisplay}
                </div>
                <div class="shipgirl-meta">
                    <span class="nationality-code" title="${nationalityInfo.name}">${nationalityInfo.code || nationalityInfo.name}</span>
                    ${hasValidIcon ?
            `<img src="${shipTypeInfo.icon}" alt="${shipTypeInfo.type_name}" class="ship-type-icon" title="${shipTypeInfo.type_name}">` :
            `<span class="ship-type-text">${shipTypeInfo.type_name}</span>`
        }
                    <span class="rarity-badge rarity-${ship.rarity}">${ship.rarity}</span>
                </div>
            </div>
        </div>
    `;
}

// Format timer for display
function formatTimer(timer) {
    if (!timer || timer === '건조시간 없음') return timer;
    const parts = timer.split(':');
    const hours = parseInt(parts[0]);
    const minutes = parseInt(parts[1]);
    const seconds = parts[2] ? parseInt(parts[2]) : 0;

    if (hours === 0 && seconds === 0) {
        return `${minutes}분`;
    } else if (hours === 0) {
        return `${minutes}분 ${seconds}초`;
    } else if (seconds === 0) {
        return `${hours}시간 ${minutes}분`;
    }
    return `${hours}시간 ${minutes}분 ${seconds}초`;
}

// Update filter statistics
function updateFilterStats() {
    const totalCount = shipgirlData.length;
    const filteredCount = filteredData.length;

    // Update stats display if elements exist
    const totalElement = document.getElementById('totalShips');
    const filteredElement = document.getElementById('filteredShips');

    if (totalElement) totalElement.textContent = totalCount;
    if (filteredElement) filteredElement.textContent = filteredCount;
}

// ===== Navigation and Routing =====
function navigateToDetail(shipName) {
    history.pushState({ shipName }, '', `pages/shipgirl/shipgirl-info.html?ship=${encodeURIComponent(shipName)}`);
    handleRoute();
}

function handleRoute() {
    const urlParams = new URLSearchParams(window.location.search);
    const shipName = urlParams.get('ship');

    if (shipName) {
        showDetailView(shipName);
    } else {
        showMainView();
    }

    // Reset scroll position to top
    window.scrollTo(0, 0);
}

function showMainView() {
    mainView.style.display = 'block';
    detailView.style.display = 'none';

    // Only populate filters if they haven't been populated yet
    if (document.getElementById('shipTypeFilter').options.length === 1) {
        populateFilterOptions();
    }

    renderShipgirls();
    updateFilterStats();

    // Reset scroll position to top
    window.scrollTo(0, 0);
}

async function showDetailView(shipName) {
    // If full data isn't loaded yet, wait for it
    if (!fullShipData) {
        loading.style.display = 'block';
        try {
            await fullShipDataPromise;
        } catch (e) {
            showError("상세 데이터를 불러오는데 실패했습니다.");
            showMainView();
            loading.style.display = 'none';
            return;
        }
        loading.style.display = 'none';
    }

    if (!fullShipData) {
         showError("상세 데이터 로드 실패.");
         showMainView();
         return;
    }

    const ship = fullShipData.find(s => s.name === shipName);

    if (!ship) {
        showError('함순이을 찾을 수 없습니다');
        showMainView();
        return;
    }

    currentShip = ship;
    currentLevel = 100;
    currentFavorability = 'love';

    const limitBreakOptions = Object.keys(ship.base);
    currentLimitBreak = limitBreakOptions[limitBreakOptions.length - 1];

    mainView.style.display = 'none';
    detailView.style.display = 'block';

    renderDetailView(ship);

    // Reset scroll position to top
    window.scrollTo(0, 0);
}

// ===== Detail View Rendering =====
function renderDetailView(ship) {
    const limitBreakOptions = Object.keys(ship.base);
    const nationalityInfo = nationalityData[String(ship.nationality)] || {
        name: ship.nationality,
        code: '',
        image: ''
    };

    const detailContent = document.getElementById('detailContent');
    detailContent.innerHTML = `
        ${renderDetailHeader(ship, nationalityInfo)}
        ${renderGiftSection(ship)}
        ${renderStatsSection(ship, limitBreakOptions)}
        ${renderSkillSection(ship)}
        ${renderSpWeaponSection(ship)}
    `;

    setupDetailEventListeners();
    updateStats();
}

function renderDetailHeader(ship, nationalityInfo) {
    // Check if ship has retrofit data
    const hasRetrofit = ship.retrofit && ship.retrofit.id;

    // Filter retrofit bonuses to exclude equipment proficiency
    let retrofitBonuses = {};
    if (hasRetrofit && ship.retrofit.bonus) {
        retrofitBonuses = Object.fromEntries(
            Object.entries(ship.retrofit.bonus).filter(([stat, value]) =>
                !stat.includes('equipment_proficiency')
            )
        );
    }

    return `
        <div class="detail-header">
            <div class="detail-image">
                <img src="${ship.shipyard}" alt="${ship.name}" 
                     onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22300%22%3E%3Crect fill=%22%23ddd%22 width=%22400%22 height=%22300%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22%3E이미지 없음%3C/text%3E%3C/svg%3E'">
            </div>
            <div class="detail-basic-info">
                <h2 class="detail-title">
                    ${ship.name}
                    ${hasRetrofit ? '<span class="retrofit-available-badge">개조 가능</span>' : ''}
                </h2>
                <div class="skin-link-container">
                        <a href="pages/skin/skin-detail-viewer.html?character=${encodeURIComponent(ship.name)}&skin=${encodeURIComponent(ship.name)}" 
                           class="skin-viewer-button">
                            🎨 스킨/대사 보러가기
                        </a>
                    </div>
                <div class="info-grid">
                    <div class="info-item">
                        <div class="info-label">등급</div>
                        <div class="info-value">
                            <span class="rarity-badge rarity-${ship.rarity}">${ship.rarity}</span>
                        </div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">그룹 ID</div>
                        <div class="info-value">${ship.gid}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">함종</div>
                        <div class="info-value">${getShipType(ship.type)}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">장갑</div>
                        <div class="info-value">${ARMOR_TYPES[ship.armor] || `장갑 ${ship.armor}`}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">진영</div>
                        <div class="info-value">
                            ${nationalityInfo.image ? `<img src="${nationalityInfo.image}" alt="${nationalityInfo.code}" style="height: 24px; vertical-align: middle; margin-right: 5px;">` : ''}
                            ${nationalityInfo.name}${nationalityInfo.code ? ` (${nationalityInfo.code})` : ''}
                        </div>
                    </div>
                    ${hasRetrofit ? `
                        <div class="info-item">
                            <div class="info-label">개조 레벨 요구</div>
                            <div class="info-value">${ship.retrofit.level}</div>
                        </div>
                    ` : ''}
                </div>
                ${ship.description && ship.description.length > 0 ? `
                    <div style="margin-top: 20px;">
                        <strong>드랍 정보:</strong>
                        <p style="margin-top: 10px;">${ship.description.join(', ')}</p>
                    </div>
                ` : ''}
                ${hasRetrofit && Object.keys(retrofitBonuses).length > 0 ? `
                    <div class="retrofit-bonus-section">
                        <h4 class="retrofit-bonus-title">개조 보너스</h4>
                        <div class="retrofit-bonus-grid">
                            ${Object.entries(retrofitBonuses).map(([stat, value]) => `
                                <div class="retrofit-bonus-item">
                                    <span class="bonus-stat">${getAttrKoreanName(stat) || stat}:</span>
                                    <span class="bonus-value">+${value}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

function renderGiftSection(ship) {
    return `
        <div class="gift-section">
            <h3 class="section-title">선호하는 선물</h3>
            <div class="gift-container">
                <div class="gift-group">
                    <div class="gift-group-title">좋아하는 선물</div>
                    <div class="gift-icons liked-gifts">
                        ${generateGiftIcons(ship.gift_dislike || [], 'liked')}
                    </div>
                </div>
                <div class="gift-group">
                    <div class="gift-group-title">싫어하는 선물</div>
                    <div class="gift-icons disliked-gifts">
                        ${generateGiftIcons(ship.gift_dislike || [], 'disliked')}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderStatsSection(ship, limitBreakOptions) {
    return `
        <div class="stats-section">
            <h3 class="section-title">
                능력치 계산기
                <button class="tooltip-toggle-button" data-tooltip-target="statInfoTooltip" title="계산 방식 보기">
                    <span class="material-symbols-outlined">help</span>
                </button>
            </h3>
            <div class="info-tooltip" id="statInfoTooltip">
                <div class="tooltip-content">
                    <h4>능력치 계산 공식</h4>
                    <p class="tooltip-formula">최종 능력치 = <strong>⌊(기본 + 성장 × (레벨-1) / 1000 + 강화) × 호감도 보너스⌋</strong></p>
                    <div class="tooltip-details">
                        <p><strong>기본:</strong> 한계돌파에 따른 기본 능력치</p>
                        <p><strong>성장:</strong> 레벨업 시 증가하는 성장치</p>
                        <p><strong>강화:</strong> 강화 완료 시 추가되는 수치</p>
                        <p><strong>호감도:</strong> 호감도에 따른 배율 (속도, 행운 제외)</p>
                    </div>
                    <p class="tooltip-note">※ ⌊ ⌋는 소수점 버림을 의미합니다</p>
                </div>
            </div>
            <div class="stats-grid" id="statsGrid"></div>
            <div class="stat-controls">
                <div class="control-row">
                    <div class="control-group">
                        <label for="limitBreakSelect">한계돌파</label>
                        <select id="limitBreakSelect">
                            ${limitBreakOptions.map((key, index) => `
                                <option value="${key}" ${key === currentLimitBreak ? 'selected' : ''}>
                                    ${LIMIT_BREAK_NAMES[index] || `한계돌파 ${index}`}
                                </option>
                            `).join('')}
                        </select>
                    </div>
                    <div class="control-group">
                        <label for="favorabilitySelect">호감도</label>
                        <select id="favorabilitySelect">
                            <option value="other">기타 (0%)</option>
                            <option value="friendly">호감 61+ (1%)</option>
                            <option value="crush">기쁨 81+ (3%)</option>
                            <option value="love" selected>사랑 100 (6%)</option>
                            <option value="oath">서약 100+ (9%)</option>
                            <option value="oath200">서약 200 (12%)</option>
                        </select>
                    </div>
                    <div class="control-group">
                        <label for="enhancementSelect">강화</label>
                        <select id="enhancementSelect">
                            <option value="none">강화 X</option>
                            <option value="complete" selected>강화 완료</option>
                        </select>
                    </div>
                </div>
                <div class="level-slider-container">
                    <label for="levelSlider">레벨: <span id="levelValue">${currentLevel}</span></label>
                    <input type="range" id="levelSlider" min="1" max="125" value="${currentLevel}">
                </div>
            </div>
        </div>
    `;
}

function renderSkillSection(ship) {
    if (!ship.skill || Object.keys(ship.skill).length === 0) return '';

    // Get all skills including retrofit skill if exists
    const allSkills = [];

    // Add regular skills (ignore skills with "Retrofit" requirement)
    Object.values(ship.skill).forEach(skill => {
        if (skill.requirement !== 'Retrofit') {
            allSkills.push({
                id: skill.id,
                parent: skill.parent,
                requirement: skill.requirement || '없음',
                isRetrofit: false,
                weapon_true: skill.weapon_true || false
            });
        }
    });

    // Add retrofit skill if it exists
    if (ship.retrofit && ship.retrofit.skill_id) {
        const retrofitSkillId = ship.retrofit.skill_id;
        // Check if this skill isn't already in the regular skills
        const alreadyExists = allSkills.some(s => s.id === retrofitSkillId);
        if (!alreadyExists) {
            // Find the retrofit skill to get weapon_true status
            const retrofitSkillData = Object.values(ship.skill).find(s => s.id === retrofitSkillId);
            allSkills.push({
                id: retrofitSkillId,
                parent: retrofitSkillId,
                requirement: '개조',
                isRetrofit: true,
                weapon_true: retrofitSkillData?.weapon_true || false
            });
        }
    }

    if (allSkills.length === 0) return '';

    return `
        <div class="stats-section">
            <h3 class="section-title">스킬</h3>
            <ul class="skill-list">
                ${allSkills.map(skill => {
        const skillInfo = getSkillInfo(skill.id);
        const iconUrl = skillInfo.iconUrl;
        const isWeaponSkill = skill.weapon_true === true;
        const skillUrl = `pages/simulators/sim-weapon.html?skill_id=${skill.id}`;

        return `
                        <li class="skill-item ${skill.isRetrofit ? 'retrofit-skill' : ''} ${isWeaponSkill ? 'weapon-skill-clickable' : ''}" 
                            ${isWeaponSkill ? `onclick="window.location.href='${skillUrl}'" style="cursor: pointer;"` : ''}>
                            <div class="skill-header">
                                ${iconUrl ? `
                                    <img src="${iconUrl}" 
                                         alt="${skillInfo.name}" 
                                         class="skill-icon"
                                         onerror="this.style.display='none';">
                                ` : `
                                    <div class="skill-icon-placeholder">${skill.id}</div>
                                `}
                                <div class="skill-title">
                                    <div>
                                        <strong>${skillInfo.name}</strong>
                                        ${skill.isRetrofit ? '<span class="retrofit-badge">개조</span>' : ''}
                                        ${isWeaponSkill ? '<span class="weapon-badge">무기 시뮬레이터</span>' : ''}
                                    </div>
                                    <span class="skill-id">ID: ${skill.id}</span>
                                </div>
                            </div>
                            <div class="skill-description">${skillInfo.description}</div>
                            <div class="skill-meta">
                                <span><strong>필요 조건:</strong> ${skill.requirement}</span>
                                ${isWeaponSkill ? '<span class="weapon-sim-hint">클릭하여 무기 시뮬레이터에서 보기 →</span>' : ''}
                            </div>
                        </li>
                    `;
    }).join('')}
            </ul>
        </div>
    `;
}

function renderSpWeaponSection(ship) {
    if (!ship.sp_weapon) return '';

    const spWeapon = ship.sp_weapon;
    const iconUrl = `https://raw.githubusercontent.com/JforPlay/data_for_toy/main/spweapon/${spWeapon.icon}.png`;

    const skillUpgradeIds = (spWeapon.skill_upgrade || [])
        .filter(skillArray => Array.isArray(skillArray) && skillArray.length > 1)
        .map(skillArray => skillArray[1]);

    return `
        <div class="sp-weapon-section">
            <h3 class="section-title">특수 장비</h3>
            <div class="sp-weapon-header">
                <div class="sp-weapon-icon-container">
                    <img src="${iconUrl}" 
                         alt="${spWeapon.name}" 
                         class="sp-weapon-icon"
                         onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect fill=%22%23ddd%22 width=%22100%22 height=%22100%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22%3E${spWeapon.icon}%3C/text%3E%3C/svg%3E'">
                </div>
                <div class="sp-weapon-details">
                    <div class="info-grid">
                        <div class="info-item">
                            <div class="info-label">이름</div>
                            <div class="info-value">${spWeapon.name}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">속성 1</div>
                            <div class="info-value">${getAttrKoreanName(spWeapon.attribute_1)}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">속성 2</div>
                            <div class="info-value">${getAttrKoreanName(spWeapon.attribute_2)}</div>
                        </div>
                    </div>
                </div>
            </div>
            ${skillUpgradeIds.length > 0 ? `
                <div class="sp-weapon-skills">
                    <h4 class="sp-weapon-skills-title">스킬 강화</h4>
                    <ul class="skill-list">
                        ${skillUpgradeIds.map(skillId => {
        const skillInfo = getSkillInfo(skillId);
        const isWeaponSkill = spWeapon.weapon_true === true;
        const skillUrl = `pages/simulators/sim-weapon.html?skill_id=${skillId}`;

        return `
                                <li class="skill-item ${isWeaponSkill ? 'weapon-skill-clickable' : ''}" 
                                    ${isWeaponSkill ? `onclick="window.location.href='${skillUrl}'" style="cursor: pointer;"` : ''}>
                                    <div class="skill-header">
                                        ${skillInfo.iconUrl ? `
                                            <img src="${skillInfo.iconUrl}" 
                                                 alt="${skillInfo.name}" 
                                                 class="skill-icon"
                                                 onerror="this.style.display='none'">
                                        ` : ''}
                                        <div class="skill-title">
                                            <div>
                                                <strong>${skillInfo.name}</strong>
                                                ${isWeaponSkill ? '<span class="weapon-badge">무기 시뮬레이터</span>' : ''}
                                                </div>
                                            <span class="skill-id">ID: ${skillId}</span>
                                        </div>
                                    </div>
                                    <div class="skill-description">${skillInfo.description}</div>
                                    <div class="skill-meta">
                                        <span><strong>타입:</strong> 특수 장비 강화 스킬</span>
                                        ${isWeaponSkill ? '<span class="weapon-sim-hint">클릭하여 무기 시뮬레이터에서 보기 →</span>' : ''}
                                    </div>
                                </li>
                            `;
    }).join('')}
                    </ul>
                </div>
            ` : ''}
        </div>
    `;
}

function setupDetailEventListeners() {
    const levelSlider = document.getElementById('levelSlider');
    const levelValue = document.getElementById('levelValue');
    const limitBreakSelect = document.getElementById('limitBreakSelect');
    const favorabilitySelect = document.getElementById('favorabilitySelect');
    const enhancementSelect = document.getElementById('enhancementSelect');

    levelSlider.addEventListener('input', (e) => {
        currentLevel = parseInt(e.target.value);
        levelValue.textContent = currentLevel;
        updateStats();
    });

    limitBreakSelect.addEventListener('change', (e) => {
        currentLimitBreak = e.target.value;
        updateStats();
    });

    favorabilitySelect.addEventListener('change', (e) => {
        currentFavorability = e.target.value;
        updateStats();
    });

    enhancementSelect.addEventListener('change', (e) => {
        currentEnhancement = e.target.value;
        updateStats();
    });

    // Reinitialize tooltip functionality for dynamically loaded content
    if (typeof setupTooltipToggles === 'function') {
        setupTooltipToggles();
    }
}

// ===== Gift Generation =====
function generateGiftIcons(dislikedGifts, type) {
    // Define all possible gift IDs from 180001 to 180009
    const allGiftIds = Array.from({ length: 9 }, (_, i) => 180001 + i);
    const dislikedSet = new Set(dislikedGifts || []);
    const baseUrl = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/props/';

    let targetGiftIds;

    // Determine which set of gifts to display based on the 'type' parameter
    if (type === 'liked') {
        // Liked gifts are all gifts that are NOT in the disliked set
        targetGiftIds = allGiftIds.filter(id => !dislikedSet.has(id));
    } else { // type === 'disliked'
        // Disliked gifts are simply the ones provided in the list
        targetGiftIds = [...dislikedSet];
    }

    // If there are no gifts in the target list, display a message
    if (targetGiftIds.length === 0) {
        return '<span class="no-gifts" style="color: var(--text-secondary);">없음</span>';
    }

    // Generate the HTML for each gift icon
    return targetGiftIds.map(giftId => {
        // Extract the last two digits from the ID to build the filename (e.g., 180005 -> 05)
        const fileNumber = String(giftId).slice(-2);
        const imageUrl = `${baseUrl}gift${fileNumber}.png`;

        // Return the HTML for a single gift icon, now using an <img> tag
        return `
            <div class="gift-icon ${type}" data-gift-id="${giftId}">
                <img src="${imageUrl}" alt="Gift ${fileNumber}" title="선물 ID: ${giftId}" style="width: 100%; height: 100%;">
            </div>
        `;
    }).join('');
}

// ===== Stats Calculation =====
function updateStats() {
    if (!currentShip) return;

    const statsGrid = document.getElementById('statsGrid');
    if (!statsGrid) return;

    const baseStats = currentShip.base[currentLimitBreak] || {};
    const growthStats = currentShip.growth[currentLimitBreak] || {};
    // Enhance is NOT organized by limit break - it's a flat object
    const enhanceStats = currentShip.enhance || {};

    const favorabilityBonus = FAVORABILITY_BONUSES[currentFavorability] || 1.06;
    const attrMapping = createAttrMapping();

    statsGrid.innerHTML = Object.keys(baseStats).map(stat => {
        const base = baseStats[stat] || 0;
        const growth = growthStats[stat] || 0;
        const enhanceValue = enhanceStats[stat] || 0;
        const enhance = currentEnhancement === 'complete' ? enhanceValue : 0;

        const bonus = UNAFFECTED_STATS.includes(stat.toLowerCase()) ? 1.0 : favorabilityBonus;
        const calculated = Math.floor((base + (growth * (currentLevel - 1) / 1000) + enhance) * bonus);

        const attrInfo = attrMapping[stat.toLowerCase()] || {};
        const koreanName = attrInfo.condition || stat;
        const icon = attrInfo.icon || '';

        return `
            <div class="stat-item">
                <div class="stat-name">
                    ${icon ? `<img src="${icon}" alt="${koreanName}" style="height: 20px; vertical-align: middle; margin-right: 5px;">` : ''}
                    ${koreanName}
                </div>
                <div class="stat-values">
                    <span class="stat-calculated">${calculated}</span>
                    <div class="stat-breakdown">
                        <span class="stat-base">기본 ${base}</span>
                        <span class="stat-separator">|</span>
                        <span class="stat-growth">성장 ${growth}</span>
                        ${enhance ? `<span class="stat-enhance">강화 ${enhance}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function createAttrMapping() {
    const mapping = {};
    Object.values(attrTypeData).forEach(attr => {
        mapping[attr.name] = attr;
        // Also map name2 if it exists
        if (attr.name2) {
            mapping[attr.name2] = attr;
        }
    });
    return mapping;
}

// ===== Start Application =====
// Scroll to top button is handled globally by global.script.js
init();