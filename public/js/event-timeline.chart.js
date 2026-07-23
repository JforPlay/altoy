/**
 * event-timeline.chart.js
 * Pure chart-model helpers for the 무딱 차트 swimlane view. No DOM, no module
 * side effects — node-testable (tests/event-timeline/chart.test.mjs).
 * Positions are month units (year*12 + month); rendering multiplies by px.
 */

const STATUSES = new Set(['신규', '복각', '상시편입']);
// Latest-run status → trailing indicator. 상시편입 = solid "playable" bar;
// 신규/복각 = dashed still-waiting line. One-offs (any other value) get none.
const TAIL_KINDS = { '상시편입': 'permanent', '신규': 'wait-rerun', '복각': 'wait-permanent' };

/** Absolute month index: year*12 + month (0-based). */
export function monthIndex(date) {
    return date.getFullYear() * 12 + date.getMonth();
}

export function isMudak(event) {
    return event?.['무딱 이벤?'] === 'O';
}

/**
 * Build swimlane row models from buildGroups() groups (any iterable).
 * A group is charted when ANY run is 무딱 O; charted rows keep ALL dated runs
 * (full lifecycle context) and drop dateless ones. No dated runs → no row.
 * Returns { start, end, rows }: start = January of the earliest charted run's
 * year (equals end when there are no rows), end = monthIndex(now).
 */
export function buildMudakChart(groups, { now }) {
    const end = monthIndex(now);
    const rows = [];
    for (const group of groups) {
        if (!group.runs.some(r => isMudak(r.event))) continue;
        const runs = group.runs
            .filter(r => r.date)
            .map(r => ({
                event: r.event,
                status: STATUSES.has(r.event.복각여부) ? r.event.복각여부 : '',
                mi: monthIndex(r.date)
            }));
        if (runs.length === 0) continue;

        const spans = [];
        for (let i = 1; i < runs.length; i++) {
            spans.push({
                from: runs[i - 1].mi,
                to: runs[i].mi,
                months: runs[i].mi - runs[i - 1].mi,
                phase: runs[i - 1].status === '복각' ? 'rerun' : 'new'
            });
        }
        const last = runs[runs.length - 1];
        const kind = TAIL_KINDS[last.status];
        rows.push({
            key: group.key,
            anchor: group.anchor,
            startYear: Math.floor(runs[0].mi / 12),
            runs,
            spans,
            tail: kind ? { kind, from: last.mi, months: Math.max(0, end - last.mi) } : null
        });
    }
    rows.sort((a, b) => (a.runs[0].mi - b.runs[0].mi) || ((parseInt(a.key) || 0) - (parseInt(b.key) || 0)));
    const start = rows.length ? Math.floor(rows[0].runs[0].mi / 12) * 12 : end;
    return { start, end, rows };
}

/**
 * 복각주기 보기 mode: multi-run rows only, rebased so each row's first run
 * is month 0. Input order is preserved — buildMudakChart already sorts by
 * first-run date ascending (oldest 신규 first). Tails are dropped — an ongoing
 * wait has no meaning on a relative axis. Returns { rows, maxMi }.
 */
export function toRelativeRows(rows) {
    const rel = rows
        .filter(r => r.runs.length > 1)
        .map(r => {
            const base = r.runs[0].mi;
            return {
                key: r.key,
                anchor: r.anchor,
                startYear: r.startYear,
                runs: r.runs.map(run => ({ ...run, mi: run.mi - base })),
                spans: r.spans.map(s => ({ ...s, from: s.from - base, to: s.to - base })),
                tail: null
            };
        });
    const maxMi = rel.reduce((m, r) => Math.max(m, r.runs[r.runs.length - 1].mi), 0);
    return { rows: rel, maxMi };
}
