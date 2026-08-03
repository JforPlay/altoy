/**
 * boss.detail.js
 * Detail drawer for /map/boss-viewer: portrait, identity badges, and one row per
 * appearance with its stats and a link into the map viewer.
 *
 * Uses the shared .drawer / .drawer-backdrop primitive — toggling `.open` and
 * `.visible` is that component's documented contract.
 */
import { escapeHtml, resolveUrl } from '../utils.js';
import { getIdentity } from './boss.data.js';
import {
    bossPortraitUrl, bossPortraitFallbackAttr, appearanceArmor, groupAppearances,
    isStatsUsable, ARMOR_LABELS, SRC_LABELS, TYPE_LABELS,
} from '../boss-format.js';

let state;
let els = {};
let onEscape = null;

export function setup(stateRef, elements) {
    state = stateRef;
    els = elements;
}

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('ko-KR') : '—');

/** Chapter-family rows deep-link into map-viewer, which reads ?map= and ?tab=. */
function mapLink(app) {
    if (!Number.isInteger(app.cid)) return '';
    const href = resolveUrl(`map/map-viewer/?map=${app.cid}&tab=${encodeURIComponent(app.src)}`);
    return `<a class="btn btn-sm btn-outline boss-row-link" href="${escapeHtml(href)}">해역 보기</a>`;
}

const STAT_FIELDS = [
    ['hp', 'HP'], ['fp', '화력'], ['trp', '뇌장'], ['air', '항공'],
    ['aa', '대공'], ['eva', '회피'], ['luck', '운'], ['acc', '명중'],
];

function statCells(app) {
    if (!isStatsUsable(app)) {
        // Operation Siren stats are world_enhancement-scaled at runtime; the raw
        // config numbers are wrong by orders of magnitude, so show none of them.
        return `<div class="boss-row-scaled" title="대세계 보스는 인게임에서 해역 위협도에 따라 스탯이 보정됩니다. 원본 수치는 실제 값과 크게 달라 표시하지 않습니다.">게임 내 보정 적용</div>`;
    }
    return `<dl class="boss-row-stats">${STAT_FIELDS.map(([key, label]) =>
        `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(fmt(app[key]))}</dd></div>`
    ).join('')}</dl>`;
}

function appearanceRow(app, identity) {
    const armor = appearanceArmor(app, identity);
    const where = app.ev ? `${app.ev} · ${app.where}` : app.where;
    // META tiers carry no level, so the chip is omitted rather than showing "Lv.—".
    const lv = app.lv ? `<span class="boss-row-lv">Lv.${app.lv}</span>` : '';
    return `<li class="boss-row">
        <div class="boss-row-head">
            <span class="boss-row-where">${escapeHtml(where)}</span>
            ${lv}
            <span class="badge badge--neutral">${escapeHtml(ARMOR_LABELS[armor] || '')}</span>
            ${mapLink(app)}
        </div>
        ${statCells(app)}
    </li>`;
}

/** One heading + row list per source, replacing a per-row source badge. */
function appearanceGroup(group, identity) {
    return `<section class="boss-group">
        <h3 class="section-title section-title--sm boss-group-title">
            ${escapeHtml(SRC_LABELS[group.src] || group.src)}
            <span class="badge badge--count">${group.rows.length}</span>
        </h3>
        <ul class="boss-row-list">
            ${group.rows.map((a) => appearanceRow(a, identity)).join('')}
        </ul>
    </section>`;
}

export function openBossDetail(icon) {
    const identity = getIdentity(icon);
    if (!identity) return;
    state.selected = icon;

    els.detailTitle.textContent = identity.name;
    els.detailContent.innerHTML = `
        <div class="boss-detail-summary">
            <img class="boss-detail-portrait" src="${escapeHtml(bossPortraitUrl(identity))}"
                 alt="" loading="lazy"${bossPortraitFallbackAttr(identity, escapeHtml)} data-onfail="hide">
            <div class="boss-detail-meta">
                <span class="badge badge--neutral">${escapeHtml(TYPE_LABELS[identity.type] || '알 수 없음')}</span>
                <span class="badge badge--neutral">${escapeHtml(ARMOR_LABELS[identity.armor] || '')}</span>
                <span class="boss-detail-count">출현 ${identity.app.length}곳</span>
            </div>
        </div>
        ${groupAppearances(identity.app).map((g) => appearanceGroup(g, identity)).join('')}`;

    els.detailPanel.classList.add('open');
    els.detailPanel.setAttribute('aria-hidden', 'false');
    els.detailBackdrop.classList.add('visible');

    // Registered only while open so the page carries no idle global listener.
    onEscape = (e) => { if (e.key === 'Escape') closeBossDetail(); };
    document.addEventListener('keydown', onEscape);
}

export function closeBossDetail() {
    state.selected = null;
    els.detailPanel.classList.remove('open');
    els.detailPanel.setAttribute('aria-hidden', 'true');
    els.detailBackdrop.classList.remove('visible');
    if (onEscape) {
        document.removeEventListener('keydown', onEscape);
        onEscape = null;
    }
}
