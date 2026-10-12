/**
 * story.readlog.js
 * Which stories a reader has finished: { [scope]: { [eventId]: [memoryId] } }.
 * Scope = the page's config.viewerType (main / event / world / secretary / hof /
 * lora / navi / tb) because memory ids are not unique across story sources;
 * keyed by event so an event card's "3 / 8" needs no chapter fetch. Synced
 * across tabs (syncedStorage) and devices (Drive: utils.js SYNCED_KEYS).
 */
import { syncedStorage } from '../utils.js';

export const READLOG_KEY = 'storyReadLog';

export function normalizeReadLog(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [scope, events] of Object.entries(raw)) {
        if (!events || typeof events !== 'object' || Array.isArray(events)) continue;
        for (const [eventId, ids] of Object.entries(events)) {
            if (!Array.isArray(ids)) continue;
            const clean = [...new Set(ids.filter(id => typeof id === 'string' || typeof id === 'number').map(String))];
            if (clean.length) (out[scope] ??= {})[eventId] = clean;
        }
    }
    return out;
}

export function isRead(log, scope, eventId, memoryId) {
    return !!log[scope]?.[String(eventId)]?.includes(String(memoryId));
}

export function setRead(log, scope, eventId, memoryId, read) {
    const e = String(eventId), m = String(memoryId);
    const ids = new Set(log[scope]?.[e] || []);
    if (read) ids.add(m); else ids.delete(m);
    const events = { ...(log[scope] || {}) };
    if (ids.size) events[e] = [...ids]; else delete events[e];
    return { ...log, [scope]: events };
}

export function countRead(log, scope, eventId) {
    return log[scope]?.[String(eventId)]?.length || 0;
}

/**
 * Storage-backed read log. `onRemoteChange()` fires when another tab writes.
 * @returns {{isRead:Function, setRead:Function, toggleRead:Function, countRead:Function}}
 */
export function createReadLogStore({ onRemoteChange } = {}) {
    let log = {};
    const store = syncedStorage(READLOG_KEY, {
        version: 1,
        parse: (raw) => normalizeReadLog(raw),
        onRemoteChange: (next) => { log = next; onRemoteChange?.(); },
    });
    log = store.load();
    const write = (next) => { log = next; store.save(log); };
    return {
        isRead: (scope, e, m) => isRead(log, scope, e, m),
        setRead: (scope, e, m, read) => write(setRead(log, scope, e, m, read)),
        toggleRead: (scope, e, m) => write(setRead(log, scope, e, m, !isRead(log, scope, e, m))),
        countRead: (scope, e) => countRead(log, scope, e),
    };
}
