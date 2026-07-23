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
    getStorageItem,
    normalizeRomanNumerals,
    renderStatus,
    resolveUrl,
    setStorageItem
} from './utils.js';
import { buildGroups, daysBetween, gapLabel, parseEventDate } from './event-timeline.groups.js';

// ===== State =====
let eventData = [];
let shipgirlNameMap = new Map(); // Map for O(1) name lookups — see findShipgirlByName
let filteredEvents = [];
let controlsReady = false;
let groups = new Map();   // group key → group (event-timeline.groups.js buildGroups)
let groupOf = new Map();  // event row object → its group
let selectedGroupKey = null; // 타임라인 view: group whose runs are highlighted
// 'timeline' | 'groups' — plain UI pref (getStorageItem, not synced)
let currentView = getStorageItem('eventTimelineView', 'timeline') === 'groups' ? 'groups' : 'timeline';

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
const viewTimelineBtn = document.getElementById('viewTimelineBtn');
const viewGroupsBtn = document.getElementById('viewGroupsBtn');
const filterControls = [
    searchInput,
    clearBtn,
    categoryFilter,
    factionFilter,
    mudakFilter,
    rerunStatusFilter,
    showJpDatesFilter,
    viewTimelineBtn,
    viewGroupsBtn
].filter(Boolean);

// ===== Data Loading =====

document.addEventListener('DOMContentLoaded', async () => {
    if (!searchInput || !clearBtn || !categoryFilter || !factionFilter || !mudakFilter ||
        !rerunStatusFilter || !showJpDatesFilter || !eventList || !eventCount ||
        !viewTimelineBtn || !viewGroupsBtn) {
        console.warn('[Event Timeline] Required elements not found');
        return;
    }

    setupEventListeners();
    syncViewButtons();
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

        // ship_group_data can be an array (some scripts output it that way) or an object
        // keyed by group id. Capture that key as the stable gid so the shipgirl-info link
        // resolves by id, not by the (drift-prone) name. See reference_gid_linking.
        const indexShipgirl = (shipgirl, key) => {
            if (!shipgirl?.name) return;
            const gid = shipgirl.gid ?? shipgirl.id ?? shipgirl.group_id ?? key;
            shipgirlNameMap.set(normalizeRomanNumerals(shipgirl.name.trim()), { ...shipgirl, gid });
        };
        if (Array.isArray(shipgirlRawData)) {
            shipgirlRawData.forEach(shipgirl => indexShipgirl(shipgirl, undefined));
        } else if (shipgirlRawData && typeof shipgirlRawData === 'object') {
            Object.entries(shipgirlRawData).forEach(([key, shipgirl]) => indexShipgirl(shipgirl, key));
        }

        eventData = eventData.filter(event => String(event?.ID || '').trim() !== '');

        // Newest events first (high ID = more recent)
        eventData.sort((a, b) => (parseInt(b.ID) || 0) - (parseInt(a.ID) || 0));

        groups = buildGroups(eventData);
        groupOf = new Map();
        groups.forEach(g => g.runs.forEach(r => groupOf.set(r.event, g)));

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

    viewTimelineBtn.addEventListener('click', () => setView('timeline'));
    viewGroupsBtn.addEventListener('click', () => setView('groups'));

    // Group selection: delegate on the list; links/buttons keep their behavior
    eventList.addEventListener('click', e => {
        if (e.target.closest('a, button')) return;
        const card = e.target.closest('.event-card');
        const group = card ? groups.get(card.dataset.groupKey) : null;
        const visibleSiblings = group
            ? eventList.querySelectorAll(`.event-card[data-group-key="${group.key}"]`).length
            : 0;
        if (!group || visibleSiblings < 2) {
            clearGroupSelection();
            return;
        }
        if (selectedGroupKey === group.key) clearGroupSelection();
        else selectGroup(group.key);
    });
    // Card heights shift on resize / late image loads → keep the rail aligned
    window.addEventListener('resize', redrawRail);
    eventList.addEventListener('load', redrawRail, true);
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
    clearGroupSelection();
    eventList.setAttribute('aria-busy', 'false');
    if (currentView === 'groups') renderGroupView();
    else renderTimelineView();
}

function renderTimelineView() {
    eventCount.textContent = `총 ${filteredEvents.length}개 이벤트`;
    if (filteredEvents.length === 0) {
        renderState('검색 결과가 없습니다', '다른 검색어나 필터를 시도해보세요.', 'empty');
        return;
    }
    const fragment = document.createDocumentFragment();
    let lastYear = null;
    filteredEvents.forEach(event => {
        // ponytail: dividers track card order (ID desc ≈ date desc); an
        // out-of-order row can repeat a year header — harmless, data is
        // ID-chronological in practice.
        const year = parseEventDate(event.날짜)?.getFullYear() ?? null;
        if (year !== null && year !== lastYear) {
            const divider = document.createElement('div');
            divider.className = 'year-divider';
            divider.textContent = String(year);
            fragment.appendChild(divider);
            lastYear = year;
        }
        fragment.appendChild(createEventCard(event));
    });
    eventList.replaceChildren(fragment);
}

// ===== View toggle (타임라인 / 이벤트별) =====

function syncViewButtons() {
    viewTimelineBtn.classList.toggle('is-active', currentView === 'timeline');
    viewGroupsBtn.classList.toggle('is-active', currentView === 'groups');
}

function setView(view) {
    if (view === currentView) return;
    currentView = view;
    setStorageItem('eventTimelineView', view);
    syncViewButtons();
    displayEvents();
}

// ===== Group selection (타임라인 view) =====
// Click a multi-run card → highlight its sibling runs, dim the rest, draw an
// on-demand SVG rail connecting them (only ever ONE group's rail — never all).

function clearGroupSelection() {
    selectedGroupKey = null;
    eventList.classList.remove('group-dimmed');
    eventList.querySelectorAll('.event-card.group-selected').forEach(c => c.classList.remove('group-selected'));
    eventList.querySelectorAll('.group-jump').forEach(el => el.remove());
    eventList.querySelector('.group-rail')?.remove();
}

function selectGroup(key) {
    clearGroupSelection();
    selectedGroupKey = key;
    eventList.classList.add('group-dimmed');
    // DOM order = newest first (ID desc); runs read bottom-up chronologically
    const cards = [...eventList.querySelectorAll(`.event-card[data-group-key="${key}"]`)];
    cards.forEach((card, idx) => {
        card.classList.add('group-selected');
        card.appendChild(createJumpRow(cards, idx));
    });
    drawGroupRail(cards);
}

function createJumpRow(cards, idx) {
    const row = document.createElement('div');
    row.className = 'group-jump';
    const jumpBtn = (label, target) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-outline btn-sm';
        b.textContent = label;
        b.addEventListener('click', () => target.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        return b;
    };
    // newest-first DOM: the chronologically PREVIOUS run sits BELOW (idx+1)
    if (idx < cards.length - 1) row.appendChild(jumpBtn('↓ 이전 런', cards[idx + 1]));
    if (idx > 0) row.appendChild(jumpBtn('↑ 다음 런', cards[idx - 1]));
    return row;
}

function drawGroupRail(cards) {
    eventList.querySelector('.group-rail')?.remove();
    if (cards.length < 2) return;
    const NS = 'http://www.w3.org/2000/svg';
    const listTop = eventList.getBoundingClientRect().top;
    const ys = cards.map(c => {
        const r = c.getBoundingClientRect();
        return r.top - listTop + r.height / 2;
    });
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'group-rail');
    svg.setAttribute('width', '28');
    svg.setAttribute('height', String(eventList.scrollHeight));
    svg.setAttribute('aria-hidden', 'true');
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', '14');
    line.setAttribute('x2', '14');
    line.setAttribute('y1', String(Math.min(...ys)));
    line.setAttribute('y2', String(Math.max(...ys)));
    svg.appendChild(line);
    for (const y of ys) {
        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('cx', '14');
        dot.setAttribute('cy', String(y));
        dot.setAttribute('r', '5');
        svg.appendChild(dot);
    }
    eventList.appendChild(svg);
}

const redrawRail = debounce(() => {
    if (!selectedGroupKey) return;
    drawGroupRail([...eventList.querySelectorAll('.event-card.group-selected')]);
}, 150);

// ===== 이벤트별 view =====
// One card per group. A group is visible when ANY of its runs passed the
// filters; the run strip always shows the full history (incl. JP-dated runs)
// because it is context, not a listing.

const STATUS_META = {
    '신규': { label: '신규', cls: 'new' },
    '복각': { label: '복각', cls: 'rerun' },
    '상시편입': { label: '상시', cls: 'permanent' }
};

// Elapsed-counter category allowlist: 기타/콜라보/META전 etc. are one-off or
// irregularly kept by the curator, so a days-since counter is noise there.
const COUNTER_CATEGORIES = new Set(['대형', '중형', '소형', '한정 임무']);

function renderGroupView() {
    const seen = new Set();
    const visible = [];
    filteredEvents.forEach(event => {
        const g = groupOf.get(event);
        if (g && !seen.has(g.key)) {
            seen.add(g.key);
            visible.push(g);
        }
    });
    visible.sort((a, b) => (b.latestDate?.getTime() ?? 0) - (a.latestDate?.getTime() ?? 0));

    eventCount.textContent = `총 ${visible.length}개 이벤트 그룹`;
    if (visible.length === 0) {
        renderState('검색 결과가 없습니다', '다른 검색어나 필터를 시도해보세요.', 'empty');
        return;
    }
    const fragment = document.createDocumentFragment();
    visible.forEach(g => fragment.appendChild(createGroupCard(g)));
    eventList.replaceChildren(fragment);
}

function createGroupCard(group) {
    const latest = group.latestRun.event;
    const card = document.createElement('article');
    card.className = 'event-card group-card';

    const header = document.createElement('div');
    header.className = 'event-header';

    const title = document.createElement('h2');
    title.className = 'event-title';
    title.textContent = latest.이벤트명 || '제목 없음';
    header.appendChild(title);

    // Badges reflect the LATEST run; details below come from the anchor run.
    const badges = document.createElement('div');
    badges.className = 'event-badges';
    if (latest.분류) badges.appendChild(createBadge(latest.분류, 'badge-category'));
    if (latest.진영) badges.appendChild(createBadge(latest.진영, 'badge-faction'));
    if (latest.복각여부 === '신규') badges.appendChild(createBadge('신규', 'badge-new'));
    if (latest.복각여부 === '복각') badges.appendChild(createBadge('복각', 'badge-rerun'));
    if (latest.복각여부 === '상시편입') badges.appendChild(createBadge('상시', 'badge-permanent'));
    const externalLink = createEventLink(latest.링크 || group.anchor.링크);
    if (externalLink) badges.appendChild(externalLink);
    header.appendChild(badges);
    card.appendChild(header);

    card.appendChild(createRunStrip(group));

    // Elapsed counter: runs after 신규 AND after 복각; only 상시편입 stops it.
    // Gated on the category allowlist; one-off rows (empty 복각여부) never get one.
    if (COUNTER_CATEGORIES.has(latest.분류) &&
        (group.latestStatus === '신규' || group.latestStatus === '복각') && group.latestDate) {
        const elapsed = document.createElement('div');
        elapsed.className = 'group-elapsed';
        elapsed.textContent = `마지막 오픈 후 ${daysBetween(group.latestDate, new Date())}일 경과`;
        card.appendChild(elapsed);
    }

    const anchor = group.anchor;
    const details = [
        { label: '무딱 이벤', value: anchor['무딱 이벤?'] },
        { label: '임무 보상', value: anchor['임무 보상'] }
    ].filter(d => d.value && d.value !== '-');
    const detailsContainer = document.createElement('div');
    detailsContainer.className = 'event-details';
    details.forEach(d => detailsContainer.appendChild(createDetailRow(d.label, d.value)));
    card.appendChild(detailsContainer);

    const ships = createShipgirlsSection(anchor.함순이);
    if (ships) card.appendChild(ships);

    return card;
}

function createRunStrip(group) {
    const strip = document.createElement('div');
    strip.className = 'run-strip';
    group.runs.forEach((run, i) => {
        if (i > 0) {
            const gap = document.createElement('span');
            gap.className = 'run-strip-gap';
            gap.textContent = group.gaps[i - 1] != null ? `+${group.gaps[i - 1]}일 →` : '→';
            strip.appendChild(gap);
        }
        const meta = STATUS_META[run.event.복각여부] || { label: '개최', cls: 'other' };
        const stop = document.createElement('span');
        stop.className = `run-strip-stop run-strip-stop--${meta.cls}`;
        stop.textContent = `${meta.label} ${formatRunDate(run)}`;
        strip.appendChild(stop);
    });
    return strip;
}

function formatRunDate(run) {
    if (run.date) {
        return `${run.date.getFullYear()}.${run.date.getMonth() + 1}.${run.date.getDate()}`;
    }
    return (run.event.날짜 || '').trim() || '날짜 미상';
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

    const group = groupOf.get(event);
    if (group) {
        card.dataset.groupKey = group.key;
        if (group.runs.length > 1) {
            card.classList.add('event-card--grouped');
            const runIndex = group.runs.findIndex(r => r.event === event);
            const label = gapLabel(group, runIndex);
            if (label) badges.appendChild(createBadge(label, 'badge-gap'));
        }
    }

    const externalLink = createEventLink(event.링크);
    if (externalLink) badges.appendChild(externalLink);

    header.appendChild(badges);
    card.appendChild(header);

    const details = [
        { label: '날짜', value: event.날짜 },
        { label: '무딱 이벤', value: event['무딱 이벤?'] },
        { label: '임무 보상', value: event['임무 보상'] }
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
    link.className = 'btn btn-outline btn-sm event-link-btn';
    link.appendChild(createIcon('fas fa-arrow-up-right-from-square'));
    link.append('상세보기');
    return link;
}

function createShipgirlIconLink(sourceName, shipgirl) {
    const displayName = shipgirl?.name || sourceName;
    const linkName = shipgirl?.name || normalizeRomanNumerals(sourceName.trim());
    const gid = shipgirl?.gid;
    const shipgirlUrl = resolveUrl(
        `shipgirl/shipgirl-info/?ship=${encodeURIComponent(linkName)}${gid != null ? `&gid=${encodeURIComponent(gid)}` : ''}`
    );

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
    groups = new Map();
    groupOf = new Map();
}, { once: true });
