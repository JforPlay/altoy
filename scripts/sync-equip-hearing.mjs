/**
 * sync-equip-hearing.mjs
 * Equip-hearing (장비 한줄평) data pipeline — two one-way channels:
 *
 *   1. ALWAYS: regenerate public/data/equip/hearing_catalog.csv from
 *      equip_data_lite.json. The curators' Google Sheet IMPORTDATAs this
 *      file (after deploy) so its catalog tab self-refreshes.
 *   2. WHEN SHEET_ID IS SET: fetch the sheet's hearing tab as CSV, validate,
 *      group rows by equip, and write public/data/equip/equip_hearing.json.
 *
 * The hearing tab is the ONLY human-edited surface; this script never writes
 * to the sheet, and nothing but this script writes equip_hearing.json — so
 * user input and game data can never clobber each other.
 *
 * Run: `npm run data:hearing` [--allow-unknown]
 * Spec: dev/active/2026-06-11-equip-hearing-design.md
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { DATA_FOR_TOY_BASE } from '../public/js/utils.js';

// CSV primitives live in public/js/csv.js (shared with sync-skin-labels AND the
// browser-side tracker sheet codec). Re-exported here so this module's public
// surface — and its tests — are unchanged.
import { parseCsv, csvField, headerIndex } from '../public/js/csv.js';
export { parseCsv, csvField };

// Curator config: fill in after creating the sheet (File → Share → anyone
// with link = viewer). HEARING_GID = the gid= URL param of the hearing tab.
const SHEET_ID = '1iglCHXqF-HCD8euPDoHsyr0jk_WY7jfnmarH8ryvYT8';
const HEARING_GID = '1093340261';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const LITE_PATH = join(ROOT, 'public', 'data', 'equip', 'equip_data_lite.json');
const CATALOG_PATH = join(ROOT, 'public', 'data', 'equip', 'hearing_catalog.csv');
const OUT_PATH = join(ROOT, 'public', 'data', 'equip', 'equip_hearing.json');

// ===== Channel 1: catalog CSV for the sheet's IMPORTDATA tab =====

/**
 * Build hearing_catalog.csv text from equip_data_lite entries.
 * COLUMN ORDER IS A CONTRACT — the sheet's VLOOKUP/IMAGE formulas index into
 * it (icon_url = column 6). Append-only; never reorder.
 * Icon sentinel '1' mirrors getEquipIconUrl in public/js/equip/equip.data.js.
 * @param {Array} liteData @returns {string}
 */
export function buildCatalogCsv(liteData) {
    const header = 'id,name,rarity,type,nation,icon_url';
    const lines = liteData.map((e) => [
        e.id,
        e.name,
        e.rarity_name ?? '',
        e.type_name2 || e.type_name || '',
        e.nation_code ?? '',
        e.icon && e.icon !== '1' ? `${DATA_FOR_TOY_BASE}/equips/${e.icon}.webp` : '',
    ].map(csvField).join(','));
    return [header, ...lines].join('\n') + '\n';
}

// ===== Channel 2: hearing tab → equip_hearing.json =====

// 청문회-tab header contract: pre-populated, ONE ROW PER EQUIP. Synced columns
// are matched by header name; display columns (이름/아이콘/레어도 …) are ignored,
// so editors may add/reorder those freely.
const ID_HEADER = '장비id';
const ALIAS_HEADER = '별명';
const REVIEW_HEADER_RE = /^한줄평(\d+)$/;

/**
 * Map raw CSV rows to row objects by HEADER NAME (not position). 한줄평N review
 * columns are detected dynamically — adding 한줄평4 to the sheet needs no code
 * change; reviews keep the N order even if the columns are physically shuffled.
 * Values are trimmed and newline-normalized but otherwise RAW — the page
 * escapes at render time. Pre-populated rows with no input (no alias, no
 * review) are dropped, which keeps the output JSON sparse.
 * @param {string[][]} rows - parseCsv output incl. header row
 * @returns {Array<{equipId: string, alias: string, reviews: string[]}>}
 */
export function mapRows(rows) {
    if (!rows.length) throw new Error('hearing CSV is empty (no header row)');
    const header = rows[0].map((h) => h.trim());
    const idIdx = headerIndex(header, ID_HEADER);
    const aliasIdx = headerIndex(header, ALIAS_HEADER);
    const reviewIdxs = header
        .map((h, i) => { const m = h.match(REVIEW_HEADER_RE); return m ? { n: Number(m[1]), i } : null; })
        .filter(Boolean)
        .sort((a, b) => a.n - b.n)
        .map((r) => r.i);
    if (idIdx === -1 || aliasIdx === -1 || !reviewIdxs.length) {
        throw new Error(`hearing CSV must have "${ID_HEADER}", "${ALIAS_HEADER}", and at least one `
            + `한줄평N column (got: ${header.join(', ')})`);
    }
    const clean = (v) => (v ?? '').replace(/\r\n?/g, '\n').trim();
    return rows.slice(1)
        .map((cols) => {
            const row = {
                equipId: clean(cols[idIdx]),
                alias: clean(cols[aliasIdx]),
                reviews: reviewIdxs.map((i) => clean(cols[i])).filter(Boolean),
            };
            // An id cell may hold an "id — name" composite; the id is the leading
            // digits. Values with no digit prefix pass through so validateRows flags them.
            const idMatch = row.equipId.match(/^\d+/);
            if (idMatch) row.equipId = idMatch[0];
            return row;
        })
        .filter((r) => r.alias || r.reviews.length);
}

/**
 * Validate mapped rows against the lite-catalog id set.
 * Hard-fail philosophy (spec): typos must not silently drop a comment.
 * `allowUnknown` keeps rows whose equip vanished from the catalog (e.g. an
 * equip removed from the game) — data is preserved, the page just won't
 * render entries it can't join.
 * @param {ReturnType<typeof mapRows>} rows
 * @param {Set<string>} validIds - String(id) set from equip_data_lite.json
 * @param {{allowUnknown?: boolean}} [opts]
 * @returns {{errors: string[]}}
 */
export function validateRows(rows, validIds, { allowUnknown = false } = {}) {
    const errors = [];
    const seen = new Set();
    const unknown = new Set();
    for (const row of rows) {
        if (!/^\d+$/.test(row.equipId)) {
            errors.push(`invalid 장비id "${row.equipId}"`);
        } else if (!validIds.has(row.equipId)) {
            unknown.add(row.equipId);
        }
        if (seen.has(row.equipId)) errors.push(`duplicate 장비id ${row.equipId}`);
        seen.add(row.equipId);
    }
    if (unknown.size && !allowUnknown) {
        errors.push(`unknown 장비id(s) not in equip_data_lite.json: ${[...unknown].join(', ')}`
            + ' (re-run with --allow-unknown to keep them)');
    }
    return { errors };
}

/**
 * Map validated rows into the equip_hearing.json shape:
 *   { _meta: {synced, count}, entries: { "<id>": { alias, reviews[] } } }
 * One sheet row per equip (duplicates are validation errors), so this is a
 * direct mapping — reviews arrive already cleaned and ordered by 한줄평 number.
 * @param {ReturnType<typeof mapRows>} rows
 * @param {string} syncedDate - YYYY-MM-DD
 */
export function buildHearingJson(rows, syncedDate) {
    const entries = {};
    for (const row of rows) {
        entries[row.equipId] = { alias: row.alias, reviews: row.reviews };
    }
    return { _meta: { synced: syncedDate, count: Object.keys(entries).length }, entries };
}

/**
 * Per-equip change counts between two entries maps, for the sync run report.
 * @returns {{added: number, removed: number, changed: number}}
 */
export function diffSummary(prevEntries, nextEntries) {
    let added = 0, removed = 0, changed = 0;
    for (const id of Object.keys(nextEntries)) {
        if (!(id in prevEntries)) added++;
        else if (JSON.stringify(prevEntries[id]) !== JSON.stringify(nextEntries[id])) changed++;
    }
    for (const id of Object.keys(prevEntries)) if (!(id in nextEntries)) removed++;
    return { added, removed, changed };
}

// ===== CLI =====

/**
 * Always regenerates the catalog CSV; syncs comments only when SHEET_ID is
 * configured. equip_hearing.json is written in one shot AFTER validation
 * passes — a failed run never leaves a partial file.
 */
async function main() {
    const allowUnknown = process.argv.includes('--allow-unknown');
    const lite = JSON.parse(readFileSync(LITE_PATH, 'utf8'));

    writeFileSync(CATALOG_PATH, buildCatalogCsv(lite));
    console.log(`hearing_catalog.csv regenerated (${lite.length} equips)`);

    if (!SHEET_ID) {
        console.log('SHEET_ID not configured — skipped comment sync (equip_hearing.json unchanged).');
        return;
    }

    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${HEARING_GID}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`sheet fetch failed: HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    if (text.trimStart().startsWith('<')) {
        throw new Error('sheet fetch returned HTML, not CSV — is the sheet shared as "anyone with link can view"?');
    }

    const rows = mapRows(parseCsv(text));
    const validIds = new Set(lite.map((e) => String(e.id)));
    const { errors } = validateRows(rows, validIds, { allowUnknown });
    if (errors.length) {
        console.error('validation failed:\n  - ' + errors.join('\n  - '));
        process.exit(1);
    }

    const next = buildHearingJson(rows, new Date().toISOString().slice(0, 10));
    const prev = existsSync(OUT_PATH)
        ? JSON.parse(readFileSync(OUT_PATH, 'utf8'))
        : { entries: {} };
    const d = diffSummary(prev.entries ?? {}, next.entries);
    writeFileSync(OUT_PATH, JSON.stringify(next, null, 2) + '\n');
    console.log(`equip_hearing.json written: ${next._meta.count} equips with commentary `
        + `(+${d.added} added, ~${d.changed} changed, -${d.removed} removed)`);
    console.log('Reminder: deploying this change needs the DATA_VERSION/CACHE_VERSION dual PATCH bump.');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    main().catch((err) => {
        console.error(err?.message ?? err);
        process.exit(1);
    });
}
