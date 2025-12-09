/* ==========================================================================
   Shipgirl Birthday Calendar Script (enhanced, structure-preserving)
   - Adds Day view (일간), mini-month header in Day view
   - Adds Today button (오늘) and injects it without modifying HTML file
   - Enables click-through navigation: 연간→월간, 월간/주간→일간
   - Keeps Korean labels and existing layout intact
   - Performance: uses event delegation, caches lookups, avoids redundant listeners
   ========================================================================== */

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

    // Template references
    const eventCardTemplate = document.getElementById('event-card-template');
    const eventCardEmptyTemplate = document.getElementById('event-card-empty-template');
    const upcomingItemTemplate = document.getElementById('upcoming-item-template');
    const searchResultTemplate = document.getElementById('search-result-template');
    const noResultsTemplate = document.getElementById('no-results-template');

    if (!calendarContainer || !upcomingList || !calendarTitle || !viewButtons.length || !searchInput || !searchDropdown || !sidebarToggle || !upcomingPanel) {
        console.error('필수 DOM 요소를 찾지 못했습니다. 초기화 중단.');
        if (document.querySelector('.birthday-container')) {
            document.querySelector('.birthday-container').innerHTML =
                '<div class="error-message">오류: 캘린더 초기화에 실패했습니다. 페이지를 새로고침해 주세요.</div>';
        }
        return;
    }

    if (!eventCardTemplate || !eventCardEmptyTemplate || !upcomingItemTemplate || !searchResultTemplate || !noResultsTemplate) {
        console.error('필수 템플릿 요소를 찾지 못했습니다. 초기화 중단.');
        return;
    }

    // Injected controls (created at runtime to avoid touching HTML)
    let todayBtn = null;
    let dayToggleBtn = null;

    // Fuse.js (existing behavior)


    // ---------- Utilities ----------
    const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

    const isToday = (y, m, d) => {
        const t = new Date();
        return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
    };
    const monthNamesKR = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
    const dowNamesKR = ['일', '월', '화', '수', '목', '금', '토'];

    function createImageWithFallback(src, alt, className, title) {
        const placeholderSvg = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"%3E%3Crect width="32" height="32" fill="%23ddd"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="10" fill="%23999"%3E?%3C/text%3E%3C/svg%3E';
        const img = document.createElement('img');
        img.src = (src && src !== 'undefined') ? src : placeholderSvg;
        img.alt = alt;
        img.className = className;
        if (title) img.title = title;
        img.loading = 'lazy';
        img.onerror = function () { this.onerror = null; this.src = placeholderSvg; this.style.opacity = '0.5'; };
        return img;
    }

    // ---------- Data load & cache (unchanged behavior, path preserved) ----------
    function getCachedData() {
        try {
            const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
            if (timestamp && Date.now() - parseInt(timestamp) < CACHE_DURATION) {
                const cached = localStorage.getItem(CACHE_KEY);
                return cached ? JSON.parse(cached) : null;
            }
        } catch (e) { console.warn('캐시 읽기 실패:', e); }
        return null;
    }
    function cacheData(data) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(data));
            localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
        } catch (e) { console.warn('캐시 저장 실패:', e); }
    }

    function loadData() {
        calendarContainer.innerHTML = '<div class="loading-message"><span class="loading-spinner"></span>생일 데이터를 불러오는 중...</div>';
        upcomingList.innerHTML = '<div class="loading-message" style="padding: 1rem;"><span class="loading-spinner"></span>불러오는 중...</div>';
        const cached = getCachedData();
        if (cached) { processData(cached); return; }

        fetchJSON('data/shipgirl/shipgirl_birthday_data.json')
            .then(data => { cacheData(data); processData(data); })
            .catch(err => {
                console.error('데이터 로드 실패:', err);
                calendarContainer.innerHTML = `<div class="error-message"><p><strong>생일 데이터 로드 실패</strong></p><p>${err.message}</p><p><button onclick="location.reload()" style="margin-top:1rem;padding:.5rem 1rem;cursor:pointer;">다시 시도</button></p></div>`;
                upcomingList.innerHTML = '<div class="error-message" style="padding:1rem;font-size:.9rem;">로드 실패</div>';
            });
    }

    function processData(data) {
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
        }));
        initializeSearch();
        rebuildEventsByDate();
        renderUpcoming();
        renderView();
    }

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

    function initializeSearch() {
        const fuseOptions = { keys: ['name', 'type', 'faction'], threshold: 0.3, includeScore: true, includeMatches: true };
        // eslint-disable-next-line no-undef
        state.fuse = new Fuse(state.events, fuseOptions);
        searchInput.addEventListener('input', handleSearch, { passive: true });
        searchInput.addEventListener('focus', handleSearch, { passive: true });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.dropdown-container')) searchDropdown.style.display = 'none';
        });
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
        const results = state.fuse.search(query, { limit: 10 });
        displaySearchResults(results);
    }

    function highlightMatches(text, indices) {
        let out = '', last = 0;
        indices.forEach(([s, e]) => { out += text.substring(last, s) + '<mark>' + text.substring(s, e + 1) + '</mark>'; last = e + 1; });
        return out + text.substring(last);
    }

    function displaySearchResults(results) {
        searchDropdown.innerHTML = '';
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
                    nameEl.innerHTML = highlightMatches(it.name, m.indices);
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

    // ---------- Upcoming ----------
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
        upcomingList.innerHTML = '';
        const frag = document.createDocumentFragment();
        for (const ev of list) {
            const clone = upcomingItemTemplate.content.cloneNode(true);
            const item = clone.querySelector('.upcoming-item');

            item.setAttribute('aria-label', `${ev.name} 생일: ${ev.nextDate.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}`);

            const img = clone.querySelector('.upcoming-icon');
            img.src = ev.icon || '';
            img.alt = ev.name;
            img.onerror = function() {
                this.onerror = null;
                this.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"%3E%3Crect width="48" height="48" fill="%23ddd"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="12" fill="%23999"%3E?%3C/text%3E%3C/svg%3E';
                this.style.opacity = '0.5';
            };

            clone.querySelector('.upcoming-date').textContent = ev.nextDate.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
            clone.querySelector('.upcoming-name').textContent = ev.name;

            item.addEventListener('click', () => {
                window.location.href = `pages/shipgirl/shipgirl-info.html?ship=${encodeURIComponent(ev.name)}`;
            });
            item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click(); } });

            frag.appendChild(clone);
        }
        upcomingList.appendChild(frag);
    }

    // ---------- Rendering (existing views preserved) ----------
    function renderView() {
        calendarContainer.classList.add('fade-out');
        setTimeout(() => {
            calendarContainer.innerHTML = '';
            calendarContainer.classList.remove('fade-out');
            if (state.currentView === 'year') renderYearView();
            else if (state.currentView === 'month') renderMonthView();
            else if (state.currentView === 'week') renderWeekView();
            else if (state.currentView === 'day') renderDayView();
            calendarContainer.classList.add('fade-in');
            updateActiveButtons();
            setTimeout(() => calendarContainer.classList.remove('fade-in'), 300);
        }, 150);
    }

    function updateActiveButtons() {
        document.querySelectorAll('.view-toggle').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === state.currentView);
        });
        if (dayToggleBtn) dayToggleBtn.classList.toggle('active', state.currentView === 'day');
    }

    function createDayCell(day, month, year, isOtherMonth, maxIcons = 3) {
        const cell = document.createElement('div');
        cell.className = 'day-cell';
        if (isOtherMonth) cell.classList.add('other-month');
        if (!isOtherMonth && isToday(year, month, day)) cell.classList.add('today');

        cell.dataset.year = String(year);
        cell.dataset.month = String(month);
        cell.dataset.day = String(day);

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
                        link.href = `pages/shipgirl/shipgirl-info.html?ship=${encodeURIComponent(ev.name)}`;
                        if (ev.rarity) {
                            link.classList.add(`rarity-${ev.rarity.toLowerCase()}`);
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

        const prevBtn = document.createElement('button');
        prevBtn.className = 'nav-btn';
        prevBtn.innerHTML = '<span class="material-symbols-outlined">chevron_left</span>';
        prevBtn.setAttribute('aria-label', '이전 년도');
        prevBtn.dataset.action = 'prev-year';

        const nextBtn = document.createElement('button');
        nextBtn.className = 'nav-btn';
        nextBtn.innerHTML = '<span class="material-symbols-outlined">chevron_right</span>';
        nextBtn.setAttribute('aria-label', '다음 년도');
        nextBtn.dataset.action = 'next-year';

        const titleH3 = document.createElement('h3');
        titleH3.textContent = `${year}년`;

        yearHeader.appendChild(prevBtn); yearHeader.appendChild(titleH3); yearHeader.appendChild(nextBtn);
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

        const prevBtn = document.createElement('button');
        prevBtn.className = 'nav-btn'; prevBtn.innerHTML = '<span class="material-symbols-outlined">chevron_left</span>';
        prevBtn.dataset.action = 'prev-month';

        const nextBtn = document.createElement('button');
        nextBtn.className = 'nav-btn'; nextBtn.innerHTML = '<span class="material-symbols-outlined">chevron_right</span>';
        nextBtn.dataset.action = 'next-month';

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
        const prevBtn = document.createElement('button'); prevBtn.className = 'nav-btn';
        prevBtn.innerHTML = '<span class="material-symbols-outlined">chevron_left</span>';
        prevBtn.dataset.action = 'prev-week';
        const nextBtn = document.createElement('button'); nextBtn.className = 'nav-btn';
        nextBtn.innerHTML = '<span class="material-symbols-outlined">chevron_right</span>';
        nextBtn.dataset.action = 'next-week';

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
        head.innerHTML = `<h2>${m + 1}월 ${d}일</h2><span class="sub">${isToday(y, m, d) ? '오늘' : ''}</span>`;
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
                    window.location.href = `pages/shipgirl/shipgirl-info.html?ship=${encodeURIComponent(ev.name)}`;
                });
                card.style.cursor = 'pointer';

                const img = clone.querySelector('.event-img');
                img.src = ev.icon || '';
                img.alt = ev.name;
                img.onerror = function() {
                    this.onerror = null;
                    this.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56"%3E%3Crect width="56" height="56" fill="%23ddd"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="14" fill="%23999"%3E?%3C/text%3E%3C/svg%3E';
                    this.style.opacity = '0.5';
                };

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
        calendarContainer.innerHTML = ''; calendarContainer.appendChild(root);
    }

    function renderDayMiniMonth(y, m, selectedDay) {
        const box = document.createElement('div'); box.className = 'day-mini';

        const head = document.createElement('div'); head.className = 'mm-head';
        const name = document.createElement('div'); name.className = 'mm-name'; name.textContent = `${y}년 ${m + 1}월`;
        const ctrls = document.createElement('div');
        const prev = document.createElement('button'); prev.className = 'nav-btn mini';
        prev.innerHTML = '<span class="material-symbols-outlined">chevron_left</span>';
        prev.dataset.action = 'prev-month-day';
        const next = document.createElement('button'); next.className = 'nav-btn mini';
        next.innerHTML = '<span class="material-symbols-outlined">chevron_right</span>';
        next.dataset.action = 'next-month-day';
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
                if (dayNum === selectedDay) { cell.style.outline = '2px solid var(--calendar-primary)'; cell.style.outlineOffset = '2px'; }
                cell.dataset.year = String(y);
                cell.dataset.month = String(m);
                cell.dataset.day = String(dayNum);
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

    // ---------- Controls setup (keep structure, inject Today & Day toggle) ----------
    function setupViewButtons() {
        viewButtons.forEach(btn => {
            btn.addEventListener('click', () => { state.currentView = btn.dataset.view; renderView(); });
        });

        // Inject "일간" toggle if not present
        const controls = document.querySelector('.calendar-controls');
        if (controls && !document.querySelector('.view-toggle[data-view="day"]')) {
            dayToggleBtn = document.createElement('button');
            dayToggleBtn.className = 'view-toggle';
            dayToggleBtn.dataset.view = 'day';
            dayToggleBtn.title = '일간 보기';
            dayToggleBtn.setAttribute('aria-label', '일간 보기로 전환');
            dayToggleBtn.innerHTML = '<span class="material-symbols-outlined">event</span> 일간';
            dayToggleBtn.addEventListener('click', () => { state.currentView = 'day'; renderView(); });
            // Insert before search box to preserve layout feel
            const dropdownContainer = controls.querySelector('.dropdown-container');
            controls.insertBefore(dayToggleBtn, dropdownContainer || null);
        }

        // Inject "오늘" button
        if (controls && !document.getElementById('todayBtn')) {
            todayBtn = document.createElement('button');
            todayBtn.className = 'today-btn';
            todayBtn.id = 'todayBtn';
            todayBtn.title = '오늘로 이동';
            todayBtn.innerHTML = '<span class="material-symbols-outlined">calendar_today</span> 오늘';
            todayBtn.addEventListener('click', () => { state.currentDate = new Date(); state.currentView = 'day'; renderView(); });
            controls.appendChild(todayBtn);
        }
    }

    function setupSidebar() {
        sidebarToggle.addEventListener('click', () => {
            const isOpen = upcomingPanel.classList.toggle('open');
            sidebarToggle.classList.toggle('active');
            if (sidebarBackdrop) sidebarBackdrop.classList.toggle('visible', isOpen);
        });
        if (sidebarClose) sidebarClose.addEventListener('click', () => {
            upcomingPanel.classList.remove('open'); sidebarToggle.classList.remove('active');
            if (sidebarBackdrop) sidebarBackdrop.classList.remove('visible');
        });
        if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', () => {
            upcomingPanel.classList.remove('open'); sidebarToggle.classList.remove('active'); sidebarBackdrop.classList.remove('visible');
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && upcomingPanel.classList.contains('open')) {
                upcomingPanel.classList.remove('open'); sidebarToggle.classList.remove('active');
                if (sidebarBackdrop) sidebarBackdrop.classList.remove('visible');
            }
        });
    }

    // ---------- Init ----------
    document.addEventListener('DOMContentLoaded', () => {
        setupViewButtons();
        setupSidebar();
        loadData();
    });
})();