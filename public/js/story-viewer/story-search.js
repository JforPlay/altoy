/**
 * story-search.js
 * Page entry for 함순이별 스토리 찾기.
 *
 * Reads the build-time character index (story_actor_index.json, emitted by
 * scripts/split_story_data.mjs) and turns a character pick into deep links to
 * the three story viewers, which already accept `?eventid=&story=`.
 */
import {
    requireElements,
    loadPageData,
    fetchJSONWithCache,
    resolveUrl,
    renderStatus,
    escapeHtml,
    debounce,
    ensureFuse,
    createSearchIndex,
    createImg,
    IMG_FALLBACKS,
    dataForToyUrl,
    normalizeRomanNumerals,
    getUrlParam,
    setUrlParams,
} from '../utils.js';

/** Source code → display label and the viewer that owns those memories. */
const SOURCES = {
    m: { label: '메인스토리', path: 'story-viewer/main-story/' },
    e: { label: '이벤트 스토리', path: 'story-viewer/event-story/' },
    w: { label: '대작전 스토리', path: 'story-viewer/world-story/' },
};
const SOURCE_ORDER = ['m', 'e', 'w'];

// The game's own event grading, same labels the 이벤트 스토리 archive chips use.
const SUBTYPE_LABEL = { 1: 'E.X.', 2: 'S.P.', 3: '데일리' };

// Search results are capped so a broad query ('아') can't render 800 rows —
// and, more importantly, can't fire 800 avatar requests at raw.githubusercontent,
// which answers an image burst with a per-IP 429 that breaks images site-wide.
const MAX_RESULTS = 40;
// Before any query, the most-featured characters double as the starting point.
const DEFAULT_LIST = 30;

const state = {
    index: null,
    ships: [],
    byKey: new Map(),
    fuse: null,
    selectedKey: null,
};

// Ship characters are keyed by gid; story-NPC portraits by `n<actorId>` (see
// scripts/story-actor-index.mjs), and only the former have a skin icon.
const iconUrlFor = (key) => (
    /^\d+$/.test(key) ? dataForToyUrl(`skin_icon/${Number(key) * 10}.webp`) : IMG_FALLBACKS.DEFAULT
);

let elements;

document.addEventListener('DOMContentLoaded', init);

async function init() {
    elements = {
        search: document.getElementById('ship-search'),
        shipList: document.getElementById('ship-list'),
        listLabel: document.getElementById('ship-list-label'),
        panel: document.getElementById('memory-panel'),
    };
    if (!requireElements(elements, 'StorySearch')) return;

    const index = await loadPageData(
        () => fetchJSONWithCache(resolveUrl('data/story-viewer/story_actor_index.json')),
        elements.panel,
        {
            loadingMessage: '등장인물 색인을 불러오는 중...',
            errorMessage: '등장인물 색인을 불러오지 못했습니다.',
            contextLabel: 'StorySearch',
        },
    );
    if (!index) return;

    state.index = index;
    state.ships = Object.keys(index.ships)
        .map((key) => ({
            key,
            name: index.names[key] || `#${key}`,
            searchName: normalizeRomanNumerals(index.names[key] || ''),
            rows: index.ships[key],
        }))
        .sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name, 'ko'));
    state.byKey = new Map(state.ships.map((ship) => [ship.key, ship]));

    elements.search.addEventListener('input', debounce(() => renderShipList(true), 200));
    elements.shipList.addEventListener('click', onShipListClick);

    renderShipList(false);
    restoreFromUrl();

    // Fuse only sharpens ranking; the substring fallback keeps the page usable
    // if the CDN is blocked, so the first render never waits on it.
    await ensureFuse();
    state.fuse = createSearchIndex(state.ships, { keys: ['name', 'searchName'], threshold: 0.35 });
}

/** Open the character named by `?gid=`, so results are linkable and shareable. */
function restoreFromUrl() {
    const ship = state.byKey.get(String(getUrlParam('gid') || ''));
    if (!ship) {
        renderStatus(elements.panel, '왼쪽에서 함순이를 선택하세요.', 'empty');
        return;
    }
    // Seed the query so a shared link also shows the character highlighted in
    // the list — it is usually outside the default most-featured slice.
    elements.search.value = ship.name;
    renderShipList(false);
    selectShip(ship, false);
}

// ===== Character list (left pane) =====

/**
 * @param {boolean} autoSelect - After a query, jump to the top hit so results
 *   appear without a second click.
 */
function renderShipList(autoSelect) {
    const query = elements.search.value.trim();
    const matches = query ? searchShips(query) : state.ships.slice(0, DEFAULT_LIST);
    const shown = matches.slice(0, MAX_RESULTS);

    elements.listLabel.textContent = query
        ? `검색 결과 ${matches.length}명${matches.length > shown.length ? ` (상위 ${shown.length}명 표시)` : ''}`
        : `등장 회상이 많은 함순이 ${shown.length}명`;

    elements.shipList.textContent = '';
    if (shown.length === 0) {
        renderStatus(elements.shipList, '검색 결과가 없습니다.', 'empty');
        return;
    }

    for (const ship of shown) {
        const item = document.createElement('li');
        item.innerHTML = `
            <button type="button" class="story-search-ship" data-key="${escapeHtml(ship.key)}"
                    aria-pressed="${ship.key === state.selectedKey}">
                ${createImg(iconUrlFor(ship.key), '', {
                    className: 'story-search-ship-icon',
                    fallback: IMG_FALLBACKS.DEFAULT,
                })}
                <span class="story-search-ship-name">${escapeHtml(ship.name)}</span>
                <span class="badge badge--neutral story-search-count">${ship.rows.length}</span>
            </button>`;
        elements.shipList.appendChild(item);
    }

    if (autoSelect && shown.length > 0 && !shown.some((ship) => ship.key === state.selectedKey)) {
        selectShip(shown[0], true);
    }
}

function searchShips(query) {
    if (state.fuse) return state.fuse.search(normalizeRomanNumerals(query)).map((hit) => hit.item);
    const needle = query.toLowerCase();
    return state.ships.filter((ship) => ship.name.toLowerCase().includes(needle));
}

function onShipListClick(event) {
    const button = event.target.closest('.story-search-ship');
    if (!button) return;
    const ship = state.byKey.get(button.dataset.key);
    if (ship) selectShip(ship, true);
}

function selectShip(ship, updateUrl) {
    state.selectedKey = ship.key;

    for (const button of elements.shipList.querySelectorAll('.story-search-ship')) {
        button.setAttribute('aria-pressed', String(button.dataset.key === ship.key));
    }

    renderMemories(ship);
    if (updateUrl) setUrlParams({ gid: ship.key }, { replace: true });
}

// ===== Memory list (right pane) =====

function renderMemories(ship) {
    const panel = elements.panel;
    panel.textContent = '';

    // Roster info is absent for story-only NPCs — then it is portrait + name.
    const [rarity, faction] = state.index.info?.[ship.key] || [];
    const tags = [
        rarity ? `<span class="rarity-badge rarity-${escapeHtml(rarity)}">${escapeHtml(rarity)}</span>` : '',
        faction ? `<span class="badge badge--neutral">${escapeHtml(faction)}</span>` : '',
    ].join('');

    const header = document.createElement('header');
    header.className = 'story-search-results-header';
    header.innerHTML = `
        ${createImg(iconUrlFor(ship.key), '', {
            className: 'story-search-results-portrait',
            fallback: IMG_FALLBACKS.DEFAULT,
            eager: true,
        })}
        <div class="story-search-results-meta">
            <h2 class="story-search-results-title">${escapeHtml(ship.name)}</h2>
            <p class="story-search-results-count">등장 회상 ${ship.rows.length}개</p>
            ${tags ? `<div class="story-search-results-tags">${tags}</div>` : ''}
        </div>`;
    panel.appendChild(header);

    const grouped = new Map(SOURCE_ORDER.map((src) => [src, []]));
    for (const row of ship.rows) {
        const memory = state.index.memories[row];
        if (memory) grouped.get(memory[0])?.push(memory);
    }

    for (const src of SOURCE_ORDER) {
        const memories = grouped.get(src);
        if (!memories.length) continue;

        const section = document.createElement('section');
        section.className = 'story-search-group';

        const heading = document.createElement('h3');
        heading.className = 'section-title section-title--sm';
        heading.textContent = `${SOURCES[src].label} (${memories.length})`;
        section.appendChild(heading);

        const list = document.createElement('ul');
        list.className = 'story-search-memories';
        for (const [, eventId, memoryId, title, eventName, subtype] of memories) {
            const item = document.createElement('li');
            const href = resolveUrl(`${SOURCES[src].path}?eventid=${eventId}&story=${memoryId}`);
            const grade = SUBTYPE_LABEL[subtype];
            item.innerHTML = `
                <a class="story-search-memory" href="${escapeHtml(href)}">
                    <span class="story-search-memory-title">${escapeHtml(title || '(제목 없음)')}</span>
                    <span class="story-search-memory-source">
                        ${grade ? `<span class="badge badge--info">${escapeHtml(grade)}</span>` : ''}
                        <span class="story-search-memory-event">${escapeHtml(eventName)}</span>
                    </span>
                </a>`;
            list.appendChild(item);
        }
        section.appendChild(list);
        panel.appendChild(section);
    }
}
