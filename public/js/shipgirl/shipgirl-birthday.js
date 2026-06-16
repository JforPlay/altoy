/**
 * shipgirl-birthday.js
 * Birthday calendar for all shipgirls. Supports year/month/week/day views,
 * Fuse.js search with fuzzy match highlighting, upcoming birthdays sidebar,
 * and URL-persisted view/date state.
 */

import { fetchJSON, resolveUrl, getStorageItem, setStorageItem, createSearchIndex, ensureFuse, getUrlParam, setUrlParams, debounce, createImgElement, createMaterialIcon, sanitizeClassToken, renderStatus } from '../utils.js';

(() => {
    /**
     * Original state & DOM (kept as-is)
     */
    const state = {
        events: [],
        eventsByDate: {},
        currentDate: new Date(),
        currentView: 'year',
        searchQuery: '',
        fuse: null
    };
    const CACHE_KEY = 'altoy_birthday_data';
    const CACHE_TIMESTAMP_KEY = 'altoy_birthday_data_timestamp';
    const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
    const PLACEHOLDER_32 = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"%3E%3Crect width="32" height="32" fill="%23ddd"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="10" fill="%23999"%3E?%3C/text%3E%3C/svg%3E';
    const PLACEHOLDER_48 = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"%3E%3Crect width="48" height="48" fill="%23ddd"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="12" fill="%23999"%3E?%3C/text%3E%3C/svg%3E';
    const PLACEHOLDER_56 = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56"%3E%3Crect width="56" height="56" fill="%23ddd"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="14" fill="%23999"%3E?%3C/text%3E%3C/svg%3E';

    const calendarContainer = document.getElementById('calendarContainer');
    const upcomingList = document.getElementById('upcomingList');
    const viewButtons = document.querySelectorAll('.view-toggle');
    const calendarTitle = document.getElementById('calendarTitle');
    const searchInput = document.getElementById('searchInput');
    const searchDropdown = document.getElementById('searchDropdown');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarClose = document.getElementById('sidebarClose');
    const upcomingPanel = document.getElementById('upcomingPanel');
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');

    // ===== Template References =====
    const eventCardTemplate = document.getElementById('event-card-template');
    const eventCardEmptyTemplate = document.getElementById('event-card-empty-template');
    const upcomingItemTemplate = document.getElementById('upcoming-item-template');
    const searchResultTemplate = document.getElementById('search-result-template');
    const noResultsTemplate = document.getElementById('no-results-template');

    if (!calendarContainer || !upcomingList || !calendarTitle || !viewButtons.length || !searchInput || !searchDropdown || !sidebarToggle || !upcomingPanel) {
        console.error('필수 DOM 요소를 찾지 못했습니다. 초기화 중단.');
        const container = document.querySelector('.birthday-container');
        renderStatus(container, '오류: 캘린더 초기화에 실패했습니다. 페이지를 새로고침해 주세요.', 'error');
        return;
    }

    if (!eventCardTemplate || !eventCardEmptyTemplate || !upcomingItemTemplate || !searchResultTemplate || !noResultsTemplate) {
        console.error('필수 템플릿 요소를 찾지 못했습니다. 초기화 중단.');
        return;
    }

    // Injected controls (created at runtime to avoid touching HTML)
    let todayBtn = null;
    let dayToggleBtn = null;
    let renderTimer = null;
    let fadeTimer = null;
    let searchInitialized = false;

    // ===== Utilities =====
    const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

    const isToday = (y, m, d) => {
        const t = new Date();
        return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
    };
    const monthNamesKR = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
    const dowNamesKR = ['일', '월', '화', '수', '목', '금', '토'];

    function attachIconFallback(img, placeholder) {
        img.addEventListener('error', () => {
            img.src = placeholder;
            img.style.opacity = '0.5';
        }, { once: true });
    }

    function createImageWithFallback(src, alt, className, title) {
        const img = createImgElement((src && src !== 'undefined') ? src : PLACEHOLDER_32, alt, { className });
        if (title) img.title = title;
        attachIconFallback(img, PLACEHOLDER_32);
        return img;
    }

    function createNavButton(action, iconName, label, extraClass = '') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = extraClass ? `nav-btn ${extraClass}` : 'nav-btn';
        button.dataset.action = action;
        button.setAttribute('aria-label', label);
        button.appendChild(createMaterialIcon(iconName));
        return button;
    }

    // ===== Data Loading =====

    /** Read event data from localStorage if the 24-hour cache is still valid. */
    function getCachedData() {
        try {
            const timestamp = getStorageItem(CACHE_TIMESTAMP_KEY, null);
            if (timestamp && Date.now() - parseInt(timestamp) < CACHE_DURATION) {
                const cached = getStorageItem(CACHE_KEY, null);
                return cached ? JSON.parse(cached) : null;
            }
        } catch (e) { console.warn('캐시 읽기 실패:', e); }
        return null;
    }
    function cacheData(data) {
        try {
            setStorageItem(CACHE_KEY, JSON.stringify(data));
            setStorageItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
        } catch (e) { console.warn('캐시 저장 실패:', e); }
    }

    function loadData() {
        renderStatus(calendarContainer, '생일 데이터를 불러오는 중...', 'loading');
        renderStatus(upcomingList, '불러오는 중...', 'loading', { compact: true });
        const cached = getCachedData();
        if (cached) { processData(cached); return; }

        fetchJSON('data/shipgirl/shipgirl_birthday_data.json')
            .then(data => { cacheData(data); processData(data); })
            .catch(err => {
                console.error('데이터 로드 실패:', err);
                renderLoadError(err);
            });
    }

    function renderLoadError(err) {
        const status = renderStatus(calendarContainer, '생일 데이터 로드 실패', 'error');
        if (status) {
            const detail = document.createElement('p');
            detail.className = 'page-status-msg';
            detail.textContent = err?.message || '알 수 없는 오류가 발생했습니다.';
            status.appendChild(detail);

            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'page-status-retry';
            retry.textContent = '다시 시도';
            retry.addEventListener('click', loadData);
            status.appendChild(retry);
        }

        renderStatus(upcomingList, '로드 실패', 'error', { compact: true });
    }

    /**
     * Validate input shape, normalize raw JSON into event objects (dropping
     * entries with empty names or out-of-range month/day), build the date
     * lookup map, initialize search, and trigger initial render.
     */
    function processData(data) {
        if (!Array.isArray(data)) {
            renderLoadError(new Error('생일 데이터 형식이 올바르지 않습니다.'));
            return;
        }

        // Normalize as per existing schema
        state.events = data.map(item => ({
            id: item.ID,
            name: item['룽섭 이름'],
            rarity: item['레어도'],
            type: item['함종'],
            faction: item['진영'],
            year: parseInt(item['연']) || null,
            month: parseInt(item['월']),
            day: parseInt(item['일']),
            icon: item.icon,
            groupId: item.group_id
        })).filter(ev => {
            if (!ev.name || ev.month < 1 || ev.month > 12) return false;
            const maxDay = new Date(2000, ev.month, 0).getDate();
            return ev.day >= 1 && ev.day <= maxDay;
        });
        initializeSearch();
        rebuildEventsByDate();
        renderUpcoming();
        renderView();
    }

    /** Rebuild the MM-DD keyed lookup map, optionally filtering by the current search query. */
    function rebuildEventsByDate() {
        state.eventsByDate = {};
        const filtered = state.searchQuery ? state.events.filter(ev => ev.name?.toLowerCase().includes(state.searchQuery.toLowerCase())) : state.events;
        for (const ev of filtered) {
            const key = `${pad2(ev.month)}-${pad2(ev.day)}`;
            (state.eventsByDate[key] ||= []).push(ev);
        }
        // Sort each bucket for stable rendering
        for (const k in state.eventsByDate) state.eventsByDate[k].sort((a, b) => a.name.localeCompare(b.name));
    }

    // ===== Search =====

    /** Initialize the Fuse.js index and attach input/click handlers for the search dropdown. */
    async function initializeSearch() {
        await ensureFuse();
        state.fuse = createSearchIndex(state.events, { keys: ['name', 'type', 'faction'] });
        if (searchInitialized) return;

        const debouncedSearch = debounce(handleSearch, 150);
        searchInput.addEventListener('input', debouncedSearch, { passive: true });
        searchInput.addEventListener('focus', handleSearch, { passive: true });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.dropdown-container')) searchDropdown.style.display = 'none';
        });
        searchInitialized = true;
    }

    function handleSearch() {
        const query = searchInput.value.trim();
        state.searchQuery = query;
        if (!query) {
            searchDropdown.style.display = 'none';
            rebuildEventsByDate();
            renderView();
            renderUpcoming();
            return;
        }
        const results = state.fuse
            ? state.fuse.search(query, { limit: 10 })
            : state.events
                .filter(ev => [ev.name, ev.type, ev.faction].some(value => value?.toLowerCase().includes(query.toLowerCase())))
                .slice(0, 10)
                .map(item => ({ item, matches: [] }));
        displaySearchResults(results);
    }

    function appendHighlightedText(target, text, indices = []) {
        target.textContent = '';
        let last = 0;
        for (const [start, end] of indices) {
            if (start > last) {
                target.appendChild(document.createTextNode(text.substring(last, start)));
            }
            const mark = document.createElement('mark');
            mark.textContent = text.substring(start, end + 1);
            target.appendChild(mark);
            last = end + 1;
        }
        if (last < text.length) {
            target.appendChild(document.createTextNode(text.substring(last)));
        }
    }

    function displaySearchResults(results) {
        searchDropdown.replaceChildren();
        if (!results.length) {
            const noResults = noResultsTemplate.content.cloneNode(true);
            searchDropdown.appendChild(noResults);
            searchDropdown.style.display = 'block';
            return;
        }
        const frag = document.createDocumentFragment();
        results.forEach(r => {
            const it = r.item;
            const clone = searchResultTemplate.content.cloneNode(true);
            const link = clone.querySelector('.search-result-item');

            // Handle name highlighting for fuzzy matches
            const nameEl = clone.querySelector('.search-name');
            if (r.matches) {
                const m = r.matches.find(mm => mm.key === 'name');
                if (m) {
                    appendHighlightedText(nameEl, it.name, m.indices);
                } else {
                    nameEl.textContent = it.name;
                }
            } else {
                nameEl.textContent = it.name;
            }

            const monthName = new Date(2000, it.month - 1, 1).toLocaleDateString('ko-KR', { month: 'long' });
            const metaEl = clone.querySelector('.search-meta');
            metaEl.textContent = `${monthName} ${it.day} • ${it.type} • ${it.faction}`;

            link.addEventListener('click', (e) => {
                e.preventDefault();
                
                // Navigate to the shipgirl's birthday
                const year = state.currentDate.getFullYear();
                state.currentDate = new Date(year, it.month - 1, it.day);
                state.currentView = 'day';
                
                // Clear search and hide dropdown
                searchInput.value = '';
                state.searchQuery = '';
                searchDropdown.style.display = 'none';
                
                rebuildEventsByDate();
                renderView();
                renderUpcoming();
            });

            frag.appendChild(clone);
        });
        searchDropdown.appendChild(frag);
        searchDropdown.style.display = 'block';
    }

    // ===== Upcoming Events Sidebar =====

    /**
     * Return the next N upcoming birthdays, rolling over to the following year
     * for any dates that have already passed in the current year.
     */
    function getUpcomingEvents(limit = 12) {
        const now = new Date(); now.setHours(0, 0, 0, 0);
        const y = now.getFullYear();
        const upcoming = state.events.map(ev => {
            let nextDate = new Date(y, ev.month - 1, ev.day);
            if (nextDate < now) nextDate = new Date(y + 1, ev.month - 1, ev.day);
            return { ...ev, nextDate };
        }).sort((a, b) => a.nextDate - b.nextDate);
        return upcoming.slice(0, limit);
    }
    
    function renderUpcoming() {
        const list = getUpcomingEvents(12);
        upcomingList.replaceChildren();
        const frag = document.createDocumentFragment();
        for (const ev of list) {
            const clone = upcomingItemTemplate.content.cloneNode(true);
            const item = clone.querySelector('.upcoming-item');

            item.setAttribute('aria-label', `${ev.name} 생일: ${ev.nextDate.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}`);

            const img = clone.querySelector('.upcoming-icon');
            img.src = ev.icon || PLACEHOLDER_48;
            img.alt = ev.name;
            attachIconFallback(img, PLACEHOLDER_48);

            clone.querySelector('.upcoming-date').textContent = ev.nextDate.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
            clone.querySelector('.upcoming-name').textContent = ev.name;

            item.addEventListener('click', () => {
                window.location.href = resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(ev.name)}`);
            });
            item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click(); } });

            frag.appendChild(clone);
        }
        upcomingList.appendChild(frag);
    }

    // ===== URL State =====
    const VALID_VIEWS = ['year', 'month', 'week', 'day'];

    function readUrlState() {
        const view = getUrlParam('view', '');
        const year = parseInt(getUrlParam('year', ''));
        const month = parseInt(getUrlParam('month', ''));
        const day = parseInt(getUrlParam('day', ''));

        if (VALID_VIEWS.includes(view)) {
            state.currentView = view;
        }

        const safeYear = clampNumber(year, 2000, 2100, state.currentDate.getFullYear());
        const safeMonth = clampNumber(month, 1, 12, state.currentDate.getMonth() + 1);
        const maxDay = new Date(safeYear, safeMonth, 0).getDate();
        const safeDay = clampNumber(day, 1, maxDay, Math.min(state.currentDate.getDate(), maxDay));

        if (!isNaN(year) || !isNaN(month) || !isNaN(day)) {
            state.currentDate = new Date(safeYear, safeMonth - 1, safeDay);
        }
    }

    function clampNumber(value, min, max, fallback) {
        if (isNaN(value)) return fallback;
        return Math.min(max, Math.max(min, value));
    }

    function syncUrlState() {
        const params = { view: state.currentView };
        const d = state.currentDate;
        if (state.currentView === 'day') {
            params.year = d.getFullYear();
            params.month = d.getMonth() + 1;
            params.day = d.getDate();
        } else if (state.currentView === 'month' || state.currentView === 'week') {
            params.year = d.getFullYear();
            params.month = d.getMonth() + 1;
        } else {
            params.year = d.getFullYear();
        }
        setUrlParams(params, { replace: true, clear: true });
    }

    // ===== Calendar Rendering =====

    /**
     * Sync URL state then re-render the current view with a CSS fade transition.
     * Dispatches to the appropriate renderXxxView() based on state.currentView.
     */
    function renderView() {
        clearTimeout(renderTimer);
        clearTimeout(fadeTimer);

        syncUrlState();
        calendarContainer.classList.add('fade-out');
        renderTimer = setTimeout(() => {
            calendarContainer.replaceChildren();
            calendarContainer.classList.remove('fade-out');
            if (state.currentView === 'year') renderYearView();
            else if (state.currentView === 'month') renderMonthView();
            else if (state.currentView === 'week') renderWeekView();
            else if (state.currentView === 'day') renderDayView();
            calendarContainer.classList.add('fade-in');
            updateActiveButtons();
            fadeTimer = setTimeout(() => calendarContainer.classList.remove('fade-in'), 300);
        }, 150);
    }

    function updateActiveButtons() {
        document.querySelectorAll('.view-toggle').forEach(btn => {
            const isActive = btn.dataset.view === state.currentView;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-pressed', String(isActive));
        });
        if (dayToggleBtn) {
            const isDay = state.currentView === 'day';
            dayToggleBtn.classList.toggle('active', isDay);
            dayToggleBtn.setAttribute('aria-pressed', String(isDay));
        }
    }

    function createDayCell(day, month, year, isOtherMonth, maxIcons = 3) {
        const cell = document.createElement('div');
        cell.className = 'day-cell';
        if (isOtherMonth) cell.classList.add('other-month');
        if (!isOtherMonth && isToday(year, month, day)) cell.classList.add('today');

        cell.dataset.year = String(year);
        cell.dataset.month = String(month);
        cell.dataset.day = String(day);
        if (!isOtherMonth) {
            cell.tabIndex = 0;
            cell.setAttribute('role', 'button');
            cell.setAttribute('aria-label', `${year}년 ${month + 1}월 ${day}일 보기`);
        }

        const dateNum = document.createElement('span');
        dateNum.className = 'date-num';
        dateNum.textContent = day;
        cell.appendChild(dateNum);

        if (!isOtherMonth) {
            const key = `${pad2(month + 1)}-${pad2(day)}`;
            const evs = state.eventsByDate[key];
            if (evs?.length) {
                if (state.searchQuery && evs.some(ev => ev.name.toLowerCase().includes(state.searchQuery.toLowerCase()))) {
                    cell.classList.add('highlight');
                }

                // Year view: only show indicator
                if (state.currentView === 'year') {
                    const indicator = document.createElement('div');
                    indicator.className = 'day-indicator';
                    indicator.textContent = evs.length;
                    cell.appendChild(indicator);
                } else { // Month and Week views: show icons and indicator
                    const eventsContainer = document.createElement('div');
                    eventsContainer.className = 'events';
                    evs.slice(0, maxIcons).forEach(ev => {
                        const link = document.createElement('a');
                        link.href = resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(ev.name)}`);
                        if (ev.rarity) {
                            link.classList.add(`rarity-${sanitizeClassToken(ev.rarity).toLowerCase()}`);
                        }
                        const img = createImageWithFallback(ev.icon, ev.name, 'event-icon', ev.name);
                        link.appendChild(img);
                        let tooltip = null;
                        img.addEventListener('mouseover', (e) => {
                            tooltip = document.createElement('div');
                            tooltip.className = 'event-tooltip';
                            tooltip.textContent = ev.name;
                            document.body.appendChild(tooltip);
                            const rect = e.target.getBoundingClientRect();
                            tooltip.style.left = `${rect.left + rect.width / 2 - tooltip.offsetWidth / 2}px`;
                            tooltip.style.top = `${rect.top - tooltip.offsetHeight - 5}px`;
                            setTimeout(() => tooltip.classList.add('visible'), 10);
                        });
                        img.addEventListener('mouseout', () => {
                            if (tooltip) {
                                tooltip.classList.remove('visible');
                                setTimeout(() => tooltip.remove(), 200);
                            }
                        });
                        eventsContainer.appendChild(link);
                    });
                    if (evs.length > maxIcons) {
                        const indicator = document.createElement('div');
                        indicator.className = 'day-indicator';
                        indicator.textContent = `+${evs.length - maxIcons}`;
                        eventsContainer.appendChild(indicator);
                    }
                    cell.appendChild(eventsContainer);
                }
            }
        }
        return cell;
    }

    // Existing renderers (lightly augmented to add data-* attrs for navigation)
    function renderYearView() {
        const year = state.currentDate.getFullYear();
        const yearHeader = document.createElement('div');
        yearHeader.className = 'year-view-header';

        const prevYearBtn = createNavButton('prev-year', 'chevron_left', '이전 년도');
        const nextYearBtn = createNavButton('next-year', 'chevron_right', '다음 년도');

        const titleH3 = document.createElement('h3');
        titleH3.textContent = `${year}년`;

        yearHeader.appendChild(prevYearBtn); yearHeader.appendChild(titleH3); yearHeader.appendChild(nextYearBtn);
        calendarContainer.appendChild(yearHeader);

        calendarTitle.textContent = '';
        const yearGrid = document.createElement('div');
        yearGrid.className = 'year-grid';

        for (let month = 0; month < 12; month++) {
            const monthDiv = document.createElement('div');
            monthDiv.className = 'calendar-month';

            const header = document.createElement('div');
            header.className = 'calendar-month-header';
            header.textContent = monthNamesKR[month];
            // Click header to navigate to month view
            header.dataset.month = String(month);
            header.dataset.year = String(year);
            header.tabIndex = 0;
            header.setAttribute('role', 'button');
            header.setAttribute('aria-label', `${year}년 ${monthNamesKR[month]} 보기`);
            monthDiv.appendChild(header);

            const grid = document.createElement('div');
            grid.className = 'month-grid';

            const firstDay = new Date(year, month, 1).getDay();
            const lastDate = new Date(year, month + 1, 0).getDate();
            const prevLastDate = new Date(year, month, 0).getDate();
            const totalCells = Math.ceil((firstDay + lastDate) / 7) * 7;

            for (let i = 0; i < totalCells; i++) {
                let dayNum, cellMonth = month, cellYear = year, isOtherMonth = false;
                if (i < firstDay) {
                    dayNum = prevLastDate - firstDay + i + 1;
                    cellMonth = month === 0 ? 11 : month - 1;
                    cellYear = month === 0 ? year - 1 : year;
                    isOtherMonth = true;
                } else if (i >= firstDay + lastDate) {
                    dayNum = i - (firstDay + lastDate) + 1;
                    cellMonth = month === 11 ? 0 : month + 1;
                    cellYear = month === 11 ? year + 1 : year;
                    isOtherMonth = true;
                } else {
                    dayNum = i - firstDay + 1;
                }
                grid.appendChild(createDayCell(dayNum, cellMonth, cellYear, isOtherMonth));
            }
            monthDiv.appendChild(grid);
            yearGrid.appendChild(monthDiv);
        }
        calendarContainer.appendChild(yearGrid);
    }

    function renderMonthView() {
        const year = state.currentDate.getFullYear();
        const month = state.currentDate.getMonth();

        calendarTitle.textContent = '';
        const monthContainer = document.createElement('div');
        monthContainer.className = 'month-view';

        const header = document.createElement('div');
        header.className = 'month-view-header';

        const prevBtn = createNavButton('prev-month', 'chevron_left', '이전 달');
        const nextBtn = createNavButton('next-month', 'chevron_right', '다음 달');

        const title = document.createElement('h3'); title.textContent = `${year}년 ${monthNamesKR[month]}`;
        header.appendChild(prevBtn); header.appendChild(title); header.appendChild(nextBtn);
        monthContainer.appendChild(header);

        const weekdayRow = document.createElement('div');
        weekdayRow.className = 'weekdays';
        dowNamesKR.forEach(name => { const label = document.createElement('div'); label.textContent = name; weekdayRow.appendChild(label); });
        monthContainer.appendChild(weekdayRow);

        const grid = document.createElement('div');
        grid.className = 'month-grid-large';

        const firstDay = new Date(year, month, 1).getDay();
        const lastDate = new Date(year, month + 1, 0).getDate();
        const prevLastDate = new Date(year, month, 0).getDate();
        const totalCells = Math.ceil((firstDay + lastDate) / 7) * 7;

        for (let i = 0; i < totalCells; i++) {
            let dayNum, cellMonth = month, cellYear = year, isOtherMonth = false;
            if (i < firstDay) {
                dayNum = prevLastDate - firstDay + i + 1;
                cellMonth = month === 0 ? 11 : month - 1;
                cellYear = month === 0 ? year - 1 : year;
                isOtherMonth = true;
            } else if (i >= firstDay + lastDate) {
                dayNum = i - (firstDay + lastDate) + 1;
                cellMonth = month === 11 ? 0 : month + 1;
                cellYear = month === 11 ? year + 1 : year;
                isOtherMonth = true;
            } else {
                dayNum = i - firstDay + 1;
            }
            grid.appendChild(createDayCell(dayNum, cellMonth, cellYear, isOtherMonth));
        }
        monthContainer.appendChild(grid);
        calendarContainer.appendChild(monthContainer);
    }

    function renderWeekView() {
        const dayOfWeek = state.currentDate.getDay();
        const mondayIndex = (dayOfWeek + 6) % 7;
        const weekStart = new Date(state.currentDate);
        weekStart.setDate(state.currentDate.getDate() - mondayIndex);

        calendarTitle.textContent = '';
        const weekContainer = document.createElement('div'); weekContainer.className = 'week-view';

        const header = document.createElement('div'); header.className = 'week-view-header';
        const prevBtn = createNavButton('prev-week', 'chevron_left', '이전 주');
        const nextBtn = createNavButton('next-week', 'chevron_right', '다음 주');

        const endDate = new Date(weekStart); endDate.setDate(weekStart.getDate() + 6);
        const options = { month: 'long', day: 'numeric' };
        const title = document.createElement('h3'); title.textContent = `${weekStart.toLocaleDateString('ko-KR', options)} – ${endDate.toLocaleDateString('ko-KR', options)}`;
        header.appendChild(prevBtn); header.appendChild(title); header.appendChild(nextBtn);
        weekContainer.appendChild(header);

        const grid = document.createElement('div'); grid.className = 'week-grid';
        const weekdayNames = ['월', '화', '수', '목', '금', '토', '일'];
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart);
            d.setDate(weekStart.getDate() + i);
            const cell = createDayCell(d.getDate(), d.getMonth(), d.getFullYear(), false, 4);
            const dateLabel = document.createElement('span');
            dateLabel.className = 'date-num';
            dateLabel.textContent = `${weekdayNames[i]} ${d.getDate()}`;
            // Replace the existing date-num span
            cell.replaceChild(dateLabel, cell.querySelector('.date-num'));
            grid.appendChild(cell);
        }
        weekContainer.appendChild(grid);
        calendarContainer.appendChild(weekContainer);
    }

    // ---------- NEW: Day view + mini-month ----------
    function renderDayView(dateObj = state.currentDate) {
        const y = dateObj.getFullYear();
        const m = dateObj.getMonth();
        const d = dateObj.getDate();

        calendarTitle.textContent = `${y}년 ${m + 1}월 ${d}일`;

        const root = document.createElement('div'); root.className = 'day-view';

        // Left: events list
        const left = document.createElement('div'); left.className = 'day-panel';
        const head = document.createElement('div'); head.className = 'day-header';
        const heading = document.createElement('h2');
        heading.textContent = `${m + 1}월 ${d}일`;
        const sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = isToday(y, m, d) ? '오늘' : '';
        head.append(heading, sub);
        left.appendChild(head);

        const list = document.createElement('div'); list.className = 'event-list';
        const key = `${pad2(m + 1)}-${pad2(d)}`;
        const todays = (state.eventsByDate[key] || []);
        if (!todays.length) {
            const empty = eventCardEmptyTemplate.content.cloneNode(true);
            const card = empty.querySelector('.event-card');
            card.querySelector('.title').textContent = '이 날에는 생일이 없습니다';
            card.querySelector('.meta').textContent = '오른쪽 미니 달력에서 다른 날짜를 선택해 보세요.';
            list.appendChild(empty);
        } else {
            for (const ev of todays) {
                const clone = eventCardTemplate.content.cloneNode(true);
                const card = clone.querySelector('.event-card');

                card.addEventListener('click', () => {
                    window.location.href = resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(ev.name)}`);
                });
                card.style.cursor = 'pointer';

                const img = clone.querySelector('.event-img');
                img.src = ev.icon || PLACEHOLDER_56;
                img.alt = ev.name;
                attachIconFallback(img, PLACEHOLDER_56);

                clone.querySelector('.title').textContent = ev.name;
                clone.querySelector('.meta').textContent = ev.year ? ev.year + '년' : '연도 미상';

                const rarityBadge = clone.querySelector('.rarity-badge');
                rarityBadge.textContent = ev.rarity || '—';
                if (ev.rarity) rarityBadge.setAttribute('data-rarity', ev.rarity);

                clone.querySelector('.type-badge').textContent = ev.type || '—';
                clone.querySelector('.faction-badge').textContent = ev.faction || '—';

                list.appendChild(clone);
            }
        }
        left.appendChild(list);

        // Right: mini month
        const right = renderDayMiniMonth(y, m, d);

        root.appendChild(left); root.appendChild(right);
        calendarContainer.replaceChildren(root);
    }

    function renderDayMiniMonth(y, m, selectedDay) {
        const box = document.createElement('div'); box.className = 'day-mini';

        const head = document.createElement('div'); head.className = 'mm-head';
        const name = document.createElement('div'); name.className = 'mm-name'; name.textContent = `${y}년 ${m + 1}월`;
        const ctrls = document.createElement('div');
        const prev = createNavButton('prev-month-day', 'chevron_left', '이전 달', 'mini');
        const next = createNavButton('next-month-day', 'chevron_right', '다음 달', 'mini');
        ctrls.appendChild(prev); ctrls.appendChild(next);
        head.appendChild(name); head.appendChild(ctrls);
        box.appendChild(head);

        // DOW
        const dow = document.createElement('div'); dow.className = 'mm-grid';
        for (const s of dowNamesKR) { const el = document.createElement('div'); el.className = 'mm-dow'; el.textContent = s; dow.appendChild(el); }
        box.appendChild(dow);

        // Grid
        const grid = document.createElement('div'); grid.className = 'mm-grid';
        const days = new Date(y, m + 1, 0).getDate();
        const first = new Date(y, m, 1).getDay();
        const total = Math.ceil((first + days) / 7) * 7;
        for (let i = 0; i < total; i++) {
            const dayNum = i - first + 1;
            const cell = document.createElement('div'); cell.className = 'mm-cell';
            if (dayNum < 1 || dayNum > days) { cell.classList.add('outside'); cell.textContent = ''; }
            else {
                cell.textContent = String(dayNum);
                const key = `${pad2(m + 1)}-${pad2(dayNum)}`;
                if ((state.eventsByDate[key] || []).length) cell.classList.add('has');
                if (isToday(y, m, dayNum)) cell.classList.add('today');
                if (dayNum === selectedDay) cell.classList.add('selected');
                cell.dataset.year = String(y);
                cell.dataset.month = String(m);
                cell.dataset.day = String(dayNum);
                cell.tabIndex = 0;
                cell.setAttribute('role', 'button');
                cell.setAttribute('aria-label', `${y}년 ${m + 1}월 ${dayNum}일 보기`);
            }
            grid.appendChild(cell);
        }
        box.appendChild(grid);
        return box;
    }

    // ---------- Event delegation for navigation (performance-friendly) ----------
    calendarContainer.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (target) {
            const action = target.dataset.action;
            const year = state.currentDate.getFullYear();
            const month = state.currentDate.getMonth();
            const day = state.currentDate.getDate();
            switch (action) {
                case 'prev-year':
                    state.currentDate = new Date(year - 1, 0, 1);
                    renderView();
                    break;
                case 'next-year':
                    state.currentDate = new Date(year + 1, 0, 1);
                    renderView();
                    break;
                case 'prev-month':
                    state.currentDate = new Date(year, month - 1, 1);
                    renderView();
                    break;
                case 'next-month':
                    state.currentDate = new Date(year, month + 1, 1);
                    renderView();
                    break;
                case 'prev-week':
                    state.currentDate.setDate(state.currentDate.getDate() - 7);
                    renderView();
                    break;
                case 'next-week':
                    state.currentDate.setDate(state.currentDate.getDate() + 7);
                    renderView();
                    break;
                case 'prev-month-day':
                    state.currentDate = new Date(year, month - 1, Math.min(15, day));
                    renderView();
                    break;
                case 'next-month-day':
                    state.currentDate = new Date(year, month + 1, Math.min(15, day));
                    renderView();
                    break;
            }
        }

        // Year → Month: header click
        const header = e.target.closest('.calendar-month-header');
        if (header && header.dataset.year && header.dataset.month) {
            state.currentDate = new Date(parseInt(header.dataset.year, 10), parseInt(header.dataset.month, 10), 1);
            state.currentView = 'month'; renderView(); return;
        }
        // Any day-cell / mini-month cell → Day
        const dayCell = e.target.closest('.day-cell, .mm-cell');
        if (dayCell && dayCell.dataset.year && dayCell.dataset.month && dayCell.dataset.day && !dayCell.classList.contains('other-month')) {
            state.currentDate = new Date(parseInt(dayCell.dataset.year, 10), parseInt(dayCell.dataset.month, 10), parseInt(dayCell.dataset.day, 10));
            state.currentView = 'day'; renderView(); return;
        }
    });

    calendarContainer.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const target = e.target.closest('[data-action], .calendar-month-header, .day-cell, .mm-cell');
        if (!target || !calendarContainer.contains(target)) return;
        e.preventDefault();
        target.click();
    });

    // ---------- Controls setup (keep structure, inject Today & Day toggle) ----------
    function setupViewButtons() {
        viewButtons.forEach(btn => {
            btn.type = 'button';
            btn.addEventListener('click', () => { state.currentView = btn.dataset.view; renderView(); });
        });

        // Inject "일간" toggle if not present
        const controls = document.querySelector('.calendar-controls');
        if (controls && !document.querySelector('.view-toggle[data-view="day"]')) {
            dayToggleBtn = document.createElement('button');
            dayToggleBtn.className = 'view-toggle';
            dayToggleBtn.type = 'button';
            dayToggleBtn.dataset.view = 'day';
            dayToggleBtn.title = '일간 보기';
            dayToggleBtn.setAttribute('aria-label', '일간 보기로 전환');
            dayToggleBtn.setAttribute('aria-pressed', 'false');
            dayToggleBtn.append(createMaterialIcon('event'), document.createTextNode(' 일간'));
            dayToggleBtn.addEventListener('click', () => { state.currentView = 'day'; renderView(); });
            // Insert before search box to preserve layout feel
            const dropdownContainer = controls.querySelector('.dropdown-container');
            controls.insertBefore(dayToggleBtn, dropdownContainer || null);
        }

        // Inject "오늘" button
        if (controls && !document.getElementById('todayBtn')) {
            todayBtn = document.createElement('button');
            todayBtn.type = 'button';
            todayBtn.className = 'today-btn';
            todayBtn.id = 'todayBtn';
            todayBtn.title = '오늘로 이동';
            todayBtn.append(createMaterialIcon('calendar_today'), document.createTextNode(' 오늘'));
            todayBtn.addEventListener('click', () => { state.currentDate = new Date(); state.currentView = 'day'; renderView(); });
            controls.appendChild(todayBtn);
        }
    }

    function setupSidebar() {
        const setSidebarOpen = (isOpen) => {
            upcomingPanel.classList.toggle('open', isOpen);
            sidebarToggle.classList.toggle('active', isOpen);
            sidebarToggle.setAttribute('aria-expanded', String(isOpen));
            if (sidebarBackdrop) sidebarBackdrop.classList.toggle('visible', isOpen);
        };

        sidebarToggle.addEventListener('click', () => {
            setSidebarOpen(!upcomingPanel.classList.contains('open'));
        });
        if (sidebarClose) sidebarClose.addEventListener('click', () => {
            setSidebarOpen(false);
        });
        if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', () => {
            setSidebarOpen(false);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && upcomingPanel.classList.contains('open')) {
                setSidebarOpen(false);
            }
        });
    }

    // ---------- Init ----------
    document.addEventListener('DOMContentLoaded', () => {
        readUrlState();
        setupViewButtons();
        setupSidebar();
        loadData();
    });
})();
