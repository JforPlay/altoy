/**
 * check-data-shape.mjs
 * Build-time guard for the externally-generated public/data JSON.
 *
 * The data pipeline lives outside this repo (WSL) and tracks churning upstream game
 * configs. When an upstream field is renamed or removed, the JSON still parses fine —
 * the breakage only shows up later as a random `undefined` deep inside a page. This
 * guard turns that silent drift into a loud, early build failure by asserting that the
 * most-consumed files exist, parse, have the expected top-level shape, and carry a few
 * required keys on a sample record.
 *
 * Run: `npm run check:data` (also runs in `build` / `build:no-minify`, before data:split).
 * To extend: SAMPLE the file first (don't guess keys), then add a MANIFEST entry.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = resolve(SCRIPT_DIR, '..', 'public', 'data');

/**
 * @typedef {Object} ManifestEntry
 * @property {string} file - path relative to public/data
 * @property {'array'|'dict'|'object'} kind - array of records | id-keyed dict of records | flat object
 * @property {string[]} requireKeys - keys that must exist on a sample record ([] = only check non-empty)
 */

/** @type {ManifestEntry[]} */
export const MANIFEST = [
    { file: 'ship_info_lite.json',                 kind: 'array',  requireKeys: ['id', 'name', 'rarity', 'type'] },
    { file: 'ship_info_data.json',                 kind: 'array',  requireKeys: ['id', 'nationality', 'type', 'rarity'] },
    { file: 'activity_banner.json',                kind: 'dict',   requireKeys: ['id', 'pic', 'type'] },
    { file: 'kr_event_timeline.json',              kind: 'array',  requireKeys: ['ID', '이벤트명', '날짜'] },
    { file: 'retrofit_map.json',                   kind: 'dict',   requireKeys: ['grid', 'nodes'] },
    { file: 'equip/equip_data_full.json',          kind: 'dict',   requireKeys: ['id', 'name', 'rarity', 'type'] },
    { file: 'equip/equip_data_lite.json',          kind: 'array',  requireKeys: ['id', 'name', 'rarity', 'type'] },
    { file: 'sim/skill_weapon_data.json',          kind: 'dict',   requireKeys: ['name', 'skill_id'] },
    { file: 'island/island_item_data_template.json', kind: 'dict', requireKeys: ['id', 'name', 'icon'] },
    { file: 'island/tasks.json',                   kind: 'dict',   requireKeys: ['id', 'name'] },
    { file: 'skin/skin_poll_data.json',            kind: 'dict',   requireKeys: ['클뜯 id', '함순이 이름'] },
    { file: 'maps/map_data_full.json',             kind: 'dict',   requireKeys: ['id', 'name', 'chapter_name'] },
    { file: 'shipgirl/ship_build_sim_data.json',   kind: 'dict',   requireKeys: [] },
];

/**
 * Assert a sample record carries every required key.
 * @param {string} file @param {Object} sample @param {string[]} requireKeys @param {string} where
 * @returns {string|null}
 */
function checkKeys(file, sample, requireKeys, where) {
    const missing = requireKeys.filter((k) => !(k in sample));
    if (missing.length) {
        return `${file}: missing key(s) [${missing.join(', ')}] on ${where} — upstream schema may have changed; re-run the WSL pipeline (or update the MANIFEST in check-data-shape.mjs).`;
    }
    return null;
}

/**
 * Validate one parsed JSON value against a manifest entry. Pure (no I/O).
 * @param {ManifestEntry} entry
 * @param {*} parsed
 * @returns {string|null} error message, or null if OK
 */
export function validateOne(entry, parsed) {
    const { file, kind, requireKeys } = entry;

    if (kind === 'array') {
        if (!Array.isArray(parsed)) return `${file}: expected a JSON array, got ${typeof parsed}`;
        if (parsed.length === 0) return `${file}: array is empty`;
        return checkKeys(file, parsed[0], requireKeys, 'record[0]');
    }

    if (kind === 'dict') {
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return `${file}: expected a JSON object (dict), got ${Array.isArray(parsed) ? 'array' : typeof parsed}`;
        }
        const keys = Object.keys(parsed);
        if (keys.length === 0) return `${file}: object is empty`;
        const first = parsed[keys[0]];
        if (!first || typeof first !== 'object') return `${file}: first value (key "${keys[0]}") is not an object`;
        return checkKeys(file, first, requireKeys, `value["${keys[0]}"]`);
    }

    // flat object
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return `${file}: expected a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`;
    }
    return checkKeys(file, parsed, requireKeys, 'object');
}

/**
 * Read + validate every manifest file under dataDir.
 * @param {ManifestEntry[]} manifest
 * @param {string} dataDir
 * @returns {string[]} list of error messages (empty = all good)
 */
export function validateShape(manifest, dataDir) {
    const errors = [];
    for (const entry of manifest) {
        const p = join(dataDir, entry.file);
        if (!existsSync(p)) { errors.push(`${entry.file}: file not found at ${p}`); continue; }
        let parsed;
        try {
            parsed = JSON.parse(readFileSync(p, 'utf8'));
        } catch (e) {
            errors.push(`${entry.file}: JSON parse failed — ${e.message}`);
            continue;
        }
        const err = validateOne(entry, parsed);
        if (err) errors.push(err);
    }
    return errors;
}

// Run only when invoked directly (`node scripts/check-data-shape.mjs`), not when imported by tests.
const invokedDirectly = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
    const errors = validateShape(MANIFEST, DATA_DIR);
    if (errors.length) {
        console.error(`\n✗ data-shape check FAILED (${errors.length} issue${errors.length > 1 ? 's' : ''}):`);
        for (const e of errors) console.error('  - ' + e);
        process.exit(1);
    }
    console.log(`✓ data-shape check passed (${MANIFEST.length} critical files).`);
}
