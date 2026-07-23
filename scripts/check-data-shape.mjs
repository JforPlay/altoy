/**
 * check-data-shape.mjs
 * Build-time guard for the externally-generated public/data JSON.
 *
 * The data pipeline lives outside this repo (WSL) and tracks churning upstream game
 * configs. When an upstream field is renamed, removed, or changes type, the JSON still
 * parses fine — the breakage only shows up later as a random `undefined` deep inside a
 * page. This guard turns that silent drift into a loud, early build failure by asserting
 * that the most-consumed files exist, parse, have the expected container kind, and that
 * sampled records carry the expected fields with the expected types.
 *
 * Run: `npm run check:data` (also runs in `build` / `build:no-minify`, before data:split).
 *
 * Field spec grammar (values in a MANIFEST entry's `fields` map):
 *   'string'         — field must exist and be a string on every sampled record
 *   'number|null'    — unions with `|`; types: string number boolean array object null
 *   'string?'        — trailing `?` = optional: may be absent, but must type-match when present
 *
 * To add or refresh a contract, NEVER guess keys — derive from the real file:
 *   node scripts/check-data-shape.mjs --describe <file-relative-to-public/data>
 * scans EVERY record and prints per-key presence % + observed types + a ready-to-paste
 * `fields` literal (100%-presence keys exact, sparse keys suffixed `?`).
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = resolve(SCRIPT_DIR, '..', 'public', 'data');

/** How many records get field-checked per file (first + last + evenly spaced between). */
const SAMPLE_COUNT = 5;

/**
 * @typedef {Object} ManifestEntry
 * @property {string} file - path relative to public/data
 * @property {'array'|'dict'|'object'} kind - array of records | id-keyed dict of records | flat object
 * @property {Object<string,string>} fields - field name → type spec (see grammar in header)
 */

/**
 * Contracts below were generated with `--describe` on 2026-06-10 and lightly pruned:
 * sub-1% outlier keys dropped; everything else kept (optional `?` fields are
 * type-checked when present, so they guard against type drift but not renames).
 * @type {ManifestEntry[]}
 */
export const MANIFEST = [
    { file: 'ship_info_lite.json', kind: 'array', fields: {
        'gid': 'number',
        'heavy': 'boolean',
        'id': 'number',
        'light': 'boolean',
        'limited': 'boolean',
        'maps': 'array',
        'name': 'string',
        'nationality': 'number',
        'rarity': 'string',
        'shipyard': 'string',
        'special': 'boolean',
        'timer': 'string|null',
        'type': 'number',
    } },
    { file: 'ship_info_data.json', kind: 'array', fields: {
        'armor': 'number',
        'base': 'object',
        'base_list': 'object',
        'description': 'array',
        'enhance': 'object',
        'equip_1': 'array',
        'equip_2': 'array',
        'equip_3': 'array',
        'equip_4': 'array',
        'equip_5': 'array',
        'equipment_proficiency': 'array',
        'equipment_proficiency_base': 'array',
        'gid': 'number',
        'gift_dislike': 'array|string',
        'growth': 'object',
        'heavy': 'boolean',
        'id': 'number',
        'light': 'boolean',
        'limited': 'boolean',
        'name': 'string',
        'nationality': 'number',
        'preload_count': 'array',
        'rarity': 'string',
        'shipyard': 'string',
        'sid': 'number',
        'skill': 'object',
        'skin_id': 'number',
        'special': 'boolean',
        'timer': 'string|null',
        'type': 'number',
        'class_name': 'string?',
        'sp_weapon': 'object?',
        'maps': 'array?',
        'retrofit': 'object?',
    } },
    { file: 'activity_banner.json', kind: 'dict', fields: {
        'id': 'number',
        'param': 'array|string',
        'pic': 'string',
        'time': 'array|string',
        'type': 'number',
    } },
    { file: 'kr_event_timeline.json', kind: 'array', fields: {
        'ID': 'string',
        '날짜': 'string',
        '무딱 이벤?': 'string',
        '복각여부': 'string',
        '분류': 'string',
        '이벤트명': 'string',
        '임무 보상': 'string',
        '진영': 'string',
        '함순이': 'string',
        '원본ID': 'string?',
        '링크': 'string?',
    } },
    { file: 'retrofit_map.json', kind: 'dict', fields: {
        'grid': 'object',
        'nodes': 'array',
    } },
    { file: 'equip/equip_data_full.json', kind: 'dict', fields: {
        'ammo': 'number',
        'ammo_icon': 'array',
        'ammo_info': 'array',
        'attr_info': 'array',
        'compare_group': 'number',
        'descrip': 'string',
        'equip_info': 'array',
        'equip_parameters': 'object',
        'icon': 'string',
        'id': 'number',
        'label': 'array',
        'levels': 'array',
        'name': 'string',
        'nation_code': 'string',
        'nation_image': 'string',
        'nation_name': 'string',
        'nationality': 'number',
        'part_main': 'array',
        'part_sub': 'array',
        'rarity': 'number',
        'rarity_name': 'string',
        'speciality': 'string',
        'tech': 'number',
        'torpedo_ammo': 'number',
        'type': 'number',
        'type_name': 'string',
        'type_name2': 'string',
    } },
    { file: 'equip/equip_data_lite.json', kind: 'array', fields: {
        'attrs': 'array',
        'compare_group': 'number',
        'icon': 'string',
        'id': 'number',
        'label': 'array',
        'level_count': 'number',
        'max_attrs': 'array',
        'name': 'string',
        'nation_code': 'string',
        'nation_name': 'string',
        'nationality': 'number',
        'rarity': 'number',
        'rarity_name': 'string',
        'speciality': 'string',
        'tech': 'number',
        'type': 'number',
        'type_name': 'string',
        'type_name2': 'string',
    } },
    { file: 'sim/skill_weapon_data.json', kind: 'dict', fields: {
        'icon': 'string',
        'name': 'string',
        'position': 'string',
        'shipyard': 'string',
        'skill_id': 'number',
        'weapon_true': 'boolean',
        '1': 'object?',
        '10': 'object?',
        'aniEffect': 'object|string?',
        'requirement': 'string?',
        'class_name': 'string?',
        'attached_weapon_skill_id': 'array?',
        'trigger_cd': 'number?',
        'cross_fleet': 'boolean?',
    } },
    { file: 'island/island_item_data_template.json', kind: 'dict', fields: {
        'convert': 'number',
        'desc': 'string',
        'drop_after_use': 'number',
        'filter': 'array',
        'group_max': 'number',
        'have_max': 'number',
        'icon': 'string',
        'icon_normal': 'string',
        'id': 'number',
        'jump_page': 'array',
        'manage_influence': 'number',
        'name': 'string',
        'order_price': 'number',
        'price': 'number',
        'pt_num': 'number',
        'rarity': 'number',
        'resource_type': 'number',
        'sub_attribute': 'array',
        'tech_id': 'number',
        'type': 'number',
        'usage': 'string',
        'usage_arg': 'array|string',
    } },
    { file: 'island/tasks.json', kind: 'dict', fields: {
        'com_page': 'array|string',
        'com_perform': 'array|string',
        'complete_data': 'number',
        'complete_tips': 'string',
        'complete_type': 'number',
        'count_offset': 'number',
        'id': 'number',
        'is_tech_task': 'number',
        'link_task': 'array',
        'map_complete_tips': 'number',
        'map_trigger_tips': 'number',
        'name': 'string',
        'navigation': 'number',
        'rec_perform': 'string',
        'reward_exp': 'number',
        'reward_show': 'array|string',
        'series': 'string',
        'series_name': 'string',
        'target_id': 'object',
        'task_desc': 'string',
        'trigger_data': 'number',
        'trigger_tips': 'number',
        'trigger_type': 'number',
        'type': 'number',
        'unlock_condition': 'array',
        'unlock_time': 'array|string',
    } },
    { file: 'skin/skin_poll_data.json', kind: 'dict', fields: {
        // 'ASMR 일러' is 100% null today but will carry URLs once extracted — string allowed up front.
        'ASMR 일러': 'string|null',
        '깔끔한 일러': 'string',
        '레어도': 'string',
        '스킨 타입 - 한글': 'string|null',
        '스킨 태그': 'string',
        '전체 일러': 'string|null',
        '진영': 'string',
        '클뜯 id': 'number',
        '한글 함순이 + 스킨 이름': 'string',
        '함순이 이름': 'string',
    } },
    // Three record families: campaign (~69%), expedition (~31%), event archive — hence many optionals.
    { file: 'maps/map_data_full.json', kind: 'dict', fields: {
        'category': 'string',
        'difficulty': 'number',
        'grids': 'array',
        'id': 'number',
        'name': 'string',
        'act_id': 'number?',
        'ai_refresh': 'array?',
        'air_dominance': 'number?',
        'ammo_total': 'number?',
        'awards': 'array?',
        'best_air_dominance': 'number?',
        'boss_refresh': 'number?',
        'chapter_name': 'string?',
        'elite_refresh': 'array?',
        'enemy_refresh': 'array?',
        'expeditions': 'object?',
        'group_num': 'number?',
        'has_loop': 'boolean?',
        'icon': 'array?',
        'item_drops': 'array?',
        'limitation': 'array?',
        'map': 'number?',
        'model': 'number?',
        'num_1': 'number?',
        'num_2': 'number?',
        'num_3': 'number?',
        'oil': 'number?',
        'pre_chapter': 'array?',
        'profiles': 'string?',
        'progress_boss': 'number?',
        'property_limitation': 'array?',
        'risk_levels': 'array?',
        'star_require_1': 'number?',
        'star_require_2': 'number?',
        'star_require_3': 'number?',
        'submarine_num': 'number?',
        'type': 'number?',
        'unlocklevel': 'number?',
        'use_oil_limit': 'array?',
        'expedition_level': 'number?',
        'expedition_map_id': 'number?',
        'port_id': 'array?',
        'theme': 'array?',
        'archive_id': 'number?',
        'event_name': 'string?',
        'special_drop_display': 'array?',
        'event_pt': 'number?',
    } },
    // Two-level: 3 pool objects (소형/중형/특형) each keyed by ship id → only container shape guarded.
    { file: 'shipgirl/ship_build_sim_data.json', kind: 'dict', fields: {} },
];

/** JSON-value type name as used in field specs. */
function typeOf(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value; // 'string' | 'number' | 'boolean' | 'object'
}

/**
 * Indices of the records to field-check: first, last, and evenly spaced between.
 * @param {number} n total records @param {number} k sample size
 * @returns {number[]}
 */
export function sampleIndices(n, k = SAMPLE_COUNT) {
    if (n <= k) return Array.from({ length: n }, (_, i) => i);
    const picked = new Set();
    for (let i = 0; i < k; i++) picked.add(Math.round((i * (n - 1)) / (k - 1)));
    return [...picked];
}

/**
 * Check one record against a fields contract.
 * @param {string} file @param {*} record @param {Object<string,string>} fields @param {string} where
 * @returns {{key: string, problem: string, message: string}[]} structured errors (key/problem used for dedupe)
 */
function checkFields(file, record, fields, where) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return [{ key: '', problem: 'record', message: `${file}: ${where} is not an object (got ${typeOf(record)})` }];
    }
    const errors = [];
    const refreshHint = `re-run the WSL pipeline, or refresh the contract via \`node scripts/check-data-shape.mjs --describe ${file}\``;
    for (const [key, rawSpec] of Object.entries(fields)) {
        const optional = rawSpec.endsWith('?');
        const spec = optional ? rawSpec.slice(0, -1) : rawSpec;
        if (!(key in record)) {
            if (!optional) {
                errors.push({ key, problem: 'missing', message: `${file}: missing field "${key}" on ${where} — upstream schema may have changed; ${refreshHint}` });
            }
            continue;
        }
        const actual = typeOf(record[key]);
        if (!spec.split('|').includes(actual)) {
            errors.push({ key, problem: 'type', message: `${file}: field "${key}" on ${where} is ${actual}, expected ${spec} — ${refreshHint}` });
        }
    }
    return errors;
}

/**
 * Validate one parsed JSON value against a manifest entry. Pure (no I/O).
 * The same field failing on several sampled records is reported once.
 * @param {ManifestEntry} entry
 * @param {*} parsed
 * @returns {string[]} error messages (empty = OK)
 */
export function validateOne(entry, parsed) {
    const { file, kind, fields } = entry;

    let samples; // [where, record][]
    if (kind === 'array') {
        if (!Array.isArray(parsed)) return [`${file}: expected a JSON array, got ${typeOf(parsed)}`];
        if (parsed.length === 0) return [`${file}: array is empty`];
        samples = sampleIndices(parsed.length).map((i) => [`record[${i}]`, parsed[i]]);
    } else if (kind === 'dict') {
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return [`${file}: expected a JSON object (dict), got ${typeOf(parsed)}`];
        }
        const keys = Object.keys(parsed);
        if (keys.length === 0) return [`${file}: object is empty`];
        samples = sampleIndices(keys.length).map((i) => [`value["${keys[i]}"]`, parsed[keys[i]]]);
    } else { // flat object
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return [`${file}: expected a JSON object, got ${typeOf(parsed)}`];
        }
        samples = [['object', parsed]];
    }

    const seen = new Set();
    const messages = [];
    for (const [where, record] of samples) {
        for (const err of checkFields(file, record, fields, where)) {
            const dedupeKey = `${err.problem}:${err.key}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            messages.push(err.message);
        }
    }
    return messages;
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
        errors.push(...validateOne(entry, parsed));
    }
    return errors;
}

// ---------------------------------------------------------------------------
// --describe: contract authoring helper (scans ALL records, prints a fields literal)
// ---------------------------------------------------------------------------

/**
 * Profile every record: per-key presence count + set of observed types.
 * @param {Object[]} records
 * @returns {Map<string, {count: number, types: Set<string>}>}
 */
export function profileRecords(records) {
    const profile = new Map();
    for (const record of records) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
        for (const [key, value] of Object.entries(record)) {
            let p = profile.get(key);
            if (!p) { p = { count: 0, types: new Set() }; profile.set(key, p); }
            p.count++;
            p.types.add(typeOf(value));
        }
    }
    return profile;
}

/** Build the suggested spec string for one profiled key: union, 'null' last, '?' if sparse. */
function suggestSpec(p, total) {
    const types = [...p.types].filter((t) => t !== 'null').sort();
    if (p.types.has('null')) types.push('null');
    return types.join('|') + (p.count < total ? '?' : '');
}

function runDescribe(fileRel) {
    const p = join(DATA_DIR, fileRel);
    if (!existsSync(p)) { console.error(`not found: ${p}`); process.exit(1); }
    const parsed = JSON.parse(readFileSync(p, 'utf8'));

    let kind, records;
    if (Array.isArray(parsed)) {
        kind = 'array';
        records = parsed;
    } else if (parsed && typeof parsed === 'object') {
        const values = Object.values(parsed);
        const dictLike = values.length > 0 && values.every((v) => v && typeof v === 'object' && !Array.isArray(v));
        kind = dictLike ? 'dict' : 'object';
        records = dictLike ? values : [parsed];
    } else {
        console.error(`unsupported top-level value: ${typeOf(parsed)}`);
        process.exit(1);
    }

    const total = records.length;
    const profile = [...profileRecords(records)].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));

    console.log(`${fileRel} — kind: ${kind}, ${total} record${total === 1 ? '' : 's'} scanned\n`);
    for (const [key, p] of profile) {
        const pct = ((p.count / total) * 100).toFixed(p.count === total ? 0 : 1);
        console.log(`  ${key.padEnd(28)} ${String(pct).padStart(5)}%  ${[...p.types].join(', ')}`);
    }
    console.log(`\nSuggested entry (sparse keys marked optional — prune ones not worth guarding):\n`);
    console.log(`    { file: '${fileRel}', kind: '${kind}', fields: {`);
    for (const [key, p] of profile) {
        console.log(`        '${key}': '${suggestSpec(p, total)}',`);
    }
    console.log(`    } },`);
}

// ---------------------------------------------------------------------------
// CLI — run only when invoked directly, not when imported by tests.
// ---------------------------------------------------------------------------

const invokedDirectly = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
    const args = process.argv.slice(2);
    const describeIdx = args.indexOf('--describe');
    if (describeIdx !== -1) {
        const fileRel = args[describeIdx + 1];
        if (!fileRel) { console.error('usage: node scripts/check-data-shape.mjs --describe <file-relative-to-public/data>'); process.exit(1); }
        runDescribe(fileRel);
    } else {
        const errors = validateShape(MANIFEST, DATA_DIR);
        if (errors.length) {
            console.error(`\n✗ data-shape check FAILED (${errors.length} issue${errors.length > 1 ? 's' : ''}):`);
            for (const e of errors) console.error('  - ' + e);
            process.exit(1);
        }
        console.log(`✓ data-shape check passed (${MANIFEST.length} critical files).`);
    }
}
