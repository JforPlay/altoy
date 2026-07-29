/**
 * sync-skin-labels.mjs
 * 스킨 특성 DB pipeline — three one-way channels joined by 클뜯 id:
 *
 *   1. ALWAYS: regenerate public/data/skin/skin_label_catalog.csv from
 *      skin_poll_data.json. The curators' Google Sheet IMPORTDATAs this file
 *      (after deploy) so its catalog tab self-refreshes.
 *   2. Machine-fed: skin_labels_attributes.csv is written by dev/label-skins.mjs
 *      (kept out of the repo on purpose) and read here as the BASE label layer.
 *      This script never writes it.
 *   3. WHEN SHEET_ID IS SET: fetch the sheet's 라벨 tab as CSV — a SPARSE sheet of
 *      human overrides — and layer it on top.
 *
 * Layering (most-trusted last) is what keeps per-skin upkeep near zero: a skin
 * the model already labelled needs no row anywhere, so the 라벨 tab only ever
 * holds rows a human actually touched, and a blank cell means "no opinion",
 * never "erase this". The 라벨 tab is still the ONLY human-edited surface, and
 * nothing but this script writes skin_labels.json.
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
const AUTO_PATH = join(ROOT, 'public', 'data', 'skin', 'skin_labels_attributes.csv');
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
    const header = 'id,shipgirl,skin,tag,category,shipyard_url,painting_url';
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
            // The full painting — what the labeler actually saw. The shipyard
            // crop hides the lower body, which makes correct 자세/방향 labels
            // look wrong during review.
            s['전체 일러'],
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
 * are dropped. That is what makes the 라벨 tab a sparse override sheet: a row
 * left untouched contributes nothing and the model's value survives underneath.
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

// ===== Channel 2 → the base layer =====

/**
 * Parse the labeler's CSV into the base entries map.
 *
 * Deliberately reuses the 라벨 tab's own mapper and validator: the auto CSV
 * carries the same Korean headers and the same vocabulary, so a value the model
 * emitted that the sheet would reject must fail here too rather than slip onto
 * the site through the back door. `allowUnknown` because a stale auto row for a
 * skin the game later removed is not worth failing a sync over — mergeLayers
 * drops it.
 * @param {string} text - skin_labels_attributes.csv contents
 * @param {Set<string>} validIds
 */
export function parseAutoCsv(text, validIds) {
    if (!text.trim()) return { errors: [], entries: {} };
    return validateRows(mapRows(parseCsv(text)), validIds, { allowUnknown: true });
}

/**
 * Layer the label sources into one entries map, most-trusted last: model CSV →
 * human override → 검수 flag. A human cell counts as an override ONLY when it
 * holds a value; blank means "no opinion", which is what lets the sheet stay
 * sparse and what makes a re-labelled column flow through untouched rows.
 *
 * Ids outside the catalog are dropped rather than errored — validateRows has
 * already reported any human row pointing at a skin that no longer exists.
 * Output is key-sorted numerically so the committed JSON diffs stay readable.
 * @param {Record<string, object>} autoEntries
 * @param {Record<string, object>} humanEntries
 * @param {Set<string>} validIds
 * @returns {Record<string, object>}
 */
export function mergeLayers(autoEntries, humanEntries, validIds) {
    const ids = [...new Set([...Object.keys(autoEntries), ...Object.keys(humanEntries)])]
        .filter((id) => validIds.has(id))
        .sort((a, b) => Number(a) - Number(b));

    const entries = {};
    for (const id of ids) {
        const auto = autoEntries[id] ?? {};
        const human = humanEntries[id] ?? {};
        const entry = {};
        for (const attr of ATTRIBUTES) entry[attr.key] = human[attr.key] ?? auto[attr.key] ?? null;
        entry.checked = human.checked === true;
        entries[id] = entry;
    }
    return entries;
}

/**
 * Fill still-null CHARACTER traits from the skin's siblings, in place.
 *
 * A new skin of an existing shipgirl shares her hair and eyes, so hand-labelling
 * it should not mean re-typing four values the dataset already holds. Gated on
 * the siblings agreeing UNANIMOUSLY, which is also what keeps genuinely per-skin
 * values (a 날개 that only one skin has) from spreading: one dissenting sibling
 * and the trait is left null for a human, and siblingConflicts reports it.
 * @param {Record<string, object>} entries @returns {number} traits filled
 */
export function inheritSiblingTraits(entries) {
    const groups = new Map();
    for (const id of Object.keys(entries)) {
        const gid = Math.floor(Number(id) / 10);
        if (!groups.has(gid)) groups.set(gid, []);
        groups.get(gid).push(id);
    }

    let filled = 0;
    for (const ids of groups.values()) {
        for (const key of CHARACTER_TRAIT_KEYS) {
            const distinct = new Map();
            for (const id of ids) {
                const value = entries[id][key];
                if (value === null || value === undefined) continue;
                distinct.set(traitKey(value), value);
            }
            if (distinct.size !== 1) continue;
            const [only] = distinct.values();
            for (const id of ids) {
                if (entries[id][key] !== null && entries[id][key] !== undefined) continue;
                entries[id][key] = Array.isArray(only) ? [...only] : only;
                filled++;
            }
        }
    }
    return filled;
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

/** Fetch the 라벨 tab as CSV. Returns [] rows when the sheet is not configured yet. */
async function fetchLabelTab() {
    if (!SHEET_ID) return null;
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${LABEL_GID}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`sheet fetch failed: HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    if (text.trimStart().startsWith('<')) {
        throw new Error('sheet fetch returned HTML, not CSV — is the sheet shared as "anyone with link can view"?');
    }
    return mapRows(parseCsv(text));
}

/**
 * Ids worth a human's time, most urgent first: no labels at all → the model left
 * a blank → the model contradicted itself across one shipgirl. Deduped, so a
 * skin in two queues is pasted once.
 * @returns {{unlabelled: string[], incomplete: string[], conflicted: string[], all: string[]}}
 */
export function buildWorklist(entries, validIds, conflicts) {
    const num = (a, b) => Number(a) - Number(b);
    const unlabelled = [...validIds].filter((id) => !(id in entries)).sort(num);
    const incomplete = Object.keys(entries)
        .filter((id) => ATTRIBUTES.some((a) => entries[id][a.key] === null)).sort(num);
    const conflicted = [...new Set(conflicts.flatMap((c) => Object.values(c.byValue).flat()))].sort(num);
    const all = [...new Set([...unlabelled, ...incomplete, ...conflicted])].sort(num);
    return { unlabelled, incomplete, conflicted, all };
}

async function main() {
    const allowUnknown = process.argv.includes('--allow-unknown');
    // --worklist puts the ids on stdout and the report on stderr, so
    // `node scripts/sync-skin-labels.mjs --worklist | clip` yields a clean paste.
    const worklistOnly = process.argv.includes('--worklist');
    const log = (...args) => (worklistOnly ? console.error(...args) : console.log(...args));
    const poll = JSON.parse(readFileSync(POLL_PATH, 'utf8'));

    writeFileSync(CATALOG_PATH, buildCatalogCsv(poll));
    log(`skin_label_catalog.csv regenerated (${Object.keys(poll).length} skins)`);

    const validIds = new Set(Object.values(poll).map((s) => String(s['클뜯 id'])));
    const auto = parseAutoCsv(
        existsSync(AUTO_PATH) ? readFileSync(AUTO_PATH, 'utf8') : '', validIds,
    );
    const labelRows = await fetchLabelTab();
    if (!labelRows) log('SHEET_ID not configured — publishing model labels only (no human overrides).');
    const human = validateRows(labelRows ?? [], validIds, { allowUnknown });

    const errors = [
        ...auto.errors.map((e) => `skin_labels_attributes.csv — ${e}`),
        ...human.errors.map((e) => `라벨 tab — ${e}`),
    ];
    if (errors.length) {
        console.error('validation failed:\n  - ' + errors.join('\n  - '));
        process.exit(1);
    }

    const entries = mergeLayers(auto.entries, human.entries, validIds);
    const inherited = inheritSiblingTraits(entries);

    const next = buildLabelsJson(entries, new Date().toISOString().slice(0, 10));
    const prev = existsSync(OUT_PATH)
        ? JSON.parse(readFileSync(OUT_PATH, 'utf8'))
        : { entries: {} };
    const d = diffSummary(prev.entries ?? {}, next.entries);
    writeFileSync(OUT_PATH, JSON.stringify(next, null, 2) + '\n');
    log(`skin_labels.json written: ${next._meta.count} skins `
        + `(${next._meta.checked} 검수, +${d.added} added, ~${d.changed} changed, -${d.removed} removed)`);

    const overridden = Object.keys(human.entries)
        .filter((id) => ATTRIBUTES.some((a) => human.entries[id][a.key] !== null)).length;
    log(`  layers: ${Object.keys(auto.entries).length} model, ${overridden} human-overridden`
        + `, ${inherited} trait(s) inherited from siblings`);

    const conflicts = siblingConflicts(entries);
    const work = buildWorklist(entries, validIds, conflicts);
    log(`\nneeds a human — ${work.all.length} skin(s):`);
    log(`  ${work.unlabelled.length} with no labels at all (hand-label these)`);
    log(`  ${work.incomplete.length} with a blank attribute`);
    log(`  ${work.conflicted.length} in a sibling conflict (${conflicts.length} disagreements)`);
    log('  --worklist prints the ids: `node scripts/sync-skin-labels.mjs --worklist | clip`');

    // The unlabelled queue prints unconditionally: it is the only one that can
    // reach the site as a skin with NO attributes, and after a data refresh it
    // is normally short enough to paste straight from here.
    if (work.unlabelled.length) {
        log(`\nno labels — paste into 라벨 column A, then fill the dropdowns:`);
        log(work.unlabelled.slice(0, 50).join('\n'));
        if (work.unlabelled.length > 50) log(`… and ${work.unlabelled.length - 50} more (use --worklist)`);
    }

    // Conflicts are WARNINGS — a skin genuinely may change hair colour — so show
    // a sample for a feel and leave the rest to the worklist.
    for (const c of conflicts.slice(0, 10)) {
        const detail = Object.entries(c.byValue)
            .map(([v, ids]) => `${v} (${ids.join(', ')})`).join('  vs  ');
        log(`  gid ${c.gid} ${c.key}: ${detail}`);
    }
    if (conflicts.length > 10) log(`  … ${conflicts.length - 10} more — eyeball, never bulk-fix`);

    if (worklistOnly) console.log(work.all.join('\n'));
    log('\nReminder: deploying this change needs the DATA_VERSION/CACHE_VERSION dual PATCH bump.');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    main().catch((err) => {
        console.error(err?.message ?? err);
        process.exit(1);
    });
}
