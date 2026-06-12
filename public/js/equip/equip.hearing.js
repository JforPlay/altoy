/**
 * equip.hearing.js
 * 장비 한줄평 아카이브 — renders the full equip catalog (equip_data_lite.json)
 * joined with curator commentary (equip_hearing.json, synced from the Google
 * Sheet by scripts/sync-equip-hearing.mjs). Read-only: the site never writes
 * commentary. Equips without commentary still render (is-empty cards) so new
 * game items surface immediately after a data refresh.
 */

import {
    requireElements, loadPageData, fetchJSONWithCache, escapeHtml,
    sanitizeClassToken, ensureFuse, createSearchIndex, debounce,
} from '../utils.js';
import { getEquipIconUrl, getRarityBgUrl } from './equip.data.js';

const state = {
    equips: [],     // equip_data_lite entries, original order
    hearing: {},    // equip id (string) → { alias, reviews: string[] }
    fuse: null,     // Fuse index over {id, name, alias}; null until loaded (substring fallback)
    // rarities: numeric-string codes like equip-viewer (2=N … 6=UR); empty set = show all.
    // SSR+UR default mirrors the pre-set .active chips in the .astro markup — keep in sync.
    filters: { query: '', type: 'all', written: 'all', rarities: new Set(['5', '6']), sort: 'default' },
    writtenCount: 0,    // equips with any commentary — static after load
};

let els = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
    els = {
        list: document.getElementById('hearingList'),
        search: document.getElementById('hearingSearch'),
        type: document.getElementById('hearingType'),
        written: document.getElementById('hearingWritten'),
        rarity: document.getElementById('hearingRarity'),
        sort: document.getElementById('hearingSort'),
        count: document.getElementById('hearingCount'),
    };
    if (!requireElements(els, 'EquipHearing')) return;

    const data = await loadPageData(
        () => Promise.all([
            fetchJSONWithCache('data/equip/equip_data_lite.json'),
            fetchJSONWithCache('data/equip/equip_hearing.json'),
        ]),
        els.list,
        {
            loadingMessage: '장비 데이터를 불러오는 중...',
            errorMessage: '장비 데이터를 불러오지 못했습니다.',
            contextLabel: 'EquipHearing',
        }
    );
    if (data === null) return;
    state.equips = data[0];
    state.hearing = data[1]?.entries || {};
    state.writtenCount = state.equips.filter((e) => state.hearing[String(e.id)]).length;

    buildTypeOptions();
    wireListeners();
    render();

    // Fuse is progressive enhancement — render first, index after
    await ensureFuse();
    state.fuse = createSearchIndex(
        state.equips.map((e) => ({
            id: e.id,
            name: e.name,
            alias: state.hearing[String(e.id)]?.alias || '',
        })),
        { keys: ['name', 'alias'] }
    );
}

/** Populate the type <select> from unique (type, type_name2) pairs, by type id. */
function buildTypeOptions() {
    const seen = new Map();
    for (const e of state.equips) {
        if (!seen.has(e.type)) seen.set(e.type, e.type_name2 || e.type_name || `타입 ${e.type}`);
    }
    for (const [typeId, label] of [...seen.entries()].sort((a, b) => a[0] - b[0])) {
        const opt = document.createElement('option');
        opt.value = String(typeId);
        opt.textContent = label;
        els.type.appendChild(opt);
    }
}

function wireListeners() {
    els.search.addEventListener('input', debounce(() => {
        state.filters.query = els.search.value.trim();
        render();
    }, 150));
    els.type.addEventListener('change', () => {
        state.filters.type = els.type.value;
        render();
    });
    els.written.addEventListener('change', () => {
        state.filters.written = els.written.value;
        render();
    });
    els.rarity.addEventListener('click', (ev) => {
        const chip = ev.target.closest('.rarity-chip');
        if (!chip) return;
        const rarity = chip.dataset.rarity;
        if (state.filters.rarities.has(rarity)) {
            state.filters.rarities.delete(rarity);
            chip.classList.remove('active');
        } else {
            state.filters.rarities.add(rarity);
            chip.classList.add('active');
        }
        render();
    });
    els.sort.addEventListener('change', () => {
        state.filters.sort = els.sort.value;
        render();
    });
}

/**
 * Sort a filtered list per the sort select. Array.prototype.sort is stable,
 * so ties keep the catalog's original order.
 */
function sortList(list) {
    const { sort } = state.filters;
    if (sort === 'rarity') return [...list].sort((a, b) => (b.rarity ?? 0) - (a.rarity ?? 0));
    if (sort === 'type') {
        return [...list].sort((a, b) => (a.type - b.type) || ((b.rarity ?? 0) - (a.rarity ?? 0)));
    }
    return list;
}

function applyFilters() {
    const { query, type, written, rarities } = state.filters;
    let list = state.equips;
    if (rarities.size > 0) list = list.filter((e) => rarities.has(String(e.rarity)));
    if (type !== 'all') list = list.filter((e) => String(e.type) === type);
    if (written !== 'all') {
        // an entry with only an alias still counts as 작성됨 — any commentary at all
        // (mirrors _meta.count in equip_hearing.json, which counts entries, not reviews)
        list = list.filter((e) => Boolean(state.hearing[String(e.id)]) === (written === 'written'));
    }
    if (query) {
        if (state.fuse) {
            const hit = new Set(state.fuse.search(query).map((r) => r.item.id));
            list = list.filter((e) => hit.has(e.id));
        } else {
            const q = query.toLowerCase();
            list = list.filter((e) =>
                e.name.toLowerCase().includes(q) ||
                (state.hearing[String(e.id)]?.alias || '').toLowerCase().includes(q));
        }
    }
    return list;
}

function render() {
    const list = sortList(applyFilters());
    els.list.innerHTML = list.map(cardHtml).join('');
    els.count.textContent = `${state.writtenCount}/${state.equips.length} 작성 · ${list.length}개 표시`;
}

function cardHtml(e) {
    const entry = state.hearing[String(e.id)];
    const iconUrl = getEquipIconUrl(e.icon);
    const reviews = (entry?.reviews || []).map(reviewHtml).join('');
    return `
    <article class="hearing-card${entry ? '' : ' is-empty'}">
        <div class="hearing-equip">
            <div class="hearing-icon">
                <img class="hearing-icon-bg" src="${getRarityBgUrl(e.rarity ?? 2)}" alt="" loading="lazy">
                ${iconUrl ? `<img class="hearing-icon-img" src="${iconUrl}" alt="${escapeHtml(e.name)}" loading="lazy">` : ''}
            </div>
            <div class="hearing-equip-meta">
                <div class="hearing-name">${escapeHtml(e.name)}</div>
                <div class="hearing-chips">
                    <span class="hearing-chip rarity-${sanitizeClassToken(e.rarity_name)}">${escapeHtml(e.rarity_name)}</span>
                    <span class="hearing-chip">${escapeHtml(e.type_name2 || e.type_name || '')}</span>
                    <span class="hearing-chip">${escapeHtml(e.nation_code || '')}</span>
                </div>
                ${entry?.alias ? `<div class="hearing-alias">${escapeHtml(entry.alias)}</div>` : ''}
            </div>
        </div>
        <div class="hearing-comments">
            ${reviews || '<div class="hearing-no-comment">아직 작성된 한줄평이 없습니다</div>'}
        </div>
    </article>`;
}

/** One anonymous 한줄평 line (sheet 한줄평N cell; may contain newlines). */
function reviewHtml(review) {
    return `<div class="hearing-comment">${escapeHtml(review).replace(/\n/g, '<br>')}</div>`;
}
