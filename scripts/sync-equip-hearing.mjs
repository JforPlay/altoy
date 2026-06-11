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

// Curator config: fill in after creating the sheet (File → Share → anyone
// with link = viewer). HEARING_GID = the gid= URL param of the hearing tab.
const SHEET_ID = '';
const HEARING_GID = '0';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const LITE_PATH = join(ROOT, 'public', 'data', 'equip', 'equip_data_lite.json');
const CATALOG_PATH = join(ROOT, 'public', 'data', 'equip', 'hearing_catalog.csv');
const OUT_PATH = join(ROOT, 'public', 'data', 'equip', 'equip_hearing.json');

// ===== CSV primitives =====

/**
 * Minimal RFC4180 parser (quoted fields, doubled quotes, embedded newlines).
 * Returns rows of string fields. CR outside quotes is ignored (CRLF input);
 * CR inside quotes is content.
 * @param {string} text @returns {string[][]}
 */
export function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; continue; }
                inQuotes = false;
                continue;
            }
            field += ch;
            continue;
        }
        if (ch === '"') { inQuotes = true; continue; }
        if (ch === ',') { row.push(field); field = ''; continue; }
        if (ch === '\r') continue;
        if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
        field += ch;
    }
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
}

/**
 * Serialize one CSV field — quoted only when it contains a delimiter,
 * quote, or newline. @param {*} value @returns {string}
 */
export function csvField(value) {
    const s = String(value ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

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

/** Hearing tab header → row key. All five are required; extras are ignored. */
const HEARING_COLUMNS = {
    equip_id: 'equipId',
    author: 'author',
    '별명': 'alias',
    '한줄평': 'review',
    notes: 'notes',
};

/**
 * Map raw CSV rows to row objects by HEADER NAME (not position) so the sheet
 * can host convenience columns and gain future columns without breaking sync.
 * Values are trimmed and newline-normalized but otherwise RAW — the page
 * escapes at render time. Rows whose three content fields are all empty are
 * dropped (an editor placed a row but wrote nothing yet).
 * @param {string[][]} rows - parseCsv output incl. header row
 * @returns {Array<{equipId: string, author: string, alias: string, review: string, notes: string}>}
 */
export function mapRows(rows) {
    if (!rows.length) throw new Error('hearing CSV is empty (no header row)');
    const header = rows[0].map((h) => h.trim());
    const indices = {};
    for (const [name, key] of Object.entries(HEARING_COLUMNS)) {
        const idx = header.indexOf(name);
        if (idx === -1) {
            throw new Error(`hearing CSV missing required column "${name}" (got: ${header.join(', ')})`);
        }
        indices[key] = idx;
    }
    return rows.slice(1)
        .map((cols) => {
            const row = {};
            for (const [key, idx] of Object.entries(indices)) {
                row[key] = (cols[idx] ?? '').replace(/\r\n?/g, '\n').trim();
            }
            return row;
        })
        .filter((r) => r.alias || r.review || r.notes);
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
            errors.push(`invalid equip_id "${row.equipId}" (author: ${row.author || '?'})`);
        } else if (!validIds.has(row.equipId)) {
            unknown.add(row.equipId);
        }
        if (!row.author) errors.push(`missing author for equip_id ${row.equipId}`);
        const pair = `${row.equipId} ${row.author}`;
        if (seen.has(pair)) errors.push(`duplicate (equip_id, author) = (${row.equipId}, ${row.author})`);
        seen.add(pair);
    }
    if (unknown.size && !allowUnknown) {
        errors.push(`unknown equip_id(s) not in equip_data_lite.json: ${[...unknown].join(', ')}`
            + ' (re-run with --allow-unknown to keep them)');
    }
    return { errors };
}

/**
 * Group validated rows into the equip_hearing.json shape:
 *   { _meta: {synced, count}, entries: { "<id>": { alias, comments[] } } }
 * 별명 is communal — distinct non-empty RAW values from any author merge with
 * " / " in first-seen order. Dedup is on the raw alias string, never by
 * re-splitting the joined display string, so an alias may itself contain " / "
 * without being broken apart. A row with alias but no review/notes contributes
 * the alias only (no empty comment entry).
 * @param {ReturnType<typeof mapRows>} rows
 * @param {string} syncedDate - YYYY-MM-DD
 */
export function buildHearingJson(rows, syncedDate) {
    const entries = {};
    const aliasSets = new Map();   // equipId → Set of RAW alias strings (dedup must not re-split the joined display string)
    for (const row of rows) {
        const entry = entries[row.equipId] ??= { alias: '', comments: [] };
        if (row.alias) {
            const set = aliasSets.get(row.equipId) ?? new Set();
            set.add(row.alias);
            aliasSets.set(row.equipId, set);
            entry.alias = [...set].join(' / ');
        }
        if (row.review || row.notes) {
            entry.comments.push({ author: row.author, review: row.review, notes: row.notes });
        }
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
