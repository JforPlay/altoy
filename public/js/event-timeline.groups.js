/**
 * event-timeline.groups.js
 * Pure grouping/date helpers for the event timeline page. No DOM, no module
 * side effects — node-testable (tests/event-timeline/).
 *
 * Grouping truth is the explicit 원본ID field on rerun/상시편입 rows in
 * kr_event_timeline.json, pointing at the anchor run's ID. Never fuzzy-matched
 * at runtime — names drift in the hand-maintained data (same lesson as gid
 * linking; the one-off normalizer lives only in dev/seed-event-groups.mjs).
 */

const MS_PER_DAY = 86400000;

/**
 * Parse an event 날짜 into a local-midnight Date, or null.
 * Formats: "2018. 5. 15" (KR) and "2017/09/21 ~ 2017/09/30" (JP range → start).
 */
export function parseEventDate(str) {
    if (typeof str !== 'string') return null;
    const head = str.split('~')[0];
    const m = head.match(/(\d{4})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{1,2})/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole days from a to b (positive when b is later); null if either is missing. */
export function daysBetween(a, b) {
    if (!a || !b) return null;
    return Math.round((b - a) / MS_PER_DAY);
}

/**
 * Group event rows by 원본ID. Returns Map<key, group>:
 *   { key, runs, gaps, anchor, latestRun, latestStatus, latestDate }
 * runs = [{ event, date }] sorted date-asc (dateless runs last, in ID order);
 * gaps[i] = days between runs[i] and runs[i+1] (null when a date is missing).
 * Fail-soft: a 원본ID pointing at a missing ID keeps the row as its own group
 * (console.warn) so a bad hand-edit degrades to the old per-row rendering.
 */
export function buildGroups(events) {
    const ids = new Set(events.map(e => String(e.ID)));
    const buckets = new Map();
    for (const event of events) {
        const ref = String(event.원본ID ?? '').trim();
        let key = String(event.ID);
        if (ref) {
            if (ids.has(ref)) key = ref;
            else console.warn(`[event-timeline] 원본ID ${ref} (row ${event.ID}) matches no event — treating as standalone`);
        }
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(event);
    }

    const groups = new Map();
    for (const [key, rows] of buckets) {
        const runs = rows
            .map(event => ({ event, date: parseEventDate(event.날짜) }))
            .sort((a, b) => {
                if (a.date && b.date) return a.date - b.date;
                if (a.date) return -1;
                if (b.date) return 1;
                return (parseInt(a.event.ID) || 0) - (parseInt(b.event.ID) || 0);
            });
        const gaps = [];
        for (let i = 1; i < runs.length; i++) {
            gaps.push(daysBetween(runs[i - 1].date, runs[i].date));
        }
        const anchorRun = runs.find(r => String(r.event.ID) === key) ?? runs[0];
        const latestRun = runs[runs.length - 1];
        groups.set(key, {
            key,
            runs,
            gaps,
            anchor: anchorRun.event,
            latestRun,
            latestStatus: latestRun.event.복각여부 || '',
            latestDate: latestRun.date
        });
    }
    return groups;
}

/**
 * Badge label for the gap arriving at runs[i]: "신규 후 +408일".
 * Prefix = the PREVIOUS run's 복각여부 (상시편입 → 상시; empty → 이전 런).
 * Null for the first run or when either date is missing.
 */
export function gapLabel(group, i) {
    if (i < 1 || group.gaps[i - 1] == null) return null;
    const prev = group.runs[i - 1].event.복각여부;
    const prefix = prev === '상시편입' ? '상시' : (prev || '이전 런');
    return `${prefix} 후 +${group.gaps[i - 1]}일`;
}
