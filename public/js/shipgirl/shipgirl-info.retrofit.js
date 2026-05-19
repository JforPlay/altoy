/*
 * shipgirl-info.retrofit.js — retrofit node map for the shipgirl-info detail view.
 *
 * Lazy-loads retrofit_map.json on the first retrofittable ship viewed, then
 * renders that ship's node grid (Layout A — game-faithful) into the
 * #retrofitMapSection container, with a tap-a-node detail panel.
 */
import { fetchJSONWithCache, getItemIconUrl } from '../utils.js';

let state = null;
let retrofitMapPromise = null;   // lazy + cached across ships

export function setup(stateRef) {
    state = stateRef;
}

/** Lazy-fetch retrofit_map.json once; null-safe on failure. */
function loadRetrofitMap() {
    if (!retrofitMapPromise) {
        retrofitMapPromise = fetchJSONWithCache('data/retrofit_map.json')
            .catch((err) => {
                console.warn('retrofit_map.json load failed:', err);
                return {};
            });
    }
    return retrofitMapPromise;
}

const KIND_MARK = { modernization: '★', skill: '◆', stat: '' };

/** Korean stat-name fallback table for grant.effect rendering. */
const STAT_KO = {
    durability: '내구', cannon: '화력', antiaircraft: '대공', air: '항공',
    reload: '장전', dodge: '회피', hit: '명중', antisub: '대잠', luck: '행운',
    torpedo: '뇌격',
};

/** Render a node's grant.effect list as "내구 +45, 대공 +60". */
function formatEffect(effect) {
    const parts = [];
    for (const dict of effect || []) {
        for (const [k, v] of Object.entries(dict || {})) {
            if (k === 'skill_id') continue;
            parts.push(`${STAT_KO[k] || k} +${v}`);
        }
    }
    return parts.join(', ');
}

/** Sum gold and every material across all nodes — the full retrofit cost. */
function buildTotals(entry) {
    let gold = 0;
    const items = new Map();   // id -> { name, qty }
    for (const n of entry.nodes) {
        gold += n.cost.gold || 0;
        for (const it of n.cost.items || []) {
            const cur = items.get(it.id);
            if (cur) cur.qty += it.qty;
            else items.set(it.id, { name: it.name, qty: it.qty });
        }
    }
    const mats = [...items.entries()].map(([id, m]) => `
            <span class="retrofit-mat">
              <img src="${getItemIconUrl(id)}" alt="" loading="lazy"
                   data-onfail="hide" class="retrofit-mat__icon">
              <span>${m.name} ×${m.qty}</span>
            </span>`).join('');
    return `
        <div class="retrofit-total">
          <span class="retrofit-total__label">총 필요 재료</span>
          <div class="retrofit-total__mats">
            ${gold ? `<span class="retrofit-mat">💰 ${gold.toLocaleString()}</span>` : ''}
            ${mats}
          </div>
        </div>`;
}

/** Build the grid HTML for one ship's retrofit map entry. */
function buildGrid(entry) {
    const { rows, cols } = entry.grid;
    const minCol = cols[0];
    const span = cols[cols.length - 1] - minCol + 1;
    const byPos = new Map();
    entry.nodes.forEach((n) => byPos.set(`${n.row},${n.col}`, n));

    // The config grid runs level top→bottom, branch left→right. The map is
    // shown rotated 90° counter-clockwise then flipped, so on screen the level
    // axis runs left→right (low level at the left) and branches stack down.
    // Display cell: column = config row (level), row = config branch index.
    let cells = '';
    for (let br = 0; br < span; br++) {
        for (let lv = 0; lv < rows; lv++) {
            const n = byPos.get(`${lv},${minCol + br}`);
            if (!n) {
                cells += '<div class="retrofit-cell retrofit-cell--empty"></div>';
                continue;
            }
            cells += `
                <div class="retrofit-cell">
                  <button class="retrofit-node retrofit-node--${n.kind}"
                          type="button" data-node-id="${n.id}"
                          aria-label="Lv ${n.level} ${n.name}">
                    <span class="retrofit-node__mark">${KIND_MARK[n.kind]}</span>
                    <span class="retrofit-node__lv">Lv${n.level}</span>
                  </button>
                </div>`;
        }
    }

    // Connector centres in the rotated display space (x = level, y = branch).
    const center = (n) => ({
        x: ((n.row + 0.5) / rows) * 100,
        y: ((n.col - minCol + 0.5) / span) * 100,
    });
    const nodeById = new Map(entry.nodes.map((n) => [n.id, n]));
    let lines = '';
    for (const n of entry.nodes) {
        const to = center(n);
        for (const reqId of n.requires) {
            const from = nodeById.get(reqId);
            if (!from) continue;
            const f = center(from);
            lines += `<line x1="${f.x}" y1="${f.y}" x2="${to.x}" y2="${to.y}" />`;
        }
    }

    return `
        <h3 class="section-title">개조 맵</h3>
        <div class="retrofit-map">
          <svg class="retrofit-connectors" viewBox="0 0 100 100"
               preserveAspectRatio="none" aria-hidden="true">${lines}</svg>
          <div class="retrofit-grid"
               style="grid-template-columns:repeat(${rows},1fr)">${cells}</div>
        </div>
        <div class="retrofit-mats">
          <div class="retrofit-detail" id="retrofitNodeDetail"
               aria-live="polite">노드를 선택하세요</div>
          ${buildTotals(entry)}
        </div>`;
}

/** Render the detail panel for a selected node. */
function renderNodeDetail(node) {
    const items = node.cost.items
        .map((it) => `
            <span class="retrofit-mat">
              <img src="${getItemIconUrl(it.id)}" alt="" loading="lazy"
                   data-onfail="hide" class="retrofit-mat__icon">
              <span>${it.name} ×${it.qty}</span>
            </span>`)
        .join('');
    const reward = node.kind === 'modernization'
        ? `근대화 — ${formatEffect(node.grant.effect) || '함종/스킬 강화'}`
        : node.kind === 'skill'
            ? '스킬 강화'
            : (formatEffect(node.grant.effect) || '—');
    return `
        <div class="retrofit-detail__head">
          <span class="retrofit-detail__name">${node.name}</span>
          <span class="retrofit-detail__lv">Lv ${node.level}${
              node.star ? ` · ★${node.star}` : ''}</span>
        </div>
        <div class="retrofit-detail__reward">${reward}</div>
        <div class="retrofit-detail__cost">
          ${node.cost.gold ? `<span class="retrofit-mat">💰 ${node.cost.gold}</span>` : ''}
          ${items}
          ${node.useShip ? '<span class="retrofit-mat">소속함 소모</span>' : ''}
        </div>`;
}

/**
 * Render the retrofit map for `gid` into #retrofitMapSection.
 * Removes the section if the ship has no retrofit data.
 */
export async function renderRetrofitMap(gid) {
    const container = document.getElementById('retrofitMapSection');
    if (!container) return;
    const map = await loadRetrofitMap();
    const entry = map[String(gid)];
    if (!entry || !entry.nodes || !entry.nodes.length) {
        container.remove();
        return;
    }
    container.innerHTML = buildGrid(entry);

    const detail = container.querySelector('#retrofitNodeDetail');
    container.querySelector('.retrofit-grid').addEventListener('click', (e) => {
        const btn = e.target.closest('.retrofit-node');
        if (!btn) return;
        const node = entry.nodes.find((n) => n.id === Number(btn.dataset.nodeId));
        if (!node) return;
        container.querySelectorAll('.retrofit-node--selected')
            .forEach((el) => el.classList.remove('retrofit-node--selected'));
        btn.classList.add('retrofit-node--selected');
        detail.innerHTML = renderNodeDetail(node);
    });
}
