/**
 * chat-viewer.script.js
 * Pure chat-script logic for the JUUS / Dorm3D viewers — no DOM, node-tested
 * (tests/chat-viewer/chat-script.test.mjs).
 *
 * Branching is the game's own rule (instagramtopic.lua SetDisplayWordList): before the
 * first reply every line up to the first choice shows; after it, a line shows when its
 * flag is 0 or one of the picked reply flags. An unanswered choice ends what is shown.
 * Both viewer modes are that one walk.
 */
import { normalizeRomanNumerals } from '../utils.js';

// ===== Branching =====

/** A line's choice options as [[flag, label], ...], or null. `option` is "" when there is none. */
export function choiceOptions(line) {
    return Array.isArray(line?.option) && Array.isArray(line.option[0]) ? line.option : null;
}

/**
 * Walk a story's scripts the way the game displays them.
 * @param {Array<Object>} scripts
 * @param {Record<number, number>} [picks] - script index → picked reply flag
 * @param {{ full?: boolean }} [opts] - full: an unpicked choice takes its first option and a
 *   `choice` item follows its line; otherwise the walk stops at it (`pending`).
 * @returns {{ items: Array<{type: 'line', index: number, line: Object}
 *                         | {type: 'choice', index: number, options: Array, picked: number}>,
 *             pending: { index: number, options: Array } | null }}
 */
export function visibleLines(scripts, picks = {}, { full = false } = {}) {
    const chosen = new Set();
    const items = [];
    for (let index = 0; index < scripts.length; index++) {
        const line = scripts[index];
        const flag = line.flag || 0;
        // Until the first reply the game shows every line up to the first choice, flag or not.
        if (flag !== 0 && chosen.size && !chosen.has(flag)) continue;
        items.push({ type: 'line', index, line });
        const options = choiceOptions(line);
        if (!options) continue;
        const picked = picks[index] ?? (full ? options[0][0] : undefined);
        if (picked === undefined) return { items, pending: { index, options } };
        chosen.add(picked);
        if (full) items.push({ type: 'choice', index, options, picked });
    }
    return { items, pending: null };
}

/**
 * Picks that make scripts[index] visible: from its flag back to the nearest earlier choice
 * offering that flag (two branches can offer the same one), then from that choice line's own
 * flag, until flag 0.
 * @returns {Record<number, number>} a fresh picks object
 */
export function picksToReach(scripts, index) {
    const picks = {};
    let at = index;
    let flag = scripts[at]?.flag || 0;
    while (flag !== 0) {
        const wanted = flag;
        const from = scripts.findLastIndex(
            (line, i) => i < at && choiceOptions(line)?.some(([f]) => f === wanted),
        );
        if (from < 0) break;
        picks[from] = wanted;
        at = from;
        flag = scripts[at].flag || 0;
    }
    return picks;
}

// ===== Speakers =====

/** Group rooms carry no story-level icon; every 1:1 (and every Dorm3D) story has its owner's. */
export function isGroupChat(story) {
    return !story?.icon;
}

/**
 * When a chat last got a story, as a sortable number: its newest line `id`. Neither file
 * carries a date, but line ids are global per file and grow with each release; Dorm3D story
 * ids embed the ship group, so they cannot order its rooms.
 */
export function addedOrder(stories) {
    return Math.max(...Object.values(stories).flatMap((story) => (story.scripts || []).map((line) => line.id)));
}

/** Chat-list orders over summaries ({ name, added }), keyed by the sort menu's values. */
export const CHAT_SORTS = {
    new: (a, b) => b.added - a.added,
    old: (a, b) => a.added - b.added,
    name: (a, b) => a.name.localeCompare(b.name, 'ko'),
    'name-desc': (a, b) => b.name.localeCompare(a.name, 'ko'),
};

/**
 * @아이디 for a line's speaker: the username map (local flat `{gid: "handle"}` or the raw
 * template `{gid: {name}}`), else the story owner's ship_name when the owner speaks
 * (Dorm3D ships no username map). Player, system and unknown speakers → ''.
 */
export function speakerHandle(line, story, usernames = {}) {
    const gid = line?.ship_group;
    if (!gid) return '';
    const entry = usernames[gid];
    const handle = typeof entry === 'string' ? entry : entry?.name;
    if (handle) return handle.trim();
    return gid === story.ship_group ? String(story.ship_name || '').trim() : '';
}

/**
 * Who says a line. Dorm3D lines carry no kr_name/icon, so the story owner's fill in.
 * role: 'player' (ship_group 0) | 'character' (has a portrait) | 'narrator' (no portrait — 시스템).
 * @returns {{ role: string, gid: number, name: string, handle: string, icon: string|null }}
 */
export function speakerOf(line, story, usernames = {}) {
    const gid = line.ship_group;
    if (gid === 0) return { role: 'player', gid, name: '지휘관', handle: '', icon: null };
    const owner = gid === story.ship_group;
    const name = line.kr_name || (owner ? story.kr_name : '') || '';
    const icon = line.icon || (owner ? story.icon : null) || null;
    if (!icon) return { role: 'narrator', gid, name, handle: '', icon: null };
    return { role: 'character', gid, name, handle: speakerHandle(line, story, usernames), icon };
}

// ===== Search =====

/**
 * Every character who speaks anywhere, keyed by ship_group — the 함순이 search source.
 * ownChat: the chat whose stories she owns (her 1:1), or null.
 * appearances: stories outside her own chat where she speaks, with her line count.
 * There is no group member list in game config, so speaking is the only membership.
 * @returns {Array<{gid: number, name: string, handle: string, icon: string|null,
 *   ownChat: string|null, appearances: Array<{chatKey: string, storyId: string, count: number}>}>}
 */
export function buildSpeakerIndex(allData, usernames = {}) {
    const byGid = new Map();
    const speaker = (gid, name, handle, icon) => {
        if (!byGid.has(gid)) byGid.set(gid, { gid, name, handle, icon, ownChat: null, appearances: [] });
        return byGid.get(gid);
    };
    for (const [chatKey, stories] of Object.entries(allData)) {
        for (const [storyId, story] of Object.entries(stories)) {
            if (!isGroupChat(story)) {
                const handle = speakerHandle({ ship_group: story.ship_group }, story, usernames);
                speaker(story.ship_group, story.kr_name, handle, story.icon).ownChat = chatKey;
            }
            const counts = new Map();
            for (const line of story.scripts || []) {
                const who = speakerOf(line, story, usernames);
                if (who.role !== 'character') continue;
                speaker(who.gid, who.name, who.handle, who.icon);
                if (who.gid !== story.ship_group) counts.set(who.gid, (counts.get(who.gid) || 0) + 1);
            }
            for (const [gid, count] of counts) byGid.get(gid).appearances.push({ chatKey, storyId, count });
        }
    }
    return [...byGid.values()];
}

/**
 * Speakers whose name (Roman numerals normalized) or @아이디 (case-insensitive) contains the
 * query; a leading '@' is ignored. Exact name first, then name prefix, then index order.
 */
export function searchSpeakers(speakers, query) {
    const q = String(query || '').trim().replace(/^@/, '');
    if (!q) return [];
    const nameQ = normalizeRomanNumerals(q);
    const handleQ = q.toLowerCase();
    const rank = (name) => (name === nameQ ? 0 : name.startsWith(nameQ) ? 1 : 2);
    return speakers
        .map((s, order) => ({ s, order, name: normalizeRomanNumerals(s.name || '') }))
        .filter(({ s, name }) => name.includes(nameQ) || (s.handle || '').toLowerCase().includes(handleQ))
        .sort((a, b) => rank(a.name) - rank(b.name) || a.order - b.order)
        .map(({ s }) => s);
}

// Dialogue and system lines carry text; a sticker's param is an emoji id.
const TEXT_TYPES = new Set([1, 5]);

function lineMatches(line, q) {
    return TEXT_TYPES.has(line.type) && String(line.param ?? '').toLowerCase().includes(q);
}

/**
 * Lines whose text contains the query (case-insensitive), in data order, 지휘관 lines included.
 * @returns {{ total: number, hits: Array<{chatKey: string, storyId: string, index: number, text: string}> }}
 *   hits capped at `limit`, total uncapped
 */
export function searchLines(allData, query, limit = 50) {
    const q = String(query || '').trim().toLowerCase();
    const hits = [];
    let total = 0;
    if (!q) return { total, hits };
    for (const [chatKey, stories] of Object.entries(allData)) {
        for (const [storyId, story] of Object.entries(stories)) {
            (story.scripts || []).forEach((line, index) => {
                if (!lineMatches(line, q)) return;
                total++;
                if (hits.length < limit) hits.push({ chatKey, storyId, index, text: String(line.param) });
            });
        }
    }
    return { total, hits };
}

/** Script indexes in one story the jump bar steps through: a speaker's lines, or text matches. */
export function storyHits(scripts, { gid = null, query = '' } = {}) {
    const q = String(query || '').trim().toLowerCase();
    const out = [];
    scripts.forEach((line, index) => {
        if (gid != null ? line.ship_group === gid : q && lineMatches(line, q)) out.push(index);
    });
    return out;
}
