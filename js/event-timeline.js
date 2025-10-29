// Global data storage
let eventData = [];
let shipgirlData = {};
let shipgirlNameMap = new Map(); // Optimized lookup by name
let filteredEvents = [];

// DOM elements
const searchInput = document.getElementById('searchInput');
const clearBtn = document.getElementById('clearBtn');
const categoryFilter = document.getElementById('categoryFilter');
const factionFilter = document.getElementById('factionFilter');
const mudakFilter = document.getElementById('mudakFilter');
const rerunStatusFilter = document.getElementById('rerunStatusFilter');
const showJpDatesFilter = document.getElementById('showJpDatesFilter');
const eventList = document.getElementById('eventList');
const eventCount = document.getElementById('eventCount');

// Utility: Debounce function for performance optimization
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Load data on page load
document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    setupEventListeners();
});

// Load JSON data
async function loadData() {
    try {
        // Load both JSON files
        const [eventsResponse, shipgirlsResponse] = await Promise.all([
            fetch('data/kr_event_timeline.json'),
            fetch('data/ship_group_data.json')
        ]);

        eventData = await eventsResponse.json();
        const shipgirlRawData = await shipgirlsResponse.json();

        // Convert shipgirl data to object for easier lookup
        // Check if it's already an object or an array
        if (Array.isArray(shipgirlRawData)) {
            shipgirlData = {};
            shipgirlRawData.forEach(shipgirl => {
                if (shipgirl.id) {
                    shipgirlData[shipgirl.id.toString()] = shipgirl;
                }
                // Build name-based lookup map for O(1) access
                if (shipgirl.name) {
                    shipgirlNameMap.set(shipgirl.name.trim(), shipgirl);
                }
            });
        } else {
            // If it's already an object, use it directly
            shipgirlData = shipgirlRawData;
            // Build name map from object
            Object.values(shipgirlData).forEach(shipgirl => {
                if (shipgirl.name) {
                    shipgirlNameMap.set(shipgirl.name.trim(), shipgirl);
                }
            });
        }

        // Filter out events with empty ID
        eventData = eventData.filter(event => event.ID && event.ID.trim() !== '');

        // Sort events by ID in reverse order (high to low)
        eventData.sort((a, b) => {
            const idA = parseInt(a.ID) || 0;
            const idB = parseInt(b.ID) || 0;
            return idB - idA;
        });

        // Initialize filters
        populateFilters();

        // Start with filtered view (hide JP dates by default)
        filterEvents();
    } catch (error) {
        eventList.innerHTML = `
            <div class="no-results">
                <h2>데이터를 불러올 수 없습니다</h2>
                <p>파일 경로를 확인해주세요: data/kr_event_timeline.json, data/shipgirl_group_data.json</p>
            </div>
        `;
        console.error('Error loading data:', error);
    }
}

// Setup event listeners
function setupEventListeners() {
    // Debounce search input for better performance (300ms delay)
    const debouncedSearch = debounce(handleSearch, 300);
    searchInput.addEventListener('input', debouncedSearch);

    clearBtn.addEventListener('click', clearSearch);
    categoryFilter.addEventListener('change', filterEvents);
    factionFilter.addEventListener('change', filterEvents);
    mudakFilter.addEventListener('change', filterEvents);
    rerunStatusFilter.addEventListener('change', filterEvents);
    showJpDatesFilter.addEventListener('change', filterEvents);
}

// Populate filter dropdowns
function populateFilters() {
    const categories = [...new Set(eventData.map(e => e.분류).filter(c => c))];
    const factions = [...new Set(eventData.map(e => e.진영).filter(f => f))];

    categories.sort();
    factions.sort();

    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        categoryFilter.appendChild(option);
    });

    factions.forEach(faction => {
        const option = document.createElement('option');
        option.value = faction;
        option.textContent = faction;
        factionFilter.appendChild(option);
    });
}

// Handle search input
function handleSearch() {
    const query = searchInput.value.trim();

    // Show/hide clear button
    clearBtn.classList.toggle('visible', query.length > 0);

    filterEvents();
}

// Clear search
function clearSearch() {
    searchInput.value = '';
    clearBtn.classList.remove('visible');
    filterEvents();
}

// Filter events based on all criteria
function filterEvents() {
    const searchQuery = searchInput.value.trim().toLowerCase();
    const selectedCategory = categoryFilter.value;
    const selectedFaction = factionFilter.value;
    const selectedMudak = mudakFilter.value;
    const selectedRerunStatus = rerunStatusFilter.value;
    const showJpDates = showJpDatesFilter.checked;

    filteredEvents = eventData.filter(event => {
        // JP date filter (dates with "~" character)
        const hasJpDate = (event.날짜 || '').includes('~');
        if (hasJpDate && !showJpDates) {
            return false;
        }

        // Search filter (event name or shipgirl names)
        if (searchQuery) {
            const eventName = (event.이벤트명 || '').toLowerCase();
            const shipgirls = (event.함순이 || '').toLowerCase();

            if (!eventName.includes(searchQuery) && !shipgirls.includes(searchQuery)) {
                return false;
            }
        }

        // Category filter
        if (selectedCategory && event.분류 !== selectedCategory) {
            return false;
        }

        // Faction filter
        if (selectedFaction && event.진영 !== selectedFaction) {
            return false;
        }

        // Mudak filter
        if (selectedMudak && event['무딱 이벤?'] !== selectedMudak) {
            return false;
        }

        // Rerun status filter
        if (selectedRerunStatus) {
            if (selectedRerunStatus === 'empty') {
                if (event.복각여부 && event.복각여부 !== '') {
                    return false;
                }
            } else {
                if (event.복각여부 !== selectedRerunStatus) {
                    return false;
                }
            }
        }

        return true;
    });

    displayEvents();
}

// Display filtered events
function displayEvents() {
    // Update count
    eventCount.textContent = `총 ${filteredEvents.length}개 이벤트`;

    // Check if no results
    if (filteredEvents.length === 0) {
        eventList.innerHTML = `
            <div class="no-results">
                <h2>검색 결과가 없습니다</h2>
                <p>다른 검색어나 필터를 시도해보세요.</p>
            </div>
        `;
        return;
    }

    // Display events
    eventList.innerHTML = filteredEvents.map(event => createEventCard(event)).join('');
}

// Create event card HTML
function createEventCard(event) {
    const badges = [];

    if (event.분류) {
        badges.push(`<span class="badge badge-category">${event.분류}</span>`);
    }

    if (event.진영) {
        badges.push(`<span class="badge badge-faction">${event.진영}</span>`);
    }

    // Add badge based on 복각여부 field value
    if (event.복각여부 === '신규') {
        badges.push(`<span class="badge badge-new">신규</span>`);
    } else if (event.복각여부 === '복각') {
        badges.push(`<span class="badge badge-rerun">복각</span>`);
    } else if (event.복각여부 === '상시편입') {
        badges.push(`<span class="badge badge-permanent">상시</span>`);
    }

    const details = [
        { label: '날짜', value: event.날짜 },
        { label: '무딱 이벤', value: event['무딱 이벤?'] },
        { label: '임무 보상', value: event['임무 보상'] },
        { label: '복각까지 얼마나 걸림?', value: event['복각까지 얼마나 걸림?'] },
        { label: '복각부터 상시까지?', value: event['복각부터 상시까지?'] }
    ].filter(d => d.value && d.value !== '-');

    const shipgirlsSection = createShipgirlsSection(event.함순이);

    // Check if event has a link
    const hasLink = event.링크 && event.링크.trim() !== '';
    const linkButton = hasLink ? `<a href="${event.링크}" target="_blank" class="event-link-btn" onclick="event.stopPropagation()">🔗 상세보기</a>` : '';

    return `
        <div class="event-card">
            <div class="event-header">
                <div class="event-title">
                    ${event.이벤트명 || '제목 없음'}
                </div>
                <div class="event-badges">
                    ${badges.join('')}
                    ${linkButton}
                </div>
            </div>
            <div class="event-details">
                ${details.map(d => `
                    <div class="detail-row">
                        <div class="detail-label">${d.label}:</div>
                        <div class="detail-value">${d.value}</div>
                    </div>
                `).join('')}
            </div>
            ${shipgirlsSection}
        </div>
    `;
}

// Create shipgirls icons section
function createShipgirlsSection(shipgirlsStr) {
    if (!shipgirlsStr || shipgirlsStr === '-') {
        return '';
    }

    // Split by comma and trim whitespace
    const shipgirlNames = shipgirlsStr.split(',').map(name => name.trim()).filter(name => name);

    if (shipgirlNames.length === 0) {
        return '';
    }

    const icons = shipgirlNames.map(name => {
        const shipgirl = findShipgirlByName(name);

        if (shipgirl) {
            const rarityClass = getRarityClass(shipgirl.rarity);
            const shipgirlUrl = `pages/shipgirl/shipgirl-info.html?ship=${encodeURIComponent(name)}`;
            return `
                <a href="${shipgirlUrl}" class="shipgirl-icon-link">
                    <div class="shipgirl-icon ${rarityClass}">
                        <img src="${shipgirl.icon}" alt="${shipgirl.name}" onerror="this.style.display='none'">
                        <div class="rarity-indicator">${shipgirl.rarity || '?'}</div>
                        <div class="tooltip">${shipgirl.name}</div>
                    </div>
                </a>
            `;
        } else {
            // If icon not found, show text only with link
            const shipgirlUrl = `pages/shipgirl/shipgirl-info.html?ship=${encodeURIComponent(name)}`;
            return `
                <a href="${shipgirlUrl}" class="shipgirl-icon-link">
                    <div class="shipgirl-icon rarity-unknown">
                        <div class="shipgirl-icon-placeholder">${name}</div>
                        <div class="tooltip">${name}</div>
                    </div>
                </a>
            `;
        }
    }).join('');

    return `
        <div class="shipgirl-icons">
            <div class="shipgirl-icons-title">등장 함선</div>
            <div class="icons-container">
                ${icons}
            </div>
        </div>
    `;
}

// Get rarity class for styling
function getRarityClass(rarity) {
    const rarityMap = {
        'N': 'rarity-n',
        'R': 'rarity-r',
        'SR': 'rarity-sr',
        'SSR': 'rarity-ssr',
        'UR': 'rarity-ur'
    };
    return rarityMap[rarity] || 'rarity-unknown';
}

// Find shipgirl by name in shipgirl_data
// Optimized with Map for O(1) lookup instead of O(n) iteration
function findShipgirlByName(name) {
    const cleanName = name.trim();
    return shipgirlNameMap.get(cleanName) || null;
}

// Info popup and scroll-to-top are handled globally by global.script.js