/**
 * event-story.filter.js
 * Pure grouping/filtering for the 이벤트 스토리 archive index.
 * No DOM, no window.*, side-effect-free on import (node-testable).
 */

// Start date of a dateRange as a sortable yyyymmdd number; null if unparseable.
// Handles '2025/01/02', '2025/01/02 ~ 2025/01/16', and the curator's '2019. 9. 5'.
const DATE_START_RE = /(\d{4})[./]\s*(\d{1,2})[./]\s*(\d{1,2})/;
function startDateKey(dateRange) {
  const m = DATE_START_RE.exec(String(dateRange || ''));
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : null;
}

/**
 * Filter event index records by subtype/faction/search, then group by year.
 * @param {Array<object>} records  event index records (id, name, subtype, year, faction, dateRange)
 * @param {{search?: string, subtypes?: number[], factions?: string[]}} [opts]
 * @returns {Array<{year: number|null, label: string, events: object[]}>}
 *   groups sorted by year descending, the null-year bucket ('연도 미상') last,
 *   events within each group sorted by dateRange start date descending
 *   (newest first, matching the year direction); undated events sink to the
 *   end of their group, ties break by id ascending.
 */
export function groupAndFilterEvents(records, { search = '', subtypes = [], factions = [] } = {}) {
  const term = String(search || '').trim().toLowerCase();
  const subSet = new Set(subtypes || []);
  const facSet = new Set(factions || []);

  const filtered = (records || []).filter((r) => {
    if (subSet.size && !subSet.has(r.subtype)) return false;
    if (facSet.size && !facSet.has(r.faction)) return false;
    if (term && !String(r.name || '').toLowerCase().includes(term)) return false;
    return true;
  });

  const byYear = new Map();
  for (const r of filtered) {
    const key = (r.year === null || r.year === undefined) ? null : r.year;
    if (!byYear.has(key)) byYear.set(key, []);
    byYear.get(key).push(r);
  }

  const groups = [...byYear.entries()].map(([year, events]) => ({
    year,
    label: year === null ? '연도 미상' : String(year),
    events: events.sort((a, b) => {
      const da = startDateKey(a.dateRange);
      const db = startDateKey(b.dateRange);
      if (da !== null && db !== null && da !== db) return db - da;
      if ((da === null) !== (db === null)) return da === null ? 1 : -1;
      return (a.id || 0) - (b.id || 0);
    }),
  }));

  groups.sort((a, b) => {
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return b.year - a.year;
  });

  return groups;
}
