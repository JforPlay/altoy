/**
 * tracker-sheet-codec.js
 * Pure sheet → site import codec for /shipgirl/shipgirl-tracker. No DOM, no
 * storage, no fetch — node-tested (tests/shipgirl/tracker-sheet-codec.test.mjs).
 *
 * Reads the user's Google Sheet (pasted as TSV, or uploaded as CSV) and turns
 * each row into `{ gid, mask, inv }` for the two tracker stores. Rows are joined
 * to ships BY ID ONLY; the 이름 column is used to *validate* that join and never
 * to make one, because names drift across sources in ways that fuzzy-match to
 * the wrong ship (the site-wide rule — see CLAUDE.md "Shipgirl name matching").
 *
 * Columns are located BY HEADER NAME, so the sheet's display columns (사진,
 * 레어도, 함종 …) and its trailing computed-score block (획득 기술점수, six
 * duplicate 적용 함종 headers, 120 점수 …) are ignored at no cost, and the
 * curator may reorder or add columns freely.
 *
 * A blank cell means "no opinion" and leaves that field untouched — it never
 * erases. That matters for 개장 여부, which the sheet deliberately leaves empty
 * for ships that cannot be retrofitted.
 */

import { parseCsv, headerIndex } from '../csv.js';
import { normalizeRomanNumerals } from '../utils.js';
import { MEMO_MAX } from './tracker-investment.js';

// ===== Sheet vocabulary =====

// The codec owns its vocabulary rather than importing AFF_LABELS/SKL_LABELS.
// Those are UI chip text and exist to be re-worded; the file format must not
// change when a chip does. They happen to agree today — deliberately so.
export const SHEET_PROGRESS = ['미획득', '획득', '풀돌', '120', '125'];
export const SHEET_AFF = ['호감작 안함', '100 예정', '100 완료', '200 예정', '200 완료'];
export const SHEET_SKL = ['스작 안함', '스작 예정', '스작 진행중', '스작 완료'];

// Wording the site's chips used before the vocabulary was aligned to the sheet.
// Accepted on read so a file exported from an older build still imports.
const LEGACY_AFF = ['호감작'];
const LEGACY_SKL = ['스작', '스작 예정', '스작 중', '스작 완료'];

// Progress ladder → the FROZEN 3-bit mask (get=1, level=2, upgrade=4, shared
// with research-tracker/fleet-sim) plus the cap it implies.
const GET = 1, LEVEL = 2, UPGRADE = 4;
const PROGRESS_STATE = [
    { mask: 0, cap: 0 },                        // 미획득
    { mask: GET, cap: 0 },                      // 획득
    { mask: GET | UPGRADE, cap: 0 },            // 풀돌
    { mask: GET | UPGRADE | LEVEL, cap: 4 },    // 120
    { mask: GET | UPGRADE | LEVEL, cap: 5 },    // 125
];

// Sheet ID prefixes → dex band offset. Plain digits are the dex id as-is.
const ID_BANDS = { Z: 10000, P: 20000, M: 30000 };

/**
 * Columns the codec reads. `needle` is matched against whitespace-stripped
 * headers, exact first then by prefix — the memo header carries a long
 * parenthetical ("자유 코멘트 (입수처 등) / (메모 필요하면…)") that only a prefix
 * match survives.
 */
const COLUMNS = {
    id: 'ID',
    name: '이름',
    ret: '개장여부',
    fav: '즐겨찾기',
    progress: '획득/육성여부',
    skl: '스작여부',
    aff: '호감작여부',
    memo: '자유코멘트',
};

// ===== Primitives =====

const squash = (s) => String(s ?? '').replace(/\s+/g, '');

/**
 * Pick the delimiter from the header line: a Google Sheets *copy* is TSV, a
 * Sheets *download* is CSV. Only the header line is counted, and complete
 * quoted spans are removed first, so a memo full of commas cannot make a TSV
 * file look comma-separated.
 * @param {string} text @returns {string} '\t' or ','
 */
export function sniffDelimiter(text) {
    const head = String(text ?? '').split('\n')[0].replace(/"[^"]*"/g, '');
    const tabs = (head.match(/\t/g) || []).length;
    const commas = (head.match(/,/g) || []).length;
    return tabs > commas ? '\t' : ',';
}

/**
 * Sheet ID → dex id. Plain digits pass through; Z/P/M offset into the collab,
 * PR and META bands. Returns null for anything else rather than guessing —
 * a coerced id would silently write another ship's row.
 * @param {string} raw @returns {number|null}
 */
export function parseSheetId(raw) {
    const s = String(raw ?? '').trim();
    if (/^\d+$/.test(s)) return Number(s);
    const m = /^([ZPM])\s*(\d+)$/i.exec(s);
    return m ? ID_BANDS[m[1].toUpperCase()] + Number(m[2]) : null;
}

/**
 * Fold a ship name to a comparison key. Used ONLY to validate an ID join.
 * Handles the four differences that are real between this sheet and the roster:
 * (META) vs ·META, micro sign vs Greek mu, ASCII vs composed roman numerals,
 * and whitespace.
 * @param {string} name @returns {string}
 */
export function foldShipName(name) {
    if (!name) return '';
    const unified = String(name)
        .replace(/µ/g, 'μ')                  // µ micro sign → μ Greek mu
        .replace(/[(（]\s*META\s*[)）]/gi, '·META');
    return squash(normalizeRomanNumerals(unified)).toLowerCase();
}

/** Build normalized value → index maps for one ladder, newest wording first. */
function ladder(...vocabularies) {
    const map = new Map();
    for (const vocab of vocabularies) {
        vocab.forEach((label, i) => {
            const key = squash(label).toLowerCase();
            if (!map.has(key)) map.set(key, i);
        });
    }
    return map;
}

const PROGRESS_INDEX = ladder(SHEET_PROGRESS);
const AFF_INDEX = ladder(SHEET_AFF, LEGACY_AFF);
const SKL_INDEX = ladder(SHEET_SKL, LEGACY_SKL);

/** Locate a column by header name — exact match, then prefix. -1 if absent. */
function findColumn(header, needle) {
    const exact = headerIndex(header, needle);
    if (exact !== -1) return exact;
    const want = squash(needle).toLowerCase();
    return header.findIndex((h) => squash(h).toLowerCase().startsWith(want));
}

// ===== Parse =====

/**
 * Parse a pasted or uploaded sheet into per-ship import records.
 *
 * @param {string} text - raw CSV or TSV
 * @param {{ships: Array<{id:number, gid:number, name:string}>}} opts
 *   `ships` is ship_info_lite.json — it carries the dex id → gid pairs for all 881.
 * @returns {{
 *   ok: boolean, error?: string, delimiter?: string,
 *   columns?: string[], ignoredColumns?: string[],
 *   matched?: Array<{gid:number, dex:number, sheetId:string, sheetName:string,
 *                    siteName:string, nameMismatch:boolean,
 *                    mask:number|null, inv:object}>,
 *   rejected?: Array<{line:number, sheetId:string, sheetName:string, reason:string}>,
 *   duplicates?: Array<{line:number, sheetId:string, sheetName:string}>,
 * }}
 */
export function parseSheet(text, { ships } = {}) {
    const raw = String(text ?? '').trim();
    if (!raw) return { ok: false, error: '내용이 비어 있습니다.' };

    const delimiter = sniffDelimiter(text);
    const rows = parseCsv(String(text), delimiter);
    if (!rows.length) return { ok: false, error: '내용이 비어 있습니다.' };

    const header = rows[0];
    const at = {};
    for (const [key, needle] of Object.entries(COLUMNS)) at[key] = findColumn(header, needle);
    if (at.id === -1) {
        return { ok: false, error: 'ID 열을 찾을 수 없습니다. 시트의 머리글 행이 포함되어 있는지 확인해 주세요.' };
    }

    const claimed = new Set(Object.values(at).filter((i) => i !== -1));
    const ignoredColumns = [...new Set(
        header.map((h, i) => (claimed.has(i) ? null : squash(h))).filter(Boolean),
    )];

    const byDex = new Map((ships || []).map((s) => [s.id, s]));
    const cell = (row, key) => (at[key] === -1 ? '' : String(row[at[key]] ?? '').trim());

    const matched = [];
    const rejected = [];
    const duplicates = [];
    const seen = new Map();

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const line = i + 1;
        const sheetId = cell(row, 'id');
        const sheetName = cell(row, 'name');

        // Sheets carry spacer/blank rows; skipping them silently keeps the
        // rejection list about real problems.
        if (!sheetId && !sheetName) continue;

        const reject = (reason) => rejected.push({ line, sheetId, sheetName, reason });

        if (!sheetId) { reject('ID가 비어 있습니다.'); continue; }
        const dex = parseSheetId(sheetId);
        if (dex === null) { reject(`ID 형식을 알 수 없습니다: ${sheetId}`); continue; }
        const ship = byDex.get(dex);
        if (!ship) { reject(`ID ${sheetId}에 해당하는 함순이를 찾을 수 없습니다.`); continue; }

        // Every field below is optional: an absent column or a blank cell means
        // "no opinion" and leaves the stored value untouched.
        const inv = {};
        let mask = null;
        let bad = null;

        const progress = cell(row, 'progress');
        if (progress) {
            const idx = PROGRESS_INDEX.get(squash(progress).toLowerCase());
            if (idx === undefined) bad = `획득/육성 여부 값을 알 수 없습니다: ${progress}`;
            else { mask = PROGRESS_STATE[idx].mask; inv.cap = PROGRESS_STATE[idx].cap; }
        }

        for (const [key, index, label] of [['skl', SKL_INDEX, '스작'], ['aff', AFF_INDEX, '호감작']]) {
            if (bad) break;
            const value = cell(row, key);
            if (!value) continue;
            const idx = index.get(squash(value).toLowerCase());
            if (idx === undefined) bad = `${label} 여부 값을 알 수 없습니다: ${value}`;
            else inv[key] = idx;
        }

        for (const [key, label] of [['ret', '개장'], ['fav', '즐겨찾기']]) {
            if (bad) break;
            const value = cell(row, key).toUpperCase();
            if (!value) continue;
            if (value === 'O') inv[key] = 1;
            else if (value === 'X') inv[key] = 0;
            else bad = `${label} 여부는 O 또는 X여야 합니다: ${value}`;
        }

        if (bad) { reject(bad); continue; }

        const memo = at.memo === -1 ? '' : String(row[at.memo] ?? '');
        if (memo.trim()) inv.memo = memo.slice(0, MEMO_MAX);

        const record = {
            gid: ship.gid,
            dex,
            sheetId,
            sheetName,
            siteName: ship.name,
            nameMismatch: Boolean(sheetName) && foldShipName(sheetName) !== foldShipName(ship.name),
            mask,
            inv,
        };

        // A repeated id is a hand-edit slip; the last row wins (it is the one the
        // curator most likely just typed) but the collision is surfaced.
        if (seen.has(ship.gid)) {
            duplicates.push({ line, sheetId, sheetName });
            matched[seen.get(ship.gid)] = record;
        } else {
            seen.set(ship.gid, matched.length);
            matched.push(record);
        }
    }

    return { ok: true, delimiter, columns: header, ignoredColumns, matched, rejected, duplicates };
}

/**
 * Fold parsed rows onto the current store state, returning fresh objects for
 * the tracker's existing whole-store-replaced paths (the same shape those
 * stores already receive from a cross-tab sync).
 *
 * @param {Array} matched - parseSheet().matched
 * @param {{progress: object, investment: object}} current
 * @returns {{progress: object, investment: object, changed: number}}
 */
export function applyToStores(matched, { progress = {}, investment = {} } = {}) {
    const nextProgress = { ...progress };
    const nextInvestment = { ...investment };
    let changed = 0;

    // Both stores are SPARSE by contract: collectProgressFromCards omits zero
    // masks and setInv drops falsy fields, deleting a record that empties out.
    // An 881-row import that wrote {cap:0,fav:0,skl:0,aff:0} per ship would push
    // tens of KB of pure defaults through localStorage and Drive sync.
    const state = (gid) => JSON.stringify([nextProgress[gid] ?? 0, nextInvestment[gid] ?? null]);
    // Gids whose stored state actually moved. The caller re-renders only these
    // cards: re-rendering all 881 costs ~2.8s of browser layout/paint, and a
    // re-import of an unchanged sheet should cost nothing. Strings, to compare
    // directly against card.dataset.shipId.
    const changedGids = [];

    for (const row of matched) {
        const before = state(row.gid);

        if (row.mask !== null) {
            if (row.mask) nextProgress[row.gid] = row.mask;
            else delete nextProgress[row.gid];
        }

        if (Object.keys(row.inv).length) {
            const merged = {};
            for (const [k, v] of Object.entries({ ...(nextInvestment[row.gid] || {}), ...row.inv })) {
                if (v) merged[k] = v;
            }
            if (Object.keys(merged).length) nextInvestment[row.gid] = merged;
            else delete nextInvestment[row.gid];
        }

        if (state(row.gid) !== before) { changed++; changedGids.push(String(row.gid)); }
    }

    return { progress: nextProgress, investment: nextInvestment, changed, changedGids };
}
