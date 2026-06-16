/**
 * event-timeline.js
 * KR server event timeline viewer with search and multi-filter support.
 * Loads kr_event_timeline.json + ship_group_data.json; shipgirl names are normalized for consistent matching.
 */

import {
    createIcon,
    createImgElement,
    debounce,
    fetchJSONWithCache,
    normalizeRomanNumerals,
    renderStatus,
    resolveUrl
} from './utils.js';

// ===== State =====
let eventData = [];
let shipgirlNameMap = new Map(); // Map for O(1) name lookups — see findShipgirlByName
let filteredEvents = [];
let controlsReady = false;

// ===== DOM References =====
const searchInput = document.getElementById('searchInput');
const clearBtn = document.getElementById('clearBtn');
const categoryFilter = document.getElementById('categoryFilter');
const factionFilter = document.getElementById('factionFilter');
const mudakFilter = document.getElementById('mudakFilter');
const rerunStatusFilter = document.getElementById('rerunStatusFilter');
const showJpDatesFilter = document.getElementById('showJpDatesFilter');
const eventList = document.getElementById('eventList');
const eventCount = document.getElementById('eventCount');
const filterControls = [
    searchInput,
    clearBtn,
    categoryFilter,
    factionFilter,
    mudakFilter,
    rerunStatusFilter,
    showJpDatesFilter
].filter(Boolean);

// ===== Data Loading =====

document.addEventListener('DOMContentLoaded', async () => {
    if (!searchInput || !clearBtn || !categoryFilter || !factionFilter || !mudakFilter ||
        !rerunStatusFilter || !showJpDatesFilter || !eventList || !eventCount) {
        console.warn('[Event Timeline] Required elements not found');
        return;
    }

    setupEventListeners();
    setControlsDisabled(true);
    await loadData();
});

/**
 * Load event timeline and ship group data in parallel.
 * Handles both array and object formats for ship data, builds a normalized name Map for lookups.
 */
async function loadData() {
    eventList.setAttribute('aria-busy', 'true');

    try {
        const [eventsData, shipgirlRawData] = await Promise.all([
            fetchJSONWithCache('data/kr_event_timeline.json'),
            fetchJSONWithCache('data/ship_group_data.json')
        ]);

        if (!Array.isArray(eventsData)) {
            throw new Error('Event timeline data was not an array');
        }

        eventData = eventsData;
        shipgirlNameMap = new Map();

        // ship_group_data can be an array (some scripts output it that way) or an object keyed by ID
        if (Array.isArray(shipgirlRawData)) {
            shipgirlRawData.forEach(shipgirl => {
                if (shipgirl?.name) {
                    shipgirlNameMap.set(normalizeRomanNumerals(shipgirl.name.trim()), shipgirl);
                }
            });
        } else if (shipgirlRawData && typeof shipgirlRawData === 'object') {
            Object.values(shipgirlRawData).forEach(shipgirl => {
                if (shipgirl?.name) {
                    shipgirlNameMap.set(normalizeRomanNumerals(shipgirl.name.trim()), shipgirl);
                }
            });
        }

        eventData = eventData.filter(event => String(event?.ID || '').trim() !== '');

        // Newest events first (high ID = more recent)
        eventData.sort((a, b) => (parseInt(b.ID) || 0) - (parseInt(a.ID) || 0));

        populateFilters();
        setControlsDisabled(false);
        filterEvents();
    } catch (error) {
        setControlsDisabled(true);
        renderState(
            '데이터를 불러올 수 없습니다',
            '파일 경로를 확인해주세요: data/kr_event_timeline.json, data/ship_group_data.json',
            'error'
        );
        eventCount.textContent = '총 0개 이벤트';
        console.error('Error loading data:', error);
    } finally {
        eventList.setAttribute('aria-busy', 'false');
    }
}

// ===== Event Listeners & Filters =====

function setupEventListeners() {
    if (controlsReady) return;
    controlsReady = true;

    const debouncedSearch = debounce(handleSearch, 300);
    searchInput.addEventListener('input', debouncedSearch);

    clearBtn.addEventListener('click', clearSearch);
    categoryFilter.addEventListener('change', filterEvents);
    factionFilter.addEventListener('change', filterEvents);
    mudakFilter.addEventListener('change', filterEvents);
    rerunStatusFilter.addEventListener('change', filterEvents);
    showJpDatesFilter.addEventListener('change', filterEvents);
}

function setControlsDisabled(disabled) {
    filterControls.forEach(control => {
        control.disabled = disabled;
    });
}

function populateFilters() {
    const categories = [...new Set(eventData.map(e => e.분류).filter(c => c))];
    const factions = [...new Set(eventData.map(e => e.진영).filter(f => f))];

    categories.sort();
    factions.sort();

    categoryFilter.options.length = 1;
    factionFilter.options.length = 1;

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

function handleSearch() {
    const query = searchInput.value.trim();
    clearBtn.classList.toggle('visible', query.length > 0);
    clearBtn.setAttribute('aria-hidden', query.length > 0 ? 'false' : 'true');
    filterEvents();
}

function clearSearch() {
    searchInput.value = '';
    clearBtn.classList.remove('visible');
    clearBtn.setAttribute('aria-hidden', 'true');
    searchInput.focus();
    filterEvents();
}

/**
 * Apply all active filters (search, category, faction, mudak, rerun status, JP dates toggle)
 * and re-render the event list.
 */
function filterEvents() {
    const searchQuery = normalizeRomanNumerals(searchInput.value.trim()).toLowerCase();
    const selectedCategory = categoryFilter.value;
    const selectedFaction = factionFilter.value;
    const selectedMudak = mudakFilter.value;
    const selectedRerunStatus = rerunStatusFilter.value;
    const showJpDates = showJpDatesFilter.checked;

    filteredEvents = eventData.filter(event => {
        // JP dates appear as date ranges with "~"; hide them by default since KR dates differ
        const hasJpDate = (event.날짜 || '').includes('~');
        if (hasJpDate && !showJpDates) {
            return false;
        }

        if (searchQuery) {
            const eventName = normalizeRomanNumerals(event.이벤트명 || '').toLowerCase();
            const shipgirls = normalizeRomanNumerals(event.함순이 || '').toLowerCase();

            if (!eventName.includes(searchQuery) && !shipgirls.includes(searchQuery)) {
                return false;
            }
        }

        if (selectedCategory && event.분류 !== selectedCategory) return false;
        if (selectedFaction && event.진영 !== selectedFaction) return false;
        if (selectedMudak && event['무딱 이벤?'] !== selectedMudak) return false;

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

// ===== Rendering =====

function displayEvents() {
    eventCount.textContent = `총 ${filteredEvents.length}개 이벤트`;
    eventList.setAttribute('aria-busy', 'false');

    if (filteredEvents.length === 0) {
        renderState('검색 결과가 없습니다', '다른 검색어나 필터를 시도해보세요.', 'empty');
        return;
    }

    const fragment = document.createDocumentFragment();
    filteredEvents.forEach(event => {
        fragment.appendChild(createEventCard(event));
    });
    eventList.replaceChildren(fragment);
}

/**
 * Build the DOM card for a single event entry.
 * Includes badges (category, faction, rerun status) and optional shipgirl icon row.
 */
function createEventCard(event) {
    const card = document.createElement('article');
    card.className = 'event-card';

    const header = document.createElement('div');
    header.className = 'event-header';

    const title = document.createElement('h2');
    title.className = 'event-title';
    title.textContent = event.이벤트명 || '제목 없음';
    header.appendChild(title);

    const badges = document.createElement('div');
    badges.className = 'event-badges';

    if (event.분류) badges.appendChild(createBadge(event.분류, 'badge-category'));
    if (event.진영) badges.appendChild(createBadge(event.진영, 'badge-faction'));
    if (event.복각여부 === '신규') badges.appendChild(createBadge('신규', 'badge-new'));
    if (event.복각여부 === '복각') badges.appendChild(createBadge('복각', 'badge-rerun'));
    if (event.복각여부 === '상시편입') badges.appendChild(createBadge('상시', 'badge-permanent'));

    const externalLink = createEventLink(event.링크);
    if (externalLink) badges.appendChild(externalLink);

    header.appendChild(badges);
    card.appendChild(header);

    const details = [
        { label: '날짜', value: event.날짜 },
        { label: '무딱 이벤', value: event['무딱 이벤?'] },
        { label: '임무 보상', value: event['임무 보상'] },
        { label: '복각까지 얼마나 걸림?', value: event['복각까지 얼마나 걸림?'] },
        { label: '복각부터 상시까지?', value: event['복각부터 상시까지?'] }
    ].filter(d => d.value && d.value !== '-');

    const detailsContainer = document.createElement('div');
    detailsContainer.className = 'event-details';
    details.forEach(detail => {
        detailsContainer.appendChild(createDetailRow(detail.label, detail.value));
    });
    card.appendChild(detailsContainer);

    const shipgirlsSection = createShipgirlsSection(event.함순이);
    if (shipgirlsSection) card.appendChild(shipgirlsSection);

    return card;
}

/**
 * Build the icon row for shipgirls featured in an event.
 * Falls back to a text placeholder if the shipgirl has no icon in ship_group_data.
 */
function createShipgirlsSection(shipgirlsStr) {
    if (!shipgirlsStr || shipgirlsStr === '-') {
        return null;
    }

    const shipgirlNames = shipgirlsStr.split(',').map(name => name.trim()).filter(name => name);

    if (shipgirlNames.length === 0) {
        return null;
    }

    const section = document.createElement('section');
    section.className = 'shipgirl-icons';
    section.setAttribute('aria-label', '등장 함순이');

    const title = document.createElement('div');
    title.className = 'shipgirl-icons-title';
    title.textContent = '등장 함순이';
    section.appendChild(title);

    const iconsContainer = document.createElement('div');
    iconsContainer.className = 'icons-container';

    shipgirlNames.forEach(name => {
        const shipgirl = findShipgirlByName(name);
        iconsContainer.appendChild(createShipgirlIconLink(name, shipgirl));
    });

    section.appendChild(iconsContainer);
    return section;
}

function createBadge(label, className) {
    const badge = document.createElement('span');
    badge.className = `badge ${className}`;
    badge.textContent = label;
    return badge;
}

function createDetailRow(label, value) {
    const row = document.createElement('div');
    row.className = 'detail-row';

    const labelEl = document.createElement('div');
    labelEl.className = 'detail-label';
    labelEl.textContent = `${label}:`;

    const valueEl = document.createElement('div');
    valueEl.className = 'detail-value';
    valueEl.textContent = value;

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
}

function createEventLink(rawUrl) {
    const url = getSafeExternalUrl(rawUrl);
    if (!url) return null;

    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'event-link-btn';
    link.appendChild(createIcon('fas fa-arrow-up-right-from-square'));
    link.append('상세보기');
    return link;
}

function createShipgirlIconLink(sourceName, shipgirl) {
    const displayName = shipgirl?.name || sourceName;
    const linkName = shipgirl?.name || normalizeRomanNumerals(sourceName.trim());
    const shipgirlUrl = resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(linkName)}`);

    const link = document.createElement('a');
    link.href = shipgirlUrl;
    link.className = 'shipgirl-icon-link';
    link.setAttribute('aria-label', `${displayName} 상세 정보 보기`);

    const icon = document.createElement('div');
    icon.className = `shipgirl-icon ${getRarityClass(shipgirl?.rarity)}`;

    if (shipgirl?.icon) {
        const img = createImgElement(shipgirl.icon, displayName);
        img.setAttribute('data-onfail', 'hide');
        icon.appendChild(img);

        const rarity = document.createElement('div');
        rarity.className = 'rarity-indicator';
        rarity.textContent = shipgirl.rarity || '?';
        icon.appendChild(rarity);
    } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'shipgirl-icon-placeholder';
        placeholder.textContent = sourceName;
        icon.appendChild(placeholder);
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.textContent = displayName;
    icon.appendChild(tooltip);

    link.appendChild(icon);
    return link;
}

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

/**
 * Look up a shipgirl by name using the pre-built Map for O(1) access.
 * Name is normalized before lookup to handle Roman numeral variants.
 */
function findShipgirlByName(name) {
    const normalizedName = normalizeRomanNumerals(name.trim());
    return shipgirlNameMap.get(normalizedName) || null;
}

function getSafeExternalUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    try {
        const url = new URL(rawUrl.trim());
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
        return '';
    }
}

/**
 * Render an empty/error state into the event list using the canonical
 * .page-status component (status.css). `title` is the primary message line;
 * `detail` is appended as a secondary muted line.
 */
function renderState(title, detail, type = 'empty') {
    const status = renderStatus(eventList, title, type);
    if (status && detail) {
        const body = document.createElement('p');
        body.className = 'page-status-msg';
        body.textContent = detail;
        status.appendChild(body);
    }
}

// Info popup and scroll-to-top are handled globally by global.script.js

// Release ~700KB of cached event + ship data on page unload so the bfcache
// snapshot doesn't pin them across navigations.
window.addEventListener('pagehide', () => {
    eventData = [];
    shipgirlNameMap = new Map();
    filteredEvents = [];
}, { once: true });
