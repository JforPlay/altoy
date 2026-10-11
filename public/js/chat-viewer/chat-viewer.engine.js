/**
 * chat-viewer.engine.js
 * Two-pane messenger viewer shared by JUUS 보기 (juus.js) and 3D숙소 JUUS (dorm3d.js):
 * chat list + search on the left, the open chat on the right, in 재생 (timed) or
 * 전체 대본 (whole script) mode. Owns state, listeners and timers; branching and
 * search live in chat-viewer.script.js, DOM builders in chat-viewer.render.js /
 * chat-viewer.search.js.
 */
import {
    fetchJSONWithCache,
    loadPageData,
    requireElements,
    renderStatus,
    showElement,
    hideElement,
    toggleElement,
    debounce,
    getStorageItem,
    setStorageItem,
} from '../utils.js';
import {
    visibleLines,
    picksToReach,
    isGroupChat,
    speakerOf,
    speakerHandle,
    buildSpeakerIndex,
    searchSpeakers,
    searchLines,
    storyHits,
} from './chat-viewer.script.js';
import {
    avatarNode,
    handleNode,
    chatRowNode,
    storyTabNodes,
    unlockNode,
    endNode,
    lineNode,
    choiceNode,
    replyNodes,
} from './chat-viewer.render.js';
import { renderSearchResults } from './chat-viewer.search.js';

const MODE_KEY = 'chatViewerMode';
const LINE_PAGE = 50;           // 대사 hits shown per page of results
const NEAR_BOTTOM_PX = 150;     // 재생 auto-scrolls only when the reader is this close to the end

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class ChatViewerEngine {
    /**
     * Create and immediately start a chat viewer instance.
     * @param {Object} config
     * @param {string} config.dataUrl - chat data JSON ({ chatKey: { storyId: story } })
     * @param {string} [config.shipGroupIdUrl] - @아이디 map ({ ship_group: handle })
     * @param {Object<string, string>} [config.groupChatIcons] - group chat name → icon URL
     * @param {number} [config.defaultDelay=1300] - 재생 delay between lines (ms)
     * @param {number} [config.initialDelay=100] - 재생 delay before the first line / after a pick or sticker (ms)
     * @param {Object} [config.customHandlers] - `handleType4(line)`, called with `this` = engine in 재생
     */
    constructor(config) {
        this.dataUrl = config.dataUrl;
        this.shipGroupIdUrl = config.shipGroupIdUrl || null;
        this.groupChatIcons = config.groupChatIcons || {};
        this.defaultDelay = config.defaultDelay || 1300;
        this.initialDelay = config.initialDelay || 100;
        this.customHandlers = config.customHandlers || {};

        const byId = (id) => document.getElementById(id);
        this.els = {
            app: byId('chat-app'),
            search: byId('chat-search'),
            filter: byId('chat-filter'),
            list: byId('chat-list'),
            results: byId('chat-results'),
            empty: byId('chat-empty'),
            pane: byId('chat-pane'),
            back: byId('chat-back'),
            headAvatar: byId('chat-head-avatar'),
            headName: byId('chat-head-name'),
            headSub: byId('chat-head-sub'),
            mode: byId('chat-mode'),
            restart: byId('chat-restart'),
            tabs: byId('chat-tabs'),
            jump: byId('chat-jump'),
            jumpLabel: byId('chat-jump-label'),
            log: byId('chat-log'),
            reply: byId('chat-reply'),
        };
        if (!requireElements(this.els, 'ChatViewer')) return;

        this.allData = {};
        this.usernames = {};
        this.chats = new Map();   // chatKey → summary (row, header, search results)
        this.rows = new Map();    // chatKey → list row
        this.hasGroups = false;
        this.speakers = null;     // built on the first search
        this.chatKey = null;
        this.storyId = null;
        this.picks = {};          // script index → picked reply flag
        this.focus = null;        // search target: { gid | query, label, hits, at }
        this.mode = getStorageItem(MODE_KEY, 'play') === 'full' ? 'full' : 'play';
        this.lineLimit = LINE_PAGE;
        this.lastQuery = '';
        this.played = 0;          // 재생: visible items already on screen
        this.lastGid = null;      // ship_group of the line above, for name/avatar collapsing
        this.activeTimers = [];

        this.init();
    }

    get story() {
        return this.allData[this.chatKey]?.[this.storyId] ?? null;
    }

    get scripts() {
        const scripts = this.story?.scripts;
        return Array.isArray(scripts) ? scripts : [];
    }

    // ===== Boot =====

    async init() {
        const usernamesPromise = this.shipGroupIdUrl
            ? fetchJSONWithCache(this.shipGroupIdUrl).catch((error) => {
                console.warn('ChatViewer: @아이디 data failed to load:', error);
                return null;
            })
            : Promise.resolve(null);

        const data = await loadPageData(() => fetchJSONWithCache(this.dataUrl), this.els.list, {
            contextLabel: 'ChatViewer',
            loadingMessage: '대화 목록을 불러오는 중...',
            errorMessage: '대화 정보를 불러오지 못했어요.',
        });
        if (data === null) return;
        if (!isRecord(data) || !Object.keys(data).length) {
            renderStatus(this.els.list, '표시할 채팅 데이터가 없습니다.', 'empty');
            return;
        }
        this.allData = data;
        const usernames = await usernamesPromise;
        if (isRecord(usernames)) this.usernames = usernames;

        this.buildChatList();
        this.bindEvents();
        this.syncModeButtons();
    }

    /** One summary per chat — built once, reused by the list, the header and search. */
    summarize(key, stories) {
        const list = Object.values(stories);
        const first = list[0];
        const group = isGroupChat(first);
        const lastScripts = list[list.length - 1].scripts || [];
        const preview = lastScripts.findLast((line) => line.type === 1)?.param ?? '';
        const speakerCount = group
            ? new Set(list.flatMap((s) => (s.scripts || []).map((l) => l.ship_group)).filter((g) => g > 1)).size
            : 0;
        return {
            key,
            group,
            name: first.kr_name || key,
            handle: group ? '' : speakerHandle({ ship_group: first.ship_group }, first, this.usernames),
            icon: first.icon || this.groupChatIcons[first.kr_name] || null,
            storyCount: list.length,
            speakerCount,
            preview: String(preview),
        };
    }

    buildChatList() {
        const frag = document.createDocumentFragment();
        for (const [key, stories] of Object.entries(this.allData)) {
            if (!isRecord(stories) || !Object.keys(stories).length) continue;
            const chat = this.summarize(key, stories);
            const row = chatRowNode(chat);
            this.chats.set(key, chat);
            this.rows.set(key, row);
            this.hasGroups ||= chat.group;
            frag.append(row);
        }
        this.els.list.replaceChildren(frag);
        if (!this.hasGroups) hideElement(this.els.filter); // Dorm3D: nothing to filter
    }

    bindEvents() {
        const { list, filter, search, results, back, mode, restart, tabs, log, reply, jump } = this.els;
        list.addEventListener('click', (event) => {
            const row = event.target.closest('[data-chat]');
            if (row) this.openChat(row.dataset.chat);
        });
        filter.addEventListener('click', (event) => {
            const chip = event.target.closest('[data-kind]');
            if (chip) this.applyKindFilter(chip.dataset.kind);
        });
        search.addEventListener('input', debounce(() => this.runSearch(), 200));
        search.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            search.value = '';
            this.runSearch();
        });
        results.addEventListener('click', (event) => this.handleResultClick(event));
        back.addEventListener('click', () => { this.els.app.dataset.view = 'list'; });
        mode.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-mode]');
            if (btn) this.setMode(btn.dataset.mode);
        });
        restart.addEventListener('click', () => {
            this.picks = {};
            this.focus = null;
            this.renderStory();
        });
        tabs.addEventListener('click', (event) => {
            const tab = event.target.closest('[data-story]');
            if (tab) this.openStory(this.chatKey, tab.dataset.story);
        });
        log.addEventListener('click', (event) => this.handleChoiceTab(event));
        reply.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-flag]');
            if (btn) this.pickReply(Number(btn.dataset.flag));
        });
        jump.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-step]');
            if (btn && this.focus) this.goToHit(this.focus.at + Number(btn.dataset.step));
        });
    }

    // ===== Sidebar =====

    applyKindFilter(kind) {
        for (const chip of this.els.filter.querySelectorAll('[data-kind]')) {
            const on = chip.dataset.kind === kind;
            chip.classList.toggle('active', on);
            chip.setAttribute('aria-pressed', String(on));
        }
        for (const [key, row] of this.rows) {
            const { group } = this.chats.get(key);
            toggleElement(row, kind === 'all' || (kind === 'group') === group);
        }
    }

    selectRow(key) {
        for (const [rowKey, row] of this.rows) {
            const on = rowKey === key;
            row.classList.toggle('is-selected', on);
            row.setAttribute('aria-pressed', String(on));
        }
    }

    // ===== Opening chats and stories =====

    openChat(key) {
        if (key === this.chatKey) { // keep the reader's place (phone: back, then the same row)
            this.els.app.dataset.view = 'chat';
            return;
        }
        const stories = this.allData[key];
        if (isRecord(stories)) this.openStory(key, Object.keys(stories)[0]);
    }

    /**
     * Show one story. `focus` (from search) switches to 전체 대본 — for the rest of the visit,
     * without saving it as the remembered mode — and lands on its first hit.
     */
    openStory(key, storyId, focus = null) {
        if (key !== this.chatKey) {
            this.chatKey = key;
            this.selectRow(key);
            this.renderHeader();
        }
        this.storyId = storyId;
        this.picks = {};
        this.focus = focus;
        this.els.tabs.replaceChildren(...storyTabNodes(this.allData[key], storyId));
        this.els.tabs.querySelector('.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        hideElement(this.els.empty);
        showElement(this.els.pane);
        this.els.app.dataset.view = 'chat';
        if (focus) {
            this.mode = 'full';
            this.syncModeButtons();
            this.goToHit(focus.at);
        } else {
            this.renderStory();
        }
    }

    renderHeader() {
        const chat = this.chats.get(this.chatKey);
        const { headAvatar, headName, headSub } = this.els;
        headAvatar.replaceChildren(avatarNode(chat.icon, chat.name));
        headName.textContent = chat.name;
        headSub.replaceChildren();
        if (chat.group) {
            headSub.append(`그룹 채팅방 · 발언 ${chat.speakerCount}명 · 스토리 ${chat.storyCount}개`);
        } else {
            if (chat.handle) headSub.append(handleNode(chat.handle), ' · ');
            headSub.append(`스토리 ${chat.storyCount}개`);
        }
    }

    // ===== Modes =====

    syncModeButtons() {
        for (const btn of this.els.mode.querySelectorAll('[data-mode]')) {
            const on = btn.dataset.mode === this.mode;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-pressed', String(on));
        }
    }

    /** 재생 → 전체 keeps the picks made so far; 전체 → 재생 starts over from line 1. */
    setMode(mode) {
        if (mode === this.mode) return;
        this.mode = mode;
        setStorageItem(MODE_KEY, mode);
        this.syncModeButtons();
        if (!this.story) return;
        if (mode === 'play') {
            this.picks = {};
            this.focus = null;
        }
        this.renderStory();
    }

    /** Re-render the open story from line 1 in the current mode (picks are kept). */
    renderStory() {
        this.clearTimers();
        this.played = 0;
        this.lastGid = null;
        this.els.log.dataset.mode = this.mode;
        this.els.log.replaceChildren(unlockNode(this.story));
        this.els.log.scrollTop = 0; // callers that need a position (choice tab, search hit) set it after
        this.els.reply.replaceChildren();
        hideElement(this.els.reply);
        this.renderJump();
        if (this.mode === 'full') this.renderFull();
        else this.playNext(this.initialDelay);
    }

    renderFull() {
        const { items } = visibleLines(this.scripts, this.picks, { full: true });
        const frag = document.createDocumentFragment();
        for (const item of items) frag.append(...this.nodesFor(item, false));
        frag.append(endNode());
        this.els.log.append(frag);
    }

    /**
     * Node(s) for one walk item, tracking the same-speaker run that collapses name + avatar.
     * A single-option choice draws no strip: there is nothing to switch to.
     */
    nodesFor(item, playing) {
        if (item.type === 'choice') {
            this.lastGid = null;
            return item.options.length > 1 ? [choiceNode(item)] : [];
        }
        const { line } = item;
        if (line.type === 4 && this.customHandlers.handleType4) {
            if (playing) this.customHandlers.handleType4.call(this, line);
            return [];
        }
        const who = speakerOf(line, this.story, this.usernames);
        const runGid = who.role === 'narrator' ? null : who.gid;
        const node = lineNode(line, who, {
            continued: runGid !== null && runGid === this.lastGid,
            query: this.focus?.query ?? '',
        });
        if (!node) return [];
        node.dataset.index = String(item.index);
        if (this.focus?.gid != null && who.gid === this.focus.gid) node.classList.add('is-hit');
        this.lastGid = line.type === 5 ? null : runGid;
        return [node];
    }

    // ===== 재생 =====

    /** Show the next visible line after `delay`; stop at a choice (reply buttons) or the end. */
    playNext(delay = this.defaultDelay) {
        this.setTrackedTimeout(() => {
            const { items, pending } = visibleLines(this.scripts, this.picks);
            const stick = this.isNearBottom();
            if (this.played < items.length) {
                const item = items[this.played++];
                const nodes = this.nodesFor(item, true);
                this.els.log.append(...nodes);
                if (stick) this.scrollToBottom();
                this.playNext(!nodes.length || item.line.type === 4 ? this.initialDelay : this.defaultDelay);
            } else if (pending) {
                this.els.reply.replaceChildren(...replyNodes(pending));
                showElement(this.els.reply);
                this.scrollToBottom();
            } else {
                this.els.log.append(endNode());
                if (stick) this.scrollToBottom();
            }
        }, delay);
    }

    /** Record a 재생 reply; the data's own 지휘관 line for it plays next. */
    pickReply(flag) {
        const { pending } = visibleLines(this.scripts, this.picks);
        if (!pending) return;
        this.picks[pending.index] = flag;
        this.els.reply.replaceChildren();
        hideElement(this.els.reply);
        this.playNext(this.initialDelay);
    }

    isNearBottom() {
        const { log } = this.els;
        return log.scrollHeight - log.scrollTop - log.clientHeight < NEAR_BOTTOM_PX;
    }

    scrollToBottom() {
        const { log } = this.els;
        log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
    }

    // ===== 전체 대본 =====

    /** Switch one choice's branch in place, keeping that choice where it was on screen. */
    handleChoiceTab(event) {
        const tab = event.target.closest('.chat-choice-tab');
        const strip = tab?.closest('[data-choice]');
        if (!strip || tab.classList.contains('active')) return;
        const index = Number(strip.dataset.choice);
        const before = strip.getBoundingClientRect().top;
        this.picks[index] = Number(tab.dataset.flag);
        this.renderStory();
        const after = this.els.log.querySelector(`[data-choice="${index}"]`);
        if (after) this.els.log.scrollTop += after.getBoundingClientRect().top - before;
    }

    // ===== Search =====

    runSearch() {
        const query = this.els.search.value.trim();
        if (!query) {
            hideElement(this.els.results);
            showElement(this.els.list);
            if (this.hasGroups) showElement(this.els.filter);
            return;
        }
        this.speakers ??= buildSpeakerIndex(this.allData, this.usernames);
        if (query !== this.lastQuery) this.lineLimit = LINE_PAGE;
        this.lastQuery = query;
        renderSearchResults(this.els.results, {
            query,
            speakers: searchSpeakers(this.speakers, query),
            lines: searchLines(this.allData, query, this.lineLimit),
            chats: this.chats,
            storyName: (chatKey, storyId) => this.allData[chatKey]?.[storyId]?.name ?? '',
        });
        hideElement(this.els.list);
        hideElement(this.els.filter);
        showElement(this.els.results);
    }

    handleResultClick(event) {
        const btn = event.target.closest('[data-open]');
        if (!btn) return;
        const { open, chat, story } = btn.dataset;
        if (open === 'more') {
            this.lineLimit += LINE_PAGE;
            this.runSearch();
            return;
        }
        if (open === 'chat') {
            this.openChat(chat);
            return;
        }
        const scripts = this.allData[chat]?.[story]?.scripts ?? [];
        if (open === 'speaker') {
            const gid = Number(btn.dataset.gid);
            this.openStory(chat, story, { gid, label: `${btn.dataset.name} 발언`, hits: storyHits(scripts, { gid }), at: 0 });
        } else {
            const query = this.lastQuery; // what these rows were built from, not what is typed now
            const hits = storyHits(scripts, { query });
            const at = Math.max(0, hits.indexOf(Number(btn.dataset.index)));
            this.openStory(chat, story, { query, label: `'${query}'`, hits, at });
        }
    }

    /** Land on search hit `at`: pick the branches that lead to it, render, center it. */
    goToHit(at) {
        const { hits } = this.focus;
        if (!hits.length) {
            this.renderStory();
            return;
        }
        this.focus.at = (at + hits.length) % hits.length;
        const index = hits[this.focus.at];
        this.picks = picksToReach(this.scripts, index);
        this.renderStory();
        const node = this.els.log.querySelector(`[data-index="${index}"]`);
        if (!node) return;
        node.classList.add('is-focus');
        this.els.log.scrollTop = node.offsetTop - (this.els.log.clientHeight - node.offsetHeight) / 2;
    }

    /** The ↑↓ bar for a story opened from search; hidden otherwise. */
    renderJump() {
        const focus = this.focus;
        if (!focus?.hits.length) {
            hideElement(this.els.jump);
            return;
        }
        this.els.jumpLabel.textContent = `${focus.label} · 이 대화에서 ${focus.hits.length}건 중 ${focus.at + 1}`;
        showElement(this.els.jump);
    }

    // ===== Timers =====

    /** Schedule a timeout tracked for clearTimers(); drops itself from the list once it fires. */
    setTrackedTimeout(callback, delay) {
        const timer = setTimeout(() => {
            this.activeTimers = this.activeTimers.filter((t) => t !== timer);
            callback();
        }, delay);
        this.activeTimers.push(timer);
        return timer;
    }

    /** Cancel every pending line so a story / mode switch never shows stale messages. */
    clearTimers() {
        this.activeTimers.forEach((timer) => clearTimeout(timer));
        this.activeTimers = [];
    }
}
