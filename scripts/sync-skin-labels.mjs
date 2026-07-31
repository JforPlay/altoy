/**
 * sync-skin-labels.mjs
 * 스킨 특성 DB pipeline — three one-way channels joined by 클뜯 id:
 *
 *   1. Machine-fed: skin_labels_attributes.csv is written by dev/label-skins.mjs
 *      (kept out of the repo on purpose) and read here as the BASE label layer.
 *      This script never writes it.
 *   2. WHEN SHEET_ID IS SET: fetch the sheet's 라벨 tab as CSV — human
 *      corrections — and layer it on top.
 *   3. ALWAYS: write public/data/skin/skin_label_worklist.csv — the pre-joined
 *      feed (id, reason, name, image, current best values) that the sheet's
 *      bound Apps Script (scripts/skin-label-sheet.gs) appends rows from after
 *      deploy. All join logic lives HERE, node-tested; the sheet script only
 *      appends ids it does not have yet.
 *
 * The sheet's rows arrive pre-filled with the model's values, so a curator
 * only retypes cells that are WRONG; a blank cell still means "no opinion"
 * and falls through to the model layer, never erasing it. The 라벨 tab is the
 * ONLY human-edited surface, and nothing but this script writes
 * skin_labels.json.
 *
 * Run: `npm run data:skin-labels` [--allow-unknown]
 * Spec: dev/archive/skin-attribute-db/2026-07-26-skin-attribute-db-design.md
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
const SHEET_ID = '1lMrOgkusw3PucN5Wk1IKGPYslrG9_eXgYN-xhvasWho';
const LABEL_GID = '933499057';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const POLL_PATH = join(ROOT, 'public', 'data', 'skin', 'skin_poll_data.json');
const AUTO_PATH = join(ROOT, 'public', 'data', 'skin', 'skin_labels_attributes.csv');
const WORKLIST_PATH = join(ROOT, 'public', 'data', 'skin', 'skin_label_worklist.csv');
const OUT_PATH = join(ROOT, 'public', 'data', 'skin', 'skin_labels.json');

// ===== Channel 2: 라벨 tab → skin_labels.json =====

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

// ===== Channel 1 → the base layer =====

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
 * a blank → the model contradicted itself across one shipgirl. A 검수-ticked
 * entry leaves the queues even when a blank or conflict remains — a human
 * already looked, and that is the whole meaning of the flag.
 * @returns {{unlabelled: string[], incomplete: string[], conflicted: string[], all: string[]}}
 */
export function buildWorklist(entries, validIds, conflicts) {
    const num = (a, b) => Number(a) - Number(b);
    const unchecked = (id) => !entries[id]?.checked;
    const unlabelled = [...validIds].filter((id) => !(id in entries)).sort(num);
    const incomplete = Object.keys(entries)
        .filter((id) => unchecked(id) && ATTRIBUTES.some((a) => entries[id][a.key] === null)).sort(num);
    const conflicted = [...new Set(conflicts.flatMap((c) => Object.values(c.byValue).flat()))]
        .filter(unchecked).sort(num);
    const all = [...new Set([...unlabelled, ...incomplete, ...conflicted])].sort(num);
    return { unlabelled, incomplete, conflicted, all };
}

/** Feed column order — mirrored by FEED_HEADER in scripts/skin-label-sheet.gs. */
export const WORKLIST_FEED_HEADER = ['id', 'reason', 'name', 'image_url', ...ATTRIBUTES.map((a) => a.header)];

/**
 * Build skin_label_worklist.csv — the ONE file the sheet's Apps Script reads.
 * Pre-joined here so the sheet script stays a dumb appender: per worklist id,
 * why it needs a human (신규/공란/충돌, ·-joined when several), the skin name,
 * a wsrv-wrapped painting URL sized for IMAGE(), and the current best value of
 * every attribute (model + sibling inheritance) so the row lands pre-filled
 * and a curator only retypes what is wrong.
 *
 * Changing the columns means updating skin-label-sheet.gs too and re-pasting
 * it into the sheet — its refresh() aborts on a header mismatch by design.
 * @param {ReturnType<typeof buildWorklist>} work
 * @param {Record<string, object>} entries - merged, post-inheritance
 * @param {Record<string, object>} pollData
 * @returns {string}
 */
export function buildWorklistCsv(work, entries, pollData) {
    const byId = new Map(Object.values(pollData).map((s) => [String(s['클뜯 id']), s]));
    const queues = [
        ['신규', new Set(work.unlabelled)],
        ['공란', new Set(work.incomplete)],
        ['충돌', new Set(work.conflicted)],
    ];
    const lines = work.all.map((id) => {
        const skin = byId.get(id) ?? {};
        const reason = queues.filter(([, ids]) => ids.has(id)).map(([label]) => label).join('·');
        // The full painting — what the labeler actually saw. The shipyard crop
        // hides the lower body, which makes correct 자세/방향 labels look wrong
        // during review. wsrv flattens the alpha IMAGE() would render black.
        const painting = skin['전체 일러'] || skin['깔끔한 일러'] || '';
        const image = painting
            ? `https://wsrv.nl/?w=400&output=jpg&bg=white&url=${encodeURIComponent(painting)}`
            : '';
        const entry = entries[id] ?? {};
        const values = ATTRIBUTES.map((attr) => {
            const v = entry[attr.key];
            return v == null ? '' : Array.isArray(v) ? v.join(', ') : v;
        });
        return [id, reason, skin['한글 함순이 + 스킨 이름'] ?? '', image, ...values]
            .map(csvField).join(',');
    });
    return [WORKLIST_FEED_HEADER.join(','), ...lines].join('\n') + '\n';
}

async function main() {
    const allowUnknown = process.argv.includes('--allow-unknown');
    const poll = JSON.parse(readFileSync(POLL_PATH, 'utf8'));

    const validIds = new Set(Object.values(poll).map((s) => String(s['클뜯 id'])));
    const auto = parseAutoCsv(
        existsSync(AUTO_PATH) ? readFileSync(AUTO_PATH, 'utf8') : '', validIds,
    );
    const labelRows = await fetchLabelTab();
    if (!labelRows) console.log('SHEET_ID not configured — publishing model labels only (no human overrides).');
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
    console.log(`skin_labels.json written: ${next._meta.count} skins `
        + `(${next._meta.checked} 검수, +${d.added} added, ~${d.changed} changed, -${d.removed} removed)`);

    const overridden = Object.keys(human.entries)
        .filter((id) => ATTRIBUTES.some((a) => human.entries[id][a.key] !== null)).length;
    console.log(`  layers: ${Object.keys(auto.entries).length} model, ${overridden} sheet rows with values`
        + `, ${inherited} trait(s) inherited from siblings`);

    const conflicts = siblingConflicts(entries);
    const work = buildWorklist(entries, validIds, conflicts);
    writeFileSync(WORKLIST_PATH, buildWorklistCsv(work, entries, poll));
    console.log(`\nskin_label_worklist.csv written — ${work.all.length} skin(s) needing a human:`);
    console.log(`  ${work.unlabelled.length} 신규 (no labels at all)`);
    console.log(`  ${work.incomplete.length} 공란 (a blank attribute)`);
    console.log(`  ${work.conflicted.length} 충돌 (sibling disagreement, ${conflicts.length} conflicts)`);
    console.log('  after deploy, pull them into the sheet: ALtoy 메뉴 → 새로고침');

    // Conflicts are WARNINGS — a skin genuinely may change hair colour — so show
    // a sample for a feel and leave the rest to the sheet's 사유 column.
    for (const c of conflicts.slice(0, 10)) {
        const detail = Object.entries(c.byValue)
            .map(([v, ids]) => `${v} (${ids.join(', ')})`).join('  vs  ');
        console.log(`  gid ${c.gid} ${c.key}: ${detail}`);
    }
    if (conflicts.length > 10) console.log(`  … ${conflicts.length - 10} more — eyeball, never bulk-fix`);

    console.log('\nReminder: deploying this change needs the DATA_VERSION/CACHE_VERSION dual PATCH bump.');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    main().catch((err) => {
        console.error(err?.message ?? err);
        process.exit(1);
    });
}
