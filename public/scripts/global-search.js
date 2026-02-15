import { debounce, fetchJSON, resolveUrl, createSearchIndex } from './utils.js';
import { LINKS } from './global.script.js';

// ============================================
// PAGE CATALOG
// ============================================

const PAGE_CATALOG = [
    // Ships & Skins
    { name: '함순이 DB', description: '함순이 상세 정보', icon: 'database', path: LINKS.SHIPGIRL_INFO, category: '함순이' },
    { name: '함순이 건조확률 보기', description: '배너별 건조확률 상세확인', icon: 'casino', path: LINKS.SHIPGIRL_BUILD, category: '함순이' },
    { name: '함순이 생일', description: '함순이 생일 확인하기', icon: 'cake', path: LINKS.SHIPGIRL_BIRTHDAY, category: '함순이' },
    { name: '일러/대사', description: '선택된 스킨의 일러스트 및 대사보기/재생', icon: 'image', path: LINKS.SKIN_DETAIL, category: '스킨' },
    { name: '스킨 모음집', description: '여러 스킨들을 필터링/판매중 정보와 같이보기', icon: 'photo_library', path: LINKS.SKIN_LIST, category: '스킨' },
    { name: '스킨 투표', description: '벽챈 스킨선호도 실시간으로 보기', icon: 'poll', path: LINKS.SKIN_POLL, category: '스킨' },
    { name: '기타 캐릭터 일러 뷰어', description: '적 및 특수상황에서의 함순이들의 표정 일러스트 뷰어', icon: 'face', path: LINKS.SKIN_EXPRESSION, category: '스킨' },

    // Tools
    { name: '아일랜드 계획 관리', description: '벽타듀 캐릭터, 기술, 퀘스트 관리', icon: 'forest', path: LINKS.ISLAND, category: '도구' },
    { name: '룽섭 일정보기', description: '과거 룽섭 이벤트 일정들을 검색과 함께 확인', icon: 'event', path: LINKS.EVENT_TIMELINE, category: '도구' },
    { name: '육성 계산기', description: '기술/진영점수 계산', icon: 'calculate', path: LINKS.SHIPGIRL_TRACKER, category: '도구' },
    { name: '설비스킨', description: '장비(설비) 스킨 뷰어', icon: 'construction', path: LINKS.SKIN_SD, category: '도구' },
    { name: '탄막 시뮬레이터', description: '아직 개발중 (현재는 직접 탄막만 제대로 구현)', icon: 'sports_esports', path: LINKS.SIM_WEAPON, category: '도구' },

    // Stories
    { name: '메인스토리', description: '메인스토리 뷰어', icon: 'menu_book', path: LINKS.MAIN_STORY, category: '스토리' },
    { name: '메인스토리 타임라인', description: '타임라인으로 스토리 흐름보기', icon: 'timeline', path: LINKS.MAIN_STORYLINE, category: '스토리' },
    { name: '대작전스토리', description: '대작전스토리 뷰어', icon: 'public', path: LINKS.WORLD_STORY, category: '스토리' },
    { name: '대작전 파일', description: '파일해역에서 해금되는 파일들 모아보기', icon: 'folder', path: LINKS.WORLD_FILE, category: '스토리' },
    { name: 'TB 키우기', description: '통베 회상/수집/엔딩 보기', icon: 'woman', path: LINKS.TB_STORY, category: '스토리' },
    { name: '네비 키우기', description: '네비게이터 회상/수집/엔딩 보기', icon: 'girl', path: LINKS.NAVI_STORY, category: '스토리' },
    { name: '비서함 스토리', description: '모항 비서함 클릭시 발생하는 스토리 모음', icon: 'diagnosis', path: LINKS.SECRETARY_STORY, category: '스토리' },
    { name: '명예의 전당', description: '룽섭 명전 스토리들 모음', icon: 'emoji_events', path: LINKS.HOF, category: '스토리' },

    // In-game Content
    { name: 'JUUSTAGRAM', description: '쥬스타그램을 글/댓작성자 검색과 같이보기', icon: 'photo_camera', path: LINKS.JUUSTAGRAM, category: '인게임' },
    { name: 'JUUS 보기', description: '대화형뷰어로 함순이 쥬톡보기', icon: 'chat', path: LINKS.CHAT_JUUS, category: '인게임' },
    { name: '3D숙소 JUUS', description: '대화형뷰어로 3D숙소 쥬톡보기', icon: 'view_in_ar', path: LINKS.CHAT_DORM3D, category: '인게임' },
    { name: '로딩일러', description: '인게임 로딩일러스트 모음', icon: 'wallpaper', path: LINKS.LOADINGBG, category: '인게임' },
    { name: '만화 보기', description: '인게임 만화모음', icon: 'auto_stories', path: LINKS.COMIC_VIEWER, category: '인게임' },
    { name: '삽화 보기', description: '인게임 삽화모음', icon: 'collections', path: LINKS.GALLERYPIC, category: '인게임' },
    { name: 'BGM 듣기', description: '배경음악 플레이어', icon: 'music_note', path: LINKS.BGM_PLAYER, category: '인게임' },
    { name: '발렌타인 편지', description: '함순이별 발렌타인 편지 모음', icon: 'mail', path: 'misc/valentine/', category: '인게임' },
];

// ============================================
// STATE
// ============================================

let pageIndex = null;
let shipData = null;
let shipIndex = null;
let shipDataLoading = false;
let activeIndex = -1;
let allResults = [];

// ============================================
// DOM REFERENCES
// ============================================

const overlay = document.getElementById('global-search-modal');
const input = document.getElementById('global-search-input');
const resultsContainer = document.getElementById('global-search-results');

// ============================================
// INITIALIZATION
// ============================================

function init() {
    if (!overlay || !input || !resultsContainer) return;

    // Build page search index
    pageIndex = createSearchIndex(PAGE_CATALOG, {
        keys: [
            { name: 'name', weight: 2 },
            { name: 'description', weight: 1 },
            { name: 'category', weight: 0.5 }
        ],
        threshold: 0.4
    });

    // Trigger button
    document.querySelectorAll('.global-search-trigger').forEach(btn => {
        btn.addEventListener('click', openSearch);
    });

    // Ctrl+K shortcut
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            openSearch();
        }
    });

    // Backdrop click to close
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeSearch();
    });

    // Input events
    input.addEventListener('input', debounce(handleSearch, 150));
    input.addEventListener('keydown', handleKeydown);
}

// ============================================
// OPEN / CLOSE
// ============================================

function openSearch() {
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    input.focus();

    // Lazy-load ship data on first open
    if (!shipData && !shipDataLoading) {
        loadShipData();
    }
}

function closeSearch() {
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
    input.value = '';
    activeIndex = -1;
    allResults = [];
    resultsContainer.innerHTML = '<div class="global-search-empty">검색어를 입력하세요</div>';
}

// ============================================
// SHIP DATA LOADING
// ============================================

async function loadShipData() {
    shipDataLoading = true;
    try {
        const raw = await fetchJSON('data/ship_group_data.json');
        // Convert object to array with id
        shipData = Object.entries(raw).map(([id, ship]) => ({
            id,
            name: ship.name,
            icon: ship.icon,
            rarity: ship.rarity
        }));
        shipIndex = createSearchIndex(shipData, {
            keys: [{ name: 'name', weight: 1 }],
            threshold: 0.3
        });
    } catch (e) {
        console.warn('[GlobalSearch] Failed to load ship data:', e);
    }
    shipDataLoading = false;
}

// ============================================
// SEARCH LOGIC
// ============================================

function handleSearch() {
    const query = input.value.trim();
    if (!query) {
        activeIndex = -1;
        allResults = [];
        resultsContainer.innerHTML = '<div class="global-search-empty">검색어를 입력하세요</div>';
        return;
    }

    const pageResults = pageIndex ? pageIndex.search(query).slice(0, 5) : [];
    const shipResults = shipIndex ? shipIndex.search(query).slice(0, 8) : [];

    if (pageResults.length === 0 && shipResults.length === 0) {
        activeIndex = -1;
        allResults = [];
        resultsContainer.innerHTML = '<div class="global-search-empty">검색 결과가 없습니다</div>';
        return;
    }

    allResults = [];
    let html = '';

    // Page results
    if (pageResults.length > 0) {
        html += '<div class="global-search-section">페이지</div>';
        for (const result of pageResults) {
            const page = result.item;
            const url = buildPageUrl(page.path);
            const idx = allResults.length;
            allResults.push({ type: 'page', url });
            html += `
                <a href="${url}" class="global-search-item" data-index="${idx}" data-url="${url}">
                    <div class="global-search-item-icon">
                        <span class="material-symbols-outlined">${page.icon}</span>
                    </div>
                    <div class="global-search-item-text">
                        <div class="global-search-item-name">${escapeHtml(page.name)}</div>
                        <div class="global-search-item-desc">${escapeHtml(page.description)}</div>
                    </div>
                    <span class="global-search-item-badge">${escapeHtml(page.category)}</span>
                </a>`;
        }
    }

    // Ship results
    if (shipResults.length > 0) {
        html += '<div class="global-search-section">함순이</div>';
        for (const result of shipResults) {
            const ship = result.item;
            const idx = allResults.length;
            const infoUrl = buildPageUrl(LINKS.SHIPGIRL_INFO) + '?ship=' + encodeURIComponent(ship.name);
            allResults.push({ type: 'ship', url: infoUrl });
            const skinUrl = buildPageUrl(LINKS.SKIN_DETAIL) + '?character=' + encodeURIComponent(ship.name);
            const valentineUrl = buildPageUrl('misc/valentine/') + '?name=' + encodeURIComponent(ship.name);

            html += `
                <div class="global-search-ship" data-index="${idx}" data-url="${infoUrl}">
                    <img class="global-search-ship-icon" src="${escapeHtml(ship.icon)}" alt="${escapeHtml(ship.name)}" loading="lazy"
                         onerror="this.style.display='none'">
                    <div class="global-search-ship-info">
                        <span class="global-search-ship-name">${escapeHtml(ship.name)}</span>
                        <span class="global-search-rarity rarity-${ship.rarity}">${ship.rarity}</span>
                    </div>
                    <div class="global-search-ship-links">
                        <a href="${infoUrl}" class="global-search-ship-link" title="함순이 정보">
                            <span class="material-symbols-outlined">database</span>
                        </a>
                        <a href="${skinUrl}" class="global-search-ship-link" title="일러/대사">
                            <span class="material-symbols-outlined">image</span>
                        </a>
                        <a href="${valentineUrl}" class="global-search-ship-link" title="발렌타인">
                            <span class="material-symbols-outlined">mail</span>
                        </a>
                    </div>
                </div>`;
        }
    }

    resultsContainer.innerHTML = html;
    activeIndex = -1;

    // Click handler for ship rows (navigate to default url)
    resultsContainer.querySelectorAll('.global-search-ship').forEach(el => {
        el.addEventListener('click', (e) => {
            // Don't navigate if clicking a sub-link
            if (e.target.closest('.global-search-ship-link')) return;
            const url = el.getAttribute('data-url');
            if (url) window.location.href = url;
        });
    });
}

// ============================================
// KEYBOARD NAVIGATION
// ============================================

function handleKeydown(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        closeSearch();
        return;
    }

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveHighlight(1);
        return;
    }

    if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveHighlight(-1);
        return;
    }

    if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < allResults.length) {
            window.location.href = allResults[activeIndex].url;
        }
    }
}

function moveHighlight(direction) {
    if (allResults.length === 0) return;

    // Remove current highlight
    const prev = resultsContainer.querySelector('[data-index].active');
    if (prev) prev.classList.remove('active');

    // Calculate new index
    activeIndex += direction;
    if (activeIndex < 0) activeIndex = allResults.length - 1;
    if (activeIndex >= allResults.length) activeIndex = 0;

    // Apply highlight and scroll into view
    const next = resultsContainer.querySelector(`[data-index="${activeIndex}"]`);
    if (next) {
        next.classList.add('active');
        next.scrollIntoView({ block: 'nearest' });
    }
}

// ============================================
// HELPERS
// ============================================

function buildPageUrl(path) {
    if (path.startsWith('http')) return path;
    return resolveUrl(path);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================
// START
// ============================================

document.addEventListener('DOMContentLoaded', init);
