/**
 * event-story.filter.js
 * Pure grouping/filtering for the 이벤트 스토리 archive index.
 * No DOM, no window.*, side-effect-free on import (node-testable).
 */

/**
 * Filter event index records by subtype/faction/search, then group by year.
 * @param {Array<object>} records  event index records (id, name, subtype, year, faction)
 * @param {{search?: string, subtypes?: number[], faction?: string}} [opts]
 * @returns {Array<{year: number|null, label: string, events: object[]}>}
 *   groups sorted by year descending, the null-year bucket ('연도 미상') last,
 *   events within each group sorted by id ascending.
 */
export function groupAndFilterEvents(records, { search = '', subtypes = [], faction = '' } = {}) {
  const term = String(search || '').trim().toLowerCase();
  const subSet = new Set(subtypes || []);

  const filtered = (records || []).filter((r) => {
    if (subSet.size && !subSet.has(r.subtype)) return false;
    if (faction && r.faction !== faction) return false;
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
    events: events.sort((a, b) => (a.id || 0) - (b.id || 0)),
  }));

  groups.sort((a, b) => {
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return b.year - a.year;
  });

  return groups;
}
