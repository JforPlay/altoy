/**
 * chat-viewer.render.js
 * Stateless DOM builders for the chat viewer: avatars, chat-list rows, story tabs,
 * message bubbles, the 전체 대본 choice strip, the 재생 reply buttons and
 * search-highlighted text. No state and no listeners — chat-viewer.engine.js owns both.
 * Data values only ever reach the DOM through textContent / text nodes.
 */
import { createImgElement, dataForToyUrl } from '../utils.js';

const PLACEHOLDER_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23e0e0e0'/%3E%3C/svg%3E";

/** Element with optional class and text — the only way data reaches these nodes. */
export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

export function button(className, text) {
    const node = el('button', className, text);
    node.type = 'button';
    return node;
}

// ===== Shared pieces =====

/** Portrait <img>, or a letter tile when there is no icon. */
export function avatarNode(src, name, className = 'chat-avatar') {
    if (src) return createImgElement(src, name || '', { className, fallback: PLACEHOLDER_ICON });
    const tile = el('span', `${className} chat-avatar--letter`, String(name || '?').trim().charAt(0));
    tile.setAttribute('aria-hidden', 'true');
    return tile;
}

/** `@handle` label shown beside a speaker name. */
export function handleNode(handle) {
    return el('span', 'chat-handle', `@${handle}`);
}

/** Append `text` to `parent`, wrapping each case-insensitive match of `query` in <mark>. */
export function appendHighlighted(parent, text, query) {
    const value = String(text ?? '');
    const q = String(query || '').trim();
    if (!q) {
        parent.append(value);
        return;
    }
    const lower = value.toLowerCase();
    const needle = q.toLowerCase();
    let at = 0;
    for (let hit = lower.indexOf(needle); hit !== -1; hit = lower.indexOf(needle, at)) {
        parent.append(value.slice(at, hit), el('mark', '', value.slice(hit, hit + needle.length)));
        at = hit + needle.length;
    }
    parent.append(value.slice(at));
}

// ===== Sidebar + header =====

/** One chat-list row. `chat` = { key, name, handle, icon, storyCount, preview }. */
export function chatRowNode(chat) {
    const row = button('chat-row');
    row.dataset.chat = chat.key;
    row.setAttribute('aria-pressed', 'false');
    const top = el('span', 'chat-row-top');
    top.append(el('b', 'chat-row-name', chat.name));
    if (chat.handle) top.append(handleNode(chat.handle));
    top.append(el('span', 'chat-row-count', `${chat.storyCount}화`));
    const body = el('span', 'chat-row-body');
    body.append(top, el('span', 'chat-row-preview', chat.preview));
    row.append(avatarNode(chat.icon, chat.name), body);
    return row;
}

/** Story tabs for one chat (`stories` = the chat's { storyId: story } record). */
export function storyTabNodes(stories, activeId) {
    return Object.entries(stories).map(([id, story]) => {
        const tab = button('chat-tab', story.name || `스토리 ${id}`);
        tab.dataset.story = id;
        tab.setAttribute('role', 'tab');
        const on = id === activeId;
        tab.classList.toggle('is-active', on);
        tab.setAttribute('aria-selected', String(on));
        return tab;
    });
}

// ===== Message log =====

/** 해금 조건 line at the top of every story (plus 요구 호감도 for affection unlocks). */
export function unlockNode(story) {
    const p = el('p', 'chat-unlock');
    p.append(el('strong', '', '해금 조건'), ` ${story.unlock_desc || '-'}`);
    if (story.trigger_type === 2 && story.trigger_param) {
        p.append(' · ', el('strong', '', '요구 호감도'), ` ${story.trigger_param}`);
    }
    return p;
}

export function endNode() {
    return el('div', 'chat-end', '대화 종료');
}

/**
 * Node for one visible script line, or null when the line draws nothing (unknown type).
 * @param {Object} line - script line
 * @param {{role: string, gid: number, name: string, handle: string, icon: string|null}} who - speakerOf()
 * @param {{ continued: boolean, query: string }} ctx - continued: same speaker as the line above,
 *   so the name/avatar collapse; query: text to <mark>
 */
export function lineNode(line, who, ctx) {
    switch (line.type) {
        case 1: return bubbleNode(line, who, ctx);
        case 3: return el('div', 'chat-envelope', '세뱃돈을 탭하여 확인');
        case 4: return stickerNode(line, who, ctx);
        case 5: {
            const node = el('div', 'chat-system');
            appendHighlighted(node, line.param, ctx.query);
            return node;
        }
        default: return null;
    }
}

function textNode(line, query) {
    const p = el('p', 'chat-text');
    appendHighlighted(p, line.param, query);
    return p;
}

function bubbleNode(line, who, ctx) {
    if (who.role === 'player') {
        const msg = el('div', 'chat-msg chat-msg--player');
        const bubble = el('div', 'chat-bubble');
        bubble.append(textNode(line, ctx.query));
        msg.append(bubble);
        return msg;
    }
    if (who.role === 'narrator') {
        const msg = el('div', 'chat-msg chat-msg--narrator');
        if (who.name) msg.append(el('p', 'chat-speaker', who.name));
        msg.append(textNode(line, ctx.query));
        return msg;
    }
    const msg = el('div', 'chat-msg chat-msg--character');
    if (ctx.continued) msg.classList.add('is-cont');
    const bubble = el('div', 'chat-bubble');
    if (!ctx.continued) {
        const speaker = el('p', 'chat-speaker', who.name);
        if (who.handle) speaker.append(handleNode(who.handle));
        bubble.append(speaker);
    }
    bubble.append(textNode(line, ctx.query));
    msg.append(avatarNode(who.icon, who.name), bubble);
    return msg;
}

/**
 * A sticker's art (`sticker`, a data_for_toy path the pipeline resolved through
 * emoji_template.pic) or, when it has none, its label — the encrypted video stickers.
 */
function stickerNode(line, who, ctx) {
    const mine = who.role === 'player';
    const msg = el('div', `chat-msg ${mine ? 'chat-msg--player' : 'chat-msg--character'}`);
    if (ctx.continued && !mine) msg.classList.add('is-cont');
    const label = line.label || '이모티콘';
    const missing = () => el('span', 'chat-sticker chat-sticker--missing', label);
    const sticker = line.sticker
        ? createImgElement(dataForToyUrl(line.sticker), label, {
            className: 'chat-sticker',
            onError: () => sticker.replaceWith(missing()),
        })
        : missing();
    if (!mine) msg.append(avatarNode(who.icon, who.name));
    msg.append(sticker);
    return msg;
}

/** 전체 대본 choice strip: every option as a tab, the picked one active. */
export function choiceNode(item) {
    const wrap = el('div', 'chat-choice');
    wrap.dataset.choice = String(item.index);
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', '선택지');
    const tabs = el('div', 'chat-choice-tabs');
    for (const [flag, label] of item.options) {
        const tab = button('chip chat-choice-tab', label);
        tab.dataset.flag = String(flag);
        const on = flag === item.picked;
        tab.classList.toggle('active', on);
        tab.setAttribute('aria-pressed', String(on));
        tabs.append(tab);
    }
    wrap.append(el('span', 'chat-choice-label', '선택지'), tabs);
    return wrap;
}

/** 재생 reply footer content: a label plus one button per option label. */
export function replyNodes(pending) {
    return [
        el('span', 'chat-reply-label', '답장 선택'),
        ...pending.options.map(([flag, label]) => {
            const btn = button('btn btn-outline chat-reply-btn', label);
            btn.dataset.flag = String(flag);
            return btn;
        }),
    ];
}
