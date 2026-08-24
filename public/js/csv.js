/**
 * csv.js
 * RFC4180 CSV/TSV primitives shared by the Google-Sheet-backed data pipelines
 * (scripts/sync-equip-hearing, scripts/sync-skin-labels) AND the browser-side
 * shipgirl-tracker sheet codec. Pure and dependency-free — no I/O, no globals,
 * node-testable. Lives under public/js so the one implementation serves both
 * node scripts and the un-bundled browser tree.
 */

/**
 * Minimal RFC4180 parser (quoted fields, doubled quotes, embedded newlines).
 * Returns rows of string fields. CR outside quotes is ignored (CRLF input);
 * CR inside quotes is content.
 *
 * `delimiter` exists because a Google Sheets *copy* yields TSV while a Sheets
 * *download* yields CSV, and the tracker's import accepts both. It defaults to
 * ',' so the two node pipelines are unaffected.
 * @param {string} text @param {string} [delimiter] @returns {string[][]}
 */
export function parseCsv(text, delimiter = ',') {
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
        if (ch === delimiter) { row.push(field); field = ''; continue; }
        if (ch === '\r') continue;
        if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
        field += ch;
    }
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
}

/**
 * Index of a column by header name, ignoring whitespace. A curator sees "장비 id"
 * and "장비id" as the same column; the sheet is hand-edited, so that difference
 * has already broken a sync twice. Returns -1 when absent.
 * @param {string[]} header - the header row @param {string} name @returns {number}
 */
export function headerIndex(header, name) {
    const norm = (h) => (h ?? '').replace(/\s+/g, '');
    const want = norm(name);
    return header.findIndex((h) => norm(h) === want);
}

/**
 * Serialize one CSV field — quoted only when it contains a delimiter,
 * quote, or newline. @param {*} value @returns {string}
 */
export function csvField(value) {
    const s = String(value ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
