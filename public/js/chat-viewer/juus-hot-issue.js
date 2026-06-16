/**
 * juus-hot-issue.js
 * 쥬쥬 핫 이슈 (Juustagram Official Account / type=2 posts) viewer.
 *
 * Renders each post fully inline as a feed card: headline + body, the authored
 * discussion thread (comments + replies), and the commander reply options with
 * the shipgirls' reactions. The data (juus_hot_issue_data.json) is generated
 * purely from KR lua2json: each comment carries its author ship_group id and a
 * baked @username handle. ship_group → Korean name + icon is resolved here via
 * ship_group_data.json, mirroring the juustagram page. These OA posts have no
 * header images (the picture data exists only server-side / in the frozen repo).
 */

import {
    fetchJSONWithCache,
    createImgElement,
    requireElements,
    loadPageData,
    renderStatus,
} from '../utils.js';

document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('hot-issue-grid');
    if (!requireElements({ grid }, 'JuusHotIssue')) return;

    // Gray-circle placeholder for missing/unknown shipgirl icons (matches juustagram).
    const placeholderIcon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23e0e0e0'/%3E%3C/svg%3E";

    let shipgirlDataMap = {};        // ship_group → { name, icon }

    init();

    async function init() {
        const [data] = await Promise.all([
            loadPageData(
                () => fetchJSONWithCache('data/chat-viewer/juus_hot_issue_data.json'),
                grid,
                { contextLabel: 'JuusHotIssue' },
            ),
            // Shipgirl name/icon map is best-effort: comments still render (icon +
            // "ID NNNNN") if it fails, so don't let it block the page. The @username
            // handle is baked into the post data, so no external fetch is needed.
            fetchJSONWithCache('data/ship_group_data.json')
                .then((map) => { if (isRecord(map)) shipgirlDataMap = map; })
                .catch((err) => console.warn('Hot issue: shipgirl data failed to load:', err)),
        ]);

        if (data === null) return;          // container missing — loadPageData rendered the error
        if (!Array.isArray(data) || data.length === 0) {
            renderEmpty('등록된 핫 이슈가 없습니다.');
            return;
        }

        const fragment = document.createDocumentFragment();
        data.forEach((post) => fragment.appendChild(createPostCard(post)));
        grid.replaceChildren(fragment);
    }

    // ===== Helpers =====

    function isRecord(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function renderEmpty(message) {
        renderStatus(grid, message, 'empty');
    }

    /**
     * Resolve a comment author's ship_group id to a display name + icon.
     * Unknown / absent ids degrade to a placeholder dot + "ID NNNNN".
     * (The @username handle comes baked into the comment data, not from here.)
     */
    function getAuthor(shipGroup) {
        const entry = shipGroup != null ? shipgirlDataMap[shipGroup] : null;
        if (isRecord(entry)) {
            return {
                name: String(entry.name || `ID ${shipGroup}`).trim(),
                icon: entry.icon || placeholderIcon,
            };
        }
        return {
            name: shipGroup != null ? `ID ${shipGroup}` : '익명',
            icon: placeholderIcon,
        };
    }

    function createAvatar(src, alt, className) {
        return createImgElement(src || placeholderIcon, alt, {
            className,
            eager: true,
            fallback: placeholderIcon,
        });
    }

    function appendText(parent, tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        el.textContent = text ?? '';
        parent.appendChild(el);
        return el;
    }

    /**
     * The game stores line breaks as the literal token `\n` (backslash + n).
     * Convert to real newlines so `white-space: pre-wrap` renders them — same
     * as the in-game text engine interpreting `\n`.
     */
    function lineBreaks(text) {
        return String(text ?? '').replace(/\\r\\n|\\n|\\r/g, '\n');
    }

    /** Format the game's [[Y,M,D],[h,m,s]] time tuple as "YYYY.MM.DD HH:MM". */
    function formatTime(time) {
        if (!Array.isArray(time) || time.length < 2) return '';
        const [d, t] = time;
        if (!Array.isArray(d) || !Array.isArray(t)) return '';
        const pad = (n) => String(n).padStart(2, '0');
        return `${d[0]}.${pad(d[1])}.${pad(d[2])} ${pad(t[0])}:${pad(t[1])}`;
    }

    // ===== Rendering =====

    function createPostCard(post) {
        const card = document.createElement('article');
        card.className = 'hot-issue-card';

        card.appendChild(createCardHeader(post));

        const title = document.createElement('h2');
        title.className = 'hi-title';
        title.textContent = (post.title || '').trim();
        card.appendChild(title);

        if (post.message) {
            const msg = document.createElement('p');
            msg.className = 'hi-message';
            msg.textContent = lineBreaks(post.message);
            card.appendChild(msg);
        }

        const comments = createCommentsSection(post.discussions);
        if (comments) card.appendChild(comments);

        const options = createOptionsSection(post.options);
        if (options) card.appendChild(options);

        return card;
    }

    function createCardHeader(post) {
        const header = document.createElement('header');
        header.className = 'hi-card-header';

        const account = document.createElement('div');
        account.className = 'hi-account';

        const badge = document.createElement('span');
        badge.className = 'hi-account-badge';
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = '📢';
        account.appendChild(badge);

        const meta = document.createElement('div');
        meta.className = 'hi-account-meta';
        appendText(meta, 'span', 'hi-account-name', '쥬쥬 핫 이슈');
        const time = formatTime(post.time);
        if (time) appendText(meta, 'span', 'hi-time', time);
        account.appendChild(meta);

        header.appendChild(account);

        appendText(header, 'span', 'badge badge--neutral hi-id', `#${post.id}`);
        return header;
    }

    function createCommentsSection(discussions) {
        if (!Array.isArray(discussions) || discussions.length === 0) return null;

        const section = document.createElement('section');
        section.className = 'hi-comments';

        const heading = document.createElement('h3');
        heading.className = 'hi-section-title';
        heading.textContent = '💬 댓글';
        const count = document.createElement('span');
        count.className = 'badge badge--neutral hi-count';
        count.textContent = String(discussions.length);
        heading.appendChild(count);
        section.appendChild(heading);

        discussions.forEach((discussion) => {
            if (!isRecord(discussion)) return;
            const thread = document.createElement('div');
            thread.className = 'hi-thread';
            thread.appendChild(createComment(discussion, false));
            (Array.isArray(discussion.replies) ? discussion.replies : []).forEach((reply) => {
                if (isRecord(reply)) thread.appendChild(createComment(reply, true));
            });
            section.appendChild(thread);
        });

        return section;
    }

    /**
     * @param {{author:number, username:string, text:string}} comment
     */
    function createComment(comment, isReply) {
        const data = getAuthor(comment.author);
        const el = document.createElement('div');
        el.className = isReply ? 'hi-comment hi-comment-reply' : 'hi-comment';
        el.appendChild(createAvatar(data.icon, data.name, 'hi-comment-icon'));

        const body = document.createElement('div');
        body.className = 'hi-comment-body';
        appendText(body, 'span', 'hi-comment-name', data.name);
        // @username handle (muted), matching the juustagram comment layout.
        if (comment.username) appendText(body, 'span', 'hi-comment-username', `@${comment.username}:`);
        appendText(body, 'span', 'hi-comment-text', lineBreaks(comment.text));
        el.appendChild(body);
        return el;
    }

    function createOptionsSection(options) {
        if (!Array.isArray(options) || options.length === 0) return null;

        const section = document.createElement('section');
        section.className = 'hi-options';

        appendText(section, 'h3', 'hi-section-title', '지휘관 답글');

        options.forEach((option) => {
            if (!isRecord(option)) return;
            const block = document.createElement('div');
            block.className = 'hi-option';

            const question = document.createElement('div');
            question.className = 'hi-option-q';
            appendText(question, 'span', 'badge hi-option-label', '지휘관');
            appendText(question, 'span', 'hi-option-text', lineBreaks(option.text));
            block.appendChild(question);

            (Array.isArray(option.replies) ? option.replies : []).forEach((reply) => {
                if (isRecord(reply)) block.appendChild(createComment(reply, true));
            });

            section.appendChild(block);
        });

        return section;
    }
});
