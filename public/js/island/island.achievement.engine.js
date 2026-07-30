/**
 * island.achievement.engine.js
 * Achievement sub-engine for the island module. Renders the 4 achievement
 * categories as sections of series rows, each row laying out its 6 stages with
 * threshold and reward. Filter chips show/hide whole category sections.
 * Loaded lazily by island.engine.js via its ES exports.
 *
 * Reference viewer only — there is no player progress to track, so the module
 * holds no user state and writes nothing to storage.
 *
 * achievements.json arrives fully pre-resolved by the WSL processor: reward
 * name/icon/rarity are already joined, and the game's $2 placeholder is already
 * substituted (series `desc` carries the slot marker N, each stage carries its
 * own finished `text`). Nothing here looks anything up.
 */

import { fetchJSON, loadPageData, escapeHtml, dataForToyUrl } from '../utils.js';

'use strict';

// ===== Constants =====

const ACHIEVEMENT_ICONS = 'island/islandachievement';
const ALL_GROUPS = 'all';

// ===== State =====

const state = {
    groups: [],
    series: [],
    activeGroup: ALL_GROUPS
};

// ===== Initialization =====

/**
 * Load the feed and render the tab. Does not resolve until the first render is
 * done — island.engine.js loadModule treats a resolved init as "ready to read".
 */
async function init() {
    const container = document.getElementById('achievement-list');

    const data = await loadPageData(
        () => fetchJSON('data/island/achievements.json'),
        container,
        {
            loadingMessage: '업적 데이터를 불러오는 중...',
            errorMessage: '업적 데이터를 불러오지 못했습니다.',
            contextLabel: '[Achievement Module]'
        }
    );
    if (!data) return;

    state.groups = data.groups || [];
    state.series = data.series || [];

    renderFilter();
    renderGroups();
    setupEventListeners();
}

// ===== Event Listeners =====

function setupEventListeners() {
    // Delegated: the chips are re-rendered wholesale, so per-chip listeners
    // would have to be rebound each time.
    document.getElementById('achievement-filter')?.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (chip) setGroupFilter(chip.dataset.group);
    });
}

/**
 * Show one category's section, or all of them. Toggles `hidden` rather than
 * re-rendering — the whole list is static markup built once.
 */
function setGroupFilter(group) {
    state.activeGroup = group || ALL_GROUPS;

    document.querySelectorAll('#achievement-filter .chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.group === state.activeGroup);
    });

    document.querySelectorAll('#achievement-list .achv-group').forEach(section => {
        section.hidden = state.activeGroup !== ALL_GROUPS
            && section.dataset.group !== state.activeGroup;
    });
}

// ===== Rendering =====

/** data_for_toy URL for a category emblem / stage medal sprite. */
function achievementIconUrl(name) {
    return dataForToyUrl(`${ACHIEVEMENT_ICONS}/${name}.webp`);
}

function renderFilter() {
    const container = document.getElementById('achievement-filter');
    if (!container) return;

    const groupChips = state.groups.map(group => `
        <button class="chip chip--icon" type="button" data-group="${escapeHtml(group.id)}">
            <img src="${achievementIconUrl(group.icon)}" alt="" loading="lazy">
            <span>${escapeHtml(group.name)}</span>
            <span class="achv-chip-count">${group.series.length}</span>
        </button>
    `);

    container.innerHTML = `
        <button class="chip active" type="button" data-group="${ALL_GROUPS}">
            <span>전체</span>
            <span class="achv-chip-count">${state.series.length}</span>
        </button>
        ${groupChips.join('')}
    `;
}

function renderGroups() {
    const container = document.getElementById('achievement-list');
    if (!container) return;

    const byGroup = new Map(state.groups.map(group => [group.id, []]));
    state.series.forEach(series => byGroup.get(series.group)?.push(series));

    container.innerHTML = state.groups
        .map(group => renderGroup(group, byGroup.get(group.id) || []))
        .join('');
}

function renderGroup(group, series) {
    return `
        <section class="achv-group" data-group="${escapeHtml(group.id)}">
            <h2 class="achv-group-head">
                <img class="achv-group-emblem" src="${achievementIconUrl(group.icon)}" alt="" loading="lazy">
                <span class="achv-group-name">${escapeHtml(group.name)}</span>
                <span class="badge badge--count">${series.length}</span>
            </h2>
            <div class="achv-series-list">${series.map(renderSeries).join('')}</div>
        </section>
    `;
}

/**
 * Wrong text struck through, real text after an arrow. Falls back to plain
 * text for the 27 series KR ships correctly.
 */
function renderCorrectable(shipped, corrected) {
    const text = escapeHtml(shipped);
    if (!corrected) return text;
    return `<s class="achv-wrong">${text}</s>`
        + `<span class="achv-arrow" aria-hidden="true">→</span>`
        + `<span class="achv-right">${escapeHtml(corrected)}</span>`;
}

function renderSeries(series) {
    // The KR client ships series 2/3/4 with rotated name/desc text — see the
    // design doc §2. Both the as-shipped and the real string are rendered so the
    // page still matches the client while saying what the condition really is.
    const fix = series.correction;
    const note = series.note
        ? `<span class="badge badge--warning achv-note" title="${escapeHtml(series.note)}">표기 오류</span>`
        : '';

    return `
        <article class="achv-series">
            <header class="achv-series-head">
                <h3 class="achv-series-name">${renderCorrectable(series.name, fix?.name)}</h3>
                ${note}
                <p class="achv-series-desc">${renderCorrectable(series.desc, fix?.desc)}</p>
            </header>
            <ol class="achv-stages">${series.stages.map(renderStage).join('')}</ol>
        </article>
    `;
}

function renderStage(stage) {
    const award = stage.award;
    const count = award.count > 1
        ? `<span class="achv-award-count">×${escapeHtml(award.count.toLocaleString())}</span>`
        : '';
    const title = stage.correct_text
        ? `${stage.text} → ${stage.correct_text}`
        : stage.text;

    return `
        <li class="achv-stage" title="${escapeHtml(title)}">
            <img class="achv-stage-medal" src="${achievementIconUrl(`achv_stage_${stage.stage}`)}"
                 alt="${escapeHtml(stage.stage)}단계" loading="lazy">
            <span class="achv-stage-num">${escapeHtml(stage.num.toLocaleString())}</span>
            <div class="achv-award" data-rarity="${escapeHtml(award.rarity)}">
                <img class="achv-award-icon" src="${dataForToyUrl(`${award.icon}.webp`)}" alt="" loading="lazy">
                <span class="achv-award-name">${escapeHtml(award.name)}</span>
                ${count}
            </div>
        </li>
    `;
}

// ===== Public API =====
// No window.* global — island.engine.js loadModule reads init off the ES
// module namespace when a TAB_MODULE_MAP entry has no `module` getter.

export { init };
