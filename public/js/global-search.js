/**
 * global-search.js
 * Global search modal (Ctrl+K) loaded on every page via Layout.astro.
 * Searches both the page catalog (pages.catalog.js) and shipgirl names
 * (lazy-loaded from ship_group_data.json).
 * Depends on Fuse.js (CDN, defer-loaded by Layout), utils.js, and pages.catalog.js.
 */

import {
    debounce,
    fetchJSON,
    resolveUrl,
    createSearchIndex,
    ensureFuse,
    createImgElement,
    createMaterialIcon,
    lockBodyScroll,
    unlockBodyScroll,
} from './utils.js';
import { LINKS } from './global.script.js';
import { PAGE_CATALOG } from './pages.catalog.js';

// ===== State =====

let pageIndex = null;
let pageIndexBuilding = null;
let shipData = null;
let shipIndex = null;
let shipDataLoading = false;
let activeIndex = -1;
let allResults = [];

// ===== DOM References =====

const overlay = document.getElementById('global-search-modal');
const input = document.getElementById('global-search-input');
const resultsContainer = document.getElementById('global-search-results');

// ===== Initialization =====

/**
 * Wire up the global search modal: attach trigger/close handlers, bind input
 * search + keyboard navigation. The page index (and the Fuse.js library it
 * depends on) are built lazily on first openSearch — pages where the user
 * never opens search pay no Fuse-load cost.
 */
function init() {
    if (!overlay || !input || !resultsContainer) return;

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

    // Close button (mobile)
    document.querySelectorAll('.global-search-close').forEach(btn => {
        btn.addEventListener('click', () => overlay.close());
    });

    // Backdrop click: a click whose target is the dialog itself (i.e. the padding
    // around the panel, not the panel) means "outside" — close.
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.close();
    });

    // Single cleanup funnel: native Esc fires `cancel`→`close`, and close()/backdrop
    // also fire `close`, so every close route resets state through one handler.
    overlay.addEventListener('close', onClose);

    // Input events
    input.addEventListener('input', debounce(handleSearch, 150));
    input.addEventListener('keydown', handleKeydown);
}

// ===== Open / Close =====

function openSearch() {
    if (overlay.open) return;
    // showModal() renders the dialog on the top layer, moves focus to the
    // [autofocus] input, inerts the background, and enables native Esc-to-close —
    // all browser guarantees, so the old reflow/rAF focus dance is gone. The
    // explicit focus() is a harmless backstop now that the dialog is truly shown.
    overlay.showModal();
    lockBodyScroll();   // showModal inerts the background but doesn't stop it scrolling
    input.focus({ preventScroll: true });

    // Lazy-load Fuse.js + page index on first open
    if (!pageIndex) {
        ensurePageIndex().then(() => {
            // If user typed during the index build, re-run with Fuse results now available.
            if (overlay.open && input.value.trim()) {
                handleSearch();
            }
        });
    }

    // Lazy-load ship data on first open
    if (!shipData && !shipDataLoading) {
        loadShipData();
    }
}

/**
 * Build the page-catalog Fuse index on demand. Idempotent and safe to call
 * concurrently — repeat calls share the same in-flight build promise.
 */
async function ensurePageIndex() {
    if (pageIndex) return;
    if (!pageIndexBuilding) {
        pageIndexBuilding = (async () => {
            await ensureFuse();
            pageIndex = createSearchIndex(PAGE_CATALOG, {
                keys: [
                    { name: 'name', weight: 2 },
                    { name: 'description', weight: 1 },
                    { name: 'category', weight: 0.5 }
                ],
                threshold: 0.4
            });
        })();
    }
    await pageIndexBuilding;
}

// Runs on the dialog's `close` event — the single funnel for every close route
// (native Esc, backdrop click, close button). Releases the scroll lock and resets
// transient search state so the next open starts clean.
function onClose() {
    unlockBodyScroll();
    input.value = '';
    activeIndex = -1;
    allResults = [];
    renderEmptyMessage('검색어를 입력하세요');
}

function renderEmptyMessage(message) {
    const empty = document.createElement('div');
    empty.className = 'global-search-empty';
    empty.textContent = message;
    resultsContainer.replaceChildren(empty);
}

// ===== Ship Data Loading =====

/**
 * Lazy-load ship name data from ship_group_data.json on first modal open.
 * Builds a Fuse.js index so ship names appear alongside page results.
 */
async function loadShipData() {
    shipDataLoading = true;
    try {
        const raw = await fetchJSON('data/ship_group_data.json');
        // Convert object to array with id. Skip entries with missing/blank names —
        // they would otherwise generate `?ship=undefined` URLs on click.
        shipData = Object.entries(raw)
            .filter(([, ship]) => typeof ship?.name === 'string' && ship.name.trim().length > 0)
            .map(([id, ship]) => ({
                id,
                name: ship.name,
                icon: ship.icon,
                rarity: ship.rarity
            }));
        await ensureFuse();
        shipIndex = createSearchIndex(shipData, {
            keys: [{ name: 'name', weight: 1 }],
            threshold: 0.3
        });
        // If the user typed a query while we were loading, ship results were
        // skipped (shipIndex was null). Re-run the search now that it's ready.
        if (overlay.open && input.value.trim()) {
            handleSearch();
        }
    } catch (e) {
        console.warn('[GlobalSearch] Failed to load ship data:', e);
    }
    shipDataLoading = false;
}

// ===== Search Logic =====

/**
 * Substring fallback for when Fuse.js fails to load. Returns up to `limit`
 * items whose `name` or `description` includes the query (case-insensitive).
 * Mimics Fuse's `{ item }` result shape so the renderer can stay agnostic.
 */
function simpleSearch(items, query, limit, keys = ['name', 'description']) {
    if (!items || !query) return [];
    const needle = query.toLowerCase();
    const out = [];
    for (const item of items) {
        for (const key of keys) {
            if (typeof item[key] === 'string' && item[key].toLowerCase().includes(needle)) {
                out.push({ item });
                break;
            }
        }
        if (out.length >= limit) break;
    }
    return out;
}

/**
 * Run both page and ship indexes against the current input, render combined results.
 * Falls back to substring matching when Fuse.js is unavailable.
 */
function handleSearch() {
    const query = input.value.trim();
    if (!query) {
        activeIndex = -1;
        allResults = [];
        renderEmptyMessage('검색어를 입력하세요');
        return;
    }

    const pageResults = pageIndex
        ? pageIndex.search(query).slice(0, 5)
        : simpleSearch(PAGE_CATALOG, query, 5, ['name', 'description', 'category']);
    const shipResults = shipIndex
        ? shipIndex.search(query).slice(0, 8)
        : simpleSearch(shipData, query, 8, ['name']);

    // Don't show "no results" if ship data is still loading — fast typers would
    // see a flashing empty-state between the page-result render and ship-load
    // completion. Render a loading placeholder under the 함순이 header instead.
    if (pageResults.length === 0 && shipResults.length === 0 && !shipDataLoading) {
        activeIndex = -1;
        allResults = [];
        renderEmptyMessage('검색 결과가 없습니다');
        return;
    }

    allResults = [];
    const fragment = document.createDocumentFragment();

    if (pageResults.length > 0) {
        fragment.appendChild(createSectionHeader('페이지'));
        for (const result of pageResults) {
            fragment.appendChild(createPageResult(result.item));
        }
    }

    if (shipResults.length > 0) {
        fragment.appendChild(createSectionHeader('함순이'));
        for (const result of shipResults) {
            fragment.appendChild(createShipResult(result.item));
        }
    } else if (shipDataLoading) {
        fragment.appendChild(createSectionHeader('함순이'));
        fragment.appendChild(createShipLoadingRow());
    }

    resultsContainer.replaceChildren(fragment);
    activeIndex = -1;
}

function createShipLoadingRow() {
    const row = document.createElement('div');
    row.className = 'global-search-loading';
    row.textContent = '함순이 검색 준비 중...';
    return row;
}

function createSectionHeader(label) {
    const header = document.createElement('div');
    header.className = 'global-search-section';
    header.textContent = label;
    return header;
}

function createPageResult(page) {
    const url = buildPageUrl(page.path);
    const idx = allResults.length;
    allResults.push({ type: 'page', url });

    const link = document.createElement('a');
    link.href = url;
    link.className = 'global-search-item';
    link.dataset.index = String(idx);
    link.dataset.url = url;

    const iconWrap = document.createElement('div');
    iconWrap.className = 'global-search-item-icon';
    iconWrap.appendChild(createMaterialIcon(page.icon));

    const text = document.createElement('div');
    text.className = 'global-search-item-text';
    const name = document.createElement('div');
    name.className = 'global-search-item-name';
    name.textContent = page.name;
    const desc = document.createElement('div');
    desc.className = 'global-search-item-desc';
    desc.textContent = page.description;
    text.append(name, desc);

    const badge = document.createElement('span');
    badge.className = 'global-search-item-badge';
    badge.textContent = page.category;

    link.append(iconWrap, text, badge);
    return link;
}

function createShipResult(ship) {
    const idx = allResults.length;
    const infoUrl = buildPageUrl(LINKS.SHIPGIRL_INFO) + '?ship=' + encodeURIComponent(ship.name);
    const skinUrl = buildPageUrl(LINKS.SKIN_DETAIL) + '?character=' + encodeURIComponent(ship.name);
    const valentineUrl = buildPageUrl(LINKS.VALENTINE) + '?name=' + encodeURIComponent(ship.name);
    allResults.push({ type: 'ship', url: infoUrl });

    const row = document.createElement('div');
    row.className = 'global-search-ship';
    row.dataset.index = String(idx);
    row.dataset.url = infoUrl;
    row.addEventListener('click', (event) => {
        if (event.target.closest('.global-search-ship-link')) return;
        window.location.href = infoUrl;
    });

    const icon = createImgElement(ship.icon, ship.name, {
        className: 'global-search-ship-icon',
        onError() { this.style.display = 'none'; },
    });

    const info = document.createElement('div');
    info.className = 'global-search-ship-info';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'global-search-ship-name';
    nameSpan.textContent = ship.name;
    const raritySpan = document.createElement('span');
    raritySpan.className = `global-search-rarity rarity-${ship.rarity}`;
    raritySpan.textContent = ship.rarity;
    info.append(nameSpan, raritySpan);

    const links = document.createElement('div');
    links.className = 'global-search-ship-links';
    links.append(
        createShipLink(infoUrl, '함순이 정보', 'database'),
        createShipLink(skinUrl, '일러/대사', 'image'),
        createShipLink(valentineUrl, '발렌타인', 'mail'),
    );

    row.append(icon, info, links);
    return row;
}

function createShipLink(href, title, iconName) {
    const link = document.createElement('a');
    link.href = href;
    link.className = 'global-search-ship-link';
    link.title = title;
    link.appendChild(createMaterialIcon(iconName));
    return link;
}

// ===== Keyboard Navigation =====

/**
 * Handle ArrowUp/Down (move highlight) and Enter (navigate to result).
 * Escape is handled natively by <dialog> (cancel → close → onClose).
 */
function handleKeydown(e) {
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

// ===== Helpers =====

function buildPageUrl(path) {
    if (path.startsWith('http')) return path;
    return resolveUrl(path);
}

// ===== Start =====

document.addEventListener('DOMContentLoaded', init);

// Release module-level indexes/data on page unload so bfcache snapshots and
// long-lived tabs don't carry the full catalog + ship index across navigations.
window.addEventListener('pagehide', () => {
    pageIndex = null;
    pageIndexBuilding = null;
    shipData = null;
    shipIndex = null;
    allResults.length = 0;
});
