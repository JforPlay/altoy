/**
 * sync-skin-labels.mjs
 * 스킨 특성 DB pipeline — three one-way channels joined by 클뜯 id:
 *
 *   1. ALWAYS: regenerate public/data/skin/skin_label_catalog.csv from
 *      skin_poll_data.json. The curators' Google Sheet IMPORTDATAs this file
 *      (after deploy) so its catalog tab self-refreshes.
 *   2. Machine-fed: skin_labels_attributes.csv is written by dev/label-skins.mjs (kept
 *      out of the repo on purpose) and IMPORTDATA'd into the sheet's `auto` tab.
 *      This script never writes it.
 *   3. WHEN SHEET_ID IS SET: fetch the sheet's 라벨 tab as CSV, validate against
 *      the vocabulary, and write public/data/skin/skin_labels.json.
 *
 * The 라벨 tab is the ONLY human-edited surface and the only tab this script
 * reads; nothing but this script writes skin_labels.json — so model output,
 * game data and human input can never clobber each other.
 *
 * Run: `npm run data:skin-labels` [--allow-unknown]
 * Spec: dev/active/2026-07-26-skin-attribute-db-design.md
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseCsv, csvField, headerIndex } from './csv.mjs';
import {
    ATTRIBUTES, ID_HEADER, CHECKED_HEADER, CHARACTER_TRAIT_KEYS, parseAttributeCell,
} from './skin-attributes.mjs';

// Curator config: fill in after creating the sheet (File → Share → anyone with
// link = viewer). LABEL_GID = the gid= URL param of the 라벨 tab. While these are
// empty the script still regenerates the catalog CSV and skips the sheet fetch.
const SHEET_ID = '';
const LABEL_GID = '';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const POLL_PATH = join(ROOT, 'public', 'data', 'skin', 'skin_poll_data.json');
const CATALOG_PATH = join(ROOT, 'public', 'data', 'skin', 'skin_label_catalog.csv');
const OUT_PATH = join(ROOT, 'public', 'data', 'skin', 'skin_labels.json');

// ===== Channel 1: catalog CSV for the sheet's IMPORTDATA tab =====

/**
 * Build skin_label_catalog.csv text from skin_poll_data.json entries.
 * COLUMN ORDER IS A CONTRACT — the sheet's VLOOKUP/IMAGE formulas index into
 * it. Append-only; never reorder. Rows are sorted by numeric id so the file is
 * stable across regenerations and its diffs stay readable.
 * @param {Record<string, object>} pollData @returns {string}
 */
export function buildCatalogCsv(pollData) {
    const header = 'id,shipgirl,skin,tag,category,shipyard_url';
    const lines = Object.values(pollData)
        .slice()
        .sort((a, b) => Number(a['클뜯 id']) - Number(b['클뜯 id']))
        .map((s) => [
            s['클뜯 id'],
            s['함순이 이름'],
            s['한글 함순이 + 스킨 이름'],
            s['스킨 태그'],
            s['스킨 타입 - 한글'],
            s['깔끔한 일러'],
        ].map(csvField).join(','));
    return [header, ...lines].join('\n') + '\n';
}

// ===== Channel 3: 라벨 tab → skin_labels.json =====

/**
 * Map raw CSV rows to row objects BY HEADER NAME, not position — so curators may
 * add, reorder and remove display columns (아이콘, 이름, 메모 …) freely without
 * breaking the sync. Values are returned raw; parsing happens in validateRows.
 *
 * Rows carrying no information (no id, or no attribute values and not checked)
 * are dropped, which keeps the output JSON sparse even though the sheet has one
 * pre-populated row per skin.
 * @param {string[][]} rows - parseCsv output including the header row
 * @returns {Array<{skinId: string, raw: Record<string,string>, checked: boolean}>}
 */
export function mapRows(rows) {
    if (!rows.length) throw new Error('라벨 CSV is empty (no header row)');
    const header = rows[0].map((h) => h.trim());
    const idIdx = headerIndex(header, ID_HEADER);
    if (idIdx === -1) {
        throw new Error(`라벨 CSV must have a "${ID_HEADER}" column (got: ${header.join(', ')})`);
    }
    const checkedIdx = headerIndex(header, CHECKED_HEADER);
    const attrIdx = ATTRIBUTES.map((attr) => headerIndex(header, attr.header));

    return rows.slice(1)
        .map((cols) => {
            // An id cell may hold an "id — name" composite; the id is the leading
            // digits. Values with no digit prefix pass through so validateRows flags them.
            const idCell = (cols[idIdx] ?? '').trim();
            const idMatch = idCell.match(/^\d+/);
            const raw = {};
            ATTRIBUTES.forEach((attr, i) => {
                raw[attr.key] = attrIdx[i] === -1 ? '' : (cols[attrIdx[i]] ?? '').trim();
            });
            const checkedCell = checkedIdx === -1 ? '' : (cols[checkedIdx] ?? '').trim();
            return {
                skinId: idMatch ? idMatch[0] : idCell,
                raw,
                checked: checkedCell.toLowerCase() === 'true',
            };
        })
        .filter((r) => r.skinId)
        .filter((r) => r.checked || ATTRIBUTES.some((attr) => r.raw[attr.key]));
}

/**
 * Validate mapped rows against the vocabulary and the catalog id set, producing
 * the entries map. Hard-fail philosophy: a typo must not silently drop a label,
 * so every problem is collected and reported rather than skipped.
 *
 * `allowUnknown` keeps rows whose skin vanished from the catalog — the data is
 * preserved, the site simply won't render an entry it cannot join.
 * @param {ReturnType<typeof mapRows>} rows
 * @param {Set<string>} validIds - String(클뜯 id) set from skin_poll_data.json
 * @param {{allowUnknown?: boolean}} [opts]
 * @returns {{errors: string[], entries: Record<string, object>}}
 */
export function validateRows(rows, validIds, { allowUnknown = false } = {}) {
    const errors = [];
    const entries = {};
    const seen = new Set();
    const unknown = new Set();

    for (const row of rows) {
        if (!/^\d+$/.test(row.skinId)) {
            errors.push(`invalid 클뜯 id "${row.skinId}"`);
            continue;
        }
        if (seen.has(row.skinId)) errors.push(`duplicate 클뜯 id ${row.skinId}`);
        seen.add(row.skinId);
        if (!validIds.has(row.skinId)) unknown.add(row.skinId);

        const entry = {};
        let rowOk = true;
        for (const attr of ATTRIBUTES) {
            const { value, error } = parseAttributeCell(attr, row.raw[attr.key]);
            if (error) { errors.push(`${row.skinId} — ${error}`); rowOk = false; continue; }
            entry[attr.key] = value;
        }
        if (!rowOk) continue;
        entry.checked = row.checked;
        entries[row.skinId] = entry;
    }

    if (unknown.size && !allowUnknown) {
        errors.push(`unknown 클뜯 id(s) not in skin_poll_data.json: ${[...unknown].join(', ')}`
            + ' (re-run with --allow-unknown to keep them)');
    }
    return { errors, entries };
}

/**
 * Map validated entries into the skin_labels.json shape.
 * `_meta` deliberately carries NO model name: this script never runs the model
 * and so cannot know it. Which model produced a given label is recoverable from
 * skin_labels_attributes.csv's git history.
 * @param {Record<string, object>} entries
 * @param {string} syncedDate - YYYY-MM-DD
 */
export function buildLabelsJson(entries, syncedDate) {
    const ids = Object.keys(entries);
    return {
        _meta: {
            synced: syncedDate,
            count: ids.length,
            checked: ids.filter((id) => entries[id].checked).length,
        },
        entries,
    };
}

/**
 * Per-skin change counts between two entries maps, for the sync run report.
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

/** Stable comparison key for a trait value; arrays compare order-insensitively. */
function traitKey(value) {
    return Array.isArray(value) ? JSON.stringify([...value].sort()) : String(value);
}

/**
 * Free QC with no extra model calls: hairColor / hairMultiTone / eyeColor /
 * beastFeatures describe the CHARACTER, so every skin of one shipgirl should
 * agree. Group by gid (floor(clientId / 10) — the repo-wide skin id convention)
 * and report each trait whose value differs across a group.
 *
 * This turns "review 2,406 rows" into "review the few dozen that contradict
 * themselves". Genuine per-skin hair-colour changes DO exist, so a conflict is a
 * WARNING to look at, never an automatic correction. Nulls are skipped — an
 * unlabelled sibling is missing data, not disagreement.
 * @param {Record<string, object>} entries
 * @returns {Array<{gid: number, key: string, byValue: Record<string, string[]>}>}
 */
export function siblingConflicts(entries) {
    const groups = new Map();
    for (const id of Object.keys(entries)) {
        const gid = Math.floor(Number(id) / 10);
        if (!groups.has(gid)) groups.set(gid, []);
        groups.get(gid).push(id);
    }

    const conflicts = [];
    for (const [gid, ids] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
        if (ids.length < 2) continue;
        for (const key of CHARACTER_TRAIT_KEYS) {
            const byValue = {};
            for (const id of ids.slice().sort()) {
                const value = entries[id][key];
                if (value === null || value === undefined) continue;
                const k = traitKey(value);
                (byValue[k] ??= []).push(id);
            }
            if (Object.keys(byValue).length > 1) conflicts.push({ gid, key, byValue });
        }
    }
    return conflicts;
}

// ===== CLI =====

async function main() {
    const allowUnknown = process.argv.includes('--allow-unknown');
    const poll = JSON.parse(readFileSync(POLL_PATH, 'utf8'));

    writeFileSync(CATALOG_PATH, buildCatalogCsv(poll));
    console.log(`skin_label_catalog.csv regenerated (${Object.keys(poll).length} skins)`);

    if (!SHEET_ID) {
        console.log('SHEET_ID not configured — skipped label sync (skin_labels.json unchanged).');
        return;
    }
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${LABEL_GID}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`sheet fetch failed: HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    if (text.trimStart().startsWith('<')) {
        throw new Error('sheet fetch returned HTML, not CSV — is the sheet shared as "anyone with link can view"?');
    }

    const rows = mapRows(parseCsv(text));
    const validIds = new Set(Object.values(poll).map((s) => String(s['클뜯 id'])));
    const { errors, entries } = validateRows(rows, validIds, { allowUnknown });
    if (errors.length) {
        console.error('validation failed:\n  - ' + errors.join('\n  - '));
        process.exit(1);
    }

    const next = buildLabelsJson(entries, new Date().toISOString().slice(0, 10));
    const prev = existsSync(OUT_PATH)
        ? JSON.parse(readFileSync(OUT_PATH, 'utf8'))
        : { entries: {} };
    const d = diffSummary(prev.entries ?? {}, next.entries);
    writeFileSync(OUT_PATH, JSON.stringify(next, null, 2) + '\n');
    console.log(`skin_labels.json written: ${next._meta.count} skins `
        + `(${next._meta.checked} 검수, +${d.added} added, ~${d.changed} changed, -${d.removed} removed)`);

    const conflicts = siblingConflicts(entries);
    if (conflicts.length) {
        console.log(`\n${conflicts.length} sibling conflict(s) — same shipgirl, disagreeing character trait:`);
        for (const c of conflicts) {
            const detail = Object.entries(c.byValue)
                .map(([v, ids]) => `${v} (${ids.join(', ')})`).join('  vs  ');
            console.log(`  gid ${c.gid} ${c.key}: ${detail}`);
        }
        console.log('These are WARNINGS — a skin genuinely may change hair colour. Eyeball, do not bulk-fix.');
    }
    console.log('\nReminder: deploying this change needs the DATA_VERSION/CACHE_VERSION dual PATCH bump.');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    main().catch((err) => {
        console.error(err?.message ?? err);
        process.exit(1);
    });
}
