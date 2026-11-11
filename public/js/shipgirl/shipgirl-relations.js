/**
 * shipgirl-relations.js
 * Page entry for 함순이 관계도 (/shipgirl/shipgirl-relations/). Boots the graph
 * (relmap_graph.json), mounts the canvas view, wires toolbar, search, panel and
 * ?gid= deep links. Evidence (relmap_evidence.json) loads on the first selection.
 * Siblings: .model.js (scoring/parsing), .camera.js (math), .canvas.js (map), .panel.js.
 */
import {
    requireElements, loadPageData, fetchJSONWithCache, resolveUrl, setupDropdown,
    getUrlParam, setUrlParams, showElement, hideElement, normalizeRomanNumerals,
} from '../utils.js';
import {
    ALL_ON, SOURCES, SOURCE_COLOR, SOURCE_LABEL, parseGraph, resolveDeepLink, loadMatchingEvidence,
} from './shipgirl-relations.model.js';
import { createRelmapView } from './shipgirl-relations.canvas.js';
import { panelHtml } from './shipgirl-relations.panel.js';

document.addEventListener('DOMContentLoaded', init);

async function init() {
    const el = {
        wrap: document.getElementById('relmap-wrap'),
        canvas: document.getElementById('relmap-canvas'),
        status: document.getElementById('relmap-status'),
        tip: document.getElementById('relmap-tip'),
        panel: document.getElementById('relmap-panel'),
        search: document.getElementById('relmap-search'),
        searchDropdown: document.getElementById('relmap-search-dropdown'),
        chips: document.getElementById('relmap-chips'),
        min: document.getElementById('relmap-min'),
        minValue: document.getElementById('relmap-min-value'),
        count: document.getElementById('relmap-count'),
        fit: document.getElementById('relmap-fit'),
    };
    if (!requireElements(el, 'ShipgirlRelations')) return;

    const json = await loadPageData(
        () => fetchJSONWithCache(resolveUrl('data/relmap/relmap_graph.json')),
        el.status,
        { loadingMessage: '관계도를 불러오는 중...', errorMessage: '관계도 데이터를 불러오지 못했습니다.', contextLabel: 'ShipgirlRelations' },
    );
    if (json === null) return;
    const model = parseGraph(json);

    const state = {
        on: { ...ALL_ON }, minScore: 0, showClasses: true, focus: null,
        evidence: null, evidenceState: 'idle',
    };
    const audio = new Audio();
    const view = createRelmapView({
        wrap: el.wrap, canvas: el.canvas, tip: el.tip, model,
        onSelect: (n) => select(n, false),
        onNation: (nat) => view.flyToNation(nat),
    });

    // ===== Evidence (lazy, first selection) =====
    let evidencePromise = null;
    function ensureEvidence() {
        const url = resolveUrl('data/relmap/relmap_evidence.json');
        evidencePromise ??= loadMatchingEvidence((force) => fetchJSONWithCache(url, { forceRefresh: force }), model.id)
            .then((ev) => { state.evidence = ev; state.evidenceState = 'ready'; })
            .catch((err) => {
                console.warn('ShipgirlRelations: evidence load failed', err);
                state.evidenceState = 'error';
                evidencePromise = null; // the next selection retries
            })
            .finally(renderPanel);
        if (state.evidenceState !== 'ready') state.evidenceState = 'loading';
        return evidencePromise;
    }

    // ===== Selection + panel =====
    function select(n, fly = true) {
        state.focus = n;
        view.setFocus(n);
        setUrlParams({ gid: n ? n.gid : null });
        if (!n) { hideElement(el.panel); audio.pause(); return; }
        if (fly) view.flyToNode(n);
        if (state.evidenceState !== 'ready') ensureEvidence();
        renderPanel();
        el.panel.scrollTop = 0;
        showElement(el.panel);
    }
    function renderPanel() {
        const n = state.focus;
        if (!n) return;
        const links = n.adj.filter((l) => l.vis).sort((a, b) => b.s - a.s);
        el.panel.innerHTML = panelHtml({
            node: n, model, links, evidence: state.evidence, evidenceState: state.evidenceState,
            on: state.on, showClasses: state.showClasses, href: resolveUrl,
        });
    }
    el.panel.addEventListener('click', (e) => {
        const playBtn = e.target.closest('.relmap-play');
        if (playBtn) {
            audio.src = playBtn.dataset.audio;
            audio.play().catch(() => {});
            return;
        }
        if (e.target.closest('.relmap-close')) { select(null); return; }
        if (e.target.closest('a')) return;
        const rowEl = e.target.closest('.relmap-row');
        if (rowEl) select(model.nodes[Number(rowEl.dataset.i)]);
    });
    el.panel.addEventListener('keydown', (e) => {
        const rowEl = e.target.closest('.relmap-row');
        if (rowEl && (e.key === 'Enter' || e.key === ' ') && e.target === rowEl) {
            e.preventDefault();
            select(model.nodes[Number(rowEl.dataset.i)]);
        }
    });

    // ===== Toolbar =====
    function applyFilter() {
        const visible = view.setFilter(state.on, state.minScore, state.showClasses);
        el.count.textContent = `함순이 ${model.nodes.length.toLocaleString()}명 · 연결 ${visible.toLocaleString()}개`;
        renderPanel();
    }
    renderChips(el.chips, state, applyFilter);
    el.min.addEventListener('input', () => {
        state.minScore = Number(el.min.value);
        el.minValue.textContent = el.min.value;
        applyFilter();
    });
    el.fit.addEventListener('click', () => { select(null); view.fitAll(); });

    // Search: roman-numeral-insensitive substring, exact name first, then prefixes,
    // so Enter on an exact name jumps straight to her. No select-while-typing:
    // "Z1" is also the start of "Z13".
    const key = (s) => normalizeRomanNumerals(String(s).trim()).toLowerCase();
    const rank = (name, k) => (name === k ? 0 : name.startsWith(k) ? 1 : 2);
    setupDropdown({
        input: el.search,
        dropdown: el.searchDropdown,
        items: model.nodes,
        getLabel: (n) => n.name,
        filterItems: (q, items) => {
            const k = key(q);
            if (!k) return items;
            return items.filter((n) => key(n.name).includes(k))
                .sort((a, b) => rank(key(a.name), k) - rank(key(b.name), k));
        },
        onSelect: (n) => { el.search.value = ''; el.search.blur(); select(n); },
        maxResults: 30,
    });

    applyFilter();
    const deepLinked = resolveDeepLink(model, getUrlParam('gid'));
    if (deepLinked) select(deepLinked);
}

// One toggle chip per link source, plus 함급 (outlines + sister lines, not scored).
function renderChips(container, state, onChange) {
    for (const key of [...SOURCES, 'class']) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip active';
        chip.setAttribute('aria-pressed', 'true');
        const swatch = document.createElement('span');
        swatch.className = 'relmap-swatch';
        swatch.style.background = SOURCE_COLOR[key];
        chip.append(swatch, SOURCE_LABEL[key]);
        chip.addEventListener('click', () => {
            const on = key === 'class' ? (state.showClasses = !state.showClasses) : (state.on[key] = !state.on[key]);
            chip.classList.toggle('active', on);
            chip.setAttribute('aria-pressed', String(on));
            onChange();
        });
        container.appendChild(chip);
    }
}
