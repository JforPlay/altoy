/**
 * global-search.js
 * Global search modal (Ctrl+K) loaded on every page via Layout.astro.
 * Searches the page catalog (pages.catalog.js), shipgirl names
 * (ship_group_data.json), and equipment names + 별명 (equip_data_lite.json
 * paired with the curator commentary in equip_hearing.json). Both datasets are
 * lazy-loaded on first modal open.
 * Depends on Fuse.js (CDN, defer-loaded by Layout), utils.js, and pages.catalog.js.
 */

import {
    debounce,
    fetchJSON,
    fetchJSONWithCache,
    resolveUrl,
    createSearchIndex,
    ensureFuse,
    createImgElement,
    createMaterialIcon,
    lockBodyScroll,
    unlockBodyScroll,
    renderStatus,
    DATA_FOR_TOY_BASE,
} from './utils.js';
import { LINKS } from './global.script.js';
import { PAGE_CATALOG } from './pages.catalog.js';

// ===== State =====

let pageIndex = null;
let pageIndexBuilding = null;
let shipData = null;
let shipIndex = null;
let shipDataLoading = false;
let equipData = null;
let equipIndex = null;
let equipDataLoading = false;
let upgradeEquipIds = null;
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

    // Lazy-load ship + equip data on first open
    if (!shipData && !shipDataLoading) {
        loadShipData();
    }
    if (!equipData && !equipDataLoading) {
        loadEquipData();
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
    // Canonical compact empty state (status.css); the modal is a tight panel.
    renderStatus(resultsContainer, message, 'empty', { compact: true });
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

// ===== Equip Data Loading =====

const EQUIP_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

// Icon URLs mirror equip.data.js#getEquipIconUrl, inlined so the palette (which
// ships on every page) doesn't pull the equip viewer's data module and its
// simulator dependencies along with it.
const EQUIP_ICON_BASE = `${DATA_FOR_TOY_BASE}/equips`;

/**
 * Lazy-load the equipment list plus the curator 별명 that make nicknames
 * searchable, and the research-tree roster that gates the 장비 연구 sub-link.
 * These are the same cached URLs the 장비 DB page fetches, so a visitor who has
 * already been there pays nothing. 별명 and tree data are optional — losing
 * either must not drop the 장비 section itself.
 */
async function loadEquipData() {
    equipDataLoading = true;
    try {
        const cached = (url) => fetchJSONWithCache(url, { maxAge: EQUIP_CACHE_MAX_AGE });
        const [lite, hearing, upgradeTemplates] = await Promise.all([
            cached('data/equip/equip_data_lite.json'),
            cached('data/equip/equip_hearing.json').catch(() => null),
            cached('data/equip/equip_upgrade_template.json').catch(() => null),
        ]);

        const commentary = hearing?.entries || {};
        equipData = lite.map(equip => ({
            id: equip.id,
            name: equip.name,
            icon: equip.icon,
            rarityName: equip.rarity_name,
            typeName: equip.type_name2 || equip.type_name || '',
            // 별명 arrives as one comma-joined string ("황탄, 노탄"); split it so
            // each nickname matches on its own rather than as a single phrase.
            alias: String(commentary[equip.id]?.alias || '')
                .split(',')
                .map(a => a.trim())
                .filter(Boolean),
        }));

        upgradeEquipIds = new Set();
        for (const template of Object.values(upgradeTemplates || {})) {
            for (const [, , equipId] of template.equipments || []) {
                upgradeEquipIds.add(equipId);
            }
        }

        await ensureFuse();
        equipIndex = createSearchIndex(equipData, {
            keys: [
                { name: 'name', weight: 2 },
                { name: 'alias', weight: 2 }
            ],
            threshold: 0.3
        });
        // Same catch-up as ships: a query typed during the load skipped this index.
        if (overlay.open && input.value.trim()) {
            handleSearch();
        }
    } catch (e) {
        console.warn('[GlobalSearch] Failed to load equip data:', e);
    }
    equipDataLoading = false;
}

function equipIconUrl(iconId) {
    return iconId ? `${EQUIP_ICON_BASE}/${iconId}.webp` : '';
}

// ===== Search Logic =====

/**
 * Substring fallback for when Fuse.js fails to load. Returns up to `limit`
 * items whose `name` or `description` includes the query (case-insensitive).
 * Array-valued keys (equip `alias`) are matched across their entries.
 * Mimics Fuse's `{ item }` result shape so the renderer can stay agnostic.
 */
function simpleSearch(items, query, limit, keys = ['name', 'description']) {
    if (!items || !query) return [];
    const needle = query.toLowerCase();
    const out = [];
    for (const item of items) {
        for (const key of keys) {
            const value = item[key];
            const haystack = Array.isArray(value) ? value.join(' ') : value;
            if (typeof haystack === 'string' && haystack.toLowerCase().includes(needle)) {
                out.push({ item });
                break;
            }
        }
        if (out.length >= limit) break;
    }
    return out;
}

/**
 * Run the page, ship and equip indexes against the current input, render the
 * combined results. Falls back to substring matching when Fuse.js is unavailable.
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
    const equipResults = equipIndex
        ? equipIndex.search(query).slice(0, 6)
        : simpleSearch(equipData, query, 6, ['name', 'alias']);

    // Don't show "no results" while a dataset is still loading — fast typers
    // would see a flashing empty-state between the page-result render and the
    // load completing. Render a loading placeholder under that header instead.
    const stillLoading = shipDataLoading || equipDataLoading;
    if (pageResults.length === 0 && shipResults.length === 0 && equipResults.length === 0 && !stillLoading) {
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
        fragment.appendChild(createLoadingRow('함순이 검색 준비 중...'));
    }

    if (equipResults.length > 0) {
        fragment.appendChild(createSectionHeader('장비'));
        for (const result of equipResults) {
            fragment.appendChild(createEquipResult(result.item));
        }
    } else if (equipDataLoading) {
        fragment.appendChild(createSectionHeader('장비'));
        fragment.appendChild(createLoadingRow('장비 검색 준비 중...'));
    }

    resultsContainer.replaceChildren(fragment);
    activeIndex = -1;
}

function createLoadingRow(message) {
    // Canonical compact loading state (status.css). renderStatus inserts into a
    // host and returns the element; re-parent it onto the results fragment.
    return renderStatus(document.createElement('div'), message, 'loading', { compact: true });
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
    badge.className = 'badge badge--neutral global-search-item-badge';
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
        createRowLink(infoUrl, '함순이 정보', 'database'),
        createRowLink(skinUrl, '일러/대사', 'image'),
        createRowLink(valentineUrl, '발렌타인', 'mail'),
    );

    row.append(icon, info, links);
    return row;
}

/**
 * Build one equipment row. Reuses the shipgirl row layout (icon + name + rarity
 * + sub-links) with the 별명 on the second line, falling back to the type name
 * when the curator hasn't given the equip a nickname. The 장비 연구 link only
 * appears for equips that actually sit in a research tree.
 */
function createEquipResult(equip) {
    const idx = allResults.length;
    const dbUrl = `${buildPageUrl(LINKS.EQUIP_VIEWER)}?equip=${equip.id}`;
    allResults.push({ type: 'equip', url: dbUrl });

    const row = document.createElement('div');
    row.className = 'global-search-ship';
    row.dataset.index = String(idx);
    row.dataset.url = dbUrl;
    row.addEventListener('click', (event) => {
        if (event.target.closest('.global-search-ship-link')) return;
        window.location.href = dbUrl;
    });

    const icon = createImgElement(equipIconUrl(equip.icon), equip.name, {
        className: 'global-search-ship-icon',
        onError() { this.style.display = 'none'; },
    });

    const info = document.createElement('div');
    info.className = 'global-search-ship-info';
    const nameLine = document.createElement('div');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'global-search-ship-name';
    nameSpan.textContent = equip.name;
    const raritySpan = document.createElement('span');
    raritySpan.className = `global-search-rarity rarity-${equip.rarityName}`;
    raritySpan.textContent = equip.rarityName;
    nameLine.append(nameSpan, raritySpan);
    const subLine = document.createElement('div');
    subLine.className = 'global-search-item-desc';
    subLine.textContent = equip.alias.length
        ? `별명: ${equip.alias.join(', ')}`
        : equip.typeName;
    info.append(nameLine, subLine);

    const links = document.createElement('div');
    links.className = 'global-search-ship-links';
    links.appendChild(createRowLink(dbUrl, '장비 DB', 'settings'));
    if (upgradeEquipIds?.has(equip.id)) {
        links.appendChild(createRowLink(
            `${buildPageUrl(LINKS.EQUIP_UPGRADE)}?equip=${equip.id}`, '장비 연구', 'science'
        ));
    }

    row.append(icon, info, links);
    return row;
}

function createRowLink(href, title, iconName) {
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
// long-lived tabs don't carry the full catalog + ship/equip indexes across
// navigations.
window.addEventListener('pagehide', () => {
    pageIndex = null;
    pageIndexBuilding = null;
    shipData = null;
    shipIndex = null;
    equipData = null;
    equipIndex = null;
    upgradeEquipIds = null;
    allResults.length = 0;
});
