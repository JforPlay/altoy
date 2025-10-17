// Global state
let allShips = [];
let nationalityMap = {};
let shipTypeMap = {};
let currentFilters = {
    timer: 'all',
    rarity: 'all',
    search: '',
    construction: 'all'
};

// Load all required data from JSON files
async function loadAllData() {
    try {
        const [shipData, nationalityData, typeData] = await Promise.all([
            fetch('data/ship_const_data.json').then(res => {
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status} for ship_const_data.json`);
                return res.json();
            }),
            fetch('data/nationality_mapping.json').then(res => {
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status} for nationality_mapping.json`);
                return res.json();
            }),
            fetch('data/ship_type_mapping.json').then(res => {
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status} for ship_type_mapping.json`);
                return res.json();
            })
        ]);

        console.log('Loaded ship data:', shipData.length, 'ships');
        console.log('Loaded nationality mapping.');
        console.log('Loaded ship type mapping.');

        return { shipData, nationalityData, typeData };
    } catch (error) {
        console.error('Error loading data:', error);
        throw error;
    }
}

// Get unique timers with counts
function getTimerCounts(ships) {
    const counts = {};
    ships.forEach(ship => {
        const timer = ship.timer || '건조시간 없음';
        counts[timer] = (counts[timer] || 0) + 1;
    });
    return counts;
}

// Sort timers
function sortTimers(timers) {
    return timers.sort((a, b) => {
        if (a === '건조시간 없음') return 1;
        if (b === '건조시간 없음') return -1;

        const [aH, aM, aS] = a.split(':').map(Number);
        const [bH, bM, bS] = b.split(':').map(Number);

        const aSeconds = aH * 3600 + aM * 60 + (aS || 0);
        const bSeconds = bH * 3600 + bM * 60 + (bS || 0);

        return aSeconds - bSeconds;
    });
}

// Format timer
function formatTimer(timer) {
    if (timer === '건조시간 없음') return timer;
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

// Get nationality name from loaded map
function getNationalityName(code) {
    return nationalityMap[code]?.name || `Nation ${code}`;
}

// Get ship type name from loaded map
function getTypeName(code) {
    return shipTypeMap[code]?.type_name || `Type ${code}`;
}

// Create ship card
function createShipCard(ship) {
    const card = document.createElement('div');
    card.className = 'ship-card';
    card.dataset.timer = ship.timer || '건조시간 없음';
    card.dataset.rarity = ship.rarity;
    card.dataset.name = ship.name.toLowerCase();

    if (ship.light) card.dataset.light = 'true';
    if (ship.medium) card.dataset.medium = 'true';
    if (ship.heavy) card.dataset.heavy = 'true';

    let constructionBadges = '';
    if (ship.light) {
        constructionBadges += `<span class="construction-badge">소형 건조</span>`;
    }
    if (ship.medium) {
        constructionBadges += `<span class="construction-badge">중형 건조</span>`;
    }
    if (ship.heavy) {
        constructionBadges += `<span class="construction-badge">특형 건조</span>`;
    }

    let limitedBadge = '';
    if (ship.limited) {
        limitedBadge = `<span class="limited-badge">★ 한정</span>`;
    }

    const typeName = getTypeName(ship.type);
    const nationName = getNationalityName(ship.nationality);

    card.innerHTML = `
        <div class="ship-image-wrapper">
            <img src="${ship.shipyard}" alt="${ship.name}" class="ship-image" loading="lazy" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Crect fill=%22%23141414%22 width=%22200%22 height=%22200%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23666%22 font-size=%2214%22%3ENo Image%3C/text%3E%3C/svg%3E';">
            <div class="ship-overlay">
                <span class="rarity-badge rarity-${ship.rarity}">${ship.rarity}</span>
                <div class="construction-badges-container">
                    ${limitedBadge}${constructionBadges}
                </div>
            </div>
        </div>
        <div class="ship-info">
            <div class="ship-name" title="${ship.name}">${ship.name}</div>
            <div class="ship-meta">
                <span class="meta-tag">${typeName}</span>
                <span class="meta-tag" title="${nationName}">${nationName}</span>
            </div>
        </div>
    `;

    return card;
}

// Handle clicks on ship cards to highlight the timer
function setupGridClickListener() {
    const grid = document.getElementById('shipsGrid');

    grid.addEventListener('click', (e) => {
        // Find the ship card that was clicked
        const card = e.target.closest('.ship-card');
        if (!card) return; // Exit if the click was not on a card

        // Get the timer from the card's data attribute
        const timerToActivate = card.dataset.timer;
        const timerButtonsContainer = document.getElementById('timerFilters');

        // Find the button that matches the card's timer
        const targetButton = timerButtonsContainer.querySelector(`.filter-btn[data-timer="${timerToActivate}"]`);
        if (!targetButton) return; // Exit if no matching button is found

        // Remove 'active' class from all timer buttons
        timerButtonsContainer.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // Add 'active' class to the target button
        targetButton.classList.add('active');

        // Update the global filter state and apply the filter
        currentFilters.timer = timerToActivate;
        filterShips();
    });
}

// ADD this entire new function
function setupConstructionFilters() {
    const container = document.getElementById('constructionFilters');
    
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        
        // Update active state
        container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update filter and apply
        currentFilters.construction = btn.dataset.construction;
        filterShips();
    });
    
    // Set "All" as active by default
    container.querySelector('[data-construction="all"]').classList.add('active');
}

// Filter ships based on current filters
function filterShips() {
    const cards = document.querySelectorAll('.ship-card');
    let visibleCount = 0;

    cards.forEach(card => {
        let show = true;

        // Timer filter
        if (currentFilters.timer !== 'all' && card.dataset.timer !== currentFilters.timer) {
            show = false;
        }

        // Rarity filter
        if (currentFilters.rarity !== 'all' && card.dataset.rarity !== currentFilters.rarity) {
            show = false;
        }

        // Search filter
        if (currentFilters.search && !card.dataset.name.includes(currentFilters.search)) {
            show = false;
        }

        const constructionType = currentFilters.construction;
        if (constructionType !== 'all' && !card.dataset[constructionType]) {
            show = false;
        }

        if (show) {
            card.classList.remove('hidden');
            visibleCount++;
        } else {
            card.classList.add('hidden');
        }
    });

    // Update filtered count
    document.getElementById('filteredShips').textContent = visibleCount;

    // Update current filter display
    updateFilterDisplay();
}

// Update filter display text
function updateFilterDisplay() {
    const filterText = document.getElementById('currentFilter').querySelector('strong');
    const clearBtn = document.getElementById('clearFilter');

    let text = '모두보기';
    let hasFilter = false;

    if (currentFilters.timer !== 'all') {
        text = `타이머: ${formatTimer(currentFilters.timer)}`;
        hasFilter = true;
    }

    if (currentFilters.rarity !== 'all') {
        text = hasFilter ? `${text} + ${currentFilters.rarity}` : `${currentFilters.rarity}`;
        hasFilter = true;
    }

    if (currentFilters.search) {
        text = hasFilter ? `${text} + 이름 검색` : '이름 검색결과';
        hasFilter = true;
    }

    if (currentFilters.construction !== 'all') {
        const textMap = { light: '소형 건조', medium: '중형 건조', heavy: '특형 건조' };
        const constructionText = textMap[currentFilters.construction];
        text = hasFilter ? `${text} + ${constructionText}` : constructionText;
        hasFilter = true;
    }

    filterText.textContent = text;
    clearBtn.style.display = hasFilter ? 'block' : 'none';
}

// Setup timer filters
function setupTimerFilters(ships) {
    const timerCounts = getTimerCounts(ships);
    const sortedTimers = sortTimers(Object.keys(timerCounts));
    const container = document.getElementById('timerFilters');

    // Add "All" option
    const allBtn = document.createElement('button');
    allBtn.className = 'filter-btn active';
    allBtn.dataset.timer = 'all';
    allBtn.innerHTML = `
        <span>전체 선택</span>
        <span class="filter-count">${ships.length}</span>
    `;
    container.appendChild(allBtn);

    // Add individual timers
    sortedTimers.forEach(timer => {
        const btn = document.createElement('button');
        btn.className = 'filter-btn';
        btn.dataset.timer = timer;
        btn.innerHTML = `
            <span>${formatTimer(timer)}</span>
            <span class="filter-count">${timerCounts[timer]}</span>
        `;
        container.appendChild(btn);
    });

    // Add click handlers
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;

        // Update active state
        container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update filter and apply
        currentFilters.timer = btn.dataset.timer;
        filterShips();
    });
}

// Setup rarity filters
function setupRarityFilters() {
    const container = document.getElementById('rarityFilters');

    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;

        // Update active state
        container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update filter and apply
        currentFilters.rarity = btn.dataset.rarity;
        filterShips();
    });

    // Set "All" as active
    container.querySelector('[data-rarity="all"]').classList.add('active');
}

// Setup search
function setupSearch() {
    const searchInput = document.getElementById('searchInput');

    searchInput.addEventListener('input', (e) => {
        currentFilters.search = e.target.value.toLowerCase().trim();
        filterShips();
    });
}

// Clear all filters
function clearFilters() {
    currentFilters = {
        timer: 'all',
        rarity: 'all',
        search: '',
        construction: 'all'
    };

    // Reset UI
    document.getElementById('searchInput').value = '';
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.timer === 'all' || btn.dataset.rarity === 'all' || btn.dataset.construction === 'all') {
            btn.classList.add('active');
        }
    });

    filterShips();
}

// Setup mobile toggle
function setupMobileToggle() {
    const fab = document.getElementById('mobileFilterFab');
    const sidebar = document.getElementById('sidebar');
    
    // This listener opens/closes the sidebar when the floating button is clicked
    fab.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent the document click from immediately closing it
        sidebar.classList.toggle('mobile-open');
    });
    
    // This listener closes the sidebar if you click anywhere outside of it
    document.addEventListener('click', (e) => {
        // Check if the screen is mobile-sized and the sidebar is open
        if (window.innerWidth <= 1024 && sidebar.classList.contains('mobile-open')) {
            // Check if the click was outside the sidebar and not on the button itself
            if (!sidebar.contains(e.target) && !fab.contains(e.target)) {
                sidebar.classList.remove('mobile-open');
            }
        }
    });
}

// Initialize app
async function init() {
    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const grid = document.getElementById('shipsGrid');

    try {
        loading.style.display = 'block';
        error.style.display = 'none';

        // Load all data
        const { shipData, nationalityData, typeData } = await loadAllData();
        allShips = shipData;
        nationalityMap = nationalityData;
        shipTypeMap = typeData;

        if (!allShips || allShips.length === 0) {
            throw new Error('No ship data loaded');
        }

        // Create all ship cards
        allShips.forEach(ship => {
            grid.appendChild(createShipCard(ship));
        });

        // Setup filters
        setupTimerFilters(allShips);
        setupRarityFilters();
        setupConstructionFilters();
        setupSearch();
        setupGridClickListener();

        // Setup clear filter button
        document.getElementById('clearFilter').addEventListener('click', clearFilters);

        // Setup mobile toggle
        setupMobileToggle();

        // Update stats
        document.getElementById('totalShips').textContent = allShips.length;
        document.getElementById('filteredShips').textContent = allShips.length;

        loading.style.display = 'none';
        console.log('Initialization complete!');

    } catch (err) {
        console.error('Initialization error:', err);
        loading.style.display = 'none';
        error.style.display = 'block';
        error.innerHTML = `
            <h3>⚠️ Error Loading Data</h3>
            <p>${err.message}</p>
            <p>Please ensure <code>ship_const_data.json</code>, <code>nationality_mapping.json</code>, and <code>ship_type_mapping.json</code> are in the correct directory.</p>
            <p style="margin-top: 15px; font-size: 0.9em; color: #999;">
                Run a local server to avoid CORS issues.
            </p>
        `;
    }
}

// Start app
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}