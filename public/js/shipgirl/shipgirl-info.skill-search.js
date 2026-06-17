/**
 * shipgirl-info.skill-search.js
 * Skill search modal: find ships by skill name, rendered description, or derived keyword tags.
 * Part of the shipgirl-info module group. State is shared via a ref passed to setup().
 */

import {
    processSkillDescription,
    getSkillIconUrl,
    loadSkillIconData,
    loadSkillToIconId,
    loadSkillDataTemplate
} from './shipgirl-info.data.js';
import { openModal, closeModal, createSearchIndex, ensureFuse, debounce, escapeHtml, renderStatus } from '../utils.js';

'use strict';

// ============================================
// TAG KEYWORD MAP
// ============================================
// Each tag name is the chip label shown in the UI.
// Each value is a list of regex alternates tested against the rendered description.
// These are intentionally coarse — see dev/design/2026-04-23-shipgirl-skill-search-design.md
// for the documented edge cases (e.g. `기함` over-matches, `대미지 감소` doesn't
// distinguish defensive vs debuff).
const TAG_MAP = {
    stat: {
        '화력':     [/화력/],
        '장전':     [/장전/],
        '명중':     [/명중/],
        '회피':     [/회피/],
        '뇌장':     [/뇌장/],
        '항공':     [/항공/],
        '대공':     [/대공/],
        '크리티컬': [/크리티컬|치명/],
    },
    weapon: {
        '주포':     [/주포/],
        '부포':     [/부포/],
        '어뢰':     [/어뢰/],
        '함재기':   [/함재기/],
        '특수탄막': [/특수탄막/],
    },
    effect: {
        '회복':         [/회복/],
        '실드':         [/실드/],
        '대미지 감소': [/대미지.{0,3}감소|받는 대미지.{0,5}감소/],
        '소환':         [/소환/],
        '기함':         [/기함/],
    },
    trigger: {
        '주포 발사 시': [/주포.{0,5}발사/],
        'N초마다':     [/\d+\s*초마다|매\s*\d+\s*초/],
        '전투 시작 시': [/전투 시작 시/],
        '명중 시':     [/명중 시|적에게.{0,5}명중/],
        '피격 시':     [/피격 시|공격받/],
    },
};

/** Return { stat:[], weapon:[], effect:[], trigger:[] } for a rendered skill description. */
function classifySkill(desc) {
    const tags = { stat: [], weapon: [], effect: [], trigger: [] };
    for (const group of Object.keys(TAG_MAP)) {
        for (const [label, patterns] of Object.entries(TAG_MAP[group])) {
            if (patterns.some(re => re.test(desc))) {
                tags[group].push(label);
            }
        }
    }
    return tags;
}

// ============================================
// STATE
// ============================================
let state;                 // shared state ref from shipgirl-info.js
let skillCorpus = null;    // built once on first open; array of per-skill records
let shipIndex = null;      // Map<number, {id, name, shipyard, rarity}> for fast ship lookup
const BATCH_SIZE = 50;     // cards rendered per batch when result set is large
let batchObserver = null;  // IntersectionObserver driving incremental render
let fuseIndex = null;      // built once after corpus
const filters = {
    query: '',
    stat: new Set(),
    weapon: new Set(),
    effect: new Set(),
    trigger: new Set(),
    rarity: new Set(['all']),  // 'all' OR any of: 'UR','SSR','SR','R','N'
    shipType: 'all',           // 'all' OR stringified type number
    view: 'skill'              // 'skill' | 'ship'
};

export function setup(stateRef) {
    state = stateRef;

    const btn = document.getElementById('skillSearchBtn');
    if (btn) {
        btn.addEventListener('click', handleOpen);
    }
}

// ============================================
// CORPUS BUILD (lazy, first open only)
// ============================================

/**
 * Build the skill corpus from already-loaded data. Awaits fullShipDataPromise
 * if the background load hasn't finished yet.
 */
async function buildCorpus() {
    if (skillCorpus) return skillCorpus;

    // Wait for full ship data (background-loaded by shipgirl-info.data.js).
    // Kick off the lazy Fuse load alongside the ship/skill data fetches; getFilteredSkills
    // can stay synchronous because Fuse will be ready before the corpus is.
    if (!state.fullShipData && state.fullShipDataPromise) {
        await state.fullShipDataPromise;
    }
    await Promise.all([loadSkillIconData(), loadSkillToIconId(), loadSkillDataTemplate(), ensureFuse()]);

    if (!state.fullShipData || !state.skillDataTemplate || Object.keys(state.skillDataTemplate).length === 0) {
        throw new Error('데이터 로딩이 완료되지 않았습니다');
    }

    // Step 1: build ship lookup index (id → lite-ish record for cards/avatars).
    shipIndex = new Map();
    for (const ship of state.shipgirlData) {
        shipIndex.set(ship.id, {
            id: ship.id,
            name: ship.name,
            shipyard: ship.shipyard,
            rarity: ship.rarity,
            type: ship.type
        });
    }

    // Step 2: collect skill ID → [shipId,...] reverse index.
    const skillToShips = new Map();
    for (const ship of Object.values(state.fullShipData)) {
        const ids = new Set();
        if (ship.skill) {
            for (const entry of Object.values(ship.skill)) {
                if (entry?.id) ids.add(entry.id);
            }
        }
        if (ship.retrofit?.skill_id) {
            ids.add(ship.retrofit.skill_id);
        }
        for (const id of ids) {
            if (!skillToShips.has(id)) skillToShips.set(id, []);
            skillToShips.get(id).push(ship.id);
        }
    }

    // Step 3: resolve each skill ID through skill_data_template, drop empty descriptions.
    skillCorpus = [];
    for (const [skillId, shipIds] of skillToShips) {
        const raw = state.skillDataTemplate[String(skillId)];
        if (!raw) continue;
        const desc = processSkillDescription(raw.desc, raw.desc_get_add);
        if (!desc || desc === '설명 없음' || !raw.desc?.trim()) continue;

        skillCorpus.push({
            id: skillId,
            name: raw.name || `스킬 ${skillId}`,
            desc,
            iconUrl: getSkillIconUrl(skillId),
            ships: shipIds,
            tags: classifySkill(desc)
        });
    }

    return skillCorpus;
}

// ============================================
// OPEN / RENDER
// ============================================

async function handleOpen() {
    openModal('skillSearchModal');

    const body = document.getElementById('skillSearchBody');
    if (!body) return;

    if (!skillCorpus) {
        body.innerHTML = '<div id="skillSearchLoading" style="padding: 1rem;">로딩 중...</div>';
        try {
            await buildCorpus();
        } catch (err) {
            console.error('[skill-search] corpus build failed:', err);
            body.innerHTML = `<div style="padding: 1rem; color: var(--danger-color);">
                스킬 데이터를 불러오지 못했습니다: ${err.message}
            </div>`;
            return;
        }
    }

    // Only render the shell + wire controls once. On reopen, the DOM persists
    // (still inside the hidden modal), so filter/chip/input state stays in sync.
    if (!document.getElementById('skillSearchResults')) {
        body.innerHTML = renderShell();
        wireControls();
    }
    applyFilters();
}

function renderShell() {
    const chipRows = Object.entries(TAG_MAP).map(([group, tags]) => {
        const label = { stat: '스탯', weapon: '무기', effect: '효과', trigger: '발동' }[group];
        const chips = Object.keys(tags).map(tag =>
            `<button type="button" class="skill-chip" data-group="${group}" data-tag="${tag}">${tag}</button>`
        ).join('');
        return `<div class="skill-chip-row">
            <span class="skill-chip-row-label">${label}:</span>
            <div class="skill-chip-row-chips">${chips}</div>
        </div>`;
    }).join('');

    // Rarity chips: [전체] [UR] [SSR] [SR] [R] [N].
    // Has an extra 'all' filter entry; not utils.RARITY_TIERS_DESC.
    const rarityOptions = ['all', 'UR', 'SSR', 'SR', 'R', 'N'];
    const rarityChips = rarityOptions.map(r => {
        const label = r === 'all' ? '전체' : r;
        const activeClass = filters.rarity.has(r) ? ' active' : '';
        const rarityClass = r === 'all' ? '' : ` skill-rarity-chip-${r.toLowerCase()}`;
        return `<button type="button" class="skill-chip skill-rarity-chip${rarityClass}${activeClass}" data-rarity="${r}">${label}</button>`;
    }).join('');

    // Ship type dropdown options (distinct types, sorted, with Korean names from shipTypeData).
    const presentTypes = [...new Set(state.shipgirlData.map(s => s.type))]
        .sort((a, b) => a - b);
    const shipTypeOptions = ['<option value="all">모든 함종</option>']
        .concat(presentTypes.map(t => {
            const info = state.shipTypeData[String(t)];
            const name = info ? info.type_name : `함종 ${t}`;
            return `<option value="${t}">${name}</option>`;
        })).join('');

    return `
        <div class="skill-search-toolbar">
            <input type="text" id="skillSearchInput" class="skill-search-input" placeholder="이름/설명 검색...">
            <div class="skill-search-view-toggle btn-group">
                <button type="button" class="btn btn-outline skill-view-btn is-active" data-view="skill">스킬별</button>
                <button type="button" class="btn btn-outline skill-view-btn" data-view="ship">함순이별</button>
            </div>
        </div>
        <div class="skill-ship-filter-rows">
            <div class="skill-chip-row">
                <span class="skill-chip-row-label">등급:</span>
                <div class="skill-chip-row-chips">${rarityChips}</div>
            </div>
            <div class="skill-chip-row">
                <span class="skill-chip-row-label">함종:</span>
                <select id="skillShipTypeFilter" class="skill-ship-type-select">${shipTypeOptions}</select>
            </div>
        </div>
        <div class="skill-chip-rows">${chipRows}</div>
        <div class="skill-search-meta">
            <span id="skillSearchCount">결과 0개</span>
            <button type="button" id="skillSearchReset" class="skill-search-reset">필터 초기화</button>
        </div>
        <div id="skillSearchResults" class="skill-search-results"></div>
    `;
}

// ============================================
// CONTROLS WIRING & FILTERING
// ============================================

function wireControls() {
    const input = document.getElementById('skillSearchInput');
    if (input) {
        input.addEventListener('input', debounce(() => {
            filters.query = input.value.trim();
            applyFilters();
        }, 150));
    }

    document.querySelectorAll('.skill-chip[data-group]').forEach(btn => {
        btn.addEventListener('click', () => {
            const { group, tag } = btn.dataset;
            const set = filters[group];
            if (set.has(tag)) set.delete(tag);
            else set.add(tag);
            btn.classList.toggle('active');
            applyFilters();
        });
    });

    document.querySelectorAll('.skill-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            filters.view = btn.dataset.view;
            document.querySelectorAll('.skill-view-btn').forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            applyFilters();
        });
    });

    const reset = document.getElementById('skillSearchReset');
    if (reset) {
        reset.addEventListener('click', () => {
            filters.query = '';
            for (const g of ['stat', 'weapon', 'effect', 'trigger']) filters[g].clear();
            filters.rarity.clear();
            filters.rarity.add('all');
            filters.shipType = 'all';
            document.querySelectorAll('.skill-chip.active').forEach(c => c.classList.remove('active'));
            document.querySelectorAll('.skill-rarity-chip').forEach(c => {
                c.classList.toggle('active', c.dataset.rarity === 'all');
            });
            const inputEl = document.getElementById('skillSearchInput');
            if (inputEl) inputEl.value = '';
            const shipTypeSel = document.getElementById('skillShipTypeFilter');
            if (shipTypeSel) shipTypeSel.value = 'all';
            applyFilters();
        });
    }

    const listEl = document.getElementById('skillSearchResults');
    if (listEl) {
        listEl.addEventListener('click', (e) => {
            const target = e.target.closest('[data-ship-name]');
            if (!target) return;
            const name = target.dataset.shipName;
            closeModal('skillSearchModal');
            if (typeof state.navigateToDetail === 'function') {
                state.navigateToDetail(name);
            }
        });
    }

    // Rarity chip handling with "전체" (all) vs specific-mode semantics.
    document.querySelectorAll('.skill-rarity-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const rarity = btn.dataset.rarity;
            if (rarity === 'all') {
                if (filters.rarity.has('all')) return;  // no-op: already all
                filters.rarity.clear();
                filters.rarity.add('all');
            } else {
                if (filters.rarity.has('all')) {
                    filters.rarity.clear();
                    filters.rarity.add(rarity);
                } else if (filters.rarity.has(rarity)) {
                    filters.rarity.delete(rarity);
                    if (filters.rarity.size === 0) filters.rarity.add('all');
                } else {
                    filters.rarity.add(rarity);
                }
            }
            // Sync DOM active state across all rarity chips.
            document.querySelectorAll('.skill-rarity-chip').forEach(c => {
                c.classList.toggle('active', filters.rarity.has(c.dataset.rarity));
            });
            applyFilters();
        });
    });

    // Ship type dropdown.
    const shipTypeSel = document.getElementById('skillShipTypeFilter');
    if (shipTypeSel) {
        shipTypeSel.addEventListener('change', () => {
            filters.shipType = shipTypeSel.value;
            applyFilters();
        });
    }
}

/** Ship passes rarity + shipType filters. Called by skill and ship views. */
function shipPassesMetaFilter(shipId) {
    const ship = shipIndex.get(shipId);
    if (!ship) return false;
    if (!filters.rarity.has('all') && !filters.rarity.has(ship.rarity)) return false;
    if (filters.shipType !== 'all' && String(ship.type) !== filters.shipType) return false;
    return true;
}

/** Filter corpus by active tags then text query. Returns a list of skill records. */
function getFilteredSkills() {
    if (!skillCorpus) return [];

    // Tag filter: within-group OR, across-group AND.
    let filtered = skillCorpus.filter(s => {
        for (const g of ['stat', 'weapon', 'effect', 'trigger']) {
            const active = filters[g];
            if (active.size === 0) continue;
            const match = s.tags[g].some(t => active.has(t));
            if (!match) return false;
        }
        return true;
    });

    // Ship meta filter: rarity + shipType. A skill passes if at least ONE of
    // its owning ships passes the meta filter. For performance, skip the check
    // when no meta filter is active.
    const metaActive = !filters.rarity.has('all') || filters.shipType !== 'all';
    if (metaActive) {
        filtered = filtered.filter(s => s.ships.some(shipPassesMetaFilter));
    }

    // Text search via Fuse (built once against the full corpus).
    if (filters.query) {
        if (!fuseIndex) {
            fuseIndex = createSearchIndex(skillCorpus, {
                keys: [{ name: 'name', weight: 0.7 }, { name: 'desc', weight: 0.3 }],
                threshold: 0.3,
                ignoreLocation: true
            });
        }
        const hits = new Set(fuseIndex.search(filters.query).map(r => r.item.id));
        filtered = filtered.filter(s => hits.has(s.id));
    }

    return filtered;
}

function renderSkillCard(skill) {
    const allTags = [...skill.tags.stat, ...skill.tags.weapon, ...skill.tags.effect, ...skill.tags.trigger];
    const tagHtml = allTags.map(t => `<span class="skill-tag">#${t}</span>`).join('');

    // Cap avatar row at 8, show +N for the rest.
    const ships = skill.ships.map(id => shipIndex.get(id)).filter(Boolean);
    const visibleShips = ships.slice(0, 8);
    const hiddenCount = ships.length - visibleShips.length;
    const avatarHtml = visibleShips.map(s => `
        <button type="button" class="skill-result-ship-btn" data-ship-name="${escapeHtml(s.name)}" title="${escapeHtml(s.name)}">
            <img src="${escapeHtml(s.shipyard)}" alt="${escapeHtml(s.name)}" loading="lazy" data-onfail="invisible">
        </button>
    `).join('') + (hiddenCount > 0 ? `<span class="skill-result-ship-more">+${hiddenCount}</span>` : '');

    const iconHtml = skill.iconUrl
        ? `<img class="skill-result-icon" src="${escapeHtml(skill.iconUrl)}" alt="" loading="lazy" data-onfail="hide">`
        : `<div class="skill-result-icon-placeholder">${skill.id}</div>`;

    return `
        <div class="skill-result-card">
            <div class="skill-result-header">
                ${iconHtml}
                <div class="skill-result-title">
                    <strong>${skill.name}</strong>
                    <span class="skill-result-id">ID: ${skill.id}</span>
                </div>
                <div class="skill-result-tags">${tagHtml}</div>
            </div>
            <div class="skill-result-desc">${skill.desc}</div>
            <div class="skill-result-ships">
                <span class="skill-result-ships-label">보유 함순이:</span>
                <div class="skill-result-ships-row">${avatarHtml}</div>
            </div>
        </div>
    `;
}

/**
 * Project a list of filtered skills into a list of ships, keyed by ship.id,
 * with the matching skills attached. Used by the ship-centric view.
 */
function projectToShips(skills) {
    const byShip = new Map();
    for (const skill of skills) {
        for (const shipId of skill.ships) {
            if (!shipPassesMetaFilter(shipId)) continue;
            const ship = shipIndex.get(shipId);
            if (!ship) continue;
            if (!byShip.has(shipId)) byShip.set(shipId, { ship, skills: [] });
            byShip.get(shipId).skills.push(skill);
        }
    }
    // Sort ships by matching-skill count desc, then by id asc.
    return [...byShip.values()].sort((a, b) =>
        (b.skills.length - a.skills.length) || (a.ship.id - b.ship.id)
    );
}

function renderShipCard({ ship, skills }) {
    // Compact one-row-per-skill: bolded name + middle dot + CSS-truncated desc.
    // `title` attr keeps hover-for-full-desc working on desktop; mobile gets
    // always-visible info via the inline truncated line.
    const rows = skills.map(s => {
        const inlineDesc = s.desc.replace(/\s+/g, ' ').trim();
        return `
            <div class="skill-result-ship-skill-row" title="${escapeHtml(inlineDesc)}">
                <strong class="skill-row-name">${s.name}</strong>
                <span class="skill-row-sep">·</span>
                <span class="skill-row-desc">${inlineDesc}</span>
            </div>
        `;
    }).join('');

    return `
        <button type="button" class="skill-result-ship-card" data-ship-name="${escapeHtml(ship.name)}">
            <img class="skill-result-ship-portrait" src="${escapeHtml(ship.shipyard)}" alt="${escapeHtml(ship.name)}" loading="lazy" data-onfail="invisible">
            <div class="skill-result-ship-info">
                <div class="skill-result-ship-name">
                    <strong>${ship.name}</strong>
                    <span class="rarity-badge rarity-${ship.rarity}">${ship.rarity}</span>
                </div>
                <div class="skill-result-ship-skills">${rows}</div>
            </div>
        </button>
    `;
}

/**
 * Render a list in 50-item batches driven by IntersectionObserver so first paint
 * stays fast. `renderFn(item)` returns an HTML string. Disconnects any prior
 * observer on entry — safe to call from any path without a caller-side reset.
 */
function renderBatchedResults(items, listEl, renderFn) {
    if (batchObserver) {
        batchObserver.disconnect();
        batchObserver = null;
    }

    let cursor = 0;

    // Eager first batch for fast first paint.
    const firstChunk = items.slice(0, BATCH_SIZE);
    listEl.innerHTML = firstChunk.map(renderFn).join('');
    cursor = firstChunk.length;

    if (cursor >= items.length) return;

    const sentinel = document.createElement('div');
    sentinel.className = 'skill-search-sentinel';
    sentinel.textContent = '로딩 중...';
    listEl.appendChild(sentinel);

    const renderNext = () => {
        const chunk = items.slice(cursor, cursor + BATCH_SIZE);
        cursor += chunk.length;

        const tmp = document.createElement('div');
        tmp.innerHTML = chunk.map(renderFn).join('');
        while (tmp.firstChild) listEl.insertBefore(tmp.firstChild, sentinel);

        if (cursor >= items.length) {
            sentinel.remove();
            if (batchObserver) {
                batchObserver.disconnect();
                batchObserver = null;
            }
        }
    };

    batchObserver = new IntersectionObserver((entries) => {
        for (const e of entries) {
            if (e.isIntersecting) renderNext();
        }
    }, { root: null, rootMargin: '200px' });
    batchObserver.observe(sentinel);
}

function applyFilters() {
    const results = getFilteredSkills();
    const countEl = document.getElementById('skillSearchCount');
    const listEl = document.getElementById('skillSearchResults');
    if (!listEl) return;

    // Reset the batch observer on every filter change so stale chunks don't append
    // to the new result set.
    if (batchObserver) {
        batchObserver.disconnect();
        batchObserver = null;
    }

    if (results.length === 0) {
        if (countEl) countEl.textContent = '결과 0개';
        listEl.className = 'skill-search-results';

        const activeTagsFlat = [];
        for (const g of ['stat', 'weapon', 'effect', 'trigger']) {
            for (const t of filters[g]) activeTagsFlat.push(`#${t}`);
        }
        const metaParts = [];
        if (!filters.rarity.has('all')) {
            metaParts.push(`등급: ${[...filters.rarity].join(', ')}`);
        }
        if (filters.shipType !== 'all') {
            const info = state.shipTypeData[filters.shipType];
            metaParts.push(`함종: ${info ? info.type_name : filters.shipType}`);
        }
        const queryLine = filters.query ? `검색어: <strong>${escapeHtml(filters.query)}</strong>` : '';
        const tagsLine = activeTagsFlat.length ? `활성 필터: ${escapeHtml(activeTagsFlat.join(' '))}` : '';
        const metaLine = metaParts.length ? escapeHtml(metaParts.join(' · ')) : '';
        const hint = [queryLine, tagsLine, metaLine].filter(Boolean).join('<br>');

        const status = renderStatus(listEl, '검색 결과 없음', 'empty', { compact: true });
        if (status) {
            if (hint) {
                const hintEl = document.createElement('div');
                hintEl.className = 'skill-search-empty-hint';
                hintEl.innerHTML = hint;
                status.appendChild(hintEl);
            }
            const tip = document.createElement('div');
            tip.className = 'skill-search-empty-hint';
            tip.textContent = '필터를 일부 해제하거나 검색어를 바꿔보세요.';
            status.appendChild(tip);
        }
        return;
    }

    if (filters.view === 'skill') {
        if (countEl) countEl.textContent = `결과 ${results.length}개 (스킬)`;
        listEl.className = 'skill-search-results';
        renderBatchedResults(results, listEl, renderSkillCard);
    } else {
        const ships = projectToShips(results);
        if (countEl) countEl.textContent = `결과 ${ships.length}개 (함순이)`;
        listEl.className = 'skill-search-results skill-search-results-ship card-grid';
        renderBatchedResults(ships, listEl, renderShipCard);
    }
}
