/**
 * cn-preview.js
 * CN 선행 컨텐츠 — renders data/preview/cn_preview.json: the ships and skins
 * the CN server has and KR does not yet. Text is Chinese by design (nothing
 * Korean exists for unreleased content); labels around it are Korean.
 *
 * Two views behind one toggle. The ship view is a card grid; the skin view is
 * a picker strip over a detail panel that reuses the skin detail viewer's own
 * gallery (skin.expression.js: expression selector, seam-free composite,
 * lightbox) and audio controller (skin.audio.js), so it looks and behaves like
 * /skin/skin-detail-viewer. Lives under skin/ for that reason — the route stays
 * /shipgirl/cn-preview.
 */

import {
    requireElements, loadPageData, fetchJSONWithCache, fetchJSON, resolveUrl,
    escapeHtml, createImg, IMG_FALLBACKS, renderStatus, showElement, hideElement, createIcon
} from '../utils.js';
import { ensureExpressionManifest } from '../expression-manifest.js';
import { init as initSkinAudio, stopCurrentAudio, handlePlayClick, createVolumeControlElement, attachVolumeListeners } from './skin.audio.js';
import { init as initSkinExpression, setManifest, renderImageGallery } from './skin.expression.js';

const EMPTY_TEXT = '현재 KR과 CN 컨텐츠 차이가 없습니다';

/** Preview image keys → the Korean keys skin.expression.js renderImageGallery reads. */
const VIEWER_IMAGE_KEYS = {
    painting: '전체 일러',
    painting_n: '확대 일러',
    shipyard: '깔끔한 일러',
    chibi: 'sd 일러',
    icon: '아이콘 일러',
    qicon: '쥬스타 아이콘 일러',
};

const els = {};
const state = { doc: null, maps: null, skinsById: new Map(), view: null, selectedSkinId: null, manifestReady: null };

document.addEventListener('DOMContentLoaded', init);

async function init() {
    Object.assign(els, {
        page: document.getElementById('cn-preview-page'),
        meta: document.getElementById('cn-preview-meta'),
        status: document.getElementById('cn-preview-status'),
        viewToggle: document.getElementById('cn-preview-view-toggle'),
        ships: document.getElementById('cn-preview-ships'),
        shipGrid: document.getElementById('cn-preview-ship-grid'),
        skins: document.getElementById('cn-preview-skins'),
        skinPicker: document.getElementById('cn-preview-skin-picker'),
        skinDetail: document.getElementById('cn-preview-skin-detail'),
        skinTitle: document.getElementById('cn-preview-skin-title'),
        skinInfo: document.getElementById('cn-preview-skin-info'),
        skinDesc: document.getElementById('cn-preview-skin-desc'),
        imageGallery: document.getElementById('image-gallery'),
        skinVoices: document.getElementById('cn-preview-skin-voices'),
    });
    if (!requireElements(els, 'CN preview')) return;

    const data = await loadPageData(loadAll, els.status, {
        loadingMessage: 'CN 선행 컨텐츠를 불러오는 중...',
        errorMessage: 'CN 선행 컨텐츠를 불러오지 못했습니다.',
        contextLabel: 'CN preview',
    });
    if (data === null) return;

    state.doc = data.doc;
    state.maps = data.maps;
    state.skinsById = new Map(data.doc.skins.map((skin) => [String(skin.id), skin]));
    els.meta.textContent = `CN ${data.doc.cn_version ?? '?'} · KR ${data.doc.kr_version ?? '?'} · 갱신 ${data.doc.built ?? '?'}`;

    if (data.doc.ships.length === 0 && data.doc.skins.length === 0) {
        renderStatus(els.status, EMPTY_TEXT, 'empty');
        return;
    }
    els.status.replaceChildren();

    initSkinExpression();
    initSkinAudio();

    els.shipGrid.innerHTML = data.doc.ships.map((ship) => renderShipCard(ship, data.maps)).join('');
    els.skinPicker.innerHTML = data.doc.skins.map(renderSkinTile).join('');
    for (const button of els.viewToggle.querySelectorAll('[data-view]')) {
        const count = button.dataset.view === 'ships' ? data.doc.ships.length : data.doc.skins.length;
        button.textContent = `${button.textContent} ${count}`;
        button.disabled = count === 0;
    }
    showElement(els.viewToggle);

    els.viewToggle.addEventListener('click', (event) => {
        const button = event.target.closest('[data-view]');
        if (button && !button.disabled) setView(button.dataset.view);
    });
    els.shipGrid.addEventListener('click', (event) => {
        const button = event.target.closest('[data-skin-id]');
        if (!button) return;
        setView('skins');
        selectSkin(button.dataset.skinId, { scroll: true });
    });
    els.skinPicker.addEventListener('click', (event) => {
        const tile = event.target.closest('[data-skin-id]');
        if (tile) selectSkin(tile.dataset.skinId, { scroll: true });
    });
    els.skinVoices.addEventListener('click', handlePlayClick);

    setView(data.doc.ships.length ? 'ships' : 'skins');
}

/** Loader for loadPageData: throws on any failure. The two skill-icon maps are optional. */
async function loadAll() {
    const [doc, nationality, shipType, attrType, equipType] = await Promise.all([
        fetchJSONWithCache(resolveUrl('data/preview/cn_preview.json')),
        fetchJSON('data/mapping/nationality_mapping.json'),
        fetchJSON('data/mapping/ship_type_mapping.json'),
        fetchJSON('data/mapping/attr_type_mapping.json'),
        fetchJSON('data/mapping/equip_data_by_type.json'),
    ]);
    if (!doc || !Array.isArray(doc.ships) || !Array.isArray(doc.skins)) {
        throw new Error('Invalid cn_preview payload');
    }
    let skillToIconId = {};
    let skillIcons = {};
    try {
        [skillToIconId, skillIcons] = await Promise.all([
            fetchJSON('data/skill_to_icon_id.json'),
            fetchJSON('data/skill_icon_mapping.json'),
        ]);
    } catch (error) {
        console.warn('CN preview: skill icon maps unavailable — icons hidden', error);
    }
    return { doc, maps: { nationality, shipType, attrType, equipType, skillToIconId, skillIcons } };
}

// ===== Views =====

function setView(view) {
    if (state.view === view) return;
    state.view = view;
    els.page.dataset.view = view;
    for (const button of els.viewToggle.querySelectorAll('[data-view]')) {
        const active = button.dataset.view === view;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
    }
    if (view === 'ships') {
        stopCurrentAudio();
        hideElement(els.skins);
        showElement(els.ships);
        return;
    }
    hideElement(els.ships);
    showElement(els.skins);
    if (!state.selectedSkinId && state.doc.skins.length) selectSkin(String(state.doc.skins[0].id));
}

// ===== Ship cards =====

function renderShipCard(ship, maps) {
    const nation = maps.nationality?.[String(ship.nationality)]?.name ?? '';
    const type = maps.shipType?.[String(ship.type)]?.type_name ?? '';
    const art = ship.images.shipyard || ship.images.qicon || '';
    const top = ship.tiers[ship.tiers.length - 1];
    const skinId = (ship.skin_ids ?? []).map(String).find((id) => state.skinsById.has(id));
    return `
    <article class="cn-card card-hover">
        <div class="cn-card-art">${createImg(art, ship.name, { className: 'cn-card-img', fallback: IMG_FALLBACKS.CARD })}</div>
        <div class="cn-card-body">
            <h3 class="cn-card-title" lang="zh">${escapeHtml(ship.name)}</h3>
            <p class="cn-card-sub">${escapeHtml(ship.english_name)}</p>
            <div class="cn-card-badges">
                <span class="rarity-badge rarity-${escapeHtml(ship.rarity)}">${escapeHtml(ship.rarity)}</span>
                ${nation ? `<span class="badge badge--neutral">${escapeHtml(nation)}</span>` : ''}
                ${type ? `<span class="badge badge--neutral">${escapeHtml(type)}</span>` : ''}
                ${ship.first_seen ? `<span class="badge badge--info">CN ${escapeHtml(ship.first_seen)}</span>` : ''}
            </div>
            ${renderStats(top, maps.attrType)}
            ${renderSkills(ship.skills, maps)}
            <p class="cn-card-meta">${ship.equip_types.map((t, i) => `${i + 1}번 슬롯 ${escapeHtml(equipSlotLabel(t, maps.equipType))}`).join(' · ')}</p>
            ${skinId ? `<button type="button" class="btn btn-secondary btn-sm cn-card-skin-btn" data-skin-id="${skinId}">스킨 / 대사 보기</button>` : ''}
        </div>
    </article>`;
}

function renderStats(tier, attrType) {
    if (!tier?.attrs) return '';
    const cells = tier.attrs.map((value, i) => {
        const label = attrType?.[String(i + 1)]?.condition ?? String(i + 1);
        return `<div class="cn-stat"><span class="cn-stat-label">${escapeHtml(label)}</span><span class="cn-stat-value">${escapeHtml(String(value))}</span></div>`;
    });
    return `<div class="cn-stats" title="Lv1 기준">${cells.join('')}</div>`;
}

function renderSkills(skills, maps) {
    if (!skills.length) return '';
    return `<ul class="cn-skills">${skills.map((skill) => {
        const icon = skillIconUrl(skill.id, maps);
        return `<li class="cn-skill">
            ${icon ? createImg(icon, '', { className: 'cn-skill-icon', fallback: IMG_FALLBACKS.DEFAULT }) : ''}
            <div><strong lang="zh">${escapeHtml(skill.name)}</strong><p lang="zh">${escapeHtml(skill.desc)}</p></div>
        </li>`;
    }).join('')}</ul>`;
}

/** Same chain as shipgirl-info getSkillIconUrl: map → direct id → family base; null when nothing exists. */
function skillIconUrl(skillId, maps) {
    const id = String(skillId);
    const iconId = maps.skillToIconId?.[id];
    if (iconId !== undefined) return maps.skillIcons?.[String(iconId)] ?? null;
    const baseId = String(Math.floor(Number(skillId) / 10) * 10);
    return maps.skillIcons?.[id] || maps.skillIcons?.[baseId] || null;
}

/** equip_types entries are an id or an id array per slot; name each via equip_data_by_type, id as the fallback. */
function equipSlotLabel(entry, equipType) {
    const ids = Array.isArray(entry) ? entry : [entry];
    return [...new Set(ids.map((id) => equipType?.[String(id)]?.type_name2 ?? String(id ?? '-')))].join('/');
}

// ===== Skin picker + detail =====

function renderSkinTile(skin) {
    const art = skin.images.shipyard || skin.images.qicon || '';
    return `
    <button type="button" class="cn-skin-tile card-hover" data-skin-id="${skin.id}" aria-pressed="false">
        <span class="cn-skin-tile-art">${createImg(art, skin.name, { className: 'cn-card-img', fallback: IMG_FALLBACKS.CARD })}</span>
        <span class="cn-skin-tile-name" lang="zh">${escapeHtml(skin.name)}</span>
        <span class="cn-skin-tile-ship" lang="zh">${escapeHtml(skin.ship_name)}</span>
        ${skin.first_seen ? `<span class="badge badge--info">CN ${escapeHtml(skin.first_seen)}</span>` : ''}
    </button>`;
}

/** The gallery keys off the KR skin record shape; hand it only what the preview record has. */
function toViewerSkin(skin) {
    const out = { '클뜯 id': String(skin.id) };
    for (const [key, viewerKey] of Object.entries(VIEWER_IMAGE_KEYS)) {
        if (skin.images?.[key]) out[viewerKey] = skin.images[key];
    }
    return out;
}

async function selectSkin(skinId, { scroll = false } = {}) {
    const skin = state.skinsById.get(String(skinId));
    if (!skin) return;
    state.selectedSkinId = String(skinId);
    stopCurrentAudio();
    for (const tile of els.skinPicker.querySelectorAll('[data-skin-id]')) {
        const active = tile.dataset.skinId === state.selectedSkinId;
        tile.classList.toggle('is-active', active);
        tile.setAttribute('aria-pressed', String(active));
    }

    // Manifest is loaded on first selection, never at boot (expression-manifest.js contract);
    // a missing manifest degrades to the bare painting inside renderImageGallery.
    if (!state.manifestReady) {
        state.manifestReady = ensureExpressionManifest().then((manifest) => setManifest(manifest || {}));
    }
    await state.manifestReady;
    if (state.selectedSkinId !== String(skinId)) return;   // a later click won

    els.skinTitle.textContent = `${skin.ship_name} — ${skin.name}`;
    renderSkinInfo(skin);
    els.skinDesc.textContent = skin.desc || '';
    if (skin.desc) showElement(els.skinDesc); else hideElement(els.skinDesc);
    renderImageGallery(toViewerSkin(skin), els.imageGallery, skin.name);
    renderVoices(skin);
    showElement(els.skinDetail);
    if (scroll) els.skinDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSkinInfo(skin) {
    const items = [
        ['타입:', skin.type],
        ['태그:', skin.tags.join(', ')],
        ['CN 추가:', skin.first_seen],
        ['판매 기간:', skin.shop_time],
    ].filter(([, value]) => value);
    els.skinInfo.replaceChildren(...items.map(([label, value]) => {
        const item = document.createElement('div');
        item.className = 'info-item';
        const strong = document.createElement('strong');
        strong.className = 'info-label';
        strong.textContent = label;
        const span = document.createElement('span');
        span.className = 'info-value';
        span.textContent = value;
        item.append(strong, span);
        return item;
    }));
    if (items.length) showElement(els.skinInfo); else hideElement(els.skinInfo);
}

/** Same table the skin detail viewer builds (voice-line-table + shared volume control). JP audio only. */
function renderVoices(skin) {
    els.skinVoices.replaceChildren();
    if (!skin.voices.length) { hideElement(els.skinVoices); return; }

    const table = document.createElement('table');
    table.className = 'voice-line-table';
    const header = document.createElement('div');
    header.className = 'table-header-with-volume';
    const title = document.createElement('span');
    title.textContent = `대사 (${skin.voices.length})`;
    header.append(title, createVolumeControlElement());
    const th = document.createElement('th');
    th.colSpan = 2;
    th.appendChild(header);
    const thead = document.createElement('thead');
    thead.appendChild(document.createElement('tr')).appendChild(th);

    const tbody = document.createElement('tbody');
    for (const voice of skin.voices) {
        const row = tbody.insertRow();
        row.insertCell().textContent = voice.label;
        const wrapper = document.createElement('div');
        const text = document.createElement('span');
        text.lang = 'zh';
        text.textContent = voice.text;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-icon play-voice-btn';
        button.setAttribute('aria-label', voice.audio ? '대사 재생' : '대사 음성 없음');
        if (voice.audio) button.dataset.src = voice.audio; else button.disabled = true;
        button.appendChild(createIcon('fas fa-play'));
        wrapper.append(text, button);
        row.insertCell().appendChild(wrapper);
    }
    table.append(thead, tbody);
    els.skinVoices.appendChild(table);
    attachVolumeListeners();
    showElement(els.skinVoices);
}
