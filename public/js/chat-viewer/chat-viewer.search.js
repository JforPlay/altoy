/**
 * chat-viewer.search.js
 * Builds the sidebar search results: a 함순이 section (each match with her 1:1 chat
 * and every other story she speaks in) and a 대사 section (line hits with a
 * highlighted snippet). Stateless — chat-viewer.engine.js runs the queries and
 * reads the data-open / data-chat / data-story / data-gid / data-index attributes
 * on click.
 */
import { renderStatus } from '../utils.js';
import { el, button, avatarNode, handleNode, appendHighlighted } from './chat-viewer.render.js';

/** More matches than this asks for a longer query instead of a wall of rows. */
const SPEAKER_LIMIT = 20;

function sectionHead(title, count) {
    const head = el('p', 'chat-results-head');
    head.append(el('span', '', title), el('span', '', String(count)));
    return head;
}

/** A result row: `open` says what clicking it does; the rest rides data-* attributes. */
function resultRow(data, label, count) {
    const row = button('chat-hit-row');
    Object.assign(row.dataset, data);
    row.append(el('span', 'chat-hit-label', label));
    if (count) row.append(el('span', 'chat-hit-count', count));
    return row;
}

function speakerGroup(speaker, ctx) {
    const group = el('div', 'chat-hit-speaker');
    const head = el('div', 'chat-hit-speaker-head');
    head.append(avatarNode(speaker.icon, speaker.name), el('b', '', speaker.name));
    if (speaker.handle) head.append(handleNode(speaker.handle));
    group.append(head);
    if (speaker.ownChat) {
        const chat = ctx.chats.get(speaker.ownChat);
        group.append(resultRow({ open: 'chat', chat: speaker.ownChat }, '1:1 대화', `${chat?.storyCount ?? 0}화`));
    }
    for (const a of speaker.appearances) {
        group.append(resultRow(
            { open: 'speaker', chat: a.chatKey, story: a.storyId, gid: String(speaker.gid), name: speaker.name },
            `${a.chatKey} · ${ctx.storyName(a.chatKey, a.storyId)}`,
            `채팅 ${a.count}`,
        ));
    }
    return group;
}

function lineHitRow(hit, ctx) {
    const row = button('chat-hit-row');
    Object.assign(row.dataset, { open: 'line', chat: hit.chatKey, story: hit.storyId, index: String(hit.index) });
    const chat = ctx.chats.get(hit.chatKey);
    const body = el('span', 'chat-hit-body');
    const snippet = el('span', 'chat-hit-snippet');
    appendHighlighted(snippet, hit.text, ctx.query);
    body.append(el('span', 'chat-hit-where', `${chat?.name ?? hit.chatKey} · ${ctx.storyName(hit.chatKey, hit.storyId)}`), snippet);
    row.append(avatarNode(chat?.icon, chat?.name, 'chat-avatar chat-avatar--sm'), body);
    return row;
}

/**
 * Fill `container` with results for one query.
 * @param {HTMLElement} container
 * @param {{ query: string, speakers: Array, lines: {total: number, hits: Array},
 *           chats: Map<string, {name, icon, storyCount}>,
 *           storyName: (chatKey: string, storyId: string) => string }} ctx
 */
export function renderSearchResults(container, ctx) {
    const { query, speakers, lines } = ctx;
    if (!speakers.length && !lines.total) {
        renderStatus(container, `'${query}' 검색 결과가 없습니다.`, 'empty', { compact: true });
        return;
    }
    const frag = document.createDocumentFragment();
    if (speakers.length) {
        frag.append(sectionHead('함순이', speakers.length));
        for (const speaker of speakers.slice(0, SPEAKER_LIMIT)) frag.append(speakerGroup(speaker, ctx));
        if (speakers.length > SPEAKER_LIMIT) {
            frag.append(el('p', 'chat-results-note', `${speakers.length - SPEAKER_LIMIT}명 더 있어요 — 검색어를 더 입력하세요`));
        }
    }
    if (lines.total) {
        frag.append(sectionHead('대사', lines.total));
        for (const hit of lines.hits) frag.append(lineHitRow(hit, ctx));
        const rest = lines.total - lines.hits.length;
        if (rest > 0) {
            const more = button('btn btn-outline btn-sm chat-results-more', `더 보기 (${rest}건 남음)`);
            more.dataset.open = 'more';
            frag.append(more);
        }
    }
    container.replaceChildren(frag);
}
