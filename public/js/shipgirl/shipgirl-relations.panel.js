/**
 * shipgirl-relations.panel.js
 * Markup for the 함순이 관계도 selection panel: one row per visible link with
 * its evidence (⚓ fleet line with the exact trigger, 💬 mention with the matched
 * name marked, 📖 story links), then class sisters with no other link.
 * Pure string building (every data value escaped) so it is node-tested.
 */
import { escapeHtml, dataForToyUrl, IMG_FALLBACKS } from '../utils.js';
import { SOURCES, SOURCE_COLOR, SOURCE_LABEL, fleetTrigger } from './shipgirl-relations.model.js';

const STORY_VIEWER = { m: 'story-viewer/main-story/', e: 'story-viewer/event-story/', w: 'story-viewer/world-story/' };

/** Site-relative story viewer deep link (same format as story-search). */
export function storyPath(src, eventId, storyId) {
    return `${STORY_VIEWER[src]}?eventid=${eventId}&story=${storyId}`;
}

const iconUrl = (gid) => dataForToyUrl(`skin_icon/${gid * 10}.webp`);
const play = (audio) => (audio
    ? `<button type="button" class="relmap-play" data-audio="${escapeHtml(audio)}" aria-label="대사 재생">▶</button>`
    : '');
const swatch = (key, title) => `<span class="relmap-swatch" style="background:${SOURCE_COLOR[key]}" title="${escapeHtml(title)}"></span>`;
// Escape first, then wrap each escaped occurrence of the matched name or alias.
const markMatch = (text, matched) => escapeHtml(text).split(escapeHtml(matched)).join(`<mark>${escapeHtml(matched)}</mark>`);

function evidenceHtml(ev, model, on, href) {
    const name = (i) => escapeHtml(model.nodes[i].name);
    const [fleet, mention, storyCount, stories] = ev;
    let html = '';
    if (on.fleet) {
        for (const [speaker, text, audio, partners, need] of fleet) {
            // A fleet line plays because of who is in the fleet; its text rarely names them.
            const trigger = fleetTrigger(partners.map((i) => model.nodes[i].name), need);
            html += `<div class="relmap-quote">⚓ <b>${name(speaker)}</b> — ${escapeHtml(trigger)} 출격하면:<br>“${escapeHtml(text)}”${play(audio)}</div>`;
        }
    }
    if (on.mention) {
        for (const [speaker, text, audio, matched] of mention) {
            html += `<div class="relmap-quote">💬 <b>${name(speaker)}</b>의 대사:<br>“${markMatch(text, matched)}”${play(audio)}</div>`;
        }
    }
    if (on.story && stories.length) {
        const titles = stories.map(([src, eventId, storyId, title, eventName]) => (
            `<a href="${escapeHtml(href(storyPath(src, eventId, storyId)))}" title="${escapeHtml(eventName)}">${escapeHtml(title)}</a>`
        )).join(', ');
        const rest = storyCount - stories.length;
        html += `<div class="relmap-quote">📖 ${titles}${rest > 0 ? ` 외 ${rest}편` : ''}</div>`;
    }
    return html;
}

function countsLine(link, ev) {
    const parts = [
        link.f ? `함대 특수대사 ${link.f}` : '',
        link.m ? `언급 ${link.m}` : '',
        link.sw ? `스토리${ev ? ` ${ev[2]}편` : ''}` : '',
        link.j ? `JUUS ${link.j}` : '',
    ].filter(Boolean);
    return parts.length ? `<div class="relmap-quote">${parts.join(' · ')}</div>` : '';
}

function row(o, body, badges, score) {
    return `<div class="relmap-row" data-i="${o.i}" tabindex="0">`
        + `<img src="${escapeHtml(iconUrl(o.gid))}" alt="" data-fallback="${escapeHtml(IMG_FALLBACKS.DEFAULT)}" loading="lazy">`
        + `<div class="relmap-row-body"><div class="relmap-row-name">${escapeHtml(o.name)} ${badges}`
        + `${score != null ? `<span class="relmap-row-score">${score.toFixed(1)}</span>` : ''}</div>${body}</div></div>`;
}

/**
 * Panel markup for the selected node. `links` are her visible links, strongest
 * first; `evidence` is relmap_evidence.json or null while `evidenceState` is
 * 'idle' | 'loading' | 'error'. `href` resolves a site-relative path.
 */
export function panelHtml({ node, model, links, evidence, evidenceState, on, showClasses, href }) {
    const nation = model.nations.find((n) => n.nat === node.nat)?.name ?? '';
    const classText = node.classes.map((ci) => `${model.classes[ci].kr} ${model.classes[ci].members.length}명`);
    const info = [nation, ...classText, `연결 ${links.length}명`].filter(Boolean).map(escapeHtml).join(' · ');
    const dbHref = href(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(node.name)}&gid=${node.gid}`);
    let html = `<div class="relmap-head"><img src="${escapeHtml(iconUrl(node.gid))}" alt="" data-fallback="${escapeHtml(IMG_FALLBACKS.DEFAULT)}">`
        + `<div><h2><a href="${escapeHtml(dbHref)}" title="함순이 DB에서 보기">${escapeHtml(node.name)}</a></h2>`
        + `<span class="relmap-hint">${info}</span></div>`
        + '<button type="button" class="relmap-close" aria-label="선택 해제">×</button></div>';

    if (evidenceState === 'loading') html += '<p class="relmap-hint">대사 불러오는 중…</p>';
    if (evidenceState === 'error') html += '<p class="relmap-hint">대사를 불러오지 못했습니다. 연결 수만 표시합니다.</p>';
    if (!links.length) html += '<p class="relmap-hint">연결 없음</p>';

    const linked = new Set();
    for (const l of links) {
        const o = model.nodes[l.a === node.i ? l.b : l.a];
        linked.add(o.i);
        const ev = evidence?.links[l.i] ?? null;
        const counts = { fleet: l.f, mention: l.m, story: l.sw, juus: l.j };
        const badges = SOURCES.filter((k) => counts[k] > 0 && on[k]).map((k) => swatch(k, SOURCE_LABEL[k])).join('')
            + (showClasses && node.mates.has(o.i) ? swatch('class', '같은 함급') : '');
        html += row(o, (ev ? evidenceHtml(ev, model, on, href) : '') + countsLine(l, ev), badges, l.s);
    }

    if (showClasses) {
        const rest = [...node.mates].filter((i) => !linked.has(i));
        if (rest.length) {
            html += `<p class="relmap-hint relmap-section">⛓ 같은 함급 (다른 연결 없음) ${rest.length}명</p>`
                + rest.map((i) => row(model.nodes[i], '', swatch('class', '같은 함급'), null)).join('');
        }
    }
    return html;
}
