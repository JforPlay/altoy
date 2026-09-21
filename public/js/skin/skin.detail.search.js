/**
 * skin.detail.search.js
 * 함순이 찾아보기 + 랜덤 — the merged browse/random modal for /skin/skin-detail-viewer.
 * (Spec: dev/active/2026-09-21-skin-detail-viewer-renewal.md §6.)
 *
 * ONE modal does both jobs on purpose. 「이 중에서 랜덤으로 보기」 always draws from the
 * CURRENTLY FILTERED set, so narrowing the filters is how a visitor narrows a random
 * pick — that is the merge, and it is why the random button sits under the same count
 * line as the results rather than behind a second entry point.
 *
 * Everything is lazy: the pool is built on the FIRST open, never at page boot, because
 * a visitor arriving on a deep link may never open it. 함종 is the only filter needing
 * data the skin index does not carry (two extra files, ~21 KB gz); it loads beside the
 * pool and a failure hides that one <select> instead of failing the modal.
 *
 * Results cap at PAGE_SIZE rendered cards with a 더 보기 step. That is not cosmetic:
 * raw.githubusercontent.com 429-throttles on image bursts and then serves permanent
 * placeholders (see reference_raw_github_429_images), so ~2,400 portraits at once is
 * not an option.
 */

import {
    DATA_FOR_TOY_BASE, IMG_FALLBACKS, createImgElement, fetchJSONWithCache,
    setupModal, openModal, closeModal, renderStatus, loadPageData,
    requireElements, toggleElement, hideElement, debounce, normalizeRomanNumerals
} from '../utils.js';
import { getSkinFilterData } from './skin.data.js';

// ===== Constants =====

const MODAL_ID = 'skin-search-modal';

/** Cards rendered per page. See the file header: this bounds the image burst. */
const PAGE_SIZE = 120;

const SKIN_ICON_BASE = `${DATA_FOR_TOY_BASE}/skin_icon`;

/**
 * The skin index — re-read here for `clientId`, which getSkinFilterData()'s pool rows
 * do not carry but both the portrait URL and the 함종 join need. skin.data.js already
 * fetched this during its own init, so this resolves out of the IndexedDB cache.
 */
const SKIN_INDEX_URL = 'data/skin/skin_voiceline_index.json';
const SHIP_LITE_URL = 'data/ship_info_lite.json';
const SHIP_TYPE_MAP_URL = 'data/mapping/ship_type_mapping.json';

const byKo = (a, b) => a.localeCompare(b, 'ko');

// ===== State =====

const els = {};

const state = {
    onPick: null,
    ready: false,        // pool built + selects populated
    dataPromise: null,   // in-flight/settled first-open load, so re-opens never refetch
    pool: [],
    filtered: [],
    shown: 0             // cards currently in the DOM, for the 더 보기 step
};

// ===== Data =====

/**
 * gid → 함종 name. Split out because it is the one failure this modal must survive:
 * the caller catches it and the 함종 <select> disappears while everything else works.
 * @returns {Promise<Map<number, string>>}
 */
async function loadShipTypes() {
    const [ships, typeMap] = await Promise.all([
        fetchJSONWithCache(SHIP_LITE_URL),
        fetchJSONWithCache(SHIP_TYPE_MAP_URL)
    ]);

    const byGid = new Map();
    for (const ship of ships || []) {
        // Upstream type_name carries a stray trailing space on at least one type
        // ('잠모 '), which would otherwise split the <option> list and the match.
        const name = String(typeMap?.[String(ship.type)]?.type_name || '').trim();
        if (name) byGid.set(Number(ship.gid), name);
    }
    return byGid;
}

/**
 * Build the filter pool for the modal. Throws on failure so loadPageData() owns the
 * loading/error/retry UI — including the case where skin.data.js has not finished its
 * own init yet, where a retry is exactly the right affordance.
 * @returns {Promise<{pool: Array, filters: Object, shipTypes: string[]|null}>}
 */
async function buildPool() {
    const { pool, filters } = getSkinFilterData();
    if (pool.length === 0) throw new Error('skin index not loaded yet');

    const [index, shipTypes] = await Promise.all([
        fetchJSONWithCache(SKIN_INDEX_URL),
        loadShipTypes().catch((e) => {
            console.warn('[skin search] 함종 data unavailable, hiding that filter', e);
            return null;
        })
    ]);

    // Skin display names are globally unique across the whole index (verified against
    // the committed file), so one flat map is enough to reunite a pool row with its id.
    const clientIds = new Map();
    for (const entry of Object.values(index?.characters || {})) {
        for (const skin of entry?.skins || []) clientIds.set(skin.name, Number(skin.clientId));
    }

    const typeNames = new Set();
    for (const row of pool) {
        // Precomputed once: the name box filters on every keystroke over ~2,400
        // rows, and normalizing both names per row per keystroke is the whole cost.
        row.search = normalizeRomanNumerals(`${row.charName} ${row.skinName}`).toLowerCase();
        row.clientId = clientIds.get(row.skinName) ?? null;
        // clientId encodes shipGroup*10 + skinIndex, so floor(/10) is the ship-group id
        // ship_info_lite is keyed by. The ~25 collab/NPC rows that miss simply carry no
        // 함종 and drop out when one is selected.
        row.shipType = (shipTypes && row.clientId !== null)
            ? (shipTypes.get(Math.floor(row.clientId / 10)) || '')
            : '';
        if (row.shipType) typeNames.add(row.shipType);
    }

    return { pool, filters, shipTypes: shipTypes ? [...typeNames].sort(byKo) : null };
}

/** Start (or reuse) the first-open load. Re-opens and retries share one promise. */
function ensureData() {
    if (state.dataPromise) return state.dataPromise;

    els.results.setAttribute('aria-busy', 'true');
    state.dataPromise = loadPageData(buildPool, els.results, {
        loadingMessage: '스킨 목록을 불러오는 중...',
        errorMessage: '스킨 목록을 불러오지 못했습니다.',
        contextLabel: 'Skin search'
    }).then((data) => {
        els.results.setAttribute('aria-busy', 'false');
        if (data) applyData(data);
        return data;
    });

    return state.dataPromise;
}

/** Stock the five selects from the data that actually exists, then draw. */
function applyData({ pool, filters, shipTypes }) {
    state.pool = pool;

    if (shipTypes) {
        fillSelect(els.shipType, shipTypes);
    } else {
        // Degrade, never fail: the other four filters and the random pick still work.
        hideElement(els.shipType.closest('.sdv-search-field') || els.shipType);
    }
    fillSelect(els.rarity, filters.rarities);          // already N → UR, not alphabetical
    fillSelect(els.nation, [...filters.nations].sort(byKo));
    fillSelect(els.gimmick, filters.tags);
    fillSelect(els.type, filters.types);

    state.ready = true;
    render();
}

function fillSelect(select, values) {
    for (const value of values) select.add(new Option(value, value));
}

// ===== Filtering =====

/**
 * Apply the name box and the five selects. An empty value means 전체 / no
 * narrowing, so it is skipped entirely.
 *
 * The name box is a plain substring match over the precomputed `row.search`, NOT
 * the Fuse index the topbar combobox uses: this one narrows a grid the visitor is
 * looking at, so a fuzzy hit that leaves an unrelated 함순이 on screen reads as a
 * bug, where the combobox's job is to guess a name from a typo.
 */
function getFiltered() {
    const name = normalizeRomanNumerals(els.name.value.trim()).toLowerCase();
    const shipType = els.shipType.value;
    const rarity = els.rarity.value;
    const nation = els.nation.value;
    const gimmick = els.gimmick.value;
    const type = els.type.value;

    return state.pool.filter((row) => {
        if (name && !row.search.includes(name)) return false;
        if (shipType && row.shipType !== shipType) return false;
        if (rarity && row.rarity !== rarity) return false;
        if (nation && row.nation !== nation) return false;
        if (gimmick && !row.tagList.includes(gimmick)) return false;
        if (type && row.type !== type) return false;
        return true;
    });
}

// ===== Render =====

/** Full redraw: every filter change resets the 더 보기 paging back to page one. */
function render() {
    if (!state.ready) return;

    state.filtered = getFiltered();
    state.shown = 0;
    els.results.replaceChildren();

    if (state.filtered.length === 0) {
        renderStatus(els.results, '조건에 맞는 스킨이 없습니다.', 'empty');
        updateFoot();
        return;
    }
    appendPage();
}

/** Append the next PAGE_SIZE cards. One fragment, one reflow. */
function appendPage() {
    const next = state.filtered.slice(state.shown, state.shown + PAGE_SIZE);
    const frag = document.createDocumentFragment();
    next.forEach((row, i) => frag.appendChild(makeCard(row, state.shown + i)));
    els.results.appendChild(frag);
    state.shown += next.length;
    updateFoot();
}

/**
 * One result card. Built as nodes with textContent — never innerHTML — because every
 * string here is upstream game data.
 * @param {Object} row - pool row
 * @param {number} idx - index into state.filtered, read back by the click delegate
 */
function makeCard(row, idx) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'sdv-card card-hover';
    // The palette class only sets --r / --r-fg; the .rarity-tint chip below inherits
    // them, so the rarity colour is declared once and never re-hardcoded here.
    if (row.rarity) card.classList.add(`rarity-${row.rarity}`);
    card.dataset.idx = String(idx);
    card.title = `${row.charName} · ${row.skinName}`;

    const thumb = document.createElement('span');
    thumb.className = 'sdv-card-thumb';
    thumb.appendChild(createImgElement(
        `${SKIN_ICON_BASE}/${row.clientId}.webp`,
        row.skinName,
        { className: 'sdv-card-img', fallback: IMG_FALLBACKS.DEFAULT }
    ));
    if (row.rarity) {
        const tier = document.createElement('span');
        // `.rarity-badge`, not `.rarity-tint`: the tint is a 20% wash of --r, and
        // skin portraits are bright, so on a light card it was invisible. The solid
        // chip is rarity.css's own high-contrast treatment — nothing local needed.
        tier.className = 'sdv-card-rarity rarity-badge';
        tier.textContent = row.rarity;
        thumb.appendChild(tier);
    }
    card.appendChild(thumb);

    const name = document.createElement('span');
    name.className = 'sdv-card-name';
    name.textContent = row.charName;
    card.appendChild(name);

    const skin = document.createElement('span');
    skin.className = 'sdv-card-skin';
    // A base skin's name IS the character name; printing it twice reads as a bug.
    // The element still renders so every card keeps the same height.
    skin.textContent = row.skinName === row.charName ? '' : row.skinName;
    card.appendChild(skin);

    return card;
}

/** Count line, random availability and the 더 보기 step all follow the filtered set. */
function updateFoot() {
    const chars = new Set(state.filtered.map((row) => row.charName));
    els.count.textContent = `함순이 ${chars.size}명 · 스킨 ${state.filtered.length}개`;
    els.random.disabled = state.filtered.length === 0;
    toggleElement(els.more, state.shown < state.filtered.length);
}

// ===== Wiring =====

/**
 * Wire the merged 찾아보기 + 랜덤 modal. Call once at boot; no data is touched until
 * the opener is pressed.
 * @param {Object} config
 * @param {(charName: string, skinName: string) => void} config.onPick - selection handler
 */
export function initSearchModal({ onPick } = {}) {
    Object.assign(els, {
        browseBtn: document.getElementById('skin-browse-btn'),
        name: document.getElementById('sf-name'),
        shipType: document.getElementById('sf-shiptype'),
        rarity: document.getElementById('sf-rarity'),
        nation: document.getElementById('sf-nation'),
        gimmick: document.getElementById('sf-gimmick'),
        type: document.getElementById('sf-type'),
        results: document.getElementById('sf-results'),
        more: document.getElementById('sf-more'),
        count: document.getElementById('sf-count'),
        random: document.getElementById('sf-random')
    });
    if (!requireElements(els, 'Skin search modal')) return;

    state.onPick = typeof onPick === 'function' ? onPick : null;
    els.random.disabled = true;

    const collapse = () => els.browseBtn.setAttribute('aria-expanded', 'false');
    setupModal(MODAL_ID, { restoreFocus: true, onClose: collapse });

    els.browseBtn.addEventListener('click', () => {
        els.browseBtn.setAttribute('aria-expanded', 'true');
        openModal(MODAL_ID, { restoreFocus: true, focusFirst: false });
        // The name box is the natural entry point, and focusing it is also what
        // makes it discoverable next to five selects.
        els.name.focus();
        ensureData();
    });

    [els.shipType, els.rarity, els.nation, els.gimmick, els.type]
        .forEach((select) => select.addEventListener('change', render));

    // Korean IME composition fires `input` per jamo, so a bare handler re-filters
    // ~2,400 rows mid-syllable; 160ms is below the perceived-lag threshold.
    els.name.addEventListener('input', debounce(render, 160));

    els.more.addEventListener('click', appendPage);

    // Delegated: a full page is 120 cards, and each redraw would otherwise re-bind them.
    els.results.addEventListener('click', (e) => {
        const card = e.target.closest('.sdv-card');
        if (!card) return;
        const row = state.filtered[Number(card.dataset.idx)];
        if (row) pick(row);
    });

    els.random.addEventListener('click', () => {
        if (state.filtered.length === 0) return;
        pick(state.filtered[Math.floor(Math.random() * state.filtered.length)]);
    });
}

/** Commit a choice: close first so the page behind is visible as it loads. */
function pick(row) {
    collapseAndClose();
    if (state.onPick) state.onPick(row.charName, row.skinName);
}

function collapseAndClose() {
    els.browseBtn.setAttribute('aria-expanded', 'false');
    closeModal(MODAL_ID, { restoreFocus: true });
}
